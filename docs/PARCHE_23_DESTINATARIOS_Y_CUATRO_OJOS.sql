-- =====================================================================
--  AVISA · PARCHE 23 · Destinatarios nombrados, cuatro ojos y escala de gravedad
-- =====================================================================
--  QUÉ ES
--
--  Cierra los pendientes de base que dejó abiertos el parche 22 y resuelve
--  el vacío H-14 sobre si los niveles de alerta son tres o cuatro:
--
--      (a) `core.cat_prioridades_alerta` gana `es_grave`: la regla RN-02
--          («graves son los niveles 1 y 2») deja de estar escrita en el
--          documento y pasa a estar en el dato;
--      (b) `core.alertas_tempranas` gana `validada_por`, el autor de la
--          validación previa, que faltaba: `es_validado_humano` era un
--          booleano sin firma y no se podía comprobar el «cuatro ojos»;
--      (c) el gate G21 pasa a exigir que quien valida y quien aprueba
--          sean personas distintas, y que una alerta con visibilidad
--          `sectorial` tenga al menos un destinatario nombrado;
--      (d) `core.alerta_destinatario` da soporte a esa visibilidad: hoy
--          `sectorial` era un valor del CHECK sin tabla que lo sostuviera;
--      (e) corrige el contrato G21 de `config.guardrail_contract`, que
--          se disparaba con un valor (`perfil_b`) que el CHECK de la
--          columna no admite;
--      (f) expone `validada_por` y el número de destinatarios al final de
--          `core.vw_alerta_estado`.
--
--  POR QUÉ EXISTE
--
--  1. El parche 22 dejó dicho que `visibilidad = 'sectorial'` no tenía
--     tabla de destinatarios: el valor existía en el CHECK y la remisión
--     se mapeaba «≈» a `core.alertas_actores`, que es una tabla de
--     actores del conflicto, no de destinatarios de una alerta. Una
--     visibilidad que no puede nombrar a quién se dirige no es una
--     visibilidad: es una etiqueta.
--
--  2. H-79 («cuatro ojos») pedía separar a quien valida de quien aprueba.
--     `es_validado_humano` es un booleano: dice que hubo validación, no
--     quién la hizo. Sin autor no hay manera de comprobar que sean dos
--     personas distintas, y por tanto la regla no se puede imponer.
--
--  3. H-14 preguntaba si los niveles son tres o cuatro. La respuesta
--     está en el dato y se aplica aquí: el catálogo tiene **cuatro filas**,
--     pero solo **tres tienen plazo**. `Seguimiento` no es un grado de
--     gravedad: es el cajón de lo que se observa sin plazo. La gravedad
--     son tres niveles, y los graves son los dos primeros.
--
--  4. El contrato de G21 en `config.guardrail_contract` decía
--     `"visibilidad": "perfil_b"`, un valor que el `CHECK` de la columna
--     no admite desde el parche 22 (`interna`, `ejecutiva`, `sectorial`).
--     Un contrato de prueba que usa un valor imposible nunca puede pasar:
--     el guardrail se probaría contra sí mismo y fallaría siempre.
--
--  QUÉ NO HACE
--
--  · No siembra destinatarios. `core.alerta_destinatario` nace vacía: los
--    destinatarios nombrados son configuración viva de la OAIPCS.
--
--  · No rellena `fecha_validacion` ni `validada_por` en las 83 alertas
--    migradas. Las 83 tienen `es_validado_humano = true` y
--    `fecha_validacion` en NULL: el sistema anterior marcaba la bandera
--    pero nunca guardó la fecha. Inventarla sería fabricar un acto
--    administrativo. Se quedan como están y siguen en `interna`.
--
--  · No cambia las filas de `core.cat_prioridades_alerta`: siguen siendo
--    cuatro, con sus mismos códigos y plazos. Solo se les añade un dato
--    derivado (`es_grave`).
--
--  · No toca `core.alertas_actores`, que sigue siendo la tabla de actores
--    del conflicto, ni `legacy.dim_destinatarios_fijos`, que es archivo.
--
--  DÓNDE SE EJECUTA
--
--  En la base viva del contenedor `avisa-db` (PostgreSQL 16, usuario
--  `avisa`, base `avisa`), por entrada estándar si el archivo no está
--  montado todavía:
--
--      MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
--          -v ON_ERROR_STOP=1 -f - < docs/PARCHE_23_DESTINATARIOS_Y_CUATRO_OJOS.sql
--
--  Es transaccional e idempotente: se puede correr varias veces seguidas
--  sin duplicar objetos ni filas. Al final imprime el recuento de cada
--  pieza para poder comparar dos pasadas.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

