-- =============================================================================
-- PARCHE 10 - FLUJO POR PASOS: DECISION DE MIGRACION D17
-- AVISA / SIPRECS - OAIPCS, Ministerio de la Produccion del Peru
-- =============================================================================
--
-- QUE HACE
--
-- Abre la decision D17 y da casa a las 147 filas del legado que hoy no tienen
-- destino: 12 filas de catalogo y 135 instancias de proceso.
--
--   core.flujo_estado       <- legacy.dim_estado_proceso             (5 filas)
--   core.flujo_definicion   <- legacy.dim_paso_proceso               (3 filas)
--                              + legacy.dim_paso_proceso_caso        (4 filas)
--   core.proceso_instancia  <- legacy.fact_proceso_caso              (36 filas)
--                              + legacy.fact_proceso_reporte         (99 filas)
--
-- QUE NO SE REUTILIZA Y POR QUE
--
-- - `analisis.plan` y `analisis.plan_paso` ya existen, pero modelan el plan de
--   investigacion analitica (pregunta, pauta, entregables qdpx/pdf), no el flujo
--   operativo de un caso. No se usan ni se modifican.
-- - `core.caso_estado_historial` registra el estado del caso (35 filas, todas con
--   codigo_legado nulo), no el avance por pasos. No se toca.
--
-- HECHOS VERIFICADOS SOBRE LOS DATOS (detalle en docs/04_migracion/parches/P10_FLUJO_D17.md)
--
-- 1. Los codigos de caso resuelven por core.casos.codigo_caso. Son 35 codigos y
--    35 filas en core.casos; 34 de las 36 filas de fact_proceso_caso resuelven.
--    Las dos restantes (CS-PRODUCE-2026-037 y 038) no existen en core.casos.
-- 2. core.usuarios conserva el codigo legado en la columna codigo_legado, asi que
--    SEC-01..SEC-15 resuelven. DEST-01 no existe: queda usuario_id nulo.
-- 3. SI existe maestro para parte de los reportes: core.alertas_tempranas.codigo_alerta
--    coincide con c02 en las 81 filas cuyo c02 es un código AT-YYYY-nn.
--    Las otras 18 filas (PR-001..PR-018) traen en c02 el NOMBRE del tipo de
--    reporte ('Alerta Temprana'), no un codigo: no tienen maestro.
--    Por eso se guarda codigo_reporte como texto (enlace blando) y ademas
--    alerta_id como FK opcional cuando el código resuelve.
-- 4. dim_paso_proceso define 3 pasos, pero fact_proceso_reporte usa hasta 6.
--    Las filas con paso 5 y 6 no tienen definición; se conserva el número.
--    No se inventan pasos.
--    dim_paso_proceso_caso define 4 pasos, pero fact_proceso_caso sólo usa el 1.
-- 4b. No hay columna que diga el estado de cada paso: se deja estado_id nulo.
--    Se carga igual el catálogo flujo_estado (5 filas) porque es el catálogo de
--    estados de este flujo y debe existir para cuando el flujo se use en vivo.
-- 5. Las dos tablas de hechos NO comparten el significado de sus columnas aunque
--    tengan la misma forma (fila_n + c01..cNN, todas text):
--      - fact_proceso_caso: c06 vacío, c07='0', c08='1', nota en c09.
--      - fact_proceso_reporte: c05/c06 son fechas de inicio y fin, c07 es la
--        diferencia en días, c08 es la nota.
--    El mapeo del informe es columna a columna y distinto por tabla.
---
-- Idempotencia: el archivo completo puede correrse dos veces. Los catálogos se
-- cargan con upsert por su código de negocio y las instancias por la restricción
-- UNIQUE (tipo_origen, fila_legado), que es la fila del cargador. No se duplican
-- filas.
--
-- Solo crea objetos nuevos. No modifica core.* existente, ni analisis.*, ni
-- config.*, ni core.actor_datos_personales.
--
-- Antes de ejecutar, leer la sección 0. Todas las verificaciones traen el
-- resultado esperado; si alguno no coincide, DETENERSE.
--
-- Ejecucion prevista:
--   docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--     -f - < docs/PARCHE_10_FLUJO_PROCESO_D17.sql
--
-- REQUISITO DE SESION. `core.proceso_instancia` queda con RLS FORCE. El rol `avisa`
-- es superusuario con BYPASSRLS, por eso la carga entra. Con otro rol hay que
-- abrir la sesion antes del BEGIN:
--   SET app.rol_codigo = 'administrador';
--   SET app.user_id = '<uuid>';
-- =============================================================================


