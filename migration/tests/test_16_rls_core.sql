-- =====================================================================
--  AVISA · Prueba de RLS completo en `core` y del banco de datos (parche 16)
-- =====================================================================
--  Qué comprueba
--    1. Estructura: 44 tablas de core con RLS y la tabla DC-04 creada.
--    2. Un actor de nivel 3 no lo ve `consulta_lectura`; sí `alta_direccion`.
--    3. Herencia: el alias de un actor nivel 3 tampoco se ve, aunque la
--       tabla `actor_alias` no tenga columna de nivel propia.
--    4. Herencia doble: los miembros de una mesa nivel 3 no se ven, ni
--       siquiera el que apunta a un actor público.
--    5. Herencia con NULL: un miembro sin actor no desaparece para el
--       rol de nivel alto (la fila no se vuelve invisible).
--    6. `consulta_lectura` NO puede crear actores (capacidad, no solo nivel).
--    7. `auditor` edita pero no borra (el DELETE no falla: no afecta filas).
--    8. `sectorista` sí borra.
--    9. `log_accesos`: `consulta_lectura` puede registrar su propio acceso
--       (la bitácora no se rompe) pero no ve las filas de nivel 3.
--   10. DC-04: el banco de datos es legible por nivel 2.
--
--  Cómo se ejecuta
--    cat migration/tests/test_16_rls_core.sql \
--      | docker compose exec -T db psql -U avisa -d avisa
--
--  Todo ocurre en una transacción que termina en ROLLBACK. Las filas de
--  prueba se crean como superusuario (que salta RLS) y luego se consultan
--  como `avisa_app`, el rol de la aplicación, que NO salta RLS.
--
--  Criterio de éxito: ninguna excepción y ninguna línea "FALLO".
--
--  Nota: los UUID de prueba se pasan por parámetros de sesión porque psql
--  no interpola sus variables dentro de bloques dollar-quoted ($$ ... $$).
-- =====================================================================

\set ON_ERROR_STOP on
\echo ''
\echo '=== TEST 16 · RLS completo en core y banco de datos (DC-04) ==='

BEGIN;

SELECT set_config('app.user_id',
                  (SELECT id::text FROM core.usuarios ORDER BY id LIMIT 1),
                  true);

-- ---------------------------------------------------------------------
-- 0 · Estructura
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'core' AND c.relkind = 'r' AND c.relrowsecurity;
    IF n <> 44 THEN
        RAISE EXCEPTION 'FALLO 0a: % tablas de core con RLS; esperadas 44', n;
    END IF;
    RAISE NOTICE 'OK 0a · 44 tablas de core con RLS';

    IF to_regclass('core.banco_datos_tratamiento') IS NULL THEN
        RAISE EXCEPTION 'FALLO 0b: falta core.banco_datos_tratamiento';
    END IF;
    RAISE NOTICE 'OK 0b · DC-04 existe';
END $$;

-- ---------------------------------------------------------------------
-- 1 · Sondas: filas de nivel 3 y de nivel 2
-- ---------------------------------------------------------------------
-- Se crean como superusuario: las políticas no estorban aquí.
INSERT INTO core.actores (nombre_actual, tipo_actor_id, rol_actor_id,
                          nivel_clasificacion, origen_dato)
VALUES ('ACTOR TEST 16 CONFIDENCIAL', 4, 4, 3, 'MANUAL')
RETURNING actor_uid AS probe_a3 \gset

INSERT INTO core.actores (nombre_actual, tipo_actor_id, rol_actor_id,
                          nivel_clasificacion, origen_dato)
VALUES ('ACTOR TEST 16 PUBLICO', 4, 4, 2, 'MANUAL')
RETURNING actor_uid AS probe_a2 \gset

INSERT INTO core.actor_alias (actor_uid, alias)
VALUES (:'probe_a3', 'alias oculto 16');

INSERT INTO core.actor_alias (actor_uid, alias)
VALUES (:'probe_a2', 'alias visible 16');

INSERT INTO core.mesas_dialogo (codigo, titulo, nivel_clasificacion)
VALUES ('MESA-TEST-16', 'Mesa de prueba 16', 3)
RETURNING id AS probe_m3 \gset