BEGIN;

\echo 'PARCHE 23 · bloque 0/8 · comprobaciones previas'

--  El parche 22 tiene que estar aplicado: sin `visibilidad` no hay gate que
--  ampliar y sin `aprobada_por` no hay «cuatro ojos» que comprobar.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'core'
           AND table_name   = 'alertas_tempranas'
           AND column_name  = 'visibilidad'
    ) THEN
        RAISE EXCEPTION
            'PARCHE_23_PREVIO: falta core.alertas_tempranas.visibilidad; aplique antes el parche 22';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'core'
           AND table_name   = 'alertas_tempranas'
           AND column_name  = 'aprobada_por'
    ) THEN
        RAISE EXCEPTION
            'PARCHE_23_PREVIO: falta core.alertas_tempranas.aprobada_por; aplique antes el parche 21';
    END IF;
END
$$;

-- =====================================================================
-- BLOQUE 1 · H-14 · La gravedad como dato, no como prosa
-- =====================================================================
\echo 'PARCHE 23 · bloque 1/8 · es_grave en el catálogo de prioridades'

--  El catálogo tiene cuatro filas y tres plazos:
--
--      1 Critica_Inmediata  24 h   grave
--      2 Urgente            48 h   grave
--      3 Temprana           72 h   no grave
--      4 Seguimiento        NULL   no grave, y sin plazo: no es un grado
--
--  `es_grave` no es un adorno: es la regla RN-02 («graves son los niveles 1
--  y 2») traducida a una columna, de modo que la aplicación no tenga que
--  llevar el número de nivel escrito en el código cuando mañana la OAIPCS
--  decida mover el umbral.
ALTER TABLE core.cat_prioridades_alerta
    ADD COLUMN IF NOT EXISTS es_grave boolean NOT NULL DEFAULT false;

--  Los valores se fijan por código, no por id: si algún día se renumeran
--  las filas, la regla sigue significando lo mismo. El `WHERE` los deja
--  idempotentes: correrlo dos veces escribe lo mismo.
UPDATE core.cat_prioridades_alerta SET es_grave = true
 WHERE codigo IN ('Critica_Inmediata', 'Urgente');

UPDATE core.cat_prioridades_alerta SET es_grave = false
 WHERE codigo IN ('Temprana', 'Seguimiento');

--  Coherencia de la escala: lo que no tiene plazo no puede ser grave. Un
--  nivel sin `sla_horas` es un cajón de observación, no una urgencia; si
--  alguna vez se quiere un nivel grave sin plazo, habrá que decidirlo
--  explícitamente y no por omisión.
ALTER TABLE core.cat_prioridades_alerta
    DROP CONSTRAINT IF EXISTS cat_prioridades_alerta_grave_con_plazo;
ALTER TABLE core.cat_prioridades_alerta
    ADD CONSTRAINT cat_prioridades_alerta_grave_con_plazo
    CHECK (NOT es_grave OR sla_horas IS NOT NULL);

COMMENT ON COLUMN core.cat_prioridades_alerta.es_grave IS
    'Marca si el nivel de prioridad es grave para la regla RN-02: los graves llevan al Ministro como destinatario. Verdaderos hoy: Crítica inmediata (24 h) y Urgente (48 h). Un nivel sin plazo de atención (Seguimiento) no puede ser grave, y la restricción cat_prioridades_alerta_grave_con_plazo lo impide';

