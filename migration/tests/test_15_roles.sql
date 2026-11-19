-- =====================================================================
--  AVISA · Prueba de roles y capacidades (parche 15)
-- =====================================================================
--  Qué comprueba
--    1. Sin rol de sesión no se ve nada (el silencio cierra).
--    2. Declarar app.clasificacion_max ya NO escala privilegios: el nivel
--       sale de core.roles y nada más.
--    3. consulta_lectura lee hasta nivel 2 y no puede crear, editar ni borrar.
--    4. externo_publico no ve nada de nivel 2 ni 3.
--    5. auditor ve nivel 3, edita y no borra.
--    6. sectorista crea, edita y borra.
--    7. El nivel se deriva del rol en los nueve casos.
--    8. avisa_api puede autenticarse, hereda de avisa_app y no salta RLS.
--
--  Cómo se ejecuta
--    cat migration/tests/test_15_roles.sql \
--      | docker compose exec -T db psql -U avisa -d avisa
--
--  Todo ocurre dentro de una transacción que termina en ROLLBACK: la base
--  queda como estaba. Las filas de prueba se crean y se borran aquí.
--
--  Criterio de éxito: ninguna excepción y ninguna línea "FALLO" en la salida.
--
--  Nota de implementación: los valores esperados se pasan por parámetros de
--  sesión (t.n2 / t.n3) porque psql NO interpola sus variables dentro de un
--  bloque dollar-quoted ($$ ... $$).
-- =====================================================================

\set ON_ERROR_STOP on
\echo ''
\echo '=== TEST 15 · roles y capacidades ==='

BEGIN;

-- Contexto de auditoría: los triggers de created_by/updated_by exigen un
-- usuario real del catálogo.
SELECT set_config('app.user_id',
                  (SELECT id::text FROM core.usuarios ORDER BY id LIMIT 1),
                  true);

-- ---------------------------------------------------------------------
-- Fotografía previa (como superusuario, que salta RLS).
-- ---------------------------------------------------------------------
-- Sonda: una alerta de nivel 3 que solo deben ver los roles de nivel 3.
-- Se crea antes de contar para que entre en los totales.
INSERT INTO core.alertas_tempranas (codigo_alerta, nivel_clasificacion)
VALUES ('RAT-TEST-15', 3);

SELECT count(*)                                        AS total,
       count(*) FILTER (WHERE nivel_clasificacion <= 2) AS hasta_2
  FROM core.alertas_tempranas
\gset

\echo 'base:' :total 'alertas ·' :hasta_2 'de nivel <= 2'

SELECT set_config('t.n2', :'hasta_2', true),
       set_config('t.n3', :'total',   true);

-- ---------------------------------------------------------------------
-- A partir de aquí se trabaja como la aplicación, no como el dueño.
-- ---------------------------------------------------------------------
SET LOCAL ROLE avisa_app;

-- ---------------------------------------------------------------------
-- 1 · Sin rol de sesión
-- ---------------------------------------------------------------------
SET LOCAL app.rol_codigo = '';

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM core.alertas_tempranas;
    IF n <> 0 THEN
        RAISE EXCEPTION 'FALLO 1: sin rol se ven % filas; deberían ser 0', n;
    END IF;
    RAISE NOTICE 'OK 1 · sin rol de sesión: 0 filas';
END $$;

-- ---------------------------------------------------------------------
-- 2 · El parámetro del cliente ya no manda
-- ---------------------------------------------------------------------
-- Se declara nivel 3 a mano, como haría una API con un bug. Si la base
-- obedeciera al parámetro, el conteo incluiría la fila de nivel 3.
SET LOCAL app.clasificacion_max = '3';
SET LOCAL app.rol_codigo = 'consulta_lectura';

DO $$
DECLARE
    n int;
    v_esperado int := current_setting('t.n2')::int;
BEGIN
    SELECT count(*) INTO n FROM core.alertas_tempranas;
    IF n <> v_esperado THEN
        RAISE EXCEPTION
          'FALLO 2: app.clasificacion_max=3 surtió efecto (% filas, se esperaban %)',
          n, v_esperado;
    END IF;
    RAISE NOTICE 'OK 2 · app.clasificacion_max=3 ignorado: % filas', n;
END $$;

-- ---------------------------------------------------------------------
-- 3 · consulta_lectura: solo lectura
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
    BEGIN
        INSERT INTO core.alertas_tempranas (codigo_alerta) VALUES ('RAT-TEST-Q');
        RAISE EXCEPTION 'FALLO 3a: consulta_lectura pudo insertar';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 3a · consulta_lectura no puede crear';
    END;

    UPDATE core.alertas_tempranas
       SET codigo_alerta = codigo_alerta
     WHERE codigo_alerta = 'RAT-TEST-15';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'FALLO 3b: consulta_lectura editó % filas', n;
    END IF;
    RAISE NOTICE 'OK 3b · consulta_lectura no puede editar';

    DELETE FROM core.alertas_tempranas WHERE codigo_alerta = 'RAT-TEST-15';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'FALLO 3c: consulta_lectura borró % filas', n;
    END IF;
    RAISE NOTICE 'OK 3c · consulta_lectura no puede borrar';
END $$;

