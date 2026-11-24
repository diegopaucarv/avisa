-- ============================================================================
-- AVISA — Migración aditiva 44: decisiones de producto del 2026-11-24
--
-- Estado: PROPUESTA verificada contra la base viva (corte 2026-11-24).
-- Depende de 41, 42 y 43: aplicarla después, en ese orden.
--
-- QUÉ CAMBIA Y POR QUÉ
--   1. DIPFORPA. La matriz del equipo escribe «DIPFORPA»; el catálogo tenía
--      «DPFORPA» (id 24). Manda la fuente: se renombra el catálogo.
--   2. Nudos: vínculo con el hito. El Excel escribe el nudo a nivel de FILA y
--      esa fila ES un hito en 85 de 87 casos. Se añade `hito_id` nulable y un
--      disparador que impide colgar un nudo de un hito de otro compromiso y que
--      completa `compromiso_id` a partir del hito. La relación deja de ser
--      posicional y pasa a ser declarada.
--   3. Nudos: validación del texto, separada del estado.
--   4. Archivo. Alertas y reuniones que la matriz no vincula a un caso no se
--      descartan: se guardan y se marcan como archivadas, con motivo. «Archivo»
--      sustituye a «Papelera» como nombre visible, pero NO es anulación: una
--      fila archivada conserva su estado y se puede devolver.
--   5. Temática fuera de las salidas. Los anexos 14 y 15 dejan de exponer la
--      columna de temática. Las columnas con datos NO se borran (276 demandas
--      tienen valor): se marcan obsoletas para que ninguna consulta nueva las
--      use. Ver la nota de alcance al final del archivo.
--
-- Reglas: ADITIVA, IDEMPOTENTE, PostgreSQL 16, esquema `core`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. DIPFORPA
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM core.cat_unidades_organicas WHERE id = 24 AND siglas = 'DPFORPA')
       AND NOT EXISTS (SELECT 1 FROM core.cat_unidades_organicas WHERE siglas = 'DIPFORPA' AND id <> 24)
    THEN
        UPDATE core.cat_unidades_organicas SET siglas = 'DIPFORPA' WHERE id = 24;
    END IF;
END $$;

COMMENT ON COLUMN core.cat_unidades_organicas.siglas IS
    'Siglas de la unidad orgánica. Se corrigió DPFORPA -> DIPFORPA (id 24) el 2026-11-24: la fuente del equipo escribe DIPFORPA.';

-- ============================================================================
-- 2. core.caso_nudo_critico: hito declarado y validación del texto
-- ============================================================================
ALTER TABLE core.caso_nudo_critico
    ADD COLUMN IF NOT EXISTS hito_id                uuid REFERENCES core.hitos_compromiso(id),
    ADD COLUMN IF NOT EXISTS validado_por_usuario_id uuid REFERENCES core.usuarios(id),
    ADD COLUMN IF NOT EXISTS validado_en            timestamptz;

CREATE INDEX IF NOT EXISTS idx_caso_nudo_critico_hito
    ON core.caso_nudo_critico (hito_id);

COMMENT ON COLUMN core.caso_nudo_critico.hito_id IS
    'Hito al que se refiere el nudo. Nulo cuando la fila de origen no tiene hito (2 de 87 filas del Excel 2026): en ese caso el nudo cuelga sólo del compromiso y el código se declara en el texto. El disparador exige coherencia con compromiso_id.';
COMMENT ON COLUMN core.caso_nudo_critico.validado_por_usuario_id IS
    'Usuario que validó el texto del nudo. Distinto de estado_id: validar el contenido no es mover la máquina de estados.';
COMMENT ON COLUMN core.caso_nudo_critico.validado_en IS
    'Momento de la validación del texto.';

CREATE OR REPLACE FUNCTION core.caso_nudo_critico_valida_hito()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_compromiso uuid;
BEGIN
    IF NEW.hito_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT h.compromiso_id INTO v_compromiso
    FROM core.hitos_compromiso h
    WHERE h.id = NEW.hito_id;

    IF v_compromiso IS NULL THEN
        RAISE EXCEPTION 'El hito % no existe o no tiene compromiso', NEW.hito_id;
    END IF;

    IF NEW.compromiso_id IS NOT NULL AND NEW.compromiso_id <> v_compromiso THEN
        RAISE EXCEPTION 'Incoherencia: el hito % pertenece al compromiso %, no a %',
            NEW.hito_id, v_compromiso, NEW.compromiso_id;
    END IF;

    NEW.compromiso_id := v_compromiso;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caso_nudo_critico_valida_hito ON core.caso_nudo_critico;
CREATE TRIGGER trg_caso_nudo_critico_valida_hito
    BEFORE INSERT OR UPDATE OF hito_id, compromiso_id ON core.caso_nudo_critico
    FOR EACH ROW
    EXECUTE FUNCTION core.caso_nudo_critico_valida_hito();

