-- =====================================================================
--  AVISA · Prueba definitiva de la preparación para SQL Server
-- =====================================================================
--  Verifica que la base de staging quedó realmente como el plan exige,
--  no como "parece". Todo son aserciones: si algo falla, el script
--  aborta con el número de la comprobación.
--
--  Cubre los pasos 1, 2 y 3 del plan:
--    1 · alcance aislado y cerrado por dependencias (73 tablas) + legacy
--    2 · rol de migración con BYPASSRLS
--    3 · tipos incompatibles normalizados
--
--  Cómo se ejecuta
--    cat migration/tests/test_migracion_mssql.sql \
--      | docker compose exec -T db psql -U avisa -d avisa_mssql
--
--  Es de sólo lectura: no modifica nada.
-- =====================================================================

\set ON_ERROR_STOP on
\echo ''
\echo '=== TEST · preparación de la migración a SQL Server ==='

DO $$
BEGIN
    IF current_database() <> 'avisa_mssql' THEN
        RAISE EXCEPTION 'Este test se ejecuta en avisa_mssql (actual: %)',
                        current_database();
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1 · Alcance aislado
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_core   int;
    v_audit  int;
    v_ind    int;
    v_policy int;
    v_qda    int;
    v_stg    int;
    v_agent  int;
    v_ref    int;
    v_legacy int;
    v_kag    int;
    v_total  int;
    v_fuera  text;
    v_huerfanas int;
BEGIN
    SELECT count(*) INTO v_core   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='core';
    SELECT count(*) INTO v_audit  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='audit';
    SELECT count(*) INTO v_ind    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='ind';
    SELECT count(*) INTO v_policy FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='policy';
    SELECT count(*) INTO v_qda    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='qda';
    SELECT count(*) INTO v_stg    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='staging';
    SELECT count(*) INTO v_agent  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='agent';
    SELECT count(*) INTO v_ref    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='ref';
    SELECT count(*) INTO v_kag    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='kag';
    SELECT count(*) INTO v_legacy FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname='legacy';

    IF v_core <> 53 THEN RAISE EXCEPTION '1a: core tiene % tablas (esperado 53)', v_core; END IF;
    IF v_audit <> 1 THEN RAISE EXCEPTION '1a: audit tiene % (esperado 1)', v_audit; END IF;
    IF v_ind <> 3   THEN RAISE EXCEPTION '1a: ind tiene % (esperado 3)', v_ind; END IF;
    IF v_policy <> 7 THEN RAISE EXCEPTION '1a: policy tiene % (esperado 7)', v_policy; END IF;
    IF v_qda <> 2   THEN RAISE EXCEPTION '1a: qda tiene % (esperado 2)', v_qda; END IF;
    IF v_stg <> 1   THEN RAISE EXCEPTION '1a: staging tiene % (esperado 1)', v_stg; END IF;
    IF v_agent <> 1 THEN RAISE EXCEPTION '1a: agent tiene % (esperado 1)', v_agent; END IF;
    IF v_ref <> 2   THEN RAISE EXCEPTION '1a: ref tiene % (esperado 2)', v_ref; END IF;
    IF v_kag <> 3   THEN RAISE EXCEPTION '1a: kag tiene % (esperado 3)', v_kag; END IF;
    IF v_legacy <> 87 THEN RAISE EXCEPTION '1a: legacy tiene % (esperado 87)', v_legacy; END IF;

    RAISE NOTICE 'OK 1a · 73 tablas del alcance + ref(2) + kag(3) + legacy(87)';

    -- Ningún esquema diferido sobrevive.
    SELECT string_agg(nspname, ', ') INTO v_fuera
      FROM pg_namespace
     WHERE nspname IN ('analisis','avisa','chat','community','config',
                       'consultation','ctx','domain','economic','forecast',
                       'impact','lex','model','mype','pesca',
                       'proteccion','territorio');
    IF v_fuera IS NOT NULL THEN
        RAISE EXCEPTION '1b: sobreviven esquemas fuera de alcance: %', v_fuera;
    END IF;
    RAISE NOTICE 'OK 1b · ningún esquema diferido sobrevive';

    -- Sin tablas particionadas: SSMA las migraría como tablas sueltas.
    SELECT count(*) INTO v_total
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind='p' AND n.nspname NOT LIKE 'pg\_%';
    IF v_total <> 0 THEN
        RAISE EXCEPTION '1c: quedan % tablas particionadas', v_total;
    END IF;
    RAISE NOTICE 'OK 1c · sin tablas particionadas (agent.run_log aplanada)';

    -- Total: 161 (73 del alcance + 87 legacy + 1 PostGIS).
    SELECT count(*) INTO v_total
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg\_%'
       AND n.nspname <> 'information_schema';
    IF v_total <> 161 THEN
        RAISE EXCEPTION '1d: la base tiene % tablas (esperado 161)', v_total;
    END IF;
    RAISE NOTICE 'OK 1d · 161 tablas en total (eran 371)';

    -- 1e · Guardia contra el defecto de recorte sin dependencias.
    --      El esquema del alcance debe conservar TODAS las claves ajenas que
    --      sus tablas tenían entre sí (153). Si alguien vuelve a borrar un
    --      padre, el CASCADE se lleva la FK, este número baja y el test
    --      falla: así no pasan inadvertidas las columnas huérfanas.
    SELECT count(*) INTO v_huerfanas
      FROM pg_constraint k
      JOIN pg_class     c1 ON c1.oid = k.conrelid
      JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
     WHERE k.contype = 'f'
       AND n1.nspname NOT LIKE 'pg\_%';
    IF v_huerfanas <> 153 THEN
        RAISE EXCEPTION '1e: el alcance conserva % claves ajenas (esperado 153)',
                        v_huerfanas;
    END IF;

    -- Y ninguna puede apuntar a una tabla que no exista.
    SELECT count(*) INTO v_huerfanas
      FROM pg_constraint k
      JOIN pg_class     c1 ON c1.oid = k.conrelid
      JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
      JOIN pg_class     c2 ON c2.oid = k.confrelid
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
     WHERE k.contype = 'f'
       AND n1.nspname NOT LIKE 'pg\_%'
       AND to_regclass(n2.nspname || '.' || c2.relname) IS NULL;
    IF v_huerfanas <> 0 THEN
        RAISE EXCEPTION '1e: % claves ajenas apuntan a tablas inexistentes', v_huerfanas;
    END IF;
    RAISE NOTICE 'OK 1e · 153 claves ajenas conservadas, ninguna huérfana';