-- =====================================================================
-- BLOQUE 2 · La firma de la validación previa (H-79)
-- =====================================================================
\echo 'PARCHE 23 · bloque 2/8 · validada_por y el «cuatro ojos»'

--  `aprobada_por` (parche 21) dio autor a la aprobación definitiva. Faltaba
--  el mismo dato para la validación previa: `es_validado_humano` dice que
--  alguien validó, no quién. Sin autor no se puede comprobar que sean dos
--  personas distintas.
--
--  ON DELETE RESTRICT por la misma razón que en `aprobada_por`: no se puede
--  borrar a quien firmó mientras su firma conste en una alerta.
ALTER TABLE core.alertas_tempranas
    ADD COLUMN IF NOT EXISTS validada_por uuid
        REFERENCES core.usuarios(id) ON DELETE RESTRICT;

--  Coherencia: la firma y la fecha van juntas o no van. Se exige la
--  equivalencia, no la presencia, porque las 83 filas migradas tienen las
--  dos en NULL a propósito —el sistema anterior marcó la bandera y nunca
--  guardó la fecha— y un CHECK que exigiera la fecha sobre `es_validado_humano`
--  las rechazaría.
ALTER TABLE core.alertas_tempranas
    DROP CONSTRAINT IF EXISTS alertas_validacion_coherente;
ALTER TABLE core.alertas_tempranas
    ADD CONSTRAINT alertas_validacion_coherente
    CHECK ((validada_por IS NULL) = (fecha_validacion IS NULL));

--  El «cuatro ojos» en su forma mínima y comprobable en la base: cuando
--  constan las dos firmas, tienen que ser de dos personas distintas. Se
--  permite que falte alguna (NULL) para no bloquear el registro de una
--  aprobación mientras la validación se está consignando; lo que no se
--  permite es que una misma persona firme los dos actos.
ALTER TABLE core.alertas_tempranas
    DROP CONSTRAINT IF EXISTS alertas_cuatro_ojos;
ALTER TABLE core.alertas_tempranas
    ADD CONSTRAINT alertas_cuatro_ojos
    CHECK (validada_por IS NULL
        OR aprobada_por IS NULL
        OR validada_por <> aprobada_por);

--  Índice parcial: las consultas del gate y de la pantalla buscan las
--  alertas que ya tienen validación firmada, que hoy son cero filas.
CREATE INDEX IF NOT EXISTS ix_alertas_validada_por
    ON core.alertas_tempranas (validada_por)
    WHERE validada_por IS NOT NULL;

COMMENT ON COLUMN core.alertas_tempranas.validada_por IS
    'Autor de la validación previa del Sectorista. Junto con fecha_validacion forma la primera de las dos firmas de G21; la segunda es aprobada_por y aprobada_en. La restricción alertas_cuatro_ojos impide que la misma persona firme la validación y la aprobación. Las 83 alertas migradas lo tienen en NULL porque el sistema anterior nunca registró quién validaba';

-- =====================================================================
-- BLOQUE 3 · Los destinatarios nombrados de una alerta
-- =====================================================================
\echo 'PARCHE 23 · bloque 3/8 · core.alerta_destinatario'