INSERT INTO core.mesa_miembros (mesa_id, rol, actor_uid)
VALUES (:'probe_m3', 'Titular',    :'probe_a3');
INSERT INTO core.mesa_miembros (mesa_id, rol, actor_uid)
VALUES (:'probe_m3', 'Integrante', :'probe_a2');
INSERT INTO core.mesa_miembros (mesa_id, rol, actor_uid, nombre_texto)
VALUES (:'probe_m3', 'Invitado',   NULL, 'Invitado sin registro 16');

INSERT INTO core.log_accesos (fecha, resultado, origen, nivel_clasificacion)
VALUES (now(), 'OK', 'TEST16', 3), (now(), 'OK', 'TEST16', 2);

SELECT count(*) AS probe_act_total FROM core.actores \gset

SELECT set_config('t.a3',        :'probe_a3',        true),
       set_config('t.a2',        :'probe_a2',        true),
       set_config('t.m3',        :'probe_m3',        true),
       set_config('t.act_total', :'probe_act_total', true);

\echo 'sondas creadas · actores totales:' :probe_act_total
\echo ''

-- ---------------------------------------------------------------------
-- 2..5 · Rol de solo lectura con nivel 2
-- ---------------------------------------------------------------------
SET LOCAL ROLE avisa_app;
SET LOCAL app.rol_codigo = 'consulta_lectura';

DO $$
DECLARE
    n  int;
    v3 uuid := current_setting('t.a3')::uuid;
    v2 uuid := current_setting('t.a2')::uuid;
    vm uuid := current_setting('t.m3')::uuid;
BEGIN
    -- 2 · el actor confidencial no existe para este rol
    SELECT count(*) INTO n FROM core.actores WHERE actor_uid = v3;
    IF n <> 0 THEN RAISE EXCEPTION 'FALLO 2a: consulta_lectura ve el actor nivel 3'; END IF;

    SELECT count(*) INTO n FROM core.actores WHERE actor_uid = v2;
    IF n <> 1 THEN RAISE EXCEPTION 'FALLO 2b: consulta_lectura no ve el actor nivel 2'; END IF;
    RAISE NOTICE 'OK 2 · actor nivel 3 oculto, nivel 2 visible';

    -- 3 · herencia en actor_alias (tabla sin columna de nivel)
    SELECT count(*) INTO n FROM core.actor_alias WHERE actor_uid = v3;
    IF n <> 0 THEN RAISE EXCEPTION 'FALLO 3a: se filtran % alias del actor oculto', n; END IF;

    SELECT count(*) INTO n FROM core.actor_alias WHERE actor_uid = v2;
    IF n <> 1 THEN RAISE EXCEPTION 'FALLO 3b: falta el alias del actor visible'; END IF;
    RAISE NOTICE 'OK 3 · actor_alias hereda el nivel del actor';

    -- 4 · herencia doble en mesa_miembros: manda el padre más alto
    SELECT count(*) INTO n FROM core.mesa_miembros WHERE mesa_id = vm;
    IF n <> 0 THEN RAISE EXCEPTION 'FALLO 4: se filtran % miembros de la mesa nivel 3', n; END IF;
    RAISE NOTICE 'OK 4 · mesa_miembros hereda el nivel de la mesa';

    -- 6 · capacidad, no solo nivel: no puede crear
    BEGIN
        INSERT INTO core.actores (nombre_actual, tipo_actor_id, rol_actor_id,
                                  nivel_clasificacion, origen_dato)
        VALUES ('NO DEBE ENTRAR', 4, 4, 2, 'MANUAL');
        RAISE EXCEPTION 'FALLO 6: consulta_lectura pudo crear un actor';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE 'OK 6 · consulta_lectura no puede crear actores';
    END;

    -- 9a · la bitácora sigue aceptando el registro de este rol
    INSERT INTO core.log_accesos (fecha, resultado, origen, nivel_clasificacion)
    VALUES (now(), 'OK', 'TEST16-consulta', 2);
    RAISE NOTICE 'OK 9a · consulta_lectura registra su acceso en log_accesos';

    -- 9b · pero no lee la fila de nivel 3
    SELECT count(*) INTO n FROM core.log_accesos WHERE origen = 'TEST16';
    IF n <> 1 THEN
        RAISE EXCEPTION 'FALLO 9b: log_accesos muestra % filas de prueba; esperada 1', n;
    END IF;
    RAISE NOTICE 'OK 9b · log_accesos oculta la fila de nivel 3';

    -- 10 · el banco de datos (nivel 2) se puede consultar
    SELECT count(*) INTO n FROM core.banco_datos_tratamiento WHERE id = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'FALLO 10: consulta_lectura no ve el banco de datos'; END IF;
    RAISE NOTICE 'OK 10 · DC-04 legible por nivel 2';
