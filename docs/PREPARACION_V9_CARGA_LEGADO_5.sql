-- =============================================================================
--  PREPARACIÓN v9 PARA LA CARGA DEL LEGADO — PARCHE 5 (SEEDS DE CIERRE)
--  AVISA / OAIPCS · PostgreSQL 16
--
--  Se ejecuta DESPUÉS de:
--    docs/PREPARACION_V9_CARGA_LEGADO.sql     (parche 1)
--    docs/PREPARACION_V9_CARGA_LEGADO_2.sql   (parche 2)
--    docs/PREPARACION_V9_CARGA_LEGADO_3.sql   (parche 3)
--    docs/PREPARACION_V9_CARGA_LEGADO_4.sql   (parche 4)
--
--  Idempotente: puede ejecutarse varias veces sin duplicar ni sobrescribir.
--  Justificación y estado de cada hueco: docs/05_datos/BRECHA_CAPA_DATOS_V9.md §3 y §7
--  (acciones P0 1–4 y P0 7).
--
--  ---------------------------------------------------------------------------
--  QUÉ SIEMBRA ESTE PARCHE (y con qué fuente)
--  ---------------------------------------------------------------------------
--  1. core.cat_pip_etapas — 12 etapas estandarizadas del ciclo de inversión.
--     Fuente: AVISA_PRODUCE_v10.md §1.2.b ("Las 12 etapas estandarizadas").
--     Las fases (core.cat_pip_fases) ya venían sembradas por el DDL:
--     1 Programacion, 2 Pre_inversion, 3 Inversion, 4 Ejecucion,
--     5 Funcionamiento, 6 Desactivado. La fase 6 no tiene etapas en la Guía.
--
--  2. config.schema_registry — avisa.raw_ingest v1 y v2.
--     v1: JSON Schema literal de §4.2 (draft 2020-12), sin cambios.
--     v2: se DERIVA de v1 dentro de esta misma transacción y sólo añade lo que
--         el DDL v9 ya impone sobre avisa.raw_ingest: las seis fuentes nuevas
--         que admite su CHECK (rutas C–G de §4.bis), la columna tipo_registro
--         con su CHECK, y policy_snapshot_id. El "$defs por tipo de registro"
--         que menciona §4.bis NO está especificado en el repositorio, así que no
--         se inventa: queda anotado como pendiente en la descripción y en el
--         informe.
--
--  3. agent.cat_detalle_schema — versión 1 del schema de agent.run_log.detalle.
--     El documento (§10.4, T66) exige "un JSON Schema versionado" pero no fija
--     su contenido. Se siembra un esquema permisivo explícitamente marcado como
--     provisional: valida cualquier objeto y deja de mentir sobre una estructura
--     que todavía no existe. La versión 2 la debe escribir OAIPCS.
--
--  4. ind.plantilla — las tres plantillas del Nivel 1 (§8.4): Anexo 2,
--     Anexo 15 y Minister View. Sólo la cabecera de plantilla: sus
--     ind.plantilla_slot requieren el catálogo de indicadores, que no existe.
--
--  5. Derivados — REFRESH no concurrente de las 6 vistas materializadas, para
--     que un `./scripts/db.sh apply` no deje caché obsoleta (P0 7).
--
--  ---------------------------------------------------------------------------
--  QUÉ **NO** SIEMBRA ESTE PARCHE (y por qué)
--  ---------------------------------------------------------------------------
--  · ind.indicador / ind.variante / ind.plantilla_slot / ind.brecha
--      El documento remite a "los indicadores de la Tabla 3 de la Guía" y a un
--      inventario de 54 indicadores que NO están en este repositorio. El legado
--      AVISA 2026 tampoco trae catálogo de indicadores (86 hojas revisadas: no
--      hay hoja de indicadores). Inventar códigos, definiciones, componente_guia
--      o anexo_origen rompería la trazabilidad de todo `ind.*`.
--      → Decisión pendiente nº 1 del informe (§8).
--
--  · core.cat_tipos_documento.esquema_json (0 de 15)
--      §3.13 dice literalmente "JSON Schema por definir" para los tipos 2, 3,
--      6 y 7. Sembrarlos hoy sería inventar el contrato documental.
--
--  · ctx.cat_fuentes / ctx.zonas_maritimas / ctx.variable_fuentes
--      No hay seed ni listado cerrado en el DDL ni en el documento; dependen de
--      la operación de C5/C6 (decisión pendiente nº 8).
--
--  · kag.aristas
--      Exige una tabla de equivalencia legado → kag.cat_tipos_arista aprobada
--      (decisión pendiente nº 4). No es un seed: es una decisión semántica.
--
--  · policy.gobierno / policy.titular / reglas P y L
--      Es contenido de OAIPCS, no un catálogo técnico (decisión pendiente nº 7).
--
--  ---------------------------------------------------------------------------
--  CONVENCIÓN DE config.schema_registry
--  ---------------------------------------------------------------------------
--  codigo  = familia del contrato (estable)
--  version = versión del contrato
--  El identificador completo es codigo || '.' || version, de modo que
--    ('avisa.raw_ingest', 'v2')  ->  'avisa.raw_ingest.v2'
--  reproduce literalmente el valor que ya usa
--  agent.plantilla_prompt.output_schema_id para A1. (Las otras tres plantillas
--  de prompt usan identificadores con guion bajo — 'pauta_a2.v1',
--  'minister_view_v1', 'critic_v1' — que no encajan en esta convención; su
--  normalización es una decisión pendiente que se anota en el informe, no algo
--  que este parche deba resolver a la fuerza.)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. core.cat_pip_etapas — 12 etapas (§1.2.b)
--
--    `id` explícito y estable (1..12) para que los cargadores y las pruebas
--    puedan referenciarlo. `ON CONFLICT DO NOTHING` cubre a la vez la PK y el
--    UNIQUE (fase_id, numero): si alguien ya sembró el catálogo con los mismos
--    números por fase, no se duplica ni se sobrescribe.
-- -----------------------------------------------------------------------------
INSERT INTO core.cat_pip_etapas (id, fase_id, numero, nombre) VALUES
 ( 1, 1,  1, 'Identificacion de la brecha'),
 ( 2, 1,  2, 'Registro en el PMI'),
 ( 3, 2,  3, 'Elaboracion del estudio de pre-inversion'),
 ( 4, 2,  4, 'Aprobacion de la viabilidad'),
 ( 5, 2,  5, 'Registro en el Banco de Inversiones'),
 ( 6, 3,  6, 'Elaboracion del expediente tecnico'),
 ( 7, 3,  7, 'Aprobacion del expediente tecnico'),
 ( 8, 3,  8, 'Proceso de seleccion del contratista'),
 ( 9, 3,  9, 'Firma del contrato'),
 (10, 4, 10, 'Ejecucion fisica y financiera'),
 (11, 4, 11, 'Cierre de la inversion'),
 (12, 5, 12, 'Operacion y mantenimiento')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. config.schema_registry — avisa.raw_ingest
