-- =====================================================================
--  AVISA · PARCHE 21 · La Dirección y la normalización del flujo
-- =====================================================================
--  QUÉ ES
--
--  Cierra cuatro cosas que el parche 20 dejó abiertas:
--
--      (a) asigna el rol `direccion_oaipcs` a la Directora de la OAIPCS,
--      (b) normaliza `core.flujo_definicion.rol_responsable` en los flujos
--          `caso` y `reporte`, que todavía traían texto libre del sistema
--          anterior («Sectorista», «Sectorista/Directora»),
--      (c) cierra G21: añade `aprobada_por` y `aprobada_en` a
--          `core.alertas_tempranas` y las expone al final de
--          `core.vw_alerta_estado`,
--      (d) pone seguridad por fila en los dos catálogos del flujo que
--          quedaron sin política (`core.flujo_estado` y
--          `core.permiso_aprobacion`).
--
--  POR QUÉ EXISTE
--
--  1. El parche 20 creó el rol `direccion_oaipcs` pero no se lo asignó a
--     nadie: el paso 3 del flujo de alerta (Aprobación definitiva) no tenía
--     una sola cuenta elegible. El flujo quedaba bien modelado e inoperante.
--     Quién ocupa la Dirección es un hecho administrativo, y ese hecho ya
--     está: la Directora de la OAIPCS es Edith Bautista León, cuyo código
--     en el sistema anterior es `SEC-11`. Asignarlo es un acto de este
--     parche, no una deducción del SQL.
--
--  2. `rol_responsable` es `varchar(120)` sin clave ajena y sin ninguna
--     validación. En el flujo de alerta ya usa códigos de `core.roles`
--     (parche 20); en `caso` y `reporte` seguía el texto libre del sistema
--     anterior. Mientras siga así, cualquier escritura puede volver a
--     meter texto libre y el responsable del paso deja de ser resoluble
--     contra el catálogo de roles. Se normaliza y se impide la recaída con
--     una restricción de formato y un trigger de validación semántica.
--
--  3. G21 pide que la alerta aprobada sea visible como tal. La tabla no
--     tenía dónde guardar quién aprobó ni cuándo: el único rastro vivía en
--     `core.proceso_instancia.usuario_id`, que no distingue la aprobación
--     de cualquier otro paso. La vista `core.vw_alerta_estado` tampoco las
--     exponía.
--
--  4. `core.flujo_estado` y `core.permiso_aprobacion` eran los dos últimos
--     catálogos del flujo sin política. Cualquier sesión de aplicación
--     podía reescribir los cinco estados de paso, y `core.tg_alerta_nace()`
--     los lee por código (`EST-01`): un cambio ahí deja alertas naciendo
--     sin fila de proceso, y sin error visible.
--
--  QUÉ NO HACE
--
--  · No inventa aprobaciones. Las 83 alertas existentes quedan con
--    `aprobada_por` en NULL: el sistema anterior nunca registró quién
--    aprobaba. Eso no es un hueco de la migración, es el dato que hay.
--  · No toca los cinco pasos del flujo `alerta`: ya usaban códigos desde el
--    parche 20 y su renumeración sigue vigente.
--  · No inserta filas en `core.proceso_instancia` ni en
--    `core.permiso_aprobacion`.
--  · No crea estados nuevos en `core.flujo_estado` ni comenta tablas de los
--    catálogos: los comentarios de columna ya existen (parches 12 y 19) y
--    los de tabla se reportan, no se improvisan.
--  · No asigna ningún otro rol a nadie, ni toca el esquema `ref`.
--
--  DÓNDE SE EJECUTA
--
--  En la base viva del contenedor `avisa-db` (PostgreSQL 16, usuario
--  `avisa`, base `avisa`). Con el archivo montado en el contenedor:
--
--      docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--          -f <ruta de este parche dentro del contenedor>
--
--  O por la entrada estándar, desde el host:
--
--      cat docs/PARCHE_21_DIRECCION_Y_FLUJO.sql \
--        | docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1
--
--  ORDEN
--  Después del parche 20. Usa `core.rol_actual()` (parche 15), el rol
--  `direccion_oaipcs` y los cinco pasos del flujo de alerta (parche 20),
--  la vista `core.vw_alerta_estado` (parche 14) y los comentarios de
--  columna del modelo (parches 12 y 19).
--
--  IDEMPOTENTE
--  Se puede repetir: el INSERT de la asignación va con `NOT EXISTS` sobre
--  la asignación vigente, los UPDATE llevan guarda `IS DISTINCT FROM`
--  (segunda pasada = 0 filas, sin reescribir `updated_at`), las columnas
--  se añaden con `IF NOT EXISTS`, la restricción se recrea con
--  `DROP CONSTRAINT IF EXISTS`, la función y el trigger se recrean con
--  `CREATE OR REPLACE` y `DROP TRIGGER IF EXISTS`, la vista con
--  `CREATE OR REPLACE` y las políticas con `DROP POLICY IF EXISTS` antes
--  de `CREATE POLICY`. Correrlo dos veces seguidas no falla, no duplica y
--  no deja rastro.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'PARCHE 21 · bloque 0/7 · comprobaciones previas'

