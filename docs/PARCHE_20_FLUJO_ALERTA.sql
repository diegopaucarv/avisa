-- =====================================================================
--  AVISA · PARCHE 20 · Los dos niveles de aprobación de la alerta temprana
-- =====================================================================
--  QUÉ ES
--
--  Rehace el flujo `alerta` de `core.flujo_definicion` para que modele los
--  dos niveles que exige el ERS v0.6 (RN-04, RF-D09, CU-08; H-25 cerrado):
--
--      (a) validación previa del Sectorista, y
--      (b) aprobación definitiva de la Dirección de la OAIPCS,
--
--  antes de cualquier remisión. Aplica a TODA alerta, grave o no. La
--  gravedad decide el destinatario y el plazo, no quién autoriza.
--
--  Son cinco pasos: Elaboración → Validación previa → Aprobación definitiva
--  → Remisión → Archivo. Se añade el rol `direccion_oaipcs` a `core.roles`
--  porque el paso de aprobación necesita un responsable que no existía.
--
--  POR QUÉ EXISTE
--
--  1. El paso 2 apuntaba a `analista_cualitativo`, que es el rol del
--     análisis cualitativo REFI-QDA (`qda`), ajeno al flujo de alertas.
--     Ningún sectorista podía validar y el analista cualitativo no tiene
--     nada que ver con una alerta.
--
--  2. No existía ninguna aprobación de la Dirección. El paso 3 (Remisión)
--     apuntaba a `alta_direccion`, que es el ministerio que RECIBE la
--     alerta, no quien la aprueba: el flujo decía que el destinatario se
--     remitía a sí mismo. La aprobación definitiva no estaba modelada en
--     ningún sitio.
--
--  3. Sin el paso de aprobación, `core.vw_alerta_estado` nunca podía
--     mostrar una alerta «aprobada» y el gate G21 (visibilidad para los
--     perfiles B y C) no tenía paso al que agarrarse.
--
--  QUÉ NO HACE
--
--  · No inventa historia. No inserta filas en `core.proceso_instancia`
--    (el UNIQUE (tipo_origen, fila_legado) obligaría a inventar
--    `fila_legado`): solo renumera las existentes y reapunta su definición.
--  · No toca el paso 1 (Elaboración / `sectorista`), que es el anclaje de
--    `core.tg_alerta_nace()`. La función queda como está.
--  · No crea ningún estado en `core.flujo_estado`. Ese catálogo son los
--    cinco estados de paso que trae el legado (EST-01..EST-05, parche 10)
--    y «Aprobado» es un estado de negocio, que ya se escribe en
--    `core.flujo_definicion.estado_resultante`. Añadirlo al catálogo
--    rompería la separación que fijó el parche 10 (§2.3) entre estado de
--    paso (`estado_id`) y estado resultante (texto del legado).
--  · No asigna cuentas al rol nuevo. Quién ocupa la Dirección es un hecho
--    administrativo, no un dato que este parche pueda deducir.
--  · No usa `core.permiso_aprobacion` (suplencia del aprobador). Queda
--    reservada, sin filas y sin política; se detalla en el informe P20 §7.
--  · No modela a la Secretaría General ni a las jefaturas de gabinete como
--    roles: son DESTINATARIOS, no usuarios del sistema (RN-02).
--  · No arregla la inconsistencia `reporte`: `core.proceso_instancia` tiene
--    pasos 2..6 de reporte y `core.flujo_definicion` solo define 1..3. Se
--    reporta en el informe, no se toca aquí.
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
--      cat docs/PARCHE_20_FLUJO_ALERTA.sql \
--        | docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1
--
--  ORDEN
--  Después del parche 19. Usa `core.rol_actual()` (parche 15), los cinco
--  pasos DPPA-1..4 (parche 14) y las columnas de auditoría del parche 10.
--
--  IDEMPOTENTE
--  Se puede repetir: los INSERT van con `WHERE NOT EXISTS` o
--  `ON CONFLICT ... DO NOTHING`, los UPDATE llevan guarda
--  `IS DISTINCT FROM` (segunda pasada = 0 filas), y las políticas se
--  recrean con `DROP POLICY IF EXISTS` antes de `CREATE POLICY`. Correrlo
--  dos veces seguidas no falla, no duplica y no reescribe `updated_at`.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'PARCHE 20 · bloque 0/6 · comprobaciones previas'

