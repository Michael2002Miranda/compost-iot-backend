const test = require("node:test");
const assert = require("node:assert/strict");

const { migrar, promoverAdministradores } = require("../src/migrar");

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

test("promoverAdministradores marca los correos de ADMIN_EMAILS", async () => {
  process.env.ADMIN_EMAILS = "jefe@upao.edu.pe, Otro@UPAO.edu.pe";
  try {
    const consultas = [];
    const pool = {
      query: async (sql, params) => {
        consultas.push({ sql, params });
        return { rowCount: 2 };
      },
    };

    const total = await promoverAdministradores(pool, { registrar: { log() {}, error() {} } });

    assert.equal(total, 2);
    assert.match(consultas[0].sql, /SET rol = 'investigador'/);
    assert.deepEqual(consultas[0].params[0], ["jefe@upao.edu.pe", "otro@upao.edu.pe"]);
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
});

test("sin ADMIN_EMAILS no se consulta la base", async () => {
  const pool = { query: async () => { throw new Error("no debería consultarse"); } };
  const total = await promoverAdministradores(pool, { registrar: { log() {}, error() {} } });
  assert.equal(total, 0);
});

test("si el esquema falla se informa y no se reintenta cuando se pide", async () => {
  const pool = { query: async () => { throw new Error("base pausada"); } };
  await assert.rejects(
    migrar(pool, { registrar: { log() {}, error() {} }, reintentar: false }),
    /base pausada/,
  );
});