-- -----------------------------------------------------------------------------

-- 2.1 · v1 — JSON literal de §4.2 (no se toca ni se "mejora")
INSERT INTO config.schema_registry (codigo, version, esquema_json) VALUES
('avisa.raw_ingest', 'v1', $json$
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AvisaRawIngest",
  "type": "object",
  "required": ["source", "timestamp", "content"],
  "properties": {
    "source": { "enum": ["whatsapp", "acta_pdf", "audio", "email"] },
    "timestamp": { "type": "string", "format": "date-time" },
    "sender_phone_hash": { "type": "string" },
    "content": {
      "type": "object",
      "required": ["situacion_actual"],
      "properties": {
        "situacion_actual": { "type": "string", "maxLength": 1500 },
        "hechos": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["fecha", "descripcion"],
            "properties": {
              "fecha": { "type": "string", "format": "date" },
              "descripcion": { "type": "string" },
              "es_verificable": { "type": "boolean" }
            }
          }
        },
        "demandas_3p": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["problema", "propuesta", "pedido"],
            "properties": {
              "problema": { "type": "string" },
              "propuesta": { "type": "string" },
              "pedido": { "type": "string" },
              "actor_nombre": { "type": "string" }
            }
          }
        },
        "actores": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["nombre"],
            "properties": {
              "nombre": { "type": "string" },
              "tipo": { "enum": ["social", "publico", "privado"] },
              "rol": { "enum": ["principal", "secundario", "tercero"] },
              "posicion": { "enum": ["apoyo", "oposicion", "neutral"] }
            }
          }
        },
        "narrativas": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "extractor_version": { "type": "string" }
  }
}
$json$::jsonb)
ON CONFLICT (codigo, version) DO NOTHING;

