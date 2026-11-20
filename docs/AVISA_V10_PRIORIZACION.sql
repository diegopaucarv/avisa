-- =====================================================================
--  AVISA · PRIORIZACIÓN DEL MVP SOBRE EL MODELO v10
-- =====================================================================
--  QUÉ ES
--  El documento `docs/PRIORIZACION_MVP_v10.md` convertido en tablas. No
--  crea ni altera ninguna tabla del modelo: vive entero en el esquema
--  `priorizacion` y se limita a registrar la medición, las capas y el
--  orden de construcción, para que el orden del backend sea consultable
--  y se pueda comprobar que no se desvía.
--
--  DE DÓNDE SALE
--  · docs/mvp_prioridad_tablas.csv   la medición, una fila por tabla
--  · docs/PRIORIZACION_MVP_v10.md    las capas (§3-§6) y los bloques (§8)
--  · docs/ERS_AVISA_PRODUCE_v0.6.md  el horizonte de cada requisito
--  El CSV manda sobre el texto: si se regenera la medición, se vuelve a
--  ejecutar este archivo y las cifras quedan al día sin tocar el .md.
--
--  CÓMO SE EJECUTA
--  No depende del estado de la base: la medición entra del CSV, no de las
--  tablas del modelo. Se puede ejecutar antes o después de la carga; lo
--  que se compara son las cifras del CSV contra las declaradas.
--
--      psql -U avisa -d avisa -f docs/AVISA_V10_PRIORIZACION.sql
--
--  Se ejecuta con psql, no con otro cliente: usa \copy.
--  La ruta del CSV es relativa a la carpeta desde donde corre psql, porque
--  \copy no acepta variables: si el CSV se mueve, se edita esa línea.
--  Es la carpeta de psql, no la del archivo: se corre desde la raíz del
--  repositorio. Con Docker, el `-w` que cambia de carpeta es el de
--  `docker exec`; el `-w` de psql significa --no-password y no cambia nada.
--
--  QUÉ TOCA
--  Solo el esquema `priorizacion`. Ninguna tabla del modelo se lee por
--  clave ajena ni se modifica: si el esquema se borra, no se pierde nada
--  del sistema. Aquí no hay ningún DROP ni TRUNCATE fuera de `priorizacion`.
--  Si una versión anterior de este archivo dejó tablas con otra forma,
--  CREATE TABLE IF NOT EXISTS no las corrige y la carga fallará con la
--  columna que falta: borrar el esquema es una decisión humana
--  (DROP SCHEMA priorizacion CASCADE), no algo que el archivo haga solo.
--
--  POR QUÉ NO ESTÁ EN LA BASE
--  Es un artefacto de consulta, no una capa del sistema: no lo monta
--  `compose.yaml`, no lo aplica el `initdb` y no se ejecuta por defecto.
--  Por eso tampoco aparece en `docs/DICCIONARIO_DATOS.md`, que se genera
--  desde la base viva: su ausencia ahí es correcta, no un olvido.
--
--  PROPIEDADES
--  Idempotente: se puede repetir. La medición se recarga entera desde el
--  CSV, y las semillas se reemplazan sin tocar el resto de la base.
--
--  NOTA DE VIGENCIA
--  Las cifras esperadas se declaran en `priorizacion.capa` y se comparan
--  con la medición en el bloque final. Si alguien añade una tabla a la
--  v10 y no actualiza esta cabecera, el script falla y dice qué capa se
--  desvió. Es a propósito: un plan que se desactualiza en silencio no
--  sirve para planificar.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS priorizacion;

COMMENT ON SCHEMA priorizacion IS
    'Plan de construcción del MVP sobre la v10: capas, bloques y medición. '
    'Se genera desde docs/mvp_prioridad_tablas.csv y docs/PRIORIZACION_MVP_v10.md. '
    'No contiene datos del sistema.';

-- ---------------------------------------------------------------------
-- 1 · Las cinco capas (§1 y §3-§6)
-- ---------------------------------------------------------------------
--  Cada tabla cae en una sola capa. `tablas_esperadas` es lo que el
--  documento afirma; la medición se compara contra ello al final.
CREATE TABLE IF NOT EXISTS priorizacion.capa (
    codigo             varchar(2) PRIMARY KEY,
    significado        text    NOT NULL,
    criterio           text    NOT NULL,
    tablas_esperadas   integer NOT NULL CHECK (tablas_esperadas >= 0),
    columnas_esperadas integer NOT NULL CHECK (columnas_esperadas >= 0),
    filas_esperadas    bigint  NOT NULL CHECK (filas_esperadas >= 0)
);

COMMENT ON TABLE priorizacion.capa IS
    'Las cinco capas de PRIORIZACION §1. T0 lo que ya vive, T1 lo que el MVP '
    'pide y está vacío, T2 lo vivo que el MVP no pidió, T3 vacío pero '
    'enganchado, T4 vacío y dormido.';

INSERT INTO priorizacion.capa AS c
    (codigo, significado, criterio, tablas_esperadas, columnas_esperadas, filas_esperadas)
