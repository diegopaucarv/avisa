-- ============================================================================
-- AVISA — Migración 54: enlace del tablero de análisis (Canva) por caso
--
-- POR QUÉ EXISTE
--   La vista previa del caso y el expediente ofrecen un acceso «Caso de
--   análisis (Canva)». El dato no existía en `core.casos`: sólo había la
--   descripción y el resumen. Esta migración agrega la columna que guarda la
--   URL del tablero, que se pega desde la interfaz.
--
-- REGLAS
--   * ADITIVA: una columna anulable. Los casos existentes quedan con `null`,
--     que la interfaz muestra como «Vacío».
--   * IDEMPOTENTE: `ADD COLUMN IF NOT EXISTS`.
--   * Sin índice: la URL se lee con la fila del caso y nunca se filtra por
--     ella.
-- ============================================================================

BEGIN;

ALTER TABLE core.casos
  ADD COLUMN IF NOT EXISTS enlace_analisis varchar(2048);

COMMENT ON COLUMN core.casos.enlace_analisis IS
  'URL del tablero de análisis del caso (Canva). NULL = sin declarar.';

INSERT INTO core.migracion_log (clave)
VALUES ('54_enlace_analisis_caso_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