-- =============================================================================
-- 0. VERIFICACION PREVIA (solo lectura)
-- =============================================================================

-- 0.1 Padron del legado. Esperado: 3 / 4 / 5 / 36 / 99.
SELECT
    (SELECT count(*) FROM legacy.dim_paso_proceso)       AS pasos_reporte,
    (SELECT count(*) FROM legacy.dim_paso_proceso_caso)  AS pasos_caso,
    (SELECT count(*) FROM legacy.dim_estado_proceso)     AS estados,
    (SELECT count(*) FROM legacy.fact_proceso_caso)      AS instancias_caso,
    (SELECT count(*) FROM legacy.fact_proceso_reporte)   AS instancias_reporte;

-- 0.2 Las tablas nuevas no deben existir todavia. Esperado: 3 NULL.
SELECT to_regclass('core.flujo_estado')       AS flujo_estado,
       to_regclass('core.flujo_definicion')   AS flujo_definicion,
       to_regclass('core.proceso_instancia')  AS proceso_instancia;

-- 0.3 Destinos disponibles. Esperado: 35 casos, 83 alertas, 32 usuarios con codigo.
SELECT
    (SELECT count(*) FROM core.casos)                                     AS casos,
    (SELECT count(*) FROM core.alertas_tempranas)                         AS alertas,
    (SELECT count(*) FROM core.usuarios WHERE codigo_legado IS NOT NULL)  AS usuarios_con_legado;

-- 0.4 Filas que no van a resolver, para que el conteo posterior cuadre.
--     Esperado: casos 037 y 038 (2 filas), 27 reportes sin alerta, 6 con DEST-01.
SELECT 'caso sin maestro' AS motivo, btrim(f.c02) AS codigo, count(*) AS filas
FROM legacy.fact_proceso_caso f
LEFT JOIN core.casos c ON c.codigo_caso = btrim(f.c02)
WHERE c.id IS NULL
GROUP BY 2
UNION ALL
SELECT 'reporte sin maestro', btrim(f.c02), count(*)
FROM legacy.fact_proceso_reporte f
LEFT JOIN core.alertas_tempranas a ON a.codigo_alerta = btrim(f.c02)
WHERE a.id IS NULL
GROUP BY 2
UNION ALL
SELECT 'responsable sin usuario', btrim(f.c04), count(*)
FROM legacy.fact_proceso_caso f
LEFT JOIN core.usuarios u ON u.codigo_legado = btrim(f.c04)
WHERE u.id IS NULL
GROUP BY 2
UNION ALL
SELECT 'responsable sin usuario', btrim(f.c04), count(*)
FROM legacy.fact_proceso_reporte f
LEFT JOIN core.usuarios u ON u.codigo_legado = btrim(f.c04)
WHERE u.id IS NULL
GROUP BY 2
ORDER BY 1, 2;


BEGIN;

-- =============================================================================
-- 1. CATALOGOS
--    Mismo estilo que core.cat_*: sin nivel_clasificacion y sin RLS, porque son
--    vocabulario compartido y no dato de un caso. Con created_at/updated_at,
--    CHECK de dominio y COMMENT ON.
-- =============================================================================

-- 1.1 Estados por paso. 5 filas (EST-01..EST-05).
CREATE TABLE IF NOT EXISTS core.flujo_estado (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo     VARCHAR(20)  NOT NULL,
    nombre     VARCHAR(60)  NOT NULL,
    color_hex  VARCHAR(7)   NOT NULL,
    es_final   BOOLEAN      NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT flujo_estado_codigo_key UNIQUE (codigo),
    CONSTRAINT flujo_estado_color_hex_check CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$')
);

COMMENT ON TABLE core.flujo_estado IS
    'Catalogo de estados posibles de un paso del flujo operativo. Origen: legacy.dim_estado_proceso (5 filas).';
COMMENT ON COLUMN core.flujo_estado.codigo IS
    'Codigo de negocio, heredado del legado (EST-01..EST-05).';
COMMENT ON COLUMN core.flujo_estado.es_final IS
    'Si el paso queda en este estado y ya no admite avance (Completado y Omitido en el legado).';

-- 1.2 Definicion de pasos. 7 filas: 3 de flujo de reporte + 4 de flujo de caso.
CREATE TABLE IF NOT EXISTS core.flujo_definicion (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_flujo        VARCHAR(10)   NOT NULL,
    orden             SMALLINT      NOT NULL,
    nombre            VARCHAR(120)  NOT NULL,
    estado_resultante VARCHAR(60)   NOT NULL,
    rol_responsable   VARCHAR(120),
    descripcion       TEXT,
    codigo_legado     VARCHAR(60)   NOT NULL,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT flujo_definicion_tipo_flujo_check
        CHECK (tipo_flujo IN ('caso', 'reporte')),
    CONSTRAINT flujo_definicion_orden_check CHECK (orden > 0),
    CONSTRAINT flujo_definicion_tipo_orden_key UNIQUE (tipo_flujo, orden),
    CONSTRAINT flujo_definicion_codigo_legado_key UNIQUE (codigo_legado)
);