-- ---------------------------------------------------------------------
-- 0 · El estado de partida tiene que ser el esperado
-- ---------------------------------------------------------------------
DO $p21_pre$
DECLARE
    v_n integer;
BEGIN
    IF to_regclass('core.usuario_roles')     IS NULL
       OR to_regclass('core.roles')           IS NULL
       OR to_regclass('core.flujo_definicion') IS NULL
       OR to_regclass('core.flujo_estado')    IS NULL
       OR to_regclass('core.alertas_tempranas') IS NULL THEN
        RAISE EXCEPTION
            'Faltan tablas del núcleo. Aplique antes los parches 10, 14, 15 y 18.';
    END IF;

    IF to_regprocedure('core.rol_actual()') IS NULL THEN
        RAISE EXCEPTION 'Falta core.rol_actual(). Aplique antes el parche 15.';
    END IF;

    IF to_regclass('core.permiso_aprobacion') IS NULL THEN
        RAISE EXCEPTION
            'Falta core.permiso_aprobacion. Aplique antes el parche 10.';
    END IF;

    -- Los cinco pasos del flujo de alerta los dejó el parche 20. Si faltan,
    -- este parche estaría normalizando un flujo que todavía no existe.
    SELECT count(*) INTO v_n
      FROM core.flujo_definicion WHERE tipo_flujo = 'alerta';
    IF v_n <> 5 THEN
        RAISE EXCEPTION
            'Se esperaban los 5 pasos del flujo de alerta y hay %. '
            'Aplique antes el parche 20.', v_n;
    END IF;

    -- El rol de la aprobación tiene que estar tal como lo dejó el parche 20.
    SELECT count(*) INTO v_n
      FROM core.roles
     WHERE codigo = 'direccion_oaipcs'
       AND max_clasificacion = 3
       AND puede_crear AND puede_editar AND NOT puede_eliminar;
    IF v_n <> 1 THEN
        RAISE EXCEPTION
            'Falta el rol direccion_oaipcs con nivel 3 y las capacidades '
            'esperadas. Aplique antes el parche 20.';
    END IF;

    RAISE NOTICE 'PARCHE 21 · estado de partida coherente';
END
$p21_pre$;

BEGIN;

-- =====================================================================
-- BLOQUE 1 · La Dirección de la OAIPCS
-- =====================================================================
\echo 'PARCHE 21 · bloque 1/7 · la Directora recibe direccion_oaipcs'

--  La asignación es a una sola persona y por su código del sistema
--  anterior. No se busca «el usuario con cargo Director»: el cargo es texto
--  libre y varias personas pueden tenerlo escrito de formas distintas. El
--  código `SEC-11` sí es único y es el que la OAIPCS dio de alta.
DO $p21_direccion$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n
      FROM core.usuarios WHERE codigo_legado = 'SEC-11';
    IF v_n <> 1 THEN
        RAISE EXCEPTION
            'Se esperaba exactamente 1 usuario con codigo_legado SEC-11 y hay '
            '%. Revise core.usuarios antes de aplicar el parche 21.', v_n;
    END IF;