VALUES
    ('T0', 'El MVP la exige y ya tiene datos o cargador',
     'está en el contrato MVP-45 y tiene filas o una fase del cargador',  34, 364, 8379),
    ('T1', 'El MVP la exige y todavía está vacía',
     'está en el contrato MVP-45 y no tiene filas',                       12,  99,    0),
    ('T2', 'No la pide el MVP, pero está viva',
     'fuera del contrato y tiene filas o cargador; se hereda',            76, 542, 4973),
    ('T3', 'Vacía, pero algo vivo la usa',
     'sin filas y con un disparador o una clave ajena viva apuntándole',  22, 226,    0),
    ('T4', 'Vacía y sin nada vivo que la toque',
     'sin filas y sin consumidor; es el alcance de año 2',               121, 914,    0)
ON CONFLICT (codigo) DO UPDATE SET
    significado        = EXCLUDED.significado,
    criterio           = EXCLUDED.criterio,
    tablas_esperadas   = EXCLUDED.tablas_esperadas,
    columnas_esperadas = EXCLUDED.columnas_esperadas,
    filas_esperadas    = EXCLUDED.filas_esperadas;

-- ---------------------------------------------------------------------
-- 2 · Los seis bloques (§8)
-- ---------------------------------------------------------------------
--  `criterio_cierre` es la frase con la que el documento cierra cada
--  bloque: si no se cumple, el siguiente no se abre.
--
--  ADVERTENCIA ABIERTA: estos bloques suman 45 días, que es el calendario
--  del MVP-45. El ERS fija el plazo real en 20 días (C-02 y §18) y no
--  existe todavía un reparto de esos 20 días por bloque (H-63). Si el
--  plazo del ERS es el que manda, hay que reescalar `dia_inicio`/`dia_fin`
--  y este comentario sobra.
CREATE TABLE IF NOT EXISTS priorizacion.bloque (
    numero          integer  PRIMARY KEY,
    nombre          text     NOT NULL,
    dia_inicio      smallint NOT NULL,
    dia_fin         smallint NOT NULL,
    criterio_cierre text     NOT NULL,
    CONSTRAINT bloque_dia_inicio_positivo CHECK (dia_inicio >= 1),
    CONSTRAINT bloque_dias_coherentes CHECK (dia_fin >= dia_inicio)
);

COMMENT ON TABLE priorizacion.bloque IS
    'Los seis bloques de construcción de PRIORIZACION §8, con sus días y su '
    'criterio de cierre.';

INSERT INTO priorizacion.bloque AS b
    (numero, nombre, dia_inicio, dia_fin, criterio_cierre)
VALUES
    (1, 'Catálogos y seguridad',  1,  7,
     'Dos perfiles distintos consultan la misma tabla y ven cosas distintas (RLS probado), y cada catálogo tiene sus filas semilla.'),
    (2, 'Identidad del actor',    8, 15,
     'Un actor sin DNI se registra, se promueve de nivel y se fusiona con otro sin perder historial.'),
    (3, 'Caso y evidencia',      16, 22,
     'La ficha de un caso muestra su línea de tiempo con fuente por hecho, y nadie puede leer una fila de un caso que no le corresponde.'),
    (4, 'Acuerdos y alertas',    23, 30,
     'Una alerta nace como candidata, un humano la aprueba o la descarta con motivo, y el compromiso queda con su hito y su responsable.'),
    (5, 'Análisis y lectura ejecutiva', 31, 38,
     'El informe OE1–OE3 sale con cada afirmación enlazada a una cita verificable, y el tablero del Ministro carga en menos de dos minutos de lectura.'),
    (6, 'Auditoría, ingesta e IA', 39, 45,
     'Toda exportación deja hash y destinatario, y un incidente abre el reloj de 48 horas con sus dos notificaciones.')
ON CONFLICT (numero) DO UPDATE SET
    nombre          = EXCLUDED.nombre,
    dia_inicio      = EXCLUDED.dia_inicio,
    dia_fin         = EXCLUDED.dia_fin,
    criterio_cierre = EXCLUDED.criterio_cierre;

-- ---------------------------------------------------------------------
-- 3 · Los endpoints que cada bloque promete
-- ---------------------------------------------------------------------
--  `horizonte_ers` es el horizonte que el ERS da al requisito que cubre
--  el endpoint, y sirve para delatar promesas de diciembre que el ERS
--  sitúa en 2027 o en MADRE. NULL = no se localizó requisito.
CREATE TABLE IF NOT EXISTS priorizacion.bloque_endpoint (
    bloque        integer NOT NULL REFERENCES priorizacion.bloque(numero) ON DELETE CASCADE,
    ruta          text    NOT NULL,
    metodos       text    NOT NULL,
    horizonte_ers text    CHECK (horizonte_ers IN ('MVP', '2027', 'MADRE')),
    requisito     text,
    PRIMARY KEY (bloque, ruta)
);

COMMENT ON TABLE priorizacion.bloque_endpoint IS
    'Endpoints que PRIORIZACION §8 asigna a cada bloque, con el horizonte que '
    'el ERS da al requisito correspondiente. Vive aquí para que las promesas '
    'de diciembre se puedan confrontar con el ERS.';

DELETE FROM priorizacion.bloque_endpoint;

