-- =============================================================================
-- 75 · Unificar las capas geográficas bajo el esquema `territorio`
--
-- Fecha: 2026-11-27
--
-- Por qué existe esta migración
-- -----------------------------
-- Las capas geográficas quedaron repartidas en dos esquemas por historia, no por
-- diseño: `territorio` (distritos y lugares operativos) y `gis` (la capa de
-- puntos del KML y sus dos vistas derivadas). El mapa consume las dos, pero la
-- regla mental del producto es una sola: **lo geográfico vive en `territorio`**.
--
-- Hoy `lib/db/repos/territorio.ts` lee `territorio.distrito` y, trescientas
-- líneas más abajo, `gis.infraestructuras_puntos`. `migration/loader/cargar_gis.py`
-- escribe en `gis`, y `app/api/v1/territorio/capas/route.ts` documenta una tabla
-- de otro esquema. Tres nombres para una sola capa.
--
-- Qué hace (aditivo: no borra datos, no borra columnas)
-- ----------------------------------------------------
--   1. Mueve la tabla `gis.infraestructuras_puntos` a
--      `territorio.infraestructura_punto` con `ALTER TABLE … SET SCHEMA` y
--      `RENAME`. Es un cambio de nombre, no una copia: los 13 456 puntos, sus
--      índices, su PK, su FK a `core.distritos` y la geometría se mueven con la
--      tabla, sin reescribir filas.
--   2. Publica las vistas canónicas en `territorio`:
--        · `territorio.v_desembarcaderos`
--        · `territorio.v_infraestructuras_por_distrito`
--   3. Deja en `gis` **vistas de compatibilidad** con los nombres antiguos
--      (`gis.infraestructuras_puntos`, `gis.v_desembarcaderos`,
--      `gis.v_infraestructuras_por_distrito`). Así una consulta vieja —o el SQL
--      generado `gis/derived/0004_revincular_infraestructuras_por_nombre.sql`—
--      sigue funcionando durante la transición, sin apuntar a la tabla.
--
-- Limitación declarada: una vista admite `SELECT`, `INSERT`, `UPDATE` y
-- `DELETE` (la de compatibilidad es auto-actualizable porque es un `SELECT *`
-- de una sola tabla), pero **no** admite `TRUNCATE`. Por eso
-- `migration/loader/cargar_gis.py` escribe en `territorio.infraestructura_punto`
-- y no en el alias. Este archivo es el único punto del repositorio que nombra
-- `gis.*` a propósito.
--
-- Idempotente: se puede re-ejecutar. Si la tabla ya está en `territorio`, el
-- movimiento no hace nada; las vistas se recrean con `create or replace`.
--
-- Orden de ejecución: después de `migration/39_gis_infraestructuras.sql` (que es
-- quien crea la capa) o de cualquier carga con `cargar_gis.py`. Si la capa no
-- existe todavía, la migración no inventa una tabla vacía: avisa y no hace nada.
-- =============================================================================

begin;

create schema if not exists territorio;

-- 1 · Mover la tabla de puntos -------------------------------------------------
-- `SET SCHEMA` conserva el OID: los índices, la PK, la FK a `core.distritos` y
-- la geometría viajan con la tabla. El `relkind = 'r'` protege el caso de una
-- base donde la 75 ya corrió y `gis.infraestructuras_puntos` es una vista.
do $$
begin
  if to_regclass('territorio.infraestructura_punto') is null
     and to_regclass('gis.infraestructuras_puntos') is not null
     and (
       select c.relkind
         from pg_class c
        where c.oid = to_regclass('gis.infraestructuras_puntos')
     ) = 'r'
  then
    alter table gis.infraestructuras_puntos set schema territorio;
    alter table territorio.infraestructuras_puntos
      rename to infraestructura_punto;
    raise notice 'tabla movida: gis.infraestructuras_puntos → territorio.infraestructura_punto';
  end if;
end
$$;

