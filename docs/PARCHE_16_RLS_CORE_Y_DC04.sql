-- =====================================================================
--  AVISA · PARCHE 16 · RLS completo en `core` y registro del banco de datos
-- =====================================================================
--  QUÉ HACE
--
--  1. Cierra la cobertura de seguridad por fila en el esquema `core`.
--     Antes del parche, 12 de 98 tablas tenían RLS. Las 86 restantes
--     quedaban abiertas a cualquiera con permiso de lectura, incluidas
--     tablas que contienen datos personales de dirigentes.
--
--     El parche protege 32 tablas, en tres grupos:
--
--       · 5 con columna propia `nivel_clasificacion`
--         (capacitaciones, mesas_dialogo, hitos_compromiso,
--          output_contracts, log_accesos).
--       · 26 tablas de detalle o vínculo que no tienen nivel propio:
--         heredan el de su tabla padre mediante EXISTS, de modo que
--         una fila solo es visible si TODOS sus padres lo son.
--         Una lista de asistentes a una reunión confidencial deja de
--         ser legible para quien no puede ver esa reunión.
--       · 2 de las anteriores (hitos_compromiso, output_contracts)
--         tienen nivel propio Y padre protegido: se les exige además
--         la herencia, con una política RESTRICTIVE que suma con AND.
--
--     Las 55 tablas restantes (catálogos `cat_*`, geografía, roles,
--     configuración de servicio) se dejan sin RLS a propósito: no
--     contienen dato personal del actor y ponerles nivel rompería
--     las uniones y el login. El motivo está anotado en el bloque 5.
--
--  2. Registra el banco de datos personales (requisito DC-04) en la
--     tabla nueva `core.banco_datos_tratamiento`, con la finalidad, las
--     categorías de datos, el plazo de conservación, las medidas de
--     nivel alto y la fecha de inscripción ante la ANPDP. La fecha nace
--     en NULL a propósito: NULL significa "inscripción pendiente", que
--     es el estado real del trámite.
--
--  3. Enlaza el catálogo `ref.base_legal_tratamiento` con ese banco:
--     cada base legal pasa a declarar a qué banco pertenece.
--
--  4. Asigna el rol `administrador` a la Oficial de Datos Personales.
--     No retira roles: la persona conserva los que ya tenía. Si el
--     usuario no existe, lo avisa y no hace nada.
--
--  QUÉ NO HACE
--
--  · No cifra columnas: eso lo hizo el parche 9 (TLS, AES-256, HMAC).
--  · No crea el trámite ante la ANPDP ni el correo al CNSD: son actos
--    administrativos externos al sistema. El esquema solo los registra.
--  · No toca `core.usuarios` ni `core.usuario_roles`. El login tiene que
--    poder leer el usuario antes de conocer su rol; aplicarles RLS por
--    rol haría imposible autenticarse. Ver la nota del bloque 5.
--  · No reescribe las políticas de las 12 tablas que ya tenían RLS.
--
--  EJECUCIÓN
--
--      cat docs/PARCHE_16_RLS_CORE_Y_DC04.sql \
--        | docker compose exec -T db psql -U avisa -d avisa
--
--  ORDEN
--  Después del parche 15 (usa core.clasificacion_max(), core.puede_crear(),
--  core.puede_editar() y core.puede_eliminar()).
--
--  IDEMPOTENTE
--  Se puede re-ejecutar: todas las políticas se sueltan antes de crearse y
--  los datos se insertan con ON CONFLICT DO NOTHING.
--
--  CIFRAS DE REFERENCIA (base `avisa` al aplicar el parche)
--  · core: 99 tablas base (98 antes de crear banco_datos_tratamiento),
--    12 con RLS antes, 44 después (12 + 32).
--  · políticas en core: 76 antes, 301 después (225 nuevas).
--  · core.banco_datos_tratamiento: 1 fila.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'PARCHE 16 · bloque 0/5 · guardia de dependencias'

-- Sin las funciones del parche 15 las políticas se crearían igual, pero
-- evaluarían a error en tiempo de consulta. Mejor fallar aquí.
DO $guardia$
DECLARE
    v_faltan text;
BEGIN
    SELECT string_agg(f, ', ')
      INTO v_faltan
      FROM unnest(ARRAY['clasificacion_max', 'puede_crear',
                        'puede_editar', 'puede_eliminar']) AS f
     WHERE NOT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'core' AND p.proname = f
     );

    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION
            'faltan funciones del parche 15 en core: %. Ejecute antes '
            'docs/PARCHE_15_ROLES_Y_BORRADO.sql', v_faltan;
    END IF;

    RAISE NOTICE 'dependencias del parche 15 presentes';
END
$guardia$;

