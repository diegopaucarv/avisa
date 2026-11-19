-- =====================================================================
--  AVISA · PARCHE 15 · El rol manda: nivel y capacidades
-- =====================================================================
--  QUÉ ARREGLA
--
--  1. Bug rol → nivel. `core.clasificacion_max()` leía el parámetro de
--     sesión `app.clasificacion_max`, que la aplicación declaraba por su
--     cuenta. La base nunca comprobaba que ese número correspondiera al
--     rol del usuario: un error de una línea en la API daba nivel 3 a
--     cualquiera. Ahora el nivel se deduce de `app.rol_codigo` contra
--     `core.roles.max_clasificacion`. El rol es la única fuente de verdad.
--
--  2. Bug capacidad → nivel. El nivel de clasificación no distingue
--     "leer" de "escribir". Por eso `consulta_lectura` (17 de los 32
--     usuarios) podía INSERTAR y ACTUALIZAR filas de nivel 1 y 2, pese a
--     llamarse "consulta". Se añaden tres capacidades explícitas en
--     `core.roles` —crear, editar, eliminar— y se hacen cumplir con
--     políticas RLS restrictivas sobre toda tabla que ya tuviera
--     políticas por clasificación.
--
--  3. `auditor` conserva escritura (edita) pero pierde el borrado.
--
--  4. `avisa_app` deja de ser un rol inalcanzable. Se mantiene como rol
--     de grupo (sin login, sin BYPASSRLS) y se crea `avisa_api`, el rol
--     de login que la API debe usar. Sin contraseña a propósito: se fija
--     fuera del repositorio (ver bloque 4).
--
--  ORDEN
--  Debe ejecutarse DESPUÉS del parche 14 (que crea `avisa_app`).
--
--  IDEMPOTENTE
--  Se puede re-ejecutar sin efectos acumulativos.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'PARCHE 15 · bloque 1/5 · capacidades explícitas en core.roles'

-- ---------------------------------------------------------------------
-- 1.1 · Tres columnas nuevas
-- ---------------------------------------------------------------------
-- El nivel (`max_clasificacion`) dice QUÉ puede ver un rol.
-- Estas tres dicen QUÉ puede hacer. Son ortogonales: un auditor ve lo
-- confidencial (nivel 3) y edita, pero no borra.
ALTER TABLE core.roles
    ADD COLUMN IF NOT EXISTS puede_crear    boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS puede_editar   boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS puede_eliminar boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core.roles.puede_crear IS
    'Autoriza INSERT en las tablas con RLS por clasificación. El nivel '
    'máximo sigue limitando qué filas (max_clasificacion).';
COMMENT ON COLUMN core.roles.puede_editar IS
    'Autoriza UPDATE en las tablas con RLS por clasificación.';
COMMENT ON COLUMN core.roles.puede_eliminar IS
    'Autoriza DELETE. Nunca se concede sin puede_editar (ver '
    'ck_roles_capacidades). El borrado de registros de conflictividad es '
    'destructivo y queda reservado a los roles que administran el dato.';

-- ---------------------------------------------------------------------
-- 1.2 · Valores por rol
-- ---------------------------------------------------------------------
-- Criterio aplicado, rol por rol:
--   sectorista           anota en territorio: crea, corrige y puede retirar
--                        un registro equivocado.
--   administrador        dueño funcional del dato, incluye al ODP.
--   consulta_lectura     es el rol más numeroso (17 usuarios). Solo lee.
--   alta_direccion       lee todo y puede emitir/corregir productos.
--   servicio_agente      servicio automático: escribe, no borra.
--   auditor              revisa y corrige observaciones, no borra.
--   externo_publico      solo lectura de lo público.
--   analista_cualitativo produce análisis: escribe, no borra.
--   curador_politica     mantiene base legal y política (nivel 2): escribe,
--                        no borra.
UPDATE core.roles SET puede_crear = true,  puede_editar = true,  puede_eliminar = true
 WHERE codigo IN ('sectorista', 'administrador', 'alta_direccion');

UPDATE core.roles SET puede_crear = true,  puede_editar = true,  puede_eliminar = false
 WHERE codigo IN ('servicio_agente', 'auditor', 'analista_cualitativo', 'curador_politica');

