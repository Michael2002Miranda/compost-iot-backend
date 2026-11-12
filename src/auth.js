/**
 * Autenticación sin dependencias externas.
 *
 *  - Contraseñas: scrypt (nativo de Node) con sal aleatoria.
 *  - Sesiones: token firmado con HMAC-SHA256 (formato tipo JWT simplificado).
 *
 * Se evita bcrypt/jsonwebtoken a propósito: no requieren compilación nativa en
 * Render y reducen las dependencias del proyecto para la sustentación.
 */

const crypto = require("crypto");

const SCRYPT_KEYLEN = 64;
const DURACION_TOKEN_SEGUNDOS = 60 * 60 * 24 * 7; // 7 días

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function desdeBase64url(texto) {
  return Buffer.from(texto.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hashPassword(password) {
  if (typeof password !== "string" || password.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres");
  }
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize("NFKC"), sal, SCRYPT_KEYLEN);
  return `scrypt$${sal.toString("hex")}$${hash.toString("hex")}`;
}

function verificarPassword(password, almacenado) {
  try {
    const [algoritmo, salHex, hashHex] = String(almacenado).split("$");
    if (algoritmo !== "scrypt" || !salHex || !hashHex) return false;
    const sal = Buffer.from(salHex, "hex");
    const esperado = Buffer.from(hashHex, "hex");
    const calculado = crypto.scryptSync(String(password).normalize("NFKC"), sal, esperado.length);
    return crypto.timingSafeEqual(esperado, calculado);
  } catch {
    return false;
  }
}

function secreto() {
  const secretoConfigurado = process.env.JWT_SECRET;
  if (!secretoConfigurado) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET es obligatorio en producción");
    }
    return "secreto-solo-para-desarrollo-cambiar-en-produccion";
  }
  return secretoConfigurado;
}

function firmarToken(usuario) {
  const ahora = Math.floor(Date.now() / 1000);
  const payload = { sub: usuario.id, email: usuario.email, iat: ahora, exp: ahora + DURACION_TOKEN_SEGUNDOS };
  const cuerpo = base64url(JSON.stringify(payload));
  const firma = crypto.createHmac("sha256", secreto()).update(cuerpo).digest();
  return `${cuerpo}.${base64url(firma)}`;
}

function verificarToken(token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 2) return null;

  const [cuerpo, firmaRecibida] = partes;
  const firmaEsperada = crypto.createHmac("sha256", secreto()).update(cuerpo).digest();
  const recibida = desdeBase64url(firmaRecibida);

  if (recibida.length !== firmaEsperada.length) return null;
  if (!crypto.timingSafeEqual(recibida, firmaEsperada)) return null;

  try {
    const payload = JSON.parse(desdeBase64url(cuerpo).toString("utf8"));
    if (!payload.sub || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Middleware de Express: exige `Authorization: Bearer <token>` y deja el usuario
 * en `req.usuario`.
 */
function crearMiddlewareAutenticacion(pool) {
  return async function autenticar(req, res, next) {
    try {
      const cabecera = String(req.get("authorization") || "");
      const [tipo, token] = cabecera.split(" ");
      if (tipo !== "Bearer" || !token) {
        return res.status(401).json({ status: "error", mensaje: "Se requiere iniciar sesión" });
      }

      const payload = verificarToken(token);
      if (!payload) {
        return res.status(401).json({ status: "error", mensaje: "Sesión expirada, vuelva a iniciar sesión" });
      }

      const { rows } = await pool.query(
        "SELECT id, nombre, email FROM usuarios WHERE id = $1",
        [payload.sub],
      );
      if (rows.length === 0) {
        return res.status(401).json({ status: "error", mensaje: "Usuario no encontrado" });
      }

      req.usuario = rows[0];
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  hashPassword,
  verificarPassword,
  firmarToken,
  verificarToken,
  crearMiddlewareAutenticacion,
  DURACION_TOKEN_SEGUNDOS,
};
