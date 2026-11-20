-- =====================================================================
--  AVISA · PARCHE 18 · Tope de gasto con aviso y RLS del catálogo de identidad
-- =====================================================================
--  QUÉ RESUELVE
--
--  1. RNF-13 quedaba a medias. El parche 17 abrió dónde guardar el costo
--     de cada llamada (`agent.llm_call.costo_estimado_usd`) y de cada
--     envío (`core.envios_comunicacion.costo_estimado_usd`), pero no
--     existía ningún objeto que (a) fijara un tope de gasto, (b) sumara
--     el consumo del mes por servicio ni (c) dijera cuándo se cruzó el
--     umbral de aviso. Sin eso, «tope de gasto con aviso» era una frase
--     del ERS sin nada detrás.
--
--  2. El catálogo de identidad era escribible por la aplicación.
--     `core.roles`, `core.usuarios` y `core.usuario_roles` no tenían
--     seguridad por fila y `avisa_app` conservaba INSERT/UPDATE/DELETE.
--     Un `UPDATE core.roles SET max_clasificacion = 3` desde la API
--     elevaba el nivel de cualquier rol: el parche 15 cerró la puerta de
--     `app.clasificacion_max`, y esta quedaba abierta por el otro lado.
--
--  3. Y el esquema `config` era inalcanzable para la aplicación. No
--     estaba en los privilegios por defecto del parche 15, así que
--     `avisa_app` no tenía ni USAGE sobre él. Los objetos de este parche
--     habrían nacido invisibles: `config.puede_gastar()` fallaba con
--     «permission denied for schema config» aunque la función existiera.
--     El bloque 6 concede lo justo y deja el privilegio por defecto puesto
--     para las tablas futuras de `config`.
--
--  QUÉ NO HACE
--
--  · No fija ningún tope. El monto es la decisión H-65 (tope de gasto de
--    OAIPCS), que sigue abierta. El parche deja la tabla vacía y el
--    mecanismo listo: mientras no haya fila, el estado es `sin_tope`.
--  · No envía ningún aviso. Deja la consulta que decide cuándo avisar
--    (`config.v_tope_aviso`); el envío por correo o WhatsApp es del
--    aplicativo, que ya tiene con qué (SVC-06, SVC-07).
--  · No toca `audit`. La bitácora sigue siendo escribible desde
--    cualquier sesión, a propósito.
--  · No cambia el rol `administrador` ni sus capacidades: solo exige que
--    sea ese rol —y no otro— quien escriba el catálogo de identidad.
--
--  POR QUÉ LAS VISTAS DE COSTO NO SON `security_invoker`
--
--  Las tres fuentes del consumo tienen RLS (`agent.llm_call` y
--  `core.envios_comunicacion` por clasificación, `core.consulta_reniec`
--  por privilegio). Si la vista corriera con los permisos de quien la
--  consulta, cada persona vería un total distinto del mismo mes y el
--  tope no significaría nada. Por eso corren con los permisos del dueño
--  y el control de quién ve el panel queda en el aplicativo (6.3).
--
--  EJECUCIÓN
--
--      cat docs/PARCHE_18_COSTOS_Y_RLS_ADMIN.sql \
--        | docker compose exec -T db psql -U avisa -d avisa
--
--      # o con el archivo montado en el contenedor, por su ruta de montaje:
--      docker exec -i avisa-db psql -U avisa -d avisa \
--          -v ON_ERROR_STOP=1 -f <ruta de montaje del parche 18 en el contenedor>
--
--  ORDEN
--  Después del parche 17. Usa `core.rol_actual()`,
--  `core.clasificacion_max()` y las capacidades del parche 15; y las
--  columnas de costo que añadió el 17.
--
--  IDEMPOTENTE
--  Se puede repetir: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
--  `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'PARCHE 18 · bloque 0/7 · comprobaciones previas'

DO $$
BEGIN
    IF to_regclass('agent.llm_call') IS NULL
       OR to_regclass('core.envios_comunicacion') IS NULL
       OR to_regclass('core.consulta_reniec') IS NULL THEN
        RAISE EXCEPTION
            'Falta una de las tres fuentes de consumo. Aplique antes el parche 17.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'agent'
           AND table_name   = 'llm_call'
           AND column_name  = 'costo_estimado_usd'
    ) THEN
        RAISE EXCEPTION
            'agent.llm_call no tiene costo_estimado_usd: aplique el parche 17 primero.';
    END IF;

    IF to_regprocedure('core.rol_actual()') IS NULL
       OR to_regprocedure('core.clasificacion_max()') IS NULL THEN
        RAISE EXCEPTION
            'Faltan las funciones de contexto del parche 15.';
    END IF;

    RAISE NOTICE 'PARCHE 18 · fuentes y funciones presentes';
END
$$;

-- =====================================================================
--  BLOQUE 1 · Catálogo de servicios externos con costo
-- =====================================================================
\echo 'PARCHE 18 · bloque 1/7 · catálogo de servicios externos'

CREATE TABLE IF NOT EXISTS config.servicio_externo (
    codigo             text PRIMARY KEY,
    nombre             text NOT NULL,
    unidad             text NOT NULL,
    costo_unitario_usd numeric(12, 6),
    moneda             text NOT NULL DEFAULT 'USD',
    activo             boolean NOT NULL DEFAULT true,
    observacion        text,
    creado_en          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  config.servicio_externo IS
    'Catálogo de los servicios externos que generan gasto, con la unidad en que '
    'se mide su consumo (token, mensaje, consulta). Da nombre y unidad a los '
    'códigos SVC-xx que usa el ERS.';
COMMENT ON COLUMN config.servicio_externo.codigo IS 'Código del servicio en el ERS (SVC-02, SVC-06, SVC-07, SVC-16).';
COMMENT ON COLUMN config.servicio_externo.unidad IS 'Unidad de medida del consumo: token, mensaje o consulta.';
COMMENT ON COLUMN config.servicio_externo.costo_unitario_usd IS
    'Costo de referencia por unidad. NULL si el proveedor cobra por tramos y el '
    'costo real solo se conoce al cerrar el mes.';
COMMENT ON COLUMN config.servicio_externo.activo IS
    'false cuando el servicio deja de usarse; los históricos de consumo se conservan.';
COMMENT ON COLUMN config.servicio_externo.nombre IS
    'Nombre legible del servicio, el que se muestra en el panel de costos.';
COMMENT ON COLUMN config.servicio_externo.moneda IS
    'Moneda del costo unitario. Hoy siempre USD: si alguien factura en soles, aquí '
    'se ve antes de que el total mezcle monedas.';
COMMENT ON COLUMN config.servicio_externo.observacion IS
    'Qué se cobra y con qué periodicidad; el detalle que explica el costo unitario.';
COMMENT ON COLUMN config.servicio_externo.creado_en IS
    'Cuándo se dio de alta el servicio en el catálogo.';

INSERT INTO config.servicio_externo (codigo, nombre, unidad, observacion) VALUES
    ('SVC-02', 'Gemini (modelo de lenguaje de Google)', 'token',
     'Sincronización 24 h y manual bajo demanda (RF-E12, RF-E13).'),
    ('SVC-06', 'Correo institucional', 'mensaje',
     'Envíos con enlace, sin adjuntos.'),
    ('SVC-07', 'WhatsApp Cloud API', 'mensaje',
     'Mandatos y alertas; cobro por mensaje de utilidad más línea dedicada.'),
    ('SVC-16', 'PIDE-RENIEC', 'consulta',
     'Convenio de Estado: sin costo por consulta, pero se cuenta para el control.')
ON CONFLICT (codigo) DO NOTHING;

-- =====================================================================
--  BLOQUE 2 · Tope de gasto por servicio y periodo
-- =====================================================================
\echo 'PARCHE 18 · bloque 2/7 · topes de gasto'

CREATE TABLE IF NOT EXISTS config.tope_gasto (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    servicio_codigo  text NOT NULL REFERENCES config.servicio_externo(codigo),
    periodo          text NOT NULL DEFAULT 'mensual',
    monto_usd        numeric(12, 2) NOT NULL,
    umbral_aviso_pct smallint NOT NULL DEFAULT 80,
    vigente_desde    date NOT NULL DEFAULT date_trunc('month', now())::date,
    vigente_hasta    date,
    aprobado_por     uuid,
    aprobado_en      timestamptz,
    observacion      text,
    creado_en        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_tope_monto_positivo CHECK (monto_usd > 0),
    CONSTRAINT ck_tope_umbral CHECK (umbral_aviso_pct BETWEEN 1 AND 100),
    CONSTRAINT ck_tope_periodo CHECK (periodo IN ('mensual')),
    CONSTRAINT ck_tope_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tope_gasto_servicio_periodo_desde
    ON config.tope_gasto (servicio_codigo, periodo, vigente_desde);

COMMENT ON TABLE  config.tope_gasto IS
    'Tope de gasto por servicio y periodo (RNF-13). Mientras no exista fila para '
    'un servicio, su estado es `sin_tope`: el mecanismo está listo pero el monto '
    'lo fija la decisión H-65.';
COMMENT ON COLUMN config.tope_gasto.monto_usd IS 'Gasto máximo admitido en el periodo, en dólares.';
COMMENT ON COLUMN config.tope_gasto.aprobado_por IS
    'Usuario que aprobó el tope. Un tope sin aprobación es una estimación, no una decisión.';
COMMENT ON COLUMN config.tope_gasto.umbral_aviso_pct IS
    'Porcentaje del tope a partir del cual se emite el aviso previo (80 % por '
    'defecto). Con 100 el estado pasa de normal a excedido sin aviso intermedio.';
COMMENT ON COLUMN config.tope_gasto.id IS
    'Identificador del tope. Existe para poder versionar el monto de un mismo '
    'servicio y periodo sin sobrescribir el anterior.';
COMMENT ON COLUMN config.tope_gasto.servicio_codigo IS
    'Servicio externo al que se aplica el tope.';
COMMENT ON COLUMN config.tope_gasto.periodo IS
    'Periodo que cubre el tope. Hoy solo admite mensual (restricción ck_tope_periodo).';
COMMENT ON COLUMN config.tope_gasto.vigente_desde IS
    'Primer día del periodo cubierto. Junto con servicio y periodo forma la clave '
    'única del tope vigente.';
COMMENT ON COLUMN config.tope_gasto.vigente_hasta IS
    'Último día cubierto. NULL significa que el tope sigue vigente hasta que otro '
    'lo reemplace.';
COMMENT ON COLUMN config.tope_gasto.aprobado_en IS
    'Cuándo se aprobó. Un tope sin fecha está propuesto, pero **sí limita**: en '
    'gasto es preferible quedarse corto por un tope no aprobado que pasarse por '
    'no tener ninguno. La fecha sirve para saber quién decidió el monto, no para '
    'desactivarlo.';
COMMENT ON COLUMN config.tope_gasto.observacion IS
    'Motivo del monto y de dónde salió la cifra.';
COMMENT ON COLUMN config.tope_gasto.creado_en IS
    'Cuándo se registró la fila.';

-- =====================================================================
--  BLOQUE 3 · Consumo del mes, estado del tope y funciones de control
-- =====================================================================
\echo 'PARCHE 18 · bloque 3/7 · consumo y avisos'

CREATE OR REPLACE VIEW config.v_consumo_servicio_mes AS
WITH medicion AS (
    -- Gemini: una fila por llamada registrada
    SELECT 'SVC-02'::text                        AS servicio_codigo,
           date_trunc('month', l.ts)::date       AS mes,
           count(*)::bigint                      AS unidades,
           sum(COALESCE(l.tokens_in, 0)
             + COALESCE(l.tokens_out, 0)
             + COALESCE(l.tokens_thinking, 0))::bigint AS tokens,
           sum(COALESCE(l.costo_estimado_usd, 0))::numeric(14, 4) AS costo_usd
      FROM agent.llm_call l
     GROUP BY 1, 2

    UNION ALL

    -- Envíos: WhatsApp y correo. `canal` es texto libre, así que el que no
    -- encaja en ninguno de los dos queda como SVC-OTROS y se ve aparte.
    SELECT CASE
               WHEN lower(e.canal) LIKE '%whatsapp%'                        THEN 'SVC-07'
               WHEN lower(e.canal) LIKE '%correo%'
                 OR lower(e.canal) LIKE '%email%'                           THEN 'SVC-06'
               ELSE 'SVC-OTROS'
           END::text                             AS servicio_codigo,
           date_trunc('month', e.fecha_envio)::date AS mes,
           count(*)::bigint                      AS unidades,
           0::bigint                             AS tokens,
           sum(COALESCE(e.costo_estimado_usd, 0))::numeric(14, 4) AS costo_usd
      FROM core.envios_comunicacion e
     WHERE e.fecha_envio IS NOT NULL
     GROUP BY 1, 2

    UNION ALL

    -- RENIEC: sin costo por consulta, pero se cuenta
    SELECT 'SVC-16'::text                        AS servicio_codigo,
           date_trunc('month', r.fecha_consulta)::date AS mes,
           count(*)::bigint                      AS unidades,
           0::bigint                             AS tokens,
           0::numeric(14, 4)                     AS costo_usd
      FROM core.consulta_reniec r
     WHERE r.fecha_consulta IS NOT NULL
     GROUP BY 1, 2
)
SELECT m.servicio_codigo,
       COALESCE(s.nombre, m.servicio_codigo) AS servicio,
       s.unidad,
       m.mes,
       m.unidades,
       m.tokens,
       m.costo_usd,
       t.monto_usd                           AS tope_usd,
       t.umbral_aviso_pct,
       CASE
           WHEN t.monto_usd IS NULL OR t.monto_usd = 0 THEN NULL
           ELSE round(m.costo_usd / t.monto_usd * 100, 1)
       END                                   AS pct_consumido,
       CASE
           WHEN t.id IS NULL                                THEN 'sin_tope'
           WHEN m.costo_usd >= t.monto_usd                  THEN 'excedido'
           WHEN m.costo_usd >= t.monto_usd * t.umbral_aviso_pct / 100.0 THEN 'aviso'
           ELSE 'normal'
       END                                   AS estado
  FROM medicion m
  LEFT JOIN config.servicio_externo s ON s.codigo = m.servicio_codigo
  -- Un solo tope por servicio y mes: el más reciente que cubra ese mes.
  -- Con un LEFT JOIN normal, dos topes vigentes a la vez (dos filas con
  -- `vigente_hasta` NULL) duplicaban la fila de consumo, la vista mostraba
  -- dos veces el mismo mes y `config.gasto_mes()` sumaba el gasto dos veces.
  LEFT JOIN LATERAL (
      SELECT t2.id, t2.monto_usd, t2.umbral_aviso_pct
        FROM config.tope_gasto t2
       WHERE t2.servicio_codigo = m.servicio_codigo
         AND t2.periodo = 'mensual'
         AND m.mes >= t2.vigente_desde
         AND (t2.vigente_hasta IS NULL OR m.mes <= t2.vigente_hasta)
       ORDER BY t2.vigente_desde DESC, t2.creado_en DESC
       LIMIT 1
  ) t ON true;

COMMENT ON VIEW config.v_consumo_servicio_mes IS
    'Consumo y costo de cada servicio externo por mes, con su tope y el estado '
    'del tope (sin_tope, normal, aviso, excedido). Es la cifra que alimenta el '
    'panel de costos de RNF-13. Corre con los permisos del dueño para que el '
    'total de un mes no dependa del nivel de quien consulta.';

CREATE OR REPLACE VIEW config.v_tope_aviso AS
SELECT servicio_codigo,
       servicio,
       unidad,
       mes,
       unidades,
       costo_usd,
       tope_usd,
       pct_consumido,
       estado
  FROM config.v_consumo_servicio_mes
 WHERE estado IN ('aviso', 'excedido');

COMMENT ON VIEW config.v_tope_aviso IS
    'Solo los servicios que cruzaron el umbral de aviso o agotaron su tope. Si '
    'esta vista devuelve filas, el aplicativo tiene que avisar (RNF-13). Vacía '
    'significa que no hay nada que avisar.';

-- 3.1 · Gasto del mes de un servicio
CREATE OR REPLACE FUNCTION config.gasto_mes(
    p_servicio text,
    p_mes      date DEFAULT date_trunc('month', now())::date
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = pg_catalog, config
AS $$
    SELECT COALESCE(
        (SELECT sum(costo_usd)
           FROM config.v_consumo_servicio_mes
          WHERE servicio_codigo = p_servicio
            AND mes = p_mes),
        0);
$$;

COMMENT ON FUNCTION config.gasto_mes(text, date) IS
    'Costo acumulado de un servicio en un mes. Sin argumento de mes, el actual. '
    'Devuelve 0 si no hubo consumo; no devuelve NULL, para no romper sumas.';

-- 3.2 · ¿Se puede gastar más este mes?
CREATE OR REPLACE FUNCTION config.puede_gastar(p_servicio text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, config
AS $$
    SELECT NOT EXISTS (
        SELECT 1
          FROM config.v_consumo_servicio_mes
         WHERE servicio_codigo = p_servicio
           AND mes = date_trunc('month', now())::date
           AND estado = 'excedido');
$$;

COMMENT ON FUNCTION config.puede_gastar(text) IS
    'false si el servicio ya agotó su tope del mes en curso; true en cualquier '
    'otro caso, incluido el de un servicio sin tope definido (H-65). El '
    'aplicativo debe consultarla antes de disparar una sincronización manual '
    '(RF-E13) o un envío con costo.';

-- =====================================================================
--  BLOQUE 4 · Seguridad por fila del catálogo de identidad
-- =====================================================================
\echo 'PARCHE 18 · bloque 4/7 · RLS de roles, usuarios y asignaciones'

-- 4.1 · core.roles
-- La lectura queda abierta a cualquier sesión autenticada: la necesitan
-- core.rol_actual(), core.clasificacion_max() y las tres capacidades del
-- parche 15, que corren con los permisos de quien llama. Cerrarla
-- devolvería nivel 0 a todo el mundo y el sistema se apagaría solo.
ALTER TABLE core.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p18_roles_sel ON core.roles;
CREATE POLICY p18_roles_sel ON core.roles
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS p18_roles_ins ON core.roles;
CREATE POLICY p18_roles_ins ON core.roles
    FOR INSERT
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_roles_upd ON core.roles;
CREATE POLICY p18_roles_upd ON core.roles
    FOR UPDATE
    USING (core.rol_actual() = 'administrador')
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_roles_del ON core.roles;
CREATE POLICY p18_roles_del ON core.roles
    FOR DELETE
    USING (core.rol_actual() = 'administrador');

-- 4.2 · core.usuarios y core.usuario_roles
-- Lectura: el administrador ve a todos; cada persona ve su propia fila,
-- que es lo que necesita el login para resolver el rol de la sesión
-- (6.5, H-52). Escritura: solo el administrador (6.3).
ALTER TABLE core.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.usuarios FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p18_usuarios_sel ON core.usuarios;
CREATE POLICY p18_usuarios_sel ON core.usuarios
    FOR SELECT
    USING (
        core.rol_actual() = 'administrador'
        OR id::text = current_setting('app.usuario_id', true)
    );

DROP POLICY IF EXISTS p18_usuarios_ins ON core.usuarios;
CREATE POLICY p18_usuarios_ins ON core.usuarios
    FOR INSERT
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_usuarios_upd ON core.usuarios;
CREATE POLICY p18_usuarios_upd ON core.usuarios
    FOR UPDATE
    USING (core.rol_actual() = 'administrador')
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_usuarios_del ON core.usuarios;
CREATE POLICY p18_usuarios_del ON core.usuarios
    FOR DELETE
    USING (core.rol_actual() = 'administrador');

ALTER TABLE core.usuario_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.usuario_roles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p18_usuario_roles_sel ON core.usuario_roles;
CREATE POLICY p18_usuario_roles_sel ON core.usuario_roles
    FOR SELECT
    USING (
        core.rol_actual() = 'administrador'
        OR usuario_id::text = current_setting('app.usuario_id', true)
    );

DROP POLICY IF EXISTS p18_usuario_roles_ins ON core.usuario_roles;
CREATE POLICY p18_usuario_roles_ins ON core.usuario_roles
    FOR INSERT
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_usuario_roles_upd ON core.usuario_roles;
CREATE POLICY p18_usuario_roles_upd ON core.usuario_roles
    FOR UPDATE
    USING (core.rol_actual() = 'administrador')
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_usuario_roles_del ON core.usuario_roles;
CREATE POLICY p18_usuario_roles_del ON core.usuario_roles
    FOR DELETE
    USING (core.rol_actual() = 'administrador');

-- =====================================================================
--  BLOQUE 5 · Seguridad por fila de las tablas de costo
-- =====================================================================
\echo 'PARCHE 18 · bloque 5/7 · RLS de las tablas de costo'

ALTER TABLE config.servicio_externo ENABLE ROW LEVEL SECURITY;
ALTER TABLE config.servicio_externo FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p18_servicio_sel ON config.servicio_externo;
CREATE POLICY p18_servicio_sel ON config.servicio_externo
    FOR SELECT
    USING (core.clasificacion_max() >= 3);

DROP POLICY IF EXISTS p18_servicio_ins ON config.servicio_externo;
CREATE POLICY p18_servicio_ins ON config.servicio_externo
    FOR INSERT
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_servicio_upd ON config.servicio_externo;
CREATE POLICY p18_servicio_upd ON config.servicio_externo
    FOR UPDATE
    USING (core.rol_actual() = 'administrador')
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_servicio_del ON config.servicio_externo;
CREATE POLICY p18_servicio_del ON config.servicio_externo
    FOR DELETE
    USING (core.rol_actual() = 'administrador');

ALTER TABLE config.tope_gasto ENABLE ROW LEVEL SECURITY;
ALTER TABLE config.tope_gasto FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p18_tope_sel ON config.tope_gasto;
CREATE POLICY p18_tope_sel ON config.tope_gasto
    FOR SELECT
    USING (core.clasificacion_max() >= 3);

DROP POLICY IF EXISTS p18_tope_ins ON config.tope_gasto;
CREATE POLICY p18_tope_ins ON config.tope_gasto
    FOR INSERT
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_tope_upd ON config.tope_gasto;
CREATE POLICY p18_tope_upd ON config.tope_gasto
    FOR UPDATE
    USING (core.rol_actual() = 'administrador')
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p18_tope_del ON config.tope_gasto;
CREATE POLICY p18_tope_del ON config.tope_gasto
    FOR DELETE
    USING (core.rol_actual() = 'administrador');

-- =====================================================================
--  BLOQUE 6 · Privilegios para el rol de la aplicación
-- =====================================================================
\echo 'PARCHE 18 · bloque 6/7 · permisos del rol de aplicación'

-- Hasta aquí el parche creaba objetos que la aplicación no podía tocar:
-- el esquema `config` nunca entró en los privilegios por defecto del
-- parche 15 (4.3), así que `avisa_app` no tenía ni USAGE sobre él. Sin
-- este bloque RNF-13 no se puede cumplir: `config.puede_gastar()` falla
-- con «permission denied for schema config» aunque la función exista y
-- tenga EXECUTE.

GRANT USAGE ON SCHEMA config TO avisa_app;

-- Lectura de todo `config`: son parámetros y guardrails, no datos
-- personales. La aplicación los necesita para decidir, por ejemplo, qué
-- contrato de guardrail aplica.
GRANT SELECT ON ALL TABLES IN SCHEMA config TO avisa_app;

-- Mantener el catálogo y los topes es trabajo del administrador. Quién
-- escribe lo decide la RLS del bloque 5, no el GRANT; el GRANT solo
-- evita que el administrador se choque con un «permission denied» antes
-- de que la política llegue a evaluarse.
GRANT INSERT, UPDATE, DELETE
   ON config.servicio_externo, config.tope_gasto
   TO avisa_app;

GRANT EXECUTE ON FUNCTION config.gasto_mes(text, date), config.puede_gastar(text)
   TO avisa_app;

-- Y que no vuelva a pasar: toda tabla o función futura de `config` nace
-- visible para la aplicación.
ALTER DEFAULT PRIVILEGES FOR ROLE avisa
    IN SCHEMA config
    GRANT SELECT ON TABLES TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE avisa
    IN SCHEMA config
    GRANT EXECUTE ON FUNCTIONS TO avisa_app;

-- =====================================================================
--  BLOQUE 7 · Verificación
-- =====================================================================
\echo 'PARCHE 18 · bloque 7/7 · verificación'

DO $$
DECLARE
    v_servicios int;
    v_topes     int;
    v_rls       int;
    v_pol       int;
    v_uso       boolean;
    v_lectura   boolean;
    v_ejecuta   boolean;
BEGIN
    SELECT count(*) INTO v_servicios FROM config.servicio_externo;
    SELECT count(*) INTO v_topes     FROM config.tope_gasto;

    SELECT count(*) INTO v_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE (n.nspname, c.relname) IN (
              ('core', 'roles'),
              ('core', 'usuarios'),
              ('core', 'usuario_roles'),
              ('config', 'servicio_externo'),
              ('config', 'tope_gasto'))
       AND c.relrowsecurity
       AND c.relforcerowsecurity;

    SELECT count(*) INTO v_pol
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('core', 'config')
       AND p.polname LIKE 'p18\_%';

    RAISE NOTICE 'servicios externos: % · topes definidos: %', v_servicios, v_topes;
    RAISE NOTICE 'tablas del parche con RLS + FORCE: % de 5', v_rls;
    RAISE NOTICE 'políticas p18_*: %', v_pol;

    -- Permisos: sin USAGE en el esquema la aplicación no llega ni a la
    -- tabla, y RNF-13 se queda en el papel.
    SELECT has_schema_privilege('avisa_app', 'config', 'USAGE')             INTO v_uso;
    SELECT has_table_privilege('avisa_app', 'config.servicio_externo', 'SELECT') INTO v_lectura;
    SELECT has_function_privilege('avisa_app', 'config.puede_gastar(text)', 'EXECUTE') INTO v_ejecuta;

    RAISE NOTICE 'avisa_app · USAGE en config: % · SELECT en el catálogo: % · puede_gastar(): %',
        v_uso, v_lectura, v_ejecuta;

    IF NOT v_uso THEN
        RAISE EXCEPTION 'avisa_app no tiene USAGE sobre el esquema config';
    END IF;
    IF NOT v_lectura THEN
        RAISE EXCEPTION 'avisa_app no puede leer config.servicio_externo';
    END IF;
    IF NOT v_ejecuta THEN
        RAISE EXCEPTION 'avisa_app no puede ejecutar config.puede_gastar()';
    END IF;

    IF v_rls <> 5 THEN
        RAISE EXCEPTION 'RLS incompleto: % de 5 tablas', v_rls;
    END IF;
    IF v_pol <> 20 THEN
        RAISE EXCEPTION 'Se esperaban 20 políticas p18_*, hay %', v_pol;
    END IF;
    IF v_topes = 0 THEN
        RAISE NOTICE 'Aviso: no hay ningún tope cargado. Es lo esperado hasta que se resuelva H-65.';
    END IF;
END
$$;

\echo 'PARCHE 18 · aplicado'
