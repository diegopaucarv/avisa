-- =====================================================================
--  AVISA · PARCHE 17 · Consulta PIDE-RENIEC y control de costos
-- =====================================================================
--  POR QUÉ EXISTE
--
--  La versión 0.5 del ERS movió tres cosas al alcance de diciembre:
--  PIDE-RENIEC (SVC-16, RF-D13, RA-07, RA-08, RN-17), Gemini (SVC-02) y
--  WhatsApp (SVC-07), y con ellos el control de costos (RNF-13, RM-04 y
--  RM-06 a RM-21). El esquema no tenía dónde guardar ninguna de las tres
--  cosas. Este parche abre esos sitios.
--
--  QUÉ HACE
--
--  1. Crea el privilegio nominal. RA-07 no dice "un rol puede consultar
--     RENIEC", dice "el analista nombrado, hoy Edith". Un rol se concede a
--     varias personas; un privilegio nominal se concede a una. Por eso hay
--     catálogo (`core.cat_privilegio`) y concesión (`core.privilegio_usuario`),
--     y no una columna en `core.roles`.
--
--  2. Crea `core.consulta_reniec`: una fila por consulta, con quién la
--     pidió, sobre qué actor, por qué motivo y cuándo. El resultado se
--     guarda cifrado (AES-256 con pgcrypto, igual que el parche 9) y se
--     acompaña de una huella HMAC para poder detectar duplicados sin
--     descifrar. No hay columna que clasifique a la persona: ni "criminal",
--     ni "sospechoso", ni "bajo investigación" como etiqueta consultable.
--     Eso es deliberado (prohibición de etiquetado sin sentencia firme).
--
--  3. La tabla es de solo agregar: ni UPDATE ni DELETE ni TRUNCATE. Los
--     rechaza el mismo `audit.tg_rechazar_mutacion` que protege la
--     bitácora de accesos.
--
--  4. Cada consulta registrada deja rastro en
--     `audit.datos_personales_acceso` mediante un disparador, no por
--     cortesía del aplicativo. Si el aplicativo olvida auditar, la base lo
--     audita igual.
--
--  5. Añade el consumo de los servicios externos que ahora son de
--     diciembre: `agent.llm_call` gana los campos que hacen verificables
--     las reglas RM-11 a RM-15 (thinking tokens, grounding, `store`,
--     anonimización y costo estimado), y `core.envios_comunicacion` gana
--     los de WhatsApp (identificador del mensaje en Meta, plantilla,
--     estado de entrega y costo).
--
--  6. Declara las nuevas categorías de datos en el banco de datos
--     personales (BD-GSCS), que es lo que se inscribe ante la ANPDP.
--
--  QUÉ NO HACE
--
--  · No llama a RENIEC ni a ningún servicio: el convenio (H-68) y el
--    dictamen legal (H-04) son actos externos. El esquema solo registra.
--  · No descifra nada. Para leer el resultado hace falta la clave de
--    sesión (`app.crypto_key`), igual que en el parche 9.
--  · No expone la tabla en ninguna vista de `analytics`: RA-08 prohíbe
--    que el resultado llegue a tableros o exportaciones.
--  · No crea usuarios ni contraseñas. Concede el privilegio a quien ya
--    exista, resolviéndolo por correo; si no existe, avisa y no falla.
--
--  EJECUCIÓN
--
--      cat docs/PARCHE_17_RENIEC_Y_COSTOS.sql \
--        | docker compose exec -T db psql -U avisa -d avisa
--
--  ORDEN
--  Después del parche 16. Usa `core.clasificacion_max()`,
--  `core.puede_crear/editar/eliminar()` (parche 15), `audit.tg_rechazar_mutacion`
--  y `core.banco_datos_tratamiento` (parche 16).
-- =====================================================================

\set ON_ERROR_STOP on
\echo 'PARCHE 17 · bloque 1/7 · privilegio nominal'

