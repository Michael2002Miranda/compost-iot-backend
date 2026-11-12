const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clasificarParametro,
  determinarFase,
  clasificarMedicion,
  generarAlertas,
} = require("../src/domain/clasificacion");

test("PFC: clasifica la temperatura en los rangos del informe", () => {
  assert.equal(clasificarParametro("temperatura", 10).estado, "critico");
  assert.equal(clasificarParametro("temperatura", 18).estado, "advertencia");
  assert.equal(clasificarParametro("temperatura", 30).etiqueta, "Mesófila");
  assert.equal(clasificarParametro("temperatura", 55).etiqueta, "Termófila");
  assert.equal(clasificarParametro("temperatura", 68).estado, "advertencia");
  assert.equal(clasificarParametro("temperatura", 72).estado, "critico");
});

test("PFC: clasifica humedad y pH", () => {
  assert.equal(clasificarParametro("humedad", 35).estado, "critico");
  assert.equal(clasificarParametro("humedad", 60).estado, "optimo");
  assert.equal(clasificarParametro("humedad", 75).estado, "advertencia");
  assert.equal(clasificarParametro("humedad", 85).estado, "critico");

  assert.equal(clasificarParametro("ph", 4.5).estado, "critico");
  assert.equal(clasificarParametro("ph", 5.5).estado, "advertencia");
  assert.equal(clasificarParametro("ph", 7.2).estado, "optimo");
  assert.equal(clasificarParametro("ph", 8.7).estado, "advertencia");
  assert.equal(clasificarParametro("ph", 9.5).estado, "critico");
});

test("PFC: los límites son inclusivos hacia el tramo superior", () => {
  assert.equal(clasificarParametro("temperatura", 20).etiqueta, "Mesófila");
  assert.equal(clasificarParametro("temperatura", 45).etiqueta, "Termófila");
  assert.equal(clasificarParametro("humedad", 40).estado, "advertencia");
  assert.equal(clasificarParametro("ph", 6.0).estado, "optimo");
});

test("PFC: rechaza valores no numéricos o parámetros desconocidos", () => {
  assert.throws(() => clasificarParametro("temperatura", "abc"), /inválido/i);
  assert.throws(() => clasificarParametro("oxigeno", 10), /desconocido/i);
});

test("Fase: se determina por temperatura y se corrobora con humedad y pH", () => {
  assert.equal(determinarFase(55, 60, 7).codigo, "termofila");
  assert.equal(determinarFase(38, 60, 7).codigo, "mesofila_activa");
  assert.equal(determinarFase(28, 60, 7).codigo, "mesofila");
  assert.equal(determinarFase(22, 60, 7).codigo, "enfriamiento");
  assert.equal(determinarFase(18, 60, 7).codigo, "maduracion");

  const seca = determinarFase(55, 30, 7);
  assert.ok(seca.observaciones.some((o) => /humedad baja/i.test(o)));
});

test("Alertas: no se pisan entre sí (regresión del bug original)", () => {
  const { alertas } = generarAlertas({ temperatura: 70, humedad: 30, ph: 6.5 });
  assert.equal(alertas.length, 2);
  assert.deepEqual(
    alertas.map((a) => a.parametro).sort(),
    ["humedad", "temperatura"],
  );
  assert.ok(alertas.every((a) => a.severidad === "critica"));
});

test("Clasificación completa: estado general es el peor parámetro", () => {
  const resultado = clasificarMedicion({ temperatura: 70, humedad: 60, ph: 7 });
  assert.equal(resultado.estado, "critico");
  assert.equal(resultado.fase.codigo, "termofila");
  assert.equal(resultado.parametros.length, 3);

  const optimo = clasificarMedicion({ temperatura: 40, humedad: 60, ph: 7 });
  assert.equal(optimo.estado, "optimo");
  assert.equal(optimo.alertas.length, 0);
});