COMMENT ON TABLE core.flujo_definicion IS
    'Pasos del flujo operativo por tipo de flujo. Origen: legacy.dim_paso_proceso (3, reporte) y '
    'legacy.dim_paso_proceso_caso (4, caso). Total 7 filas.';
COMMENT ON COLUMN core.flujo_definicion.tipo_flujo IS
    'Discriminador del flujo: caso (ciclo de vida de un caso) o reporte (ciclo de un reporte o alerta).';
COMMENT ON COLUMN core.flujo_definicion.estado_resultante IS
    'Estado al que lleva el paso, en el vocabulario del legado (Activo, Remitido, Atendido, Registrado, '
    'Cerrado, Reaperturado). No es FK a core.flujo_estado: el vocabulario no coincide con EST-01..EST-05, '
    'y renombrar el dato seria inventar la equivalencia.';
COMMENT ON COLUMN core.flujo_definicion.codigo_legado IS
    'Identidad de origen: DPP-<n> para dim_paso_proceso, DPPC-<n> para dim_paso_proceso_caso.';


-- =============================================================================
-- 2. INSTANCIAS DE PROCESO
--    Tabla de hechos: una fila por paso ejecutado sobre un caso o un reporte.
--    Sigue la convencion de las tablas operativas de core (caso_cronologia,
--    documentos, alertas_tempranas): nivel_clasificacion, RLS FORCE con las
--    cuatro politicas y trigger de auditoria core.set_audit().
-- =============================================================================

CREATE TABLE IF NOT EXISTS core.proceso_instancia (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_origen               VARCHAR(10) NOT NULL,
    caso_id                   UUID,
    codigo_caso_legado        VARCHAR(50),
    alerta_id                 UUID,
    codigo_reporte            VARCHAR(50),
    flujo_definicion_id       UUID,
    estado_id                 UUID,
    usuario_id                UUID,
    codigo_responsable_legado VARCHAR(50),
    ocurrido_en               TIMESTAMPTZ,
    finalizado_en             TIMESTAMPTZ,
    orden                     SMALLINT    NOT NULL,
    nota                      TEXT,
    codigo_legado             VARCHAR(50) NOT NULL,
    fila_legado               SMALLINT    NOT NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID,
    updated_by                UUID,
    nivel_clasificacion       SMALLINT    NOT NULL DEFAULT 2,

    CONSTRAINT proceso_instancia_tipo_origen_check
        CHECK (tipo_origen IN ('caso', 'reporte')),
    CONSTRAINT proceso_instancia_orden_check CHECK (orden > 0),
    CONSTRAINT proceso_instancia_origen_coherente_check CHECK (
        (tipo_origen = 'caso' AND codigo_reporte IS NULL AND alerta_id IS NULL)
     OR (tipo_origen = 'reporte' AND caso_id IS NULL AND codigo_caso_legado IS NULL)
    ),
    CONSTRAINT proceso_instancia_fechas_check
        CHECK (finalizado_en IS NULL OR ocurrido_en IS NULL OR finalizado_en >= ocurrido_en),

    -- Clave de idempotencia: la fila fisica del cargador dentro de su tabla de origen.
    CONSTRAINT proceso_instancia_origen_fila_key UNIQUE (tipo_origen, fila_legado),

    CONSTRAINT proceso_instancia_caso_id_fkey
        FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE,
    CONSTRAINT proceso_instancia_alerta_id_fkey
        FOREIGN KEY (alerta_id) REFERENCES core.alertas_tempranas(id),
    CONSTRAINT proceso_instancia_flujo_definicion_id_fkey
        FOREIGN KEY (flujo_definicion_id) REFERENCES core.flujo_definicion(id),
    CONSTRAINT proceso_instancia_estado_id_fkey
        FOREIGN KEY (estado_id) REFERENCES core.flujo_estado(id),
    CONSTRAINT proceso_instancia_usuario_id_fkey
        FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id),
    CONSTRAINT proceso_instancia_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES core.usuarios(id),
    CONSTRAINT proceso_instancia_updated_by_fkey
        FOREIGN KEY (updated_by) REFERENCES core.usuarios(id),
    CONSTRAINT proceso_instancia_nivel_clasificacion_fkey
        FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel)
);