-- 2.2 · v2 — derivada de v1 + lo que el DDL ya impone (§4.bis)
--
--    Se construye con jsonb_set sobre la fila v1 en lugar de copiar el JSON a
--    mano: así v1 y v2 no pueden divergir en la parte común. Las tres únicas
--    diferencias son las documentadas:
--      · `source` amplía su enum con las 6 fuentes de las rutas C–G
--        (CHECK raw_ingest_fuente_check del DDL);
--      · `tipo_registro` (CHECK del DDL, §4.bis);
--      · `policy_snapshot_id` (columna que el delta v9 añade a avisa.raw_ingest).
INSERT INTO config.schema_registry (codigo, version, esquema_json)
SELECT
    'avisa.raw_ingest',
    'v2',
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              v1.esquema_json,
              '{title}',       '"AvisaRawIngestV2"'::jsonb, true),
            '{description}',
            to_jsonb(('Extiende v1 con las rutas C-G (§4.bis): fuentes nuevas, '
                      'tipo_registro y policy_snapshot_id. Los $defs por valor de '
                      'tipo_registro NO estan definidos en el repositorio y quedan '
                      'pendientes; ver docs/05_datos/BRECHA_CAPA_DATOS_V9.md.' )::text), true),
          '{properties,source}',
          '{"enum":["whatsapp","acta_pdf","audio","email","sunat_comprobante","vuce_permiso","ana_siagua","sanipes_pcr","citered_acta","dgsfs_tiburon"]}'::jsonb,
          true),
        '{properties,tipo_registro}',
        '{"enum":["evento","serie","permiso","comprobante","inspeccion","diagnostico"]}'::jsonb,
        true),
      '{properties,policy_snapshot_id}',
      '{"type":["string","null"],"format":"uuid"}'::jsonb,
      true) AS esquema_json
  FROM config.schema_registry v1
 WHERE v1.codigo = 'avisa.raw_ingest' AND v1.version = 'v1'
ON CONFLICT (codigo, version) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. agent.cat_detalle_schema — versión 1 (provisional)
--
--    `agente = NULL` ⇒ el esquema aplica a todos los agentes.
--    Permisivo a propósito: el documento exige que exista y esté versionado
--    (T66), no fija campos. Cualquier restricción real es una decisión de
--    OAIPCS; mientras no exista, es preferible un contrato honestamente laxo a
--    uno inventado que rechace detalles válidos.
-- -----------------------------------------------------------------------------
INSERT INTO agent.cat_detalle_schema (version, agente, esquema_json) VALUES
(1, NULL, $json$
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "RunLogDetalleV1",
  "description": "PROVISIONAL. Contrato v1 del campo agent.run_log.detalle (T66). Valida cualquier objeto: la estructura real del detalle por agente todavia no esta especificada en el repositorio. OAIPCS debe sustituirlo por la version 2 con los campos reales.",
  "type": "object",
  "additionalProperties": true
}
$json$::jsonb)
ON CONFLICT (version) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. ind.plantilla — las tres plantillas del Nivel 1 (§8.4)
--
--    `tipo_documento_id` queda NULL a propósito: ni el Anexo 2 (panorama
--    regional) ni el Anexo 15 (matriz de conflictividad) son tipos de
--    `core.cat_tipos_documento` — son vistas analíticas — y la Minister View
--    tampoco es un documento. Forzar un tipo documental sería una asociación
--    falsa. El vínculo real de cada plantilla con su vista está en la
--    descripción y en §3.13.
--
--    Las plantillas no tienen slots todavía: `ind.plantilla_slot.indicador_id`
--    es NOT NULL y el catálogo de indicadores está pendiente (ver cabecera).
-- -----------------------------------------------------------------------------
INSERT INTO ind.plantilla (codigo, nombre, tipo_documento_id, descripcion) VALUES
('anexo_02_panorama_regional',
 'Anexo 2 - Panorama regional',
 NULL,
 'Plantilla del Nivel 1 (v9 §8.4). Espacios de indicador del reporte regional; su materializacion es analytics.vw_anexo_02_panorama_regional (§3.13). Sin slots hasta que exista el catalogo de indicadores (Tabla 3 de la Guia).'),