-- ---------------------------------------------------------------------
-- 4 · externo_publico: nada de nivel 2 o 3
-- ---------------------------------------------------------------------
SET LOCAL app.rol_codigo = 'externo_publico';

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM core.alertas_tempranas;
    IF n <> 0 THEN
        RAISE EXCEPTION 'FALLO 4: externo_publico ve % filas', n;
    END IF;
    RAISE NOTICE 'OK 4 · externo_publico: 0 filas';
END $$;

-- ---------------------------------------------------------------------
-- 5 · auditor: ve nivel 3, edita, no borra
-- ---------------------------------------------------------------------
SET LOCAL app.rol_codigo = 'auditor';

DO $$
DECLARE
    n int;
    v_esperado int := current_setting('t.n3')::int;
BEGIN
    SELECT count(*) INTO n FROM core.alertas_tempranas;
    IF n <> v_esperado THEN
        RAISE EXCEPTION 'FALLO 5a: auditor ve % filas; se esperaban %',
                        n, v_esperado;
    END IF;
    RAISE NOTICE 'OK 5a · auditor ve el nivel 3 (% filas)', n;

    UPDATE core.alertas_tempranas
       SET codigo_alerta = codigo_alerta
     WHERE codigo_alerta = 'RAT-TEST-15';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'FALLO 5b: auditor debería editar; filas = %', n;
    END IF;
    RAISE NOTICE 'OK 5b · auditor edita';

    DELETE FROM core.alertas_tempranas WHERE codigo_alerta = 'RAT-TEST-15';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'FALLO 5c: auditor borró % filas', n;
    END IF;
    RAISE NOTICE 'OK 5c · auditor no borra';
END $$;

-- ---------------------------------------------------------------------
-- 6 · sectorista: crea, edita y borra
-- ---------------------------------------------------------------------
SET LOCAL app.rol_codigo = 'sectorista';

DO $$
DECLARE n int;
BEGIN
    INSERT INTO core.alertas_tempranas (codigo_alerta) VALUES ('RAT-TEST-S');
    RAISE NOTICE 'OK 6a · sectorista crea';

    UPDATE core.alertas_tempranas
       SET codigo_alerta = 'RAT-TEST-S'
     WHERE codigo_alerta = 'RAT-TEST-S';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'FALLO 6b: sectorista no pudo editar; filas = %', n;
    END IF;
    RAISE NOTICE 'OK 6b · sectorista edita';

    -- La alerta queda referenciada por la fila de proceso que crea el
    -- trigger del parche 14; se retira primero para que la FK no estorbe.
    DELETE FROM core.proceso_instancia
     WHERE alerta_id = (SELECT id FROM core.alertas_tempranas
                         WHERE codigo_alerta = 'RAT-TEST-S');

    DELETE FROM core.alertas_tempranas WHERE codigo_alerta = 'RAT-TEST-S';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'FALLO 6c: sectorista no pudo borrar; filas = %', n;
    END IF;
    RAISE NOTICE 'OK 6c · sectorista borra';
END $$;

-- ---------------------------------------------------------------------
-- 7 · El nivel sale del catálogo de roles
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r      record;
    v_niv  smallint;
    v_bad  int := 0;
BEGIN
    FOR r IN SELECT codigo, max_clasificacion FROM core.roles ORDER BY id
    LOOP
        PERFORM set_config('app.rol_codigo', r.codigo, true);
        v_niv := core.clasificacion_max();
        IF v_niv <> r.max_clasificacion THEN
            v_bad := v_bad + 1;
            RAISE WARNING 'FALLO 7: % dio nivel % y su fila dice %',
                          r.codigo, v_niv, r.max_clasificacion;
        END IF;
    END LOOP;
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'FALLO 7: % roles con nivel incoherente', v_bad;
    END IF;
    RAISE NOTICE 'OK 7 · los 9 roles derivan su nivel de core.roles';
END $$;

ROLLBACK;

-- ---------------------------------------------------------------------
-- 8 · Los dos roles de base de datos (fuera de la transacción)
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_login   boolean;
    v_bypass  boolean;
    v_super   boolean;
    v_miembro int;
BEGIN
    SELECT rolcanlogin, rolbypassrls, rolsuper
      INTO v_login, v_bypass, v_super
      FROM pg_roles WHERE rolname = 'avisa_api';

    IF NOT v_login THEN
        RAISE EXCEPTION 'FALLO 8a: avisa_api no puede autenticarse';
    END IF;
    IF v_bypass OR v_super THEN
        RAISE EXCEPTION 'FALLO 8b: avisa_api salta RLS o es superusuario';
    END IF;
    RAISE NOTICE 'OK 8a · avisa_api: login sí, BYPASSRLS no, superusuario no';

    SELECT count(*) INTO v_miembro
      FROM pg_auth_members am
      JOIN pg_roles m ON m.oid = am.member
      JOIN pg_roles r ON r.oid = am.roleid
     WHERE m.rolname = 'avisa_api' AND r.rolname = 'avisa_app';

    IF v_miembro <> 1 THEN
        RAISE EXCEPTION 'FALLO 8c: avisa_api no hereda de avisa_app';
    END IF;
    RAISE NOTICE 'OK 8c · avisa_api hereda los privilegios de avisa_app';
END $$;

\echo ''
\echo '=== TEST 15 terminado · revisar que no haya "FALLO" arriba ==='
\echo ''
