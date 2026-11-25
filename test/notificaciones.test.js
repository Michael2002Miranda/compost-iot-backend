const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { crearApp } = require("../src/app");
const { firmarToken } = require("../src/auth");

const USUARIO = { id: 1, nombre: "Ana Torres", email: "ana@upao.edu.pe", rol: "usuario" };
const TOKEN_FCM = "dGVzdC10b2tlbi1kZS1ub3RpZmljYWNpb25lcy1mYWtlLTEyMzQ1Ng";

function crearPoolFalso() {
  const consultas = [];
  return {
    consultas,
    async query(sql, params = []) {
      const consulta = sql.replace(/\s+/g, " ").trim();
      consultas.push({ consulta, params });

      if (consulta.startsWith("SELECT id, nombre, email, rol FROM usuarios")) {
        return { rows: params[0] === USUARIO.id ? [USUARIO] : [] };
      }
      return { rows: [] };
    },
  };
}

async function conServidor(pool, fn) {
  const app = crearApp(pool, { registrar: { log() {}, error() {} } });
  const servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
}

const autorizacion = () => ({ Authorization: `Bearer ${firmarToken(USUARIO)}` });

test("El token de notificaciones se guarda en la cuenta", async () => {
  const pool = crearPoolFalso();

  await conServidor(pool, async (base) => {
    const res = await fetch(`${base}/api/notificaciones/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...autorizacion() },
      body: JSON.stringify({ token: TOKEN_FCM }),
    });

    assert.equal(res.status, 200);
    const cuerpo = await res.json();
    assert.equal(cuerpo.status, "success");

    const actualizacion = pool.consultas.find((c) => c.consulta.startsWith("UPDATE usuarios SET fcm_token"));
    assert.ok(actualizacion, "debe guardar el token");
    assert.equal(actualizacion.params[0], TOKEN_FCM);
    assert.equal(actualizacion.params[1], USUARIO.id);
  });
});

test("El token de notificaciones exige sesión", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/notificaciones/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN_FCM }),
    });
    assert.equal(res.status, 401);
  });
});

test("El token de notificaciones rechaza valores inválidos", async () => {
  await conServidor(crearPoolFalso(), async (base) => {
    const res = await fetch(`${base}/api/notificaciones/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...autorizacion() },
      body: JSON.stringify({ token: "corto" }),
    });
    assert.equal(res.status, 400);
  });
});
