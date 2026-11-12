/**
 * Validación de las peticiones. Devuelve un error con código 400 y el detalle de
 * los campos inválidos para que el ESP32 (o la app) pueda corregir el envío.
 */

class ErrorValidacion extends Error {
  constructor(detalles) {
    super("Datos inválidos");
    this.name = "ErrorValidacion";
    this.status = 400;
    this.detalles = detalles;
  }
}

function numero(valor, campo, { min, max, requerido = true } = {}) {
  if (valor === undefined || valor === null || valor === "") {
    if (requerido) throw new ErrorValidacion([{ campo, mensaje: "Es obligatorio" }]);
    return null;
  }
  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new ErrorValidacion([{ campo, mensaje: `Debe ser numérico (recibido: ${JSON.stringify(valor)})` }]);
  }
  if (min !== undefined && n < min) throw new ErrorValidacion([{ campo, mensaje: `Debe ser mayor o igual a ${min}` }]);
  if (max !== undefined && n > max) throw new ErrorValidacion([{ campo, mensaje: `Debe ser menor o igual a ${max}` }]);
  return n;
}

function enteroPositivo(valor, campo, { requerido = true, porDefecto } = {}) {
  if (valor === undefined || valor === null || valor === "") {
    if (requerido) throw new ErrorValidacion([{ campo, mensaje: "Es obligatorio" }]);
    return porDefecto ?? null;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ErrorValidacion([{ campo, mensaje: "Debe ser un entero positivo" }]);
  }
  return n;
}

/**
 * Convierte los parámetros de consulta (strings) en filtros tipados.
 */
function filtrosMediciones(query = {}) {
  const limite = query.limit !== undefined ? Number(query.limit) : 50;
  if (!Number.isInteger(limite) || limite <= 0 || limite > 500) {
    throw new ErrorValidacion([{ campo: "limit", mensaje: "Debe ser un entero entre 1 y 500" }]);
  }

  const idCompostera = query.compostera !== undefined ? enteroPositivo(query.compostera, "compostera") : null;

  const fechas = {};
  for (const campo of ["desde", "hasta"]) {
    if (query[campo]) {
      const fecha = new Date(query[campo]);
      if (Number.isNaN(fecha.getTime())) {
        throw new ErrorValidacion([{ campo, mensaje: "Debe ser una fecha ISO 8601 válida" }]);
      }
      fechas[campo] = fecha.toISOString();
    }
  }

  return { limite, idCompostera, desde: fechas.desde ?? null, hasta: fechas.hasta ?? null };
}

/** Valida el cuerpo de una medición enviada por el ESP32. */
function validarMedicion(body = {}) {
  const detalles = [];
  const campos = {};

  const intentar = (fn) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof ErrorValidacion) detalles.push(...error.detalles);
      else throw error;
    }
  };

  intentar(() => {
    campos.id_compostera = enteroPositivo(body.id_compostera, "id_compostera", { requerido: false, porDefecto: 1 });
  });
  intentar(() => {
    campos.temperatura = numero(body.temperatura, "temperatura", { min: -10, max: 120 });
  });
  intentar(() => {
    campos.humedad = numero(body.humedad, "humedad", { min: 0, max: 100 });
  });
  intentar(() => {
    campos.ph = numero(body.ph, "ph", { min: 0, max: 14 });
  });

  if (detalles.length > 0) throw new ErrorValidacion(detalles);

  const codigo = body.codigo_dispositivo ? String(body.codigo_dispositivo).trim().toUpperCase() : null;
  if (codigo && codigo.length > 40) {
    throw new ErrorValidacion([{ campo: "codigo_dispositivo", mensaje: "Máximo 40 caracteres" }]);
  }

  return {
    id_compostera: campos.id_compostera,
    codigo_dispositivo: codigo,
    temperatura: campos.temperatura,
    humedad: campos.humedad,
    ph: campos.ph,
    ph_simulado: body.ph_simulado === true,
  };
}

