-- ============================================================================
-- AVISA — Migración aditiva 45: clasificación, carácter y dimensión ministerial
-- del compromiso
--
-- Fecha: 2026-11-23
-- Estado: APLICABLE. Sólo añade columnas anulables (más un booleano con
--         DEFAULT) y recrea una vista conservando sus columnas actuales.
--
-- POR QUÉ EXISTE
-- La ficha y el formulario de compromisos deben declarar tres cosas que hoy no
-- tienen dónde guardarse y que la interfaz no puede deducir sin inventar dato:
--
--   · Item 16: si el compromiso es «progresivo y parcial», «entendimiento
--     operativo» o «condicionado».
--   · Item 24: si el compromiso es formal o verbal.
--   · Item 123: si el compromiso está «asumido por el Señor Ministro». Es una
--     dimensión distinta de `unidad_responsable_id`: un compromiso puede
--     ejecutarse por una unidad y estar asumido políticamente por el Despacho.
--
-- Además, la exportación de la matriz (Anexo 14, item 16) necesita las columnas
-- V y W (fecha planificada y fecha real) en la vista de seguimiento de
-- compromisos. La vista no las traía; se añaden al final sin tocar las quince
-- columnas que ya consume la interfaz.
--
-- Reglas de esta migración:
--   * ADITIVA: no elimina, renombra ni reordena columnas existentes. Las tres
--     columnas nuevas son anulables (o DEFAULT false), de modo que las filas
--     existentes quedan en «sin declarar».
--   * IDEMPOTENTE: puede re-ejecutarse sin efectos colaterales
--     (ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / CREATE OR REPLACE /
--     DO $$ guard / ON CONFLICT DO NOTHING).
--   * RECREACIÓN DE VISTA: `CREATE OR REPLACE VIEW` sólo añade dos columnas al
--     final; las quince anteriores mantienen nombre, orden y tipo. Conserva el
--     dueño y los privilegios existentes.
--   * NO carga datos de negocio: no siembra ningún compromiso. `false` en
--     `asumido_ministro` es el valor por defecto y no una declaración.
--
-- Requiere las columnas base que ya introduce la migración 41 (responsable y
-- fechas de texto en los hitos); esta migración no las crea.
--
-- PostgreSQL 16, esquemas `core` y `analytics`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. core.compromisos.clasificacion_alcance
--    Item 16. Triple valor cerrado. NULL = sin declarar: no se deriva del
--    estado, del tipo ni de las fechas.
-- ============================================================================
ALTER TABLE core.compromisos
    ADD COLUMN IF NOT EXISTS clasificacion_alcance varchar(30);

ALTER TABLE core.compromisos
    DROP CONSTRAINT IF EXISTS chk_compromisos_clasificacion_alcance;
ALTER TABLE core.compromisos
    ADD CONSTRAINT chk_compromisos_clasificacion_alcance
    CHECK (clasificacion_alcance IN (
        'progresivo_parcial',
        'entendimiento_operativo',
        'condicionado'
    ));

COMMENT ON COLUMN core.compromisos.clasificacion_alcance IS
    'Clasificación del alcance del compromiso (item 16): progresivo_parcial, entendimiento_operativo o condicionado. NULL = sin declarar; no se deriva del estado ni de las fechas.';

-- ============================================================================
-- 2. core.compromisos.formal_verbal
--    Item 24. Carácter del acuerdo. NULL = sin declarar.
-- ============================================================================
ALTER TABLE core.compromisos
    ADD COLUMN IF NOT EXISTS formal_verbal varchar(10);

ALTER TABLE core.compromisos
    DROP CONSTRAINT IF EXISTS chk_compromisos_formal_verbal;
ALTER TABLE core.compromisos
    ADD CONSTRAINT chk_compromisos_formal_verbal
    CHECK (formal_verbal IN ('formal', 'verbal'));

COMMENT ON COLUMN core.compromisos.formal_verbal IS
    'Carácter del compromiso (item 24): formal o verbal. NULL = sin declarar; no se deduce del tipo de compromiso ni de la existencia de documento.';

-- ============================================================================
-- 3. core.compromisos.asumido_ministro
--    Item 123. Dimensión «asumido por el Señor Ministro», independiente de
--    `unidad_responsable_id`. El valor por defecto `false` agrupa «no asumido»
--    y «sin declarar»: la columna es booleana por contrato y no se infiere.
-- ============================================================================
ALTER TABLE core.compromisos
    ADD COLUMN IF NOT EXISTS asumido_ministro boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core.compromisos.asumido_ministro IS
    'Dimensión «asumido por el Señor Ministro» (item 123), distinta de unidad_responsable_id: un compromiso puede ejecutarse por una unidad y estar asumido políticamente por el Despacho Ministerial. false es el valor por defecto (no asumido o sin declarar) y no se deriva de otra columna.';

