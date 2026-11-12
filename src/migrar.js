const fs = require("fs");
const path = require("path");

/**
 * Aplica `db/schema.sql` al arrancar el servicio.
 *
 * El script es idempotente, así que puede ejecutarse en cada despliegue: crea las
 * tablas que falten y agrega las columnas nuevas sin borrar datos. De esta forma
 * el backend queda operativo sin tener que entrar manualmente a Supabase.
 *
 * Se puede desactivar con AUTO_MIGRAR=false.
 */
async function migrar(pool, { registrar = console } = {}) {
  if (String(process.env.AUTO_MIGRAR).toLowerCase() === "false") {
    registrar.log("[db] migración automática desactivada (AUTO_MIGRAR=false)");
    return false;
  }

  const archivo = path.join(__dirname, "..", "db", "schema.sql");
  const sql = fs.readFileSync(archivo, "utf8");
  await pool.query(sql);
  registrar.log("[db] esquema verificado y actualizado");
  return true;
}

module.exports = { migrar };
