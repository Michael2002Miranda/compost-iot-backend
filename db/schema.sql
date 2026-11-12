-- ============================================================================
-- Esquema de la base de datos — Monitoreo de compostaje IoT (El Porvenir, 2026)
--
-- Ejecutar en Supabase (SQL Editor) o con:
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- El script es idempotente: puede ejecutarse sobre la base que ya tiene la
-- tabla `mediciones` sin perder los registros existentes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Usuarios: cada persona registra su cuenta y ve únicamente sus composteras.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id             SERIAL PRIMARY KEY,
    nombre         TEXT        NOT NULL,
    email          TEXT        NOT NULL UNIQUE,
    password_hash  TEXT        NOT NULL,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Composteras monitoreadas. El grupo distingue la posprueba del grupo control
-- (GC) de la del grupo experimental (GE), tal como exige el diseño cuasi
-- experimental del informe.
-- `codigo` es el identificador que el ESP32 envía en cada lectura.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS composteras (
    id          SERIAL PRIMARY KEY,
    nombre      TEXT        NOT NULL,
    grupo       CHAR(2)     NOT NULL DEFAULT 'GE' CHECK (grupo IN ('GC', 'GE')),
    ubicacion   TEXT,
    activa      BOOLEAN     NOT NULL DEFAULT TRUE,
    creada_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE composteras ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE;
ALTER TABLE composteras ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE composteras ADD COLUMN IF NOT EXISTS creada_en TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_composteras_codigo ON composteras (codigo) WHERE codigo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_composteras_usuario ON composteras (usuario_id);

-- ---------------------------------------------------------------------------
-- Lecturas del ESP32 (variable dependiente: parámetros fisicoquímicos).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mediciones (
    id              BIGSERIAL PRIMARY KEY,
    id_compostera   INTEGER     NOT NULL DEFAULT 1,
    temperatura     NUMERIC(5,2) NOT NULL,
    humedad         NUMERIC(5,2) NOT NULL,
    ph              NUMERIC(4,2) NOT NULL,
    fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Si la tabla ya existía sin estas columnas, agregarlas de forma segura.
ALTER TABLE mediciones ADD COLUMN IF NOT EXISTS id_compostera INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mediciones ADD COLUMN IF NOT EXISTS fecha_hora TIMESTAMPTZ NOT NULL DEFAULT now();
-- Marca de lecturas con pH simulado (el prototipo aún no tiene sensor de pH).
ALTER TABLE mediciones ADD COLUMN IF NOT EXISTS ph_simulado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_mediciones_fecha      ON mediciones (fecha_hora DESC);
CREATE INDEX IF NOT EXISTS idx_mediciones_compostera ON mediciones (id_compostera, fecha_hora DESC);

-- ---------------------------------------------------------------------------
-- Alertas generadas por la API cuando un parámetro sale de rango.
-- Se persisten para poder mostrar el historial en la aplicación.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alertas (
    id              BIGSERIAL PRIMARY KEY,
    id_medicion     BIGINT REFERENCES mediciones(id) ON DELETE CASCADE,
    id_compostera   INTEGER,
    parametro       TEXT        NOT NULL,
    severidad       TEXT        NOT NULL CHECK (severidad IN ('info', 'advertencia', 'critica')),
    mensaje         TEXT        NOT NULL,
    valor           NUMERIC(6,2),
    fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atendida        BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_alertas_pendientes ON alertas (atendida, fecha_hora DESC);

-- ---------------------------------------------------------------------------
-- Indicador PPFM — Precisión de los parámetros fisicoquímicos medidos.
--   PPFM (%) = 100 - (|VM - VR| / VR) * 100
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registros_ppfm (
    id                BIGSERIAL PRIMARY KEY,
    id_compostera     INTEGER     NOT NULL DEFAULT 1,
    parametro         TEXT        NOT NULL CHECK (parametro IN ('temperatura', 'humedad', 'ph')),
    valor_medido      NUMERIC(7,3) NOT NULL,
    valor_referencia  NUMERIC(7,3) NOT NULL,
    precision         NUMERIC(6,2),
    error             NUMERIC(7,3),
    fecha             TIMESTAMPTZ NOT NULL DEFAULT now(),
    observaciones     TEXT
);

CREATE INDEX IF NOT EXISTS idx_ppfm_fecha ON registros_ppfm (fecha DESC);

-- ---------------------------------------------------------------------------
-- Indicador CFC — Calidad física del compost (Bejarano-Meza et al., 2026).
-- Cada criterio se puntúa 0, 1 o 2; el puntaje total va de 0 a 8.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registros_cfc (
    id              BIGSERIAL PRIMARY KEY,
    id_compostera   INTEGER     NOT NULL DEFAULT 1,
    color           TEXT        NOT NULL CHECK (color IN ('marron_oscuro', 'marron_claro', 'negro_verdoso')),
    aroma           TEXT        NOT NULL CHECK (aroma IN ('tierra_humeda', 'neutro', 'putrefacto')),
    textura         TEXT        NOT NULL CHECK (textura IN ('suelta_granulada', 'grumosa', 'compacta_pastosa')),
    humedad         TEXT        NOT NULL CHECK (humedad IN ('humedece_sin_gotear', 'seca', 'gotea')),
    puntaje         SMALLINT    NOT NULL CHECK (puntaje BETWEEN 0 AND 8),
    maduro          BOOLEAN     NOT NULL,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT now(),
    observaciones   TEXT
);

CREATE INDEX IF NOT EXISTS idx_cfc_fecha ON registros_cfc (fecha DESC);

-- ---------------------------------------------------------------------------
-- Indicador de usabilidad (SUS) — variable independiente, dimensión usabilidad.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evaluaciones_sus (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    evaluador   TEXT,
    respuestas  JSONB       NOT NULL,
    puntaje     NUMERIC(5,2) NOT NULL,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indicador de funcionalidad — variable independiente, dimensión funcionalidad.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pruebas_funcionalidad (
    id          BIGSERIAL PRIMARY KEY,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    caso        TEXT        NOT NULL,
    descripcion TEXT,
    aprobado    BOOLEAN     NOT NULL,
    observacion TEXT,
    fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Vista de apoyo para el análisis: una fila por medición con su grupo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_mediciones_grupo AS
SELECT m.id,
       m.id_compostera,
       c.grupo,
       c.usuario_id,
       m.temperatura,
       m.humedad,
       m.ph,
       m.fecha_hora
  FROM mediciones m
  LEFT JOIN composteras c ON c.id = m.id_compostera;
