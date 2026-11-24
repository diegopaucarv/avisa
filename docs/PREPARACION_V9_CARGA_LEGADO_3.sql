-- =============================================================================
--  PREPARACIÓN v9 PARA LA CARGA DEL LEGADO — PARCHE 3 (CIERRE DE BLOQUEOS)
--  AVISA / OAIPCS · PostgreSQL 16
--
--  Se ejecuta DESPUÉS de:
--    docs/PREPARACION_V9_CARGA_LEGADO.sql     (parche 1)
--    docs/PREPARACION_V9_CARGA_LEGADO_2.sql   (parche 2)
--
--  Este parche contiene SÓLO lo que faltaba para que el cargador no tenga que
--  inventar un solo dato. Justificación completa: docs/04_migracion/DECISIONES_CARGA_LEGADO_V9.md
--
--  Idempotente: puede ejecutarse varias veces.
--  Todo va dentro de una transacción porque el cargador necesita SET LOCAL.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. D43 — DNI NO ES ÚNICO EN EL ORIGEN
--
--    DIM_Actores trae 642 DNI con sólo 587 valores distintos: 45 valores
--    aparecen en 100 filas. Una versión anterior del parche 1 creó
--        ux_actor_dni UNIQUE (dni) WHERE dni IS NOT NULL
--    que ABORTA la carga en la segunda aparición; el parche 1 actual ya
--    crea `ix_actor_dni` sin unicidad y explica por qué (§3.1). El DROP
--    se conserva para las bases que vengan de esa versión antigua.
--
--    No se fusionan las personas: DOC-ACT-004 ("Diego Armando Paiva Jacinto")
--    y ACT-541 ("Diego Paico Seminario") comparten DNI pero son personas
--    distintas -> fusionar por DNI corrompe el padrón. Se conservan las 828
--    filas y el conflicto se registra en core.migracion_conflicto para revisión
--    humana.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS core.ux_actor_dni;

CREATE INDEX IF NOT EXISTS ix_actor_dni
    ON core.actor_datos_personales (dni) WHERE dni IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. D47 — prioridad de alerta desconocida
--
--    81/83 alertas traen ID_NIVEL_ALERTA (NA-001..NA-004) y de ahí sale
--    prioridad_id. Las 2 restantes (AT-2026-80, AT-2026-59) NO traen nivel.
--
--    Se relaja a NULL en vez de inventar "Critica_Inmediata" o "Seguimiento":
--    el legado no lo dice. Es el mismo criterio que (b), que ya aceptaste para
--    casos.nivel_conflicto_id.
--
--    El único consumidor es core.deriv_limite(), que ya tolera NULL
--    (IF v_sla IS NOT NULL). Ninguna vista hace JOIN con esta columna.
-- -----------------------------------------------------------------------------
ALTER TABLE core.alertas_tempranas ALTER COLUMN prioridad_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. D44 — demandas cuyo padre legado no es una alerta
--
--    DIM_Demandas.ID_ALERTA tiene 248 valores no nulos, pero sólo 236 son
--    códigos de alerta reales:
--        236  AT-2026-xx   -> alerta_id           (FK normal)
--          5  RR-2026-01   -> documento_origen_id (reporte rápido)
--          6  CS-2026-xx   -> no resuelve (serie ANTERIOR de casos)
--          1  TEMA-03      -> basura
--
--    CS-2026-01/02/07 NO son CS-PRODUCE-2026-001/002/007: se comprobó por
--    contenido (CS-2026-02 = DPA Chancay/Huacho; CS-PRODUCE-2026-002 =
--    Desembarcadero de Los Órganos). No se fuerza el match (D19).
--
--    Las 12 filas se conservan: el código crudo queda en codigo_padre_legado y,
--    cuando el padre es el reporte rápido, se enlaza el documento.
-- -----------------------------------------------------------------------------
ALTER TABLE core.demandas
    ADD COLUMN IF NOT EXISTS documento_origen_id UUID REFERENCES core.documentos(id),
    ADD COLUMN IF NOT EXISTS codigo_padre_legado VARCHAR(50);

CREATE INDEX IF NOT EXISTS ix_demandas_documento
    ON core.demandas (documento_origen_id) WHERE documento_origen_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. D25 — especie: nombre científico del legado cuando discrepa
--
--    cat_especies.nombre_comun es UNIQUE, así que NO se puede insertar un
--    segundo "Tiburón martillo". RECU-009 ("Tiburón martillo", Sphyrna
--    zygaena) se enlaza a la semilla id 12 ("Tiburón martillo", Sphyrna
--    lewini) y la diferencia taxonómica se conserva aquí, sin sobrescribir
--    el nombre oficial.
-- -----------------------------------------------------------------------------
ALTER TABLE core.cat_especies
    ADD COLUMN IF NOT EXISTS nombre_cientifico_legado VARCHAR(120);