COMMENT ON TABLE core.proceso_instancia IS
    'Paso ejecutado del flujo operativo, sobre un caso, un reporte o una alerta. '
    'Este parche carga 135 filas (fact_proceso_caso 36 + fact_proceso_reporte 99); '
    'el parche 14 añade 83 y la tabla queda en 218.';
COMMENT ON COLUMN core.proceso_instancia.tipo_origen IS
    'Origen del paso: caso, reporte o alerta. Determina que FK esta poblada y de que tabla del legado viene.';
COMMENT ON COLUMN core.proceso_instancia.caso_id IS
    'FK a core.casos cuando el codigo de caso resuelve. Nulo en las 2 filas sin maestro '
    '(CS-PRODUCE-2026-037 y 038, que no existen en core.casos).';
COMMENT ON COLUMN core.proceso_instancia.codigo_caso_legado IS
    'Codigo de caso tal como venia en el legado. Se conserva siempre, resuelva o no, para trazabilidad.';
COMMENT ON COLUMN core.proceso_instancia.alerta_id IS
    'Enlace duro al maestro de alerta cuando codigo_reporte existe en core.alertas_tempranas.codigo_alerta. '
    'Nulo en 27 filas: el enlace es entonces solo textual (codigo_reporte).';
COMMENT ON COLUMN core.proceso_instancia.codigo_reporte IS
    'Codigo de reporte conservado como texto (enlace BLANDO, sin FK). Trae AT-2026-nn cuando el legado '
    'lo trae y PR-nnn cuando el legado solo identifica la fila del reporte.';
COMMENT ON COLUMN core.proceso_instancia.flujo_definicion_id IS
    'Paso del catalogo, resuelto por (tipo_flujo, orden). Nulo en las 9 instancias de reporte con paso '
    '4, 5 o 6, porque legacy.dim_paso_proceso solo define 3 pasos.';
COMMENT ON COLUMN core.proceso_instancia.estado_id IS
    'Estado del paso. Nulo en las 135 filas de este parche (el 14 si lo fija en sus 83): el legado no registra estado por paso. El catalogo '
    'core.flujo_estado se carga completo para cuando el flujo se use en vivo.';
COMMENT ON COLUMN core.proceso_instancia.usuario_id IS
    'FK a core.usuarios resuelta por core.usuarios.codigo_legado. Nula en las 6 filas cuyo responsable '
    'es DEST-01, que no existe como usuario.';
COMMENT ON COLUMN core.proceso_instancia.codigo_responsable_legado IS
    'Responsable tal como venia en el legado (SEC-nn, DEST-01). Se conserva aunque usuario_id resuelva.';
COMMENT ON COLUMN core.proceso_instancia.ocurrido_en IS
    'Fecha y hora del paso. Se interpreta el texto del legado como hora de America/Lima. '
    'Nulo en 1 fila (PR-018), que viene sin fecha de inicio.';
COMMENT ON COLUMN core.proceso_instancia.finalizado_en IS
    'Fecha y hora de fin del paso, cuando el legado la trae (16 filas de reporte).';
COMMENT ON COLUMN core.proceso_instancia.orden IS
    'Numero de paso tal como viene en el legado. Se conserva aunque no exista definicion para el.';
COMMENT ON COLUMN core.proceso_instancia.nota IS
    'Texto libre del paso. En caso viene de c09; en reporte, de c08. Son columnas distintas '
    'porque las dos tablas del cargador no comparten el significado de sus columnas.';
COMMENT ON COLUMN core.proceso_instancia.codigo_legado IS
    'Codigo de la fila de proceso en el legado (PC-nnnn, PR-nnn, PR-AL-nnnn). No es unico: '
    'PR-AL-0021 aparece dos veces con instantes distintos.';
COMMENT ON COLUMN core.proceso_instancia.fila_legado IS
    'fila_n de la tabla legacy de origen. Junto con tipo_origen forma la clave de idempotencia.';

CREATE INDEX IF NOT EXISTS ix_proceso_instancia_caso
    ON core.proceso_instancia (caso_id, ocurrido_en DESC);
CREATE INDEX IF NOT EXISTS ix_proceso_instancia_alerta
    ON core.proceso_instancia (alerta_id) WHERE alerta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_proceso_instancia_flujo
    ON core.proceso_instancia (flujo_definicion_id);

ALTER TABLE core.proceso_instancia ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.proceso_instancia FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_clasificacion ON core.proceso_instancia;
CREATE POLICY p_clasificacion ON core.proceso_instancia
    FOR SELECT USING (nivel_clasificacion <= core.clasificacion_max());

