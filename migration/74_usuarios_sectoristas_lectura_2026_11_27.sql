-- =============================================================================
-- 74 · Lectura de sectoristas sin chocar con la RLS de `core.usuarios`
--
-- Fecha: 2026-11-27
--
-- Por qué existe esta migración
-- -----------------------------
-- `core.usuarios` y `core.usuario_roles` tienen RLS habilitada con una política
-- de SELECT que sólo deja ver al rol `administrador` o la fila propia:
--
--     core.rol_actual() = 'administrador'
--     OR id::text = current_setting('app.usuario_id', true)
--
-- La API conecta con `avisa_api` (NOSUPERUSER NOBYPASSRLS, hereda de
-- `avisa_app`), así que **ningún** otro rol ve las filas ajenas. Consecuencia
-- observable: el catálogo `sectoristas` de `GET /api/v1/catalogs` volvía vacío
-- y `updateCase` respondía 422 `SECTORISTA_INVALIDO` al asignar un punto focal,
-- porque ambos leían esas dos tablas bajo la RLS de la sesión. El síntoma de la
-- interfaz era «el sectorista no se puede modificar»: el desplegable no tenía
-- opciones y el campo se quedaba en sólo lectura.
--
-- Qué agrega (sólo funciones, nada de DROP)
-- ----------------------------------------
--   · `core.nombres_sectoristas()` → pares (id, nombre) de los usuarios activos
--     con rol `sectorista` vigente. Es exactamente lo que necesita el selector:
--     el UUID del usuario y su nombre, ni DNI, ni teléfono, ni correo, ni hash.
--   · `core.es_sectorista(uuid)` → booleano. Permite validar la asignación sin
--     leer la fila del usuario.
--
-- Ambas son `SECURITY DEFINER` y fijan `search_path`; por eso deben crearse con
-- el rol dueño del esquema (en Neon, `neondb_owner`), que no queda sujeto a la
-- RLS de la tabla. Exponen el mínimo imprescindible: nombre y pertenencia al
-- rol, nunca datos personales.
--
-- Nota: la lectura del *nombre* del sectorista en el listado de casos sigue
-- haciéndose con el join a `core.usuarios`; para roles distintos de
-- `administrador` ese nombre llega nulo y la ficha lo resuelve en el cliente
-- con este mismo catálogo.
-- =============================================================================

begin;

-- 1 · Nombres de los sectoristas asignables -----------------------------------
create or replace function core.nombres_sectoristas()
returns table (id uuid, nombre text)
language sql
stable
security definer
set search_path = core, pg_temp
as $$
  select u.id, u.nombre
    from core.usuarios u
    join core.usuario_roles ur on ur.usuario_id = u.id
    join core.roles r on r.id = ur.rol_id
   where u.activo
     and r.codigo = 'sectorista'
     and (ur.hasta is null or ur.hasta >= current_date)
   group by u.id, u.nombre
   order by u.nombre
$$;

comment on function core.nombres_sectoristas() is
  'Par (id, nombre) de usuarios activos con rol sectorista vigente. Security definer: resuelve la RLS de core.usuarios para el selector de punto focal.';

-- 2 · Validación de la asignación ---------------------------------------------
create or replace function core.es_sectorista(p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, pg_temp
as $$
  select exists (
    select 1
      from core.usuarios u
      join core.usuario_roles ur on ur.usuario_id = u.id
      join core.roles r on r.id = ur.rol_id
     where u.id = p_usuario_id
       and u.activo
       and r.codigo = 'sectorista'
       and (ur.hasta is null or ur.hasta >= current_date)
  )
$$;

comment on function core.es_sectorista(uuid) is
  'true si el usuario existe, está activo y tiene el rol sectorista vigente. Security definer: valida sin exponer la fila de core.usuarios.';

-- 3 · Privilegios -------------------------------------------------------------
-- Por defecto PostgreSQL concede EXECUTE a PUBLIC: se retira y se otorga sólo a
-- los roles de la aplicación.
revoke all on function core.nombres_sectoristas() from public;
revoke all on function core.es_sectorista(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'avisa_app') then
    execute 'grant execute on function core.nombres_sectoristas() to avisa_app';
    execute 'grant execute on function core.es_sectorista(uuid) to avisa_app';
  end if;
  if exists (select 1 from pg_roles where rolname = 'avisa_api') then
    execute 'grant execute on function core.nombres_sectoristas() to avisa_api';
    execute 'grant execute on function core.es_sectorista(uuid) to avisa_api';
  end if;
end
$$;

insert into core.migracion_log (clave)
values ('74_usuarios_sectoristas_lectura_2026_11_27')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones (ejecutar con el rol dueño)
-- -----------------------------------------------------------------------------
-- Debe listar los sectoristas activos y vigentes.
-- select * from core.nombres_sectoristas();
--
-- Debe devolver true para un sectorista del listado y false para un UUID ajeno.
-- select core.es_sectorista((select id from core.nombres_sectoristas() limit 1));
-- select core.es_sectorista('00000000-0000-0000-0000-000000000000');
--
-- Con el rol de la aplicación debe verse el mismo listado (la función lo salta):
-- set local role avisa_api;
-- select count(*) from core.nombres_sectoristas();
-- reset role;
