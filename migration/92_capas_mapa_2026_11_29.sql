-- =============================================================================
-- 92 · Capas de mapa 2026-11-29 · región, provincia y Reserva Nacional (ANP)
--
-- POR QUÉ EXISTE
-- --------------
-- El mapa nacional pinta hoy 1 892 polígonos distritales. Para una lectura
-- coroplética nacional eso es demasiado detalle y no deja ver la cifra por
-- región ni por provincia. Esta migración pre-calcula tres capas derivadas,
-- SIEMPRE aditivas, sin copiar catálogos ni tocar `territorio.distrito`:
--
--   territorio.region                · 25 filas  · PK `ubigeo` char(2)
--   territorio.provincia             · 196 filas · PK `ubigeo` char(4)
--   territorio.anp_reserva_nacional  · sólo la tabla (la carga es un script)
--
-- Las dos primeras se materializan aquí desde la capa distrital agrupando por
-- prefijo de ubigeo. La tercera sólo se crea: sus 48 geometrías del SERNANP se
-- cargan con `scripts/_cargar_anp_reserva_nacional.mjs` para no meter WKT
-- gigantes dentro de un archivo de migración.
--
-- REGLA DEL PROYECTO
--   La geometría dice DÓNDE está un territorio, no cuánto pesa. La población es
--   SÓLO denominador (tasas por 100 000 hab.); jamás entra en el nivel de riesgo.
--
-- DESVIACIÓN DECLARADA RESPECTO DEL BRIEF: ST_MakeValid
-- -----------------------------------------------------
-- El brief pedía `ST_Union(geom)` literal. En esta base esa unión falla con
-- `TopologyException: side location conflict` porque varios polígonos
-- distritales son inválidos (`ST_IsValid = false`). Por eso cada geometría se
-- sanea con `ST_MakeValid` ANTES de unir:
--
--   ST_Union(ST_MakeValid(d.geom))
--
-- No cambia el resultado deseado (la silueta del grupo); sólo evita que un
-- insumo inválido tumbe la materialización. La geometría se simplifica a 0.01°
-- con `ST_SimplifyPreserveTopology` y se normaliza a MultiPolygon con `ST_Multi`.
--
-- IDEMPOTENTE / ADITIVA
--   `create table if not exists`, `insert ... on conflict ... do update` y
--   `create index if not exists`. No borra ni altera objetos preexistentes. Se
--   puede re-ejecutar sin efecto acumulativo.
-- =============================================================================

begin;

create extension if not exists postgis;
create schema if not exists core;
create schema if not exists territorio;

create table if not exists core.migracion_log (
    clave       text        primary key,
    aplicada_en timestamptz not null default now()
);

-- La capa distrital y el catálogo de regiones son la fuente. Sin ellos no hay
-- nada que unir: se corta con un mensaje accionable en vez de crear tablas
-- vacías que finjan una capa.
do $$
begin
  if to_regclass('territorio.distrito') is null then
    raise exception
      'territorio.distrito no existe: aplicá migration/47_gis_distritos.sql antes de la 92';
  end if;
  if to_regclass('core.regiones') is null then
    raise exception
      'core.regiones no existe: no se puede resolver region_id ni el nombre de la región';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 1 · territorio.region — 25 filas
-- -----------------------------------------------------------------------------
create table if not exists territorio.region (
    ubigeo         char(2)               primary key
        check (ubigeo ~ '^[0-9]{2}$'),
    region_id      int                   references core.regiones(id),
    nombre         text                  not null,
    poblacion_total bigint,
    geom           geometry(MultiPolygon, 4326) not null,
    centroide      geometry(Point, 4326),
    actualizado_en timestamptz           default now()
);

comment on table territorio.region is
    'Capa coroplética de región (25 filas), derivada de territorio.distrito por '
    'left(ubigeo,2). La geometría dice dónde está el territorio, no cuánto pesa: '
    'poblacion_total es SÓLO denominador, nunca peso de riesgo. No reemplaza a '
    'core.regiones (catálogo con alcance geográfico).';
comment on column territorio.region.ubigeo is
    'Código INEI de región de 2 dígitos (PK). Identidad estable entre entornos.';
comment on column territorio.region.region_id is
    'FK a core.regiones.id resuelta por ubigeo; la API la expone como regionId.';
comment on column territorio.region.poblacion_total is
    'Suma de poblacion_total distrital del grupo. Denominador, no peso. NULL si '
    'ningún distrito del grupo trae población: no se estima.';
comment on column territorio.region.geom is
    'MultiPolygon WGS84 (4326): unión de los distritos, saneada con ST_MakeValid '
    'y simplificada a 0.01°.';
comment on column territorio.region.centroide is
    'ST_PointOnSurface de la unión: punto siempre dentro del polígono, para etiquetas.';

