-- =============================================================================
--  D3 · Capa de datos base (migración revisada, no destructiva)
--
--  Objetivo: habilitar la autenticación contra core.usuarios sin romper la RLS.
--
--  Contexto: 52 de las 103 tablas de core tienen RLS con FORCE. Las políticas
--  p18_usuarios_sel y p18_usuario_roles_sel sólo permiten leer la propia fila
--  (app.usuario_id) o todo si el rol es 'administrador'. En el login todavía no
--  hay usuario ni rol, así que una consulta normal devolvería 0 filas.
--
--  Esta función SECURITY DEFINER hace exactamente una cosa: verificar DNI y
--  clave y devolver el perfil mínimo de sesión. No expone la tabla y no permite
--  listar usuarios.
--
--  Aplicación:
--    docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--      < migration/10_d3_capa_datos.sql
-- =============================================================================

create or replace function core.autenticar_usuario(p_dni text, p_password text)
returns table (
    usuario_id uuid,
    codigo_legado text,
    nombre text,
    dni text,
    email text,
    cargo text,
    unidad_siglas text,
    rol_codigo text,
    roles text[],
    regiones text[]
)
language sql
stable
security definer
set search_path = pg_catalog, core, public
as $$
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
                       when 'direccion_oaipcs' then 1
                       when 'administrador' then 2
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
$$;

revoke all on function core.autenticar_usuario(text, text) from public;
grant execute on function core.autenticar_usuario(text, text) to avisa_app;

comment on function core.autenticar_usuario(text, text) is
    'D3: verifica DNI + clave y devuelve el perfil mínimo de sesión. SECURITY DEFINER acotada; no permite listar usuarios.';
