require("dotenv").config();
const { Pool } = require("pg");

/**
 * Conexión a PostgreSQL (Supabase).
 *
 * Supabase exige SSL; para una base local se puede desactivar con DB_SSL=false.
 */
const usarSsl = process.env.DB_SSL !== "false";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: usarSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error("[pg] error inesperado en el pool:", error.message);
});

module.exports = pool;