INSERT INTO priorizacion.bloque_endpoint AS e
    (bloque, ruta, metodos, horizonte_ers, requisito)
VALUES
    (2, '/actores',                'GET, POST, PATCH', 'MVP',   'RF-B01 a RF-B05'),
    (2, '/actores/{id}/promover',  'POST',             'MVP',   'RF-B02'),
    (2, '/actores/fusionar',       'POST',             'MVP',   'RF-B04'),
    (3, '/casos',                  'GET',              'MVP',   'RF-F01 a RF-F05'),
    (3, '/casos/{id}/hechos',      'GET',            'MADRE', 'RF-H03 / CU-25: línea de tiempo de hechos y normas (Could, MADRE); hoy la cronología es insumo diario del analista'),
    (3, '/casos/{id}/red',         'GET',              '2027',  'RF-H01 y CU-24: el diagrama interactivo de la red es 2027'),
    (4, '/ingesta/alertas',        'POST',             'MVP',   'RF-D01'),
    (4, '/alertas/{id}/aprobar',   'POST',             'MVP',   'RF-D04 (HU-04)'),
    (4, '/alertas/{id}/descartar', 'POST',             'MVP',   'RF-D04 (HU-04)'),
    (5, '/simulaciones',           'POST',            'MADRE', 'RF-J04 está en Won''t / MADRE: el simulador no es MVP'),
    (5, '/casos/{id}/analogos',    'GET',               NULL,   'sin requisito localizado en el ERS'),
    (5, '/ejecutivo/kpis',         'GET',              'MVP',   'tablero de Alta Dirección (§7.2)'),
    (5, '/informes/generar',       'POST',            '2027',  'RF-G04 (resumen de una página) es 2027; el MVP solo tiene RF-G01 (plantilla) y RF-G03 (envío)')
ON CONFLICT (bloque, ruta) DO UPDATE SET
    metodos       = EXCLUDED.metodos,
    horizonte_ers = EXCLUDED.horizonte_ers,
    requisito     = EXCLUDED.requisito;

-- ---------------------------------------------------------------------
-- 4 · La medición (§2)
-- ---------------------------------------------------------------------
--  Copia literal de docs/mvp_prioridad_tablas.csv. Se recarga entera en
--  cada ejecución: el CSV es la fuente, esta tabla es su reflejo.
CREATE TABLE IF NOT EXISTS priorizacion.medicion (
    capa                varchar(2) NOT NULL REFERENCES priorizacion.capa(codigo),
    esquema             text       NOT NULL,
    tabla               text       NOT NULL,
    columnas            integer    NOT NULL,
    filas               bigint     NOT NULL,
    fk_entrantes        integer    NOT NULL,
    fk_entrantes_vivas  integer    NOT NULL,
    fk_salientes        integer    NOT NULL,
    rls                 boolean    NOT NULL,
    triggers            integer    NOT NULL,
    codigo_legado       boolean    NOT NULL,
    cargador            boolean    NOT NULL,
    refs_codigo         integer    NOT NULL,
    motivo              text,
    causa               text,
    PRIMARY KEY (esquema, tabla)
);

COMMENT ON TABLE priorizacion.medicion IS
    'Una fila por tabla de la v10, con la capa y la causa que la clasifican. '
    'Copia de docs/mvp_prioridad_tablas.csv (265 filas).';
COMMENT ON COLUMN priorizacion.medicion.causa IS
    'Qué señal decidió la capa: referencia_viva, referencia_viva+trigger, trigger, codigo o nada.';
COMMENT ON COLUMN priorizacion.medicion.fk_entrantes_vivas IS
    'Claves ajenas que le apuntan desde tablas con filas. Es la diferencia entre T3 y T4.';

-- ---------------------------------------------------------------------
-- 5 · Qué tabla entra en qué bloque
-- ---------------------------------------------------------------------
--  Solo tablas que ya existen. Los objetos que hay que crear van en
--  `objeto_nuevo`: así una tabla del plan no puede ser a la vez algo que
--  ya está y algo por hacer.
CREATE TABLE IF NOT EXISTS priorizacion.bloque_tabla (
    bloque  integer NOT NULL REFERENCES priorizacion.bloque(numero) ON DELETE CASCADE,
    esquema text    NOT NULL,
    tabla   text    NOT NULL,
    nota    text,
    PRIMARY KEY (bloque, esquema, tabla),
    CONSTRAINT bloque_tabla_una_por_tabla UNIQUE (esquema, tabla),
    FOREIGN KEY (esquema, tabla)
        REFERENCES priorizacion.medicion(esquema, tabla) ON DELETE CASCADE
);

COMMENT ON TABLE priorizacion.bloque_tabla IS
    'Tablas existentes que PRIORIZACION §8 asigna a cada bloque: 51 filas, de '
    'las que 46 son del contrato (34 T0 y 12 T1, sin ninguna huérfana) y 5 se '
    'heredan (3 T2 y 2 T4), nombradas porque el bloque las usa, no porque sean '
    'alcance del MVP.';