-- ============================================================================
-- 4. analytics.vw_anexo_14_seguimiento_compromisos
--    Se conservan EXACTAMENTE las catorce columnas que deja la migración 44, en
--    el mismo orden y con los mismos nombres, y se añaden al final:
--      · fecha_planificada = h.fecha_vencimiento  (columna V de la matriz)
--      · fecha_real        = h.fecha_real         (columna W de la matriz)
--    La temática NO se reintroduce: la migración 44 la retira de esta vista por
--    decisión de producto del 2026-11-24. La definición de partida es la de
--    `44_decisiones_2026_11_24.sql` (sección 4) y sólo se añaden las dos
--    columnas.
--    `CREATE OR REPLACE VIEW` conserva dueño y privilegios.
-- ============================================================================
CREATE OR REPLACE VIEW analytics.vw_anexo_14_seguimiento_compromisos AS
SELECT c.codigo_compromiso, cs.codigo_caso,
  (SELECT string_agg(DISTINCT g.region, ', ')    FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS region,
  (SELECT string_agg(DISTINCT g.provincia, ', ') FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS provincia,
  (SELECT string_agg(DISTINCT g.distrito, ', ')  FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS distrito,
  al.codigo AS alcance_geografico, td.nombre AS documento_origen, c.fecha_inicio,
  c.accion_compromiso, uo.siglas AS area_responsable, h.codigo_hito, h.descripcion_hito AS hito, eh.codigo AS estado_hito,
  CASE WHEN eh.es_terminal THEN 'VERDE' WHEN h.fecha_vencimiento < CURRENT_DATE THEN 'ROJO'
       WHEN h.fecha_vencimiento <= CURRENT_DATE + 15 THEN 'AMARILLO' ELSE 'VERDE' END AS semaforo,
  h.fecha_vencimiento AS fecha_planificada, h.fecha_real AS fecha_real
  FROM core.compromisos c JOIN core.casos cs ON cs.id = c.caso_id JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
  LEFT JOIN core.cat_alcances_geograficos al ON al.id = c.alcance_id LEFT JOIN core.documentos dc ON dc.id = c.documento_origen_id
  LEFT JOIN core.cat_tipos_documento td ON td.id = dc.tipo_id
  LEFT JOIN core.hitos_compromiso h ON h.compromiso_id = c.id LEFT JOIN core.cat_estados_hito eh ON eh.id = h.estado_id;

-- ============================================================================
-- 5. core.cat_estados_hito: «No cumplido» (id 6)
--    El importador de la matriz escribe este estado en los hitos. La migración
--    41 ya lo siembra; este guard lo repite para que la 45 sea autosuficiente
--    en un entorno donde sólo se aplique esta. `No cumplido` no es terminal: un
--    hito no cumplido puede reprogramarse.
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM core.cat_estados_hito WHERE codigo = 'No cumplido') THEN
        INSERT INTO core.cat_estados_hito (id, codigo, es_terminal)
        VALUES (6, 'No cumplido', false);
    END IF;
END $$;

-- ============================================================================
-- 6. Registro de la migración
--    `core.migracion_log.clave` es la clave primaria; `on conflict` mantiene la
--    re-ejecución idempotente (mismo patrón que 40, 41_medios y 44).
-- ============================================================================
INSERT INTO core.migracion_log (clave) VALUES ('45_compromisos_clasificacion')
ON CONFLICT (clave) DO NOTHING;

COMMIT;

-- ============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Primero se restaura la vista SIN las dos columnas (CREATE OR REPLACE no puede
--  quitar columnas: hay que soltarla y volver a crearla), luego se retiran las
--  columnas y la entrada del registro.
-- ============================================================================
--
-- begin;
-- drop view if exists analytics.vw_anexo_14_seguimiento_compromisos;
-- create view analytics.vw_anexo_14_seguimiento_compromisos as
-- SELECT c.codigo_compromiso, cs.codigo_caso,
--   (SELECT string_agg(DISTINCT g.region, ', ')    FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS region,
--   (SELECT string_agg(DISTINCT g.provincia, ', ') FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS provincia,
--   (SELECT string_agg(DISTINCT g.distrito, ', ')  FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS distrito,
--   al.codigo AS alcance_geografico, td.nombre AS documento_origen, c.fecha_inicio,
--   c.accion_compromiso, uo.siglas AS area_responsable, h.codigo_hito, h.descripcion_hito AS hito, eh.codigo AS estado_hito,
--   CASE WHEN eh.es_terminal THEN 'VERDE' WHEN h.fecha_vencimiento < CURRENT_DATE THEN 'ROJO'
--        WHEN h.fecha_vencimiento <= CURRENT_DATE + 15 THEN 'AMARILLO' ELSE 'VERDE' END AS semaforo
--   FROM core.compromisos c JOIN core.casos cs ON cs.id = c.caso_id JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
--   LEFT JOIN core.cat_alcances_geograficos al ON al.id = c.alcance_id LEFT JOIN core.documentos dc ON dc.id = c.documento_origen_id
--   LEFT JOIN core.cat_tipos_documento td ON td.id = dc.tipo_id
--   LEFT JOIN core.hitos_compromiso h ON h.compromiso_id = c.id LEFT JOIN core.cat_estados_hito eh ON eh.id = h.estado_id;
-- alter table core.compromisos drop constraint if exists chk_compromisos_clasificacion_alcance;
-- alter table core.compromisos drop constraint if exists chk_compromisos_formal_verbal;
-- alter table core.compromisos drop column if exists clasificacion_alcance;
-- alter table core.compromisos drop column if exists formal_verbal;
-- alter table core.compromisos drop column if exists asumido_ministro;
-- delete from core.migracion_log where clave = '45_compromisos_clasificacion';
-- commit;