COMMENT ON FUNCTION core.caso_nudo_critico_valida_hito() IS
    'El hito manda: completa compromiso_id y rechaza un nudo que intente colgar de un hito ajeno.';

-- ============================================================================
-- 3. Archivo: alertas y reuniones sin caso
--    Archivada no es anulada. Se conserva la fila, su estado y su trazabilidad;
--    sólo sale de las colas de trabajo y se consulta en «Archivo».
-- ============================================================================
ALTER TABLE core.alertas_tempranas
    ADD COLUMN IF NOT EXISTS archivado_en   timestamptz,
    ADD COLUMN IF NOT EXISTS archivado_por  uuid,
    ADD COLUMN IF NOT EXISTS motivo_archivo text;

ALTER TABLE core.reuniones_dialogo
    ADD COLUMN IF NOT EXISTS archivado_en   timestamptz,
    ADD COLUMN IF NOT EXISTS archivado_por  uuid,
    ADD COLUMN IF NOT EXISTS motivo_archivo text;

CREATE INDEX IF NOT EXISTS idx_alertas_archivadas
    ON core.alertas_tempranas (archivado_en)
    WHERE archivado_en IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reuniones_archivadas
    ON core.reuniones_dialogo (archivado_en)
    WHERE archivado_en IS NOT NULL;

COMMENT ON COLUMN core.alertas_tempranas.archivado_en IS
    'Marca de archivo: la alerta existe y es consultable, pero no aparece en las colas de trabajo. Para las alertas que la matriz no vincula a un caso. No es lo mismo que anulado_en.';
COMMENT ON COLUMN core.reuniones_dialogo.archivado_en IS
    'Marca de archivo: la reunión existe y es consultable, pero no aparece en las colas de trabajo. Para las reuniones que la matriz no vincula a un caso. No es lo mismo que anulado_en.';
COMMENT ON COLUMN core.alertas_tempranas.motivo_archivo IS
    'Por qué se archivó, en texto. Por ejemplo «Sin caso en la matriz».';
COMMENT ON COLUMN core.reuniones_dialogo.motivo_archivo IS
    'Por qué se archivó, en texto. Por ejemplo «Sin caso en la matriz».';

-- ============================================================================
-- 4. Anexos 14 y 15 sin temática
--    PostgreSQL no permite quitar columnas con CREATE OR REPLACE VIEW: hay que
--    recrear. Se verificó en la base viva que ninguna otra vista depende de
--    estas dos y que ninguna función las consulta.
-- ============================================================================
DROP VIEW IF EXISTS analytics.vw_anexo_15_matriz_conflictividad;
CREATE VIEW analytics.vw_anexo_15_matriz_conflictividad AS
SELECT
    c.codigo_caso,
    g.region,
    al.codigo AS alcance,
    s.nombre  AS subsector,
    uo.siglas AS responsable,
    nc.nombre AS nivel_conflicto,
    nr.codigo AS nivel_riesgo,
    c.descripcion_riesgo,
    pa.codigo AS prioridad_atencion,
    c.nombre_caso,
    (SELECT string_agg(to_char(k.fecha_evento::timestamp with time zone, 'DD.MM.YYYY') || ' ' || k.descripcion_hecho, E'\n' ORDER BY k.fecha_evento DESC)
       FROM core.caso_cronologia k
      WHERE k.caso_id = c.id) AS narracion_cronologica,
    (SELECT string_agg(a.codigo_alerta, ', ')
       FROM core.alertas_tempranas a
      WHERE a.caso_id = c.id) AS alertas_vinculadas,
    (SELECT string_agg(ac.nombre_actual, '; ')
       FROM core.casos_actores ca
       JOIN core.actores ac ON ac.actor_uid = ca.actor_id
      WHERE ca.caso_id = c.id) AS actores_involucrados,
    pf.nombre AS punto_focal
FROM core.casos c
LEFT JOIN core.usuarios pf            ON pf.id = c.punto_focal_usuario_id
LEFT JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id
LEFT JOIN core.cat_subsectores s      ON s.id = c.subsector_id
LEFT JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
LEFT JOIN core.cat_niveles_conflicto nc  ON nc.id = c.nivel_conflicto_id
LEFT JOIN core.cat_niveles_riesgo nr     ON nr.id = c.nivel_riesgo_id
LEFT JOIN core.cat_alcances_geograficos al ON al.id = core.alcance_caso(c.id)
LEFT JOIN core.cat_prioridades_atencion pa ON pa.id = c.prioridad_id;