-- ---------------------------------------------------------------------
-- 6 · Los 8 objetos que hay que crear, y los 4 parciales (§7)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS priorizacion.objeto_nuevo (
    esquema  text    NOT NULL,
    tabla    text    NOT NULL,
    bloque   integer REFERENCES priorizacion.bloque(numero) ON DELETE SET NULL,
    criterio text    NOT NULL CHECK (criterio IN ('cumplimiento', 'seguridad', 'funcionalidad')),
    por_que  text    NOT NULL,
    PRIMARY KEY (esquema, tabla)
);

COMMENT ON TABLE priorizacion.objeto_nuevo IS
    'Los 8 objetos del contrato MVP-45 que no existen en ninguna forma '
    '(PRIORIZACION §7). Cinco son de cumplimiento o de seguridad: sin ellos '
    'el MVP no cumple la ley.';

DELETE FROM priorizacion.objeto_nuevo;

INSERT INTO priorizacion.objeto_nuevo AS o
    (esquema, tabla, bloque, criterio, por_que)
VALUES
    ('seg',      'usuario_actor_externo', 1, 'seguridad',     'qué usuario externo ve qué actor (perfil C)'),
    ('seg',      'usuario_caso',          1, 'seguridad',     'qué usuario ve qué caso'),
    ('core',     'actor_consentimiento',  2, 'cumplimiento',  'consentimiento por finalidad (DC-03 a DC-07)'),
    ('core',     'alerta_fuente',         3, 'funcionalidad', 'vínculo alerta -> fuente que la disparó; se define en el bloque 3 y se usa en el 4'),
    ('analisis', 'caso_analogo',          5, 'funcionalidad', 'casos parecidos para el análisis; forecast.whatif_scenarios se previó y no se creó'),
    ('analisis', 'calidad_fuente',        5, 'funcionalidad', 'calidad de la información: vacíos, sesgos y caducidad'),
    ('audit',    'exportacion',           6, 'seguridad',     'cada salida del perímetro, con hash y destinatario'),
    ('audit',    'incidente_seguridad',   6, 'cumplimiento',  'reloj de las 48 horas ante incidentes')
ON CONFLICT (esquema, tabla) DO UPDATE SET
    bloque   = EXCLUDED.bloque,
    criterio = EXCLUDED.criterio,
    por_que  = EXCLUDED.por_que;

-- De los 17 objetos parciales, el documento nombra cuatro. El resto se
-- cuenta en `puente` pero no se detalla aquí a propósito: la
-- correspondencia fina está en el Anexo D.2 de AVISA_PRODUCE_v10.md y
-- varias filas son ambiguas.
CREATE TABLE IF NOT EXISTS priorizacion.objeto_parcial (
    objeto_mvp text NOT NULL PRIMARY KEY,
    esquema    text NOT NULL,
    tabla      text NOT NULL,
    que_falta  text NOT NULL,
    FOREIGN KEY (esquema, tabla)
        REFERENCES priorizacion.medicion(esquema, tabla) ON DELETE RESTRICT
);

COMMENT ON TABLE priorizacion.objeto_parcial IS
    'Los 4 objetos parciales que PRIORIZACION §7 nombra por su nombre: el MVP '
    'tiene algo parecido y falta una pieza concreta.';


-- ---------------------------------------------------------------------
-- 7 · El puente de los 55 objetos del contrato (§7)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS priorizacion.puente (
    orden     smallint PRIMARY KEY,
    categoria text     NOT NULL,
    objetos   integer  NOT NULL CHECK (objetos >= 0),
    nota      text     NOT NULL
);

COMMENT ON TABLE priorizacion.puente IS
    'Cómo se reparten los 55 objetos del contrato MVP-45: 30 exactos, 17 '
    'parciales y 8 por crear. Solo los 8 y cuatro de los 17 están detallados.';

INSERT INTO priorizacion.puente AS p (orden, categoria, objetos, nota)
VALUES
    (1, 'exacta',  30, 'la tabla del MVP se usa tal cual'),
    (2, 'parcial', 17, 'existe algo que cubre parte, o con otro nombre; solo 4 están detallados en objeto_parcial'),
    (3, 'crear',    8, 'no existe en ninguna forma; detallados en objeto_nuevo')
ON CONFLICT (orden) DO UPDATE SET
    categoria = EXCLUDED.categoria,
    objetos   = EXCLUDED.objetos,
    nota      = EXCLUDED.nota;

-- ---------------------------------------------------------------------
-- 8 · Carga de la medición y reparto por bloque
-- ---------------------------------------------------------------------
--  El orden importa: `bloque_tabla` apunta a `medicion`, así que la
--  medición entra antes. Las tablas derivadas se vacían y se rehacen en
--  cada ejecución, para que un cambio en el CSV no deje restos de la
--  corrida anterior.
-- Se vacían una por una, sin CASCADE: un CASCADE arrastraría también
-- cualquier tabla de otro esquema que algún día apunte a `medicion`.
TRUNCATE priorizacion.medicion, priorizacion.bloque_tabla,
         priorizacion.objeto_parcial;

\copy priorizacion.medicion (capa, esquema, tabla, columnas, filas, fk_entrantes, fk_entrantes_vivas, fk_salientes, rls, triggers, codigo_legado, cargador, refs_codigo, motivo, causa) FROM 'docs/mvp_prioridad_tablas.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8');