-- ---------------------------------------------------------------------
-- 0 · El estado de partida tiene que ser el esperado
-- ---------------------------------------------------------------------
DO $p20_pre$
DECLARE
    v_n integer;
BEGIN
    IF to_regclass('core.flujo_definicion') IS NULL
       OR to_regclass('core.flujo_estado') IS NULL
       OR to_regclass('core.proceso_instancia') IS NULL
       OR to_regclass('core.roles') IS NULL THEN
        RAISE EXCEPTION
            'Faltan tablas del núcleo. Aplique antes los parches 10, 14 y 15.';
    END IF;

    IF to_regprocedure('core.rol_actual()') IS NULL THEN
        RAISE EXCEPTION 'Falta core.rol_actual(). Aplique antes el parche 15.';
    END IF;

    SELECT count(*) INTO v_n
      FROM core.flujo_definicion
     WHERE tipo_flujo = 'alerta'
       AND codigo_legado IN ('DPPA-1', 'DPPA-2', 'DPPA-3', 'DPPA-4');
    IF v_n <> 4 THEN
        RAISE EXCEPTION
            'Se esperaban los 4 pasos DPPA-1..4 del flujo de alerta y hay %. '
            'Aplique antes el parche 14.', v_n;
    END IF;

    -- El legado nunca registró validación ni remisión: esos pasos no
    -- existen como dato. Si aparecen, alguien aplicó otra variante.
    SELECT count(*) INTO v_n
      FROM core.proceso_instancia
     WHERE tipo_origen = 'alerta' AND orden IN (2, 3);
    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'Hay % instancias de alerta en los pasos 2 o 3, que este diseño '
            'no espera. Revise la base antes de aplicar el parche 20.', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM core.proceso_instancia
     WHERE tipo_origen = 'alerta' AND orden > 5;
    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'Hay % instancias de alerta con orden mayor que 5; el flujo tiene '
            '5 pasos.', v_n;
    END IF;

    RAISE NOTICE 'PARCHE 20 · estado de partida coherente';
END
$p20_pre$;

BEGIN;

-- =====================================================================
-- BLOQUE 1 · El rol de la aprobación definitiva
-- =====================================================================
\echo 'PARCHE 20 · bloque 1/6 · rol direccion_oaipcs'

--  `alta_direccion` no sirve para aprobar: es el ministerio que recibe la
--  alerta (nivel 3 y solo lectura). La Dirección de la OAIPCS es otra
--  unidad: aprueba. Necesita nivel 3 para ver alertas confidenciales, y
--  crear y editar porque aprobar es un acto de escritura: registra el paso
--  en `core.proceso_instancia` y la aprobación en la alerta. No borra
--  nada: ningún paso del flujo lo requiere.
INSERT INTO core.roles (id, codigo, max_clasificacion,
                        puede_crear, puede_editar, puede_eliminar)
SELECT (SELECT COALESCE(max(id), 0) + 1 FROM core.roles),
       'direccion_oaipcs', 3, true, true, false
 WHERE NOT EXISTS (SELECT 1 FROM core.roles WHERE codigo = 'direccion_oaipcs');

--  Si ya existía con otros atributos, se dejan los del diseño.
UPDATE core.roles
   SET max_clasificacion = 3,
       puede_crear       = true,
       puede_editar      = true,
       puede_eliminar    = false
 WHERE codigo = 'direccion_oaipcs'
   AND (max_clasificacion, puede_crear, puede_editar, puede_eliminar)
       IS DISTINCT FROM (3, true, true, false);

-- =====================================================================
-- BLOQUE 2 · Los cinco pasos del flujo de alerta
-- =====================================================================
\echo 'PARCHE 20 · bloque 2/6 · pasos del flujo de alerta'

--  El UNIQUE (tipo_flujo, orden) no admite dos pasos en el mismo puesto,
--  ni siquiera dentro de la misma transacción. Por eso se renumera de
--  arriba abajo: primero el 4 se va al 5, luego el 3 ocupa el 4 y al final
--  el paso nuevo entra en el 3.
--
--  `codigo_legado` se conserva en el paso equivalente (DPPA-3 sigue siendo
--  Remisión y DPPA-4 sigue siendo Archivo). Solo cambia su `orden`, porque
--  cambió su posición, no su identidad.