UPDATE core.roles SET puede_crear = false, puede_editar = false, puede_eliminar = false
 WHERE codigo IN ('consulta_lectura', 'externo_publico');

-- Coherencia: quien no edita no borra. Borrar sin poder corregir antes
-- sería un poder más amplio que el de editar, y eso no tiene sentido.
ALTER TABLE core.roles DROP CONSTRAINT IF EXISTS ck_roles_capacidades;
ALTER TABLE core.roles
    ADD CONSTRAINT ck_roles_capacidades
    CHECK (NOT puede_eliminar OR puede_editar);

\echo 'PARCHE 15 · bloque 2/5 · funciones de contexto'

-- ---------------------------------------------------------------------
-- 2.1 · Rol de la sesión
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.rol_actual()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.rol_codigo', true), '');
$$;

COMMENT ON FUNCTION core.rol_actual() IS
    'Código del rol de la sesión (core.roles.codigo), leído del parámetro '
    'app.rol_codigo que fija la aplicación al autenticar. NULL si no se fijó.';

-- ---------------------------------------------------------------------
-- 2.2 · Nivel de clasificación derivado del rol
-- ---------------------------------------------------------------------
-- Cambio de contrato: `app.clasificacion_max` deja de leerse. Se mantiene
-- la firma para no tocar las 175 políticas existentes, pero el valor ya
-- no lo dicta el cliente: sale de la tabla de roles.
-- Rol ausente o desconocido → 0 → ninguna fila visible. El silencio
-- cierra, igual que en core.puede_auditar().
CREATE OR REPLACE FUNCTION core.clasificacion_max()
RETURNS smallint
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, core
AS $$
    SELECT COALESCE(
        (SELECT r.max_clasificacion
           FROM core.roles r
          WHERE r.codigo = core.rol_actual()),
        0::smallint
    );
$$;

COMMENT ON FUNCTION core.clasificacion_max() IS
    'Nivel máximo de clasificación del rol de la sesión, tomado de '
    'core.roles.max_clasificacion. Ya NO lee app.clasificacion_max: ese '
    'parámetro lo declaraba el cliente y permitía escalar privilegios.';

-- ---------------------------------------------------------------------
-- 2.3 · Capacidades de la sesión
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.puede_crear()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, core
AS $$
    SELECT COALESCE(
        (SELECT r.puede_crear FROM core.roles r WHERE r.codigo = core.rol_actual()),
        false
    );
$$;

CREATE OR REPLACE FUNCTION core.puede_editar()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, core
AS $$
    SELECT COALESCE(
        (SELECT r.puede_editar FROM core.roles r WHERE r.codigo = core.rol_actual()),
        false
    );
$$;

CREATE OR REPLACE FUNCTION core.puede_eliminar()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, core
AS $$
    SELECT COALESCE(
        (SELECT r.puede_eliminar FROM core.roles r WHERE r.codigo = core.rol_actual()),
        false
    );
$$;

COMMENT ON FUNCTION core.puede_crear()    IS 'true si el rol de la sesión puede INSERT (core.roles.puede_crear).';
COMMENT ON FUNCTION core.puede_editar()   IS 'true si el rol de la sesión puede UPDATE (core.roles.puede_editar).';
COMMENT ON FUNCTION core.puede_eliminar() IS 'true si el rol de la sesión puede DELETE (core.roles.puede_eliminar).';

\echo 'PARCHE 15 · bloque 3/5 · políticas restrictivas de capacidad'

-- ---------------------------------------------------------------------
-- 3.1 · Una política restrictiva por tabla y operación
-- ---------------------------------------------------------------------
-- Las políticas del parche 13 son PERMISSIVE: se combinan con OR y solo
-- miran el nivel. Una política RESTRICTIVE se combina con AND, de modo
-- que basta una por tabla para exigir la capacidad, sin reescribir las
-- existentes.
--
-- Alcance: toda tabla que hoy tenga al menos una política PERMISSIVE de
-- INSERT, UPDATE o DELETE por clasificación. Se excluyen:
--   · audit  — la bitácora debe poder registrarse desde cualquier sesión;
--              si se exigiera puede_crear(), una consulta de solo lectura
--              no podría dejar rastro de su propio acceso.
--   · staging — esquema de trabajo del cargador, que corre con otro rol.
DO $$
DECLARE
    r        record;
    v_policy text;
    v_count  int := 0;
