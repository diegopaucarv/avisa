-- ============================================================================
-- AVISA — Migración aditiva 49: soportes de la pasada de interfaz 2026-11-24
--
-- POR QUÉ EXISTE
--   Varias pantallas necesitan dónde guardar lo que la interfaz ya dibuja:
--   adjuntos (alertas, compromisos, hitos, documentos), versiones y
--   extracciones de documentos, lista blanca de tipos, preferencias por
--   usuario, tablero de la bandeja con asignación/posposición, historial de
--   compromisos, fusiones de actores, duplicados descartados y notificaciones
--   leídas. Ninguna de estas piezas existía.
--
-- REGLAS
--   * ADITIVA: no elimina, renombra ni reordena nada existente.
--   * IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS.
--   * No siembra datos de negocio, salvo la lista blanca técnica de tipos de
--     archivo (no es dato de negocio y se puede ajustar).
--   * PostgreSQL 16+, esquema `core`.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Adjuntos genéricos
--    El binario va en `contenido` (bytea), igual que core.medios. La entidad
--    dueña se declara con `entidad_tipo` + `entidad_id`; no hay FK polimórfica.
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.adjunto (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entidad_tipo    varchar(30) NOT NULL
        CHECK (entidad_tipo IN ('alerta','compromiso','hito','documento','reunion','caso','demanda')),
    entidad_id      uuid NOT NULL,
    nombre          varchar(255) NOT NULL,
    mime            varchar(120),
    tamano_bytes    bigint,
    contenido       bytea,
    hash_sha256     char(64),
    descripcion     text,
    subido_por      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    anulado_en      timestamptz,
    anulado_por     uuid,
    motivo_anulacion text
);

CREATE INDEX IF NOT EXISTS ix_adjunto_entidad
    ON core.adjunto (entidad_tipo, entidad_id)
    WHERE anulado_en IS NULL;

COMMENT ON TABLE core.adjunto IS
    'Adjuntos de alertas, compromisos, hitos, documentos, reuniones, casos y demandas. Binario en bytea, igual que core.medios.';

-- ============================================================================
-- 2. Versiones de documento
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.documento_version (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    documento_id    uuid NOT NULL REFERENCES core.documentos(id) ON DELETE CASCADE,
    numero          integer NOT NULL,
    titulo          varchar(255),
    mime            varchar(120),
    tamano_bytes    bigint,
    contenido       bytea,
    url             text,
    hash_sha256     char(64),
    nota            text,
    creado_por      uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (documento_id, numero)
);

CREATE INDEX IF NOT EXISTS ix_documento_version_doc
    ON core.documento_version (documento_id, numero DESC);

COMMENT ON TABLE core.documento_version IS
    'Versiones del documento. `contenido` puede ser NULL cuando la versión sólo referencia una URL.';

-- ============================================================================
-- 3. Extracciones de documento (OCR y temas clave)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.documento_extraccion (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    documento_id    uuid NOT NULL REFERENCES core.documentos(id) ON DELETE CASCADE,
    tipo            varchar(20) NOT NULL CHECK (tipo IN ('ocr','temas')),
    estado          varchar(20) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente','en_proceso','listo','error','no_disponible')),
    resultado_json  jsonb,
    texto           text,
    error           text,
    modelo          varchar(80),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid
);

CREATE INDEX IF NOT EXISTS ix_documento_extraccion_doc
    ON core.documento_extraccion (documento_id, tipo, created_at DESC);

COMMENT ON TABLE core.documento_extraccion IS
    'Resultado de OCR y de extracción de temas clave. `no_disponible` declara que no hay motor configurado; no es un error.';

-- ============================================================================
-- 4. Lista blanca de tipos de archivo
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.documento_lista_blanca (
    mime        varchar(120) PRIMARY KEY,
    extension   varchar(16) NOT NULL,
    activo      boolean NOT NULL DEFAULT true,
    nota        text
);