-- Verificación temprana: si el CSV y las capas declaradas no cuadran,
-- conviene saberlo antes de sembrar el reparto por bloques (que apunta a
-- la medición por clave ajena y fallaría con un mensaje opaco).
DO $guard$
DECLARE
    v integer;
    e integer;
BEGIN
    SELECT count(*) INTO v FROM priorizacion.medicion;
    SELECT coalesce(sum(tablas_esperadas), 0) INTO e FROM priorizacion.capa;
    IF v = 0 THEN
        RAISE EXCEPTION 'priorización: el CSV no cargó ninguna fila. Ejecutar psql desde la raíz del repositorio: la ruta docs/mvp_prioridad_tablas.csv es relativa al directorio actual.';
    END IF;
    IF v <> e THEN
        RAISE EXCEPTION
        'priorización: el CSV trae % tablas y las capas declaran %. Regenerar docs/mvp_prioridad_tablas.csv y actualizar priorizacion.capa.',
            v, e;
    END IF;
END $guard$;


-- Bloque 1 · catálogos y seguridad (17 tablas T0)
INSERT INTO priorizacion.bloque_tabla (bloque, esquema, tabla, nota) VALUES
    (1, 'core',  'cat_clasificacion',        NULL),
    (1, 'core',  'cat_niveles_conflicto',    NULL),
    (1, 'core',  'cat_niveles_riesgo',       NULL),
    (1, 'core',  'cat_estados_caso',         NULL),
    (1, 'core',  'cat_estados_compromiso',   NULL),
    (1, 'core',  'cat_estados_hito',         NULL),
    (1, 'core',  'cat_prioridades_alerta',   NULL),
    (1, 'core',  'cat_tipos_actor',          NULL),
    (1, 'core',  'cat_tipos_hecho',          NULL),
    (1, 'core',  'cat_nivel_identificacion', 'cubre el objeto del MVP de nivel de identificación; 5 filas'),
    (1, 'ref',   'base_legal_tratamiento',   'cubre el objeto del MVP de base legal; 5 filas'),
    (1, 'core',  'usuarios',                 '84 claves ajenas le apuntan: es la base de todo'),
    (1, 'core',  'roles',                    NULL),
    (1, 'core',  'usuario_roles',            NULL),
    (1, 'core',  'log_accesos',              NULL),
    (1, 'core',  'banco_datos_tratamiento',  'creada por el parche 16 con el banco BD-GSCS en estado pendiente'),
    (1, 'audit', 'datos_personales_acceso',  '3 088 filas: quién miró qué dato sensible'),
    -- Bloque 2 · identidad del actor
    (2, 'core',  'actores',                 '1 160 filas'),
    (2, 'core',  'actor_datos_personales',  '847 filas; aquí vive el DNI cifrado'),
    (2, 'core',  'organizaciones',          '224 filas'),
    (2, 'core',  'actor_membresia',         '292 filas'),
    (2, 'core',  'actor_alias',             '143 filas'),
    (2, 'kag',   'aristas',                 '450 filas; el grafo ya se escribe, pero el ERS lo difiere a 2027'),
    (2, 'kag',   'actor_name_history',      'T2: fuera del contrato; es donde vive el historial de nombres que la fusión debe conservar'),
    (2, 'core',  'consulta_reniec',         'T1: vacía; 10 columnas y 4 disparadores ya instalados'),
    (2, 'kag',   'entity_merge_log',        'T1: vacía; deja auditada la fusión de actores'),
    (2, 'qda',   'mapeo_pseudonimo',        'T1: vacía; la seudonimización del corpus QDA'),
    -- Bloque 3 · caso y evidencia
    (3, 'core',  'casos',                   '35 filas'),
    (3, 'core',  'casos_actores',           '60 filas'),
    (3, 'core',  'caso_cronologia',         '80 filas; hoy hace de core.hecho'),
    (3, 'core',  'cronologia_vinculos',     '5 filas'),
    (3, 'core',  'caso_estado_historial',   '35 filas'),
    (3, 'core',  'distritos',               '698 filas; cubre el ubigeo del MVP'),
    (3, 'kag',   'documento_fuente',        '10 filas'),
    (3, 'core',  'documentos',              'T2: 153 filas, fuera del contrato'),
    (3, 'kag',   'documento_fragmento',     'T1: vacía; soporta el parcial core.cita (offset de cita)'),
    -- Bloque 4 · acuerdos y alertas
    (4, 'core',  'compromisos',             '8 filas'),
    (4, 'core',  'hitos_compromiso',        '12 filas'),
    (4, 'core',  'alertas_tempranas',       '83 filas'),
    (4, 'core',  'alertas_actores',         '161 filas'),
    (4, 'core',  'envios_comunicacion',     'T2: 17 filas'),
    (4, 'core',  'compromiso_colaboradores', 'T1: vacía'),
    (4, 'core',  'reunion_participantes',    'T1: vacía'),
    (4, 'core',  'permiso_aprobacion',       'T1: vacía'),
    -- Bloque 5 · análisis y lectura ejecutiva
    (5, 'policy', 'escenario_regla',        'T1: vacía'),
    (5, 'core',   'output_contracts',       'T1: vacía'),
    (5, 'core',   'riesgo_social_ordinal',  'T4: hay que poblarla desde cero (K1 y K5)'),
    (5, 'policy', 'snapshot',               'T4: hay que poblarla desde cero'),
    (5, 'ind',    'resultado',              'T1: vacía; el resultado calculado por variante, distrito y periodo'),
    -- Bloque 6 · auditoría, ingesta e IA
    (6, 'agent',   'run_log',               'T1: vacía; particionada en 6'),
    (6, 'staging', 'lote',                  'T1: vacía')
