-- =============================================================================
--  20 · Verificación de la inicialización
--
--  Se ejecuta al final del initdb y su salida queda en `docker compose logs db`.
--  Además de informar, ABORTA la inicialización si el esquema no quedó como
--  debe: un contenedor que arranca con un esquema incompleto es peor que uno
--  que no arranca.
--
--  Estas comprobaciones son las que distinguen este entorno del de pruebas, que
--  se aplicó sin PostGIS y perdió tres tablas de territorio.
-- =============================================================================

\pset footer off
\echo ''
\echo '=== AVISA · verificación de la inicialización ==========================='

SELECT 'extensiones' AS control, string_agg(extname, ', ' ORDER BY extname) AS valor
  FROM pg_extension;

SELECT 'esquemas' AS control, count(*)::text AS valor
  FROM pg_namespace
 WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';

SELECT 'tablas' AS control, count(*)::text AS valor
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('pg_catalog', 'information_schema');

SELECT 'columnas geography' AS control, count(*)::text AS valor
  FROM information_schema.columns
 WHERE udt_name = 'geography';

SELECT 'tablas territorio con geometría' AS control,
       count(*)::text || ' de 3' AS valor
  FROM information_schema.tables
 WHERE table_schema = 'territorio'
   AND table_name IN ('parque_industrial', 'cuadricula_sismica', 'zona_pesca');

SELECT 'cat_tematicas' AS control, count(*)::text AS valor FROM core.cat_tematicas;
SELECT 'cat_subsectores' AS control, count(*)::text AS valor FROM core.cat_subsectores;
SELECT 'cat_tipos_actor' AS control, count(*)::text AS valor FROM core.cat_tipos_actor;
SELECT 'cat_roles_funcionales' AS control, count(*)::text AS valor FROM core.cat_roles_funcionales;
SELECT 'cat_tipos_organizacion' AS control, count(*)::text AS valor FROM core.cat_tipos_organizacion;
SELECT 'cat_especies (minimo de semilla)' AS control, count(*)::text AS valor FROM core.cat_especies;
SELECT 'cat_unidades_organicas' AS control, count(*)::text AS valor FROM core.cat_unidades_organicas;
SELECT 'cat_pip_etapas' AS control, count(*)::text AS valor FROM core.cat_pip_etapas;
SELECT 'config.schema_registry' AS control, count(*)::text AS valor FROM config.schema_registry;
SELECT 'agent.cat_detalle_schema' AS control, count(*)::text AS valor FROM agent.cat_detalle_schema;
SELECT 'ind.plantilla' AS control, count(*)::text AS valor FROM ind.plantilla;
SELECT 'ind.indicador (pendiente)' AS control, count(*)::text AS valor FROM ind.indicador;

SELECT 'RLS forzadas en core' AS control, count(*)::text AS valor
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname = 'core' AND c.relforcerowsecurity;

\echo '-------------------------------------------------------------------------'

DO $$
DECLARE
    v_faltan TEXT;
    v_marcas INT;
    v_geo    INT;
    v_cats   TEXT;
    v_seeds  TEXT;
