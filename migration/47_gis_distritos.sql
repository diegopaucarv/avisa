-- 47 · Capa distrital GIS (geogpsperu · Censo 2025)
--
-- Origen: `gis/derived/distritos_capa_simple.geojson` (1,7 MB) y
-- `gis/derived/distritos_capa.geojson` (39 MB) → 1 892 polígonos con `ubigeo`
-- INEI de 6 dígitos. La población sale del mismo insumo censal
-- (`total`, `Hombre_T`, `Mujer_T`) y de `gis/derived/distritos_capa.csv`.
--
-- REGLA DEL PROYECTO
--   La geometría dice DÓNDE está un territorio, no cuánto pesa. La población es
--   SÓLO denominador (tasas por 100 000 habitantes); no entra en el nivel de
--   riesgo ni en ninguna ponderación.
--
-- DESFASE DECLARADO
--   La capa trae 1 892 distritos; el catálogo INEI
--   (`gis/derived/distritos_maestro.csv`, `core.distritos`) trae 1 891.
--   La fila extra es 160405 SANTA ROSA DE LORETO (MARISCAL RAMON CASTILLA,
--   LORETO). Se carga con su ubigeo propio: no se le inventa otro ni se
--   descarta. Por eso `territorio.distrito` NO tiene FK a `core.distritos`:
--   160405 no existe en ese catálogo.
--
-- CARGA
--   node scripts/cargar-gis-neon.mjs                 # dry-run (lee y compara)
--   node scripts/cargar-gis-neon.mjs --completo      # geometría sin simplificar
--   node scripts/cargar-gis-neon.mjs --apply --confirmar
--   Idempotente por `ubigeo`: no reescribe filas con la misma población y
--   geometría (`ST_Equals`).
--
-- Aditiva: no toca `core.distritos`, `gis.infraestructuras_puntos` ni la API
-- existente. Se puede re-ejecutar sin efecto.

begin;

-- PostGIS ya está instalado en Neon; el guard queda para una base nueva.
create extension if not exists postgis;

create schema if not exists core;
create schema if not exists territorio;

create table if not exists core.migracion_log (
    clave       text        primary key,
    aplicada_en timestamptz not null default now()
);

create table if not exists territorio.distrito (
    ubigeo                char(6)      primary key
        check (ubigeo ~ '^[0-9]{6}$'),
    nombre                varchar(120) not null,
    provincia             varchar(120),
    region                varchar(120),
    poblacion_total       bigint       check (poblacion_total >= 0),
    poblacion_hombres     bigint,
    poblacion_mujeres     bigint,
    procedencia_poblacion text,
    geom                  geometry(MultiPolygon, 4326),
    centroide             geometry(Point, 4326),
    creado_en             timestamptz  not null default now()
);

comment on table territorio.distrito is
    'Capa distrital GIS de geogpsperu, rotulada «Censo 2025» (no es una '
    'publicación del INEI). La geometría dice dónde está un territorio, no '
    'cuánto pesa: la población es SÓLO denominador (tasas por 100 000 hab.) y '
    'no entra en el nivel de riesgo. 1 892 filas: 1 891 del catálogo INEI y '
    '160405 SANTA ROSA DE LORETO, que la capa trae y el INEI no. Sin FK a '
    'core.distritos por ese ubigeo; la identidad es el ubigeo, nunca el id.';

comment on column territorio.distrito.ubigeo is
    'Código INEI de 6 dígitos (PK). Identidad estable entre entornos; no usar '
    'el id de core.distritos para exportar, importar ni comparar.';

comment on column territorio.distrito.nombre is
    'Nombre del distrito tal como lo trae la capa. No se normaliza contra el '
    'catálogo INEI: el nombre oficial y el de la capa pueden diferir en grafía.';

comment on column territorio.distrito.provincia is
    'Provincia de la capa (varchar, sin FK). Provincia y región son contexto '
    'de lectura, no una segunda fuente de verdad territorial.';

comment on column territorio.distrito.region is
    'Departamento (región) de la capa. Sólo para filtrar y rotular.';

comment on column territorio.distrito.poblacion_total is
    'Población censal del insumo (`properties.total` del GeoJSON; si falta, '
    '`Total` de distritos_capa.csv o `poblacion_capa` de distritos_maestro.csv, '
    'casando por UBIGEO). Denominador, no peso de riesgo. NULL si ningún '
    'insumo la trae: no se estima ni se reparte.';

comment on column territorio.distrito.poblacion_hombres is
    '`Hombre_T` de gis/derived/distritos_capa.csv, casado por UBIGEO (el '
    'GeoJSON no trae sexo). NULL cuando no hay fila o cuando Hombre_T+Mujer_T '
    'no cuadra con poblacion_total: no se estima ni se prorratea.';

comment on column territorio.distrito.poblacion_mujeres is
    '`Mujer_T` de gis/derived/distritos_capa.csv, casado por UBIGEO. Mismas '
    'reglas de NULL que poblacion_hombres: sin dato, no hay cifra inventada.';

comment on column territorio.distrito.procedencia_poblacion is
    'Texto por fila que declara de dónde salió cada cifra y qué quedó NULL. '
    'Auditoría de la carga; no se recalcula en consulta.';

comment on column territorio.distrito.geom is
    'MultiPolygon WGS84 (EPSG:4326). Dice dónde está el territorio, no cuánto '
    'pesa. La carga usa la capa simplificada salvo que se pida --completo.';

comment on column territorio.distrito.centroide is
    'PointOnSurface (no centroide geométrico): garantiza un punto dentro del '
    'polígono para etiquetas y mapas. Se calcula en la carga.';

comment on column territorio.distrito.creado_en is
    'Primera carga de la fila. Las recargas no la modifican.';

create index if not exists distrito_geom_idx
    on territorio.distrito using gist (geom);
create index if not exists distrito_centroide_idx
    on territorio.distrito using gist (centroide);
create index if not exists distrito_region_idx
    on territorio.distrito (region);
create index if not exists distrito_provincia_idx
    on territorio.distrito (provincia);

-- La aplicación sólo lee este catálogo; la carga la hace el rol dueño.
-- `avisa_api` hereda de `avisa_app` (ver migration/23).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'avisa_app') then
    execute 'grant usage on schema territorio to avisa_app';
    execute 'grant select on territorio.distrito to avisa_app';
  else
    raise notice 'rol avisa_app ausente: no se otorgaron privilegios sobre territorio.distrito';
  end if;
end $$;

insert into core.migracion_log (clave) values ('47_gis_distritos')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  No se borra la extensión postgis: la usan gis.* y otras capas.
-- =============================================================================
--
-- begin;
-- drop table if exists territorio.distrito;
-- delete from core.migracion_log where clave = '47_gis_distritos';
-- commit;
