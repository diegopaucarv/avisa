-- ============================================================================
-- AVISA — Migración 55: «Medio» en la vista de riesgo sistémico + teléfono de
-- contacto (no PII) del actor
--
-- POR QUÉ EXISTE
--   Dos ajustes pendientes de la fase de vocabulario y de campos de interfaz:
--     1. `analytics.vw_riesgo_sistemico` todavía devolvía el literal
--        `'MODERADO'` como valor por defecto. El vocabulario congelado pasó a
--        «Medio» (migración 53), así que la vista debe emitir `'MEDIO'`.
--     2. La ficha y el listado de actores muestran un teléfono de contacto.
--        `core.actores` sólo tenía `email_contacto` (no PII); faltaba el
--        equivalente `telefono_contacto` (no PII) para exponerlo en la API.
--
-- REGLAS
--   * ADITIVA: una columna anulable en `core.actores`; no toca el teléfono
--     cifrado de `core.actor_datos_personales.telefono_contacto` (PII, parche
--     P9). Este campo es un teléfono de contacto institucional/público.
--   * IDEMPOTENTE: `CREATE OR REPLACE VIEW`, `ADD COLUMN IF NOT EXISTS`.
--   * La vista se recrea con su definición exacta, cambiando sólo el literal
--     `'MODERADO'` → `'MEDIO'`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Vista de riesgo sistémico: literal «MEDIO» en lugar de «MODERADO»
-- ============================================================================
CREATE OR REPLACE VIEW analytics.vw_riesgo_sistemico AS
SELECT c.codigo_caso,
    nr.codigo AS riesgo_social,
    enos.valor AS indice_enos,
    enos.vigente AS enos_vigente,
    pob.valor AS pobreza_monetaria,
    pob.vigente AS pobreza_vigente,
        CASE
            WHEN enos.vigente AND enos.valor > 1.5 AND nr.codigo::text = 'Alto'::text THEN 'ALTO: señal climática + riesgo social alto'::text
            WHEN pob.vigente AND pob.valor > 30::numeric AND nr.codigo::text = 'Alto'::text THEN 'ALTO: vulnerabilidad social + riesgo alto'::text
            WHEN NOT COALESCE(enos.vigente, false) AND NOT COALESCE(pob.vigente, false) THEN 'SIN CONTEXTO VIGENTE'::text
            ELSE 'MEDIO'::text
        END AS riesgo_sistemico
   FROM core.casos c
     JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
     LEFT JOIN LATERAL ctx.ultima_observacion('ENOS_ICEN'::text, c.distrito_principal_id) enos(valor, fecha, vigente, ambito_resuelto) ON true
     LEFT JOIN LATERAL ctx.ultima_observacion('POBREZA_MONETARIA'::text, c.distrito_principal_id) pob(valor, fecha, vigente, ambito_resuelto) ON true;

-- ============================================================================
-- 2. Teléfono de contacto (no PII) del actor
-- ============================================================================
ALTER TABLE core.actores
  ADD COLUMN IF NOT EXISTS telefono_contacto varchar(50);

COMMENT ON COLUMN core.actores.telefono_contacto IS
  'Teléfono institucional o público con el que se contacta al actor (no PII).';

-- ============================================================================
-- 3. Registro de la migración
-- ============================================================================
INSERT INTO core.migracion_log (clave) VALUES ('55_riesgo_sistemico_medio_y_telefono_actor_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
