const test = require("node:test");
const assert = require("node:assert/strict");

const { migrar } = require("../src/migrar");

test("migrar aplica el esquema completo en una sola consulta", async () => {
  const consultas = [];
  const pool = { query: async (sql) => { consultas.push(sql); return { rows: [] }; } };
  const silencioso = { log() {}, error() {} };

  const aplicado = await migrar(pool, { registrar: silencioso });

  assert.equal(aplicado, true);
  assert.equal(consultas.length, 1);
  assert.match(consultas[0], /CREATE TABLE IF NOT EXISTS usuarios/);
  assert.match(consultas[0], /CREATE TABLE IF NOT EXISTS composteras/);
  assert.match(consultas[0], /CREATE TABLE IF NOT EXISTS alertas/);
  assert.match(consultas[0], /ALTER TABLE mediciones ADD COLUMN IF NOT EXISTS ph_simulado/);
});

test("migrar respeta AUTO_MIGRAR=false", async () => {
  process.env.AUTO_MIGRAR = "false";
  try {
    const pool = { query: async () => { throw new Error("no debería consultarse"); } };
    const aplicado = await migrar(pool, { registrar: { log() {}, error() {} } });
    assert.equal(aplicado, false);
  } finally {
    delete process.env.AUTO_MIGRAR;
  }
});