-- ---------------------------------------------------------------------
-- 1 · RLS por nivel propio
-- ---------------------------------------------------------------------
-- Patrón idéntico al que ya usan las 12 tablas protegidas por el parche 13:
--   4 políticas PERMISSIVE por nivel (leer ≥1, escribir ≥2, borrar ≥3)
-- + 3 políticas RESTRICTIVE por capacidad (crear / editar / eliminar).
-- Las PERMISSIVE se suman con OR; las RESTRICTIVE con AND. Juntas dicen:
-- "ves hasta tu nivel, y además solo haces lo que tu rol permite hacer".
\echo 'PARCHE 16 · bloque 1/5 · nivel propio en 5 tablas'

DO $blk1$
DECLARE
    v_tbl  text;
    v_lst  text[] := ARRAY['capacitaciones', 'mesas_dialogo',
                           'hitos_compromiso', 'output_contracts'];
    v_cnt  int := 0;
BEGIN
    FOREACH v_tbl IN ARRAY v_lst
    LOOP
        EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', v_tbl);
        EXECUTE format('ALTER TABLE core.%I FORCE  ROW LEVEL SECURITY', v_tbl);

        EXECUTE format('DROP POLICY IF EXISTS p_clasificacion ON core.%I', v_tbl);
        EXECUTE format(
            'CREATE POLICY p_clasificacion ON core.%I AS PERMISSIVE FOR SELECT '
            'TO PUBLIC USING (nivel_clasificacion <= core.clasificacion_max())',
            v_tbl);

        EXECUTE format('DROP POLICY IF EXISTS p_insert ON core.%I', v_tbl);
        EXECUTE format(
            'CREATE POLICY p_insert ON core.%I AS PERMISSIVE FOR INSERT '
            'TO PUBLIC WITH CHECK (core.clasificacion_max() >= 2 '
            'AND nivel_clasificacion <= core.clasificacion_max())',
            v_tbl);

        EXECUTE format('DROP POLICY IF EXISTS p_update ON core.%I', v_tbl);
        EXECUTE format(
            'CREATE POLICY p_update ON core.%I AS PERMISSIVE FOR UPDATE '
            'TO PUBLIC USING (core.clasificacion_max() >= 2 '
            'AND nivel_clasificacion <= core.clasificacion_max()) '
            'WITH CHECK (nivel_clasificacion <= core.clasificacion_max())',
            v_tbl);

        EXECUTE format('DROP POLICY IF EXISTS p_delete ON core.%I', v_tbl);
        EXECUTE format(
            'CREATE POLICY p_delete ON core.%I AS PERMISSIVE FOR DELETE '
            'TO PUBLIC USING (core.clasificacion_max() >= 3 '
            'AND nivel_clasificacion <= core.clasificacion_max())',
            v_tbl);

        EXECUTE format('DROP POLICY IF EXISTS r_rol_insert ON core.%I', v_tbl);
        EXECUTE format(
            'CREATE POLICY r_rol_insert ON core.%I AS RESTRICTIVE FOR INSERT '
            'TO PUBLIC WITH CHECK (core.puede_crear())', v_tbl);

        EXECUTE format('DROP POLICY IF EXISTS r_rol_update ON core.%I', v_tbl);
        EXECUTE format(
            'CREATE POLICY r_rol_update ON core.%I AS RESTRICTIVE FOR UPDATE '
            'TO PUBLIC USING (core.puede_editar()) '
            'WITH CHECK (core.puede_editar())', v_tbl);

        EXECUTE format('DROP POLICY IF EXISTS r_rol_delete ON core.%I', v_tbl);
        EXECUTE format(
            'CREATE POLICY r_rol_delete ON core.%I AS RESTRICTIVE FOR DELETE '
            'TO PUBLIC USING (core.puede_eliminar())', v_tbl);

        v_cnt := v_cnt + 1;
    END LOOP;

    RAISE NOTICE 'tablas con nivel propio protegidas: %', v_cnt;
END
$blk1$;

