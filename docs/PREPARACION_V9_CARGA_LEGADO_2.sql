-- =============================================================================
--  PREPARACIÓN v9 PARA LA CARGA DEL LEGADO — PARCHE 2
--  AVISA / OAIPCS · PostgreSQL 16
--
--  Se ejecuta DESPUÉS de docs/PREPARACION_V9_CARGA_LEGADO.sql (parche 1).
--  Contiene únicamente los huecos de esquema detectados al especificar la carga
--  columna por columna (ver docs/04_migracion/PLAN_PORTE_LEGADO_V9.md §5).
--
--  Idempotente: puede ejecutarse varias veces.
--  Todo va dentro de una transacción porque el cargador necesita SET LOCAL.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. core.entidades — identidad del legado y atributos de DIM_Entidad_Responsable
--    23 filas (E-001..E-023). Sólo E-014 (PRODUCE) es tenant; las otras 22 se
--    cargan igual para no perder el catálogo, marcadas con nivel/estado.
-- -----------------------------------------------------------------------------
ALTER TABLE core.entidades ADD COLUMN IF NOT EXISTS codigo_legado VARCHAR(20);
ALTER TABLE core.entidades ADD COLUMN IF NOT EXISTS nivel         VARCHAR(15);
ALTER TABLE core.entidades ADD COLUMN IF NOT EXISTS estado        VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS entidades_codigo_legado_key
    ON core.entidades (codigo_legado) WHERE codigo_legado IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. core.actores.abreviatura — el legado tiene valores de hasta 115 caracteres
--    (DIM_Actores.Abreviatura). varchar(50) truncaría.
-- -----------------------------------------------------------------------------
ALTER TABLE core.actores ALTER COLUMN abreviatura TYPE VARCHAR(150);

-- -----------------------------------------------------------------------------
-- 3. core.alertas_tempranas.subsector_id
--    DIM_Alertas.ID_Sector guarda AR-001 / AR-002 (código de ÁREA, no Sector-xx).
--    Área AR-001 -> Sector-01 y AR-002 -> Sector-02 vía
--    core.cat_subsectores.id_area_legado (ya creado en el parche 1).
-- -----------------------------------------------------------------------------
ALTER TABLE core.alertas_tempranas
    ADD COLUMN IF NOT EXISTS subsector_id INTEGER
        REFERENCES core.cat_subsectores(id);

-- -----------------------------------------------------------------------------
-- 4. core.hitos_compromiso — columnas de DIM_Hitos sin destino
--    (fecha_real, validación, evidencia textual y trazabilidad del legado).
-- -----------------------------------------------------------------------------
ALTER TABLE core.hitos_compromiso ADD COLUMN IF NOT EXISTS fecha_real              DATE;
ALTER TABLE core.hitos_compromiso ADD COLUMN IF NOT EXISTS validacion              VARCHAR(20);
ALTER TABLE core.hitos_compromiso ADD COLUMN IF NOT EXISTS descripcion_evidencia   TEXT;
ALTER TABLE core.hitos_compromiso ADD COLUMN IF NOT EXISTS link_evidencia          VARCHAR(500);
ALTER TABLE core.hitos_compromiso ADD COLUMN IF NOT EXISTS origen_dato             VARCHAR(20)
    NOT NULL DEFAULT 'AVISA_HISTORICO';
ALTER TABLE core.hitos_compromiso ADD COLUMN IF NOT EXISTS nivel_clasificacion     SMALLINT
    NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel);

-- -----------------------------------------------------------------------------
-- 5. core.mesas_dialogo.tiene_norma — DIM_MESAS_GRUPOS.CON_NORMA (Sí 19 / No 2)
--    No se puede inferir de tipo_espacio: hay mesas "sin norma" con tipo
--    "Mesa de Diálogo formalizada" y viceversa.
-- -----------------------------------------------------------------------------
ALTER TABLE core.mesas_dialogo ADD COLUMN IF NOT EXISTS tiene_norma BOOLEAN;

-- -----------------------------------------------------------------------------
-- 6. core.caso_regiones — cobertura territorial multi-departamento.
--
--    v9 sólo tenía core.caso_distritos. El legado tiene 8 casos con
--    ID_Ubigeo = 'DEP-20' ("Más de Uno") y BRIDGE_Caso_Depto aporta 87 filas
--    de cobertura departamental (34 casos, exactamente 1 principal por caso);
--    de esas 87 entran 81, en 32 casos, porque faltan dos casos en
--    core.casos y cuatro filas apuntan a una región que no está en core.regiones.
--    Sin esta tabla esos 8 casos quedan sin territorio utilizable.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.caso_regiones (
    caso_id      UUID    NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
    region_id    INTEGER NOT NULL REFERENCES core.regiones(id),
    es_principal BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (caso_id, region_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS caso_regiones_un_principal
    ON core.caso_regiones (caso_id) WHERE es_principal;

-- -----------------------------------------------------------------------------
-- 7. Verificación rápida
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    faltantes TEXT;
BEGIN
    SELECT string_agg(t, ', ')
      INTO faltantes
      FROM (
            SELECT 'core.entidades.codigo_legado' AS t
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='core' AND table_name='entidades'
                                  AND column_name='codigo_legado')
            UNION ALL
            SELECT 'core.hitos_compromiso.fecha_real'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='core' AND table_name='hitos_compromiso'
                                  AND column_name='fecha_real')
            UNION ALL
            SELECT 'core.mesas_dialogo.tiene_norma'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='core' AND table_name='mesas_dialogo'
                                  AND column_name='tiene_norma')
            UNION ALL
            SELECT 'core.alertas_tempranas.subsector_id'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='core' AND table_name='alertas_tempranas'
                                  AND column_name='subsector_id')
            UNION ALL
            SELECT 'core.caso_regiones'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                                WHERE table_schema='core' AND table_name='caso_regiones')
           ) q;

    IF faltantes IS NOT NULL THEN
        RAISE EXCEPTION 'Parche 2 incompleto, faltan: %', faltantes;
    END IF;

    RAISE NOTICE 'Parche 2 aplicado correctamente.';
END $$;

COMMIT;
