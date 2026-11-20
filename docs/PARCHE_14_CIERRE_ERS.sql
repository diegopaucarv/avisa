-- =====================================================================
--  PARCHE 14 · CIERRE DE BRECHAS DEL ERS
-- =====================================================================
--  QUÉ ES
--  Cierra las cuatro brechas críticas que quedaron abiertas entre el
--  esquema v10 y la Especificación de Requisitos (ERS v0.6), más el
--  enlace entre la base legal y el corpus documental del KAG.
--
--  POR QUÉ EXISTE
--  El esquema tenía los objetos, pero cuatro de ellos no hacían lo que
--  el ERS exige:
--
--    RF-A03 · la seguridad por fila era inerte. El único rol de la base
--             (`avisa`) era superusuario con `rolbypassrls`, así que
--             ninguna de las 173 políticas se aplicaba nunca. Una
--             prueba de aislamiento con ese rol da falso positivo.
--    RF-A04 · la tabla de auditoría de datos personales se podía leer
--             sin restricción y se podía borrar.
--    RF-D01 · una alerta no podía tener estado: el motor de proceso
--             (`core.proceso_instancia`) ya tenía la columna
--             `alerta_id`, pero su CHECK prohibía el valor 'alerta'.
--    §12.4  · los actores de nivel 4 y 5 (sin identificar) podían
--             quedar georreferenciados, contra lo que manda el ERS.
--    §12.5  · `base_legal` era un texto libre con un solo valor de
--             migración (`LEGADO_AVISA_2026`) y sin vínculo con el
--             documento que lo sustenta.
--
--  DÓNDE SE EJECUTA
--  Es un parche de la sección B: exige el legado cargado. Crea la
--  primera fila de proceso de cada alerta existente y copia el
--  departamento de los actores desde `legacy.dim_actores`.
--
--      psql -U avisa -d avisa -f docs/PARCHE_14_CIERRE_ERS.sql
--
--  IDEMPOTENCIA
--  Se puede repetir sin efecto: usa IF NOT EXISTS, ON CONFLICT,
--  DROP ... IF EXISTS antes de cada CREATE y guardas NOT EXISTS en los
--  rellenos de datos.
--
--  QUÉ NO HACE
--  · No crea la tabla de situación judicial restringida (RENIEC/PNP):
--    el ERS la condiciona a un dictamen legal (H-04) y a la PIDE.
--  · No sustituye `base_legal` por el dictamen definitivo: crea el
--    catálogo y deja el token de migración apuntando a su fila.
--  · No inventa distritos. El origen legado sólo tiene departamento
--    (`DEP-xx`), nunca distrito, así que se puebla `region_id` y
--    `distrito_id` queda nulo a propósito.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'PARCHE 14 · bloque 0/6 · precondiciones'

DO $$
BEGIN
    IF to_regclass('core.alertas_tempranas') IS NULL THEN
        RAISE EXCEPTION 'PARCHE 14: falta el esquema base (core.alertas_tempranas). Aplique antes la sección A.';
    END IF;
    IF to_regclass('core.flujo_estado') IS NULL
       OR to_regclass('core.flujo_definicion') IS NULL
       OR to_regclass('core.proceso_instancia') IS NULL THEN
        RAISE EXCEPTION 'PARCHE 14: falta el parche 10 (motor de flujo). Aplique antes la sección B.4.';
    END IF;
    IF to_regclass('audit.datos_personales_acceso') IS NULL THEN
        RAISE EXCEPTION 'PARCHE 14: falta el parche 9 (auditoría de datos personales).';
    END IF;
    IF to_regclass('kag.documento_fragmento') IS NULL THEN
        RAISE EXCEPTION 'PARCHE 14: falta kag.documento_fragmento; sin corpus no hay vínculo de base legal.';
    END IF;
END
$$;


-- =====================================================================
--  BLOQUE 1 · SEGURIDAD REAL  (RF-A03, RF-A04, RNF-02, RNF-03)
-- =====================================================================
--  El problema no era la falta de políticas: había 173. El problema era
--  que el rol que usaba la aplicación no las respetaba.
--
--  La solución tiene tres piezas que se necesitan entre sí:
--    1. un rol de aplicación que NO pueda saltarse la seguridad por fila;
--    2. políticas que además cubran la tabla de auditoría;
--    3. privilegios que no permitan borrar ni alterar la auditoría.
--  Sin la pieza 1, las otras dos no sirven de nada.
-- =====================================================================

\echo 'PARCHE 14 · bloque 1/6 · rol de aplicación y auditoría'

-- El esquema `ref` se crea aquí, antes de los privilegios, porque más abajo
-- se conceden permisos sobre él. Su contenido llega en el bloque 5.
CREATE SCHEMA IF NOT EXISTS ref;

-- ---------------------------------------------------------------------
-- 1.1 · Rol de aplicación, sin privilegios de superusuario
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_app') THEN
        CREATE ROLE avisa_app NOLOGIN NOSUPERUSER NOBYPASSRLS
                              NOCREATEDB NOCREATEROLE INHERIT;
        RAISE NOTICE 'rol avisa_app creado (NOBYPASSRLS)';
    ELSE
        -- Si alguien lo elevó, se vuelve a bajar: el parche manda.
        ALTER ROLE avisa_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        RAISE NOTICE 'rol avisa_app ya existía; atributos reafirmados';
    END IF;
END
$$;

COMMENT ON ROLE avisa_app IS
    'Rol de la aplicación AVISA. Sin BYPASSRLS a propósito: las políticas de '
    'seguridad por fila deben aplicarse a toda consulta de la aplicación '
    '(RF-A03). La conexión de administración conserva otro rol.';