-- -----------------------------------------------------------------------------
-- 5. D26 — unidad orgánica responsable (la ÚNICA fila no tomada del legado)
--
--    0 de 35 casos trae unidad responsable: FACT_Casos no tiene la columna y
--    DIM_Sectoristas.ID_Area / ID_Unidad vienen vacías. casos.unidad_
--    responsable_id es NOT NULL -> sin unidad no entra ningún caso.
--
--    No es un dato inventado: la unidad existe y está documentada en
--    docs/02_arquitectura/AVISA_PRODUCE_v10.md §1 y glosario:
--        "OAIPCS. Oficina de Articulación Intergubernamental y Prevención de
--         Conflictos Sociales."
--    entidad_id = 1 es PRODUCE (única entidad tenant).
--
--    cat_unidades_organicas no tiene triggers: el INSERT directo es seguro.
-- -----------------------------------------------------------------------------
INSERT INTO core.cat_unidades_organicas (entidad_id, siglas, nombre_completo, estado)
SELECT 1,
       'OAIPCS',
       'Oficina de Articulación Intergubernamental y Prevención de Conflictos Sociales',
       'Activo'
WHERE NOT EXISTS (
    SELECT 1 FROM core.cat_unidades_organicas
     WHERE entidad_id = 1 AND siglas = 'OAIPCS'
);

-- -----------------------------------------------------------------------------
-- 6. Cola de revisión humana de la migración
--
--    Todo lo que el cargador NO puede resolver sin inventar entra aquí en vez
--    de perderse en un log: DNI compartidos, membresías sin match, códigos de
--    caso de la serie anterior, vínculos alerta->demanda descartados, especies
--    con nombre científico divergente.
--
--    Es la contraparte operativa de es_validado_humano=false: el dato entra,
--    pero queda marcado y con puntero para que OAIPCS lo revise.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.migracion_conflicto (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fase            SMALLINT     NOT NULL,
    categoria       VARCHAR(40)  NOT NULL,
    hoja_legado     VARCHAR(60),
    fila_legado     INTEGER,
    codigo_legado   VARCHAR(80),
    detalle         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    resuelto        BOOLEAN      NOT NULL DEFAULT FALSE,
    resuelto_por    UUID         REFERENCES core.usuarios(id),
    resuelto_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT migracion_conflicto_categoria_chk CHECK (categoria IN (
        'DNI_DUPLICADO',
        'PERSONA_HOMONIMA',
        'MEMBRESIA_SIN_MATCH',
        'ORGANIZACION_SIN_ACTOR',
        'CASO_CODIGO_SERIE_ANTERIOR',
        'ALERTA_INEXISTENTE',
        'ESPECIE_NOMBRE_CIENTIFICO_DIVERGENTE',
        'HITO_SIN_COMPROMISO',
        'PARTICIPANTE_SIN_CAPACITACION',
        'TERRITORIO_NO_RESUELTO',
        'BRIDGE_CLAVE_DUPLICADA'
    ))
);

CREATE INDEX IF NOT EXISTS ix_migracion_conflicto_cat
    ON core.migracion_conflicto (categoria) WHERE NOT resuelto;

-- -----------------------------------------------------------------------------
-- 7. Verificación rápida
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_faltantes TEXT;
    v_oaipcs    INT;
BEGIN
    SELECT string_agg(t, ', ')
      INTO v_faltantes
      FROM (
            SELECT 'core.demandas.documento_origen_id' AS t
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='core' AND table_name='demandas'
                                  AND column_name='documento_origen_id')
            UNION ALL
            SELECT 'core.demandas.codigo_padre_legado'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='core' AND table_name='demandas'
                                  AND column_name='codigo_padre_legado')
            UNION ALL
            SELECT 'core.cat_especies.nombre_cientifico_legado'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                                WHERE table_schema='core' AND table_name='cat_especies'
                                  AND column_name='nombre_cientifico_legado')
            UNION ALL
            SELECT 'core.migracion_conflicto'
             WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables
                                WHERE table_schema='core' AND table_name='migracion_conflicto')
            UNION ALL
            SELECT 'core.alertas_tempranas.prioridad_id NOT NULL sigue activo'
             WHERE EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema='core' AND table_name='alertas_tempranas'
                              AND column_name='prioridad_id' AND is_nullable='NO')
           ) q;

    IF v_faltantes IS NOT NULL THEN
        RAISE EXCEPTION 'Parche 3 incompleto, faltan: %', v_faltantes;
    END IF;

    SELECT count(*) INTO v_oaipcs
      FROM core.cat_unidades_organicas
     WHERE entidad_id = 1 AND siglas = 'OAIPCS';

    IF v_oaipcs <> 1 THEN
        RAISE EXCEPTION 'La unidad OAIPCS debe existir exactamente 1 vez, hay %', v_oaipcs;
    END IF;

    RAISE NOTICE 'Parche 3 aplicado correctamente (unidad OAIPCS id=%).',
        (SELECT id FROM core.cat_unidades_organicas WHERE entidad_id=1 AND siglas='OAIPCS');
END $$;

COMMIT;
