/**
 * Dominio del monitoreo de compostaje.
 *
 * Centraliza los umbrales y las reglas que la aplicación móvil también replica en
 * Dart (`lib/domain/clasificacion.dart`). Si se cambia un umbral aquí, debe
 * cambiarse también allí: la app y la API deben reportar la misma clasificación.
 *
 * Referencias de los rangos (ver informe, §2.4 y §3.4):
 *  - Putri et al. (2025): temperatura, humedad y pH para identificar la fase.
 *  - Naser et al. (2025): precisión frente a instrumento patrón.
 *  - Bejarano-Meza et al. (2026): criterios de calidad física del compost.
 */

const PARAMETROS = {
  temperatura: {
    etiqueta: "Temperatura",
    unidad: "°C",
    minimo: -10,
    maximo: 120,
    tramos: [
      { hasta: 15, estado: "critico", etiqueta: "Baja", mensaje: "Temperatura muy baja: la actividad microbiana se detiene." },
      { hasta: 20, estado: "advertencia", etiqueta: "Fría", mensaje: "Temperatura por debajo del rango mesófilo." },
      { hasta: 45, estado: "optimo", etiqueta: "Mesófila", mensaje: "Rango mesófilo: descomposición activa." },
      { hasta: 65, estado: "optimo", etiqueta: "Termófila", mensaje: "Rango termófilo: higienización del material." },
      { hasta: 70, estado: "advertencia", etiqueta: "Alta", mensaje: "Supera el umbral termófilo: riesgo de pérdida de nitrógeno." },
      { hasta: Infinity, estado: "critico", etiqueta: "Excesiva", mensaje: "Temperatura crítica: riesgo de combustión espontánea." },
    ],
  },
  humedad: {
    etiqueta: "Humedad",
    unidad: "%",
    minimo: 0,
    maximo: 100,
    tramos: [
      { hasta: 40, estado: "critico", etiqueta: "Muy seca", mensaje: "Compost demasiado seco: la descomposición se frena." },
      { hasta: 50, estado: "advertencia", etiqueta: "Baja", mensaje: "Humedad por debajo del rango recomendado." },
      { hasta: 70, estado: "optimo", etiqueta: "Óptima", mensaje: "Humedad adecuada para el proceso." },
      { hasta: 80, estado: "advertencia", etiqueta: "Alta", mensaje: "Exceso de humedad: riesgo de anaerobiosis." },
      { hasta: Infinity, estado: "critico", etiqueta: "Encharcada", mensaje: "Humedad crítica: el material se compacta y genera lixiviados." },
    ],
  },
  ph: {
    etiqueta: "pH",
    unidad: "",
    minimo: 0,
    maximo: 14,
    tramos: [
      { hasta: 5.0, estado: "critico", etiqueta: "Muy ácido", mensaje: "pH crítico: fermentación ácida." },
      { hasta: 6.0, estado: "advertencia", etiqueta: "Ácido", mensaje: "Fase de acidificación; vigilar la aireación." },
      { hasta: 8.5, estado: "optimo", etiqueta: "Neutro", mensaje: "pH dentro del rango recomendado." },
      { hasta: 9.0, estado: "advertencia", etiqueta: "Alcalino", mensaje: "pH alcalino: posible pérdida de nitrógeno por amoniaco." },
      { hasta: Infinity, estado: "critico", etiqueta: "Muy alcalino", mensaje: "pH crítico: revisar la mezcla y la aireación." },
    ],
  },
};

const SEVERIDAD = { optimo: "info", advertencia: "advertencia", critico: "critica" };

const PESO_ESTADO = { optimo: 0, advertencia: 1, critico: 2 };

/**
 * Clasifica un parámetro fisicoquímico dentro de sus rangos.
 * @returns {{parametro:string, valor:number, estado:string, etiqueta:string, mensaje:string, rango:string}}
 */