-- 2.1 · Archivo sube de 4 a 5 (el paso 1 no se toca: es el anclaje del trigger)
UPDATE core.flujo_definicion
   SET orden      = 5,
       updated_at = now()
 WHERE tipo_flujo   = 'alerta'
   AND codigo_legado = 'DPPA-4'
   AND orden        = 4;

-- 2.2 · Remisión sube de 3 a 4 y cambia de responsable. El ministerio
--       recibe la alerta; el envío lo ejecuta el servicio.
UPDATE core.flujo_definicion
   SET orden           = 4,
       rol_responsable = 'servicio_agente',
       descripcion     = 'La alerta aprobada se remite por el canal que corresponde a su gravedad: al Ministro si es grave, y a los viceministros, a la Secretaría General y a las jefaturas de gabinete si no lo es. La crisis (nivel 1) conserva el plazo de 24 horas y el destinatario Ministro. La Secretaría General y los gabinetes son destinatarios, no usuarios del sistema.',
       updated_at      = now()
 WHERE tipo_flujo      = 'alerta'
   AND codigo_legado    = 'DPPA-3'
   AND (orden, rol_responsable, descripcion) IS DISTINCT FROM
       (4::smallint, 'servicio_agente',
        'La alerta aprobada se remite por el canal que corresponde a su gravedad: al Ministro si es grave, y a los viceministros, a la Secretaría General y a las jefaturas de gabinete si no lo es. La crisis (nivel 1) conserva el plazo de 24 horas y el destinatario Ministro. La Secretaría General y los gabinetes son destinatarios, no usuarios del sistema.');

-- 2.3 · Validación pasa a ser la validación PREVIA del Sectorista, el rol
--       que el ERS nombra. `analista_cualitativo` sale del flujo de alerta.
UPDATE core.flujo_definicion
   SET nombre          = 'Validación previa',
       rol_responsable = 'sectorista',
       descripcion     = 'El sectorista depura las coincidencias dudosas y valida la alerta, o la devuelve al paso anterior con el motivo registrado. Es el primero de los dos niveles que exige RN-04 y no se salta aunque la alerta sea grave.',
       updated_at      = now()
 WHERE tipo_flujo      = 'alerta'
   AND codigo_legado    = 'DPPA-2'
   AND (nombre, rol_responsable, descripcion) IS DISTINCT FROM
       ('Validación previa', 'sectorista',
        'El sectorista depura las coincidencias dudosas y valida la alerta, o la devuelve al paso anterior con el motivo registrado. Es el primero de los dos niveles que exige RN-04 y no se salta aunque la alerta sea grave.');

-- 2.4 · El paso nuevo: aprobación definitiva de la Dirección.
--       No tiene equivalente en el sistema anterior, así que su
--       `codigo_legado` no puede ser DPPA-<n>: se marca como paso de la v10.
INSERT INTO core.flujo_definicion
    (tipo_flujo, orden, nombre, estado_resultante, rol_responsable,
     descripcion, codigo_legado)
SELECT 'alerta', 3, 'Aprobación definitiva', 'Aprobado', 'direccion_oaipcs',
       'La Dirección de la OAIPCS da la aprobación definitiva de toda alerta, grave o no, antes de cualquier remisión. Es el segundo nivel de RN-04. Si la devuelve, la alerta vuelve a la validación previa con el motivo registrado.',
       'V10-ALERTA-APROB'
 WHERE NOT EXISTS (
       SELECT 1 FROM core.flujo_definicion
        WHERE (tipo_flujo = 'alerta' AND orden = 3)
           OR codigo_legado = 'V10-ALERTA-APROB');

-- =====================================================================
-- BLOQUE 3 · Las instancias de proceso que ya existen
-- =====================================================================
\echo 'PARCHE 20 · bloque 3/6 · renumeración de proceso_instancia'

