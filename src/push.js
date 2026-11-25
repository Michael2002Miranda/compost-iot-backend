/**
 * Notificaciones push con Firebase Cloud Messaging (HTTP v1).
 *
 * Necesita la variable de entorno FIREBASE_SERVICE_ACCOUNT con el contenido del
 * archivo JSON de la cuenta de servicio (Configuración del proyecto → Cuentas de
 * servicio → Generar nueva clave privada).
 *
 * Si la variable no está, el backend funciona igual: simplemente no envía avisos.
 */
const crypto = require("crypto");

let credenciales;
let tokenAcceso = null;
let expiraToken = 0;

function cargarCredenciales() {
  if (credenciales !== undefined) return credenciales;

  const texto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!texto || texto.trim() === "") {
    credenciales = null;
    return null;
  }

  try {
    const datos = JSON.parse(texto);
    if (!datos.client_email || !datos.private_key || !datos.project_id) {
      throw new Error("faltan campos client_email, private_key o project_id");
    }
    // Al copiar el JSON a una variable de entorno, los saltos de línea llegan escapados.
    datos.private_key = datos.private_key.replace(/\\n/g, "\n");
    credenciales = datos;
    return credenciales;
  } catch (error) {
    console.error("[push] FIREBASE_SERVICE_ACCOUNT inválida:", error.message);
    credenciales = null;
    return null;
  }
}

function base64url(valor) {
  return Buffer.from(valor).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function configurado() {
  return Boolean(cargarCredenciales());
}

async function obtenerAcceso() {
  const ahora = Math.floor(Date.now() / 1000);
  if (tokenAcceso && ahora < expiraToken - 60) return tokenAcceso;

  const datos = cargarCredenciales();
  if (!datos) return null;

  const cabecera = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const cuerpo = base64url(JSON.stringify({
    iss: datos.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: ahora,
    exp: ahora + 3600,
  }));

  const firmante = crypto.createSign("RSA-SHA256");
  firmante.update(`${cabecera}.${cuerpo}`);
  const firma = base64url(firmante.sign(datos.private_key));
  const jwt = `${cabecera}.${cuerpo}.${firma}`;

  const respuesta = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!respuesta.ok) {
    console.error("[push] no se obtuvo el token:", respuesta.status, (await respuesta.text()).slice(0, 200));
    return null;
  }

  const json = await respuesta.json();
  tokenAcceso = json.access_token;
  expiraToken = ahora + (json.expires_in || 3600);
  return tokenAcceso;
}

/**
 * Envía una notificación a un dispositivo.
 * @returns {Promise<boolean>} true si Firebase la aceptó.
 */
async function enviarPush(token, { titulo, cuerpo, datos = {} }) {
  const datosProyecto = cargarCredenciales();
  if (!datosProyecto || !token) return false;

  const acceso = await obtenerAcceso();
  if (!acceso) return false;

  const mensaje = {
    message: {
      token,
      notification: { title: titulo, body: cuerpo },
      data: Object.fromEntries(Object.entries(datos).map(([clave, valor]) => [clave, String(valor)])),
      android: { priority: "high", notification: { sound: "default" } },
    },
  };

  const respuesta = await fetch(
    `https://fcm.googleapis.com/v1/projects/${datosProyecto.project_id}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${acceso}`, "Content-Type": "application/json" },
      body: JSON.stringify(mensaje),
    },
  );

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    console.error("[push] Firebase rechazó el mensaje:", respuesta.status, detalle.slice(0, 200));
    return false;
  }
  return true;
}

module.exports = { enviarPush, configurado };