-- ---------------------------------------------------------------------
-- 1.2 · Quién puede leer la bitácora de datos personales
-- ---------------------------------------------------------------------
-- Los nueve códigos existen en core.roles. Sólo tres pueden auditar:
-- administrador (incluye al Oficial de Datos Personales), auditor y
-- alta_direccion. El resto —analistas, consulta, servicio de agente,
-- externo— no ve la bitácora.
CREATE OR REPLACE FUNCTION core.puede_auditar()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, core
AS $$
    SELECT COALESCE(current_setting('app.rol_codigo', true), '') IN
           ('administrador', 'auditor', 'alta_direccion');
$$;

COMMENT ON FUNCTION core.puede_auditar() IS
    'Indica si la sesión actual puede leer audit.datos_personales_acceso. '
    'Lee el parámetro de sesión app.rol_codigo, que la aplicación fija al '
    'autenticar. Sin parámetro devuelve falso: el silencio cierra, no abre.';

-- ---------------------------------------------------------------------
-- 1.3 · La bitácora pasa a ser de sólo lectura y de escritura append-only
-- ---------------------------------------------------------------------
ALTER TABLE audit.datos_personales_acceso ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.datos_personales_acceso FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_audit_insert ON audit.datos_personales_acceso;
CREATE POLICY p_audit_insert ON audit.datos_personales_acceso
    FOR INSERT TO PUBLIC
    WITH CHECK (true);

DROP POLICY IF EXISTS p_audit_lectura ON audit.datos_personales_acceso;
CREATE POLICY p_audit_lectura ON audit.datos_personales_acceso
    FOR SELECT TO PUBLIC
    USING (core.puede_auditar());

-- Sin política de UPDATE ni de DELETE: con RLS activa, la ausencia de
-- política es una denegación. Los triggers de sólo-anexar del parche 9
-- siguen siendo la segunda barrera.
DROP POLICY IF EXISTS p_audit_update ON audit.datos_personales_acceso;
DROP POLICY IF EXISTS p_audit_delete ON audit.datos_personales_acceso;

REVOKE ALL ON audit.datos_personales_acceso FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 1.4 · Privilegios del rol de aplicación
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA core, kag, ind, analisis, analytics, territorio,
                       consultation, audit, ref, avisa
      TO avisa_app;

GRANT SELECT, INSERT, UPDATE, DELETE
      ON ALL TABLES IN SCHEMA core, kag, ind, analisis, territorio, consultation
      TO avisa_app;

GRANT SELECT ON ALL TABLES IN SCHEMA analytics, avisa TO avisa_app;

GRANT USAGE, SELECT
      ON ALL SEQUENCES IN SCHEMA core, kag, ind, analisis, territorio, consultation
      TO avisa_app;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core, kag TO avisa_app;

-- La auditoría se concede después y de forma explícita, para que ningún
-- GRANT general de arriba le haya dado escritura.
REVOKE ALL ON audit.datos_personales_acceso FROM avisa_app;
GRANT SELECT, INSERT ON audit.datos_personales_acceso TO avisa_app;


-- =====================================================================
--  BLOQUE 2 · ESTADO DE LA ALERTA  (RF-D01, RF-D04)
-- =====================================================================
--  Se eligió un solo camino: la alerta usa el MISMO motor de proceso
--  que el caso y el reporte. La alternativa —añadir `estado_id` a
--  `core.alertas_tempranas`— habría creado un segundo lugar donde vive
--  el estado, y dos fuentes de verdad para lo mismo.
--
--  La columna `alerta_id` ya existía en `core.proceso_instancia`, con su
--  clave ajena. Lo único que faltaba era permiso: los CHECK limitaban
--  `tipo_origen` a 'caso' y 'reporte'.
-- =====================================================================

\echo 'PARCHE 14 · bloque 2/6 · flujo de alertas'

-- 2.1 · El motor admite el origen 'alerta'
ALTER TABLE core.proceso_instancia
    DROP CONSTRAINT IF EXISTS proceso_instancia_tipo_origen_check;
ALTER TABLE core.proceso_instancia
    ADD CONSTRAINT proceso_instancia_tipo_origen_check
    CHECK (tipo_origen IN ('caso', 'reporte', 'alerta'));

-- La restricción de coherencia entre origen y claves se retira aquí y se
-- recrea en el bloque 2.6, después de normalizar los datos heredados. Hay que
-- retirarla ANTES del bloque 2.4: esa conversión escribe tipo_origen='alerta'
-- y la definición antigua (sólo 'caso' y 'reporte') la rechaza. Sin este DROP,
-- el parche aborta al reconstruir la base desde cero; en la base original no
-- se notó porque la restricción ya estaba relajada de una aplicación previa.
ALTER TABLE core.proceso_instancia
    DROP CONSTRAINT IF EXISTS proceso_instancia_origen_coherente_check;

-- ---------------------------------------------------------------------
-- 2.2 · El catálogo de pasos admite el flujo de alerta
-- ---------------------------------------------------------------------
ALTER TABLE core.flujo_definicion
    DROP CONSTRAINT IF EXISTS flujo_definicion_tipo_flujo_check;
ALTER TABLE core.flujo_definicion
    ADD CONSTRAINT flujo_definicion_tipo_flujo_check
    CHECK (tipo_flujo IN ('caso', 'reporte', 'alerta'));

-- ---------------------------------------------------------------------
-- 2.3 · Los cuatro pasos del flujo de alerta
--      Reconstruidos del módulo de alertas del sistema anterior:
--      se redacta, se valida, se remite y se archiva.
-- ---------------------------------------------------------------------
INSERT INTO core.flujo_definicion
    (id, tipo_flujo, orden, nombre, estado_resultante, rol_responsable,
     descripcion, codigo_legado)
VALUES
    (gen_random_uuid(), 'alerta', 1, 'Elaboración', 'Registrado', 'Sectorista',
     'El sectorista registra la alerta temprana con su situación, hechos y fuente.',
     'DPPA-1'),
    (gen_random_uuid(), 'alerta', 2, 'Validación', 'Validado', 'Directora',
     'La Dirección revisa la alerta y la valida o la devuelve con observaciones.',
     'DPPA-2'),
    (gen_random_uuid(), 'alerta', 3, 'Remisión', 'Remitido', 'Directora',
     'La alerta validada se remite al destinatario que corresponde a su gravedad.',
     'DPPA-3'),
    (gen_random_uuid(), 'alerta', 4, 'Archivo', 'Archivado', 'Sectorista',
     'La alerta se cierra y se archiva, con el resultado documentado.',
     'DPPA-4')
