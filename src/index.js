require("dotenv").config();

const { crearApp } = require("./app");
const { migrar } = require("./migrar");
const pool = require("./db");

const PORT = Number(process.env.PORT) || 3000;
const app = crearApp(pool);

const servidor = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API de monitoreo de compostaje escuchando en http://0.0.0.0:${PORT}`);

  // Verifica/crea el esquema sin bloquear el arranque: si la base no responde,
  // el servicio igual queda en pie y /health lo reporta.
  migrar(pool).catch((error) => {
    console.error("[db] no se pudo aplicar el esquema:", error.message);
  });
});

// Cierre ordenado (Render y Docker envían SIGTERM al reiniciar).
function cerrar(senal) {
  console.log(`\n${senal} recibida: cerrando conexiones...`);
  servidor.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => cerrar("SIGTERM"));
process.on("SIGINT", () => cerrar("SIGINT"));

process.on("unhandledRejection", (error) => {
  console.error("[unhandledRejection]", error);
});
