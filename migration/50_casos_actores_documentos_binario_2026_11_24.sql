-- ============================================================================
-- AVISA — Migración aditiva 50: vínculos de actores con vigencia y binarios de
-- documento
--
-- POR QUÉ EXISTE
--   * La ficha del caso necesita dar de alta y de baja actores sin borrar
--     historial. `core.casos_actores` sólo tenía (caso_id, actor_id, posición,
--     influencia) y exigía posición e influencia en el INSERT, que no siempre
--     se conocen al vincular.
--   * El visor de documentos y el versionado necesitan el binario en la fila,
--     igual que `core.medios` y `core.documento_version`. `core.documentos`
--     sólo guardaba rutas (`url_pdf`, `url_lista`, `url_foto`), que apuntan a
--     archivos que no siempre existen.
--
-- REGLAS
--   * ADITIVA: no elimina, renombra ni reordena nada existente.
--   * IDEMPOTENTE: IF NOT EXISTS / IF EXISTS en todo.
--   * No siembra datos de negocio.
--   * PostgreSQL 16+, esquema `core`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. core.casos_actores: rol en el caso, vigencia y baja lógica
-- ============================================================================
ALTER TABLE core.casos_actores
    ADD COLUMN IF NOT EXISTS rol_en_caso        varchar(120),
    ADD COLUMN IF NOT EXISTS vigente_desde      date,
    ADD COLUMN IF NOT EXISTS vigente_hasta      date,
    ADD COLUMN IF NOT EXISTS anulado_en         timestamptz,
    ADD COLUMN IF NOT EXISTS anulado_por        uuid,
    ADD COLUMN IF NOT EXISTS motivo_anulacion   text,
    ADD COLUMN IF NOT EXISTS created_at         timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by         uuid;

-- El vínculo puede declararse sin posición ni influencia todavía; la ficha las
-- completa después. La baja es lógica: la fila nunca se borra.
ALTER TABLE core.casos_actores ALTER COLUMN nivel_influencia DROP NOT NULL;
ALTER TABLE core.casos_actores ALTER COLUMN posicion         DROP NOT NULL;

ALTER TABLE core.casos_actores
    DROP CONSTRAINT IF EXISTS chk_casos_actores_vigencia;
ALTER TABLE core.casos_actores
    ADD CONSTRAINT chk_casos_actores_vigencia
    CHECK (
        vigente_hasta IS NULL
        OR vigente_desde IS NULL
        OR vigente_hasta >= vigente_desde
    );

CREATE INDEX IF NOT EXISTS ix_casos_actores_vigentes
    ON core.casos_actores (caso_id)
    WHERE anulado_en IS NULL;

CREATE INDEX IF NOT EXISTS ix_casos_actores_actor
    ON core.casos_actores (actor_id)
    WHERE anulado_en IS NULL;

COMMENT ON COLUMN core.casos_actores.rol_en_caso IS
    'Papel del actor dentro del caso (p. ej. «dirigente», «autoridad regional»). Texto libre.';
COMMENT ON COLUMN core.casos_actores.anulado_en IS
    'Baja lógica del vínculo. La fila se conserva para no perder el historial.';

-- ============================================================================
-- 2. core.documentos: binario y metadatos del archivo
--    El contenido se sirve por endpoint; nunca se selecciona en los listados.
-- ============================================================================
ALTER TABLE core.documentos
    ADD COLUMN IF NOT EXISTS contenido    bytea,
    ADD COLUMN IF NOT EXISTS mime         varchar(120),
    ADD COLUMN IF NOT EXISTS tamano_bytes bigint,
    ADD COLUMN IF NOT EXISTS hash_sha256  char(64);

COMMENT ON COLUMN core.documentos.contenido IS
    'Binario del documento, igual que core.medios. No seleccionar en listados.';

-- ============================================================================
-- 3. Registro de la migración
-- ============================================================================
INSERT INTO core.migracion_log (clave)
VALUES ('50_casos_actores_documentos_binario_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