END
$p21_direccion$;

--  `desde` fija el día del parche y `hasta` queda NULL, que en esta tabla
--  significa «vigente». La guarda `x.hasta IS NULL` evita duplicar una
--  asignación abierta; una asignación histórica ya cerrada no estorba.
INSERT INTO core.usuario_roles (usuario_id, rol_id, desde)
SELECT u.id, r.id, DATE '2026-11-20'
  FROM core.usuarios u, core.roles r
 WHERE u.codigo_legado = 'SEC-11'
   AND r.codigo = 'direccion_oaipcs'
   AND NOT EXISTS (
       SELECT 1 FROM core.usuario_roles x
        WHERE x.usuario_id = u.id
          AND x.rol_id     = r.id
          AND x.hasta IS NULL);

-- =====================================================================
-- BLOQUE 2 · Normalización de rol_responsable
-- =====================================================================
\echo 'PARCHE 21 · bloque 2/7 · normalización de rol_responsable'

--  Convención (se documenta en el comentario de la columna más abajo):
--  un código único de `core.roles.codigo` significa «solo ese rol»; varios
--  códigos separados por coma, sin espacios, significan «cualquiera de
--  ellos» (alternativa, no secuencia).
--
--  En `caso`, «Remisión», «Cierre» y «Reapertura» dicen «Sectorista /
--  Directora»: cualquiera de los dos ejecuta el paso. Se traducen a los dos
--  códigos separados por coma.
--
--  `IS DISTINCT FROM` deja explícita la guarda de idempotencia: una fila
--  cuyo texto ya sea el normalizado no se toca y no reescribe `updated_at`.
UPDATE core.flujo_definicion
   SET rol_responsable = 'sectorista',
       updated_at      = now()
 WHERE tipo_flujo IN ('caso', 'reporte')
   AND rol_responsable = 'Sectorista'
   AND rol_responsable IS DISTINCT FROM 'sectorista';

UPDATE core.flujo_definicion
   SET rol_responsable = 'sectorista,direccion_oaipcs',
       updated_at      = now()
 WHERE tipo_flujo IN ('caso', 'reporte')
   AND rol_responsable = 'Sectorista/Directora'
   AND rol_responsable IS DISTINCT FROM 'sectorista,direccion_oaipcs';

COMMENT ON COLUMN core.flujo_definicion.rol_responsable IS
    'Rol que debe ejecutar el paso del flujo, como código de core.roles. Un código único significa «solo ese rol»; varios códigos separados por coma, sin espacios, significan «cualquiera de ellos» (alternativa, no secuencia): sectorista,direccion_oaipcs quiere decir que el paso lo ejecuta el sectorista o la Dirección. En caso y reporte el texto libre del sistema anterior quedó normalizado por el parche 21; la restricción de formato y el trigger flujo_definicion_valida_rol impiden que vuelva';

--  Restricción de sintaxis: barata, no depende de las filas y se valida una
--  sola vez sobre las 12 del catálogo. No comprueba que el código exista;
--  de eso se encarga el trigger.
ALTER TABLE core.flujo_definicion
    DROP CONSTRAINT IF EXISTS flujo_definicion_rol_responsable_formato;
ALTER TABLE core.flujo_definicion
    ADD CONSTRAINT flujo_definicion_rol_responsable_formato
    CHECK (rol_responsable ~ '^[a-z_]+(,[a-z_]+)*$');

--  Validación semántica: cada token tiene que existir en core.roles.codigo.
--  La función es SECURITY DEFINER y fija `search_path` para que la consulta
--  al catálogo no dependa de la RLS de quien esté escribiendo el flujo: la
--  política de `core.roles` es de lectura abierta, pero una escritura hecha
--  por un rol sin privilegios de lectura no debe poder colar un rol
--  inventado «porque no lo ve».
CREATE OR REPLACE FUNCTION core.tg_flujo_def_valida_rol()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'core'
AS $fn$
DECLARE
    v_token text;