-- ---------------------------------------------------------------------
-- 1.1 · Excepción razonada: core.log_accesos
-- ---------------------------------------------------------------------
-- `log_accesos` es la bitácora de actividad de la aplicación y guarda el
-- DNI de quien consultó. Se protege la LECTURA (nivel) y la CORRECCIÓN
-- (puede_editar / puede_eliminar), pero NO la ESCRITURA: si se exigiera
-- puede_crear(), el rol `consulta_lectura` —17 de los 32 usuarios— no
-- podría registrar su propio acceso, y la trazabilidad que exige la Ley
-- N° 29733 se rompería justo para el rol que más consulta.
-- Es la misma razón por la que el parche 15 dejó fuera el esquema `audit`.
DO $blk11$
BEGIN
    EXECUTE 'ALTER TABLE core.log_accesos ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE core.log_accesos FORCE  ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS p_clasificacion ON core.log_accesos';
    EXECUTE 'CREATE POLICY p_clasificacion ON core.log_accesos AS PERMISSIVE '
            'FOR SELECT TO PUBLIC '
            'USING (nivel_clasificacion <= core.clasificacion_max())';

    EXECUTE 'DROP POLICY IF EXISTS p_insert ON core.log_accesos';
    EXECUTE 'CREATE POLICY p_insert ON core.log_accesos AS PERMISSIVE '
            'FOR INSERT TO PUBLIC WITH CHECK (true)';

    EXECUTE 'DROP POLICY IF EXISTS p_update ON core.log_accesos';
    EXECUTE 'CREATE POLICY p_update ON core.log_accesos AS PERMISSIVE '
            'FOR UPDATE TO PUBLIC '
            'USING (nivel_clasificacion <= core.clasificacion_max()) '
            'WITH CHECK (nivel_clasificacion <= core.clasificacion_max())';

    EXECUTE 'DROP POLICY IF EXISTS p_delete ON core.log_accesos';
    EXECUTE 'CREATE POLICY p_delete ON core.log_accesos AS PERMISSIVE '
            'FOR DELETE TO PUBLIC '
            'USING (core.clasificacion_max() >= 3 '
            'AND nivel_clasificacion <= core.clasificacion_max())';

    EXECUTE 'DROP POLICY IF EXISTS r_rol_insert ON core.log_accesos';
    -- No se crea a propósito: ver la nota de arriba.

    EXECUTE 'DROP POLICY IF EXISTS r_rol_update ON core.log_accesos';
    EXECUTE 'CREATE POLICY r_rol_update ON core.log_accesos AS RESTRICTIVE '
            'FOR UPDATE TO PUBLIC USING (core.puede_editar()) '
            'WITH CHECK (core.puede_editar())';

    EXECUTE 'DROP POLICY IF EXISTS r_rol_delete ON core.log_accesos';
    EXECUTE 'CREATE POLICY r_rol_delete ON core.log_accesos AS RESTRICTIVE '
            'FOR DELETE TO PUBLIC USING (core.puede_eliminar())';

    RAISE NOTICE 'log_accesos: lectura y corrección protegidas, escritura abierta';
END
$blk11$;

-- ---------------------------------------------------------------------
-- 2 · Herencia: 26 tablas de detalle toman el nivel de su padre
-- ---------------------------------------------------------------------
-- Regla: el nivel de una fila de vínculo es el MÁXIMO de sus padres. Por
-- eso la condición es un AND de EXISTS: para ver el vínculo hay que poder
-- ver a todos los implicados. Con OR bastaría ver a uno y se revelaría la
-- existencia del otro.
--
-- Las columnas que admiten NULL se tratan con `IS NULL OR EXISTS(...)`.
-- Sin ese trato, una fila sin padre se volvería invisible para todo el
-- mundo y el sistema parecería haber perdido registros.
--
-- Se excluyen a propósito:
--   organizaciones.representante_uid  — el representante es un atributo
--     de la organización, no su identidad. Si el representante fuera
--     confidencial, la organización entera desaparecería.
--   reunion_participantes.institucion_uid — las entidades públicas son
--     dato público (nivel 1-2); no condicionan la visibilidad del
--     participante.
\echo 'PARCHE 16 · bloque 2/5 · herencia en 26 tablas de detalle'

DO $blk2$
DECLARE
    r        record;
    v_cond   text;
    v_cnt    int := 0;
    v_pol    int := 0;