BEGIN
    FOR r IN
        SELECT DISTINCT p.schemaname AS sch, p.tablename AS tbl, p.cmd
          FROM pg_policies p
         WHERE p.cmd IN ('INSERT', 'UPDATE', 'DELETE')
           AND p.permissive = 'PERMISSIVE'
           AND p.schemaname NOT IN ('audit', 'staging')
         ORDER BY p.schemaname, p.tablename, p.cmd
    LOOP
        v_policy := 'r_rol_' || lower(r.cmd);

        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                       v_policy, r.sch, r.tbl);

        IF r.cmd = 'INSERT' THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR INSERT '
                'TO PUBLIC WITH CHECK (core.puede_crear())',
                v_policy, r.sch, r.tbl);
        ELSIF r.cmd = 'UPDATE' THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR UPDATE '
                'TO PUBLIC USING (core.puede_editar()) '
                'WITH CHECK (core.puede_editar())',
                v_policy, r.sch, r.tbl);
        ELSE
            EXECUTE format(
                'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR DELETE '
                'TO PUBLIC USING (core.puede_eliminar())',
                v_policy, r.sch, r.tbl);
        END IF;

        v_count := v_count + 1;
    END LOOP;

    RAISE NOTICE 'políticas restrictivas de capacidad: %', v_count;
END
$$;

\echo 'PARCHE 15 · bloque 4/5 · avisa_app deja de ser inalcanzable'

-- ---------------------------------------------------------------------
-- 4.1 · Dos roles, dos papeles
-- ---------------------------------------------------------------------
-- `avisa_app` (desde el parche 14) es el contenedor de privilegios: sin
-- login, sin BYPASSRLS, con los GRANT de todas las tablas. Sirve para
-- tener un solo lugar donde se conceden permisos.
--
-- Le faltaba un miembro con el que conectarse. `avisa_api` es ese
-- miembro. Se crea SIN contraseña: mientras nadie la fije, no puede
-- autenticarse, y el parche no deja una credencial escrita en el
-- repositorio.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_api') THEN
        CREATE ROLE avisa_api LOGIN NOSUPERUSER NOBYPASSRLS
                              NOCREATEDB NOCREATEROLE INHERIT;
        RAISE NOTICE 'rol avisa_api creado (LOGIN, sin contraseña)';
    ELSE
        ALTER ROLE avisa_api LOGIN NOSUPERUSER NOBYPASSRLS
                          NOCREATEDB NOCREATEROLE INHERIT;
        RAISE NOTICE 'rol avisa_api ya existía; atributos reafirmados';
    END IF;
END
$$;

GRANT avisa_app TO avisa_api;

COMMENT ON ROLE avisa_api IS
    'Rol de login de la API AVISA. Hereda los privilegios de avisa_app y, '
    'como ella, no tiene BYPASSRLS. Su contraseña se fija fuera del '
    'repositorio con ALTER ROLE ... PASSWORD y nunca se versiona.';

COMMENT ON ROLE avisa_app IS
    'Rol de grupo con los privilegios de la aplicación AVISA. Sin login y '
    'sin BYPASSRLS: la conexión real la hace avisa_api, que es su miembro. '
    'Las políticas de seguridad por fila se aplican a toda consulta hecha '
    'con este rol (RF-A03).';

-- ---------------------------------------------------------------------
-- 4.2 · Privilegios que faltaban
-- ---------------------------------------------------------------------
-- Las funciones de este parche son nuevas: el GRANT del parche 14 se
-- ejecutó antes de que existieran.
GRANT EXECUTE ON FUNCTION core.rol_actual(),        core.clasificacion_max(),
                          core.puede_crear(),       core.puede_editar(),
                          core.puede_eliminar()
   TO avisa_app;

-- El catálogo de roles es de lectura pública para la aplicación: sin él,
-- core.clasificacion_max() fallaría con permission denied.
GRANT SELECT ON core.roles TO avisa_app;

