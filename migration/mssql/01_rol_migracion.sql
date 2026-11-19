-- =====================================================================
--  AVISA · Paso 2 · Rol de migración para SSMA
-- =====================================================================
--  POR QUÉ HACE FALTA
--  SSMA lee la base como cualquier otro cliente. Si se conecta con un rol
--  sujeto a las políticas de seguridad por fila (RLS) y sin el contexto de
--  sesión, PostgreSQL no devuelve un error: devuelve CERO filas. El
--  asistente migraría 37 tablas vacías y el informe diría «correcto».
--  Ese fallo silencioso es la razón de este rol.
--
--  QUÉ HACE
--  Crea un rol de login con BYPASSRLS, que ve todas las filas sin depender
--  de app.rol_codigo, y le concede lectura sobre lo que se va a migrar.
--  Solo lectura: SSMA no necesita escribir en origen.
--
--  CÓMO SE EJECUTA
--  La contraseña NO vive en el repositorio. Se pasa como variable:
--
--      cat migration/mssql/01_rol_migracion.sql \
--        | docker compose exec -T db psql -U avisa -d avisa_mssql \
--              -v migrador_password='<clave temporal>'
--
--  Sin la variable, el script aborta a propósito (mismo criterio que el
--  parche 9 con crypto_key).
--
--  SEGURIDAD
--  BYPASSRLS es la excepción explícita a la seguridad por fila. Este rol:
--    · existe solo mientras dura la migración;
--    · no tiene privilegios de escritura;
--    · debe eliminarse al terminar:
--          DROP OWNED BY ssql_migrator; DROP ROLE ssql_migrator;
--
--  IDEMPOTENTE: reafirma atributos y re-concede privilegios.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'AVISA · Paso 2 · rol de migración'

-- ---------------------------------------------------------------------
-- 0 · La clave llega por variable, nunca en el archivo
-- ---------------------------------------------------------------------
\if :{?migrador_password}
\else
    \echo 'ABORTA: falta -v migrador_password=<clave temporal>.'
    \echo 'La contraseña no se escribe en el repositorio.'
    \quit 3
\endif

-- ---------------------------------------------------------------------
-- 1 · El rol
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssql_migrator') THEN
        CREATE ROLE ssql_migrator LOGIN NOSUPERUSER NOINHERIT
                                 NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        RAISE NOTICE 'rol ssql_migrator creado';
    ELSE
        RAISE NOTICE 'rol ssql_migrator ya existía; se reafirman atributos';
    END IF;

    -- Se reafirma siempre: si alguien lo elevó, el script lo devuelve a su sitio.
    ALTER ROLE ssql_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
    ALTER ROLE ssql_migrator BYPASSRLS;
END
$$;

ALTER ROLE ssql_migrator PASSWORD :'migrador_password';

COMMENT ON ROLE ssql_migrator IS
    'Rol temporal de lectura para SQL Server Migration Assistant. Tiene '
    'BYPASSRLS porque, sin él, SSMA migra tablas vacías sin dar error. '
    'Solo lectura, sin escritura en origen. Eliminar al terminar la '
    'migración: DROP OWNED BY ssql_migrator; DROP ROLE ssql_migrator;';

-- ---------------------------------------------------------------------
-- 2 · Privilegios: sólo leer
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA core, audit, ind, policy, staging, legacy, ref, qda,
                       agent, analytics
   TO ssql_migrator;

GRANT SELECT ON ALL TABLES IN SCHEMA core, audit, ind, policy, staging,
                                  legacy, ref, qda, agent, analytics
   TO ssql_migrator;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core, audit, ind, policy,
                                               staging, ref, qda, agent
   TO ssql_migrator;

-- ---------------------------------------------------------------------
-- 3 · Comprobación: ¿de verdad ve filas con la RLS activa?
-- ---------------------------------------------------------------------
-- Se comparan dos lecturas de una tabla con FORCE ROW LEVEL SECURITY:
--   · como el rol de la aplicación, sin contexto  → debe dar 0
--   · como ssql_migrator, con BYPASSRLS           → debe dar el total
-- Si ambos coincidieran, algo está mal y hay que mirar antes de migrar.
DO $$
DECLARE
    v_total   bigint;
    v_app     bigint;
    v_migra   bigint;
BEGIN
    SELECT count(*) INTO v_total FROM core.actores;

    -- Rol de la aplicación, sin contexto de sesión: RLS cierra el paso.
    SET LOCAL ROLE avisa_app;
    PERFORM set_config('app.rol_codigo', '', true);
    SELECT count(*) INTO v_app FROM core.actores;
    RESET ROLE;

    -- Rol de migración: BYPASSRLS abre el paso.
    SET LOCAL ROLE ssql_migrator;
    SELECT count(*) INTO v_migra FROM core.actores;
    RESET ROLE;

    RAISE NOTICE 'core.actores: total % · avisa_app sin contexto % · ssql_migrator %',
                 v_total, v_app, v_migra;

    IF v_migra <> v_total THEN
        RAISE EXCEPTION
            'FALLO: ssql_migrator ve % de % filas. SSMA migraría datos incompletos.',
            v_migra, v_total;
    END IF;
    IF v_app <> 0 THEN
        RAISE NOTICE 'AVISO: avisa_app sin contexto ve % filas; revisar políticas',
                     v_app;
    END IF;
    RAISE NOTICE 'OK: el rol de migración ve todas las filas';
END
$$;

\echo ''
\echo 'Paso 2 aplicado. Conectar SSMA con:'
\echo '  usuario  ssql_migrator'
\echo '  base     avisa_mssql'
\echo '  puerto   55433'
\echo ''