BEGIN
    IF NEW.rol_responsable IS NULL THEN
        RETURN NEW;
    END IF;

    FOREACH v_token IN ARRAY string_to_array(NEW.rol_responsable, ',') LOOP
        IF NOT EXISTS (SELECT 1 FROM core.roles r WHERE r.codigo = v_token) THEN
            RAISE EXCEPTION
                'rol_responsable: el token «%» no existe en core.roles.codigo',
                v_token;
        END IF;
    END LOOP;

    RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS flujo_definicion_valida_rol ON core.flujo_definicion;
CREATE TRIGGER flujo_definicion_valida_rol
    BEFORE INSERT OR UPDATE OF rol_responsable ON core.flujo_definicion
    FOR EACH ROW EXECUTE FUNCTION core.tg_flujo_def_valida_rol();

-- =====================================================================
-- BLOQUE 3 · G21: la aprobación definitiva de la alerta
-- =====================================================================
\echo 'PARCHE 21 · bloque 3/7 · aprobación de la alerta (G21)'

--  `aprobada_por` no inventa historia: la columna nace vacía y las 83
--  alertas migradas se quedan así. El sistema anterior no registraba quién
--  aprobaba, y rellenarlo con el sectorista asignado o con la Directora
--  sería fabricar un acto administrativo que nadie firmó.
ALTER TABLE core.alertas_tempranas
    ADD COLUMN IF NOT EXISTS aprobada_por uuid
        REFERENCES core.usuarios(id) ON DELETE RESTRICT;

ALTER TABLE core.alertas_tempranas
    ADD COLUMN IF NOT EXISTS aprobada_en timestamptz;

--  Coherencia: una fecha de aprobación sin aprobador no significa nada. Al
--  revés sí: puede haber aprobador con fecha pendiente mientras el acto se
--  está registrando, de modo que solo se exige una dirección.
ALTER TABLE core.alertas_tempranas
    DROP CONSTRAINT IF EXISTS alertas_aprobacion_coherente;
ALTER TABLE core.alertas_tempranas
    ADD CONSTRAINT alertas_aprobacion_coherente
    CHECK (aprobada_en IS NULL OR aprobada_por IS NOT NULL);

COMMENT ON COLUMN core.alertas_tempranas.aprobada_por IS
    'Usuario de la Dirección de la OAIPCS que dio la aprobación definitiva de la alerta antes de su remisión; nulo en las alertas que no llegaron a aprobarse y en las migradas, porque el sistema anterior no registraba quién aprobaba';
COMMENT ON COLUMN core.alertas_tempranas.aprobada_en IS
    'Momento en que se registró la aprobación definitiva de la alerta; nulo mientras la alerta no esté aprobada';

--  Índice parcial: las consultas de G21 buscan «quién aprobó y cuándo», y
--  mientras la mayoría de las filas tenga NULL el índice no crece.
CREATE INDEX IF NOT EXISTS ix_alertas_aprobada_por
    ON core.alertas_tempranas (aprobada_por, aprobada_en)
    WHERE aprobada_por IS NOT NULL;

--  La vista conserva sus 17 columnas en el mismo orden y añade las dos
--  nuevas al final. Reordenar o renombrar rompería a cualquier consumidor
--  que la lea por posición.
CREATE OR REPLACE VIEW core.vw_alerta_estado AS
SELECT a.id                       AS alerta_id,
       a.codigo_alerta,
       a.titulo,
       a.prioridad_id,
       a.nivel_alerta_id,
       a.fecha_reporte,
       pi.id                      AS proceso_id,
       pi.orden                   AS paso,
       d.nombre                   AS paso_nombre,
       pi.estado_id,
       e.codigo                   AS estado_codigo,
       e.nombre                   AS estado_nombre,
       e.es_final,
       pi.ocurrido_en             AS estado_desde,
       a.es_validado_humano,
       a.fecha_validacion,
       a.fecha_remision,
       a.aprobada_por,
       a.aprobada_en
  FROM core.alertas_tempranas a
  LEFT JOIN LATERAL (
        SELECT p.*
          FROM core.proceso_instancia p
         WHERE p.tipo_origen = 'alerta' AND p.alerta_id = a.id
         ORDER BY p.orden DESC, p.ocurrido_en DESC NULLS LAST
         LIMIT 1
  ) pi ON true
  LEFT JOIN core.flujo_estado e ON e.id = pi.estado_id
  LEFT JOIN core.flujo_definicion d ON d.id = pi.flujo_definicion_id;

