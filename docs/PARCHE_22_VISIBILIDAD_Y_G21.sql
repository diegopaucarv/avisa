-- =====================================================================
--  AVISA · PARCHE 22 · Visibilidad, G21 ejecutable y suplencia
-- =====================================================================
--  QUÉ ES
--
--  Cierra los cinco pendientes de base que dejaron abiertos los parches
--  20 y 21:
--
--      (a) añade `core.alertas_tempranas.visibilidad`, la columna que
--          distingue una alerta que solo ve la OAIPCS de una que se
--          publica en el Perfil B o que se remite a destinatarios
--          nombrados;
--      (b) hace ejecutable G21 con un trigger que rechaza cualquier
--          visibilidad distinta de `interna` mientras falte alguna de
--          las dos aprobaciones humanas;
--      (c) da consumidor a `core.permiso_aprobacion`, la tabla de
--          suplencias que el parche 10 creó y que hasta hoy nadie leía,
--          con la función `core.puede_aprobar()` y una vista de apoyo
--          para la pantalla de administración;
--      (d) expone `visibilidad` al final de `core.vw_alerta_estado`;
--      (e) corrige el desfase de `core.alertas_tempranas.paso_actual`,
--          que decía 1 en alertas cuyo proceso está en el paso 5.
--
--  A eso se suma una decisión documental, no un cambio de catálogo: las
--  9 instancias del flujo `reporte` que no tienen `flujo_definicion_id`
--  se explican como pasos del sistema anterior sin equivalente en el
--  modelo de tres pasos.
--
--  POR QUÉ EXISTE
--
--  1. El parche 21 puso `aprobada_por` y `aprobada_en`, pero G21 no era
--     ejecutable: el gate se dispara con `visibilidad = 'perfil_b'` y la
--     columna `visibilidad` no existía. El contrato en
--     `config.guardrail_contract` era declarativo: decía qué debía
--     rechazarse, no que ya se rechazara.
--
--  2. `core.permiso_aprobacion` tenía RLS y 0 filas, pero ni una función
--     ni una pantalla que la leyeran. Una tabla sin consumidor no es una
--     capacidad: es una promesa. Mientras no exista el consumidor, la
--     suplencia del aprobador no se puede ni consultar.
--
--  3. `paso_actual` es una copia desnormalizada del paso del proceso y
--     nunca se sincronizó: las 83 alertas migradas quedaron en 1 aunque
--     su instancia de proceso está en el paso 5 (Archivo). Mientras siga
--     así, cualquier regla que lo lea —empezando por el propio gate—
--     miente.
--
--  QUÉ NO HACE
--
--  · No siembra filas en `core.permiso_aprobacion`. Designar a un
--    suplente es un acto administrativo de la OAIPCS y hoy no hay
--    decisión. El consumo queda resuelto aunque la tabla siga con 0
--    filas.
--
--  · No inventa aprobaciones. Las 83 alertas existentes se quedan en
--    `visibilidad = 'interna'` y con `aprobada_por` en NULL; el gate no
--    las toca porque su regla solo mira los valores distintos de
--    `interna`.
--
--  · No amplía el catálogo de pasos del flujo `reporte`. El modelo nuevo
--    tiene tres pasos y las 9 instancias en los pasos 4, 5 y 6 son del
--    sistema anterior. Se documenta el significado de `NULL`; inventar
--    pasos 4 a 6 sería modelar un flujo que nadie definió.
--
--  · No toca `core.proceso_instancia` (sigue con 218 filas), ni
--    `core.flujo_definicion` (12 pasos), ni `core.usuario_roles` (36
--    asignaciones), ni el esquema `ref`.
--
--  · No reescribe la política de RLS de ninguna tabla y no mueve
--    `app.rol_codigo`: las escrituras de este parche se hacen con la
--    cuenta de aplicación, que es dueña del esquema.
--
--  DÓNDE SE EJECUTA
--
--  En la base viva del contenedor `avisa-db` (PostgreSQL 16, usuario
--  `avisa`, base `avisa`), por entrada estándar si el archivo no está
--  montado todavía:
--
--      MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
--          -v ON_ERROR_STOP=1 -f - < docs/PARCHE_22_VISIBILIDAD_Y_G21.sql
--
--  ORDEN
--  Después del parche 21. Usa `aprobada_por` y `aprobada_en` (parche 21),
--  el rol `direccion_oaipcs` y su cuenta vigente (parches 20 y 21), los
--  cinco pasos del flujo de alerta (parche 20), `core.usuario_roles`
--  (parches 4, 16 y 21) y la vista `core.vw_alerta_estado` (parches 14 y
--  21).
--
--  IDEMPOTENTE
--  Se puede repetir. La columna se añade con `IF NOT EXISTS`; la
--  restricción se busca antes en `pg_constraint` y solo se recrea si su
--  definición no es la del parche; el índice va con `IF NOT EXISTS`; la
--  función y el trigger se recrean con `CREATE OR REPLACE` y
--  `DROP TRIGGER IF EXISTS`; la vista con `CREATE OR REPLACE`; y el
--  `UPDATE` del desfase lleva la guarda `IS DISTINCT FROM`, de modo que
--  la segunda pasada no reescribe ninguna fila ni su `updated_at`.
--  Correrlo dos veces seguidas no falla y no deja rastro.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'PARCHE 22 · bloque 0/8 · comprobaciones previas'