BEGIN
    FOR r IN
        WITH vinculo(hija, col_hija, padre, col_padre, admite_nulo) AS (
            VALUES
            -- nombre de la hija        columna hija         padre                     columna padre   nulo
            ('actor_alias',                       'actor_uid',      'actores',                'actor_uid', false),
            ('actor_membresia',                   'persona_uid',    'actores',                'actor_uid', false),
            ('actor_membresia',                   'organizacion_uid','actores',               'actor_uid', false),
            ('alertas_actores',                   'actor_id',       'actores',                'actor_uid', false),
            ('alertas_actores',                   'alerta_id',      'alertas_tempranas',      'id',        false),
            ('capacitacion_participantes',        'capacitacion_id','capacitaciones',         'id',        false),
            ('capacitacion_participantes',        'actor_uid',      'actores',                'actor_uid', false),
            ('casos_actores',                     'caso_id',        'casos',                  'id',        false),
            ('casos_actores',                     'actor_id',       'actores',                'actor_uid', false),
            ('compromiso_colaboradores',          'compromiso_id',  'compromisos',            'id',        false),
            ('compromiso_colaboradores',          'actor_uid',      'actores',                'actor_uid', false),
            ('demandas_actores',                  'demanda_id',     'demandas',               'id',        false),
            ('demandas_actores',                  'actor_id',       'actores',                'actor_uid', false),
            ('documento_actores',                 'documento_id',   'documentos',             'id',        false),
            ('documento_actores',                 'actor_uid',      'actores',                'actor_uid', false),
            ('mesa_miembros',                     'mesa_id',        'mesas_dialogo',          'id',        false),
            ('mesa_miembros',                     'actor_uid',      'actores',                'actor_uid', true),
            ('organizaciones',                    'actor_uid',      'actores',                'actor_uid', false),
            ('plan_acciones',                     'responsable_uid','actores',                'actor_uid', true),
            ('planes_accion',                     'documento_id',   'documentos',             'id',        false),
            ('reunion_participantes',             'reunion_id',     'reuniones_dialogo',      'id',        false),
            ('reunion_participantes',             'actor_uid',      'actores',                'actor_uid', false),
            ('alerta_especies',                   'alerta_id',      'alertas_tempranas',      'id',        false),
            ('cronologia_vinculos',               'cronologia_id',  'caso_cronologia',        'id',        false),
            ('cronologia_vinculos',               'alerta_id',      'alertas_tempranas',      'id',        true),
            ('cronologia_vinculos',               'documento_id',   'documentos',             'id',        true),
            ('derivaciones_alerta',               'alerta_id',      'alertas_tempranas',      'id',        false),
            ('fuentes_evidencia',                 'cronologia_id',  'caso_cronologia',        'id',        false),
            ('caso_distritos',                    'caso_id',        'casos',                  'id',        false),
            ('caso_estado_historial',             'caso_id',        'casos',                  'id',        false),
            ('caso_factores',                     'caso_id',        'casos',                  'id',        false),
            ('caso_lugares',                      'caso_id',        'casos',                  'id',        false),
            ('caso_regiones',                     'caso_id',        'casos',                  'id',        false),
            ('compromiso_distritos',              'compromiso_id',  'compromisos',            'id',        false),
            ('compromiso_pip',                    'compromiso_id',  'compromisos',            'id',        false),
            ('demandas_evidencias',               'demanda_id',     'demandas',               'id',        false),
            ('hitos_compromiso_estado_historico', 'hito_id',        'hitos_compromiso',       'id',        false)
        ),
        cond AS (
            SELECT hija,
                   string_agg(
                       format(
                           '(%sEXISTS (SELECT 1 FROM core.%I hp WHERE hp.%I = %I.%I '
                           'AND hp.nivel_clasificacion <= core.clasificacion_max()))',
                           CASE WHEN admite_nulo
                                THEN format('%I.%I IS NULL OR ',
                                            hija, col_hija)
                                ELSE '' END,
                           padre, col_padre, hija, col_hija
                       ),
                       ' AND ' ORDER BY padre, col_hija
                   ) AS expr
              FROM vinculo
             GROUP BY hija
        )
        SELECT hija, expr FROM cond ORDER BY hija
    LOOP
        EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', r.hija);
        EXECUTE format('ALTER TABLE core.%I FORCE  ROW LEVEL SECURITY', r.hija);

        v_cond := r.expr;

        EXECUTE format('DROP POLICY IF EXISTS p_clasificacion ON core.%I', r.hija);
        EXECUTE format(
            'CREATE POLICY p_clasificacion ON core.%I AS PERMISSIVE FOR SELECT '
            'TO PUBLIC USING (%s)', r.hija, v_cond);
        v_pol := v_pol + 1;

        EXECUTE format('DROP POLICY IF EXISTS p_insert ON core.%I', r.hija);
        EXECUTE format(
            'CREATE POLICY p_insert ON core.%I AS PERMISSIVE FOR INSERT '
            'TO PUBLIC WITH CHECK (core.clasificacion_max() >= 2 AND %s)',
            r.hija, v_cond);
        v_pol := v_pol + 1;

        EXECUTE format('DROP POLICY IF EXISTS p_update ON core.%I', r.hija);
        EXECUTE format(
            'CREATE POLICY p_update ON core.%I AS PERMISSIVE FOR UPDATE '
            'TO PUBLIC USING (core.clasificacion_max() >= 2 AND %s) '
            'WITH CHECK (%s)', r.hija, v_cond, v_cond);
        v_pol := v_pol + 1;

        EXECUTE format('DROP POLICY IF EXISTS p_delete ON core.%I', r.hija);
        EXECUTE format(
            'CREATE POLICY p_delete ON core.%I AS PERMISSIVE FOR DELETE '
            'TO PUBLIC USING (core.clasificacion_max() >= 3 AND %s)',
            r.hija, v_cond);
        v_pol := v_pol + 1;

        EXECUTE format('DROP POLICY IF EXISTS r_rol_insert ON core.%I', r.hija);
        EXECUTE format(
            'CREATE POLICY r_rol_insert ON core.%I AS RESTRICTIVE FOR INSERT '
            'TO PUBLIC WITH CHECK (core.puede_crear())', r.hija);
        v_pol := v_pol + 1;

        EXECUTE format('DROP POLICY IF EXISTS r_rol_update ON core.%I', r.hija);
        EXECUTE format(
            'CREATE POLICY r_rol_update ON core.%I AS RESTRICTIVE FOR UPDATE '
            'TO PUBLIC USING (core.puede_editar()) '
            'WITH CHECK (core.puede_editar())', r.hija);
        v_pol := v_pol + 1;

        EXECUTE format('DROP POLICY IF EXISTS r_rol_delete ON core.%I', r.hija);
        EXECUTE format(
            'CREATE POLICY r_rol_delete ON core.%I AS RESTRICTIVE FOR DELETE '
            'TO PUBLIC USING (core.puede_eliminar())', r.hija);
        v_pol := v_pol + 1;

        v_cnt := v_cnt + 1;
    END LOOP;

    RAISE NOTICE 'tablas de detalle con herencia: % · políticas: %',
                 v_cnt, v_pol;
