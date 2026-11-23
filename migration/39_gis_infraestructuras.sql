-- 39 · Capa GIS de infraestructuras y derechos acuícolas
--
-- Origen: `gis/Infraestructuras.kml` (PRODUCE) → `gis/derived/infraestructuras_puntos.csv`
-- mediante `scripts/kml_infraestructuras.py`.
--
-- La capa NO son 13 456 instalaciones de PRODUCE. Contiene dos poblaciones:
--   * 13 229 derechos acuícolas (privados), uno por `codigo`.
--   * 227 sedes y dependencias institucionales, identificadas por `identi`.
--
-- `titular` y `nombre` son datos personales (Ley 29733). El GeoJSON derivado
-- los omite; esta tabla los conserva para uso interno y por eso NO debe
-- exponerse directamente en una API pública sin RLS o agregación.
--
-- Carga: `python migration/loader/cargar_gis.py` (idempotente: trunca y recarga).

BEGIN;

CREATE SCHEMA IF NOT EXISTS gis;

CREATE TABLE IF NOT EXISTS gis.infraestructuras_puntos (
    id                      text        PRIMARY KEY,
    tipo_registro           text        NOT NULL
        CHECK (tipo_registro IN ('derecho_acuicola', 'institucional')),
    nombre                  text,
    identi                  text,
    sede                    text,
    nombre_infraestructura  text,
    direccion               text,
    direccion_predio        text,
    departamento            text,
    provincia               text,
    distrito                text,
    ubigeo                  varchar(6),
    ubigeo_region           varchar(2)  GENERATED ALWAYS AS (left(ubigeo, 2)) STORED,
    ubigeo_provincia        varchar(4)  GENERATED ALWAYS AS (left(ubigeo, 4)) STORED,
    metodo_ubigeo           text,
    latitud                 double precision,
    longitud                double precision,
    coincide_coords         boolean,
    codigo                  text,
    ambito                  text,
    tipo_derecho            text,
    categoria_productiva    text,
    categoria_codigo        varchar(8),
    especie                 text,
    tipo_recurso            text,
    nombre_recurso          text,
    estado                  text,
    area_total_ha           numeric(12,3),
    fecha_emision           date,
    fecha_vigencia          date,
    resolucion              text,
    zona                    text,
    tipo_coord              text,
    titular                 text,
    fid_origen              integer,
    tipo_geometria          text,
    otros                   jsonb,
    distrito_id             integer REFERENCES core.distritos (id),
    geom                    geometry(Point, 4326)
);

COMMENT ON TABLE gis.infraestructuras_puntos IS
    'Puntos de gis/Infraestructuras.kml. Mayoritariamente derechos acuícolas '
    'privados (tipo_registro = derecho_acuicola), no instalaciones de PRODUCE. '
    'Ver gis/derived/README.md para el diccionario completo.';

COMMENT ON COLUMN gis.infraestructuras_puntos.tipo_registro IS
    'derecho_acuicola (13 229, reconocidos por codigo) o institucional (227, por identi).';

COMMENT ON COLUMN gis.infraestructuras_puntos.nombre IS
    'PII · <name> del placemark. En derechos y PNACP repite el titular.';

COMMENT ON COLUMN gis.infraestructuras_puntos.titular IS
    'PII (Ley 29733) · titular del derecho acuícola, o beneficiario en IDENTI=PNACP. '
    'No publicar sin RLS o agregación.';

COMMENT ON COLUMN gis.infraestructuras_puntos.ubigeo IS
    'Código INEI de 6 dígitos resuelto con scripts/toponimos.json + equivalencias '
    'OTI/CONCYTEC (columna *_inei). Vacío en 52 puntos: Boquerón y Huipoca no están '
    'en la tabla de equivalencias.';

COMMENT ON COLUMN gis.infraestructuras_puntos.metodo_ubigeo IS
    'exacto | provincia aproximada | distrito corregido | truncado | '
    'fuera del ubigeo | parecido descartado. Indica qué se corrigió y qué no.';

COMMENT ON COLUMN gis.infraestructuras_puntos.departamento IS
    'Nombre oficial del ubigeo cuando se resolvió. El KML dice CALLAO; la provincia '
    'oficial es PROV. CONST. DEL CALLAO.';

COMMENT ON COLUMN gis.infraestructuras_puntos.distrito IS
    'Nombre oficial. El KML dice PUERTO MALDONADO; el distrito oficial es TAMBOPATA (170101). '
    'Dice TARAPOTO como provincia; el distrito 220901 pertenece a SAN MARTIN.';

