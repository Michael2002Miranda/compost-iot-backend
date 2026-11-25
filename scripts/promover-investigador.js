/**
 * Marca una cuenta como investigador del estudio.
 *
 * Uso:
 *   npm run promover -- correo@ejemplo.com
 *
 * El investigador ve las composteras de todos los participantes y puede
 * exportar el estudio completo desde /api/admin/export.csv.
 */
require("dotenv").config();

const pool = require("../src/db");

(async () => {
  const email = String(process.argv[2] || "").trim().toLowerCase();

  if (!email) {
    console.error("Uso: npm run promover -- correo@ejemplo.com");
    process.exit(1);
  }

  try {
    const { rows } = await pool.query(
      "UPDATE usuarios SET rol = 'investigador' WHERE email = $1 RETURNING id, nombre, email, rol",
      [email],
    );

    if (rows.length === 0) {
      console.error(`No existe una cuenta con el correo ${email}. Regístrela primero en la app.`);
      process.exit(1);
    }

    console.log("Cuenta promovida a investigador:");
    console.log(rows[0]);
  } catch (error) {
    console.error("No se pudo actualizar la cuenta:", error.message);
    console.error("Verifique que el backend ya aplicó el esquema (columna usuarios.rol).");
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