COMMENT ON VIEW core.vw_alerta_estado IS
    'Estado vigente de cada alerta temprana. El estado no vive en '
    'core.alertas_tempranas: vive en core.proceso_instancia, igual que en '
    'casos y reportes. Esta vista lo resuelve en una sola lectura. Expone '
    'además la aprobación definitiva de la alerta (aprobada_por, '
    'aprobada_en), que registra el paso 3 del flujo de alerta.';

-- =====================================================================
-- BLOQUE 4 · RLS de los dos catálogos del flujo
-- =====================================================================
\echo 'PARCHE 21 · bloque 4/7 · RLS de los catálogos del flujo'

--  La lectura queda abierta a propósito, igual que en el catálogo de pasos
--  (parche 20): `core.tg_alerta_nace()` hace SELECT sobre
--  `core.flujo_estado` por código (`EST-01`) con los permisos de quien
--  inserta la alerta; una política de lectura que devolviera 0 filas dejaría
--  a las alertas naciendo sin paso 1 y sin error. `core.permiso_aprobacion`
--  se cierra con el mismo patrón por coherencia, aunque hoy no tenga filas.
--
--  La escritura queda solo para `administrador`, como en `core.roles`
--  (parche 18) y `core.flujo_definicion` (parche 20).
ALTER TABLE core.flujo_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.flujo_estado FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p21_flujo_estado_select ON core.flujo_estado;
CREATE POLICY p21_flujo_estado_select ON core.flujo_estado
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (true);

DROP POLICY IF EXISTS p21_flujo_estado_insert ON core.flujo_estado;
CREATE POLICY p21_flujo_estado_insert ON core.flujo_estado
    AS PERMISSIVE FOR INSERT TO PUBLIC
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p21_flujo_estado_update ON core.flujo_estado;
CREATE POLICY p21_flujo_estado_update ON core.flujo_estado
    AS PERMISSIVE FOR UPDATE TO PUBLIC
    USING (core.rol_actual() = 'administrador')
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p21_flujo_estado_delete ON core.flujo_estado;
CREATE POLICY p21_flujo_estado_delete ON core.flujo_estado
    AS PERMISSIVE FOR DELETE TO PUBLIC
    USING (core.rol_actual() = 'administrador');

ALTER TABLE core.permiso_aprobacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.permiso_aprobacion FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p21_permiso_aprob_select ON core.permiso_aprobacion;
CREATE POLICY p21_permiso_aprob_select ON core.permiso_aprobacion
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (true);

DROP POLICY IF EXISTS p21_permiso_aprob_insert ON core.permiso_aprobacion;
CREATE POLICY p21_permiso_aprob_insert ON core.permiso_aprobacion
    AS PERMISSIVE FOR INSERT TO PUBLIC
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p21_permiso_aprob_update ON core.permiso_aprobacion;
CREATE POLICY p21_permiso_aprob_update ON core.permiso_aprobacion
    AS PERMISSIVE FOR UPDATE TO PUBLIC
    USING (core.rol_actual() = 'administrador')
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p21_permiso_aprob_delete ON core.permiso_aprobacion;
CREATE POLICY p21_permiso_aprob_delete ON core.permiso_aprobacion
    AS PERMISSIVE FOR DELETE TO PUBLIC
    USING (core.rol_actual() = 'administrador');

-- =====================================================================
-- BLOQUE 5 · Comentarios de los catálogos: se miden, no se inventan
-- =====================================================================
\echo 'PARCHE 21 · bloque 5/7 · comentarios de los catálogos'