function validarCompostera(body = {}) {
  const detalles = [];
  let nombre = null;
  let grupo = null;

  if (!body.nombre || String(body.nombre).trim().length < 2) {
    detalles.push({ campo: "nombre", mensaje: "Debe tener al menos 2 caracteres" });
  } else {
    nombre = String(body.nombre).trim().slice(0, 80);
  }

  grupo = String(body.grupo || "").toUpperCase();
  if (!["GC", "GE"].includes(grupo)) {
    detalles.push({ campo: "grupo", mensaje: "Debe ser GC (grupo control) o GE (grupo experimental)" });
  }

  if (detalles.length > 0) throw new ErrorValidacion(detalles);

  return { nombre, grupo, ubicacion: body.ubicacion ? String(body.ubicacion).trim().slice(0, 120) : null };
}

const PARAMETROS_PPFM = ["temperatura", "humedad", "ph"];

function validarRegistroPpfm(body = {}) {
  const detalles = [];
  const registro = {};

  try {
    registro.id_compostera = enteroPositivo(body.id_compostera, "id_compostera", { requerido: false, porDefecto: 1 });
  } catch (error) {
    detalles.push(...error.detalles);
  }

  registro.parametro = String(body.parametro || "").toLowerCase();
  if (!PARAMETROS_PPFM.includes(registro.parametro)) {
    detalles.push({ campo: "parametro", mensaje: `Debe ser uno de: ${PARAMETROS_PPFM.join(", ")}` });
  }

  try {
    registro.valor_medido = numero(body.valor_medido, "valor_medido");
  } catch (error) {
    detalles.push(...error.detalles);
  }
  try {
    registro.valor_referencia = numero(body.valor_referencia, "valor_referencia");
  } catch (error) {
    detalles.push(...error.detalles);
  }
  registro.fecha = body.fecha ? new Date(body.fecha) : new Date();
  if (Number.isNaN(registro.fecha.getTime())) {
    detalles.push({ campo: "fecha", mensaje: "Debe ser una fecha ISO 8601 válida" });
  }

  if (detalles.length > 0) throw new ErrorValidacion(detalles);

  return {
    ...registro,
    observaciones: body.observaciones ? String(body.observaciones).slice(0, 500) : null,
  };
}

const COLORES = { "marron_oscuro": 2, "marron_claro": 1, "negro_verdoso": 0 };
const AROMAS = { "tierra_humeda": 2, "neutro": 1, "putrefacto": 0 };
const TEXTURAS = { "suelta_granulada": 2, "grumosa": 1, "compacta_pastosa": 0 };
const HUMEDADES_TACTO = { "humedece_sin_gotear": 2, "seca": 1, "gotea": 0 };

function validarRegistroCfc(body = {}) {
  const detalles = [];
  const elegir = (campo, opciones) => {
    const valor = String(body[campo] || "").toLowerCase();
    if (!(valor in opciones)) {
      detalles.push({ campo, mensaje: `Debe ser uno de: ${Object.keys(opciones).join(", ")}` });
      return null;
    }
    return valor;
  };

  const color = elegir("color", COLORES);
  const aroma = elegir("aroma", AROMAS);
  const textura = elegir("textura", TEXTURAS);
  const humedad = elegir("humedad", HUMEDADES_TACTO);

  let idCompostera = 1;
  try {
    idCompostera = enteroPositivo(body.id_compostera, "id_compostera", { requerido: false, porDefecto: 1 });
  } catch (error) {
    detalles.push(...error.detalles);
  }

  if (detalles.length > 0) throw new ErrorValidacion(detalles);

  const puntaje =
    COLORES[color] + AROMAS[aroma] + TEXTURAS[textura] + HUMEDADES_TACTO[humedad];

  return {
    id_compostera: idCompostera,
    color,
    aroma,
    textura,
    humedad,
    puntaje,
    maduro: puntaje >= 7,
    fecha: body.fecha ? new Date(body.fecha) : new Date(),
    observaciones: body.observaciones ? String(body.observaciones).slice(0, 500) : null,
  };
}

module.exports = {
  ErrorValidacion,
  validarMedicion,
  validarCompostera,
  validarRegistroPpfm,
  validarRegistroCfc,
  filtrosMediciones,
  enteroPositivo,
};
