-- ============================================================================
-- AVISA — Migración aditiva 43: nudos críticos fieles a la fuente
--
-- Fecha: 2026-11-24
-- Estado: PROPUESTA, no ejecutada. Requiere revisión de OAIPCS.
--
-- POR QUÉ EXISTE (hallazgo del dry-run del importador)
-- La migración 41 modeló core.caso_nudo_critico con dos índices únicos:
--     (caso_id, compromiso_id, semana_desde)
--     (caso_id, semana_desde)                 cuando compromiso_id es NULL
-- es decir, «un nudo por caso y semana». El Excel no funciona así: los nudos
-- se escriben a nivel de FILA (una fila por hito), de modo que un mismo caso
-- puede tener varios nudos en la misma semana. El dry-run del 2026-11-24
-- encontró 20 colisiones reales y 24 celdas repetidas idénticas.
--
-- Además `descripcion` era NOT NULL, pero el Excel trae 66 celdas de
-- «Seguimiento» sin «Nudo» (el par está descuadrado en origen). Rechazarlas
-- pierde contenido real; forzar un texto sería inventar dato.
--
-- Reglas: ADITIVA, IDEMPOTENTE, PostgreSQL 16, esquema `core`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Un nudo puede no tener descripción si tiene seguimiento (y viceversa).
--    Lo que no se admite es una fila completamente vacía.
-- ============================================================================
ALTER TABLE core.caso_nudo_critico ALTER COLUMN descripcion DROP NOT NULL;

ALTER TABLE core.caso_nudo_critico
    DROP CONSTRAINT IF EXISTS chk_caso_nudo_critico_contenido;
ALTER TABLE core.caso_nudo_critico
    ADD CONSTRAINT chk_caso_nudo_critico_contenido
    CHECK (descripcion IS NOT NULL OR seguimiento IS NOT NULL);

COMMENT ON COLUMN core.caso_nudo_critico.descripcion IS
    'El nudo: el obstáculo o cuello de botella observado en el periodo. NULL cuando la matriz trae sólo el seguimiento (66 celdas en el Excel 2026). Nunca se rellena con texto inventado.';
COMMENT ON CONSTRAINT chk_caso_nudo_critico_contenido ON core.caso_nudo_critico IS
    'Una fila de nudo debe aportar al menos descripción o seguimiento.';

-- ============================================================================
-- 2. Se retiran los índices que imponían «un nudo por semana».
--    La fuente admite varios nudos por caso y semana; la interfaz los agrupa.
-- ============================================================================
DROP INDEX IF EXISTS core.uq_caso_nudo_critico_compromiso;
DROP INDEX IF EXISTS core.uq_caso_nudo_critico_sin_compromiso;

-- ============================================================================
-- 3. Identidad estable por celda de origen.
--    La matriz no trae identificadores: la celda (fila Excel, columna del par
--    semanal) es la unidad atómica. `origen_ref` la fija, de modo que
--    reimportar actualiza en lugar de duplicar, incluso si el equipo mueve el
--    texto entre columnas.
-- ============================================================================
ALTER TABLE core.caso_nudo_critico
    ADD COLUMN IF NOT EXISTS origen_ref varchar(40);

COMMENT ON COLUMN core.caso_nudo_critico.origen_ref IS
    'Identificador determinista de la celda de origen en la matriz (p. ej. MATRIZ-N0002-C22). Clave de idempotencia del importador. NULL en captura manual.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_caso_nudo_critico_origen
    ON core.caso_nudo_critico (origen_ref)
    WHERE origen_ref IS NOT NULL;

-- Red de seguridad: el mismo texto exacto no se guarda dos veces para el
-- mismo caso, semana y compromiso, aunque venga de dos celdas distintas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_caso_nudo_critico_dedupe
    ON core.caso_nudo_critico (
        caso_id,
        COALESCE(compromiso_id, '00000000-0000-0000-0000-000000000000'::uuid),
        semana_desde,
        COALESCE(descripcion, ''),
        COALESCE(seguimiento, '')
    );

COMMENT ON INDEX core.uq_caso_nudo_critico_dedupe IS
    'Evita duplicar el mismo nudo/seguimiento literal cuando el equipo copia la misma celda en dos semanas o la reimportación repite la fila.';

-- ============================================================================
-- Registro de la migración
-- ============================================================================
INSERT INTO core.migracion_log (clave) VALUES ('43_nudos_criticos_fieles')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
