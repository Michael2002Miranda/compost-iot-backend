/**
 * Indicador PPFM — Precisión de los parámetros fisicoquímicos medidos.
 *
 * Fórmula adoptada en el informe (Anexo 1, ficha PPFM):
 *
 *      PPFM (%) = 100 − (|VM − VR| / VR) × 100
 *
 * donde VM es el valor medido por el sensor y VR el valor del instrumento
 * patrón calibrado. El resultado se acota al intervalo [0, 100].
 */

function redondear(valor, decimales = 2) {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

/**
 * @param {number} valorMedido   Lectura del sensor (VM)
 * @param {number} valorReferencia Lectura del instrumento patrón (VR)
 * @returns {{precision:number|null, error:number|null, errorRelativo:number|null}}
 */
function calcularPrecision(valorMedido, valorReferencia) {
  const vm = Number(valorMedido);
  const vr = Number(valorReferencia);

  if (!Number.isFinite(vm) || !Number.isFinite(vr)) {
    throw new Error("Los valores medido y de referencia deben ser numéricos");
  }
  if (vr === 0) {
    // Sin línea base no es posible expresar un error relativo.
    return { precision: null, error: Math.abs(vm), errorRelativo: null };
  }

  const error = Math.abs(vm - vr);
  const errorRelativo = error / Math.abs(vr);
  const precision = Math.min(100, Math.max(0, 100 - errorRelativo * 100));

  return {
    precision: redondear(precision),
    error: redondear(error),
    errorRelativo: redondear(errorRelativo * 100),
  };
}

/** Promedio de precisión de una lista de registros. */
function promedioPrecision(registros) {
  const validos = registros
    .map((r) => r.precision)
    .filter((valor) => valor !== null && valor !== undefined && valor !== "")
    .map((valor) => Number(valor))
    .filter((n) => Number.isFinite(n));
  if (validos.length === 0) return null;
  return redondear(validos.reduce((a, b) => a + b, 0) / validos.length);
}

module.exports = { calcularPrecision, promedioPrecision, redondear };
