const fs = require("fs");
const path = require("path");

/**
 * Aplica `db/schema.sql` al arrancar el servicio.
 *
 * El script es idempotente, así que puede ejecutarse en cada despliegue: crea las
 * tablas que falten y agrega las columnas nuevas sin borrar datos. De esta forma
 * el backend queda operativo sin tener que entrar manualmente a Supabase.
 *
 * Si la base no responde (por ejemplo, porque Supabase pausó el proyecto por
 * inactividad), se reintenta en segundo plano con espera creciente: cuando la
 * base vuelve, el esquema se aplica solo, sin reiniciar el servicio.
 *
 * Se puede desactivar con AUTO_MIGRAR=false.
 */
async function promoverAdministradores(pool, { registrar = console } = {}) {
  const correos = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((correo) => correo.trim().toLowerCase())
    .filter(Boolean);

  if (correos.length === 0) return 0;

  const { rowCount } = await pool.query(
    "UPDATE usuarios SET rol = 'investigador' WHERE lower(email) = ANY($1::text[]) AND rol <> 'investigador'",
    [correos],
  );

  if (rowCount > 0) {
    registrar.log(`[db] ${rowCount} cuenta(s) marcadas como investigador`);
  }
  return rowCount;
}

async function migrar(pool, { registrar = console, reintentar = true, intento = 1 } = {}) {
  if (String(process.env.AUTO_MIGRAR).toLowerCase() === "false") {
    registrar.log("[db] migración automática desactivada (AUTO_MIGRAR=false)");
    return false;
  }

  const archivo = path.join(__dirname, "..", "db", "schema.sql");
  const sql = fs.readFileSync(archivo, "utf8");

  try {
    await pool.query(sql);
    await promoverAdministradores(pool, { registrar });
    registrar.log("[db] esquema verificado y actualizado");
    return true;
  } catch (error) {
    registrar.error(
      `[db] no se pudo aplicar el esquema (intento ${intento}): ${error.message}`,
    );

    // Reintento en segundo plano: la base puede estar pausada o arrancando.
    if (reintentar && intento < 20) {
      const espera = Math.min(60000 * intento, 300000);
      const temporizador = setTimeout(() => {
        migrar(pool, { registrar, reintentar, intento: intento + 1 }).catch(() => {});
      }, espera);
      if (typeof temporizador.unref === "function") temporizador.unref();
      registrar.log(`[db] nuevo intento en ${Math.round(espera / 1000)} s`);
    }

    throw error;
  }
}

module.exports = { migrar, promoverAdministradores };