--  Las 72 filas del paso 1 no se tocan: siguen en el paso 1 y siguen
--  apuntando a DPPA-1. Las 83 filas del Archivo pasan de 4 a 5 para no
--  quedar empatadas con Remisión (la vista `core.vw_alerta_estado` ordena
--  por `orden` descendente y mostraría el paso equivocado). Se reapunta
--  la definición por código, que es único, para dejar el enlace explícito.
--
--  La guarda es SOLO `p.orden = 4`. No se usa `flujo_definicion_id` como
--  condición: las 72 filas del paso 1 apuntan a DPPA-1 y también son
--  «distintas» de DPPA-4, así que una condición de reapunado las habría
--  arrastrado al paso 5 (se comprobó en el ensayo: UPDATE 155 en vez de 83).
UPDATE core.proceso_instancia p
   SET orden               = 5,
       flujo_definicion_id = d.id
  FROM core.flujo_definicion d
 WHERE p.tipo_origen   = 'alerta'
   AND d.tipo_flujo    = 'alerta'
   AND d.codigo_legado = 'DPPA-4'
   AND p.orden         = 4;

-- =====================================================================
-- BLOQUE 4 · RLS del catálogo de pasos
-- =====================================================================
\echo 'PARCHE 20 · bloque 4/6 · RLS de core.flujo_definicion'

--  Hasta hoy cualquiera con sesión de aplicación podía reescribir el flujo
--  de toda la organización. La lectura queda abierta a propósito: el
--  aplicativo pinta el flujo y `core.tg_alerta_nace()` hace SELECT sobre
--  esta tabla; una política de lectura que devolviera 0 filas dejaría a
--  las alertas naciendo sin paso 1. La escritura queda solo para
--  `administrador`, igual que en `core.roles` (parche 18).
ALTER TABLE core.flujo_definicion ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.flujo_definicion FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p20_flujo_def_sel ON core.flujo_definicion;
CREATE POLICY p20_flujo_def_sel ON core.flujo_definicion
    AS PERMISSIVE FOR SELECT TO PUBLIC
    USING (true);

DROP POLICY IF EXISTS p20_flujo_def_ins ON core.flujo_definicion;
CREATE POLICY p20_flujo_def_ins ON core.flujo_definicion
    AS PERMISSIVE FOR INSERT TO PUBLIC
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p20_flujo_def_upd ON core.flujo_definicion;
CREATE POLICY p20_flujo_def_upd ON core.flujo_definicion
    AS PERMISSIVE FOR UPDATE TO PUBLIC
    USING (core.rol_actual() = 'administrador')
    WITH CHECK (core.rol_actual() = 'administrador');

DROP POLICY IF EXISTS p20_flujo_def_del ON core.flujo_definicion;
CREATE POLICY p20_flujo_def_del ON core.flujo_definicion
    AS PERMISSIVE FOR DELETE TO PUBLIC
    USING (core.rol_actual() = 'administrador');

-- =====================================================================
-- BLOQUE 5 · Comentarios que el cambio dejó desactualizados
-- =====================================================================
\echo 'PARCHE 20 · bloque 5/6 · comentarios del modelo'

COMMENT ON COLUMN core.flujo_definicion.tipo_flujo IS
    'Tipo de flujo: caso (ciclo de vida de un caso), reporte (el de un reporte) o alerta (los cinco pasos de una alerta temprana)';

COMMENT ON COLUMN core.flujo_definicion.estado_resultante IS
    'Estado de negocio al que lleva el paso. En caso y reporte conserva el vocabulario del sistema anterior (Activo, Remitido, Atendido, Registrado, Validado, Cerrado, Reaperturado, Archivado); en alerta usa el del ERS (Registrado, Validado, Aprobado, Remitido, Archivado). No es clave ajena a core.flujo_estado porque los dos vocabularios no coinciden y emparejarlos sería inventar la equivalencia';

COMMENT ON COLUMN core.flujo_definicion.rol_responsable IS
    'Rol que debe ejecutar el paso del flujo. En el flujo de alerta es el código de core.roles (sectorista, direccion_oaipcs, servicio_agente); en caso y reporte conserva el texto libre del sistema anterior';

COMMENT ON COLUMN core.flujo_definicion.codigo_legado IS
    'Identificador del paso en el sistema anterior: DPP-<n> si viene de dim_paso_proceso, DPPC-<n> si viene de dim_paso_proceso_caso y DPPA-<n> si es un paso del flujo de alerta. Los pasos que solo existen en la v10 llevan prefijo V10- y no tienen equivalencia en el legado';

COMMENT ON COLUMN core.proceso_instancia.orden IS
    'Número de paso, alineado con core.flujo_definicion.orden. En las filas migradas conserva el número del sistema anterior salvo la renumeración del parche 20, que pasó el Archivo del paso 4 al 5 al insertarse la aprobación definitiva';