COMMENT ON COLUMN gis.infraestructuras_puntos.categoria_codigo IS
    'Siglón de CATEGORIA_: AREL | AMYPE | AMYGE. El texto completo queda en categoria_productiva.';

COMMENT ON COLUMN gis.infraestructuras_puntos.identi IS
    'Institución dueña cuando el punto es una sede (ITP, SANIPES, IMARPE, DIREPRO, '
    'FONDEPES…). Conserva la errata "DPA -GORE" (1 fila): filtrar con identi LIKE ''DPA%''.';

COMMENT ON COLUMN gis.infraestructuras_puntos.tipo_coord IS
    'Normalizado a mayúsculas: UBICACIÓN RD | UBICACIÓN REFERENCIAL | GRÁFICA MANUAL.';

COMMENT ON COLUMN gis.infraestructuras_puntos.otros IS
    'Claves del globo no mapeadas: DATUM, FLAG, OBJECTID_1, TIPO, RESOLU_1, '
    'OBS_MODIFI, FECHA_MODI (que trae el literal "<Null>").';

COMMENT ON COLUMN gis.infraestructuras_puntos.distrito_id IS
    'Puente al modelo curado. Sólo se llena cuando el ubigeo existe en core.distritos '
    '(hoy 698 de 1 874 distritos).';

COMMENT ON COLUMN gis.infraestructuras_puntos.geom IS
    'Point WGS84 tomado de <Point> del placemark (10 puntos difieren del punto del globo).';

CREATE INDEX IF NOT EXISTS infraestructuras_puntos_ubigeo_idx
    ON gis.infraestructuras_puntos (ubigeo);
CREATE INDEX IF NOT EXISTS infraestructuras_puntos_identi_idx
    ON gis.infraestructuras_puntos (identi);
CREATE INDEX IF NOT EXISTS infraestructuras_puntos_tipo_idx
    ON gis.infraestructuras_puntos (tipo_registro);
CREATE INDEX IF NOT EXISTS infraestructuras_puntos_distrito_idx
    ON gis.infraestructuras_puntos (distrito_id);
CREATE INDEX IF NOT EXISTS infraestructuras_puntos_geom_idx
    ON gis.infraestructuras_puntos USING gist (geom);

-- Desembarcaderos artesanales (DPA): 31 puntos institucionales.
CREATE OR REPLACE VIEW gis.v_desembarcaderos AS
SELECT id,
       identi,
       coalesce(nombre_infraestructura, nombre) AS nombre,
       departamento,
       provincia,
       distrito,
       ubigeo,
       latitud,
       longitud,
       geom
FROM gis.infraestructuras_puntos
WHERE tipo_registro = 'institucional'
  AND identi LIKE 'DPA%';

COMMENT ON VIEW gis.v_desembarcaderos IS
    'Puntos DPA - GORE (desembarcaderos artesanales). Incluye la fila con la errata "DPA -GORE".';

-- Densidad por distrito: cuántos derechos y cuántas sedes, y el área otorgada.
CREATE OR REPLACE VIEW gis.v_infraestructuras_por_distrito AS
SELECT d.id                                        AS distrito_id,
       d.ubigeo::text                              AS ubigeo,
       d.nombre                                    AS distrito,
       p.nombre                                    AS provincia,
       r.nombre                                    AS departamento,
       count(*) FILTER (WHERE i.tipo_registro = 'derecho_acuicola') AS derechos_acuicolas,
       count(*) FILTER (WHERE i.tipo_registro = 'institucional')    AS institucionales,
       count(*)                                    AS total,
       coalesce(sum(i.area_total_ha) FILTER (WHERE i.tipo_registro = 'derecho_acuicola'), 0)
                                                   AS area_otorgada_ha
FROM gis.infraestructuras_puntos i
JOIN core.distritos   d ON d.id = i.distrito_id
JOIN core.provincias  p ON p.id = d.provincia_id
JOIN core.regiones    r ON r.id = p.region_id
GROUP BY d.id, d.ubigeo, d.nombre, p.nombre, r.nombre;

COMMENT ON VIEW gis.v_infraestructuras_por_distrito IS
    'Resumen por distrito de la capa GIS. Sólo cubre los ubigeos presentes en core.distritos.';

-- Privilegios para el rol de la aplicación. `avisa_api` hereda de `avisa_app`.
-- Se guarda la existencia del rol para no romper la carga standalone en una base
-- donde los roles todavía no se crearon.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA gis TO avisa_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gis TO avisa_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA gis '
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avisa_app';
  ELSE
    RAISE NOTICE 'rol avisa_app ausente: no se otorgaron privilegios sobre gis';
  END IF;
END $$;

COMMIT;