('anexo_15_matriz_conflictividad',
 'Anexo 15 - Matriz de conflictividad',
 NULL,
 'Plantilla del Nivel 1 (v9 §8.4). Espacios de indicador de la matriz de conflictividad; su materializacion es analytics.vw_anexo_15_matriz_conflictividad (§3.13). Sin slots hasta que exista el catalogo de indicadores (Tabla 3 de la Guia).'),
('minister_view',
 'Minister View',
 NULL,
 'Plantilla del Nivel 1 (v9 §8.4). Salida ejecutiva de la Capa 6: 200 palabras, tres vinetas y tres citas, con el pie del lente de politica. Sin slots hasta que exista el catalogo de indicadores (Tabla 3 de la Guia).')
ON CONFLICT (codigo) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Derivados — caché de las 6 vistas materializadas (P0 7)
--
--    REFRESH no concurrente (el concurrente no puede correr dentro de una
--    transacción). Se recorren sólo las que existen para que el parche no
--    falle en una base a la que le falte una vista.
--
--    Nota: esto cierra la obsolescencia cuando se aplica el parche, pero el
--    cargador del legado debe seguir refrescando al terminar (ver informe
--    §5.4). Las cuatro vistas que dependen de tablas aún vacías seguirán en 0:
--    eso es correcto, no un error.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT n.nspname AS esq, c.relname AS vista
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'm'
           AND (n.nspname, c.relname) IN (
                ('analytics', 'mv_dashboard_alta_direccion'),
                ('analytics', 'mv_tablero_decisional'),
                ('analytics', 'mv_compromisos_inter_ministeriales'),
                ('analytics', 'mv_drift_embeddings'),
                ('analytics', 'mv_drift_grafo'),
                ('mype',      'mv_concentracion_lotes')
               )
         ORDER BY 1, 2
    LOOP
        EXECUTE format('REFRESH MATERIALIZED VIEW %I.%I', r.esq, r.vista);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Verificación del parche
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_n     INT;
    v_falta TEXT;
BEGIN
    SELECT count(*) INTO v_n FROM core.cat_pip_etapas;
    IF v_n < 12 THEN
        RAISE EXCEPTION 'Parche 5 incompleto: core.cat_pip_etapas tiene % filas (se esperaban 12)', v_n;
    END IF;

    SELECT string_agg(x, ', ')
      INTO v_falta
      FROM (
            SELECT 'avisa.raw_ingest.v1' AS x
             WHERE NOT EXISTS (SELECT 1 FROM config.schema_registry
                                WHERE codigo = 'avisa.raw_ingest' AND version = 'v1')
            UNION ALL
            SELECT 'avisa.raw_ingest.v2'
             WHERE NOT EXISTS (SELECT 1 FROM config.schema_registry
                                WHERE codigo = 'avisa.raw_ingest' AND version = 'v2')
            UNION ALL
            SELECT 'agent.cat_detalle_schema v1'
             WHERE NOT EXISTS (SELECT 1 FROM agent.cat_detalle_schema WHERE version = 1)
           ) f;
    IF v_falta IS NOT NULL THEN
        RAISE EXCEPTION 'Parche 5 incompleto: falta %', v_falta;
    END IF;

    SELECT count(*) INTO v_n FROM ind.plantilla;
    IF v_n < 3 THEN
        RAISE EXCEPTION 'Parche 5 incompleto: ind.plantilla tiene % filas (se esperaban >= 3)', v_n;
    END IF;

    RAISE NOTICE
        'Parche 5 aplicado: % etapas PIP, raw_ingest v1+v2, detalle_schema v1, % plantilla(s) ind; matviews refrescadas.',
        (SELECT count(*) FROM core.cat_pip_etapas),
        (SELECT count(*) FROM ind.plantilla);
END $$;

COMMIT;