-- ---------------------------------------------------------------------
-- 1 · Privilegio nominal (RA-07)
-- ---------------------------------------------------------------------
-- `core.roles` no sirve para esto: conceder "consulta_reniec" al rol
-- sectorista se lo concede a las cinco personas. Ver la nota del parche 16
-- sobre por qué roles y catálogos no llevan RLS: son metadatos de
-- autorización y la evaluación de las políticas necesita leerlos.

CREATE TABLE IF NOT EXISTS core.cat_privilegio (
    id          smallint     PRIMARY KEY,
    codigo      varchar(40)  NOT NULL UNIQUE,
    nombre      varchar(120) NOT NULL,
    descripcion text,
    requiere_motivo boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE core.cat_privilegio IS
    'Catálogo de privilegios nominales: capacidades que se conceden a una '
    'persona concreta y no a un rol. Origen: RA-07 del ERS v0.5.';
COMMENT ON COLUMN core.cat_privilegio.requiere_motivo IS
    'Si es cierto, cada uso del privilegio debe declarar un motivo escrito.';

INSERT INTO core.cat_privilegio (id, codigo, nombre, descripcion, requiere_motivo)
VALUES (
    1,
    'consulta_reniec',
    'Consulta nominal a PIDE-RENIEC',
    'Permite registrar el resultado de una consulta de requisitorias y '
    'antecedentes sobre un actor identificado. Se concede a una sola '
    'persona (RA-07) y cada uso exige motivo (RN-17).',
    true
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS core.privilegio_usuario (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id               uuid     NOT NULL REFERENCES core.usuarios(id),
    privilegio_id            smallint NOT NULL REFERENCES core.cat_privilegio(id),
    motivo                   text     NOT NULL,
    otorgado_por_usuario_id  uuid     REFERENCES core.usuarios(id),
    desde                    date     NOT NULL DEFAULT CURRENT_DATE,
    hasta                    date,
    activo                   boolean  NOT NULL DEFAULT true,
    creado_en                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_privilegio_usuario UNIQUE (usuario_id, privilegio_id, desde),
    CONSTRAINT ck_privilegio_motivo  CHECK (length(btrim(motivo)) >= 10),
    CONSTRAINT ck_privilegio_vigencia CHECK (hasta IS NULL OR hasta >= desde)
);

COMMENT ON TABLE core.privilegio_usuario IS
    'Concesiones nominales y con fecha de caducidad. Una persona puede '
    'tener el privilegio y perderlo sin cambiar de rol. Origen: RA-07.';
COMMENT ON COLUMN core.privilegio_usuario.motivo IS
    'Por qué se concede. Obligatorio: una concesión sin motivo no es '
    'auditable ante la ANPDP.';
COMMENT ON COLUMN core.privilegio_usuario.hasta IS
    'Fin de vigencia. NULL = sin fecha de fin, revisable en cada auditoría.';

CREATE INDEX IF NOT EXISTS ix_privilegio_usuario_usuario
    ON core.privilegio_usuario (usuario_id, privilegio_id)
    WHERE activo;

GRANT SELECT ON core.cat_privilegio   TO avisa_app;
GRANT SELECT ON core.privilegio_usuario TO avisa_app;

-- ---------------------------------------------------------------------
-- 1.2 · Quién es el usuario de la sesión y qué privilegios tiene
-- ---------------------------------------------------------------------
-- Mismo patrón que `core.rol_actual()` (parche 15): la aplicación fija
-- `app.usuario_id` al autenticar. Sin ese parámetro no hay usuario y el
-- privilegio se niega (falla cerrado, no abierto).

CREATE OR REPLACE FUNCTION core.usuario_actual()
RETURNS uuid
LANGUAGE sql
STABLE PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.usuario_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION core.usuario_actual() IS
    'UUID del usuario de la sesión, leído del parámetro app.usuario_id que '
    'fija la aplicación al autenticar. NULL si no se fijó (y entonces todo '
    'privilegio nominal se niega).';

CREATE OR REPLACE FUNCTION core.tiene_privilegio(p_codigo text)
RETURNS boolean
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path = pg_catalog, core
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM core.privilegio_usuario pu
          JOIN core.cat_privilegio cp ON cp.id = pu.privilegio_id
         WHERE cp.codigo   = p_codigo
           AND pu.activo
           AND pu.usuario_id = core.usuario_actual()
           AND pu.desde <= CURRENT_DATE
           AND (pu.hasta IS NULL OR pu.hasta >= CURRENT_DATE)
    );
$$;

COMMENT ON FUNCTION core.tiene_privilegio(text) IS
    'Cierto si el usuario de la sesión tiene el privilegio pedido, vigente y '
    'activo. Falla cerrado: sin app.usuario_id devuelve falso.';

CREATE OR REPLACE FUNCTION core.puede_consultar_reniec()
RETURNS boolean
LANGUAGE sql
STABLE PARALLEL SAFE
SET search_path = pg_catalog, core
AS $$
    SELECT core.tiene_privilegio('consulta_reniec');
$$;

COMMENT ON FUNCTION core.puede_consultar_reniec() IS
    'Atajo de core.tiene_privilegio(''consulta_reniec''). Es la única puerta '
    'a core.consulta_reniec (RA-07).';

-- ---------------------------------------------------------------------
-- 1.3 · Concesión a la persona nombrada (hoy, Edith)
-- ---------------------------------------------------------------------
DO $p17_grants$
DECLARE
    v_usr uuid;
    v_prv smallint;
BEGIN
    SELECT id INTO v_usr
      FROM core.usuarios
     WHERE email = 'ebautista@produce.gob.pe'
     LIMIT 1;

    IF v_usr IS NULL THEN
        RAISE NOTICE 'PIDE-RENIEC: no existe usuario con ese correo; '
                     'el privilegio queda sin conceder (conceder a mano cuando exista)';
        RETURN;
    END IF;

    SELECT id INTO v_prv FROM core.cat_privilegio WHERE codigo = 'consulta_reniec';

    INSERT INTO core.privilegio_usuario (usuario_id, privilegio_id, motivo)
    VALUES (v_usr, v_prv,
            'Única persona autorizada para consultar requisitorias y '
            'antecedentes en PIDE-RENIEC (RA-07, usuario resuelto H-68).')
    ON CONFLICT (usuario_id, privilegio_id, desde) DO NOTHING;

    RAISE NOTICE 'PIDE-RENIEC: privilegio nominal concedido a %', v_usr;
END
$p17_grants$;

-- ---------------------------------------------------------------------
-- 2 · La consulta
-- ---------------------------------------------------------------------
\echo 'PARCHE 17 · bloque 2/7 · tabla core.consulta_reniec'

CREATE TABLE IF NOT EXISTS core.consulta_reniec (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_uid               uuid NOT NULL REFERENCES core.actores(actor_uid),
    caso_id                 uuid REFERENCES core.casos(id),
    consultado_por_usuario_id uuid NOT NULL REFERENCES core.usuarios(id),
    motivo                  text NOT NULL,
    fecha_consulta          timestamptz NOT NULL DEFAULT now(),
    integracion_id          uuid REFERENCES core.integraciones(id),
    -- El resultado nunca se guarda en claro: bytea con pgp_sym_encrypt.
    resultado_cifrado       bytea NOT NULL,
    -- Huella del resultado: permite deduplicar sin descifrar (igual que dni_hmac).
    resultado_hmac          char(64) NOT NULL,
    nivel_clasificacion     smallint NOT NULL DEFAULT 3
                            REFERENCES core.cat_clasificacion(nivel),
    CONSTRAINT ck_consulta_reniec_motivo
        CHECK (length(btrim(motivo)) >= 15),
    -- Ley 29733, nivel alto: esta tabla es Confidencial por definición.
    CONSTRAINT ck_consulta_reniec_confidencial
        CHECK (nivel_clasificacion = 3)
);

COMMENT ON TABLE core.consulta_reniec IS
    'Registro de cada consulta a PIDE-RENIEC (SVC-16): quién la pidió, sobre '
    'qué actor, por qué y cuándo, con el resultado cifrado. Sin columna de '
    'etiqueta: la base no clasifica personas (prohibición de etiquetado sin '
    'sentencia firme). Origen: RF-D13, RA-07, RA-08, RN-17.';
COMMENT ON COLUMN core.consulta_reniec.resultado_cifrado IS
    'Resultado de la consulta cifrado con AES-256 (pgp_sym_encrypt). Se '
    'descifra solo con la clave de sesión app.crypto_key.';
COMMENT ON COLUMN core.consulta_reniec.resultado_hmac IS
    'Huella del resultado en claro (SHA-256 con sal de la aplicación). Sirve '
    'para detectar consultas repetidas sin descifrar el contenido.';
COMMENT ON COLUMN core.consulta_reniec.motivo IS
    'Motivo del pedido, escrito por la persona. Obligatorio y de al menos 15 '
    'caracteres: es la justificación de finalidad que exige la Ley 29733.';
COMMENT ON COLUMN core.consulta_reniec.nivel_clasificacion IS
    'Fijo en 3 (Confidencial). Las reglas de acceso solo distinguen niveles '
    '1 a 3; fijarlo impide degradar la protección por error.';

CREATE INDEX IF NOT EXISTS ix_consulta_reniec_actor
    ON core.consulta_reniec (actor_uid, fecha_consulta DESC);
CREATE INDEX IF NOT EXISTS ix_consulta_reniec_usuario
    ON core.consulta_reniec (consultado_por_usuario_id, fecha_consulta DESC);

-- ---------------------------------------------------------------------
-- 3 · Solo agregar
-- ---------------------------------------------------------------------
\echo 'PARCHE 17 · bloque 3/7 · inmutabilidad y auditoría'

DROP TRIGGER IF EXISTS tg_reniec_append_only_row ON core.consulta_reniec;
CREATE TRIGGER tg_reniec_append_only_row
    BEFORE UPDATE OR DELETE ON core.consulta_reniec
    FOR EACH ROW EXECUTE FUNCTION audit.tg_rechazar_mutacion();

DROP TRIGGER IF EXISTS tg_reniec_append_only_stmt ON core.consulta_reniec;
CREATE TRIGGER tg_reniec_append_only_stmt
    BEFORE UPDATE OR DELETE ON core.consulta_reniec
    FOR EACH STATEMENT EXECUTE FUNCTION audit.tg_rechazar_mutacion();

DROP TRIGGER IF EXISTS tg_reniec_append_only_truncate ON core.consulta_reniec;
CREATE TRIGGER tg_reniec_append_only_truncate
    BEFORE TRUNCATE ON core.consulta_reniec
    FOR EACH STATEMENT EXECUTE FUNCTION audit.tg_rechazar_mutacion();

-- El registro de accesos admite un tipo más: la consulta en sí.
ALTER TABLE audit.datos_personales_acceso
    DROP CONSTRAINT IF EXISTS datos_personales_acceso_operacion_check;
ALTER TABLE audit.datos_personales_acceso
    ADD  CONSTRAINT datos_personales_acceso_operacion_check
    CHECK (operacion = ANY (ARRAY['select_descifrado'::text, 'select_reniec'::text,
                                  'insert'::text, 'update'::text, 'delete'::text,
                                  'export'::text]));

-- La auditoría la escribe la base, no el aplicativo: si el aplicativo
-- olvida auditar, queda auditado igual. SECURITY DEFINER para que funcione
-- con el rol de la API, que no tiene INSERT directo en `audit`.
CREATE OR REPLACE FUNCTION core.tg_consulta_reniec_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, audit
AS $tg$
BEGIN
    INSERT INTO audit.datos_personales_acceso
        (usuario, operacion, actor_uid, motivo, filas_afectadas, contexto)
    VALUES
        (session_user, 'select_reniec', NEW.actor_uid, NEW.motivo, 1,
         jsonb_build_object(
             'funcion',    'core.consulta_reniec',
             'consulta_id', NEW.id,
             'usuario_id', NEW.consultado_por_usuario_id,
             'caso_id',    NEW.caso_id));
    RETURN NEW;
END
$tg$;

COMMENT ON FUNCTION core.tg_consulta_reniec_auditar() IS
    'Deja rastro de cada consulta a RENIEC en audit.datos_personales_acceso. '
    'Corre como definidor para que el rol de la API no necesite escribir en audit.';

DROP TRIGGER IF EXISTS tg_consulta_reniec_auditar ON core.consulta_reniec;
CREATE TRIGGER tg_consulta_reniec_auditar
    AFTER INSERT ON core.consulta_reniec
    FOR EACH ROW EXECUTE FUNCTION core.tg_consulta_reniec_auditar();

-- ---------------------------------------------------------------------
-- 4 · Quién puede leerla (RA-07, RA-08)
-- ---------------------------------------------------------------------
-- Sin política para UPDATE ni DELETE: bajo RLS, la ausencia de política
-- deniega. Y aunque se concediera, los disparadores del bloque 3 abortan.
ALTER TABLE core.consulta_reniec ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.consulta_reniec FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_reniec_select ON core.consulta_reniec;
CREATE POLICY p_reniec_select ON core.consulta_reniec
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (core.puede_consultar_reniec());

DROP POLICY IF EXISTS p_reniec_insert ON core.consulta_reniec;
CREATE POLICY p_reniec_insert ON core.consulta_reniec
    AS PERMISSIVE FOR INSERT TO PUBLIC
    WITH CHECK (core.puede_consultar_reniec()
                -- Se firma con nombre propio: nadie registra consultas ajenas.
                AND consultado_por_usuario_id = core.usuario_actual()
                AND nivel_clasificacion = 3);

GRANT SELECT, INSERT ON core.consulta_reniec TO avisa_app;
REVOKE UPDATE, DELETE, TRUNCATE ON core.consulta_reniec FROM avisa_app;

-- ---------------------------------------------------------------------
-- 5 · Consumo de los servicios externos de diciembre (RNF-13)
-- ---------------------------------------------------------------------
\echo 'PARCHE 17 · bloque 5/7 · telemetría de costos'

-- Gemini · las reglas RM-11 a RM-15 solo se pueden comprobar si quedan
-- registradas. `agent.llm_call` es la tabla de llamadas: se le añaden las
-- columnas que faltaban. Al ser particionada, el ALTER alcanza a las hijas.
ALTER TABLE agent.llm_call ADD COLUMN IF NOT EXISTS tokens_thinking      integer;
ALTER TABLE agent.llm_call ADD COLUMN IF NOT EXISTS thinking_budget      integer;
ALTER TABLE agent.llm_call ADD COLUMN IF NOT EXISTS grounding_habilitado boolean NOT NULL DEFAULT false;
ALTER TABLE agent.llm_call ADD COLUMN IF NOT EXISTS store_habilitado     boolean NOT NULL DEFAULT false;
ALTER TABLE agent.llm_call ADD COLUMN IF NOT EXISTS datos_anonimizados   boolean NOT NULL DEFAULT false;
ALTER TABLE agent.llm_call ADD COLUMN IF NOT EXISTS costo_estimado_usd   numeric(12,6);

COMMENT ON COLUMN agent.llm_call.tokens_thinking IS
    'Tokens de razonamiento interno. Google los cobra a precio de salida: es '
    'el costo oculto nº 1 de la ficha 13.3.1 y RM-11 exige que sea mínimo.';
COMMENT ON COLUMN agent.llm_call.thinking_budget IS
    'Valor de thinking_budget usado en la llamada. RM-11: 0 o el mínimo.';
COMMENT ON COLUMN agent.llm_call.grounding_habilitado IS
    'Si se activó búsqueda web. RM-13 lo prohíbe en ingesta y mandatos: '
    'queda en falso salvo excepción documentada.';
COMMENT ON COLUMN agent.llm_call.store_habilitado IS
    'Si Google conserva el contenido. RM-15 exige falso (Ley 29733).';
COMMENT ON COLUMN agent.llm_call.datos_anonimizados IS
    'Si el texto se anonimizó antes de salir (DNI y teléfonos retirados). RM-15.';
COMMENT ON COLUMN agent.llm_call.costo_estimado_usd IS
    'Costo aproximado de la llamada, calculado por el servicio de aplicación. '
    'RNF-13: permite sumar consumo por servicio y por mes.';

-- WhatsApp · sin el identificador de Meta no se puede saber si el mensaje
-- llegó. RM-16 a RM-19 y RNF-13 piden eso y el costo.
ALTER TABLE core.envios_comunicacion ADD COLUMN IF NOT EXISTS id_externo           varchar(120);
ALTER TABLE core.envios_comunicacion ADD COLUMN IF NOT EXISTS plantilla_codigo     varchar(80);
ALTER TABLE core.envios_comunicacion ADD COLUMN IF NOT EXISTS estado_entrega       varchar(20);
ALTER TABLE core.envios_comunicacion ADD COLUMN IF NOT EXISTS costo_estimado_usd   numeric(12,6);
ALTER TABLE core.envios_comunicacion ADD COLUMN IF NOT EXISTS actualizado_en       timestamptz;

ALTER TABLE core.envios_comunicacion
    DROP CONSTRAINT IF EXISTS ck_envio_estado_entrega;
ALTER TABLE core.envios_comunicacion
    ADD  CONSTRAINT ck_envio_estado_entrega
    CHECK (estado_entrega IS NULL OR estado_entrega = ANY (ARRAY['enviado'::text,
          'entregado'::text, 'leido'::text, 'fallido'::text, 'sin_confirmar'::text]));

-- Un mismo mensaje de Meta no puede registrarse dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS ux_envio_id_externo
    ON core.envios_comunicacion (canal, id_externo)
    WHERE id_externo IS NOT NULL;

COMMENT ON COLUMN core.envios_comunicacion.id_externo IS
    'Identificador del mensaje en el proveedor (wamid de WhatsApp Cloud API). '
    'Su ausencia era la razón por la que no se podía confirmar una entrega.';
COMMENT ON COLUMN core.envios_comunicacion.estado_entrega IS
    'enviado · entregado · leido · fallido · sin_confirmar. Lo actualiza el '
    'webhook de Meta; el envío nace en sin_confirmar.';
COMMENT ON COLUMN core.envios_comunicacion.costo_estimado_usd IS
    'Costo del mensaje de utilidad. RNF-13: consumo por servicio y por mes.';

-- ---------------------------------------------------------------------
-- 6 · El banco de datos personales declara las nuevas categorías
-- ---------------------------------------------------------------------
\echo 'PARCHE 17 · bloque 6/7 · banco de datos personales (BD-GSCS)'

-- Inscribir el banco (art. 34, Ley 29733) exige decir qué se guarda. Ahora
-- se guardan resultados de requisitorias: hay que decirlo.
UPDATE core.banco_datos_tratamiento
   SET categorias_datos =
           categorias_datos
           || ' Resultado de consultas de requisitorias y antecedentes '
           || 'obtenido de PIDE-RENIEC (cifrado).',
       medidas_seguridad =
           medidas_seguridad
           || ' Resultado RENIEC en tabla propia, cifrado con AES-256, de solo '
           || 'agregar, accesible únicamente por privilegio nominal (RA-07) y '
           || 'excluido de tableros y exportaciones (RA-08).',
       updated_at = now()
 WHERE codigo = 'BD-GSCS'
   AND categorias_datos NOT LIKE '%PIDE-RENIEC%';

-- ---------------------------------------------------------------------
-- 7 · Verificación
-- ---------------------------------------------------------------------
\echo 'PARCHE 17 · bloque 7/7 · verificación'

DO $p17_verif$
DECLARE
    v_n   int;
    v_b   boolean;
    v_usr uuid;
BEGIN
    -- Las dos tablas de privilegio existen.
    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relkind = 'r'
       AND c.relname IN ('cat_privilegio', 'privilegio_usuario', 'consulta_reniec');
    RAISE NOTICE 'tablas nuevas del parche 17 ......... % (esperado 3)', v_n;

    -- El privilegio está concedido a alguien, con motivo.
    SELECT count(*) INTO v_n
      FROM core.privilegio_usuario pu
      JOIN core.cat_privilegio cp ON cp.id = pu.privilegio_id
     WHERE cp.codigo = 'consulta_reniec' AND pu.activo
       AND length(btrim(pu.motivo)) >= 10;
    RAISE NOTICE 'privilegio consulta_reniec vigente . % (esperado 1)', v_n;

    -- Falla cerrado sin usuario de sesión.
    PERFORM set_config('app.usuario_id', '', true);
    v_b := core.puede_consultar_reniec();
    RAISE NOTICE 'sin usuario de sesión, ¿puede? ... % (esperado false)', v_b;

    -- Con el usuario nombrado, abre.
    SELECT pu.usuario_id INTO v_usr
      FROM core.privilegio_usuario pu
      JOIN core.cat_privilegio cp ON cp.id = pu.privilegio_id
     WHERE cp.codigo = 'consulta_reniec' AND pu.activo
     LIMIT 1;
    IF v_usr IS NOT NULL THEN
        PERFORM set_config('app.usuario_id', v_usr::text, true);
        v_b := core.puede_consultar_reniec();
        RAISE NOTICE 'con el usuario nombrado, ¿puede? . % (esperado true)', v_b;
    END IF;
    PERFORM set_config('app.usuario_id', '', true);

    -- RLS activo y forzado, con dos políticas y ninguna de mutación.
    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = 'consulta_reniec'
       AND c.relrowsecurity AND c.relforcerowsecurity;
    RAISE NOTICE 'consulta_reniec con RLS forzado .... % (esperado 1)', v_n;

    SELECT count(*) INTO v_n
      FROM pg_policies
     WHERE schemaname = 'core' AND tablename = 'consulta_reniec'
       AND cmd IN ('UPDATE', 'DELETE', 'ALL');
    RAISE NOTICE 'políticas de mutación (deben ser 0) . % (esperado 0)', v_n;

    -- Los tres disparadores de inmutabilidad y el de auditoría.
    SELECT count(*) INTO v_n
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'consulta_reniec' AND NOT t.tgisinternal;
    RAISE NOTICE 'disparadores de consulta_reniec ... % (esperado 4)', v_n;

    -- Columnas de costo: 6 en llm_call y 5 en envios_comunicacion.
    SELECT count(*) INTO v_n
      FROM information_schema.columns
     WHERE table_schema = 'agent' AND table_name = 'llm_call'
       AND column_name IN ('tokens_thinking', 'thinking_budget',
                           'grounding_habilitado', 'store_habilitado',
                           'datos_anonimizados', 'costo_estimado_usd');
    RAISE NOTICE 'columnas de costo en llm_call ...... % (esperado 6)', v_n;

    SELECT count(*) INTO v_n
      FROM information_schema.columns
     WHERE table_schema = 'core' AND table_name = 'envios_comunicacion'
       AND column_name IN ('id_externo', 'plantilla_codigo', 'estado_entrega',
                           'costo_estimado_usd', 'actualizado_en');
    RAISE NOTICE 'columnas de WhatsApp en envíos .... % (esperado 5)', v_n;

    -- El banco de datos declara PIDE-RENIEC una sola vez.
    SELECT count(*) INTO v_n FROM core.banco_datos_tratamiento
     WHERE codigo = 'BD-GSCS' AND categorias_datos LIKE '%PIDE-RENIEC%';
    RAISE NOTICE 'BD-GSCS declara PIDE-RENIEC ....... % (esperado 1)', v_n;
END
$p17_verif$;

\echo ''
\echo 'Privilegios nominales concedidos:'
SELECT u.email, cp.codigo, pu.desde, pu.hasta, pu.activo
  FROM core.privilegio_usuario pu
  JOIN core.cat_privilegio cp ON cp.id = pu.privilegio_id
  JOIN core.usuarios u ON u.id = pu.usuario_id
 ORDER BY u.email, cp.codigo;

\echo 'PARCHE 17 aplicado.'
