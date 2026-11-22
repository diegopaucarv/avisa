-- =============================================================================
--  17 · Cuentas de acceso y privilegios
--
--  Requiere: migration/14, 15 y 16 aplicadas.
--
--  Qué cambia
--  ----------
--  1. core.autenticar_usuario(): el rol primario que devuelve (`rol_codigo`) se
--     elige con una prioridad explícita. Hasta ahora `direccion_oaipcs` iba
--     primero, de modo que una cuenta con todos los roles entraba como
--     directora y no como administradora. Se invierte: `administrador` manda.
--  2. Cuenta demo de Alta Dirección (DNI 22222222), clave `demo`, sólo con el
--     rol `alta_direccion` (lectura: puede_crear / puede_editar / puede_eliminar
--     en false, según `core.roles`).
--  3. Cuenta `11111111` («Admin»): todos los roles y clave `demo`. Su hash
--     estaba bloqueado con el prefijo `!`, así que no podía entrar.
--  4. Edith Bautista León (DNI 41907320): se queda **sólo** con
--     `direccion_oaipcs`. Pierde `administrador`, `alta_direccion` y
--     `sectorista`, que usaba para tener todos los permisos.
--     `direccion_oaipcs` conserva `puede_crear` / `puede_editar`: sigue
--     pudiendo editar, pero no eliminar.
--
--  Credenciales resultantes (todas con clave `demo`)
--  -------------------------------------------------
--    41907320  Edith Bautista León .......... direccion_oaipcs
--    22222222  Alta Dirección (demo) ........ alta_direccion
--    11111111  Admin ........................ todos los roles
--    10654038  Peggy Contreras Montes ....... sectorista
--    46078289  André Jiménez Agapito ........ consulta_lectura + sectorista
--
--  Notas de seguridad
--  ------------------
--    · Todas las sentencias son idempotentes: se pueden reejecutar.
--    · El hash que se asigna es el mismo bcrypt `$2a$06$` que ya usan las
--      cuentas de prueba; `demo` queda verificado por `core.autenticar_usuario`.
--    · No se toca ninguna otra cuenta ni ningún otro rol.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Prioridad de roles: `administrador` es el rol primario cuando coexiste
-- -----------------------------------------------------------------------------
create or replace function core.autenticar_usuario(p_dni text, p_password text)
returns table(usuario_id uuid, codigo_legado text, nombre text, dni text, email text, cargo text, unidad_siglas text, rol_codigo text, roles text[], regiones text[])
language sql
stable security definer
set search_path to 'pg_catalog', 'core', 'public'
as $function$
    with candidato as (
        select u.*
          from core.usuarios u
         where btrim(u.dni) = btrim(p_dni)
           and u.activo
           and u.clave_hash is not null
           and u.clave_hash = crypt(p_password, u.clave_hash)
    ),
    roles_vigentes as (
        select ur.usuario_id,
               array_agg(
                   ro.codigo::text
                   order by case ro.codigo
                       when 'administrador' then 1
                       when 'direccion_oaipcs' then 2
                       when 'alta_direccion' then 3
                       when 'sectorista' then 4
                       when 'consulta_lectura' then 5
                       when 'auditor' then 6
                       when 'analista_cualitativo' then 7
                       when 'curador_politica' then 8
                       when 'servicio_agente' then 9
                       when 'externo_publico' then 10
                       else 99
                   end
               ) as roles
          from core.usuario_roles ur
          join core.roles ro on ro.id = ur.rol_id
         where ur.hasta is null or ur.hasta >= current_date
         group by ur.usuario_id
    )
    select c.id,
           c.codigo_legado::text,
           c.nombre::text,
           c.dni::text,
           c.email::text,
           c.cargo::text,
           cu.siglas::text,
           rv.roles[1],
           rv.roles,
           (select array_agg(reg.nombre::text order by reg.nombre)
              from core.usuario_territorio ut
              join core.regiones reg on reg.id = ut.region_id
             where ut.usuario_id = c.id)
      from candidato c
      left join core.cat_unidades_organicas cu on cu.id = c.unidad_id
      left join roles_vigentes rv on rv.usuario_id = c.id;
$function$;

comment on function core.autenticar_usuario(text, text) is
  'Autentica por DNI y clave bcrypt. `rol_codigo` es el rol de mayor jerarquía: administrador > direccion_oaipcs > alta_direccion > sectorista > …';