function clasificarParametro(parametro, valor) {
  const definicion = PARAMETROS[parametro];
  if (!definicion) throw new Error(`Parámetro desconocido: ${parametro}`);
  const numero = Number(valor);
  if (!Number.isFinite(numero)) throw new Error(`Valor inválido para ${parametro}: ${valor}`);

  const tramo = definicion.tramos.find((t) => numero < t.hasta) || definicion.tramos[definicion.tramos.length - 1];
  const limiteInferior = tramo === definicion.tramos[0] ? definicion.minimo : definicion.tramos[definicion.tramos.indexOf(tramo) - 1].hasta;

  return {
    parametro,
    valor: numero,
    estado: tramo.estado,
    etiqueta: tramo.etiqueta,
    mensaje: tramo.mensaje,
    rango: `${limiteInferior} – ${tramo.hasta === Infinity ? "∞" : tramo.hasta}`,
    unidad: definicion.unidad,
  };
}

/**
 * Determina la fase del compostaje a partir de la temperatura y la corrobora con
 * humedad y pH, tal como se plantea en la ficha de observación del PFC.
 */
function determinarFase(temperatura, humedad, ph) {
  const t = Number(temperatura);
  const h = Number(humedad);
  const p = Number(ph);

  let fase;
  let codigo;
  let descripcion;

  if (t >= 45) {
    codigo = "termofila";
    fase = "Fase termófila";
    descripcion = "El material alcanza temperaturas de higienización; se eliminan patógenos y semillas.";
  } else if (t >= 35) {
    codigo = "mesofila_activa";
    fase = "Fase mesófila activa";
    descripcion = "Máxima actividad microbiana y consumo de oxígeno.";
  } else if (t >= 25) {
    codigo = "mesofila";
    fase = "Fase mesófila";
    descripcion = "Descomposición constante de la materia orgánica.";
  } else if (t >= 20) {
    codigo = "enfriamiento";
    fase = "Fase de enfriamiento";
    descripcion = "El proceso pierde temperatura y se acerca a la estabilización.";
  } else {
    codigo = "maduracion";
    fase = "Maduración";
    descripcion = "Baja actividad biológica; el compost tiende a estabilizarse.";
  }

  const observaciones = [];
  if (h < 40) observaciones.push("La humedad baja puede detener la fase: humedecer y voltear.");
  if (h > 80) observaciones.push("El exceso de humedad favorece condiciones anaerobias: voltear y agregar material seco.");
  if (p < 5.5) observaciones.push("pH ácido: incorporar material rico en carbono y airear.");
  if (p > 8.5) observaciones.push("pH alcalino: revisar la proporción de restos y la aireación.");

  return { codigo, fase, descripcion, observaciones };
}

/** Devuelve el estado más desfavorable entre los tres parámetros. */
function estadoGeneral(clasificaciones) {
  return clasificaciones.reduce(
    (peor, c) => (PESO_ESTADO[c.estado] > PESO_ESTADO[peor] ? c.estado : peor),
    "optimo",
  );
}

/**
 * Genera las alertas de una lectura. A diferencia de la versión anterior, devuelve
 * TODAS las alertas (no se pisan entre sí) para poder persistirlas y mostrarlas.
 */
function generarAlertas(medicion) {
  const { temperatura, humedad, ph } = medicion;
  const clasificaciones = [
    clasificarParametro("temperatura", temperatura),
    clasificarParametro("humedad", humedad),
    clasificarParametro("ph", ph),
  ];

  const alertas = clasificaciones
    .filter((c) => c.estado !== "optimo")
    .map((c) => ({
      parametro: c.parametro,
      severidad: SEVERIDAD[c.estado],
      mensaje: c.mensaje,
      valor: c.valor,
      unidad: c.unidad,
      rango: c.rango,
    }));

  return { clasificaciones, alertas };
}

/** Clasificación completa de una medición, tal como la consume la app. */
function clasificarMedicion(medicion) {
  const { clasificaciones, alertas } = generarAlertas(medicion);
  const fase = determinarFase(medicion.temperatura, medicion.humedad, medicion.ph);

  return {
    fase,
    estado: estadoGeneral(clasificaciones),
    parametros: clasificaciones,
    alertas,
  };
}

module.exports = {
  PARAMETROS,
  clasificarParametro,
  determinarFase,
  clasificarMedicion,
  generarAlertas,
  estadoGeneral,
};