END
$blk2$;

-- ---------------------------------------------------------------------
-- 2.1 · Las dos tablas que tienen nivel propio Y padre protegido
-- ---------------------------------------------------------------------
-- `hitos_compromiso` y `output_contracts` ya reciben las 7 políticas por
-- su propio `nivel_clasificacion`. Les falta impedir que un hito de nivel
-- 2 cuelgue de un compromiso de nivel 3 y quede visible. Se añade UNA
-- política RESTRICTIVE más: suma con AND, así que el resultado efectivo es
-- "mi nivel propio Y el de mi padre".
DO $blk21$
BEGIN
    EXECUTE 'DROP POLICY IF EXISTS r_herencia ON core.hitos_compromiso';
    EXECUTE 'CREATE POLICY r_herencia ON core.hitos_compromiso AS RESTRICTIVE '
            'FOR ALL TO PUBLIC USING (
                EXISTS (SELECT 1 FROM core.compromisos hp
                         WHERE hp.id = hitos_compromiso.compromiso_id
                           AND hp.nivel_clasificacion <= core.clasificacion_max()))';

    EXECUTE 'DROP POLICY IF EXISTS r_herencia ON core.output_contracts';
    EXECUTE 'CREATE POLICY r_herencia ON core.output_contracts AS RESTRICTIVE '
            'FOR ALL TO PUBLIC USING (
                output_contracts.caso_id IS NULL
                OR EXISTS (SELECT 1 FROM core.casos hp
                            WHERE hp.id = output_contracts.caso_id
                              AND hp.nivel_clasificacion <= core.clasificacion_max()))';

    RAISE NOTICE 'herencia añadida a hitos_compromiso y output_contracts';
END
$blk21$;

-- ---------------------------------------------------------------------
-- 3 · DC-04 · Banco de datos personales (inscripción ANPDP)
-- ---------------------------------------------------------------------
-- Ley N° 29733, art. 34: quien trata datos personales en la administración
-- pública debe inscribir el banco en el Registro Nacional. El expediente
-- declara finalidad, categorías, plazo, medidas de seguridad y flujo
-- transfronterizo. Esta tabla guarda esa declaración y su estado.
--
-- `fecha_inscripcion_anpdp` nace NULL. NULL no es un hueco: es la verdad
-- hoy. El CHECK impide marcar estado 'inscrito' sin fecha, para que nadie
-- declare por error un trámite que no ocurrió.
\echo 'PARCHE 16 · bloque 3/5 · DC-04 banco de datos personales'

CREATE TABLE IF NOT EXISTS core.banco_datos_tratamiento (
    id                        smallint     PRIMARY KEY,
    codigo                    varchar(40)  NOT NULL,
    nombre                    varchar(200) NOT NULL,
    finalidad                 text         NOT NULL,
    categorias_datos          text         NOT NULL,
    colectivos_afectados      text,
    tiempo_conservacion_meses smallint     NOT NULL,
    nivel_seguridad           smallint     NOT NULL DEFAULT 3,
    medidas_seguridad         text,
    flujo_transfronterizo     boolean      NOT NULL DEFAULT false,
    oficial_datos_usuario_id  uuid         REFERENCES core.usuarios(id),
    fecha_inscripcion_anpdp   date,
    codigo_registro_anpdp     varchar(40),
    estado                    varchar(25)  NOT NULL DEFAULT 'pendiente',
    nivel_clasificacion       smallint     NOT NULL DEFAULT 2
                                           REFERENCES core.cat_clasificacion(nivel),
    activo                    boolean      NOT NULL DEFAULT true,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT banco_datos_tratamiento_codigo_key UNIQUE (codigo),
    CONSTRAINT ck_banco_estado CHECK (
        estado IN ('pendiente', 'inscrito', 'actualizacion_pendiente', 'baja')),
    CONSTRAINT ck_banco_nivel_seguridad CHECK (nivel_seguridad BETWEEN 1 AND 3),
    CONSTRAINT ck_banco_conservacion CHECK (tiempo_conservacion_meses > 0),
    -- 'inscrito' exige fecha y código: la declaración debe ser verificable.
    CONSTRAINT ck_banco_inscripcion CHECK (
        estado <> 'inscrito'
        OR (fecha_inscripcion_anpdp IS NOT NULL AND codigo_registro_anpdp IS NOT NULL))
);