DROP POLICY IF EXISTS p_insert ON core.proceso_instancia;
CREATE POLICY p_insert ON core.proceso_instancia
    FOR INSERT WITH CHECK (
        core.clasificacion_max() >= 2
        AND nivel_clasificacion <= core.clasificacion_max());

DROP POLICY IF EXISTS p_update ON core.proceso_instancia;
CREATE POLICY p_update ON core.proceso_instancia
    FOR UPDATE USING (
        core.clasificacion_max() >= 2
        AND nivel_clasificacion <= core.clasificacion_max())
    WITH CHECK (nivel_clasificacion <= core.clasificacion_max());

DROP POLICY IF EXISTS p_delete ON core.proceso_instancia;
CREATE POLICY p_delete ON core.proceso_instancia
    FOR DELETE USING (
        core.clasificacion_max() >= 3
        AND nivel_clasificacion <= core.clasificacion_max());

DROP TRIGGER IF EXISTS trg_audit ON core.proceso_instancia;
CREATE TRIGGER trg_audit BEFORE INSERT OR UPDATE ON core.proceso_instancia
    FOR EACH ROW EXECUTE FUNCTION core.set_audit();


-- =============================================================================
-- 3. CARGA DE CATALOGOS (5 + 7 = 12 filas)
-- =============================================================================

-- 3.1 Estados. Esperado 5 filas.
INSERT INTO core.flujo_estado (codigo, nombre, color_hex, es_final)
SELECT btrim(c01),
       btrim(c02),
       btrim(c03),
       (btrim(c04) = 'Si')
FROM legacy.dim_estado_proceso
WHERE c01 IS NOT NULL AND btrim(c01) <> ''
ON CONFLICT (codigo) DO UPDATE
   SET nombre     = EXCLUDED.nombre,
       color_hex  = EXCLUDED.color_hex,
       es_final   = EXCLUDED.es_final,
       updated_at = now();

-- 3.2 Pasos. Esperado 7 filas (3 de reporte + 4 de caso).
--     dim_paso_proceso:      c01 orden, c02 nombre, c03 estado, c04 rol. Sin descripcion.
--     dim_paso_proceso_caso: lo mismo, y c06 es la descripcion del paso.
INSERT INTO core.flujo_definicion
    (tipo_flujo, orden, nombre, estado_resultante, rol_responsable, descripcion, codigo_legado)
SELECT 'reporte',
       btrim(c01)::smallint,
       btrim(c02),
       btrim(c03),
       NULLIF(btrim(c04), ''),
       NULL,
       'DPP-' || btrim(c01)
FROM legacy.dim_paso_proceso
WHERE c01 IS NOT NULL AND btrim(c01) <> ''
UNION ALL
SELECT 'caso',
       btrim(c01)::smallint,
       btrim(c02),
       btrim(c03),
       NULLIF(btrim(c04), ''),
       NULLIF(btrim(c06), ''),
       'DPPC-' || btrim(c01)
FROM legacy.dim_paso_proceso_caso
WHERE c01 IS NOT NULL AND btrim(c01) <> ''
ON CONFLICT (codigo_legado) DO UPDATE
   SET tipo_flujo        = EXCLUDED.tipo_flujo,
       orden             = EXCLUDED.orden,
       nombre            = EXCLUDED.nombre,
       estado_resultante = EXCLUDED.estado_resultante,
       rol_responsable   = EXCLUDED.rol_responsable,
       descripcion       = EXCLUDED.descripcion,
       updated_at        = now();


-- =============================================================================
-- 4. CARGA DE INSTANCIAS - CASOS (36 filas)
--
--    Mapeo columna a columna:
--      c01 PC-nnnn         -> codigo_legado
--      c02 CS-PRODUCE-nnn  -> codigo_caso_legado, y caso_id si resuelve
--      c03 n               -> orden, y flujo_definicion_id por (caso, orden)
--      c04 SEC-nn          -> codigo_responsable_legado, y usuario_id si resuelve
--      c05 fecha           -> ocurrido_en
--      c06 (vacio)         -> finalizado_en (NULL en las 36)
--      c07 '0'             -> sin destino: constante sin semantica evidenciada
--      c08 '1'             -> sin destino: constante sin semantica evidenciada
--      c09 texto           -> nota
--      fila_n              -> fila_legado
-- =============================================================================

INSERT INTO core.proceso_instancia
    (tipo_origen, caso_id, codigo_caso_legado, alerta_id, codigo_reporte,
     flujo_definicion_id, estado_id, usuario_id, codigo_responsable_legado,
     ocurrido_en, finalizado_en, orden, nota, codigo_legado, fila_legado)