--  El valor `sectorial` del CHECK de `visibilidad` significa «la remisión se
--  limita a los destinatarios nombrados de esa alerta», pero no existía la
--  tabla donde nombrarlos. `core.alertas_actores` no sirve: relaciona una
--  alerta con los actores del conflicto, no con las personas a las que se
--  avisa.
--
--  El destinatario puede ser un usuario del sistema (Ministro, viceministros,
--  secretario general) o un cargo sin cuenta (las jefaturas de gabinete, que
--  reciben envíos de alertas no graves y no entran al sistema: 6.1). Por eso
--  hay dos columnas excluyentes y no una sola clave ajena.
CREATE TABLE IF NOT EXISTS core.alerta_destinatario (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    alerta_id      uuid        NOT NULL
                               REFERENCES core.alertas_tempranas(id) ON DELETE CASCADE,
    usuario_id     uuid        REFERENCES core.usuarios(id) ON DELETE RESTRICT,
    cargo          varchar(80),
    canal          varchar(20) NOT NULL DEFAULT 'correo',
    motivo         varchar(120),
    notificado_en  timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid        REFERENCES core.usuarios(id),
    updated_by     uuid        REFERENCES core.usuarios(id),

    CONSTRAINT alerta_destinatario_canal_valido
        CHECK (canal IN ('correo', 'whatsapp', 'sms')),

    --  Exactamente uno de los dos: o es una persona con cuenta, o es un
    --  cargo sin cuenta. Los dos a la vez sería ambiguo; ninguno, un
    --  destinatario que no existe.
    CONSTRAINT alerta_destinatario_identidad
        CHECK ((usuario_id IS NULL) <> (cargo IS NULL)),

    --  Un envío registrado no puede ser anterior a la alerta que lo origina.
    CONSTRAINT alerta_destinatario_notificado_coherente
        CHECK (notificado_en IS NULL OR notificado_en >= created_at)
);

--  Una misma persona no se repite por el mismo canal en la misma alerta.
CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_destinatario_usuario_canal
    ON core.alerta_destinatario (alerta_id, usuario_id, canal)
    WHERE usuario_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_alerta_destinatario_cargo_canal
    ON core.alerta_destinatario (alerta_id, lower(cargo), canal)
    WHERE cargo IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_alerta_destinatario_alerta
    ON core.alerta_destinatario (alerta_id);

--  Auditoría estándar del esquema: rellena updated_at/updated_by/created_by
--  desde `app.user_id`. El `DROP ... IF EXISTS` la hace reejecutable.
DROP TRIGGER IF EXISTS trg_audit ON core.alerta_destinatario;
CREATE TRIGGER trg_audit
    BEFORE INSERT OR UPDATE ON core.alerta_destinatario
    FOR EACH ROW EXECUTE FUNCTION core.set_audit();

--  RLS: lectura abierta para la aplicación y escritura solo de los roles que
--  remiten o administran. Se aplica el mismo patrón que el parche 21 usó en
--  `core.flujo_estado` y `core.permiso_aprobacion`.
ALTER TABLE core.alerta_destinatario ENABLE ROW LEVEL SECURITY;
--  Y forzada, como el resto de `core`: la aplicación se conecta como `avisa`,
--  que es la propietaria de las tablas, y sin `FORCE` el propietario se salta
--  las políticas. Las cuatro políticas de este bloque no servirían de nada.
--  Es el mismo criterio del parche 21 en `core.flujo_estado` y
--  `core.permiso_aprobacion`.
ALTER TABLE core.alerta_destinatario FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p23_alerta_destinatario_select ON core.alerta_destinatario;
CREATE POLICY p23_alerta_destinatario_select ON core.alerta_destinatario
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS p23_alerta_destinatario_insert ON core.alerta_destinatario;
CREATE POLICY p23_alerta_destinatario_insert ON core.alerta_destinatario
    FOR INSERT
    WITH CHECK (core.rol_actual() IN ('administrador', 'direccion_oaipcs',
                                      'sectorista', 'servicio_agente'));

DROP POLICY IF EXISTS p23_alerta_destinatario_update ON core.alerta_destinatario;
CREATE POLICY p23_alerta_destinatario_update ON core.alerta_destinatario
    FOR UPDATE
    USING (core.rol_actual() IN ('administrador', 'direccion_oaipcs',
                                 'sectorista', 'servicio_agente'))
    WITH CHECK (core.rol_actual() IN ('administrador', 'direccion_oaipcs',
                                      'sectorista', 'servicio_agente'));

DROP POLICY IF EXISTS p23_alerta_destinatario_delete ON core.alerta_destinatario;
CREATE POLICY p23_alerta_destinatario_delete ON core.alerta_destinatario
    FOR DELETE
    USING (core.rol_actual() = 'administrador');

