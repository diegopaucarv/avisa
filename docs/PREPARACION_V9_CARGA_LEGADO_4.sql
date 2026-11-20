-- =============================================================================
--  PREPARACIÓN v9 PARA LA CARGA DEL LEGADO — PARCHE 4 (CIERRE D50–D51)
--  AVISA / OAIPCS · PostgreSQL 16
--
--  Se ejecuta DESPUÉS de:
--    docs/PREPARACION_V9_CARGA_LEGADO.sql     (parche 1)
--    docs/PREPARACION_V9_CARGA_LEGADO_2.sql   (parche 2)
--    docs/PREPARACION_V9_CARGA_LEGADO_3.sql   (parche 3)
--
--  Idempotente: puede ejecutarse varias veces.
--  Justificación completa: docs/DECISIONES_CARGA_LEGADO_V9.md, decisiones D50 y D51.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- D50 — D42 NO ALCANZA PARA EL 87 % DE LAS MEMBRESÍAS
--
--    DIM_Actores.Id_organizacion trae 660 referencias no vacías. Tras resolver
--    por código (11), por nombre exacto (272) y por pg_trgm >= 0.85 (8), quedan
--    292 filas-persona con organización identificada. D42 exige que valid_from
--    salga de la fecha de constitución de la organización o, en su defecto, del
--    caso más antiguo del actor:
--
--        con fecha_constitucion de la org ................ 13
--        sin fecha de org, con fecha de caso ............. 25
--        ------------------------------------------------------
--        con fecha derivable (D42 estricto) .............. 38
--        sin fecha derivable ............................ 254
--
--    `actor_membresia.valid_from` es NOT NULL, así que hoy se pierden 254
--    vínculos persona↔organización que SÍ existen en el legado. Inventar una
--    fecha (CURRENT_DATE, el mínimo global de FACT_Casos, etc.) falsearía el
--    modelo temporal. La alternativa correcta es admitir "inicio desconocido":
--
--        valid_from IS NULL  <=>  la fecha no consta en el origen
--
--    Ninguna vista ni trigger consume esta columna; el único índice
--    (ix_membresia_org ... WHERE valid_to IS NULL) no la usa. La relajación no
--    cambia ninguna regla de negocio: sólo permite representar el dato real.
-- -----------------------------------------------------------------------------
ALTER TABLE core.actor_membresia ALTER COLUMN valid_from DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- D51 — LA MISMA RELAJACIÓN DEBE ALCANZAR AL HISTORIAL
--
--    `core.caso_historial()` copia `NEW.nivel_conflicto_id` a
--    `core.caso_estado_historial` en cada INSERT de `core.casos`. Esa columna
--    también es NOT NULL, así que la decisión (b) —aceptada para
--    `casos.nivel_conflicto_id`— no sirve sola: el caso `CS-PRODUCE-2026-024`
--    (sin `ID_Tipo`) aborta la carga desde el trigger, no desde el INSERT.
--
--    El historial debe poder representar el mismo estado que el caso. Se relaja
--    únicamente `nivel_conflicto_id`; `nivel_riesgo_id` y `estado_id` siguen
--    NOT NULL porque `casos` también lo exige.
-- -----------------------------------------------------------------------------
ALTER TABLE core.caso_estado_historial
    ALTER COLUMN nivel_conflicto_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- Verificación rápida
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'core' AND table_name = 'actor_membresia'
           AND column_name = 'valid_from' AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'Parche 4 incompleto: core.actor_membresia.valid_from sigue NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'core' AND table_name = 'caso_estado_historial'
           AND column_name = 'nivel_conflicto_id' AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'Parche 4 incompleto: core.caso_estado_historial.nivel_conflicto_id sigue NOT NULL';
    END IF;

    RAISE NOTICE 'Parche 4 aplicado correctamente (valid_from y nivel_conflicto_id del historial admiten NULL).';
END $$;

COMMIT;
