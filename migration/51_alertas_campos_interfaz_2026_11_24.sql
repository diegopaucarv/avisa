-- ============================================================================
-- AVISA — Migración aditiva 51: campos de la alerta que la interfaz ya usa
--
-- POR QUÉ EXISTE
--   La ficha y el listado de alertas (SPA Angular) muestran información que la
--   API todavía no guardaba ni devolvía:
--     · riesgo declarado propio de la alerta (`cat_niveles_riesgo`),
--     · alcance geográfico declarado (Distrito · Región · Nacional),
--     · región y provincia declaradas (además de las derivadas del distrito),
--     · actores clave y demandas inmediatas (listas de texto libre),
--     · plantilla de WhatsApp editada a mano,
--     · historial de revisiones (quién revisó, cuándo y con qué acción).
--   `region` y `provincia` se siguen derivando del distrito cuando no hay valor
--   declarado; por eso se guardan como columnas opcionales y la consulta
--   prefiere lo declarado y cae al distrito si falta.
--
-- REGLAS
--   * ADITIVA: no elimina ni renombra columnas de negocio. `prioridad_id` sigue
--     existiendo; sólo se vuelve opcional (`DROP NOT NULL`), porque la interfaz
--     retiró la prioridad y ya no la envía al dar de alta.
--   * IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS,
--     DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, ON CONFLICT DO NOTHING.
--   * No siembra datos de negocio.
--   * PostgreSQL 16+, esquema `core`.
--
-- NOTA SOBRE EL ALCANCE
--   `core.cat_alcances_geograficos` es el eje territorial del caso
--   (Norte · Centro · Sur · Oriente · Nacional) y lo consumen los formularios
--   de caso y compromiso vía `GET /api/v1/catalogs`. La granularidad de la
--   alerta (Distrito · Región · Nacional) es otro vocabulario, así que se crea
--   un catálogo propio, `core.cat_alcances_alerta`, y `alcance_id` apunta a él.
--   El catálogo compartido queda intacto.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Columnas nuevas en core.alertas_tempranas
--    `region_id`/`provincia_id` son declaraciones opcionales del territorio de
--    la alerta; `distrito_id` sigue siendo la referencia principal.
-- ============================================================================
ALTER TABLE core.alertas_tempranas
    ADD COLUMN IF NOT EXISTS nivel_riesgo_id     smallint,
    ADD COLUMN IF NOT EXISTS alcance_id          smallint,
    ADD COLUMN IF NOT EXISTS region_id           int,
    ADD COLUMN IF NOT EXISTS provincia_id        int,
    ADD COLUMN IF NOT EXISTS actores_clave       jsonb,
    ADD COLUMN IF NOT EXISTS demandas_inmediatas jsonb,
    ADD COLUMN IF NOT EXISTS plantilla_whatsapp  text;

-- La prioridad se retira de la interfaz: la columna queda, pero opcional. El
-- ALTER es idempotente por naturaleza (DROP NOT NULL sobre una columna ya
-- nullable no cambia nada).
ALTER TABLE core.alertas_tempranas ALTER COLUMN prioridad_id DROP NOT NULL;

COMMENT ON COLUMN core.alertas_tempranas.nivel_riesgo_id IS
    'Riesgo declarado de la alerta (Bajo · Medio · Alto). Si es NULL, la API hereda el del caso vinculado.';
COMMENT ON COLUMN core.alertas_tempranas.alcance_id IS
    'Granularidad geográfica declarada de la alerta (Distrito · Región · Nacional), en core.cat_alcances_alerta.';
COMMENT ON COLUMN core.alertas_tempranas.region_id IS
    'Región declarada. Si es NULL, la API la deriva del distrito de la alerta.';
COMMENT ON COLUMN core.alertas_tempranas.provincia_id IS
    'Provincia declarada. Si es NULL, la API la deriva del distrito de la alerta.';
COMMENT ON COLUMN core.alertas_tempranas.actores_clave IS
    'Actores clave del territorio o del sector, como lista de textos.';
COMMENT ON COLUMN core.alertas_tempranas.demandas_inmediatas IS
    'Demandas inmediatas recogidas en campo, como lista de textos.';
COMMENT ON COLUMN core.alertas_tempranas.plantilla_whatsapp IS
    'Plantilla de WhatsApp editada a mano; NULL deja que la API genere el mensaje.';

-- ============================================================================
-- 2. Catálogo propio de alcance de la alerta
--    Distrito · Región · Nacional. Separado del eje territorial del caso para
--    no contaminar el selector de casos y compromisos.
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.cat_alcances_alerta (
    id     SMALLINT PRIMARY KEY,
    codigo VARCHAR(20) NOT NULL UNIQUE
);

INSERT INTO core.cat_alcances_alerta (id, codigo) VALUES
    (1, 'Distrito'),
    (2, 'Región'),
    (3, 'Nacional')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE core.cat_alcances_alerta IS
    'Granularidad geográfica de la alerta temprana: Distrito · Región · Nacional.';