--  Las columnas de los dos catálogos ya están descritas (parches 12 y 19).
--  Lo que falta es el comentario de TABLA. No se redacta aquí: el parche 19
--  cerró las columnas del modelo v10 y ningún parche anterior comenta
--  tablas sobre la marcha. Se mide y se informa para que lo cierre quien
--  corresponda; inventar el texto ahora sería escribir documentación a
--  medias desde un parche de datos.
DO $p21_comentarios$
DECLARE
    v_tablas integer;
    v_cols_sin integer;
BEGIN
    SELECT count(*) INTO v_tablas
      FROM pg_description d
      JOIN pg_class c     ON c.oid = d.objoid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core'
       AND c.relname IN ('flujo_estado', 'permiso_aprobacion')
       AND d.objsubid = 0;

    SELECT count(*) INTO v_cols_sin
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core'
       AND c.relname IN ('flujo_estado', 'permiso_aprobacion')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND col_description(c.oid, a.attnum) IS NULL;

    RAISE NOTICE 'catálogos del flujo: % de 2 tablas con comentario de tabla, % columnas sin comentario',
        v_tablas, v_cols_sin;
END
$p21_comentarios$;

-- =====================================================================
-- BLOQUE 6 · Verificación
-- =====================================================================
\echo 'PARCHE 21 · bloque 6/7 · verificación'

DO $p21_verify$
DECLARE
    v_n        integer;
    v_id       uuid;
    v_fallo    boolean;
    v_ok       boolean;
    v_cols     integer;
    v_alertas  integer;
    v_cuentas  integer;
    v_roles    integer;
    v_pi       integer;
