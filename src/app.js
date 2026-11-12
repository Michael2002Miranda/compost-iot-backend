const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { clasificarMedicion } = require("./domain/clasificacion");
const { calcularPrecision, promedioPrecision } = require("./domain/precision");
const {
  hashPassword,
  verificarPassword,
  firmarToken,
  crearMiddlewareAutenticacion,
} = require("./auth");
const {
  ErrorValidacion,
  validarMedicion,
  validarCompostera,
  validarRegistroPpfm,
  validarRegistroCfc,
  filtrosMediciones,
} = require("./validacion");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Fábrica de la aplicación. Recibe el pool de PostgreSQL por inyección para poder
 * probar la API sin una base de datos real (ver test/app.test.js).
 */
function crearApp(pool, { registrar = console } = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "64kb" }));

  const autenticar = crearMiddlewareAutenticacion(pool);
  const envolver = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // --- Autenticación del dispositivo --------------------------------------
  const claveDispositivo = process.env.DEVICE_API_KEY;

  function exigirClave(req, _res, next) {
    if (!claveDispositivo) return next();
    const recibida = String(req.get("x-api-key") || "");
    const esperada = String(claveDispositivo);
    const a = Buffer.from(recibida);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const error = new Error("Clave de dispositivo inválida");
      error.status = 401;
      return next(error);
    }
    return next();
  }

  // --- Utilidades ---------------------------------------------------------
  async function composteraDelUsuario(id, usuarioId) {
    const { rows } = await pool.query(
      "SELECT * FROM composteras WHERE id = $1 AND usuario_id = $2",
      [id, usuarioId],
    );
    return rows[0] ?? null;
  }

  async function generarCodigo() {
    for (let intento = 0; intento < 10; intento += 1) {
      const codigo = `CMP-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const { rows } = await pool.query("SELECT 1 FROM composteras WHERE codigo = $1", [codigo]);
      if (rows.length === 0) return codigo;
    }
    return `CMP-${Date.now().toString(36).toUpperCase()}`;
  }

  function validarCredenciales(body = {}) {
    const detalles = [];
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!EMAIL.test(email)) detalles.push({ campo: "email", mensaje: "Ingrese un correo válido" });
    if (password.length < 6) detalles.push({ campo: "password", mensaje: "Mínimo 6 caracteres" });

    if (detalles.length > 0) throw new ErrorValidacion(detalles);
    return { email, password };
  }

  // --- Salud y estado -----------------------------------------------------
  app.get("/health", envolver(async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", base_datos: "conectada" });
    } catch (error) {
      registrar.error("[health] base de datos no disponible:", error.message);
      res.status(503).json({ status: "degradado", base_datos: "no disponible" });
    }
  }));

  app.get("/", envolver(async (_req, res) => {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM mediciones");
    res.json({
      mensaje: "API Monitoreo Compostaje IoT - El Porvenir 2026",
      version: "2.0.0",
      total: rows[0]?.total ?? 0,
    });
  }));

  // --- Cuentas ------------------------------------------------------------
  app.post("/api/auth/registro", envolver(async (req, res) => {
    const { email, password } = validarCredenciales(req.body);
    const nombre = String(req.body?.nombre || "").trim();

    if (nombre.length < 3) {
      throw new ErrorValidacion([{ campo: "nombre", mensaje: "Ingrese su nombre completo" }]);
    }

    const existente = await pool.query("SELECT 1 FROM usuarios WHERE email = $1", [email]);
    if (existente.rows.length > 0) {
      const error = new Error("Ese correo ya está registrado");
      error.status = 409;
      throw error;
    }

    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, email, creado_en`,
      [nombre.slice(0, 80), email, hashPassword(password)],
    );

    const usuario = rows[0];
    res.status(201).json({ status: "success", token: firmarToken(usuario), usuario });
  }));

  app.post("/api/auth/login", envolver(async (req, res) => {
    const { email, password } = validarCredenciales(req.body);
    const { rows } = await pool.query(
      "SELECT id, nombre, email, password_hash FROM usuarios WHERE email = $1",
      [email],
    );

    const usuario = rows[0];
    if (!usuario || !verificarPassword(password, usuario.password_hash)) {
      const error = new Error("Correo o contraseña incorrectos");
      error.status = 401;
      throw error;
    }

    const { password_hash: _omitido, ...publico } = usuario;
    res.json({ status: "success", token: firmarToken(publico), usuario: publico });
  }));

  app.get("/api/auth/perfil", autenticar, envolver(async (req, res) => {
    res.json({ status: "success", usuario: req.usuario });
  }));

  // --- Composteras --------------------------------------------------------
  app.get("/api/composteras", autenticar, envolver(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM mediciones m WHERE m.id_compostera = c.id) AS lecturas,
              (SELECT MAX(m.fecha_hora) FROM mediciones m WHERE m.id_compostera = c.id) AS ultima_lectura
         FROM composteras c
        WHERE c.usuario_id = $1
        ORDER BY c.id`,
      [req.usuario.id],
    );
    res.json({ status: "success", data: rows });
  }));

  app.post("/api/composteras", autenticar, envolver(async (req, res) => {
    const datos = validarCompostera(req.body);
    const codigo = await generarCodigo();

    const { rows } = await pool.query(
      `INSERT INTO composteras (nombre, grupo, ubicacion, usuario_id, codigo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [datos.nombre, datos.grupo, datos.ubicacion, req.usuario.id, codigo],
    );

    res.status(201).json({ status: "success", data: rows[0] });
  }));

  app.patch("/api/composteras/:id", autenticar, envolver(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorValidacion([{ campo: "id", mensaje: "Debe ser un entero positivo" }]);
    }
    const compostera = await composteraDelUsuario(id, req.usuario.id);
    if (!compostera) {
      return res.status(404).json({ status: "error", mensaje: "Compostera no encontrada" });
    }

    const nombre = req.body?.nombre ? String(req.body.nombre).trim().slice(0, 80) : compostera.nombre;
    const ubicacion = req.body?.ubicacion !== undefined
      ? String(req.body.ubicacion).trim().slice(0, 120)
      : compostera.ubicacion;
    const activa = req.body?.activa !== undefined ? Boolean(req.body.activa) : compostera.activa;

    const { rows } = await pool.query(
      "UPDATE composteras SET nombre = $1, ubicacion = $2, activa = $3 WHERE id = $4 RETURNING *",
      [nombre, ubicacion, activa, id],
    );
    return res.json({ status: "success", data: rows[0] });
  }));

  // --- Mediciones (ingesta del ESP32) -------------------------------------
  app.post("/api/mediciones", exigirClave, envolver(async (req, res) => {
    const datos = validarMedicion(req.body);

    let idCompostera = datos.id_compostera;
    if (datos.codigo_dispositivo) {
      const { rows } = await pool.query(
        "SELECT id FROM composteras WHERE codigo = $1",
        [datos.codigo_dispositivo],
      );
      if (rows.length === 0) {
        throw new ErrorValidacion([{
          campo: "codigo_dispositivo",
          mensaje: `No existe una compostera con el código ${datos.codigo_dispositivo}`,
        }]);
      }
      idCompostera = rows[0].id;
    } else {
      const { rows } = await pool.query("SELECT 1 FROM composteras WHERE id = $1", [idCompostera]);
      if (rows.length === 0) {
        throw new ErrorValidacion([{
          campo: "id_compostera",
          mensaje: `La compostera ${idCompostera} no está registrada. Regístrela desde la aplicación.`,
        }]);
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO mediciones (id_compostera, temperatura, humedad, ph, ph_simulado)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [idCompostera, datos.temperatura, datos.humedad, datos.ph, datos.ph_simulado],
    );

    const medicion = rows[0];
    const clasificacion = clasificarMedicion(medicion);

    if (clasificacion.alertas.length > 0) {
      try {
        for (const alerta of clasificacion.alertas) {
          await pool.query(
            `INSERT INTO alertas (id_medicion, id_compostera, parametro, severidad, mensaje, valor)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [medicion.id, medicion.id_compostera, alerta.parametro, alerta.severidad, alerta.mensaje, alerta.valor],
          );
        }
      } catch (error) {
        registrar.error("[alertas] no se pudieron registrar:", error.message);
      }
    }

    registrar.log(
      `[IoT] Compostera ${medicion.id_compostera} | ${medicion.temperatura}°C | ${medicion.humedad}% | pH ${medicion.ph} | ${clasificacion.fase.fase}`,
    );

    res.status(201).json({
      status: "success",
      data: medicion,
      clasificacion,
      alertas: clasificacion.alertas,
    });
  }));

  app.get("/api/mediciones", autenticar, envolver(async (req, res) => {
    const { limite, idCompostera, desde, hasta } = filtrosMediciones(req.query);

    const condiciones = ["c.usuario_id = $1"];
    const valores = [req.usuario.id];
    if (idCompostera) {
      valores.push(idCompostera);
      condiciones.push(`m.id_compostera = $${valores.length}`);
    }
    if (desde) {
      valores.push(desde);
      condiciones.push(`m.fecha_hora >= $${valores.length}`);
    }
    if (hasta) {
      valores.push(hasta);
      condiciones.push(`m.fecha_hora <= $${valores.length}`);
    }
    valores.push(limite);

    const { rows } = await pool.query(
      `SELECT m.*, c.nombre AS compostera_nombre, c.grupo
         FROM mediciones m
         JOIN composteras c ON c.id = m.id_compostera
        WHERE ${condiciones.join(" AND ")}
        ORDER BY m.fecha_hora DESC
        LIMIT $${valores.length}`,
      valores,
    );

    res.json({ status: "success", total: rows.length, data: rows });
  }));

  app.get("/api/mediciones/ultima", autenticar, envolver(async (req, res) => {
    const { idCompostera } = filtrosMediciones({ limit: 1, compostera: req.query.compostera });

    const valores = [req.usuario.id];
    let filtroCompostera = "";
    if (idCompostera) {
      valores.push(idCompostera);
      filtroCompostera = `AND m.id_compostera = $${valores.length}`;
    }

    const { rows } = await pool.query(
      `SELECT m.*, c.nombre AS compostera_nombre, c.grupo, c.creada_en
         FROM mediciones m
         JOIN composteras c ON c.id = m.id_compostera
        WHERE c.usuario_id = $1 ${filtroCompostera}
        ORDER BY m.fecha_hora DESC
        LIMIT 1`,
      valores,
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: "empty", mensaje: "No hay mediciones registradas aún" });
    }

    return res.json({ status: "success", data: rows[0], clasificacion: clasificarMedicion(rows[0]) });
  }));

  // --- Alertas ------------------------------------------------------------
  app.get("/api/alertas", autenticar, envolver(async (req, res) => {
    const estado = String(req.query.estado || "todas");
    const filtro = estado === "pendientes" ? "AND a.atendida = FALSE" : "";

    const { rows } = await pool.query(
      `SELECT a.*, c.nombre AS compostera_nombre, c.grupo
         FROM alertas a
         JOIN composteras c ON c.id = a.id_compostera
        WHERE c.usuario_id = $1 ${filtro}
        ORDER BY a.fecha_hora DESC
        LIMIT 100`,
      [req.usuario.id],
    );

    res.json({ status: "success", total: rows.length, data: rows });
  }));

  app.patch("/api/alertas/:id", autenticar, envolver(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ErrorValidacion([{ campo: "id", mensaje: "Debe ser un entero positivo" }]);
    }
    const atendida = Boolean(req.body?.atendida ?? true);

    const { rows } = await pool.query(
      `UPDATE alertas a
          SET atendida = $1
         FROM composteras c
        WHERE a.id = $2 AND c.id = a.id_compostera AND c.usuario_id = $3
        RETURNING a.*`,
      [atendida, id, req.usuario.id],
    );

    if (rows.length === 0) return res.status(404).json({ status: "error", mensaje: "Alerta no encontrada" });
    return res.json({ status: "success", data: rows[0] });
  }));

  // --- Indicador PPFM -----------------------------------------------------
  app.post("/api/registros/ppfm", autenticar, envolver(async (req, res) => {
    const datos = validarRegistroPpfm(req.body);
    const compostera = await composteraDelUsuario(datos.id_compostera, req.usuario.id);
    if (!compostera) return res.status(404).json({ status: "error", mensaje: "Compostera no encontrada" });

    const { precision, error } = calcularPrecision(datos.valor_medido, datos.valor_referencia);

    const { rows } = await pool.query(
      `INSERT INTO registros_ppfm
         (id_compostera, parametro, valor_medido, valor_referencia, precision, error, fecha, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        datos.id_compostera,
        datos.parametro,
        datos.valor_medido,
        datos.valor_referencia,
        precision,
        error,
        datos.fecha.toISOString(),
        datos.observaciones,
      ],
    );

    return res.status(201).json({
      status: "success",
      data: rows[0],
      precision,
      promedio: promedioPrecision(rows),
    });
  }));

  app.get("/api/registros/ppfm", autenticar, envolver(async (req, res) => {
    const { idCompostera } = filtrosMediciones({ limit: 500, compostera: req.query.compostera });
    const valores = [req.usuario.id];
    let filtro = "";
    if (idCompostera) {
      valores.push(idCompostera);
      filtro = `AND r.id_compostera = $${valores.length}`;
    }

    const { rows } = await pool.query(
      `SELECT r.*, c.nombre AS compostera_nombre, c.grupo
         FROM registros_ppfm r
         JOIN composteras c ON c.id = r.id_compostera
        WHERE c.usuario_id = $1 ${filtro}
        ORDER BY r.fecha DESC
        LIMIT 500`,
      valores,
    );

    res.json({ status: "success", total: rows.length, promedio: promedioPrecision(rows), data: rows });
  }));

  // --- Indicador CFC ------------------------------------------------------
  app.post("/api/registros/cfc", autenticar, envolver(async (req, res) => {
    const datos = validarRegistroCfc(req.body);
    const compostera = await composteraDelUsuario(datos.id_compostera, req.usuario.id);
    if (!compostera) return res.status(404).json({ status: "error", mensaje: "Compostera no encontrada" });

    const { rows } = await pool.query(
      `INSERT INTO registros_cfc
         (id_compostera, color, aroma, textura, humedad, puntaje, maduro, fecha, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        datos.id_compostera,
        datos.color,
        datos.aroma,
        datos.textura,
        datos.humedad,
        datos.puntaje,
        datos.maduro,
        datos.fecha.toISOString(),
        datos.observaciones,
      ],
    );
    return res.status(201).json({ status: "success", data: rows[0] });
  }));

  app.get("/api/registros/cfc", autenticar, envolver(async (req, res) => {
    const { idCompostera } = filtrosMediciones({ limit: 500, compostera: req.query.compostera });
    const valores = [req.usuario.id];
    let filtro = "";
    if (idCompostera) {
      valores.push(idCompostera);
      filtro = `AND r.id_compostera = $${valores.length}`;
    }

    const { rows } = await pool.query(
      `SELECT r.*, c.nombre AS compostera_nombre, c.grupo
         FROM registros_cfc r
         JOIN composteras c ON c.id = r.id_compostera
        WHERE c.usuario_id = $1 ${filtro}
        ORDER BY r.fecha DESC
        LIMIT 500`,
      valores,
    );

    res.json({ status: "success", total: rows.length, data: rows });
  }));

  // --- Comparación de grupos (diseño cuasi experimental) ------------------
  app.get("/api/comparacion", autenticar, envolver(async (req, res) => {
    const usuario = req.usuario.id;

    const { rows: pfc } = await pool.query(
      `SELECT c.grupo,
              COUNT(m.id)::int AS lecturas,
              ROUND(AVG(m.temperatura), 2) AS temperatura_promedio,
              ROUND(AVG(m.humedad), 2) AS humedad_promedio,
              ROUND(AVG(m.ph), 2) AS ph_promedio,
              ROUND(MAX(m.temperatura), 2) AS temperatura_maxima
         FROM composteras c
         LEFT JOIN mediciones m ON m.id_compostera = c.id
        WHERE c.usuario_id = $1
        GROUP BY c.grupo`,
      [usuario],
    );

    const { rows: ppfm } = await pool.query(
      `SELECT c.grupo,
              COUNT(r.id)::int AS registros,
              ROUND(AVG(r.precision), 2) AS precision_promedio
         FROM composteras c
         LEFT JOIN registros_ppfm r ON r.id_compostera = c.id
        WHERE c.usuario_id = $1
        GROUP BY c.grupo`,
      [usuario],
    );

    const { rows: cfc } = await pool.query(
      `SELECT c.grupo,
              COUNT(r.id)::int AS registros,
              ROUND(AVG(r.puntaje), 2) AS puntaje_promedio,
              COUNT(r.id) FILTER (WHERE r.maduro)::int AS maduros
         FROM composteras c
         LEFT JOIN registros_cfc r ON r.id_compostera = c.id
        WHERE c.usuario_id = $1
        GROUP BY c.grupo`,
      [usuario],
    );

    const buscar = (filas, grupo) => filas.find((f) => f.grupo === grupo) ?? null;

    res.json({
      status: "success",
      grupos: {
        GC: { pfc: buscar(pfc, "GC"), ppfm: buscar(ppfm, "GC"), cfc: buscar(cfc, "GC") },
        GE: { pfc: buscar(pfc, "GE"), ppfm: buscar(ppfm, "GE"), cfc: buscar(cfc, "GE") },
      },
    });
  }));

  // --- Resumen para el panel ----------------------------------------------
  app.get("/api/resumen", autenticar, envolver(async (req, res) => {
    const { rows: composteras } = await pool.query(
      `SELECT c.id, c.nombre, c.grupo, c.codigo,
              COUNT(m.id)::int AS mediciones,
              MAX(m.fecha_hora) AS ultima
         FROM composteras c
         LEFT JOIN mediciones m ON m.id_compostera = c.id
        WHERE c.usuario_id = $1
        GROUP BY c.id, c.nombre, c.grupo, c.codigo
        ORDER BY c.id`,
      [req.usuario.id],
    );

    const { rows: alertas } = await pool.query(
      `SELECT COUNT(*)::int AS pendientes
         FROM alertas a
         JOIN composteras c ON c.id = a.id_compostera
        WHERE c.usuario_id = $1 AND a.atendida = FALSE`,
      [req.usuario.id],
    );

    res.json({
      status: "success",
      composteras,
      alertas_pendientes: alertas[0]?.pendientes ?? 0,
    });
  }));

  // --- Usabilidad y funcionalidad (variable independiente) ----------------
  app.post("/api/evaluaciones/sus", autenticar, envolver(async (req, res) => {
    const respuestas = req.body?.respuestas;
    if (!Array.isArray(respuestas) || respuestas.length !== 10 || respuestas.some((v) => !Number.isInteger(v) || v < 1 || v > 5)) {
      throw new ErrorValidacion([{ campo: "respuestas", mensaje: "Se requieren 10 respuestas entre 1 y 5" }]);
    }

    const impares = respuestas.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) - 5;
    const pares = 25 - respuestas.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
    const puntaje = (impares + pares) * 2.5;

    const { rows } = await pool.query(
      `INSERT INTO evaluaciones_sus (usuario_id, evaluador, respuestas, puntaje)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.usuario.id, req.body?.evaluador ?? null, JSON.stringify(respuestas), puntaje],
    );

    res.status(201).json({ status: "success", data: rows[0], puntaje });
  }));

  app.post("/api/pruebas/funcionalidad", autenticar, envolver(async (req, res) => {
    const caso = String(req.body?.caso || "").trim();
    if (caso.length < 3) {
      throw new ErrorValidacion([{ campo: "caso", mensaje: "Indique el caso de prueba" }]);
    }
    const { rows } = await pool.query(
      `INSERT INTO pruebas_funcionalidad (usuario_id, caso, descripcion, aprobado, observacion)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        req.usuario.id,
        caso.slice(0, 120),
        req.body?.descripcion ? String(req.body.descripcion).slice(0, 300) : null,
        req.body?.aprobado !== false,
        req.body?.observacion ? String(req.body.observacion).slice(0, 300) : null,
      ],
    );
    res.status(201).json({ status: "success", data: rows[0] });
  }));

  // --- Exportación para el análisis estadístico ---------------------------
  app.get("/api/export/mediciones.csv", autenticar, envolver(async (req, res) => {
    const { idCompostera } = filtrosMediciones({ limit: 500, compostera: req.query.compostera });
    const valores = [req.usuario.id];
    let filtro = "";
    if (idCompostera) {
      valores.push(idCompostera);
      filtro = `AND m.id_compostera = $${valores.length}`;
    }

    const { rows } = await pool.query(
      `SELECT m.id, c.id AS id_compostera, c.nombre AS compostera, c.grupo,
              m.temperatura, m.humedad, m.ph, m.ph_simulado, m.fecha_hora
         FROM mediciones m
         JOIN composteras c ON c.id = m.id_compostera
        WHERE c.usuario_id = $1 ${filtro}
        ORDER BY m.fecha_hora ASC
        LIMIT 5000`,
      valores,
    );

    const encabezado = ["id", "id_compostera", "compostera", "grupo", "temperatura", "humedad", "ph", "ph_simulado", "fecha_hora"];
    const lineas = [encabezado.join(",")];
    for (const fila of rows) {
      lineas.push(
        encabezado
          .map((campo) => {
            const valor = fila[campo];
            if (valor === null || valor === undefined) return "";
            const texto = String(valor);
            return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
          })
          .join(","),
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="mediciones_compostaje.csv"');
    res.send(`\uFEFF${lineas.join("\r\n")}`);
  }));

  // --- Manejo centralizado de errores -------------------------------------
  app.use((req, res) => {
    res.status(404).json({ status: "error", mensaje: `Ruta no encontrada: ${req.method} ${req.path}` });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => {
    if (error instanceof ErrorValidacion) {
      return res.status(400).json({
        status: "error",
        mensaje: "Datos inválidos",
        detalles: error.detalles,
      });
    }
    const status = error.status || 500;
    if (status >= 500) registrar.error("[API]", error);
    return res.status(status).json({
      status: "error",
      mensaje: status >= 500 ? "Error interno del servidor" : error.message,
    });
  });

  return app;
}

module.exports = { crearApp };

// Compatibilidad con despliegues que arrancan con `node src/app.js`
// (comando de inicio que tenía el servicio en Render antes de este cambio).
if (require.main === module) {
  require("./index");
}