-- 2 · Vistas canónicas y alias de compatibilidad -------------------------------
-- El bloque entero depende de que la tabla canónica exista. Si no existe, no se
-- crean vistas vacías que fingirían una capa cargada.
do $$
begin
  if to_regclass('territorio.infraestructura_punto') is null then
    raise notice 'capa de infraestructuras ausente: aplicá migration/39 y cargá con migration/loader/cargar_gis.py antes de la 75';
    return;
  end if;

  -- 2.1 · Desembarcaderos artesanales (DPA) ----------------------------------
  execute $v$
    create or replace view territorio.v_desembarcaderos as
    select id,
           identi,
           coalesce(nombre_infraestructura, nombre) as nombre,
           departamento,
           provincia,
           distrito,
           ubigeo,
           latitud,
           longitud,
           geom
      from territorio.infraestructura_punto
     where tipo_registro = 'institucional'
       and identi like 'DPA%'
  $v$;

  comment on view territorio.v_desembarcaderos is
    'Puntos DPA - GORE (desembarcaderos artesanales). Incluye la fila con la errata "DPA -GORE".';

  -- 2.2 · Densidad por distrito ----------------------------------------------
  execute $v$
    create or replace view territorio.v_infraestructuras_por_distrito as
    select d.id                                        as distrito_id,
           d.ubigeo::text                              as ubigeo,
           d.nombre                                    as distrito,
           p.nombre                                    as provincia,
           r.nombre                                    as departamento,
           count(*) filter (where i.tipo_registro = 'derecho_acuicola') as derechos_acuicolas,
           count(*) filter (where i.tipo_registro = 'institucional')    as institucionales,
           count(*)                                    as total,
           coalesce(sum(i.area_total_ha) filter (where i.tipo_registro = 'derecho_acuicola'), 0)
                                                       as area_otorgada_ha
      from territorio.infraestructura_punto i
      join core.distritos   d on d.id = i.distrito_id
      join core.provincias  p on p.id = d.provincia_id
      join core.regiones    r on r.id = p.region_id
     group by d.id, d.ubigeo, d.nombre, p.nombre, r.nombre
  $v$;

  comment on view territorio.v_infraestructuras_por_distrito is
    'Resumen por distrito de la capa de infraestructuras. Sólo cubre los ubigeos presentes en core.distritos.';

  -- 2.3 · Alias en `gis` para no romper consumidores antiguos -----------------
  -- La vista es `SELECT *` de una sola tabla: PostgreSQL la trata como
  -- auto-actualizable, de modo que el SQL generado de revinculación (que hace
  -- `UPDATE`) sigue funcionando. `TRUNCATE` no: el loader ya usa el nombre nuevo.
  if to_regclass('gis.infraestructuras_puntos') is null then
    create view gis.infraestructuras_puntos as
      select * from territorio.infraestructura_punto;
  elsif (
    select c.relkind from pg_class c
     where c.oid = to_regclass('gis.infraestructuras_puntos')
  ) = 'v' then
    create or replace view gis.infraestructuras_puntos as
      select * from territorio.infraestructura_punto;
  else
    raise notice 'gis.infraestructuras_puntos sigue siendo una tabla: quedan dos copias de la capa, revisar a mano';
  end if;

  execute $v$
    create or replace view gis.v_desembarcaderos as
      select * from territorio.v_desembarcaderos
  $v$;

  execute $v$
    create or replace view gis.v_infraestructuras_por_distrito as
      select * from territorio.v_infraestructuras_por_distrito
  $v$;

  execute $v$
    comment on view gis.infraestructuras_puntos is
      'Compatibilidad (migración 75): la capa vive en territorio.infraestructura_punto. No escribir aquí; usar el nombre canónico.'
  $v$;

  execute $v$
    comment on view gis.v_desembarcaderos is
      'Compatibilidad (migración 75): usar territorio.v_desembarcaderos.'
  $v$;

  execute $v$
    comment on view gis.v_infraestructuras_por_distrito is
      'Compatibilidad (migración 75): usar territorio.v_infraestructuras_por_distrito.'
  $v$;
end
$$;

-- 3 · Privilegios -------------------------------------------------------------
-- El ACL de la tabla viaja con ella, pero las vistas nuevas hay que otorgarlas
-- explícitamente: en PostgreSQL el GRANT sobre una vista no se hereda de su
-- tabla base. Se guarda la existencia de los roles para no romper una carga
-- standalone en una base sin roles creados (mismo criterio que la 39).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'avisa_app') then
    execute 'grant usage on schema territorio to avisa_app';
    execute 'grant select on territorio.infraestructura_punto to avisa_app';
    execute 'grant select on territorio.v_desembarcaderos to avisa_app';
    execute 'grant select on territorio.v_infraestructuras_por_distrito to avisa_app';
    execute 'grant select on gis.infraestructuras_puntos to avisa_app';
    execute 'grant select on gis.v_desembarcaderos to avisa_app';
    execute 'grant select on gis.v_infraestructuras_por_distrito to avisa_app';
    execute 'alter default privileges in schema territorio '
            'grant select on tables to avisa_app';
  else
    raise notice 'rol avisa_app ausente: no se otorgaron privilegios sobre la capa';
  end if;
end
$$;

insert into core.migracion_log (clave)
values ('75_unificar_territorio_gis_2026_11_27')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones (ejecutar con el rol dueño)
-- -----------------------------------------------------------------------------
-- 1 · La tabla está en `territorio` y ya no hay tabla en `gis`:
-- select to_regclass('territorio.infraestructura_punto') as canonica,
--        (select relkind from pg_class
--          where oid = to_regclass('gis.infraestructuras_puntos')) as alias_gis;
--   → canonica = territorio.infraestructura_punto, alias_gis = 'v'
--
-- 2 · Los conteos coinciden con la carga vigente (13 456 y 13 404 dibujables):
-- select count(*) from territorio.infraestructura_punto;
-- select count(*) from gis.infraestructuras_puntos;  -- el alias devuelve lo mismo
--
-- 3 · Las vistas servidas por la API:
-- select count(*) from territorio.v_desembarcaderos;              -- 31
-- select count(*) from territorio.v_infraestructuras_por_distrito;
--
-- 4 · El rol de la aplicación puede leer el nombre canónico:
-- set local role avisa_api;
-- select count(*) from territorio.infraestructura_punto;
-- reset role;
-- -----------------------------------------------------------------------------
-- Reversión manual (a mano, en su propia transacción). No se recomienda: deja
-- `gis` como esquema de escritura otra vez y vuelve a partir el mapa mental.
-- -----------------------------------------------------------------------------
-- begin;
-- drop view if exists gis.infraestructuras_puntos;
-- drop view if exists gis.v_desembarcaderos;
-- drop view if exists gis.v_infraestructuras_por_distrito;
-- alter table territorio.infraestructura_punto set schema gis;
-- alter table gis.infraestructura_punto rename to infraestructuras_puntos;
-- drop view if exists territorio.v_desembarcaderos;
-- drop view if exists territorio.v_infraestructuras_por_distrito;
-- delete from core.migracion_log where clave = '75_unificar_territorio_gis_2026_11_27';
-- commit;