BEGIN
    -- 6.1 · Una sola cuenta vigente de direccion_oaipcs, y es SEC-11
    SELECT count(*) INTO v_cuentas
      FROM core.usuario_roles ur
      JOIN core.roles r ON r.id = ur.rol_id
     WHERE r.codigo = 'direccion_oaipcs' AND ur.hasta IS NULL;
    IF v_cuentas <> 1 THEN
        RAISE EXCEPTION
            'se esperaba 1 cuenta vigente de direccion_oaipcs y hay %', v_cuentas;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.usuario_roles ur
      JOIN core.roles r    ON r.id = ur.rol_id
      JOIN core.usuarios u ON u.id = ur.usuario_id
     WHERE r.codigo = 'direccion_oaipcs' AND ur.hasta IS NULL
       AND u.codigo_legado = 'SEC-11';
    IF v_n <> 1 THEN
        RAISE EXCEPTION
            'la cuenta vigente de direccion_oaipcs no es SEC-11';
    END IF;

    SELECT count(*) INTO v_n FROM core.usuario_roles;
    IF v_n <> 36 THEN
        RAISE EXCEPTION 'core.usuario_roles tiene % filas y debe tener 36', v_n;
    END IF;

    -- 6.2 · Los 12 pasos cumplen el formato y todos sus tokens existen
    SELECT count(*) INTO v_n
      FROM core.flujo_definicion
     WHERE rol_responsable IS NULL
        OR rol_responsable !~ '^[a-z_]+(,[a-z_]+)*$';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'quedan % pasos con rol_responsable fuera de formato', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.flujo_definicion d,
           LATERAL unnest(string_to_array(d.rol_responsable, ',')) AS t(token)
     WHERE NOT EXISTS (SELECT 1 FROM core.roles r WHERE r.codigo = t.token);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'hay % tokens de rol_responsable que no existen en core.roles', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM core.flujo_definicion;
    IF v_n <> 12 THEN
        RAISE EXCEPTION 'core.flujo_definicion tiene % filas y debe tener 12', v_n;
    END IF;

    -- 6.3 · Las columnas de la aprobación existen, tienen comentario y la
    --       vista las expone al final
    SELECT count(*) INTO v_n
      FROM pg_attribute a
     WHERE a.attrelid = 'core.alertas_tempranas'::regclass
       AND a.attname IN ('aprobada_por', 'aprobada_en')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND col_description(a.attrelid, a.attnum) IS NOT NULL;
    IF v_n <> 2 THEN
        RAISE EXCEPTION
            'faltan columnas de aprobación o su comentario: % de 2', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_attribute a
     WHERE a.attrelid = 'core.vw_alerta_estado'::regclass
       AND a.attname = 'aprobada_por'
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'core.vw_alerta_estado no expone aprobada_por';
    END IF;

    SELECT count(*) INTO v_cols
      FROM pg_attribute a
     WHERE a.attrelid = 'core.vw_alerta_estado'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_cols <> 19 THEN
        RAISE EXCEPTION
            'core.vw_alerta_estado tiene % columnas y debe tener 19', v_cols;
    END IF;

    SELECT count(*) INTO v_alertas FROM core.vw_alerta_estado;
    IF v_alertas <> 83 THEN
        RAISE EXCEPTION
            'core.vw_alerta_estado devuelve % filas y debe devolver 83', v_alertas;
    END IF;

    -- 6.4 · RLS de los dos catálogos
    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core'
       AND c.relname IN ('flujo_estado', 'permiso_aprobacion')
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'los catálogos del flujo no tienen RLS y FORCE RLS';
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_policies
     WHERE schemaname = 'core' AND tablename = 'flujo_estado'
       AND policyname LIKE 'p21_flujo_estado_%';
    IF v_n <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 políticas p21_flujo_estado_* y hay %', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_policies
     WHERE schemaname = 'core' AND tablename = 'permiso_aprobacion'
       AND policyname LIKE 'p21_permiso_aprob_%';
    IF v_n <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 políticas p21_permiso_aprob_* y hay %', v_n;
    END IF;

    -- 6.5 · El proceso no se toca
    SELECT count(*) INTO v_n FROM core.proceso_instancia;
    IF v_n <> 218 THEN
        RAISE EXCEPTION
            'core.proceso_instancia tiene % filas y debía seguir con 218', v_n;
    END IF;

    -- 6.6 · Prueba funcional del trigger, sobre una fila que se borra al
    --       final: ni un paso real se toca y no queda rastro
    INSERT INTO core.flujo_definicion
        (tipo_flujo, orden, nombre, estado_resultante, rol_responsable,
         codigo_legado)
    VALUES ('caso', 99, 'Prueba del trigger', 'Prueba', 'sectorista',
            'P21-PRUEBA')
    RETURNING id INTO v_id;

    BEGIN
        UPDATE core.flujo_definicion
           SET rol_responsable = 'inventado' WHERE id = v_id;
        v_fallo := false;
    EXCEPTION WHEN raise_exception THEN
        v_fallo := true;
    END;
    IF NOT v_fallo THEN
        DELETE FROM core.flujo_definicion WHERE id = v_id;
        RAISE EXCEPTION
            'el trigger aceptó rol_responsable = inventado';
    END IF;

    BEGIN
        UPDATE core.flujo_definicion
           SET rol_responsable = 'sectorista,direccion_oaipcs' WHERE id = v_id;
        v_ok := true;
    EXCEPTION WHEN raise_exception THEN
        v_ok := false;
    END;
    IF NOT v_ok THEN
        DELETE FROM core.flujo_definicion WHERE id = v_id;
        RAISE EXCEPTION
            'el trigger rechazó la combinación sectorista,direccion_oaipcs';
    END IF;

    DELETE FROM core.flujo_definicion WHERE id = v_id;

    SELECT count(*) INTO v_n FROM core.flujo_definicion;
    IF v_n <> 12 THEN
        RAISE EXCEPTION
            'la prueba del trigger dejó % filas en core.flujo_definicion', v_n;
    END IF;

    -- 6.7 · Cifras del estado posterior (informativas)
    SELECT count(*) INTO v_roles FROM core.usuario_roles;
    SELECT count(*) INTO v_pi    FROM core.proceso_instancia;

    RAISE NOTICE
        'direccion_oaipcs: % cuenta vigente (SEC-11) · usuario_roles: % · flujo_definicion: 12 pasos · proceso_instancia: % · alertas: % · columnas de vw_alerta_estado: %',
        v_cuentas, v_roles, v_pi, v_alertas, v_cols;
END
$p21_verify$;

COMMIT;

\echo 'PARCHE 21 · aplicado'