COMMENT ON TABLE core.alerta_destinatario IS
    'Destinatarios nombrados de una alerta: las personas a las que se remite cuando la visibilidad es «sectorial». El destinatario es un usuario del sistema (usuario_id) o un cargo sin cuenta (cargo), nunca los dos. Reemplaza el mapeo aproximado a core.alertas_actores, que relaciona la alerta con los actores del conflicto y no con quienes reciben el aviso';

COMMENT ON COLUMN core.alerta_destinatario.usuario_id IS
    'Persona con cuenta en el sistema a la que se remite la alerta. Excluyente con cargo';

COMMENT ON COLUMN core.alerta_destinatario.cargo IS
    'Cargo sin cuenta en el sistema al que se remite la alerta, por ejemplo una jefatura de gabinete. Excluyente con usuario_id. Se compara sin distinguir mayúsculas en la unicidad';

COMMENT ON COLUMN core.alerta_destinatario.canal IS
    'Canal del aviso: correo, whatsapp o sms. Un mismo destinatario puede tener una fila por canal';

COMMENT ON COLUMN core.alerta_destinatario.notificado_en IS
    'Momento en que el envío se completó por este canal. NULL mientras el aviso esté pendiente; no puede ser anterior a la creación de la fila';

-- =====================================================================
-- BLOQUE 4 · El gate G21, ampliado
-- =====================================================================
\echo 'PARCHE 23 · bloque 4/8 · G21 exige cuatro ojos y destinatarios'

--  Se recrea la función entera en lugar de parchearla: `CREATE OR REPLACE`
--  deja la definición en un solo sitio, que es lo que se puede leer y
--  auditar. Los tres requisitos de salida de `interna` son ahora:
--
--    1. la validación previa del Sectorista, con autor y fecha;
--    2. la aprobación definitiva de la Dirección, con autor y fecha;
--    3. que los dos autores sean personas distintas;
--
--  y uno adicional, que solo aplica a `sectorial`:
--
--    4. al menos un destinatario nombrado, porque una visibilidad que no
--       puede nombrar a quién se dirige no es una visibilidad.
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
            AND NEW.validada_por IS NOT NULL
            AND COALESCE(NEW.paso_actual, 0) >= 2) THEN
        v_falta := v_falta || 'la validación previa del Sectorista (es_validado_humano, fecha_validacion, validada_por y paso_actual >= 2)'::text;
    END IF;

    IF NEW.aprobada_por IS NULL OR NEW.aprobada_en IS NULL THEN
        v_falta := v_falta || 'la aprobación definitiva de la Dirección de la OAIPCS (aprobada_por y aprobada_en)'::text;
    END IF;

    IF NEW.validada_por IS NOT NULL
       AND NEW.aprobada_por IS NOT NULL
       AND NEW.validada_por = NEW.aprobada_por THEN
        v_falta := v_falta || 'dos firmas de personas distintas: quien valida y quien aprueba no pueden ser la misma (H-79)'::text;
    END IF;

    --  La comprobación de destinatarios solo puede hacerse sobre una fila que
    --  ya existe, porque en un INSERT la clave todavía no sirve para buscar
    --  en la tabla hija. En el alta, la alerta nace `interna` y los
    --  destinatarios se añaden después; el paso a `sectorial` es un UPDATE y
    --  ahí sí se comprueba.
    IF NEW.visibilidad = 'sectorial' AND TG_OP = 'UPDATE' THEN
        IF NOT EXISTS (
            SELECT 1 FROM core.alerta_destinatario d WHERE d.alerta_id = NEW.id
        ) THEN
            v_falta := v_falta || 'al menos un destinatario nombrado para la visibilidad «sectorial» (core.alerta_destinatario)'::text;
        END IF;
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
--  invariante depende de siete columnas y una lista incompleta lo dejaría
--  abierto por el lado que nadie probó.
DROP TRIGGER IF EXISTS alertas_g21_visibilidad ON core.alertas_tempranas;
CREATE TRIGGER alertas_g21_visibilidad
    BEFORE INSERT OR UPDATE ON core.alertas_tempranas
    FOR EACH ROW EXECUTE FUNCTION core.tg_alerta_g21_visibilidad();