END $$;

-- ---------------------------------------------------------------------
-- 2 · Rol de migración
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_login  boolean;
    v_bypass boolean;
    v_super  boolean;
    v_escrit boolean;
    v_n      bigint;
    v_total  bigint;
BEGIN
    SELECT rolcanlogin, rolbypassrls, rolsuper
      INTO v_login, v_bypass, v_super
      FROM pg_roles WHERE rolname = 'ssql_migrator';

    IF NOT v_login  THEN RAISE EXCEPTION '2a: ssql_migrator no puede entrar'; END IF;
    IF NOT v_bypass THEN RAISE EXCEPTION '2a: ssql_migrator no tiene BYPASSRLS'; END IF;
    IF v_super      THEN RAISE EXCEPTION '2a: ssql_migrator es superusuario'; END IF;
    RAISE NOTICE 'OK 2a · ssql_migrator: login sí, BYPASSRLS sí, superusuario no';

    -- El rol sólo lee: no debe poder escribir en origen.
    SELECT has_table_privilege('ssql_migrator', 'core.actores', 'INSERT')
      INTO v_escrit;
    IF v_escrit THEN RAISE EXCEPTION '2b: ssql_migrator puede INSERT'; END IF;
    RAISE NOTICE 'OK 2b · ssql_migrator es de sólo lectura';

    -- Y ve todas las filas pese a la RLS: es la razón de ser del rol.
    SELECT count(*) INTO v_total FROM core.actores;
    SET LOCAL ROLE ssql_migrator;
    SELECT count(*) INTO v_n FROM core.actores;
    RESET ROLE;

    IF v_n <> v_total OR v_n <> 1160 THEN
        RAISE EXCEPTION '2c: ssql_migrator ve % de % (esperado 1160)', v_n, v_total;
    END IF;
    RAISE NOTICE 'OK 2c · ssql_migrator ve las 1160 filas de core.actores';
END $$;

-- ---------------------------------------------------------------------
-- 3 · Tipos normalizados
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_n int;
BEGIN
    SELECT count(*) INTO v_n
      FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND data_type = 'uuid'
       AND column_default IS NOT NULL;
    IF v_n <> 0 THEN
        RAISE EXCEPTION '3a: quedan % columnas uuid con DEFAULT', v_n;
    END IF;
    RAISE NOTICE 'OK 3a · ningún uuid conserva DEFAULT (se recreará como NEWID)';

    SELECT count(*) INTO v_n
      FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND data_type = 'ARRAY';
    IF v_n <> 0 THEN
        RAISE EXCEPTION '3b: quedan % columnas array', v_n;
    END IF;
    RAISE NOTICE 'OK 3b · ninguna columna array';

    SELECT count(*) INTO v_n
      FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
       AND data_type = 'jsonb';
    IF v_n <> 12 THEN
        RAISE EXCEPTION '3c: hay % columnas jsonb (esperado 12)', v_n;
    END IF;
    RAISE NOTICE 'OK 3c · 12 columnas jsonb, intactas para mapear a NVARCHAR(MAX)';
END $$;

-- ---------------------------------------------------------------------
-- 4 · Los datos y el modelo siguen ahí
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r record;
    v_n bigint;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('core.actores', 1160::bigint),
            ('core.casos', 35),
            ('core.alertas_tempranas', 83),
            ('core.usuarios', 32),
            ('core.actor_datos_personales', 847),
            ('audit.datos_personales_acceso', 3088),
            ('core.regiones', 25),
            ('core.provincias', 70),
            ('core.distritos', 698),
            ('core.cat_unidades_organicas', 66),
            ('core.documentos', 153),
            ('core.mesas_dialogo', 21)
        ) AS t(tabla, esperado)
    LOOP
        EXECUTE format('SELECT count(*) FROM %s', r.tabla) INTO v_n;
        IF v_n <> r.esperado THEN
            RAISE EXCEPTION '4a: % tiene % filas (esperado %)',
                            r.tabla, v_n, r.esperado;
        END IF;
    END LOOP;
    RAISE NOTICE 'OK 4a · los datos del MVP y sus catálogos están completos';

    -- La seguridad por fila sigue existiendo en origen; SSMA no la migrará,
    -- pero la base de staging no debe haberla perdido.
    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relrowsecurity AND c.relkind='r';
    IF v_n <> 15 THEN
        RAISE EXCEPTION '4b: hay % tablas con RLS (esperado 15)', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM pg_policies;
    IF v_n <> 97 THEN
        RAISE EXCEPTION '4c: hay % políticas RLS (esperado 97)', v_n;
    END IF;
    RAISE NOTICE 'OK 4b · RLS intacta en origen: 15 tablas, 97 políticas';

    SELECT count(*) INTO v_n
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     WHERE NOT t.tgisinternal;
    RAISE NOTICE '     triggers que SSMA no migrará ......... %', v_n;
END $$;

\echo ''
\echo '=== TEST terminado · sin excepciones ==='
\echo ''