DROP VIEW IF EXISTS analytics.vw_anexo_14_seguimiento_compromisos;
CREATE VIEW analytics.vw_anexo_14_seguimiento_compromisos AS
SELECT
    c.codigo_compromiso,
    cs.codigo_caso,
    (SELECT string_agg(DISTINCT g.region, ', ')
       FROM core.compromiso_distritos cd
       JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id
      WHERE cd.compromiso_id = c.id) AS region,
    (SELECT string_agg(DISTINCT g.provincia, ', ')
       FROM core.compromiso_distritos cd
       JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id
      WHERE cd.compromiso_id = c.id) AS provincia,
    (SELECT string_agg(DISTINCT g.distrito, ', ')
       FROM core.compromiso_distritos cd
       JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id
      WHERE cd.compromiso_id = c.id) AS distrito,
    al.codigo AS alcance_geografico,
    td.nombre AS documento_origen,
    c.fecha_inicio,
    c.accion_compromiso,
    uo.siglas AS area_responsable,
    h.codigo_hito,
    h.descripcion_hito AS hito,
    eh.codigo AS estado_hito,
    CASE
        WHEN eh.es_terminal THEN 'VERDE'
        WHEN h.fecha_vencimiento < CURRENT_DATE THEN 'ROJO'
        WHEN h.fecha_vencimiento <= (CURRENT_DATE + 15) THEN 'AMARILLO'
        ELSE 'VERDE'
    END AS semaforo
FROM core.compromisos c
JOIN core.casos cs ON cs.id = c.caso_id
JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
LEFT JOIN core.cat_alcances_geograficos al ON al.id = c.alcance_id
LEFT JOIN core.documentos dc ON dc.id = c.documento_origen_id
LEFT JOIN core.cat_tipos_documento td ON td.id = dc.tipo_id
LEFT JOIN core.hitos_compromiso h ON h.compromiso_id = c.id
LEFT JOIN core.cat_estados_hito eh ON eh.id = h.estado_id;

COMMENT ON VIEW analytics.vw_anexo_15_matriz_conflictividad IS
    'Anexo 15. Desde el 2026-11-24 no expone temática: el equipo la retira de su matriz y de la interfaz.';
COMMENT ON VIEW analytics.vw_anexo_14_seguimiento_compromisos IS
    'Anexo 14. Desde el 2026-11-24 no expone temática.';

-- DROP + CREATE pierde los GRANT: se reponen los que tenían las dos vistas.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_app') THEN
        EXECUTE 'GRANT SELECT ON analytics.vw_anexo_14_seguimiento_compromisos, '
                'analytics.vw_anexo_15_matriz_conflictividad TO avisa_app';
    ELSE
        RAISE NOTICE 'rol avisa_app ausente: no se repusieron privilegios sobre los anexos 14 y 15';
    END IF;
END $$;

-- ============================================================================
-- 5. Temática: obsoleta, no borrada
--    `casos.tematica_id` (35 casos) y `demandas.tematica_id` (276 demandas)
--    tienen datos reales. Borrarlas perdería información y además rompería
--    core.codigo_tematica(), que genera el segmento INF/OAT/NOR/DBE/GOB/ITE de
--    TODOS los códigos de caso. Se marcan obsoletas: ningún flujo nuevo las
--    escribe y la interfaz no las muestra.
-- ============================================================================
COMMENT ON TABLE core.cat_tematicas IS
    'OBSOLETO como dimensión de trabajo desde el 2026-11-24. Se conserva porque core.codigo_tematica() usa sus ids para generar el segmento temático de core.casos.codigo_caso. No usar para filtrar, agrupar ni mostrar.';
COMMENT ON COLUMN core.casos.tematica_id IS
    'OBSOLETO como dimensión visible desde el 2026-11-24. Se conserva por trazabilidad y porque el segmento temático ya está impreso en codigo_caso. No mostrar en la interfaz.';
COMMENT ON COLUMN core.demandas.tematica_id IS
    'OBSOLETO desde el 2026-11-24. 276 demandas conservan su valor por trazabilidad; no se borra para no perder dato histórico. No mostrar en la interfaz ni usar como filtro.';
COMMENT ON COLUMN core.compromisos.tematica_id IS
    'OBSOLETO desde el 2026-11-24. Sin datos (0 compromisos con valor). No usar.';

-- ============================================================================
-- NOTA DE ALCANCE (leer antes de dar esto por cerrado)
--   Para borrar la temática de verdad hacen falta dos cosas que esta migración
--   NO hace, porque cambian la identidad de los datos:
--     (a) reemplazar el segmento temático de los códigos de caso por una
--         columna propia (`casos.segmento_codigo`) y cambiar la firma de
--         core.siguiente_codigo_caso, que hoy recibe p_tematica_id;
--     (b) decidir el destino de 276 demandas y 35 casos con valor.
--   Mientras eso no se decida, la temática existe en la base pero no se ve.
-- ============================================================================

-- ============================================================================
-- Registro de la migración
-- ============================================================================
INSERT INTO core.migracion_log (clave) VALUES ('44_decisiones_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