-- -----------------------------------------------------------------------------
-- 2 · territorio.provincia — 196 filas
-- -----------------------------------------------------------------------------
create table if not exists territorio.provincia (
    ubigeo         char(4)               primary key
        check (ubigeo ~ '^[0-9]{4}$'),
    region_ubigeo  char(2)               not null,
    nombre         text                  not null,
    poblacion_total bigint,
    geom           geometry(MultiPolygon, 4326),
    centroide      geometry(Point, 4326)
);

comment on table territorio.provincia is
    'Capa coroplética de provincia (196 filas), derivada de territorio.distrito '
    'por left(ubigeo,4). Sin FK a core.provincias: la identidad es el ubigeo. La '
    'población es SÓLO denominador.';
comment on column territorio.provincia.ubigeo is
    'Código INEI de provincia de 4 dígitos (PK): left(distrito.ubigeo,4).';
comment on column territorio.provincia.region_ubigeo is
    'Ubigeo de región de la provincia: left(distrito.ubigeo,2). La API la expone '
    'como regionUbigeo.';
comment on column territorio.provincia.nombre is
    'Nombre de provincia más frecuente del grupo (mode() sobre la capa distrital).';
comment on column territorio.provincia.poblacion_total is
    'Suma de poblacion_total distrital del grupo. Denominador, no peso.';
comment on column territorio.provincia.geom is
    'MultiPolygon WGS84 (4326): unión de los distritos, saneada y simplificada a 0.01°.';
comment on column territorio.provincia.centroide is
    'ST_PointOnSurface de la unión: punto dentro del polígono, para etiquetas.';

-- -----------------------------------------------------------------------------
-- 3 · territorio.anp_reserva_nacional — sólo la tabla
-- -----------------------------------------------------------------------------
create table if not exists territorio.anp_reserva_nacional (
    id         integer generated always as identity primary key,
    codigo     text                    unique not null,
    nombre     text                    not null,
    categoria  text                    not null default 'Reserva Nacional',
    geom       geometry(MultiPolygon, 4326) not null,
    creado_en  timestamptz             default now()
);

comment on table territorio.anp_reserva_nacional is
    'Áreas Naturales Protegidas de categoría «Reserva Nacional» del SERNANP. Sólo '
    'lectura para la aplicación; la carga la hace '
    'scripts/_cargar_anp_reserva_nacional.mjs con el rol dueño.';
comment on column territorio.anp_reserva_nacional.codigo is
    'anp_codi del shapefile (p. ej. RN01). Clave natural del upsert.';
comment on column territorio.anp_reserva_nacional.nombre is
    'anp_nomb del shapefile.';
comment on column territorio.anp_reserva_nacional.categoria is
    'anp_cate; en esta tabla siempre «Reserva Nacional» (es el filtro de carga).';
comment on column territorio.anp_reserva_nacional.geom is
    'MultiPolygon WGS84 (4326). Las secciones de un mismo codigo (RN05, RN18) se '
    'disuelven con ST_Union en la carga.';

-- Compatibilidad aditiva con un borrador previo que nombró la columna de
-- población `poblacion` (y no traía `creado_en` en ANP). En una base nueva
-- estas sentencias no hacen nada; en una que ya tenga las tablas del borrador
-- añaden sólo lo que falta, sin borrar ni renombrar nada.
alter table territorio.region
    add column if not exists poblacion_total bigint;
alter table territorio.provincia
    add column if not exists poblacion_total bigint;
alter table territorio.provincia
    add column if not exists region_ubigeo char(2);
alter table territorio.anp_reserva_nacional
    add column if not exists creado_en timestamptz default now();

-- -----------------------------------------------------------------------------
-- 4 · Poblado idempotente (on conflict do update) de región y provincia
-- -----------------------------------------------------------------------------
-- La unión se calcula una sola vez por grupo en el CTE `agregado`; de ahí salen
-- la geometría simplificada y el centroide. `ST_MakeValid` se explica arriba.
with agregado as (
    select left(d.ubigeo::text, 2) as ub,
           coalesce(min(d.region), 'Región ' || left(d.ubigeo::text, 2)) as region_capa,
           sum(d.poblacion_total)::bigint as poblacion,
           ST_Union(ST_MakeValid(d.geom)) as union_geom
      from territorio.distrito d
     group by 1
)
insert into territorio.region (
    ubigeo, region_id, nombre, poblacion_total, geom, centroide, actualizado_en
)
select a.ub::char(2),
       r.id,
       coalesce(r.nombre, a.region_capa),
       a.poblacion,
       ST_Multi(ST_SimplifyPreserveTopology(a.union_geom, 0.01)),
       ST_PointOnSurface(a.union_geom),
       now()
  from agregado a
  left join core.regiones r on r.ubigeo = a.ub::char(2)