-- =====================================================================
-- BLOQUE 6 · Verificación
-- =====================================================================
\echo 'PARCHE 20 · bloque 6/6 · verificación'

DO $p20_verify$
DECLARE
    v_n      integer;
    v_paso1  integer;
    v_paso5  integer;
    v_vista  integer;
    v_rol    text;
BEGIN
    -- 6.1 · Cinco pasos, sin huecos ni sobrantes
    SELECT count(*) INTO v_n
      FROM core.flujo_definicion WHERE tipo_flujo = 'alerta';
    IF v_n <> 5 THEN
        RAISE EXCEPTION 'el flujo de alerta tiene % pasos y debe tener 5', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM generate_series(1, 5) g
     WHERE NOT EXISTS (SELECT 1 FROM core.flujo_definicion d
                        WHERE d.tipo_flujo = 'alerta' AND d.orden = g);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'faltan % puestos en la secuencia 1..5 del flujo de alerta', v_n;
    END IF;

    -- 6.2 · El paso 1 sigue siendo el anclaje del trigger
    SELECT count(*) INTO v_n
      FROM core.flujo_definicion
     WHERE tipo_flujo = 'alerta' AND orden = 1
       AND codigo_legado = 'DPPA-1' AND rol_responsable = 'sectorista';
    IF v_n <> 1 THEN
        RAISE EXCEPTION
            'el paso 1 del flujo de alerta dejó de ser Elaboración/sectorista (DPPA-1)';
    END IF;

    -- 6.3 · El paso 3 es la aprobación de la Dirección
    SELECT count(*) INTO v_n
      FROM core.flujo_definicion
     WHERE tipo_flujo = 'alerta' AND orden = 3
       AND codigo_legado = 'V10-ALERTA-APROB'
       AND rol_responsable = 'direccion_oaipcs'
       AND estado_resultante = 'Aprobado';
    IF v_n <> 1 THEN
        RAISE EXCEPTION
            'el paso 3 del flujo de alerta no es la aprobación de direccion_oaipcs';
    END IF;

    -- 6.4 · Ningún paso usa el rol del análisis cualitativo
    SELECT count(*) INTO v_n
      FROM core.flujo_definicion WHERE rol_responsable = 'analista_cualitativo';
    IF v_n <> 0 THEN
        RAISE EXCEPTION
            'quedan % pasos con rol_responsable = analista_cualitativo', v_n;
    END IF;

    -- 6.5 · El rol existe y tiene las capacidades del diseño
    SELECT codigo INTO v_rol
      FROM core.roles
     WHERE codigo = 'direccion_oaipcs'
       AND max_clasificacion = 3
       AND puede_crear AND puede_editar AND NOT puede_eliminar;
    IF v_rol IS NULL THEN
        RAISE EXCEPTION
            'falta el rol direccion_oaipcs o no tiene nivel 3 con las capacidades esperadas';
    END IF;

    -- 6.6 · La RLS del catálogo quedó puesta, con lectura abierta
    SELECT count(*) INTO v_n
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'core' AND c.relname = 'flujo_definicion'
       AND c.relrowsecurity AND c.relforcerowsecurity;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'core.flujo_definicion no tiene RLS y FORCE RLS';
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_policies
     WHERE schemaname = 'core' AND tablename = 'flujo_definicion'
       AND policyname LIKE 'p20_flujo_def_%';
    IF v_n <> 4 THEN
        RAISE EXCEPTION 'se esperaban 4 políticas p20_flujo_def_* y hay %', v_n;
    END IF;

    -- 6.7 · Cifras del estado posterior (informativas: la base nueva
    --       puede no tener alertas todavía, y eso no es un error)
    SELECT count(*) INTO v_paso1
      FROM core.proceso_instancia WHERE tipo_origen = 'alerta' AND orden = 1;
    SELECT count(*) INTO v_paso5
      FROM core.proceso_instancia WHERE tipo_origen = 'alerta' AND orden = 5;
    SELECT count(*) INTO v_vista FROM core.vw_alerta_estado;

    RAISE NOTICE 'flujo alerta: 5 pasos (1..5) · instancias en paso 1: % · instancias en paso 5: % · vw_alerta_estado: % filas',
        v_paso1, v_paso5, v_vista;
END
$p20_verify$;

COMMIT;

\echo 'PARCHE 20 · aplicado'