SELECT 'caso',
       c.id,
       btrim(f.c02),
       NULL,
       NULL,
       fd.id,
       NULL,
       u.id,
       btrim(f.c04),
       NULLIF(btrim(f.c05), '')::timestamp AT TIME ZONE 'America/Lima',
       NULLIF(btrim(f.c06), '')::timestamp AT TIME ZONE 'America/Lima',
       btrim(f.c03)::smallint,
       NULLIF(btrim(f.c09), ''),
       btrim(f.c01),
       f.fila_n::smallint
FROM legacy.fact_proceso_caso f
LEFT JOIN core.casos c
       ON c.codigo_caso = btrim(f.c02)
LEFT JOIN core.usuarios u
       ON u.codigo_legado = btrim(f.c04)
LEFT JOIN core.flujo_definicion fd
       ON fd.tipo_flujo = 'caso'
      AND fd.orden = btrim(f.c03)::smallint
WHERE f.c01 IS NOT NULL AND btrim(f.c01) <> ''
ON CONFLICT ON CONSTRAINT proceso_instancia_origen_fila_key DO UPDATE
   SET caso_id                   = EXCLUDED.caso_id,
       codigo_caso_legado        = EXCLUDED.codigo_caso_legado,
       flujo_definicion_id       = EXCLUDED.flujo_definicion_id,
       usuario_id                = EXCLUDED.usuario_id,
       codigo_responsable_legado = EXCLUDED.codigo_responsable_legado,
       ocurrido_en               = EXCLUDED.ocurrido_en,
       finalizado_en             = EXCLUDED.finalizado_en,
       orden                     = EXCLUDED.orden,
       nota                      = EXCLUDED.nota,
       codigo_legado             = EXCLUDED.codigo_legado;


-- =============================================================================
-- 5. CARGA DE INSTANCIAS - REPORTES (99 filas)
--
--    Mapeo columna a columna:
--      c01 PR-nnn / PR-AL-nnnn -> codigo_legado
--      c02 AT-YYYY-nn          -> codigo_reporte, y alerta_id si resuelve
--          'Alerta Temprana'   -> es el NOMBRE del tipo de reporte (TR-01 en
--                                 dim_tipo_proceso), no un codigo: en esas 18
--                                 filas el codigo de reporte es c01
--      c03 n                   -> orden, y flujo_definicion_id por (reporte, orden)
--      c04 SEC-nn / DEST-01    -> codigo_responsable_legado, y usuario_id si resuelve
--      c05 fecha inicio        -> ocurrido_en
--      c06 fecha fin           -> finalizado_en
--      c07 dias transcurridos  -> sin destino: es c06 - c05, dato derivado
--      c08 texto               -> nota
--      fila_n                  -> fila_legado
-- =============================================================================

INSERT INTO core.proceso_instancia
    (tipo_origen, caso_id, codigo_caso_legado, alerta_id, codigo_reporte,
     flujo_definicion_id, estado_id, usuario_id, codigo_responsable_legado,
     ocurrido_en, finalizado_en, orden, nota, codigo_legado, fila_legado)
SELECT 'reporte',
       NULL,
       NULL,
       a.id,
       CASE WHEN btrim(f.c02) ~ '^AT-[0-9]{4}-[0-9]+$'
            THEN btrim(f.c02)
            ELSE btrim(f.c01)
       END,
       fd.id,
       NULL,
       u.id,
       btrim(f.c04),
       NULLIF(btrim(f.c05), '')::timestamp AT TIME ZONE 'America/Lima',
       NULLIF(btrim(f.c06), '')::timestamp AT TIME ZONE 'America/Lima',
       btrim(f.c03)::smallint,
       NULLIF(btrim(f.c08), ''),
       btrim(f.c01),
       f.fila_n::smallint
FROM legacy.fact_proceso_reporte f
LEFT JOIN core.alertas_tempranas a
       ON a.codigo_alerta = btrim(f.c02)
LEFT JOIN core.usuarios u
       ON u.codigo_legado = btrim(f.c04)
LEFT JOIN core.flujo_definicion fd
       ON fd.tipo_flujo = 'reporte'
      AND fd.orden = btrim(f.c03)::smallint
