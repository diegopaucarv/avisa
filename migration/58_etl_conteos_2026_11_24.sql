-- =============================================================================
-- 58 · Conteos para la consola ETL
--
-- Fecha: 2026-11-24
--
-- Por qué existe esta migración
-- -----------------------------
-- La consola ETL muestra el estado real de la ingesta: cuántas tablas y filas
-- hay en cada esquema del pipeline (`core`, `legacy`, `staging`). El rol de la
-- API (`avisa_api`) tiene USAGE en `core`, pero no en `legacy` ni en `staging`
-- (verificado con `has_schema_privilege`), así que no puede contar esas tablas
-- directamente.
--
-- Qué añade
-- ---------
-- · `core.etl_conteos()`: función `SECURITY DEFINER` que devuelve
--   `(esquema, tabla, filas)` para cada tabla ordinaria o particionada de
--   `core`, `legacy` y `staging`. Sólo expone cardinalidades, nunca filas.
-- · Permiso de ejecución exclusivo para `avisa_api` (se revoca de PUBLIC).
-- · Registra la migración en `core.migracion_log`.
--
-- No cambia el esquema de datos, ni las políticas RLS, ni los catálogos.
--
-- Seguridad
-- ---------
-- `set search_path = pg_catalog, pg_temp` evita que un `search_path` ajeno
-- resuelva objetos homónimos. El cuerpo sólo lee `pg_class`/`pg_namespace` y
-- ejecuta `count(*)`, sin parámetros de entrada y sin devolver contenido.
--
-- Cómo revertir
-- -------------
--   begin;
--   drop function if exists core.etl_conteos();
--   delete from core.migracion_log where clave = '58_etl_conteos_2026_11_24';
--   commit;
-- =============================================================================

begin;

create or replace function core.etl_conteos()
returns table (esquema text, tabla text, filas bigint)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_esquema text;
  v_tabla text;
begin
  foreach v_esquema in array array['core', 'legacy', 'staging']
  loop
    for v_tabla in
      select c.relname::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = v_esquema
        and c.relkind in ('r', 'p')
      order by c.relname
    loop
      return query execute format(
        'select %L::text, %L::text, count(*)::bigint from %I.%I',
        v_esquema, v_tabla, v_esquema, v_tabla
      );
    end loop;
  end loop;
end;
$$;

comment on function core.etl_conteos() is
  'Conteos exactos por tabla de core, legacy y staging. SECURITY DEFINER: sólo cardinalidades, nunca filas. Consumida por /api/v1/etl/resumen.';

revoke all on function core.etl_conteos() from public;
grant execute on function core.etl_conteos() to avisa_api;

insert into core.migracion_log (clave)
values ('58_etl_conteos_2026_11_24')
on conflict (clave) do nothing;

commit;