-- -----------------------------------------------------------------------------
-- 2 · Cuenta demo de Alta Dirección
-- -----------------------------------------------------------------------------
do $$
declare
  v_hash text := '$2a$06$I14mRovsEhhj29acBpLRl.xGTpKvWHeT4gkDbnXRy/o6rjK/JQuqe';  -- bcrypt de `demo`
  v_id   uuid;
begin
  select id into v_id from core.usuarios where dni = '22222222';

  if v_id is null then
    insert into core.usuarios (dni, nombre, cargo, activo, clave_hash)
    values ('22222222', 'Alta Dirección (demo)', 'Cuenta demo de Alta Dirección', true, v_hash)
    returning id into v_id;
  else
    update core.usuarios
       set nombre     = 'Alta Dirección (demo)',
           cargo      = 'Cuenta demo de Alta Dirección',
           activo     = true,
           clave_hash = v_hash
     where id = v_id;
  end if;

  -- Sólo `alta_direccion`: se retiran los demás roles vigentes.
  delete from core.usuario_roles
   where usuario_id = v_id
     and rol_id <> (select id from core.roles where codigo = 'alta_direccion');

  insert into core.usuario_roles (usuario_id, rol_id, desde)
  select v_id, r.id, current_date
    from core.roles r
   where r.codigo = 'alta_direccion'
     and not exists (
       select 1 from core.usuario_roles ur
        where ur.usuario_id = v_id and ur.rol_id = r.id);
end $$;

-- -----------------------------------------------------------------------------
-- 3 · Cuenta «Admin» (11111111): todos los roles y clave operativa
-- -----------------------------------------------------------------------------
do $$
declare
  v_hash text := '$2a$06$I14mRovsEhhj29acBpLRl.xGTpKvWHeT4gkDbnXRy/o6rjK/JQuqe';  -- bcrypt de `demo`
  v_id   uuid;
begin
  select id into v_id from core.usuarios where dni = '11111111';

  if v_id is null then
    insert into core.usuarios (dni, nombre, cargo, activo, clave_hash)
    values ('11111111', 'Admin', 'Cuenta de administración del sistema', true, v_hash)
    returning id into v_id;
  else
    update core.usuarios
       set activo     = true,
           clave_hash = v_hash
     where id = v_id;
  end if;

  -- Un rol por cada fila de `core.roles` (hoy diez).
  insert into core.usuario_roles (usuario_id, rol_id, desde)
  select v_id, r.id, current_date
    from core.roles r
   where not exists (
     select 1 from core.usuario_roles ur
      where ur.usuario_id = v_id and ur.rol_id = r.id);
end $$;

-- -----------------------------------------------------------------------------
-- 4 · Edith Bautista León: sólo `direccion_oaipcs`
-- -----------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  select id into v_id from core.usuarios where dni = '41907320';

  if v_id is null then
    raise exception 'No existe la usuaria con DNI 41907320; nada que ajustar';
  end if;

  delete from core.usuario_roles
   where usuario_id = v_id
     and rol_id <> (select id from core.roles where codigo = 'direccion_oaipcs');

  insert into core.usuario_roles (usuario_id, rol_id, desde)
  select v_id, r.id, current_date
    from core.roles r
   where r.codigo = 'direccion_oaipcs'
     and not exists (
       select 1 from core.usuario_roles ur
        where ur.usuario_id = v_id and ur.rol_id = r.id);
end $$;

-- -----------------------------------------------------------------------------
-- 5 · Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
select u.dni, u.nombre, u.activo,
       string_agg(r.codigo, ', ' order by r.codigo) as roles
  from core.usuarios u
  left join core.usuario_roles ur on ur.usuario_id = u.id
  left join core.roles r on r.id = ur.rol_id
 where u.dni in ('41907320', '22222222', '11111111', '10654038', '46078289')
 group by u.id, u.dni, u.nombre, u.activo
 order by u.dni;

select dni, rol_codigo, roles, regiones
  from core.autenticar_usuario('41907320', 'demo');
select dni, rol_codigo, roles, regiones
  from core.autenticar_usuario('22222222', 'demo');
select dni, rol_codigo, roles, regiones
  from core.autenticar_usuario('11111111', 'demo');

commit;