-- ---------------------------------------------------------------------
-- 0 · El estado de partida tiene que ser el esperado
-- ---------------------------------------------------------------------
DO $p22_pre$
DECLARE
    v_n integer;
BEGIN
    IF to_regclass('core.alertas_tempranas')  IS NULL
       OR to_regclass('core.proceso_instancia') IS NULL
       OR to_regclass('core.flujo_definicion')  IS NULL
       OR to_regclass('core.flujo_estado')      IS NULL
       OR to_regclass('core.permiso_aprobacion') IS NULL
       OR to_regclass('core.usuario_roles')     IS NULL
       OR to_regclass('core.roles')             IS NULL THEN
        RAISE EXCEPTION
            'Faltan tablas del núcleo. Aplique antes los parches 10, 14 y 21.';
    END IF;

    --  G21 se apoya en las dos columnas que dejó el parche 21. Si no están,
    --  este parche estaría haciendo ejecutable un gate que no tiene qué leer.
    SELECT count(*) INTO v_n
      FROM pg_attribute a
     WHERE a.attrelid = 'core.alertas_tempranas'::regclass
       AND a.attname IN ('aprobada_por', 'aprobada_en')
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_n <> 2 THEN
        RAISE EXCEPTION
            'Faltan aprobada_por/aprobada_en (% de 2). Aplique antes el parche 21.', v_n;
    END IF;

    --  La Dirección tiene que existir como rol (parche 20) y tener su cuenta
    --  vigente (parche 21): sin eso, `core.puede_aprobar()` devolvería
    --  siempre falso y el gate no tendría a quién autorizar.
    SELECT count(*) INTO v_n FROM core.roles WHERE codigo = 'direccion_oaipcs';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'Falta el rol direccion_oaipcs. Aplique antes el parche 20.';
    END IF;

    SELECT count(*) INTO v_n
      FROM core.usuario_roles ur
      JOIN core.roles r ON r.id = ur.rol_id
     WHERE r.codigo = 'direccion_oaipcs' AND ur.hasta IS NULL;
    IF v_n <> 1 THEN
        RAISE EXCEPTION
            'Se esperaba 1 cuenta vigente de direccion_oaipcs y hay %. '
            'Aplique antes el parche 21.', v_n;
    END IF;

    --  El flujo de alerta tiene que estar en cinco pasos (parche 20): el gate
    --  habla del paso 2 (validación previa) y del paso 3 (aprobación).
    SELECT count(*) INTO v_n FROM core.flujo_definicion WHERE tipo_flujo = 'alerta';
    IF v_n <> 5 THEN
        RAISE EXCEPTION
            'Se esperaban los 5 pasos del flujo de alerta y hay %. '
            'Aplique antes el parche 20.', v_n;
    END IF;

    --  El flujo de reporte tiene que seguir en tres pasos: el bloque 6
    --  documenta las 9 instancias sin definición y NO amplía este catálogo.
    --  Si alguien lo amplió antes, la nota que escribe este parche mentiría.
    SELECT count(*) INTO v_n FROM core.flujo_definicion WHERE tipo_flujo = 'reporte';
    IF v_n <> 3 THEN
        RAISE EXCEPTION
            'Se esperaban 3 pasos del flujo de reporte y hay %. Revise '
            'core.flujo_definicion antes de aplicar el parche 22.', v_n;
    END IF;

    --  Las cifras de partida que el bloque 5 necesita para no forzar números.
    SELECT count(*) INTO v_n FROM core.alertas_tempranas;
    IF v_n <> 83 THEN
        RAISE EXCEPTION 'Se esperaban 83 alertas y hay %', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM core.proceso_instancia;
    IF v_n <> 218 THEN
        RAISE EXCEPTION 'Se esperaban 218 instancias de proceso y hay %', v_n;
    END IF;

    RAISE NOTICE 'PARCHE 22 · estado de partida coherente';
END
$p22_pre$;

BEGIN;

-- =====================================================================
-- BLOQUE 1 · La visibilidad de la alerta
-- =====================================================================
\echo 'PARCHE 22 · bloque 1/8 · la visibilidad de la alerta'

--  Tres valores, no un booleano: `interna` es «solo la OAIPCS»; `ejecutiva`
--  añade el Perfil B; `sectorial` limita la remisión a los destinatarios
--  nombrados. Están diseñados en docs/03_ejecucion/mvp.md (§2.2, ALERTA y
--  matriz de acceso) y son los únicos que admite la restricción.
--
--  El DEFAULT es `interna` a propósito: una alerta nace invisible fuera de
--  la OAIPCS y solo deja de serlo cuando una persona la aprueba. Que el
--  valor de nacimiento sea el seguro es lo que hace que el gate tenga algo
--  que proteger.
ALTER TABLE core.alertas_tempranas
    ADD COLUMN IF NOT EXISTS visibilidad varchar(12) NOT NULL DEFAULT 'interna';