ON CONFLICT (bloque, esquema, tabla) DO UPDATE SET nota = EXCLUDED.nota;

-- Los parciales se insertan después de cargar la medición: su clave aje-
-- na apunta a `medicion`, que en la sección 6 todavía está vacía.
INSERT INTO priorizacion.objeto_parcial AS p
    (objeto_mvp, esquema, tabla, que_falta)
VALUES
    ('core.hecho',               'core', 'caso_cronologia',       'el hecho como entidad con tipo propio'),
    ('core.cita',                'kag',  'documento_fragmento',   'offset_inicio y offset_fin para citar exacto'),
    ('core.padron_asistencia',   'core', 'reunion_participantes', 'el padrón de una asamblea, no solo de reunión'),
    ('core.alerta_destinatario', 'core', 'alertas_actores',       'el destinatario externo, no solo el actor')
ON CONFLICT (objeto_mvp) DO UPDATE SET
    esquema   = EXCLUDED.esquema,
    tabla     = EXCLUDED.tabla,
    que_falta = EXCLUDED.que_falta;

-- ---------------------------------------------------------------------
-- 9 · Vistas de consulta
-- ---------------------------------------------------------------------
--  Lo que el documento afirma frente a lo que la base mide, capa por capa.
CREATE OR REPLACE VIEW priorizacion.v_capa_resumen AS
SELECT c.codigo,
       c.significado,
       c.tablas_esperadas,
       count(m.tabla)                                      AS tablas_medidas,
       count(m.tabla) - c.tablas_esperadas                  AS delta_tablas,
       c.columnas_esperadas,
       coalesce(sum(m.columnas), 0)                         AS columnas_medidas,
       coalesce(sum(m.columnas), 0) - c.columnas_esperadas  AS delta_columnas,
       c.filas_esperadas,
       coalesce(sum(m.filas), 0)                            AS filas_medidas,
       coalesce(sum(m.filas), 0) - c.filas_esperadas        AS delta_filas
  FROM priorizacion.capa c
  LEFT JOIN priorizacion.medicion m ON m.capa = c.codigo
 GROUP BY c.codigo, c.significado, c.tablas_esperadas, c.columnas_esperadas,
          c.filas_esperadas
 ORDER BY c.codigo;

COMMENT ON VIEW priorizacion.v_capa_resumen IS
    'Tablas, columnas y filas medidas contra las declaradas, por capa. Un '
    'delta distinto de cero es un documento desactualizado.';

-- El reparto de T2 por esquema: es la tabla de §5, y donde se cuela un
-- error de conteo cuando entra una tabla nueva.
CREATE OR REPLACE VIEW priorizacion.v_heredadas AS
SELECT m.esquema,
       count(*)        AS tablas,
       sum(m.columnas) AS columnas,
       sum(m.filas)    AS filas
  FROM priorizacion.medicion m
 WHERE m.capa = 'T2'
 GROUP BY m.esquema
 ORDER BY 2 DESC, 1;

COMMENT ON VIEW priorizacion.v_heredadas IS
    'Tablas T2 por esquema, con columnas y filas. Es lo que PRIORIZACION §5 '
    'presenta como lo vivo que el MVP no pidió.';

-- El orden de construcción completo: lo que existe y lo que hay que crear.
CREATE OR REPLACE VIEW priorizacion.v_orden_construccion AS
SELECT b.numero                       AS bloque,
       b.dia_inicio,
       b.dia_fin,
       bt.esquema || '.' || bt.tabla  AS objeto,
       m.capa,
       m.columnas,
       m.filas,
       m.rls,
       false                          AS hay_que_crearlo,
       bt.nota
  FROM priorizacion.bloque b
  JOIN priorizacion.bloque_tabla bt ON bt.bloque = b.numero
  JOIN priorizacion.medicion m ON m.esquema = bt.esquema AND m.tabla = bt.tabla
UNION ALL
SELECT b.numero,
       b.dia_inicio,
       b.dia_fin,
       o.esquema || '.' || o.tabla,
       NULL::varchar(2),
       NULL::integer,
       NULL::bigint,
       NULL::boolean,
       true,
       o.por_que
  FROM priorizacion.bloque b
  JOIN priorizacion.objeto_nuevo o ON o.bloque = b.numero
 ORDER BY bloque, hay_que_crearlo, objeto;

COMMENT ON VIEW priorizacion.v_orden_construccion IS
    'El plan de PRIORIZACION §8 en una sola lista: primero lo que ya existe en '
    'cada bloque y después lo que hay que crear.';