END $$;

-- ---------------------------------------------------------------------
-- 7 · Nivel 3 completo: ve todo, incluidos los miembros sin actor
-- ---------------------------------------------------------------------
SET LOCAL app.rol_codigo = 'alta_direccion';

DO $$
DECLARE
    n  int;
    v3 uuid := current_setting('t.a3')::uuid;
    vm uuid := current_setting('t.m3')::uuid;
    vt int  := current_setting('t.act_total')::int;
BEGIN
    SELECT count(*) INTO n FROM core.actores WHERE actor_uid = v3;
    IF n <> 1 THEN RAISE EXCEPTION 'FALLO 7a: alta_direccion no ve el actor nivel 3'; END IF;

    -- el total no se recorta: nadie pierde filas por tener nivel alto
    SELECT count(*) INTO n FROM core.actores;
    IF n <> vt THEN
        RAISE EXCEPTION 'FALLO 7b: alta_direccion ve % actores de %', n, vt;
    END IF;

    SELECT count(*) INTO n FROM core.mesa_miembros WHERE mesa_id = vm;
    IF n <> 3 THEN
        RAISE EXCEPTION 'FALLO 7c: alta_direccion ve % miembros; esperados 3', n;
    END IF;

    SELECT count(*) INTO n FROM core.log_accesos WHERE origen = 'TEST16';
    IF n <> 2 THEN
        RAISE EXCEPTION 'FALLO 7d: log_accesos muestra % filas; esperadas 2', n;
    END IF;

    RAISE NOTICE 'OK 7 · nivel 3 ve todo, sin perder la fila con actor NULL';
END $$;

-- ---------------------------------------------------------------------
-- 8 · auditor: edita, no borra
-- ---------------------------------------------------------------------
SET LOCAL app.rol_codigo = 'auditor';

DO $$
DECLARE
    n  int;
    v3 uuid := current_setting('t.a3')::uuid;
BEGIN
    UPDATE core.actores SET nombre_actual = nombre_actual WHERE actor_uid = v3;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'FALLO 8a: auditor no pudo editar (% filas)', n; END IF;

    -- Ojo con la semántica de PostgreSQL: un DELETE que RLS no autoriza NO
    -- lanza error; simplemente no encuentra filas. Hay que medir el conteo.
    DELETE FROM core.actores WHERE actor_uid = v3;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'FALLO 8b: auditor borró % actores', n;
    END IF;

    -- Y la fila sigue ahí.
    SELECT count(*) INTO n FROM core.actores WHERE actor_uid = v3;
    IF n <> 1 THEN RAISE EXCEPTION 'FALLO 8c: el actor desapareció'; END IF;

    RAISE NOTICE 'OK 8 · auditor edita y no borra';
END $$;

-- ---------------------------------------------------------------------
-- 9 · sectorista: borra
-- ---------------------------------------------------------------------
SET LOCAL app.rol_codigo = 'sectorista';

DO $$
DECLARE
    n  int;
    v3 uuid := current_setting('t.a3')::uuid;
    vm uuid := current_setting('t.m3')::uuid;
BEGIN
    -- Primero la membresía: la FK lo exige y, además, demuestra que
    -- sectorista puede borrar en una tabla de detalle heredada.
    DELETE FROM core.mesa_miembros WHERE mesa_id = vm AND actor_uid = v3;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'FALLO 9d: sectorista no pudo borrar la membresía (% filas)', n; END IF;

    DELETE FROM core.actores WHERE actor_uid = v3;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'FALLO 9c: sectorista no pudo borrar el actor (% filas)', n; END IF;
    RAISE NOTICE 'OK 9c · sectorista borra en actor y en mesa_miembros';
END $$;

ROLLBACK;

\echo ''
\echo '=== TEST 16 terminado · base intacta (ROLLBACK) ==='