COMMENT ON TABLE core.banco_datos_tratamiento IS
    'Registro de los bancos de datos personales de la entidad y del estado '
    'de su inscripción ante la Autoridad Nacional de Protección de Datos '
    'Personales (ANPDP, MINJUSDH), exigida por el art. 34 de la Ley N° 29733. '
    'Una fila por banco. La fecha nula significa inscripción pendiente.';

COMMENT ON COLUMN core.banco_datos_tratamiento.codigo IS
    'Identificador corto del banco, usado en la documentación y en el expediente.';
COMMENT ON COLUMN core.banco_datos_tratamiento.finalidad IS
    'Para qué se tratan los datos. Debe coincidir con la declaración inscrita: '
    'tratar para un fin no declarado es infracción.';
COMMENT ON COLUMN core.banco_datos_tratamiento.categorias_datos IS
    'Qué categorías se recogen (DNI, nombres, gremio de pertenencia, etc.).';
COMMENT ON COLUMN core.banco_datos_tratamiento.colectivos_afectados IS
    'A quiénes se refieren los datos: dirigentes, socios, participantes de mesas.';
COMMENT ON COLUMN core.banco_datos_tratamiento.tiempo_conservacion_meses IS
    'Plazo declarado de conservación, en meses. Pasado el plazo, el dato se '
    'elimina o se anonimiza.';
COMMENT ON COLUMN core.banco_datos_tratamiento.nivel_seguridad IS
    'Nivel de seguridad exigido (1 básico, 2 medio, 3 alto). Los datos de '
    'afiliación sindical o gremial son sensibles: nivel alto.';
COMMENT ON COLUMN core.banco_datos_tratamiento.medidas_seguridad IS
    'Resumen de las medidas técnicas y organizativas aplicadas: TLS en '
    'tránsito, AES-256 en reposo, RLS por rol, bitácora inmutable.';
COMMENT ON COLUMN core.banco_datos_tratamiento.flujo_transfronterizo IS
    'Si los datos salen del país. Debe declararse aunque sea negativo.';
COMMENT ON COLUMN core.banco_datos_tratamiento.oficial_datos_usuario_id IS
    'Oficial de Datos Personales (ODP) designado ante la ANPDP.';
COMMENT ON COLUMN core.banco_datos_tratamiento.fecha_inscripcion_anpdp IS
    'Fecha de inscripción en el Registro Nacional. NULL = trámite pendiente.';
COMMENT ON COLUMN core.banco_datos_tratamiento.estado IS
    'pendiente | inscrito | actualizacion_pendiente | baja.';

-- ---------------------------------------------------------------------
-- 3.1 · Vínculo con el catálogo de bases legales
-- ---------------------------------------------------------------------
-- El parche 14 creó `ref.base_legal_tratamiento` con la finalidad y el
-- plazo de cada base legal. Esas filas pertenecen a un banco concreto:
-- sin este vínculo, la declaración y las bases legales que la sostienen
-- viven en dos mundos y no se pueden auditar juntas.
ALTER TABLE ref.base_legal_tratamiento
    ADD COLUMN IF NOT EXISTS banco_datos_id smallint
        REFERENCES core.banco_datos_tratamiento(id);

COMMENT ON COLUMN ref.base_legal_tratamiento.banco_datos_id IS
    'Banco de datos personales al que pertenece esta base legal.';