-- ============================================================================
-- 2b. Remapear valores de una corrida previa (defensivo)
--     Si algún entorno ya ejecutó una variante anterior de esta migración, sus
--     `alcance_id` apuntaban al catálogo compartido (Distrito=6, Región=7,
--     Nacional=5). Se reasignan por código al catálogo nuevo y lo que no exista
--     en el vocabulario de la alerta queda en NULL, para que la FK nueva pueda
--     crearse. En una instalación limpia no cambia ninguna fila.
-- ============================================================================
UPDATE core.alertas_tempranas a
   SET alcance_id = na.id
  FROM core.cat_alcances_geograficos ag
  JOIN core.cat_alcances_alerta na
    ON core.normalizar_ref(na.codigo) = core.normalizar_ref(ag.codigo)
 WHERE ag.id = a.alcance_id;

UPDATE core.alertas_tempranas
   SET alcance_id = NULL
 WHERE alcance_id IS NOT NULL
   AND alcance_id NOT IN (SELECT id FROM core.cat_alcances_alerta);

-- ============================================================================
-- 3. FKs de las columnas declaradas
--    `alcance_id` se re-apunta al catálogo propio de la alerta.
-- ============================================================================
ALTER TABLE core.alertas_tempranas
    DROP CONSTRAINT IF EXISTS alertas_tempranas_nivel_riesgo_id_fkey;
ALTER TABLE core.alertas_tempranas
    ADD CONSTRAINT alertas_tempranas_nivel_riesgo_id_fkey
    FOREIGN KEY (nivel_riesgo_id) REFERENCES core.cat_niveles_riesgo(id);

ALTER TABLE core.alertas_tempranas
    DROP CONSTRAINT IF EXISTS alertas_tempranas_alcance_id_fkey;
ALTER TABLE core.alertas_tempranas
    ADD CONSTRAINT alertas_tempranas_alcance_id_fkey
    FOREIGN KEY (alcance_id) REFERENCES core.cat_alcances_alerta(id);

ALTER TABLE core.alertas_tempranas
    DROP CONSTRAINT IF EXISTS alertas_tempranas_region_id_fkey;
ALTER TABLE core.alertas_tempranas
    ADD CONSTRAINT alertas_tempranas_region_id_fkey
    FOREIGN KEY (region_id) REFERENCES core.regiones(id);

ALTER TABLE core.alertas_tempranas
    DROP CONSTRAINT IF EXISTS alertas_tempranas_provincia_id_fkey;
ALTER TABLE core.alertas_tempranas
    ADD CONSTRAINT alertas_tempranas_provincia_id_fkey
    FOREIGN KEY (provincia_id) REFERENCES core.provincias(id);

-- ============================================================================
-- 4. Retirar del catálogo compartido las etiquetas de la alerta
--    Una corrida previa de esta migración pudo sembrar `Distrito` y `Región`
--    en `cat_alcances_geograficos`; esas filas no pertenecen al eje del caso y
--    contaminaban el selector de casos. Se eliminan tras soltar la FK (ya
--    re-apuntada arriba) y sólo si siguen con sus etiquetas; así una eventual
--    fila preexistente del catálogo no se toca.
-- ============================================================================
DELETE FROM core.cat_alcances_geograficos
 WHERE id IN (6, 7)
   AND codigo IN ('Distrito', 'Región');

-- ============================================================================
-- 5. Historial de revisiones de la alerta
--    Una fila por acción de revisión (validar, aprobar, solicitar
--    modificación, enviar a revisión, remitir, archivar). `usuario_id` sin FK,
--    igual que otras trazas: la fila sobrevive a la baja lógica del usuario.
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.alerta_revision (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alerta_id   uuid NOT NULL REFERENCES core.alertas_tempranas(id) ON DELETE CASCADE,
    usuario_id  uuid,
    accion      varchar(255),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- El detalle y el listado leen la revisión más reciente de cada alerta.
CREATE INDEX IF NOT EXISTS ix_alerta_revision_alerta
    ON core.alerta_revision (alerta_id, created_at DESC);

COMMENT ON TABLE core.alerta_revision IS
    'Historial de revisiones de la alerta: quién la revisó, cuándo y con qué acción (validar, aprobar, solicitar modificación, enviar a revisión).';

-- ============================================================================
-- 6. Privilegios de los objetos nuevos
--    Idempotente también ante entornos sin el rol `avisa_app`.
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_app') THEN
        EXECUTE 'GRANT SELECT ON core.cat_alcances_alerta TO avisa_app';
        EXECUTE 'GRANT SELECT, INSERT ON core.alerta_revision TO avisa_app';
    ELSE
        RAISE NOTICE 'rol avisa_app ausente: no se otorgaron privilegios sobre los objetos de alerta';
    END IF;
END $$;

-- ============================================================================
-- 7. Registro de la migración
-- ============================================================================
INSERT INTO core.migracion_log (clave) VALUES ('51_alertas_campos_interfaz_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