COMMENT ON FUNCTION core.tg_alerta_g21_visibilidad() IS
    'Gate G21: rechaza con ERRCODE P0001 y mensaje G21_SIN_APROBACION cualquier visibilidad distinta de interna mientras falte la validación previa del Sectorista (con autor y fecha), la aprobación definitiva de la Dirección, la distinción de personas entre ambas firmas o, para la visibilidad sectorial, al menos un destinatario nombrado. Las alertas internas, incluidas las 83 migradas, pasan sin comprobación';

-- =====================================================================
-- BLOQUE 5 · El contrato de G21, con un valor que existe
-- =====================================================================
\echo 'PARCHE 23 · bloque 5/8 · config.guardrail_contract'

--  El contrato se disparaba con `"visibilidad": "perfil_b"`, que el CHECK de
--  la columna no admite desde el parche 22: un contrato de prueba que usa un
--  valor imposible no puede pasar nunca. Se alinea con el vocabulario real
--  (`interna`, `ejecutiva`, `sectorial`) y se le añade el cuarto ojo, para
--  que el caso negativo cubra también la firma duplicada.
UPDATE config.guardrail_contract
   SET input_dispara = jsonb_build_object(
           'visibilidad',  'ejecutiva',
           'aprobada_por', NULL,
           'aprobada_en',  NULL,
           'validada_por', NULL
       ),
       input_no_dispara = jsonb_build_object(
           'visibilidad',  'ejecutiva',
           'aprobada_por', '3f9c2a41-7b8e-4d6f-9a01-5c2e8b7d4a63',
           'aprobada_en',  '2026-11-18T10:15:00-05:00',
           'validada_por', 'a2d5c9e0-1b47-4f83-8e26-7c0d9b3a5f18'
       )
 WHERE guardrail = 'G21';

-- =====================================================================
-- BLOQUE 6 · La vista de estado, con las dos piezas nuevas
-- =====================================================================
\echo 'PARCHE 23 · bloque 6/8 · vw_alerta_estado'

--  `validada_por` entra al final, junto a la aprobación, y `destinatarios`
--  cuenta las filas de la tabla nueva. La vista pasa de 20 a 22 columnas y
--  conserva sus 83 filas: los dos contadores se resuelven con subconsultas
--  escalares sobre una tabla vacía.
CREATE OR REPLACE VIEW core.vw_alerta_estado AS
 SELECT a.id AS alerta_id,
    a.codigo_alerta,
    a.titulo,
    a.prioridad_id,
    a.nivel_alerta_id,
    a.fecha_reporte,
    pi.id AS proceso_id,
    pi.orden AS paso,
    d.nombre AS paso_nombre,
    pi.estado_id,
    e.codigo AS estado_codigo,
    e.nombre AS estado_nombre,
    e.es_final,
    pi.ocurrido_en AS estado_desde,
    a.es_validado_humano,
    a.fecha_validacion,
    a.fecha_remision,
    a.aprobada_por,
    a.aprobada_en,
    a.visibilidad,
    a.validada_por,
    (SELECT count(*) FROM core.alerta_destinatario d2 WHERE d2.alerta_id = a.id) AS destinatarios
   FROM core.alertas_tempranas a
     LEFT JOIN LATERAL ( SELECT p.id,
            p.tipo_origen,
            p.caso_id,
            p.codigo_caso_legado,
            p.alerta_id,
            p.codigo_reporte,
            p.flujo_definicion_id,
            p.estado_id,
            p.usuario_id,
            p.codigo_responsable_legado,
            p.ocurrido_en,
            p.finalizado_en,
            p.orden,
            p.nota,
            p.codigo_legado,
            p.fila_legado,
            p.created_at,
            p.updated_at,
            p.created_by,
            p.updated_by,
            p.nivel_clasificacion
           FROM core.proceso_instancia p
          WHERE p.tipo_origen::text = 'alerta'::text AND p.alerta_id = a.id
          ORDER BY p.orden DESC, p.ocurrido_en DESC NULLS LAST
         LIMIT 1) pi ON true
     LEFT JOIN core.flujo_estado e ON e.id = pi.estado_id
     LEFT JOIN core.flujo_definicion d ON d.id = pi.flujo_definicion_id;

