const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { crearApp } = require("../src/app");
const { firmarToken, hashPassword } = require("../src/auth");

const USUARIO = { id: 1, nombre: "Ana Torres", email: "ana@upao.edu.pe", creado_en: "2026-11-01T00:00:00.000Z" };
const PASSWORD = "compost2026";

/** Pool de PostgreSQL simulado: responde según la consulta SQL. */
function crearPoolFalso({ ultima = null, fallar = false, passwordHash = hashPassword(PASSWORD), usuarioExiste = false } = {}) {
  const escrituras = [];

  return {
    escrituras,
    async query(sql, params = []) {
      if (fallar) throw new Error("conexión rechazada");
      const consulta = sql.replace(/\s+/g, " ").trim();

      if (consulta === "SELECT 1") return { rows: [{}] };
      if (consulta.includes("COUNT(*)::int AS total")) return { rows: [{ total: 12 }] };

      // Autenticación
      if (consulta.startsWith("SELECT id, nombre, email, password_hash FROM usuarios")) {
        const coincide = params[0] === USUARIO.email;
        return { rows: coincide ? [{ ...USUARIO, password_hash: passwordHash }] : [] };
      }
      if (consulta.startsWith("SELECT id, nombre, email FROM usuarios")) {
        return { rows: params[0] === USUARIO.id ? [USUARIO] : [] };
      }
      if (consulta.startsWith("SELECT 1 FROM usuarios WHERE email")) {
        return { rows: usuarioExiste ? [{ "?column?": 1 }] : [] };
      }
      if (consulta.startsWith("INSERT INTO usuarios")) {
        escrituras.push({ tabla: "usuarios", params });
        return { rows: [USUARIO] };
      }

      // Composteras
      if (consulta.startsWith("SELECT id FROM composteras WHERE codigo")) {
        return { rows: params[0] === "CMP-1234" ? [{ id: 5 }] : [] };
      }
      if (consulta.startsWith("SELECT 1 FROM composteras WHERE id")) {
        return { rows: params[0] === 1 ? [{ id: 1 }] : [] };
      }
      if (consulta.startsWith("SELECT * FROM composteras WHERE id = $1 AND usuario_id = $2")) {
        return { rows: [{ id: params[0], nombre: "Mi compostera", grupo: "GE" }] };
      }

      // Mediciones
      if (consulta.startsWith("INSERT INTO mediciones")) {
        escrituras.push({ tabla: "mediciones", params });
        return {
          rows: [{
            id: 7,
            id_compostera: params[0],
            temperatura: String(params[1]),
            humedad: String(params[2]),
            ph: String(params[3]),
            ph_simulado: params[4],
            fecha_hora: "2026-11-11T10:00:00.000Z",
          }],
        };
      }
      if (consulta.startsWith("INSERT INTO alertas")) {
        escrituras.push({ tabla: "alertas", params });
        return { rows: [] };
      }
      if (consulta.includes("ORDER BY m.fecha_hora DESC LIMIT 1")) {
        return { rows: ultima ? [ultima] : [] };
      }
      if (consulta.includes("FROM mediciones m")) {
        return { rows: ultima ? [ultima] : [] };
      }

      return { rows: [] };
    },
  };
}

async function conServidor(pool, fn) {
  const app = crearApp(pool, { registrar: { log() {}, error() {} } });
  const servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
}

const autorizacion = () => ({ Authorization: `Bearer ${firmarToken(USUARIO)}` });

test("GET /health responde 200 cuando la base está disponible", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", base_datos: "conectada" });
  });
});

test("GET /health responde 503 cuando la base no responde", async () => {
  await conServidor(crearPoolFalso({ fallar: true }), async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 503);
  });
});

test("POST /api/auth/registro crea la cuenta y entrega un token", async () => {
  const pool = crearPoolFalso();
  await conServidor(pool, async (base) => {
    const res = await fetch(`${base}/api/auth/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "Ana Torres", email: "ana@upao.edu.pe", password: PASSWORD }),
    });
    assert.equal(res.status, 201);
    const cuerpo = await res.json();
    assert.ok(cuerpo.token);
    assert.equal(cuerpo.usuario.email, "ana@upao.edu.pe");

    const insercion = pool.escrituras.find((e) => e.tabla === "usuarios");
    assert.ok(insercion.params[2].startsWith("scrypt$"), "la contraseña debe guardarse con hash");
  });
});

test("POST /api/auth/registro rechaza un correo ya registrado", async () => {
  await conServidor(crearPoolFalso({ usuarioExiste: true }), async (base) => {
    const res = await fetch(`${base}/api/auth/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "Ana Torres", email: "ana@upao.edu.pe", password: PASSWORD }),
    });
    assert.equal(res.status, 409);
  });
});