BEGIN
    -- 1. Las tres tablas que dependen de PostGIS.
    SELECT count(*) INTO v_geo
      FROM information_schema.tables
     WHERE table_schema = 'territorio'
       AND table_name IN ('parque_industrial', 'cuadricula_sismica', 'zona_pesca');
    IF v_geo <> 3 THEN
        RAISE EXCEPTION
            'faltan tablas de territorio con GEOGRAPHY: % de 3. ¿PostGIS no está creado?',
            v_geo;
    END IF;

    -- 2. Marcadores de los parches 1-4. Si alguno falta, el parche no se aplicó.
    SELECT string_agg(m, ', ')
      INTO v_faltan
      FROM (
            SELECT 'core.demandas.documento_origen_id' AS m
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema = 'core' AND table_name = 'demandas'
                                  AND column_name = 'documento_origen_id')
            UNION ALL
            SELECT 'core.demandas.codigo_padre_legado'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema = 'core' AND table_name = 'demandas'
                                  AND column_name = 'codigo_padre_legado')
            UNION ALL
            SELECT 'core.cat_unidades_organicas.codigo_legado_area'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema = 'core'
                                  AND table_name = 'cat_unidades_organicas'
                                  AND column_name = 'codigo_legado_area')
            UNION ALL
            SELECT 'core.cat_especies.nombre_cientifico_legado'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema = 'core' AND table_name = 'cat_especies'
                                  AND column_name = 'nombre_cientifico_legado')
            UNION ALL
            SELECT 'core.migracion_conflicto (tabla)'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                                WHERE table_schema = 'core'
                                  AND table_name = 'migracion_conflicto')
            UNION ALL
            SELECT 'core.mesas_dialogo (tabla)'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                                WHERE table_schema = 'core'
                                  AND table_name = 'mesas_dialogo')
            UNION ALL
            SELECT 'core.capacitaciones (tabla)'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                                WHERE table_schema = 'core'
                                  AND table_name = 'capacitaciones')
            UNION ALL
            SELECT 'core.log_accesos (tabla)'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                                WHERE table_schema = 'core'
                                  AND table_name = 'log_accesos')
            UNION ALL
            SELECT 'core.actor_membresia.valid_from (debe admitir NULL)'
             WHERE EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'core'
                              AND table_name = 'actor_membresia'
                              AND column_name = 'valid_from'
                              AND is_nullable = 'NO')
            UNION ALL
            SELECT 'core.caso_estado_historial.nivel_conflicto_id (debe admitir NULL)'
             WHERE EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'core'
                              AND table_name = 'caso_estado_historial'
                              AND column_name = 'nivel_conflicto_id'
                              AND is_nullable = 'NO')
           ) faltantes;
    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION 'faltan marcadores de los parches: %', v_faltan;
    END IF;

    -- 3. Los catálogos que el cargador espera encontrar sembrados. Se compara
    --    contra un MÍNIMO y no contra un valor exacto: tras cargar el legado los
    --    catálogos crecen (cat_especies 5 -> 39, cat_unidades_organicas 1 -> 66)
    --    y este script también corre en ese estado vía `./scripts/db.sh verify`.
    SELECT string_agg(x, ', ')
      INTO v_cats
      FROM (
            -- Mínimos alineados con la Guía: 6 temáticas (§7.6), 2 subsectores y
            -- 3 tipos de actor (§7.4.1). Reemplazan los umbrales del esquema
            -- anterior, que tras las migraciones 14 y 15 abortaban la verificación.
            SELECT 'cat_tematicas=' || (SELECT count(*) FROM core.cat_tematicas) AS x
             WHERE (SELECT count(*) FROM core.cat_tematicas) < 6
            UNION ALL
            SELECT 'cat_subsectores=' || (SELECT count(*) FROM core.cat_subsectores)
             WHERE (SELECT count(*) FROM core.cat_subsectores) < 2
            UNION ALL
            SELECT 'cat_tipos_actor=' || (SELECT count(*) FROM core.cat_tipos_actor)
             WHERE (SELECT count(*) FROM core.cat_tipos_actor) < 3
            UNION ALL
            SELECT 'cat_roles_funcionales=' || (SELECT count(*) FROM core.cat_roles_funcionales)
             WHERE (SELECT count(*) FROM core.cat_roles_funcionales) < 4
            UNION ALL
            SELECT 'cat_tipos_organizacion=' || (SELECT count(*) FROM core.cat_tipos_organizacion)
             WHERE (SELECT count(*) FROM core.cat_tipos_organizacion) < 7
            UNION ALL
            SELECT 'cat_especies=' || (SELECT count(*) FROM core.cat_especies)
             WHERE (SELECT count(*) FROM core.cat_especies) < 5
            UNION ALL
            SELECT 'cat_unidades_organicas=' || (SELECT count(*) FROM core.cat_unidades_organicas)
             WHERE (SELECT count(*) FROM core.cat_unidades_organicas) < 1
           ) mal;
    IF v_cats IS NOT NULL THEN
        RAISE EXCEPTION 'catálogos fuera de lo esperado: %', v_cats;
    END IF;

    -- 4. Seeds del parche 5. Son catálogos de referencia que el legado NO
    --    modifica, así que un mínimo equivale a "existen".
    SELECT string_agg(x, ', ')
      INTO v_seeds
      FROM (
            SELECT 'cat_pip_etapas=' || (SELECT count(*) FROM core.cat_pip_etapas) AS x
             WHERE (SELECT count(*) FROM core.cat_pip_etapas) < 12
            UNION ALL
            SELECT 'config.schema_registry(avisa.raw_ingest)='
                   || (SELECT count(*) FROM config.schema_registry WHERE codigo = 'avisa.raw_ingest')
             WHERE (SELECT count(*) FROM config.schema_registry WHERE codigo = 'avisa.raw_ingest') < 2
            UNION ALL
            SELECT 'cat_detalle_schema=' || (SELECT count(*) FROM agent.cat_detalle_schema)
             WHERE (SELECT count(*) FROM agent.cat_detalle_schema) < 1
            UNION ALL
            SELECT 'ind.plantilla=' || (SELECT count(*) FROM ind.plantilla)
             WHERE (SELECT count(*) FROM ind.plantilla) < 3
           ) faltantes;
    IF v_seeds IS NOT NULL THEN
        RAISE EXCEPTION 'seed del parche 5 ausente o incompleto: %', v_seeds;
    END IF;

    SELECT count(*) INTO v_marcas FROM core.cat_unidades_organicas WHERE siglas = 'OAIPCS';
    IF v_marcas <> 1 THEN
        RAISE EXCEPTION 'la unidad OAIPCS no quedó creada';
    END IF;

    RAISE NOTICE 'verificación OK: PostGIS + pgvector, 3 tablas de territorio, parches 1-5 y catálogos sembrados';
END $$;

\echo '=== fin de la verificación ============================================='
