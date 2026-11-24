-- ============================================================================
-- AVISA — Migración aditiva 42: reuniones sin caso y señales de la matriz
--
-- Fecha: 2026-11-24
-- Estado: PROPUESTA, no ejecutada. Requiere revisión de OAIPCS.
--
-- POR QUÉ EXISTE
-- La hoja «Seguimiento de Reuniones» de la matriz del equipo trae 46 reuniones.
-- Ninguna indica el caso al que pertenece (no existe esa columna) y 28 de ellas
-- ni siquiera traen tipo, sector o responsable. Hoy `core.reuniones_dialogo`
-- exige `caso_id` y `convocante_unidad_id`, así que esas 46 reuniones no se
-- pueden cargar: el esquema no admite una reunión que no sea de un caso.
--
-- Además la matriz registra cuatro señales booleanas por reunión (Asistencia,
-- AM, RELATORIA, PUBLICACIÓN / NOTA) que el esquema no tenía dónde guardar.
--
-- Reglas: ADITIVA, IDEMPOTENTE, PostgreSQL 16, esquema `core`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Una reunión puede existir sin caso y sin unidad convocante conocida.
--    El dato ausente se declara: si no se sabe a qué caso pertenece, `caso_id`
--    queda NULL y la interfaz la muestra en «Reuniones sin caso».
-- ============================================================================
ALTER TABLE core.reuniones_dialogo ALTER COLUMN caso_id           DROP NOT NULL;
ALTER TABLE core.reuniones_dialogo ALTER COLUMN convocante_unidad_id DROP NOT NULL;

COMMENT ON COLUMN core.reuniones_dialogo.caso_id IS
    'Caso al que pertenece la reunión. NULL cuando la reunión es intersectorial o de coordinación y la matriz no la vincula a un caso (28 de 46 filas del Excel 2026).';
COMMENT ON COLUMN core.reuniones_dialogo.convocante_unidad_id IS
    'Unidad orgánica que convoca. NULL cuando la matriz no lo declara.';

-- ============================================================================
-- 2. Señales booleanas de la matriz
--    Columnas I..L del Excel: «Asistencia», «AM», «RELATORIA», «PUBLICACIÓN /
--    NOTA». No son el documento: son la marca de que ese entregable existe.
--    El documento en sí vive en core.documentos (reunion_id + tipo_id).
-- ============================================================================
ALTER TABLE core.reuniones_dialogo
    ADD COLUMN IF NOT EXISTS asistencia_registrada   boolean,
    ADD COLUMN IF NOT EXISTS acta_am                 boolean,
    ADD COLUMN IF NOT EXISTS relatoria_registrada    boolean,
    ADD COLUMN IF NOT EXISTS publicacion_registrada  boolean,
    ADD COLUMN IF NOT EXISTS region_texto            varchar(80),
    ADD COLUMN IF NOT EXISTS codigo_legado           varchar(60);

COMMENT ON COLUMN core.reuniones_dialogo.asistencia_registrada IS
    'Marca de la matriz (col. I): se registró la asistencia. No implica que el documento esté cargado.';
COMMENT ON COLUMN core.reuniones_dialogo.acta_am IS
    'Marca de la matriz (col. J): existe acta o ayuda memoria de la reunión.';
COMMENT ON COLUMN core.reuniones_dialogo.relatoria_registrada IS
    'Marca de la matriz (col. K): existe relatoría.';
COMMENT ON COLUMN core.reuniones_dialogo.publicacion_registrada IS
    'Marca de la matriz (col. L): existe publicación o nota.';
COMMENT ON COLUMN core.reuniones_dialogo.region_texto IS
    'Departamento o ámbito tal como lo escribe la matriz (p. ej. «Lima Metropolitana», «Nacional», «Macrosur»). Texto libre para no forzar una equivalencia que la fuente no da.';
COMMENT ON COLUMN core.reuniones_dialogo.codigo_legado IS
    'Identificador determinista de la fila de origen en la matriz (p. ej. MATRIZ-RR-0021). Hace idempotente la reimportación de una hoja que no trae códigos propios.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_reuniones_dialogo_codigo_legado
    ON core.reuniones_dialogo (codigo_legado)
    WHERE codigo_legado IS NOT NULL;

-- ============================================================================
-- 3. Alertas: identificador de origen para reimportar sin duplicar.
--    La hoja «Seguimiento de Alertas» sí trae código (RR-2026-24) y ya se usa
--    como codigo_alerta; se conserva además en codigo_legado para no depender
--    de que el equipo respete el formato.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_alertas_tempranas_codigo_alerta
    ON core.alertas_tempranas (codigo_alerta)
    WHERE anulado_en IS NULL;

COMMENT ON INDEX core.uq_alertas_tempranas_codigo_alerta IS
    'Una alerta vigente no puede repetir código: es la clave de idempotencia del importador de la matriz.';

COMMIT;