on conflict (ubigeo) do update
   set region_id       = excluded.region_id,
       nombre          = excluded.nombre,
       poblacion_total = excluded.poblacion_total,
       geom            = excluded.geom,
       centroide       = excluded.centroide,
       actualizado_en  = now();

with agregado as (
    select left(d.ubigeo::text, 4) as ub,
           mode() within group (order by d.provincia) as provincia,
           sum(d.poblacion_total)::bigint as poblacion,
           ST_Union(ST_MakeValid(d.geom)) as union_geom
      from territorio.distrito d
     group by 1
)
insert into territorio.provincia (
    ubigeo, region_ubigeo, nombre, poblacion_total, geom, centroide
)
select a.ub::char(4),
       left(a.ub, 2)::char(2),
       coalesce(a.provincia, 'Provincia ' || a.ub),
       a.poblacion,
       ST_Multi(ST_SimplifyPreserveTopology(a.union_geom, 0.01)),
       ST_PointOnSurface(a.union_geom)
  from agregado a
on conflict (ubigeo) do update
   set region_ubigeo   = excluded.region_ubigeo,
       nombre          = excluded.nombre,
       poblacion_total = excluded.poblacion_total,
       geom            = excluded.geom,
       centroide       = excluded.centroide;

analyze territorio.region;
analyze territorio.provincia;

-- -----------------------------------------------------------------------------
-- 5 · Índices espaciales GIST (las tres geometrías)
-- -----------------------------------------------------------------------------
create index if not exists region_geom_idx
    on territorio.region using gist (geom);
create index if not exists provincia_geom_idx
    on territorio.provincia using gist (geom);
create index if not exists anp_reserva_nacional_geom_idx
    on territorio.anp_reserva_nacional using gist (geom);

-- -----------------------------------------------------------------------------
-- 6 · Privilegios (mismo rol de aplicación que la migración 47: avisa_app)
-- -----------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'avisa_app') then
    execute 'grant usage on schema territorio to avisa_app';
    execute 'grant select on territorio.region to avisa_app';
    execute 'grant select on territorio.provincia to avisa_app';
    execute 'grant select on territorio.anp_reserva_nacional to avisa_app';
  else
    raise notice 'rol avisa_app ausente: no se otorgaron privilegios sobre las capas 92';
  end if;
end $$;

insert into core.migracion_log (clave)
values ('92_capas_mapa_2026_11_29')
on conflict (clave) do nothing;

-- -----------------------------------------------------------------------------
-- 7 · Guardas finales: fallar ruidosamente si el resultado no es el esperado
-- -----------------------------------------------------------------------------
do $$
declare
  n      int;
  vacias int;
  sin_reg int;
begin
  select count(*) into n from territorio.region;
  if n <> 25 then
    raise exception 'territorio.region debe tener 25 filas, tiene %', n;
  end if;

  select count(*) into vacias
    from territorio.region
   where geom is null or ST_IsEmpty(geom);
  if vacias <> 0 then
    raise exception 'territorio.region tiene % geometrías nulas o vacías', vacias;
  end if;

  select count(*) into sin_reg
    from territorio.region
   where region_id is null;
  if sin_reg <> 0 then
    raise exception
      'territorio.region tiene % filas sin region_id de core.regiones', sin_reg;
  end if;
end
$$;

do $$
declare
  n      int;
  vacias int;
begin
  select count(*) into n from territorio.provincia;
  if n < 190 or n > 200 then
    raise exception
      'territorio.provincia debe tener ~196 filas (190–200), tiene %', n;
  end if;

  select count(*) into vacias
    from territorio.provincia
   where geom is null or ST_IsEmpty(geom);
  if vacias <> 0 then
    raise exception 'territorio.provincia tiene % geometrías nulas o vacías', vacias;
  end if;
end
$$;

do $$
begin
  if to_regclass('territorio.anp_reserva_nacional') is null then
    raise exception 'no se creó territorio.anp_reserva_nacional';
  end if;
end
$$;

commit;

-- =============================================================================
--  Reversión manual (a mano, en su propia transacción)
-- =============================================================================
--
-- begin;
-- drop table if exists territorio.anp_reserva_nacional;
-- drop table if exists territorio.provincia;
-- drop table if exists territorio.region;
-- delete from core.migracion_log where clave = '92_capas_mapa_2026_11_29';
-- commit;
--
-- Comprobaciones útiles (rol dueño):
--   select count(*) from territorio.region;                              -- 25
--   select count(*) from territorio.provincia;                           -- ~196
--   select count(*) from territorio.region where ST_IsEmpty(geom);       -- 0
--   select count(*) from territorio.anp_reserva_nacional;                -- 0 (la carga es aparte)