-- Los objetos que bloquean entregables.
CREATE OR REPLACE VIEW priorizacion.v_crear AS
SELECT o.bloque,
       b.dia_inicio,
       b.dia_fin,
       o.esquema || '.' || o.tabla AS objeto,
       o.criterio,
       o.por_que
  FROM priorizacion.objeto_nuevo o
  LEFT JOIN priorizacion.bloque b ON b.numero = o.bloque
 ORDER BY o.bloque, o.criterio, 4;

COMMENT ON VIEW priorizacion.v_crear IS
    'Los 8 objetos a crear, con el bloque que los necesita y por qué. Cinco '
    'son de cumplimiento o de seguridad.';

-- El detector de huecos: tablas del contrato que ningún bloque nombra.
CREATE OR REPLACE VIEW priorizacion.v_sin_asignar AS
SELECT m.capa,
       m.esquema || '.' || m.tabla AS objeto,
       m.columnas,
       m.filas
  FROM priorizacion.medicion m
 WHERE m.capa IN ('T0', 'T1')
   AND NOT EXISTS (
         SELECT 1
           FROM priorizacion.bloque_tabla bt
          WHERE bt.esquema = m.esquema AND bt.tabla = m.tabla)
 ORDER BY m.capa, 2;

COMMENT ON VIEW priorizacion.v_sin_asignar IS
    'Tablas del contrato MVP-45 (T0 y T1) que no aparecen en ningún bloque de '
    '§8. Hoy devuelve 0 filas: las 34 T0 y las 12 T1 tienen bloque. Una fila '
    'aquí es una tabla nueva del contrato a la que nadie le asignó bloque.';

-- Cómo se reparten los 55 objetos del contrato.
CREATE OR REPLACE VIEW priorizacion.v_mvp_cobertura AS
SELECT p.orden,
       p.categoria,
       p.objetos,
       round(100.0 * p.objetos / nullif(sum(p.objetos) OVER (), 0), 1) AS pct,
       p.nota
  FROM priorizacion.puente p
 ORDER BY p.orden;

COMMENT ON VIEW priorizacion.v_mvp_cobertura IS
    'El puente de §7: 30 exactos, 17 parciales y 8 por crear, sobre 55.';

-- El detector de contradicciones con el ERS: endpoints que un bloque de
-- diciembre promete y el ERS sitúa fuera del alcance.
CREATE OR REPLACE VIEW priorizacion.v_endpoint_contra_ers AS
SELECT e.bloque,
       e.metodos,
       e.ruta,
       e.horizonte_ers,
       e.requisito
  FROM priorizacion.bloque_endpoint e
 WHERE e.horizonte_ers IS DISTINCT FROM 'MVP'
 ORDER BY e.bloque, e.ruta;

COMMENT ON VIEW priorizacion.v_endpoint_contra_ers IS
    'Endpoints asignados a un bloque del plan cuyo requisito el ERS sitúa en '
    '2027, en MADRE, o en ningún sitio. Es la lista de promesas a revisar.';

-- ---------------------------------------------------------------------
-- 10 · Verificación
-- ---------------------------------------------------------------------
--  Si el plan y la base dejan de coincidir, esto aborta con el nombre de
--  la capa desviada, en vez de dejar un plan que miente.
DO $$
DECLARE
    v_tablas        integer;
    v_columnas      integer;
    v_filas         bigint;
    v_e_tablas      integer;
    v_e_columnas    integer;
    v_e_filas       bigint;
    v_puente        integer;
    v_nuevos        integer;
    v_bloques       integer;
    v_t0_sin_bloque integer;
    v_t1_sin_bloque integer;
    v_t1_total      integer;
    v_fk_rotas      integer;
    v_lista         text;
    r               record;
