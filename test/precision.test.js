const test = require("node:test");
const assert = require("node:assert/strict");

const { calcularPrecision, promedioPrecision } = require("../src/domain/precision");

test("PPFM: aplica la fórmula 100 - (|VM - VR| / VR) * 100", () => {
  // Temperatura: sensor 39.4 °C frente a patrón 40.0 °C -> error relativo 1.5 %
  const resultado = calcularPrecision(39.4, 40.0);
  assert.equal(resultado.error, 0.6);
  assert.equal(resultado.errorRelativo, 1.5);
  assert.equal(resultado.precision, 98.5);
});

test("PPFM: una medición idéntica al patrón da 100 %", () => {
  const resultado = calcularPrecision(60, 60);
  assert.equal(resultado.precision, 100);
  assert.equal(resultado.error, 0);
});

test("PPFM: el error negativo y el positivo dan la misma precisión", () => {
  assert.deepEqual(calcularPrecision(58, 60), calcularPrecision(62, 60));
});

test("PPFM: la precisión nunca baja de 0", () => {
  const resultado = calcularPrecision(0, 10);
  assert.equal(resultado.precision, 0);
});

test("PPFM: sin línea base (VR = 0) no hay precisión relativa", () => {
  const resultado = calcularPrecision(5, 0);
  assert.equal(resultado.precision, null);
  assert.equal(resultado.error, 5);
});

test("PPFM: rechaza valores no numéricos", () => {
  assert.throws(() => calcularPrecision("abc", 40), /numéricos/i);
});

test("PPFM: promedio de una serie de registros", () => {
  const registros = [
    { precision: 98.5 },
    { precision: 97.5 },
    { precision: 100 },
    { precision: null },
  ];
  assert.equal(promedioPrecision(registros), 98.67);
  assert.equal(promedioPrecision([]), null);
});