ON CONFLICT (codigo_legado) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2.4 · Lo que el cargador guardó como 'reporte' y sí era una alerta
-- ---------------------------------------------------------------------
--  Antes de este parche una alerta no podía entrar como 'alerta', porque
--  el CHECK lo prohibía. El cargador la guardó como 'reporte' con el
--  código `PR-AL-xxxx`: son 72 filas que cubren 57 alertas. Se pasan a
--  su origen correcto, sin tocar su número de fila ni su código.
-- ---------------------------------------------------------------------
UPDATE core.proceso_instancia p
   SET tipo_origen = 'alerta',
       flujo_definicion_id = d.id,
       -- `codigo_reporte` guarda aquí el código de la alerta (AT-2026-xx).
       -- No se pierde: se anota y se libera la columna, porque en una fila
       -- de origen 'alerta' ese campo no significa nada.
       nota = concat_ws(' · ', p.nota,
                        CASE WHEN p.codigo_reporte IS NOT NULL
                             THEN 'código de reporte heredado: ' || p.codigo_reporte
                        END),
       codigo_reporte = NULL
  FROM core.flujo_definicion d
 WHERE p.alerta_id IS NOT NULL
   AND p.tipo_origen = 'reporte'
   AND d.tipo_flujo = 'alerta'
   AND d.orden = p.orden;

-- El estado que el propio legado declara. Las 83 alertas dicen
-- 'Archivado', así que su último paso está completado.
UPDATE core.proceso_instancia p
   SET estado_id = e.id
  FROM core.alertas_tempranas a, core.flujo_estado e
 WHERE p.alerta_id = a.id
   AND e.codigo = CASE
                      WHEN lower(coalesce(a.estado_legado, '')) IN
                           ('archivado', 'archivada', 'cerrado', 'cerrada', 'atendido')
                          THEN 'EST-02'
                      ELSE 'EST-01'
                  END;

-- ---------------------------------------------------------------------
-- 2.5 · El paso que cierra cada alerta archivada
-- ---------------------------------------------------------------------
--  Las 57 alertas que ya tenían proceso sólo tenían el paso 1: el
--  cargador nunca avanzó el flujo. Se añade el paso de archivo, que es
--  el que el legado declara, y con él la vista devuelve el estado real.
--  Las 26 alertas sin ninguna fila de proceso reciben sólo este cierre:
--  no se inventa el recorrido intermedio que el origen no registró.
WITH objetivo AS (
    SELECT a.id,
           a.codigo_alerta,
           a.nivel_clasificacion,
           a.created_at,
           a.fecha_reporte,
           a.fecha_remision,
           a.estado_legado,
           a.paso_actual,
           row_number() OVER (ORDER BY a.codigo_alerta, a.id) AS rn,
           EXISTS (SELECT 1 FROM core.proceso_instancia p
                    WHERE p.tipo_origen = 'alerta' AND p.alerta_id = a.id) AS con_proceso
      FROM core.alertas_tempranas a
     WHERE lower(coalesce(a.estado_legado, '')) IN
               ('archivado', 'archivada', 'cerrado', 'cerrada', 'atendido')
       AND NOT EXISTS (SELECT 1 FROM core.proceso_instancia p
                        WHERE p.tipo_origen = 'alerta'
                          AND p.alerta_id = a.id
                          AND p.orden = 4)
)
INSERT INTO core.proceso_instancia
    (tipo_origen, alerta_id, flujo_definicion_id, estado_id, orden,
     codigo_legado, fila_legado, ocurrido_en, nota, nivel_clasificacion)
SELECT 'alerta',
       o.id,
       d.id,
       e.id,
       4,
       'ALERTA-' || o.codigo_alerta || '-CIERRE',
       (1000 + o.rn)::smallint,
       COALESCE(o.fecha_remision::timestamptz,
                o.fecha_reporte::timestamptz,
                o.created_at),
       'Cierre heredado del sistema anterior: la alerta figura como '
           || o.estado_legado
           || CASE WHEN o.con_proceso
                   THEN '; el origen sólo registraba el paso 1'
                   ELSE '; el origen no registra ningún paso de proceso'
              END
           || '; paso_actual declarado en el origen: '
           || COALESCE(o.paso_actual::text, '(nulo)'),
       o.nivel_clasificacion
  FROM objetivo o
  JOIN core.flujo_definicion d
    ON d.tipo_flujo = 'alerta' AND d.orden = 4
  JOIN core.flujo_estado e ON e.codigo = 'EST-02';

-- ---------------------------------------------------------------------
-- 2.6 · Coherencia entre el origen y sus claves
-- ---------------------------------------------------------------------
--  Se añade al final, con los datos ya normalizados: si se añadiera
--  antes, las 72 filas heredadas la incumplirían.
ALTER TABLE core.proceso_instancia
    DROP CONSTRAINT IF EXISTS proceso_instancia_origen_coherente_check;
ALTER TABLE core.proceso_instancia
    ADD CONSTRAINT proceso_instancia_origen_coherente_check CHECK (
        (tipo_origen = 'caso'
            AND codigo_reporte IS NULL
            AND alerta_id IS NULL)
        OR (tipo_origen = 'reporte'
            AND caso_id IS NULL
            AND codigo_caso_legado IS NULL
            AND alerta_id IS NULL)
        OR (tipo_origen = 'alerta'
            AND caso_id IS NULL
            AND codigo_caso_legado IS NULL
            AND codigo_reporte IS NULL
            AND alerta_id IS NOT NULL)
    );