COMMENT ON VIEW core.vw_alerta_estado IS
    'Estado consolidado de cada alerta: su paso y estado vigentes, sus dos firmas de aprobación y su visibilidad. Desde el parche 23 expone también el autor de la validación previa (validada_por) y cuántos destinatarios nombrados tiene (destinatarios), que es lo que la pantalla necesita para saber si la alerta puede publicarse como sectorial';

COMMENT ON COLUMN core.vw_alerta_estado.validada_por IS
    'Autor de la validación previa del Sectorista; primera de las dos firmas de G21';

COMMENT ON COLUMN core.vw_alerta_estado.destinatarios IS
    'Número de destinatarios nombrados en core.alerta_destinatario. Una alerta con visibilidad sectorial necesita al menos uno';

-- =====================================================================
-- BLOQUE 7 · Comprobación
-- =====================================================================
\echo 'PARCHE 23 · bloque 7/8 · comprobación'

DO $$
DECLARE
    v_cols      int;
    v_view_cols int;
    v_graves    int;
    v_dest      bigint;
    v_g21       text;
BEGIN
    SELECT count(*) INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'core' AND table_name = 'alertas_tempranas';

    SELECT count(*) INTO v_view_cols
      FROM information_schema.columns
     WHERE table_schema = 'core' AND table_name = 'vw_alerta_estado';

    SELECT count(*) INTO v_graves
      FROM core.cat_prioridades_alerta WHERE es_grave;

    SELECT count(*) INTO v_dest FROM core.alerta_destinatario;

    SELECT input_dispara->>'visibilidad' INTO v_g21
      FROM config.guardrail_contract WHERE guardrail = 'G21';

    IF v_cols <> 37 THEN
        RAISE EXCEPTION 'PARCHE_23_VERIFICA: core.alertas_tempranas tiene % columnas, se esperaban 37', v_cols;
    END IF;

    IF v_view_cols <> 22 THEN
        RAISE EXCEPTION 'PARCHE_23_VERIFICA: core.vw_alerta_estado tiene % columnas, se esperaban 22', v_view_cols;
    END IF;

    IF v_graves <> 2 THEN
        RAISE EXCEPTION 'PARCHE_23_VERIFICA: hay % niveles graves, se esperaban 2', v_graves;
    END IF;

    IF v_g21 IS DISTINCT FROM 'ejecutiva' THEN
        RAISE EXCEPTION 'PARCHE_23_VERIFICA: el contrato G21 usa «%», se esperaba «ejecutiva»', v_g21;
    END IF;

    RAISE NOTICE 'PARCHE 23 · alertas_tempranas: % columnas · vw_alerta_estado: % columnas · niveles graves: % · destinatarios: %',
        v_cols, v_view_cols, v_graves, v_dest;
END
$$;

--  Las 83 alertas siguen internas y sin firmas: el parche no inventa actos.
DO $$
DECLARE
    v_no_internas bigint;
    v_sin_fecha   bigint;
BEGIN
    SELECT count(*) INTO v_no_internas
      FROM core.alertas_tempranas WHERE visibilidad <> 'interna';
    SELECT count(*) INTO v_sin_fecha
      FROM core.alertas_tempranas WHERE es_validado_humano AND fecha_validacion IS NULL;

    IF v_no_internas <> 0 THEN
        RAISE EXCEPTION 'PARCHE_23_VERIFICA: % alertas dejaron de ser internas', v_no_internas;
    END IF;

    RAISE NOTICE 'PARCHE 23 · alertas no internas: % · alertas con la bandera de validación pero sin fecha (esperado 83): %',
        v_no_internas, v_sin_fecha;
END
$$;

-- =====================================================================
-- BLOQUE 8 · Cierre
-- =====================================================================
\echo 'PARCHE 23 · bloque 8/8 · cierre'

COMMIT;

\echo 'PARCHE 23 · aplicado'