BEGIN
    SELECT count(*), coalesce(sum(columnas), 0), coalesce(sum(filas), 0)
      INTO v_tablas, v_columnas, v_filas
      FROM priorizacion.medicion;

    SELECT coalesce(sum(tablas_esperadas), 0),
           coalesce(sum(columnas_esperadas), 0),
           coalesce(sum(filas_esperadas), 0)
      INTO v_e_tablas, v_e_columnas, v_e_filas
      FROM priorizacion.capa;

    IF v_tablas <> v_e_tablas THEN
        RAISE EXCEPTION 'priorización: se midieron % tablas y las capas declaran %. Regenerar docs/mvp_prioridad_tablas.csv y actualizar priorizacion.capa.',
            v_tablas, v_e_tablas;
    END IF;

    IF v_columnas <> v_e_columnas THEN
        RAISE EXCEPTION 'priorización: se midieron % columnas y las capas declaran %.',
            v_columnas, v_e_columnas;
    END IF;

    IF v_filas <> v_e_filas THEN
        RAISE EXCEPTION 'priorización: se midieron % filas y las capas declaran %.',
            v_filas, v_e_filas;
    END IF;

    FOR r IN
        SELECT c.codigo,
               c.tablas_esperadas,
               c.columnas_esperadas,
               count(m.tabla)               AS medidas,
               coalesce(sum(m.columnas), 0) AS columnas
          FROM priorizacion.capa c
          LEFT JOIN priorizacion.medicion m ON m.capa = c.codigo
         GROUP BY c.codigo, c.tablas_esperadas, c.columnas_esperadas
         ORDER BY c.codigo
    LOOP
        IF r.medidas <> r.tablas_esperadas THEN
            RAISE EXCEPTION 'priorización: la capa % declara % tablas y se midieron %.',
                r.codigo, r.tablas_esperadas, r.medidas;
        END IF;
        IF r.columnas <> r.columnas_esperadas THEN
            RAISE EXCEPTION 'priorización: la capa % declara % columnas y se midieron %.',
                r.codigo, r.columnas_esperadas, r.columnas;
        END IF;
    END LOOP;

    -- Invariante estructural: una clave ajena viva es un subconjunto de las
    -- entrantes. Si el CSV se carga con las columnas desordenadas (\copy
    -- empareja por posición, no por nombre de cabecera), esto se rompe aquí
    -- y no en las cifras de una capa, que pueden cuadrar por casualidad.
    SELECT count(*) INTO v_fk_rotas
      FROM priorizacion.medicion
     WHERE fk_entrantes_vivas > fk_entrantes;
    IF v_fk_rotas > 0 THEN
        RAISE EXCEPTION 'priorización: % filas declaran más claves ajenas vivas que entrantes; el CSV se cargó con las columnas desordenadas.',
            v_fk_rotas;
    END IF;

    SELECT coalesce(sum(objetos), 0) INTO v_puente FROM priorizacion.puente;
    IF v_puente <> 55 THEN
        RAISE EXCEPTION 'priorización: el puente debe sumar los 55 objetos del contrato MVP-45 y suma %.',
            v_puente;
    END IF;

    SELECT count(*) INTO v_nuevos FROM priorizacion.objeto_nuevo;
    IF v_nuevos <> 8 THEN
        RAISE EXCEPTION 'priorización: §7 declara 8 objetos a crear y hay %.', v_nuevos;
    END IF;

    SELECT string_agg(o.esquema || '.' || o.tabla, ', ' ORDER BY o.esquema, o.tabla)
      INTO v_lista
      FROM priorizacion.objeto_nuevo o
      JOIN priorizacion.medicion m ON m.esquema = o.esquema AND m.tabla = o.tabla;
    IF v_lista IS NOT NULL THEN
        RAISE EXCEPTION 'priorización: estos objetos figuran como "a crear" y ya existen: %.',
            v_lista;
    END IF;

    SELECT count(*) INTO v_t0_sin_bloque
      FROM priorizacion.medicion m
     WHERE m.capa = 'T0'
       AND NOT EXISTS (SELECT 1 FROM priorizacion.bloque_tabla bt
                        WHERE bt.esquema = m.esquema AND bt.tabla = m.tabla);
    IF v_t0_sin_bloque > 0 THEN
        RAISE EXCEPTION 'priorización: % tablas T0 no tienen bloque asignado (ver priorizacion.v_sin_asignar).',
            v_t0_sin_bloque;
    END IF;

    SELECT count(*) INTO v_t1_sin_bloque
      FROM priorizacion.medicion m
     WHERE m.capa = 'T1'
       AND NOT EXISTS (SELECT 1 FROM priorizacion.bloque_tabla bt
                        WHERE bt.esquema = m.esquema AND bt.tabla = m.tabla);
    IF v_t1_sin_bloque > 0 THEN
        RAISE NOTICE 'priorización: % tablas T1 no tienen bloque asignado (ver priorizacion.v_sin_asignar); si es una tabla nueva del contrato, añadirla al INSERT de bloque_tabla.',
            v_t1_sin_bloque;
    ELSE
        SELECT count(*) INTO v_t1_total FROM priorizacion.medicion WHERE capa = 'T1';
        RAISE NOTICE 'priorización: % tablas T1, todas con bloque asignado.', v_t1_total;
    END IF;

    SELECT count(*) INTO v_bloques FROM priorizacion.bloque;
    IF v_bloques <> 6 THEN
        RAISE EXCEPTION 'priorización: §8 declara 6 bloques y hay %.', v_bloques;
    END IF;

    RAISE NOTICE 'priorización verificada: % tablas, % columnas, % filas, % bloques.',
        v_tablas, v_columnas, v_filas, v_bloques;
END $$;

COMMIT;

-- =====================================================================
--  CONSULTAS DE CABECERA
-- =====================================================================
--  Lo que el documento afirma, contra lo que la base mide:
--
--      SELECT * FROM priorizacion.v_capa_resumen;
--
--  El orden del backend, bloque por bloque:
--
--      SELECT * FROM priorizacion.v_orden_construccion;
--
--  Lo que bloquea entregables:
--
--      SELECT * FROM priorizacion.v_crear;
--
--  El detector de huérfanas del contrato (hoy devuelve 0 filas):
--
--      SELECT * FROM priorizacion.v_sin_asignar;
--
--  Promesas de diciembre que el ERS sitúa en 2027 o en MADRE:
--
--      SELECT * FROM priorizacion.v_endpoint_contra_ers;
--
--  Cómo se hereda lo que no es MVP:
--
--      SELECT * FROM priorizacion.v_heredadas;
-- =====================================================================