-- 2.7 · Toda alerta nueva nace con su primer paso abierto
CREATE OR REPLACE FUNCTION core.tg_alerta_nace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core
AS $$
DECLARE
    v_fila smallint;
    v_def  uuid;
    v_est  uuid;
BEGIN
    SELECT id INTO v_def
      FROM core.flujo_definicion
     WHERE tipo_flujo = 'alerta' AND orden = 1
     LIMIT 1;
    SELECT id INTO v_est FROM core.flujo_estado WHERE codigo = 'EST-01';

    -- Si falta el catálogo del flujo, no se bloquea el alta de la alerta:
    -- se deja sin fila de proceso y el rellenado del parche la recoge.
    IF v_def IS NULL OR v_est IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(max(fila_legado), 0) + 1
      INTO v_fila
      FROM core.proceso_instancia
     WHERE tipo_origen = 'alerta';

    INSERT INTO core.proceso_instancia
        (tipo_origen, alerta_id, flujo_definicion_id, estado_id, orden,
         codigo_legado, fila_legado, ocurrido_en, nota, nivel_clasificacion)
    VALUES
        ('alerta', NEW.id, v_def, v_est, 1,
         'ALERTA-' || NEW.codigo_alerta, v_fila, now(),
         'Paso inicial creado automáticamente al registrar la alerta',
         NEW.nivel_clasificacion);

    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_alerta_nace ON core.alertas_tempranas;
CREATE TRIGGER trg_alerta_nace
    AFTER INSERT ON core.alertas_tempranas
    FOR EACH ROW EXECUTE FUNCTION core.tg_alerta_nace();

-- 2.8 · Vista con el estado vigente de cada alerta
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
       a.fecha_remision
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
    'casos y reportes. Esta vista lo resuelve en una sola lectura.';

COMMENT ON COLUMN core.alertas_tempranas.estado_legado IS
    'Estado tal como venía del sistema anterior. Se conserva como '
    'evidencia de la migración; el estado vigente se lee en '
    'core.vw_alerta_estado.';


-- =====================================================================
--  BLOQUE 3 · IDENTIFICACIÓN GRADUAL DEL ACTOR  (§12.4, RF-B)
-- =====================================================================
--  El ERS exige cinco niveles de identificación y prohíbe que los
--  niveles 4 y 5 —persona sin documento y colectivo anónimo— se
--  georreferencien o se crucen con datos personales. Ese permiso no
--  existía en la base.
-- =====================================================================

\echo 'PARCHE 14 · bloque 3/6 · niveles de identificación'

-- 3.1 · Catálogo de niveles
CREATE TABLE IF NOT EXISTS core.cat_nivel_identificacion (
    id          smallint     PRIMARY KEY,
    codigo      varchar(30)  NOT NULL UNIQUE,
    descripcion varchar(200) NOT NULL
);

COMMENT ON TABLE core.cat_nivel_identificacion IS
    'Cuánto se sabe de la identidad de un actor. Es la escala que permite '
    'registrar a alguien sin documento sin inventarle uno.';

INSERT INTO core.cat_nivel_identificacion (id, codigo, descripcion) VALUES
    (1, 'IDENTIFICADO_DNI',      'Persona identificada con Documento Nacional de Identidad'),
    (2, 'IDENTIFICADO_OTRO_DOC', 'Persona identificada con otro documento o con RUC'),
    (3, 'IDENTIFICADO_SIN_DOC',  'Nombre confirmado, sin documento que lo respalde'),
    (4, 'SEUDONIMO',             'Alias o cargo conocido; la identidad no está registrada'),
    (5, 'COLECTIVO_ANONIMO',     'Grupo sin individuos registrables')
ON CONFLICT (id) DO NOTHING;

-- El GRANT general del bloque 1 corre antes de que esta tabla exista, así que
-- `GRANT ... ON ALL TABLES` no la alcanza. Sin este permiso explícito, el rol de
-- aplicación no puede leer el catálogo en una base reconstruida desde cero.
GRANT SELECT ON core.cat_nivel_identificacion TO avisa_app;

-- 3.2 · Columnas de identificación en el actor
ALTER TABLE core.actores
    ADD COLUMN IF NOT EXISTS nivel_identificacion_id smallint NOT NULL DEFAULT 3;
ALTER TABLE core.actores
    ADD COLUMN IF NOT EXISTS caso_ancla_id uuid;
ALTER TABLE core.actores
    ADD COLUMN IF NOT EXISTS organizacion_ancla_uid uuid;
ALTER TABLE core.actores
    ADD COLUMN IF NOT EXISTS confianza numeric(3,2);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'actores_nivel_identificacion_id_fkey') THEN
        ALTER TABLE core.actores
            ADD CONSTRAINT actores_nivel_identificacion_id_fkey
            FOREIGN KEY (nivel_identificacion_id)
            REFERENCES core.cat_nivel_identificacion(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'actores_caso_ancla_id_fkey') THEN
        ALTER TABLE core.actores
            ADD CONSTRAINT actores_caso_ancla_id_fkey
            FOREIGN KEY (caso_ancla_id) REFERENCES core.casos(id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'actores_organizacion_ancla_uid_fkey') THEN
        ALTER TABLE core.actores
            ADD CONSTRAINT actores_organizacion_ancla_uid_fkey
            FOREIGN KEY (organizacion_ancla_uid) REFERENCES core.actores(actor_uid)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'actores_confianza_check') THEN
        ALTER TABLE core.actores
            ADD CONSTRAINT actores_confianza_check
            CHECK (confianza IS NULL OR (confianza >= 0 AND confianza <= 1));
    END IF;
END
$$;

-- 3.3 · Un actor sin identidad necesita un ancla
--      Los niveles 4 y 5 no se sostienen solos: hay que saber a qué caso
--      o a qué organización pertenece el alias, o el registro queda
--      huérfano y nadie puede depurarlo después.
ALTER TABLE core.actores DROP CONSTRAINT IF EXISTS ck_actor_anclaje;
ALTER TABLE core.actores
    ADD CONSTRAINT ck_actor_anclaje CHECK (
        nivel_identificacion_id <= 3
        OR caso_ancla_id IS NOT NULL
        OR organizacion_ancla_uid IS NOT NULL);

