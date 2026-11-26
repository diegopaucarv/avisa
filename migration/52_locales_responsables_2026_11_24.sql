-- ============================================================================
-- AVISA — Migración aditiva 52: responsables de los locales (1→N)
--
-- POR QUÉ EXISTE
--   El contacto del local vivía en tres columnas propias de `core.locales`
--   (`contacto_nombre`, `contacto_celular`, `contacto_email`), lo que limitaba
--   cada sede a una sola persona. La ficha del directorio ya muestra la lista
--   de responsables (`responsables` en `GET /api/v1/locales`) y anticipa esta
--   tabla relacionada; la API todavía no la devolvía. Esta migración introduce
--   la tabla `core.local_responsables` para que cada local pueda tener varios
--   responsables con nombre, correo y teléfono.
--
-- REGLAS
--   * ADITIVA: crea una tabla nueva. Las columnas `contacto_*` de
--     `core.locales` se conservan tal cual (la API las sigue leyendo como
--     respaldo heredado cuando no hay responsables relacionados).
--   * IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS.
--   * No siembra datos de negocio.
--   * PostgreSQL 16+, esquema `core`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Tabla de responsables del local
--    Relación 1→N: borrar el local borra en cascada sus responsables.
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.local_responsables (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    local_id    uuid NOT NULL REFERENCES core.locales(id) ON DELETE CASCADE,
    nombre      varchar(255),
    correo      varchar(255),
    telefono    varchar(50),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- La API lee los responsables de un conjunto de locales ordenados por
-- antigüedad; este índice cubre ese acceso.
CREATE INDEX IF NOT EXISTS ix_local_responsables_local
    ON core.local_responsables (local_id, created_at);

COMMENT ON TABLE core.local_responsables IS
    'Responsables del local (1→N). Sustituye a largo plazo las columnas contacto_* de core.locales, que se conservan como respaldo heredado.';

-- ============================================================================
-- 2. Privilegios de la tabla nueva
--    Sin esto la API no puede leerla: `avisa_api` hereda de `avisa_app`, al que
--    se le conceden los mismos privilegios que sobre `core.locales` (arwd).
--    Idempotente también ante entornos sin el rol `avisa_app`.
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_app') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON core.local_responsables TO avisa_app';
    ELSE
        RAISE NOTICE 'rol avisa_app ausente: no se otorgaron privilegios sobre core.local_responsables';
    END IF;
END $$;

-- ============================================================================
-- 3. Registro de la migración
-- ============================================================================
INSERT INTO core.migracion_log (clave) VALUES ('52_locales_responsables_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
