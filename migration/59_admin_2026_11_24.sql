-- ============================================================================
-- AVISA — Migración aditiva 59: soportes de la pantalla de Administración
--
-- POR QUÉ EXISTE
--   `core.configuracion` (migración 49) sólo guarda clave, valor y auditoría
--   de edición. La pantalla de Administración muestra, para cada parámetro,
--   una descripción que explique qué controla; esa columna no existía.
--   Además se añade el índice que sostiene «último acceso» por usuario
--   (la consulta recorre `core.log_accesos` por `usuario_id` + `fecha`).
--
-- REGLAS
--   * ADITIVA: no elimina, renombra ni reordena nada existente.
--   * IDEMPOTENTE: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--   * No siembra datos: la configuración arranca como está (hoy sin filas).
--   * No toca políticas RLS ni permisos de escritura de catálogos.
--   * PostgreSQL 16+, esquema `core`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Descripción del parámetro
--    El valor sigue siendo `jsonb` (texto, número, booleano, objeto o lista).
--    La descripción es texto libre y puede quedar nula en filas antiguas.
-- ============================================================================
ALTER TABLE core.configuracion
    ADD COLUMN IF NOT EXISTS descripcion text;

COMMENT ON COLUMN core.configuracion.descripcion IS
    'Qué controla el parámetro. Se muestra y edita en la pantalla de Administración; nunca guarda secretos.';

COMMENT ON TABLE core.configuracion IS
    'Parámetros globales del aplicativo (clave/valor jsonb) con descripción y auditoría de la última edición.';

-- ============================================================================
-- 2. Último acceso por usuario
--    La ficha de Administración resuelve «último acceso» con
--    max(fecha) por usuario_id y resultado = 'OK'. El índice evita recorrer
--    toda la bitácora cuando crezca.
-- ============================================================================
CREATE INDEX IF NOT EXISTS ix_log_accesos_usuario
    ON core.log_accesos (usuario_id, fecha DESC);

-- ============================================================================
-- 3. Privilegios para el rol de aplicación
--    `avisa_api` hereda de `avisa_app`. Se repiten los GRANT por si el rol se
--    recrea; si no existe (base local con otro nombre), se omite sin fallar.
--    `cat_niveles_conflicto` queda en sólo lectura: su trigger
--    `trg_bloquear_niveles_conflicto` rechaza cualquier escritura directa.
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE
            ON core.configuracion TO avisa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE
            ON core.documento_lista_blanca TO avisa_app;

        GRANT SELECT ON core.migracion_log TO avisa_app;
        GRANT SELECT ON core.log_accesos TO avisa_app;

        GRANT SELECT, INSERT, UPDATE, DELETE
            ON core.usuarios TO avisa_app;
        GRANT SELECT, INSERT, UPDATE, DELETE
            ON core.usuario_roles TO avisa_app;
        GRANT SELECT, UPDATE, DELETE
            ON core.roles TO avisa_app;

        GRANT SELECT, UPDATE, DELETE
            ON core.cat_niveles_riesgo TO avisa_app;
        GRANT SELECT, UPDATE, DELETE
            ON core.cat_estados_caso TO avisa_app;
        GRANT SELECT, UPDATE, DELETE
            ON core.cat_tipos_actor TO avisa_app;
        GRANT SELECT, UPDATE, DELETE
            ON core.cat_roles_actor TO avisa_app;
        GRANT SELECT
            ON core.cat_niveles_conflicto TO avisa_app;
    END IF;
END $$;

-- ============================================================================
-- 4. Registro de la migración
-- ============================================================================
INSERT INTO core.migracion_log (clave)
VALUES ('59_admin_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