INSERT INTO core.documento_lista_blanca (mime, extension, activo, nota) VALUES
    ('application/pdf', 'pdf', true, 'Formato principal de los anexos.'),
    ('image/jpeg', 'jpg', true, 'Fotografías y capturas.'),
    ('image/png', 'png', true, 'Capturas y mapas.'),
    ('image/webp', 'webp', true, 'Fotografías comprimidas.'),
    ('text/plain', 'txt', true, 'Texto plano.'),
    ('text/csv', 'csv', true, 'Tablas exportadas.'),
    ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', true, 'Documentos de trabajo.'),
    ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', true, 'Matrices del equipo.'),
    ('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', true, 'Presentaciones.')
ON CONFLICT (mime) DO NOTHING;

-- ============================================================================
-- 5. Preferencias por usuario y configuración global
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.usuario_preferencia (
    usuario_id  uuid NOT NULL REFERENCES core.usuarios(id) ON DELETE CASCADE,
    clave       varchar(80) NOT NULL,
    valor       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (usuario_id, clave)
);

COMMENT ON TABLE core.usuario_preferencia IS
    'Preferencias por usuario en servidor: ámbito, tamaño de página, zona horaria, columnas, etc.';

CREATE TABLE IF NOT EXISTS core.configuracion (
    clave       varchar(80) PRIMARY KEY,
    valor       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid
);

-- ============================================================================
-- 6. Tablero de la bandeja
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.tablero_tarjeta (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entidad_tipo            varchar(20) NOT NULL
        CHECK (entidad_tipo IN ('alerta','compromiso','demanda','caso')),
    entidad_id              uuid NOT NULL,
    columna                 varchar(20) NOT NULL DEFAULT 'backlog'
        CHECK (columna IN ('backlog','en_curso','en_espera','hecho')),
    asignacion_texto        varchar(160),
    responsable_usuario_id  uuid,
    responsable_texto       varchar(160),
    fecha_limite            date,
    pospuesto_hasta         date,
    motivo_posposicion      text,
    orden                   integer NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    created_by              uuid,
    updated_by              uuid,
    UNIQUE (entidad_tipo, entidad_id)
);

CREATE INDEX IF NOT EXISTS ix_tablero_columna
    ON core.tablero_tarjeta (columna, orden, fecha_limite);

COMMENT ON TABLE core.tablero_tarjeta IS
    'Estado persistido de la bandeja-tablero. `asignacion_texto` y `responsable_texto` permiten declarar el dato cuando todavía no hay usuario en AVISA.';

CREATE TABLE IF NOT EXISTS core.tablero_tarjeta_evento (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tarjeta_id      uuid NOT NULL REFERENCES core.tablero_tarjeta(id) ON DELETE CASCADE,
    tipo            varchar(30) NOT NULL,
    valor_anterior  jsonb,
    valor_nuevo     jsonb,
    usuario_id      uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tablero_evento
    ON core.tablero_tarjeta_evento (tarjeta_id, created_at DESC);

-- ============================================================================
-- 7. Historial de compromisos
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.compromiso_evento (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    compromiso_id   uuid NOT NULL REFERENCES core.compromisos(id) ON DELETE CASCADE,
    tipo            varchar(30) NOT NULL,
    detalle         jsonb,
    usuario_id      uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_compromiso_evento
    ON core.compromiso_evento (compromiso_id, created_at DESC);

-- ============================================================================
-- 8. Fusiones de actores y duplicados descartados
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.actor_fusion (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_origen_id  uuid NOT NULL REFERENCES core.actores(actor_uid),
    actor_destino_id uuid NOT NULL REFERENCES core.actores(actor_uid),
    detalle          jsonb,
    fusionado_por    uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (actor_origen_id <> actor_destino_id)
);

CREATE TABLE IF NOT EXISTS core.caso_duplicado_descartado (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    caso_a_id     uuid NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
    caso_b_id     uuid NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
    motivo        text,
    descartado_por uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (caso_a_id <> caso_b_id),
    UNIQUE (caso_a_id, caso_b_id)
);

-- ============================================================================
-- 9. Notificaciones leídas
-- ============================================================================
ALTER TABLE core.notificaciones
    ADD COLUMN IF NOT EXISTS leido_en timestamptz;

CREATE INDEX IF NOT EXISTS ix_notificaciones_usuario_estado
    ON core.notificaciones (usuario_id, estado, created_at DESC);

-- ============================================================================
-- 10. Registro de la migración
-- ============================================================================
INSERT INTO core.migracion_log (clave) VALUES ('49_soportes_interfaz_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