-- ---------------------------------------------------------------------
-- 4.3 · Privilegios por defecto para tablas futuras
-- ---------------------------------------------------------------------
-- Sin esto, cada tabla nueva nace invisible para la aplicación y el fallo
-- aparece en producción, no en el parche que la creó.
ALTER DEFAULT PRIVILEGES FOR ROLE avisa
    IN SCHEMA core, kag, ind, analisis, territorio, consultation, ref
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE avisa
    IN SCHEMA analytics, avisa
    GRANT SELECT ON TABLES TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE avisa
    IN SCHEMA core, kag, ind, analisis, territorio, consultation
    GRANT USAGE, SELECT ON SEQUENCES TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE avisa
    IN SCHEMA core, kag
    GRANT EXECUTE ON FUNCTIONS TO avisa_app;

\echo 'PARCHE 15 · bloque 5/5 · verificación'

-- ---------------------------------------------------------------------
-- 5.1 · Comprobaciones dentro del parche
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_n    int;
    v_b    boolean;
    v_b2   boolean;
    v_niv  smallint;
BEGIN
    -- Las nueve filas cumplen la coherencia eliminar→editar.
    SELECT count(*) INTO v_n
      FROM core.roles
     WHERE NOT puede_eliminar OR puede_editar;
    RAISE NOTICE 'roles con capacidades coherentes .... % de 9', v_n;

    -- auditor: edita pero no borra.
    SELECT puede_editar AND NOT puede_eliminar INTO v_b
      FROM core.roles WHERE codigo = 'auditor';
    RAISE NOTICE 'auditor: edita y no borra ........... %', v_b;

    -- consulta_lectura ya no escribe.
    SELECT NOT (puede_crear OR puede_editar OR puede_eliminar) INTO v_b
      FROM core.roles WHERE codigo = 'consulta_lectura';
    RAISE NOTICE 'consulta_lectura es solo lectura .... %', v_b;

    -- Sin rol fijado, el nivel es 0: nada visible.
    PERFORM set_config('app.rol_codigo', '', true);
    v_niv := core.clasificacion_max();
    RAISE NOTICE 'sin rol - clasificacion_max() ....... % (esperado 0)', v_niv;

    -- Con rol, el nivel sale de la tabla, no del cliente.
    PERFORM set_config('app.rol_codigo', 'consulta_lectura', true);
    v_niv := core.clasificacion_max();
    RAISE NOTICE 'consulta_lectura - clasificacion ..... % (esperado 2)', v_niv;

    PERFORM set_config('app.rol_codigo', 'alta_direccion', true);
    v_niv := core.clasificacion_max();
    RAISE NOTICE 'alta_direccion - clasificacion ....... % (esperado 3)', v_niv;

    -- Un rol inventado no abre nada.
    PERFORM set_config('app.rol_codigo', 'rol_que_no_existe', true);
    v_niv := core.clasificacion_max();
    v_b   := core.puede_crear();
    RAISE NOTICE 'rol inexistente - nivel % / puede_crear %', v_niv, v_b;

    -- avisa_api existe, hace login y no salta RLS.
    SELECT count(*) INTO v_n FROM pg_roles WHERE rolname = 'avisa_api' AND rolcanlogin;
    RAISE NOTICE 'avisa_api existe y puede login ....... % (esperado 1)', v_n;
    SELECT rolbypassrls, rolsuper INTO v_b, v_b2 FROM pg_roles WHERE rolname = 'avisa_api';
    RAISE NOTICE 'avisa_api sin BYPASSRLS ni superuser . %', NOT v_b AND NOT v_b2;

    -- avisa_api es miembro de avisa_app.
    SELECT count(*) INTO v_n
      FROM pg_auth_members am
      JOIN pg_roles m ON m.oid = am.member
      JOIN pg_roles r ON r.oid = am.roleid
     WHERE m.rolname = 'avisa_api' AND r.rolname = 'avisa_app';
    RAISE NOTICE 'avisa_api hereda de avisa_app ........ % (esperado 1)', v_n;
END
$$;

-- ---------------------------------------------------------------------
-- 5.2 · Inventario de lo aplicado (visible al operador)
-- ---------------------------------------------------------------------
\echo ''
\echo 'Roles y capacidades:'
SELECT codigo, max_clasificacion AS nivel,
       puede_crear AS crea, puede_editar AS edita, puede_eliminar AS borra
  FROM core.roles
 ORDER BY id;

\echo ''
\echo 'Políticas restrictivas creadas:'
SELECT count(*) AS restrictivas
  FROM pg_policies
 WHERE policyname LIKE 'r_rol_%';

\echo 'PARCHE 15 aplicado.'