-- ---------------------------------------------------------------------
-- 3.2 · Semilla: el banco de gestión social y conflictividad
-- ---------------------------------------------------------------------
-- El ODP se resuelve por correo, no por UUID escrito a mano: el UUID es
-- distinto en cada instalación. Si la persona no existe, queda NULL y el
-- bloque 5 lo reporta.
INSERT INTO core.banco_datos_tratamiento (
    id, codigo, nombre, finalidad, categorias_datos, colectivos_afectados,
    tiempo_conservacion_meses, nivel_seguridad, medidas_seguridad,
    flujo_transfronterizo, oficial_datos_usuario_id, estado
)
VALUES (
    1,
    'BD-GSCS',
    'Banco de Datos de Gestión Social y Conflictividad Sectorial',
    'Prevención, monitoreo y seguimiento de controversias sociales del sector '
    'Producción; seguimiento de compromisos y acuerdos de mesas de diálogo; '
    'emisión de alertas tempranas a la Alta Dirección.',
    'DNI, nombres y apellidos, teléfono, correo electrónico, cargo, '
    'organización o gremio de pertenencia, condición de dirigente, '
    'participación en reuniones y asambleas, firmas de asistencia.',
    'Dirigentes de organizaciones sociales, gremios MYPE, OSPAs, '
    'representantes de comunidades y autoridades locales.',
    120,
    3,
    'TLS 1.2+ en tránsito; AES-256 (pgcrypto) en los campos identificables; '
    'HMAC para búsqueda sobre dato cifrado; seguridad a nivel de fila por rol '
    'y nivel de clasificación; bitácora de accesos inmutable; exportaciones '
    'restringidas a roles habilitados.',
    false,
    (SELECT id FROM core.usuarios WHERE email = 'ebautista@produce.gob.pe' LIMIT 1),
    'pendiente'
)
ON CONFLICT (id) DO NOTHING;

-- Las cinco bases legales del parche 14 pertenecen a este banco.
UPDATE ref.base_legal_tratamiento
   SET banco_datos_id = 1
 WHERE banco_datos_id IS NULL;

-- RLS del banco: mismo patrón que el resto, nivel 2 (dato institucional).
ALTER TABLE core.banco_datos_tratamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.banco_datos_tratamiento FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_clasificacion ON core.banco_datos_tratamiento;
CREATE POLICY p_clasificacion ON core.banco_datos_tratamiento
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (nivel_clasificacion <= core.clasificacion_max());

DROP POLICY IF EXISTS p_insert ON core.banco_datos_tratamiento;
CREATE POLICY p_insert ON core.banco_datos_tratamiento
    AS PERMISSIVE FOR INSERT TO PUBLIC
    WITH CHECK (core.clasificacion_max() >= 2
                AND nivel_clasificacion <= core.clasificacion_max());

DROP POLICY IF EXISTS p_update ON core.banco_datos_tratamiento;
CREATE POLICY p_update ON core.banco_datos_tratamiento
    AS PERMISSIVE FOR UPDATE TO PUBLIC
    USING (core.clasificacion_max() >= 2
           AND nivel_clasificacion <= core.clasificacion_max())
    WITH CHECK (nivel_clasificacion <= core.clasificacion_max());

DROP POLICY IF EXISTS p_delete ON core.banco_datos_tratamiento;
CREATE POLICY p_delete ON core.banco_datos_tratamiento
    AS PERMISSIVE FOR DELETE TO PUBLIC
    USING (core.clasificacion_max() >= 3
           AND nivel_clasificacion <= core.clasificacion_max());

DROP POLICY IF EXISTS r_rol_insert ON core.banco_datos_tratamiento;
CREATE POLICY r_rol_insert ON core.banco_datos_tratamiento
    AS RESTRICTIVE FOR INSERT TO PUBLIC WITH CHECK (core.puede_crear());

DROP POLICY IF EXISTS r_rol_update ON core.banco_datos_tratamiento;
CREATE POLICY r_rol_update ON core.banco_datos_tratamiento
    AS RESTRICTIVE FOR UPDATE TO PUBLIC USING (core.puede_editar())
    WITH CHECK (core.puede_editar());

DROP POLICY IF EXISTS r_rol_delete ON core.banco_datos_tratamiento;
CREATE POLICY r_rol_delete ON core.banco_datos_tratamiento
    AS RESTRICTIVE FOR DELETE TO PUBLIC USING (core.puede_eliminar());

GRANT SELECT, INSERT, UPDATE, DELETE ON core.banco_datos_tratamiento TO avisa_app;

-- ---------------------------------------------------------------------
-- 4 · El ODP también es administrador del sistema
-- ---------------------------------------------------------------------
-- Quien responde por el banco de datos ante la ANPDP necesita poder ver y
-- corregir todo lo que el banco contiene: capacidad de administrador.
-- No se retira ningún rol previo: la persona sigue siendo sectorista y
-- alta_direccion si lo era.
\echo 'PARCHE 16 · bloque 4/5 · rol administrador para la ODP'

DO $blk4$
DECLARE
    v_usr uuid;
    v_rol int;