COMMENT ON COLUMN core.actores.nivel_identificacion_id IS
    'Cuánto se sabe de la identidad: 1 con DNI, 2 con otro documento, '
    '3 nombre sin documento, 4 alias, 5 colectivo sin individuos.';
COMMENT ON COLUMN core.actores.caso_ancla_id IS
    'Caso al que se ata un actor de nivel 4 o 5. Obligatorio si no hay '
    'organización ancla (ver ck_actor_anclaje).';
COMMENT ON COLUMN core.actores.organizacion_ancla_uid IS
    'Organización a la que se ata un actor de nivel 4 o 5.';
COMMENT ON COLUMN core.actores.confianza IS
    'Seguridad de la identificación, de 0 a 1. Por debajo de 0.7 la '
    'aplicación debe exigir revisión humana (HITL).';

-- 3.4 · Alias del actor
CREATE TABLE IF NOT EXISTS core.actor_alias (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_uid         uuid NOT NULL REFERENCES core.actores(actor_uid)
                           ON DELETE CASCADE,
    alias             varchar(200) NOT NULL,
    tipo              varchar(30)  NOT NULL DEFAULT 'ALIAS'
                           CHECK (tipo IN ('ALIAS', 'ABREVIATURA', 'CARGO',
                                           'NOMBRE_HISTORICO', 'SOBRENOMBRE')),
    fuente            varchar(200),
    confianza         numeric(3,2)
                           CHECK (confianza IS NULL OR (confianza >= 0 AND confianza <= 1)),
    es_validado_humano boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT actor_alias_unico UNIQUE (actor_uid, alias)
);

COMMENT ON TABLE core.actor_alias IS
    'Otros nombres con los que se conoce a un actor: alias, abreviatura o '
    'cargo. Permite buscar y cruzar sin duplicar la ficha del actor.';

CREATE INDEX IF NOT EXISTS ix_actor_alias_actor ON core.actor_alias (actor_uid);

-- El GRANT general del bloque 1 corre antes de que esta tabla exista, así que
-- `GRANT ... ON ALL TABLES` no la alcanza. Sin este permiso explícito, el rol de
-- aplicación recibe «permission denied» al leer alias en una base reconstruida
-- desde cero (en la base original no se notó porque el parche se aplicó dos
-- veces). El control fino de filas lo sigue poniendo la política RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON core.actor_alias TO avisa_app;

-- 3.5 · Relleno con la abreviatura que ya traía el legado
INSERT INTO core.actor_alias (actor_uid, alias, tipo, fuente, confianza)
SELECT a.actor_uid, btrim(a.abreviatura), 'ABREVIATURA',
       'LEGADO_AVISA_2026', 0.90
  FROM core.actores a
 WHERE a.abreviatura IS NOT NULL
   AND btrim(a.abreviatura) <> ''
ON CONFLICT (actor_uid, alias) DO NOTHING;

-- 3.6 · Quien tiene documento está identificado
--      El cargador dejó a los 1 160 actores en el nivel por defecto (3).
--      Pero 642 tienen DNI guardado y cifrado: para ésos la identidad sí
--      está establecida, y decir lo contrario rebajaría su protección.
UPDATE core.actores a
   SET nivel_identificacion_id = 1
  FROM core.actor_datos_personales p
 WHERE p.actor_uid = a.actor_uid
   AND p.dni_cifrado IS NOT NULL
   AND a.nivel_identificacion_id = 3;


-- =====================================================================
--  BLOQUE 4 · ENLACE TERRITORIAL  (RF-B, RF-F, §12.4)
-- =====================================================================
--  `core.actores.distrito_id` existe y está en cero de 1 160 filas. La
--  causa no es un descuido de carga: el origen legado sólo registra
--  departamento (`DEP-xx`), nunca distrito. Inventar un distrito a
--  partir de un departamento sería peor que dejarlo vacío.
--
--  Lo que sí se puede hacer, y se hace aquí:
--    · guardar el departamento, que sí existe en el origen;
--    · dejar `distrito_id` nulo y documentado;
--    · habilitar el vínculo fino actor↔lugar para cuando haya dato.
-- =====================================================================

\echo 'PARCHE 14 · bloque 4/6 · enlace territorial'