--  La restricción se busca en `pg_constraint` antes de crearla. Recrearla
--  siempre sería más corto, pero comparar el texto de `pg_get_constraintdef`
--  sirve además para detectar que alguien la redefinió por su cuenta: si la
--  definición no es la del parche, se rectifica. El literal es el que produce
--  PostgreSQL 16 al crear la restricción; si otra versión lo formatea distinto,
--  el peor caso es una recreación inocua.
DO $p22_check$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO v_def
      FROM pg_constraint c
     WHERE c.conrelid = 'core.alertas_tempranas'::regclass
       AND c.conname  = 'alertas_visibilidad_valida';

    IF v_def IS NULL THEN
        ALTER TABLE core.alertas_tempranas
            ADD CONSTRAINT alertas_visibilidad_valida
            CHECK (visibilidad IN ('interna', 'ejecutiva', 'sectorial'));
    ELSIF v_def <> $lit$CHECK (((visibilidad)::text = ANY ((ARRAY['interna'::character varying, 'ejecutiva'::character varying, 'sectorial'::character varying])::text[])))$lit$ THEN
        ALTER TABLE core.alertas_tempranas
            DROP CONSTRAINT alertas_visibilidad_valida;
        ALTER TABLE core.alertas_tempranas
            ADD CONSTRAINT alertas_visibilidad_valida
            CHECK (visibilidad IN ('interna', 'ejecutiva', 'sectorial'));
        RAISE NOTICE 'alertas_visibilidad_valida tenía otra definición: recreada';
    END IF;
END
$p22_check$;

--  RD-08 no es una restricción de visibilidad: prohíbe datos personales en el
--  canal público del Dashboard Estratégico (Publish to Web), sea cual sea la
--  visibilidad de la alerta. Se dice en el comentario para que nadie lea
--  `ejecutiva` como un permiso para publicar lo que sea.
COMMENT ON COLUMN core.alertas_tempranas.visibilidad IS
    'Alcance de la alerta. interna: solo la ve la OAIPCS (Perfil A), es el valor de nacimiento y el único admisible mientras falte alguna de las dos aprobaciones humanas. ejecutiva: además se ve en el Perfil B (Alta Dirección). sectorial: la remisión se limita a los destinatarios nombrados de esa alerta (el portal del Perfil C queda fuera del MVP). No relaja RD-08: ningún dato personal pasa por el canal público del Dashboard Estratégico, cualquiera sea la visibilidad. El gate G21 (trigger alertas_g21_visibilidad) impide salir de interna sin la validación previa del Sectorista y la aprobación definitiva de la Dirección';

--  Índice parcial: las consultas del Perfil B y de la remisión buscan «lo que
--  no es interna», que hoy son cero filas. Un índice completo sería casi todo
--  hueco y solo costaría escritura.
CREATE INDEX IF NOT EXISTS ix_alertas_visibilidad_no_interna
    ON core.alertas_tempranas (visibilidad)
    WHERE visibilidad <> 'interna';

-- =====================================================================
-- BLOQUE 2 · G21: el gate, ejecutable
-- =====================================================================
\echo 'PARCHE 22 · bloque 2/8 · G21 ejecutable'

--  G21 (§11.8 de AVISA_PRODUCE_v10) exige dos aprobaciones humanas antes de
--  que una alerta salga de la OAIPCS:
--
--    · validación previa del Sectorista: `es_validado_humano` verdadero,
--      `fecha_validacion` no nula y el proceso en el paso 2 o posterior;
--    · aprobación definitiva de la Dirección: `aprobada_por` y `aprobada_en`
--      no nulos.
--
--  El trigger es BEFORE y no AFTER a propósito: si algo falta, la escritura
--  no llega a ocurrir. Con un AFTER la fila ya estaría guardada y habría que
--  deshacerla desde la aplicación, que es justo lo que el gate evita.
--
--  ORDEN DE DISPARADORES. PostgreSQL ejecuta los BEFORE por nombre, en orden
--  alfabético. En esta tabla conviven `alertas_g21_visibilidad` (este
--  parche), `trg_audit` (rellena updated_at/updated_by/created_by) y
--  `trg_alerta_nace` (AFTER INSERT, crea el paso 1 en core.proceso_instancia).
--  El orden no se pisa: `trg_audit` solo escribe columnas de auditoría y este
--  gate solo lee columnas de negocio; `trg_alerta_nace` es AFTER, de modo que
--  si el gate rechaza un alta, el trigger que crea el proceso nunca llega a
--  ejecutarse y no queda una instancia huérfana.
CREATE OR REPLACE FUNCTION core.tg_alerta_g21_visibilidad()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_falta text[] := ARRAY[]::text[];
BEGIN
    --  El único caso libre es el valor de nacimiento. Cualquier otro exige
    --  las dos firmas, sin importar la prioridad ni la gravedad de la alerta:
    --  la gravedad decide el destinatario y el plazo, no quién autoriza.
    IF NEW.visibilidad IS NULL OR NEW.visibilidad = 'interna' THEN
        RETURN NEW;
    END IF;

    IF NOT (COALESCE(NEW.es_validado_humano, false)
            AND NEW.fecha_validacion IS NOT NULL
            AND COALESCE(NEW.paso_actual, 0) >= 2) THEN
        v_falta := v_falta || 'la validación previa del Sectorista (es_validado_humano, fecha_validacion y paso_actual >= 2)'::text;
    END IF;

    IF NEW.aprobada_por IS NULL OR NEW.aprobada_en IS NULL THEN
        v_falta := v_falta || 'la aprobación definitiva de la Dirección de la OAIPCS (aprobada_por y aprobada_en)'::text;
    END IF;

    IF cardinality(v_falta) > 0 THEN
        RAISE EXCEPTION
            'G21_SIN_APROBACION: la alerta % no puede pasar a visibilidad «%»; falta %',
            NEW.codigo_alerta, NEW.visibilidad, array_to_string(v_falta, ' y ')
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END
$fn$;