BEGIN
    SELECT id INTO v_usr
      FROM core.usuarios
     WHERE email = 'ebautista@produce.gob.pe'
     LIMIT 1;

    IF v_usr IS NULL THEN
        RAISE NOTICE 'ODP: no existe un usuario con ese correo; no se asigna rol';
        RETURN;
    END IF;

    SELECT id INTO v_rol FROM core.roles WHERE codigo = 'administrador';
    IF v_rol IS NULL THEN
        RAISE WARNING 'no existe el rol administrador en core.roles';
        RETURN;
    END IF;

    INSERT INTO core.usuario_roles (usuario_id, rol_id)
    VALUES (v_usr, v_rol)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'ODP %: rol administrador asegurado (roles previos intactos)', v_usr;
END
$blk4$;

-- ---------------------------------------------------------------------
-- 5 · Verificación
-- ---------------------------------------------------------------------
\echo 'PARCHE 16 · bloque 5/5 · verificación'

DO $verif$
DECLARE
    v_n    int;
    v_b    boolean;
    v_b2   boolean;
BEGIN
    -- Cobertura: 44 tablas de core con RLS.
    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relrowsecurity;
    RAISE NOTICE 'core con RLS ......................... % (esperado 44)', v_n;

    -- Las 12 originales siguen protegidas: nada se perdió.
    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relrowsecurity
       AND c.relname IN ('actores', 'casos', 'alertas_tempranas', 'demandas',
                         'compromisos', 'documentos', 'reuniones_dialogo',
                         'caso_cronologia', 'proceso_instancia',
                         'actor_datos_personales', 'acuerdo_ospa_sni',
                         'riesgo_social_ordinal');
    RAISE NOTICE 'de las 12 originales, aún protegidas .. % (esperado 12)', v_n;

    -- Las 26 de detalle recibieron su política de herencia.
    SELECT count(DISTINCT tablename) INTO v_n
      FROM pg_policies
     WHERE schemaname = 'core' AND policyname = 'p_clasificacion'
       AND qual LIKE '%hp.%';
    RAISE NOTICE 'tablas con herencia por padre ........ % (esperado 26)', v_n;

    -- Toda tabla con nivel propio tiene las 7 políticas del patrón.
    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relrowsecurity
       AND c.relname IN ('capacitaciones', 'mesas_dialogo', 'hitos_compromiso',
                         'output_contracts', 'log_accesos')
       AND (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'core' AND p.tablename = c.relname) < 6;
    RAISE NOTICE 'tablas con nivel propio incompletas . % (esperado 0)', v_n;

    -- DC-04 existe, tiene una fila y su ODP está resuelto.
    SELECT count(*) INTO v_n FROM core.banco_datos_tratamiento;
    RAISE NOTICE 'filas en banco_datos_tratamiento ...... % (esperado 1)', v_n;

    SELECT oficial_datos_usuario_id IS NOT NULL,
           fecha_inscripcion_anpdp IS NULL
      INTO v_b, v_b2
      FROM core.banco_datos_tratamiento WHERE id = 1
      LIMIT 1;
    RAISE NOTICE 'ODP resuelto ......................... %', v_b;
    RAISE NOTICE 'inscripción pendiente (fecha NULL) ... %', v_b2;

    -- Las cinco bases legales quedaron ligadas al banco.
    SELECT count(*) INTO v_n FROM ref.base_legal_tratamiento WHERE banco_datos_id = 1;
    RAISE NOTICE 'bases legales ligadas al banco ....... % (esperado 5)', v_n;

    -- La ODP tiene el rol administrador.
    SELECT count(*) INTO v_n
      FROM core.usuario_roles ur
      JOIN core.usuarios u ON u.id = ur.usuario_id
      JOIN core.roles r    ON r.id = ur.rol_id
     WHERE u.email = 'ebautista@produce.gob.pe' AND r.codigo = 'administrador';
    RAISE NOTICE 'ODP con rol administrador ............ % (esperado 1)', v_n;

    -- Motivo documentado de las 55 tablas sin RLS.
    RAISE NOTICE 'core sin RLS (catálogos/config) ...... %', (
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'core' AND c.relkind = 'r' AND NOT c.relrowsecurity);
END
$verif$;

\echo ''
\echo 'Tablas de core con RLS, por número de políticas:'
SELECT c.relname AS tabla, count(p.policyname) AS politicas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policies p ON p.schemaname = 'core' AND p.tablename = c.relname
 WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relrowsecurity
 GROUP BY 1 ORDER BY 2 DESC, 1;

\echo ''
\echo 'Estado del banco de datos personales (DC-04):'
SELECT codigo, estado, nivel_seguridad AS nivel_seg,
       tiempo_conservacion_meses AS meses,
       fecha_inscripcion_anpdp AS inscrito,
       (SELECT email FROM core.usuarios WHERE id = oficial_datos_usuario_id) AS odp
  FROM core.banco_datos_tratamiento;

\echo 'PARCHE 16 aplicado.'