WHERE f.c01 IS NOT NULL AND btrim(f.c01) <> ''
ON CONFLICT (tipo_origen, fila_legado) DO UPDATE
   SET alerta_id                 = EXCLUDED.alerta_id,
       codigo_reporte            = EXCLUDED.codigo_reporte,
       flujo_definicion_id       = EXCLUDED.flujo_definicion_id,
       usuario_id                = EXCLUDED.usuario_id,
       codigo_responsable_legado = EXCLUDED.codigo_responsable_legado,
       ocurrido_en               = EXCLUDED.ocurrido_en,
       finalizado_en             = EXCLUDED.finalizado_en,
       orden                     = EXCLUDED.orden,
       nota                      = EXCLUDED.nota,
       codigo_legado             = EXCLUDED.codigo_legado;

COMMIT;


-- =============================================================================
-- 6. VERIFICACION POSTERIOR
-- =============================================================================

-- ATENCION: estas cifras son las de INMEDIATAMENTE DESPUES de este parche. El
-- parche 14 añade 83 instancias y 4 pasos, asi que sobre el esquema completo
-- son 11 / 5 / 218 (155 con estado_id, 63 sin el). Si se verifica despues del
-- 14, los SELECT de este bloque no dan lo que dicen.
--
-- 6.1 Conteos duros, los de este parche. Esperado: 7 / 5 / 135.
SELECT (SELECT count(*) FROM core.flujo_definicion)   AS pasos,
       (SELECT count(*) FROM core.flujo_estado)       AS estados,
       (SELECT count(*) FROM core.proceso_instancia)  AS instancias;

-- 6.2 Reparto por origen. Esperado: caso 36, reporte 99.
SELECT tipo_origen, count(*) AS filas
FROM core.proceso_instancia
GROUP BY tipo_origen
ORDER BY 1;

-- 6.3 Resolucion de casos. Esperado: 36 total, 34 con caso, 2 sin caso.
SELECT count(*)                              AS total,
       count(caso_id)                        AS con_caso,
       count(*) FILTER (WHERE caso_id IS NULL) AS sin_caso
FROM core.proceso_instancia
WHERE tipo_origen = 'caso';

-- 6.4 Las filas de caso que no resolvieron, con su codigo conservado.
SELECT codigo_legado, codigo_caso_legado, ocurrido_en
FROM core.proceso_instancia
WHERE tipo_origen = 'caso' AND caso_id IS NULL
ORDER BY fila_legado;

-- 6.5 Reportes: codigo siempre presente, enlace duro cuando hay maestro.
--     Esperado: 99 filas, 99 con codigo, 72 con alerta, 27 con enlace blando.
SELECT count(*)                                  AS filas,
       count(codigo_reporte)                     AS con_codigo,
       count(alerta_id)                          AS con_alerta,
       count(*) FILTER (WHERE alerta_id IS NULL) AS enlace_blando
FROM core.proceso_instancia
WHERE tipo_origen = 'reporte';

-- 6.6 Reportes sin maestro, por codigo conservado. Esperado 26 grupos, 27 filas.
SELECT codigo_reporte, count(*) AS filas
FROM core.proceso_instancia
WHERE tipo_origen = 'reporte' AND alerta_id IS NULL
GROUP BY codigo_reporte
ORDER BY 1;

-- 6.7 Resolucion de responsables. Esperado: caso 36/36, reporte 93/99.
SELECT tipo_origen,
       count(*)                                   AS filas,
       count(usuario_id)                          AS con_usuario,
       count(*) FILTER (WHERE usuario_id IS NULL) AS sin_usuario
FROM core.proceso_instancia
GROUP BY tipo_origen
ORDER BY 1;

-- 6.8 Normalizacion del paso. Esperado: 126 con definicion, 9 sin definicion.
SELECT tipo_origen,
       count(*)                                             AS filas,
       count(flujo_definicion_id)                           AS con_definicion,
       count(*) FILTER (WHERE flujo_definicion_id IS NULL)  AS sin_definicion
FROM core.proceso_instancia
GROUP BY tipo_origen
ORDER BY 1;

-- 6.9 Los pasos sin definicion. Esperado: paso 5 -> 3, paso 6 -> 3, paso 4 -> 3.
SELECT orden, count(*) AS filas
FROM core.proceso_instancia
WHERE flujo_definicion_id IS NULL
GROUP BY orden
ORDER BY orden;

-- 6.10 Estado por paso. Esperado: 135 filas, 0 con estado.
SELECT count(*) AS filas, count(estado_id) AS con_estado
FROM core.proceso_instancia;

-- 6.11 Fechas de reporte. Esperado: 99 filas, 98 con inicio, 16 con fin, 0 incoherentes.
SELECT count(*)                                           AS filas,
       count(ocurrido_en)                                 AS con_inicio,
       count(finalizado_en)                               AS con_fin,
       count(*) FILTER (WHERE ocurrido_en > finalizado_en) AS incoherentes