--  Se dispara en todo INSERT y en todo UPDATE, sin lista de columnas: el
--  invariante depende de seis columnas y una lista incompleta lo dejaría
--  abierto por el lado que nadie probó. El coste es una comparación por
--  escritura, y en las 83 filas migradas (`interna`) la función sale en la
--  primera línea.
DROP TRIGGER IF EXISTS alertas_g21_visibilidad ON core.alertas_tempranas;
CREATE TRIGGER alertas_g21_visibilidad
    BEFORE INSERT OR UPDATE ON core.alertas_tempranas
    FOR EACH ROW EXECUTE FUNCTION core.tg_alerta_g21_visibilidad();

COMMENT ON FUNCTION core.tg_alerta_g21_visibilidad() IS
    'Gate G21: rechaza con ERRCODE P0001 y mensaje G21_SIN_APROBACION cualquier visibilidad distinta de interna mientras falte la validación previa del Sectorista o la aprobación definitiva de la Dirección. Las alertas internas, incluidas las 83 migradas, pasan sin comprobación';

-- =====================================================================
-- BLOQUE 3 · La suplencia: consumidor de core.permiso_aprobacion
-- =====================================================================
\echo 'PARCHE 22 · bloque 3/8 · la suplencia del aprobador'

--  `core.permiso_aprobacion` habilita a una persona concreta para un objeto
--  concreto durante una vigencia. Es la vía para que alguien que no tiene el
--  rol `direccion_oaipcs` pueda aprobar mientras la Dirección está ausente,
--  sin darle el rol entero.
--
--  La función es SECURITY DEFINER por la misma razón que
--  `core.tg_flujo_def_valida_rol()`: `core.usuario_roles` tiene RLS forzada y
--  un rol sin privilegios de lectura no debe poder contestar «no» a una
--  pregunta cuya respuesta no puede ver. Con el dueño de la función, la
--  respuesta no depende de quién pregunte.
--
--  `p_objeto` tiene valor por defecto porque hoy hay un solo objeto de
--  aprobación en el sistema; cuando existan más, el parámetro ya está.
CREATE OR REPLACE FUNCTION core.puede_aprobar(
    p_usuario uuid,
    p_objeto  text DEFAULT 'aprobacion_alerta'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'core'
AS $fn$
    SELECT p_usuario IS NOT NULL
       AND (
            --  Camino 1 · tiene el rol de la Dirección y la asignación está
            --  vigente hoy: `hasta` nulo significa «abierta».
            EXISTS (
                SELECT 1
                  FROM core.usuario_roles ur
                  JOIN core.roles r ON r.id = ur.rol_id
                 WHERE ur.usuario_id = p_usuario
                   AND r.codigo = 'direccion_oaipcs'
                   AND ur.desde <= CURRENT_DATE
                   AND (ur.hasta IS NULL OR ur.hasta >= CURRENT_DATE))
            OR
            --  Camino 2 · tiene una suplencia vigente para ese objeto.
            EXISTS (
                SELECT 1
                  FROM core.permiso_aprobacion pa
                 WHERE pa.usuario_id = p_usuario
                   AND pa.objeto = p_objeto
                   AND pa.vigente_desde <= CURRENT_DATE
                   AND (pa.vigente_hasta IS NULL OR pa.vigente_hasta >= CURRENT_DATE))
       );
$fn$;

COMMENT ON FUNCTION core.puede_aprobar(uuid, text) IS
    'true si el usuario puede aprobar el objeto indicado: o tiene el rol direccion_oaipcs vigente en core.usuario_roles, o tiene una suplencia vigente en core.permiso_aprobacion para ese objeto. p_objeto vale aprobacion_alerta por defecto. No escribe nada y no sustituye al gate G21: el gate sigue exigiendo las dos firmas en la alerta';

--  Contrato de la tabla. Se amplía el comentario que ya estaba en la
--  curaduría en lugar de reemplazarlo: el texto base sigue siendo válido.
COMMENT ON TABLE core.permiso_aprobacion IS
    'Autorización temporal que habilita a un usuario a aprobar un objeto determinado, con su vigencia y quién la otorgó. Desde el parche 22 tiene consumidor: core.puede_aprobar() la consulta para la suplencia del aprobador y core.vw_permiso_aprobacion la expone a la pantalla de administración. Una fila aquí no concede un rol: solo habilita a esa persona para ese objeto mientras la vigencia esté abierta. Vacía significa que no hay suplencia designada';

--  Vista de apoyo de la pantalla de administración. `security_invoker` para
--  que cada sesión vea lo que su propia RLS le permite ver de `core.usuarios`:
--  el rol `administrador` ve el padrón completo y cualquier otro solo su fila.
--  Sin ese ajuste, la vista correría con los permisos del dueño y un sectorista
--  que abriera el panel vería nombres que la tabla le oculta.
CREATE OR REPLACE VIEW core.vw_permiso_aprobacion
WITH (security_invoker = true) AS
SELECT pa.id,
       pa.usuario_id,
       u.nombre              AS usuario_nombre,
       u.codigo_legado       AS usuario_codigo_legado,
       pa.objeto,
       pa.vigente_desde,
       pa.vigente_hasta,
       (pa.vigente_desde <= CURRENT_DATE
        AND (pa.vigente_hasta IS NULL OR pa.vigente_hasta >= CURRENT_DATE))
                             AS vigente,
       pa.otorgado_por,
       o.nombre              AS otorgado_por_nombre
  FROM core.permiso_aprobacion pa
  JOIN core.usuarios u ON u.id = pa.usuario_id
  LEFT JOIN core.usuarios o ON o.id = pa.otorgado_por;

COMMENT ON VIEW core.vw_permiso_aprobacion IS
    'Suplencias de aprobación con nombre de la persona habilitada, objeto, vigencia y una marca vigente calculada al consultar. Es la lectura de la pantalla de administración de membresías; no cambia permisos, solo los muestra. Hoy devuelve 0 filas porque no hay suplente designado';

-- =====================================================================
-- BLOQUE 4 · La vista del estado, con la visibilidad
-- =====================================================================
\echo 'PARCHE 22 · bloque 4/8 · core.vw_alerta_estado con visibilidad'

--  Se conservan las 19 columnas en el mismo orden y `visibilidad` va al
--  final, igual que el parche 21 hizo con las dos de la aprobación. Un
--  consumidor que lea por posición no se entera; uno que lea por nombre
--  encuentra la columna nueva sin que cambie nada de lo anterior.
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
       a.aprobada_en,
       a.visibilidad
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
    'aprobada_en), que registra el paso 3 del flujo de alerta, y su '
    'visibilidad (interna, ejecutiva o sectorial), que el gate G21 controla';

-- =====================================================================
-- BLOQUE 5 · El desfase de paso_actual
-- =====================================================================
\echo 'PARCHE 22 · bloque 5/8 · desfase de paso_actual'

--  `paso_actual` es una copia desnormalizada y nunca se sincronizó: el
--  cargador la rellenó con el paso del sistema anterior (1) y el parche 20
--  renumeró el Archivo al paso 5 en core.proceso_instancia, pero no en la
--  alerta. El paso real de una alerta es el de su última instancia de
--  proceso —el mismo que lee la vista—, así que se deriva de ahí: no se
--  escribe un 5 a mano.
--
--  El criterio se comprueba antes de aplicarlo. Si el desfase no cubre
--  exactamente las 83 alertas (o cero, que es la segunda pasada), el parche
--  se detiene: un número forzado sobre un criterio que no calza es peor que
--  un pendiente declarado.
DO $p22_desfase$
DECLARE
    v_desfase integer;
    v_otro    integer;
BEGIN
    SELECT count(*) INTO v_desfase
      FROM core.alertas_tempranas a
      JOIN LATERAL (
            SELECT max(p.orden) AS ultimo
              FROM core.proceso_instancia p
             WHERE p.tipo_origen = 'alerta' AND p.alerta_id = a.id
           ) x ON true
     WHERE x.ultimo IS NOT NULL
       AND a.paso_actual IS DISTINCT FROM x.ultimo;

    IF v_desfase NOT IN (0, 83) THEN
        RAISE EXCEPTION
            'el desfase de paso_actual cubre % alertas y no las 83 esperadas. '
            'Revise core.proceso_instancia antes de aplicar el parche 22', v_desfase;
    END IF;

    --  Toda fila que el criterio toca tiene que quedar en el paso 5. Si alguna
    --  derivara a otro paso, no es el desfase documentado y no se toca.
    SELECT count(*) INTO v_otro
      FROM core.alertas_tempranas a
      JOIN LATERAL (
            SELECT max(p.orden) AS ultimo
              FROM core.proceso_instancia p
             WHERE p.tipo_origen = 'alerta' AND p.alerta_id = a.id
           ) x ON true
     WHERE x.ultimo IS NOT NULL AND x.ultimo <> 5
       AND a.paso_actual IS DISTINCT FROM x.ultimo;

    IF v_otro <> 0 THEN
        RAISE EXCEPTION
            '% alertas quedarían en un paso distinto de 5 con este criterio', v_otro;
    END IF;

    RAISE NOTICE 'desfase de paso_actual: % alertas por corregir', v_desfase;
END
$p22_desfase$;

--  `IS DISTINCT FROM` es la guarda de idempotencia: en la segunda pasada no
--  hay filas que cumplan el predicado y `updated_at` no se reescribe. El
--  trigger de auditoría sí mueve `updated_at` en la primera pasada, y es
--  correcto: la fila cambió de verdad.
UPDATE core.alertas_tempranas a
   SET paso_actual = x.ultimo
  FROM (
        SELECT p.alerta_id, max(p.orden) AS ultimo
          FROM core.proceso_instancia p
         WHERE p.tipo_origen = 'alerta' AND p.alerta_id IS NOT NULL
         GROUP BY p.alerta_id
       ) x
 WHERE x.alerta_id = a.id
   AND a.paso_actual IS DISTINCT FROM x.ultimo;

COMMENT ON COLUMN core.alertas_tempranas.paso_actual IS
    'Número del paso del flujo operativo en que se encuentra la alerta. Es una copia desnormalizada de core.proceso_instancia: el paso real es el de la última instancia de proceso de la alerta. El parche 22 puso en 5 las 83 alertas migradas que decían 1 con el proceso ya archivado';

-- =====================================================================
-- BLOQUE 6 · Los pasos de reporte sin definición: se documentan, no se
--           inventan
-- =====================================================================
\echo 'PARCHE 22 · bloque 6/8 · los pasos de reporte sin definición'

--  `core.flujo_definicion` define tres pasos de reporte (Elaboración,
--  Remisión, Archivo). `core.proceso_instancia` tiene 9 instancias de reporte
--  en los pasos 4, 5 y 6 sin `flujo_definicion_id`: son pasos del sistema
--  anterior, que tenía seis, y no tienen equivalente en el modelo nuevo.
--
--  Ampliar el catálogo habría sido peor: crearía tres pasos que nadie
--  definió, con un rol responsable inventado y un estado resultante sacado de
--  la nada, y el flujo de reporte del sistema nuevo pasaría a tener seis
--  pasos «porque el anterior los tenía». La alternativa —mapear el paso 6
--  (Archivado) al 3 (Archivo)— tampoco vale: reescribiría la historia de un
--  reporte archivado en febrero de 2026 como si hubiera pasado por un flujo
--  que no existía.
--
--  Así que `NULL` significa exactamente eso y se dice en el comentario de la
--  columna: no es un dato que falte.
COMMENT ON COLUMN core.proceso_instancia.flujo_definicion_id IS
    'Paso del catálogo, resuelto por tipo de flujo y número de orden. Está vacío en las 9 instancias migradas del flujo de reporte cuyos pasos 4, 5 y 6 venían del sistema anterior y no existen en el modelo de tres pasos (Elaboración, Remisión, Archivo): no es un dato que falte, es la huella de que el flujo anterior tenía seis pasos. El parche 22 lo deja así a propósito y no amplía el catálogo';

DO $p22_reporte$
DECLARE
    v_total  integer;
    v_sin    integer;
    v_otro   integer;
    v_notas  text;
BEGIN
    SELECT count(*) INTO v_total FROM core.proceso_instancia WHERE tipo_origen = 'reporte';
    SELECT count(*) INTO v_sin
      FROM core.proceso_instancia
     WHERE tipo_origen = 'reporte' AND flujo_definicion_id IS NULL;

    IF v_sin <> 9 THEN
        RAISE EXCEPTION
            'se esperaban 9 instancias de reporte sin flujo_definicion_id y hay %', v_sin;
    END IF;

    SELECT count(*) INTO v_otro
      FROM core.proceso_instancia
     WHERE flujo_definicion_id IS NULL AND tipo_origen <> 'reporte';
    IF v_otro <> 0 THEN
        RAISE EXCEPTION
            'hay % instancias sin flujo_definicion_id que no son de reporte', v_otro;
    END IF;

    SELECT string_agg(format('paso %s: %s', orden, coalesce(nota, '(sin nota)')), ' · '
                      ORDER BY orden, codigo_legado)
      INTO v_notas
      FROM core.proceso_instancia
     WHERE tipo_origen = 'reporte' AND flujo_definicion_id IS NULL;

    RAISE NOTICE
        'reporte: % instancias, % sin definición (pasos 4-6) · %', v_total, v_sin, v_notas;
END
$p22_reporte$;

-- =====================================================================
-- BLOQUE 7 · Verificación
-- =====================================================================
\echo 'PARCHE 22 · bloque 7/8 · verificación'

DO $p22_verify$
DECLARE
    v_n           integer;
    v_cols        integer;
    v_alertas     integer;
    v_cols_vista  text[];
    v_sec11       uuid;
    v_otro        uuid;
    v_id          uuid;
    v_fallo       boolean;
    v_msg         text;
    v_estado      text;
    v_internas    integer;
    v_pi          integer;
BEGIN
    -- 7.1 · La columna, con su comentario, su restricción y su índice
    SELECT count(*) INTO v_n
      FROM pg_attribute a
     WHERE a.attrelid = 'core.alertas_tempranas'::regclass
       AND a.attname = 'visibilidad'
       AND a.attnum > 0 AND NOT a.attisdropped
       AND col_description(a.attrelid, a.attnum) IS NOT NULL;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'falta la columna visibilidad o su comentario';
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = 'core.alertas_tempranas'::regclass
       AND c.conname  = 'alertas_visibilidad_valida'
       AND c.contype  = 'c' AND c.convalidated;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'falta la restricción alertas_visibilidad_valida';
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'core.alertas_tempranas'::regclass
       AND c.relname  = 'ix_alertas_visibilidad_no_interna'
       AND i.indpred IS NOT NULL;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'falta el índice parcial ix_alertas_visibilidad_no_interna';
    END IF;

    -- 7.2 · 36 columnas y las 83 alertas en interna
    SELECT count(*) INTO v_cols
      FROM pg_attribute a
     WHERE a.attrelid = 'core.alertas_tempranas'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_cols <> 36 THEN
        RAISE EXCEPTION
            'core.alertas_tempranas tiene % columnas y debe tener 36', v_cols;
    END IF;

    SELECT count(*) INTO v_alertas FROM core.alertas_tempranas;
    IF v_alertas <> 83 THEN
        RAISE EXCEPTION 'hay % alertas y deben ser 83', v_alertas;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.alertas_tempranas WHERE visibilidad = 'interna';
    IF v_n <> 83 THEN
        RAISE EXCEPTION 'hay % alertas internas y deben ser las 83', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.alertas_tempranas WHERE visibilidad <> 'interna';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'hay % alertas con visibilidad distinta de interna', v_n;
    END IF;

    -- 7.3 · La vista: 20 columnas, las 19 anteriores intactas y 83 filas
    SELECT array_agg(a.attname ORDER BY a.attnum) INTO v_cols_vista
      FROM pg_attribute a
     WHERE a.attrelid = 'core.vw_alerta_estado'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped;

    IF array_length(v_cols_vista, 1) <> 20 THEN
        RAISE EXCEPTION
            'core.vw_alerta_estado tiene % columnas y debe tener 20',
            array_length(v_cols_vista, 1);
    END IF;

    IF v_cols_vista[1:19] <> ARRAY[
           'alerta_id', 'codigo_alerta', 'titulo', 'prioridad_id',
           'nivel_alerta_id', 'fecha_reporte', 'proceso_id', 'paso',
           'paso_nombre', 'estado_id', 'estado_codigo', 'estado_nombre',
           'es_final', 'estado_desde', 'es_validado_humano', 'fecha_validacion',
           'fecha_remision', 'aprobada_por', 'aprobada_en']::text[]
       OR v_cols_vista[20] <> 'visibilidad' THEN
        RAISE EXCEPTION
            'core.vw_alerta_estado cambió de orden o de nombres: %', v_cols_vista;
    END IF;

    SELECT count(*) INTO v_n FROM core.vw_alerta_estado;
    IF v_n <> 83 THEN
        RAISE EXCEPTION
            'core.vw_alerta_estado devuelve % filas y debe devolver 83', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.vw_alerta_estado WHERE visibilidad = 'interna';
    IF v_n <> 83 THEN
        RAISE EXCEPTION 'la vista devuelve % alertas internas y deben ser 83', v_n;
    END IF;

    -- 7.4 · El gate existe y es BEFORE INSERT OR UPDATE FOR EACH ROW
    SELECT count(*) INTO v_n
      FROM pg_trigger t
     WHERE t.tgrelid = 'core.alertas_tempranas'::regclass
       AND t.tgname  = 'alertas_g21_visibilidad'
       AND NOT t.tgisinternal
       AND pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT OR UPDATE ON%'
       AND pg_get_triggerdef(t.oid) LIKE '%FOR EACH ROW%';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'el trigger alertas_g21_visibilidad no existe o no es BEFORE INSERT OR UPDATE FOR EACH ROW';
    END IF;

    -- 7.5 · puede_aprobar: true para la Directora, false para quien no tiene
    --       el rol, false para un usuario inexistente y false con NULL
    SELECT u.id INTO v_sec11 FROM core.usuarios u WHERE u.codigo_legado = 'SEC-11';
    IF v_sec11 IS NULL THEN
        RAISE EXCEPTION 'no existe la cuenta SEC-11';
    END IF;

    IF core.puede_aprobar(v_sec11) IS NOT TRUE THEN
        RAISE EXCEPTION 'core.puede_aprobar() debería devolver true para SEC-11';
    END IF;

    SELECT u.id INTO v_otro
      FROM core.usuarios u
     WHERE NOT EXISTS (
             SELECT 1
               FROM core.usuario_roles ur
               JOIN core.roles r ON r.id = ur.rol_id
              WHERE ur.usuario_id = u.id
                AND r.codigo = 'direccion_oaipcs'
                AND ur.desde <= CURRENT_DATE
                AND (ur.hasta IS NULL OR ur.hasta >= CURRENT_DATE))
     ORDER BY u.codigo_legado
     LIMIT 1;
    IF v_otro IS NULL THEN
        RAISE EXCEPTION
            'la verificación necesita al menos una cuenta sin direccion_oaipcs';
    END IF;

    IF core.puede_aprobar(v_otro) IS NOT FALSE THEN
        RAISE EXCEPTION 'core.puede_aprobar() debería devolver false para una cuenta sin el rol';
    END IF;

    IF core.puede_aprobar(gen_random_uuid()) IS NOT FALSE THEN
        RAISE EXCEPTION 'core.puede_aprobar() debería devolver false para un usuario inexistente';
    END IF;

    IF core.puede_aprobar(NULL) IS NOT FALSE THEN
        RAISE EXCEPTION 'core.puede_aprobar() debería devolver false con NULL';
    END IF;

    --  La suplencia sigue sin filas: el parche no designa a nadie.
    SELECT count(*) INTO v_n FROM core.permiso_aprobacion;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'core.permiso_aprobacion tiene % filas y no debe tener ninguna', v_n;
    END IF;

    -- 7.6 · El gate rechaza de verdad. Se hace sobre una fila temporal que se
    --       borra al final, dentro de esta transacción: no queda rastro.
    INSERT INTO core.alertas_tempranas (codigo_alerta, situacion_actual)
    VALUES ('P22-PRUEBA-G21', 'fila temporal de la verificación del parche 22')
    RETURNING id INTO v_id;

    -- (a) sin ninguna de las dos aprobaciones
    BEGIN
        UPDATE core.alertas_tempranas SET visibilidad = 'ejecutiva' WHERE id = v_id;
        v_fallo := false;
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        v_fallo := true;
    END;
    IF NOT v_fallo THEN
        DELETE FROM core.proceso_instancia WHERE alerta_id = v_id;
        DELETE FROM core.alertas_tempranas WHERE id = v_id;
        RAISE EXCEPTION 'el gate aceptó visibilidad = ejecutiva sin ninguna aprobación';
    END IF;
    IF v_estado <> 'P0001' OR v_msg NOT LIKE 'G21_SIN_APROBACION:%' THEN
        DELETE FROM core.proceso_instancia WHERE alerta_id = v_id;
        DELETE FROM core.alertas_tempranas WHERE id = v_id;
        RAISE EXCEPTION 'el gate falló con un código o un mensaje que no son los del contrato: % / %', v_estado, v_msg;
    END IF;
    IF position('validación previa' in v_msg) = 0
       OR position('aprobación definitiva' in v_msg) = 0 THEN
        DELETE FROM core.proceso_instancia WHERE alerta_id = v_id;
        DELETE FROM core.alertas_tempranas WHERE id = v_id;
        RAISE EXCEPTION 'el mensaje del gate no dice qué falta: %', v_msg;
    END IF;

    -- (b) con la validación previa, pero sin la aprobación de la Dirección
    BEGIN
        UPDATE core.alertas_tempranas
           SET visibilidad      = 'sectorial',
               es_validado_humano = true,
               fecha_validacion = CURRENT_DATE,
               paso_actual      = 5
         WHERE id = v_id;
        v_fallo := false;
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        v_fallo := true;
    END;
    IF NOT v_fallo THEN
        DELETE FROM core.proceso_instancia WHERE alerta_id = v_id;
        DELETE FROM core.alertas_tempranas WHERE id = v_id;
        RAISE EXCEPTION 'el gate aceptó visibilidad = sectorial sin aprobación de la Dirección';
    END IF;
    IF v_msg NOT LIKE 'G21_SIN_APROBACION:%'
       OR position('aprobación definitiva' in v_msg) = 0
       OR position('validación previa' in v_msg) > 0 THEN
        DELETE FROM core.proceso_instancia WHERE alerta_id = v_id;
        DELETE FROM core.alertas_tempranas WHERE id = v_id;
        RAISE EXCEPTION 'el mensaje del gate no nombra solo lo que falta: %', v_msg;
    END IF;

    -- (c) con las dos aprobaciones, el paso a visibilidad ejecutiva pasa. La
    --     validación previa se vuelve a fijar porque la sentencia (b) abortó y
    --     no dejó nada escrito: es el mismo acto único que hará la aplicación.
    UPDATE core.alertas_tempranas
       SET es_validado_humano = true,
           fecha_validacion  = CURRENT_DATE,
           paso_actual       = 5,
           aprobada_por      = v_sec11,
           aprobada_en       = now(),
           visibilidad       = 'ejecutiva'
     WHERE id = v_id;

    -- (d) y una vez aprobada, el CHECK sigue rechazando un valor que no es
    --     de los tres: el gate no sustituye a la restricción.
    BEGIN
        UPDATE core.alertas_tempranas SET visibilidad = 'perfil_b' WHERE id = v_id;
        v_fallo := false;
    EXCEPTION WHEN check_violation THEN
        v_fallo := true;
    END;
    IF NOT v_fallo THEN
        DELETE FROM core.proceso_instancia WHERE alerta_id = v_id;
        DELETE FROM core.alertas_tempranas WHERE id = v_id;
        RAISE EXCEPTION 'la restricción aceptó visibilidad = perfil_b';
    END IF;

    --  La fila de prueba y su paso automático se borran; el recuento vuelve.
    DELETE FROM core.proceso_instancia WHERE alerta_id = v_id;
    DELETE FROM core.alertas_tempranas WHERE id = v_id;

    SELECT count(*) INTO v_n FROM core.alertas_tempranas;
    IF v_n <> 83 THEN
        RAISE EXCEPTION 'la prueba del gate dejó % alertas (deben ser 83)', v_n;
    END IF;

    -- 7.7 · paso_actual: las 83 en el 5, derivado del proceso, y solo ellas
    SELECT count(*) INTO v_n
      FROM core.alertas_tempranas WHERE paso_actual = 5;
    IF v_n <> 83 THEN
        RAISE EXCEPTION 'hay % alertas en el paso 5 y deben ser las 83', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.alertas_tempranas
     WHERE paso_actual IS DISTINCT FROM 5;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'quedan % alertas fuera del paso 5', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.alertas_tempranas a
      JOIN LATERAL (
            SELECT max(p.orden) AS ultimo
              FROM core.proceso_instancia p
             WHERE p.tipo_origen = 'alerta' AND p.alerta_id = a.id
           ) x ON true
     WHERE x.ultimo = 5 AND a.paso_actual = 5;
    IF v_n <> 83 THEN
        RAISE EXCEPTION
            'solo % alertas tienen paso_actual coherente con su proceso', v_n;
    END IF;

    -- 7.8 · Nada más se movió
    SELECT count(*) INTO v_n FROM core.proceso_instancia;
    IF v_n <> 218 THEN
        RAISE EXCEPTION
            'core.proceso_instancia tiene % filas y debía seguir con 218', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM core.flujo_definicion;
    IF v_n <> 12 THEN
        RAISE EXCEPTION
            'core.flujo_definicion tiene % filas y debía seguir con 12', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.proceso_instancia
     WHERE tipo_origen = 'reporte' AND flujo_definicion_id IS NULL;
    IF v_n <> 9 THEN
        RAISE EXCEPTION
            'las instancias de reporte sin definición cambiaron: hay %', v_n;
    END IF;

    -- 7.9 · Cifras del estado posterior (informativas)
    SELECT count(*) INTO v_internas
      FROM core.alertas_tempranas WHERE visibilidad = 'interna';
    SELECT count(*) INTO v_alertas FROM core.vw_alerta_estado;
    SELECT count(*) INTO v_pi FROM core.proceso_instancia;

    RAISE NOTICE
        'visibilidad: % alertas internas · alertas_tempranas: % columnas · vw_alerta_estado: % columnas y % filas · paso_actual: 83 en el paso 5 · permiso_aprobacion: 0 filas · proceso_instancia: %',
        v_internas, v_cols, array_length(v_cols_vista, 1), v_alertas, v_pi;
END
$p22_verify$;

COMMIT;

\echo 'PARCHE 22 · aplicado'