test("POST /api/auth/registro valida el formato del correo y la contraseña", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/auth/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: "Ana", email: "correo-invalido", password: "123" }),
    });
    assert.equal(res.status, 400);
    const cuerpo = await res.json();
    const campos = cuerpo.detalles.map((d) => d.campo).sort();
    assert.deepEqual(campos, ["email", "password"]);
  });
});

test("POST /api/auth/login entrega token con credenciales correctas", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USUARIO.email, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const cuerpo = await res.json();
    assert.ok(cuerpo.token);
    assert.equal(cuerpo.usuario.password_hash, undefined, "no debe exponer el hash");
  });
});

test("POST /api/auth/login rechaza contraseña incorrecta", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: USUARIO.email, password: "incorrecta" }),
    });
    assert.equal(res.status, 401);
  });
});

test("Las rutas privadas exigen token", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    for (const ruta of ["/api/mediciones", "/api/alertas", "/api/composteras", "/api/resumen"]) {
      const res = await fetch(`${base}${ruta}`);
      assert.equal(res.status, 401, `${ruta} debería exigir sesión`);
    }
  });
});

test("Un token manipulado no es aceptado", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/mediciones`, {
      headers: { Authorization: `Bearer ${firmarToken(USUARIO)}x` },
    });
    assert.equal(res.status, 401);
  });
});

test("GET /api/mediciones devuelve las lecturas del usuario autenticado", async () => {
  const lectura = {
    id: 3,
    id_compostera: 1,
    temperatura: "42.5",
    humedad: "61.0",
    ph: "7.10",
    fecha_hora: "2026-11-11T10:00:00.000Z",
    grupo: "GE",
    compostera_nombre: "Mi compostera",
  };
  await conServidor(crearPoolFalso({ ultima: lectura }), async (base) => {
    const res = await fetch(`${base}/api/mediciones`, { headers: autorizacion() });
    assert.equal(res.status, 200);
    const cuerpo = await res.json();
    assert.equal(cuerpo.total, 1);
    assert.equal(cuerpo.data[0].grupo, "GE");
  });
});

test("POST /api/mediciones rechaza datos inválidos con 400 y detalle", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/mediciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temperatura: "abc", humedad: 200, ph: 6.8 }),
    });
    assert.equal(res.status, 400);
    const cuerpo = await res.json();
    const campos = cuerpo.detalles.map((d) => d.campo).sort();
    assert.deepEqual(campos, ["humedad", "temperatura"]);
  });
});

test("POST /api/mediciones guarda la lectura y persiste todas las alertas", async () => {
  const pool = crearPoolFalso();
  await conServidor(pool, async (base) => {
    const res = await fetch(`${base}/api/mediciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_compostera: 1, temperatura: 70, humedad: 30, ph: 6.5 }),
    });

    assert.equal(res.status, 201);
    const cuerpo = await res.json();
    assert.equal(cuerpo.clasificacion.fase.codigo, "termofila");
    assert.equal(cuerpo.clasificacion.estado, "critico");
    assert.equal(cuerpo.alertas.length, 2);
    assert.equal(pool.escrituras.filter((e) => e.tabla === "alertas").length, 2);
  });
});

test("POST /api/mediciones resuelve la compostera por código de dispositivo", async () => {
  const pool = crearPoolFalso();
  await conServidor(pool, async (base) => {
    const res = await fetch(`${base}/api/mediciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo_dispositivo: "CMP-1234", temperatura: 30, humedad: 60, ph: 7 }),
    });
    assert.equal(res.status, 201);
    const insercion = pool.escrituras.find((e) => e.tabla === "mediciones");
    assert.equal(insercion.params[0], 5, "debe usar el id asociado al código");
  });
});

test("POST /api/mediciones rechaza un código de dispositivo desconocido", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/mediciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo_dispositivo: "CMP-XXXX", temperatura: 30, humedad: 60, ph: 7 }),
    });
    assert.equal(res.status, 400);
  });
});

test("POST /api/mediciones exige x-api-key cuando DEVICE_API_KEY está definida", async () => {
  process.env.DEVICE_API_KEY = "clave-secreta";
  try {
    await conServidor(crearPoolFalso(), async (base) => {
      const sinClave = await fetch(`${base}/api/mediciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temperatura: 30, humedad: 60, ph: 7 }),
      });
      assert.equal(sinClave.status, 401);

      const conClave = await fetch(`${base}/api/mediciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "clave-secreta" },
        body: JSON.stringify({ id_compostera: 1, temperatura: 30, humedad: 60, ph: 7 }),
      });
      assert.equal(conClave.status, 201);
    });
  } finally {
    delete process.env.DEVICE_API_KEY;
  }
});

test("Las rutas inexistentes responden 404 en JSON", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/no-existe`);
    assert.equal(res.status, 404);
    const cuerpo = await res.json();
    assert.equal(cuerpo.status, "error");
  });
});