FROM core.proceso_instancia
WHERE tipo_origen = 'reporte';

-- 6.12 Catalogos cargados. Esperado 7 filas de pasos.
SELECT tipo_flujo, orden, nombre, estado_resultante, rol_responsable, codigo_legado
FROM core.flujo_definicion
ORDER BY tipo_flujo, orden;

-- 6.13 Estados cargados. Esperado 5 filas.
SELECT codigo, nombre, color_hex, es_final
FROM core.flujo_estado
ORDER BY codigo;

-- 6.14 RLS y auditoria. Esperado: 4 politicas, RLS y FORCE activos, 1 trigger.
SELECT c.relrowsecurity      AS rls,
       c.relforcerowsecurity AS rls_force,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'core'
           AND p.tablename = 'proceso_instancia')     AS politicas,
       (SELECT count(*) FROM pg_trigger t
         WHERE t.tgrelid = 'core.proceso_instancia'::regclass
           AND NOT t.tgisinternal)                    AS triggers
FROM pg_class c
WHERE c.oid = 'core.proceso_instancia'::regclass;

-- 6.15 Ninguna instancia duplicada. Esperado: 0.
SELECT count(*) AS duplicadas
FROM (
    SELECT tipo_origen, fila_legado
    FROM core.proceso_instancia
    GROUP BY 1, 2
    HAVING count(*) > 1
) d;

-- 6.16 Cuadre contra el legado: cada fila de origen tiene su instancia.
--      Esperado: 36 / 36 y 99 / 99.
SELECT
    (SELECT count(*) FROM legacy.fact_proceso_caso)    AS legado_caso,
    (SELECT count(*) FROM core.proceso_instancia WHERE tipo_origen = 'caso') AS cargado_caso,
    (SELECT count(*) FROM legacy.fact_proceso_reporte) AS legado_reporte,
    (SELECT count(*) FROM core.proceso_instancia WHERE tipo_origen = 'reporte') AS cargado_reporte;


-- =============================================================================
-- 7. PRUEBA DE DOBLE EJECUCION
--    Volver a correr el archivo completo (secciones 3 a 5) debe dejar los mismos
--    conteos: 7 / 5 / 135. Comprobacion:
--      SELECT (SELECT count(*) FROM core.flujo_definicion),
--             (SELECT count(*) FROM core.flujo_estado),
--             (SELECT count(*) FROM core.proceso_instancia);
--    Esperado: 7 | 5 | 135
-- =============================================================================


-- =============================================================================
-- 8. ROLLBACK (ejecutar solo si la seccion 6 no cuadra)
-- =============================================================================
--
-- BEGIN;
--   DROP TABLE IF EXISTS core.proceso_instancia;
--   DROP TABLE IF EXISTS core.flujo_definicion;
--   DROP TABLE IF EXISTS core.flujo_estado;
-- COMMIT;
--
-- Es aditivo: no se modifico ninguna tabla previa, asi que el rollback no toca
-- core.casos, core.usuarios, core.alertas_tempranas, analisis.* ni config.*.


-- =============================================================================
-- 9. LO QUE ESTE PARCHE DEJA PENDIENTE (a proposito)
-- =============================================================================
--
-- a) Pasos 4, 5 y 6 del flujo de reporte. legacy.dim_paso_proceso solo define
--    Elaboracion, Remision y Archivo, pero las 18 filas de PR-001..PR-018 usan
--    seis pasos. 9 instancias quedan con flujo_definicion_id nulo y conservan su
--    numero de paso. Falta que OAIPCS dicte nombre, estado y responsable de los
--    pasos 4 a 6. No se inventan.
-- b) estado_id queda nulo en las 135 filas: ninguna columna del legado registra el
--    estado del paso. Derivarlo (por ejemplo, c06 presente = Completado) seria una
--    regla nueva, no una migracion, y por eso no se aplica aqui.
-- c) 2 casos sin maestro (CS-PRODUCE-2026-037 y 038): el legado los referencia y
--    core.casos solo llega a 035. Hay que decidir si se crean o se descartan.
-- d) 27 reportes con enlace solo textual: 18 filas del bloque PR-001..PR-018, que
--    no tienen maestro, y 9 filas de 8 codigos AT sin alerta en
--    core.alertas_tempranas (AT-2026-19 aparece dos veces; ademas 27, 29, 31,
--    33, 34, 35 y 39).
-- e) DEST-01 no existe en core.usuarios: 6 instancias de reporte quedan sin
--    usuario_id. Por los datos (destino en remisiones y convocatorias) parece un
--    buzon colectivo (DVPA/Gabinete), no una persona.