-- 4.1 · Departamento del actor
--      `core.regiones` ya es la tabla de departamentos del modelo
--      (`ubigeo` 01..25) y `core.provincias.region_id` ya apunta a ella.
--      Faltaba el enlace desde el actor.
ALTER TABLE core.actores
    ADD COLUMN IF NOT EXISTS region_id integer;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'actores_region_id_fkey') THEN
        ALTER TABLE core.actores
            ADD CONSTRAINT actores_region_id_fkey
            FOREIGN KEY (region_id) REFERENCES core.regiones(id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_actores_region ON core.actores (region_id);
CREATE INDEX IF NOT EXISTS ix_actores_distrito ON core.actores (distrito_id);

COMMENT ON COLUMN core.actores.region_id IS
    'Departamento del actor (core.regiones). Es el único nivel geográfico '
    'que trae el sistema anterior.';
COMMENT ON COLUMN core.actores.distrito_id IS
    'Distrito del actor. Nulo en toda la carga heredada: el origen no '
    'registra distrito, sólo departamento. Se llena cuando el dato exista, '
    'desde el alta o desde territorio.lugar_actores.';

-- 4.2 · Relleno del departamento del actor
--
--      Cuidado con una trampa: el código `DEP-xx` del legado NO es el
--      ubigeo. La lista del origen tiene 27 entradas porque incluye
--      «Lima Provincias» y un cajón de sastre llamado «Más de Uno», así
--      que a partir de DEP-16 todos los números van corridos dos
--      posiciones: DEP-16 es Lima Provincias y no Loreto.
--      Emparejar por número habría puesto a 135 actores en el
--      departamento equivocado. Se empareja por nombre.
UPDATE core.actores a
   SET region_id = r.id
  FROM legacy.dim_actores l
  JOIN legacy.dim_departamentos dd ON btrim(dd.c01) = btrim(l.c13)
  JOIN core.regiones r ON lower(btrim(r.nombre)) = lower(btrim(dd.c02))
 WHERE a.codigo_legado = btrim(l.c01);

-- Los códigos que no corresponden a ningún departamento del modelo
-- («Lima Provincias», «Más de Uno») quedan sin región a propósito: son
-- agrupaciones del origen, no departamentos.
UPDATE core.actores a
   SET region_id = NULL
  FROM legacy.dim_actores l
  JOIN legacy.dim_departamentos dd ON btrim(dd.c01) = btrim(l.c13)
 WHERE a.codigo_legado = btrim(l.c01)
   AND lower(btrim(dd.c02)) NOT IN
       (SELECT lower(btrim(nombre)) FROM core.regiones);

-- 4.3 · §12.4 · los niveles 4 y 5 no se georreferencian
ALTER TABLE core.actores
    DROP CONSTRAINT IF EXISTS ck_actor_sin_geo_si_no_identificado;
ALTER TABLE core.actores
    ADD CONSTRAINT ck_actor_sin_geo_si_no_identificado CHECK (
        nivel_identificacion_id < 4
        OR (distrito_id IS NULL AND region_id IS NULL));

COMMENT ON CONSTRAINT ck_actor_sin_geo_si_no_identificado ON core.actores IS
    'ERS §12.4: un alias o un colectivo anónimo nunca se georreferencia.';

-- 4.4 · Los niveles 4 y 5 tampoco tienen datos personales
CREATE OR REPLACE FUNCTION core.tg_pii_solo_identificados()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core
AS $$
DECLARE
    v_nivel smallint;
BEGIN
    SELECT nivel_identificacion_id INTO v_nivel
      FROM core.actores WHERE actor_uid = NEW.actor_uid;

    IF v_nivel IS NOT NULL AND v_nivel >= 4 THEN
        RAISE EXCEPTION
            'ERS §12.4: el actor % es de nivel % (sin identificar); no puede '
            'tener datos personales.', NEW.actor_uid, v_nivel
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_pii_solo_identificados ON core.actor_datos_personales;
CREATE TRIGGER trg_pii_solo_identificados
    BEFORE INSERT OR UPDATE ON core.actor_datos_personales
    FOR EACH ROW EXECUTE FUNCTION core.tg_pii_solo_identificados();

-- 4.5 · Vínculo fino actor ↔ lugar
--      Ya existía con sus claves ajenas. Se completan los índices que
--      faltaban para consultar por lugar y por vigencia.
CREATE INDEX IF NOT EXISTS ix_lugar_actores_lugar
    ON territorio.lugar_actores (lugar_id);
CREATE INDEX IF NOT EXISTS ix_lugar_actores_vigencia
    ON territorio.lugar_actores (valid_from, valid_to);

COMMENT ON TABLE territorio.lugar_actores IS
    'Qué actor está vinculado a qué lugar y desde cuándo. Es el enlace '
    'territorial fino; la carga heredada lo deja vacío porque el origen '
    'sólo llega a departamento.';

-- 4.6 · Vista de territorio del actor
CREATE OR REPLACE VIEW core.vw_actor_territorio AS
SELECT a.actor_uid,
       a.nombre_actual,
       a.nivel_identificacion_id,
       ni.codigo              AS nivel_identificacion,
       a.region_id,
       r.nombre               AS region,
       a.distrito_id,
       d.nombre               AS distrito,
       p.nombre               AS provincia,
       (SELECT count(*)
          FROM territorio.lugar_actores la
         WHERE la.actor_uid = a.actor_uid
           AND (la.valid_to IS NULL OR la.valid_to >= CURRENT_DATE)) AS lugares_vigentes
  FROM core.actores a
  LEFT JOIN core.cat_nivel_identificacion ni ON ni.id = a.nivel_identificacion_id
  LEFT JOIN core.regiones r ON r.id = a.region_id
  LEFT JOIN core.distritos d ON d.id = a.distrito_id
  LEFT JOIN core.provincias p ON p.id = d.provincia_id;

COMMENT ON VIEW core.vw_actor_territorio IS
    'Territorio de cada actor en una sola lectura, con la precisión real '
    'del dato: departamento cuando sólo hay departamento, y distrito sólo '
    'cuando existe.';


-- =====================================================================
--  BLOQUE 5 · BASE LEGAL CON SUSTENTO EN EL KAG  (DC-03, G23, §12.5)
-- =====================================================================
--  `base_legal` era un texto libre con un único valor de migración y
--  sin forma de comprobar qué norma lo sustentaba. Aquí pasa a ser un
--  catálogo, y cada base legal se enlaza con el fragmento exacto del
--  documento que la sostiene dentro del corpus del KAG.
-- =====================================================================

\echo 'PARCHE 14 · bloque 5/6 · base legal y corpus'

-- `ref` ya existe desde el bloque 1; se repite por si este bloque se
-- ejecuta aislado.
CREATE SCHEMA IF NOT EXISTS ref;

COMMENT ON SCHEMA ref IS
    'Catálogos de referencia que no dependen de una operación concreta: '
    'bases legales, niveles de identificación y equivalencias del sistema anterior.';

-- 5.1 · Catálogo de bases legales
CREATE TABLE IF NOT EXISTS ref.base_legal_tratamiento (
    id                       smallint     PRIMARY KEY,
    codigo                   varchar(30)  NOT NULL UNIQUE,
    finalidad                varchar(200) NOT NULL,
    plazo_conservacion_meses smallint     NOT NULL
                                 CHECK (plazo_conservacion_meses > 0),
    flujo_transfronterizo    boolean      NOT NULL DEFAULT false,
    norma                    varchar(200),
    articulo                 varchar(60),
    sustento                 text,
    vigente_desde            date,
    vigente_hasta            date,
    created_at               timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE ref.base_legal_tratamiento IS
    'Las bases legales que autorizan tratar datos personales (Ley 29733, '
    'art. 14). Sustituye al texto libre que antes vivía en '
    'core.actor_datos_personales.base_legal.';
COMMENT ON COLUMN ref.base_legal_tratamiento.flujo_transfronterizo IS
    'Si el tratamiento envía datos fuera del país. Es una de las '
    'declaraciones obligatorias ante la Autoridad Nacional de Protección '
    'de Datos Personales.';
COMMENT ON COLUMN ref.base_legal_tratamiento.sustento IS
    'Texto que explica por qué esta base autoriza el tratamiento. Los '
    'números de inciso se dejan a la revisión de la OGTI y de Asesoría '
    'Jurídica (H-04); no se citan como definitivos.';

INSERT INTO ref.base_legal_tratamiento
    (id, codigo, finalidad, plazo_conservacion_meses,
     flujo_transfronterizo, norma, articulo, sustento)
VALUES
    (1, 'CONSENTIMIENTO',
     'Consentimiento libre, previo, expreso e informado del propio actor',
     60, false, 'Ley N° 29733', '5',
     'El actor autoriza el tratamiento de sus datos para una finalidad concreta. '
     'Es revocable y exige evidencia de la fecha en que se otorgó.'),
    (2, 'LEY',
     'Cumplimiento de una obligación legal del sector',
     120, false, 'Ley N° 29733', '14',
     'El tratamiento es necesario para cumplir una obligación que la ley impone '
     'a PRODUCE y no requiere consentimiento. Inciso exacto por confirmar (H-04).'),
    (3, 'CONTRATO',
     'Ejecución de una relación contractual con el actor',
     60, false, 'Ley N° 29733', '14',
     'El tratamiento es necesario para ejecutar un contrato del que el actor es '
     'parte. Inciso exacto por confirmar (H-04).'),
    (4, 'INTERES_PUBLICO',
     'Ejercicio de la función pública de prevención y gestión de conflictos sociales',
     120, false, 'Ley N° 29733', '14',
     'El tratamiento se apoya en el interés público que sustenta la función de la '
     'OAIPCS. Es la base que corresponde a la operación ordinaria del sistema. '
     'Inciso exacto por confirmar (H-04).'),
    (5, 'LEGADO_AVISA_2026',
     'Regularización de los datos heredados del prototipo, en tanto se define su base definitiva',
     24, false, 'Ley N° 29733', NULL,
     'Base provisional de la migración. No es una base legal del artículo 14: es '
     'una marca de origen que la OAIPCS debe sustituir antes de exponer los datos '
     'fuera del perfil administrador (decisión D49).')
ON CONFLICT (id) DO NOTHING;

-- 5.2 · Vínculo entre la base legal y el corpus del KAG
--      El corpus guarda el texto segmentado y vectorizado. El sustento de
--      una base legal es un fragmento concreto de un documento, no el
--      documento entero: por eso la clave ajena apunta a
--      `kag.documento_fragmento`, y el documento se alcanza por su
--      `documento_id`.
CREATE TABLE IF NOT EXISTS ref.base_legal_evidencia (
    base_legal_id smallint    NOT NULL
                      REFERENCES ref.base_legal_tratamiento(id) ON DELETE CASCADE,
    fragmento_id  uuid        NOT NULL
                      REFERENCES kag.documento_fragmento(id) ON DELETE CASCADE,
    rol           varchar(20) NOT NULL DEFAULT 'SUSTENTO'
                      CHECK (rol IN ('SUSTENTO', 'CONDICION', 'PLAZO', 'EXCEPCION')),
    nota          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (base_legal_id, fragmento_id)
);

COMMENT ON TABLE ref.base_legal_evidencia IS
    'Qué fragmento del corpus sustenta cada base legal. Cierra el círculo: '
    'la norma que autoriza el tratamiento se puede abrir y leer, no sólo citar.';
COMMENT ON COLUMN ref.base_legal_evidencia.rol IS
    'Papel del fragmento: SUSTENTO (autoriza), CONDICION (limita), '
    'PLAZO (fija conservación) o EXCEPCION (excepción al consentimiento).';

CREATE INDEX IF NOT EXISTS ix_base_legal_evidencia_fragmento
    ON ref.base_legal_evidencia (fragmento_id);

-- 5.3 · Vista que une la base legal con su documento
CREATE OR REPLACE VIEW ref.vw_base_legal_fuente AS
SELECT bl.id                AS base_legal_id,
       bl.codigo,
       bl.finalidad,
       be.rol,
       f.id                 AS fragmento_id,
       f.orden              AS fragmento_orden,
       f.pagina_o_minuto,
       left(f.texto, 400)   AS extracto,
       df.id                AS documento_id,
       df.titulo            AS documento_titulo,
       df.tipo              AS documento_tipo,
       df.url               AS documento_url
  FROM ref.base_legal_tratamiento bl
  JOIN ref.base_legal_evidencia be ON be.base_legal_id = bl.id
  JOIN kag.documento_fragmento f ON f.id = be.fragmento_id
  JOIN kag.documento_fuente df ON df.id = f.documento_id;

COMMENT ON VIEW ref.vw_base_legal_fuente IS
    'Cada base legal con el fragmento del corpus que la sustenta y el '
    'documento del que procede.';

-- 5.4 · El actor apunta al catálogo, no a un texto suelto
ALTER TABLE core.actor_datos_personales
    ADD COLUMN IF NOT EXISTS base_legal_id smallint;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'actor_datos_personales_base_legal_id_fkey') THEN
        ALTER TABLE core.actor_datos_personales
            ADD CONSTRAINT actor_datos_personales_base_legal_id_fkey
            FOREIGN KEY (base_legal_id) REFERENCES ref.base_legal_tratamiento(id);
    END IF;
END
$$;

COMMENT ON COLUMN core.actor_datos_personales.base_legal_id IS
    'Base legal que autoriza el tratamiento, tomada de '
    'ref.base_legal_tratamiento. Reemplaza al texto libre de base_legal.';
COMMENT ON COLUMN core.actor_datos_personales.base_legal IS
    'Texto heredado del prototipo. Se conserva como evidencia de la '
    'migración; el valor vigente se lee en base_legal_id.';

UPDATE core.actor_datos_personales
   SET base_legal_id = 5
 WHERE base_legal_id IS NULL
   AND base_legal = 'LEGADO_AVISA_2026';

-- 5.5 · Equivalencia de nombres con el plan de priorización
--      El plan del MVP llama `ref.nivel_identificacion` a lo que el
--      modelo canónico llama `core.cat_nivel_identificacion`. Se expone
--      el alias para que las dos referencias resuelvan sin duplicar filas.
CREATE OR REPLACE VIEW ref.nivel_identificacion AS
SELECT id, codigo, descripcion FROM core.cat_nivel_identificacion;

COMMENT ON VIEW ref.nivel_identificacion IS
    'Alias de core.cat_nivel_identificacion con el nombre que usa el plan '
    'del MVP. Una sola fuente de datos, dos nombres válidos.';

-- 5.6 · Privilegios de los objetos nuevos
GRANT USAGE ON SCHEMA ref TO avisa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ref TO avisa_app;
GRANT SELECT ON core.vw_alerta_estado, core.vw_actor_territorio TO avisa_app;


-- =====================================================================
--  BLOQUE 6 · VERIFICACIÓN
-- =====================================================================
--  Imprime lo que quedó. No corrige nada: si una cifra no cuadra, el
--  parche ya terminó y hay que revisar el origen del dato.
-- =====================================================================

\echo 'PARCHE 14 · bloque 6/6 · verificación'

DO $$
DECLARE
    v_bypass   boolean;
    v_rls      boolean;
    v_force    boolean;
    v_pol      int;
    v_niv      int;
    v_alerta   int;
    v_proc     int;
    v_sin_proc int;
    v_region   int;
    v_distrito int;
    v_alias    int;
    v_legal    int;
    v_pii      int;
    v_niv1     int;
    v_niv3     int;
BEGIN
    SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = 'avisa_app';
    SELECT relrowsecurity, relforcerowsecurity
      INTO v_rls, v_force
      FROM pg_class WHERE oid = 'audit.datos_personales_acceso'::regclass;
    SELECT count(*) INTO v_pol FROM pg_policies
     WHERE schemaname = 'audit' AND tablename = 'datos_personales_acceso';

    SELECT count(*) INTO v_niv FROM core.cat_nivel_identificacion;
    SELECT count(*) INTO v_alerta FROM core.alertas_tempranas;
    SELECT count(*) INTO v_proc FROM core.proceso_instancia WHERE tipo_origen = 'alerta';
    SELECT count(*) INTO v_sin_proc FROM core.alertas_tempranas a
     WHERE NOT EXISTS (SELECT 1 FROM core.proceso_instancia p
                        WHERE p.tipo_origen = 'alerta' AND p.alerta_id = a.id);

    SELECT count(*) INTO v_region FROM core.actores WHERE region_id IS NOT NULL;
    SELECT count(*) INTO v_distrito FROM core.actores WHERE distrito_id IS NOT NULL;
    SELECT count(*) INTO v_alias FROM core.actor_alias;
    SELECT count(*) INTO v_legal FROM core.actor_datos_personales
     WHERE base_legal_id IS NOT NULL;
    SELECT count(*) INTO v_pii FROM core.actor_datos_personales;
    SELECT count(*) INTO v_niv1 FROM core.actores WHERE nivel_identificacion_id = 1;
    SELECT count(*) INTO v_niv3 FROM core.actores WHERE nivel_identificacion_id = 3;

    RAISE NOTICE '--- seguridad ---';
    RAISE NOTICE 'avisa_app sin BYPASSRLS .............. %', NOT v_bypass;
    RAISE NOTICE 'audit con RLS / FORCE RLS ............ % / %', v_rls, v_force;
    RAISE NOTICE 'políticas sobre audit ................ %', v_pol;
    RAISE NOTICE '--- alertas ---';
    RAISE NOTICE 'alertas cargadas ..................... %', v_alerta;
    RAISE NOTICE 'filas de proceso tipo alerta ......... %', v_proc;
    RAISE NOTICE 'alertas sin fila de proceso .......... %', v_sin_proc;
    RAISE NOTICE '--- identificación ---';
    RAISE NOTICE 'niveles de identificación ............ %', v_niv;
    RAISE NOTICE 'alias registrados .................... %', v_alias;
    RAISE NOTICE 'actores con DNI (nivel 1) ............ %', v_niv1;
    RAISE NOTICE 'actores sin documento (nivel 3) ...... %', v_niv3;
    RAISE NOTICE '--- territorio ---';
    RAISE NOTICE 'actores con departamento ............. %', v_region;
    RAISE NOTICE 'actores con distrito ................. %  (esperado 0: el origen no trae distrito)', v_distrito;
    RAISE NOTICE '--- base legal ---';
    RAISE NOTICE 'datos personales con base legal ...... % de %', v_legal, v_pii;

    IF v_niv <> 5 THEN
        RAISE WARNING 'el catálogo de identificación tiene % filas; se esperaban 5', v_niv;
    END IF;
    IF v_sin_proc <> 0 THEN
        RAISE WARNING 'quedan % alertas sin fila de proceso', v_sin_proc;
    END IF;
    IF v_legal <> v_pii THEN
        RAISE WARNING 'quedan % datos personales sin base legal', v_pii - v_legal;
    END IF;
END
$$;

\echo 'PARCHE 14 · terminado'
