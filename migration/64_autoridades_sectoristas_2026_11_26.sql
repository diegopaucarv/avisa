-- =============================================================================
-- 64 · Sectoristas de la OAIPCS como «Actor público» (agentes del directorio)
--
-- Fecha: 2026-11-26
-- Autor de la carga: OAIPCS
--
-- Por qué existe esta migración
-- -----------------------------
-- La vista `/directorio/autoridades` se alimenta sólo de `core.actores` con
-- `cat_tipos_actor = 'Actor público'` y `naturaleza = 'persona'` (ver
-- `lib/db/repos/autoridades.ts`, CTE `base`). El personal de la OAIPCS vive en
-- `core.usuarios` y no se replica como actor, así que no aparece en el
-- directorio. Esta migración proyecta a los sectoristas como actores públicos
-- para que se listen en «Autoridades y agentes», en la pestaña «Agente».
--
-- Qué se carga
-- ------------
-- Usuarios de `core.usuarios` que cumplan las tres condiciones:
--   * activos (`activo = true`),
--   * con rol `sectorista` vigente en `core.usuario_roles`
--     (`hasta` nulo o no anterior a hoy),
--   * y que no sean la cuenta demo «Admin» (tiene los diez roles y no es una
--     persona real).
--
-- Al 2026-11-26 son 9 filas: se excluye a la cuenta demo «Admin» y a André
-- Jiménez Agapito, que salió de la OAIPCS (indicación de la Dirección). Los
-- usuarios inactivos (p. ej. altas dadas de baja) quedan fuera a propósito: no
-- se debe publicar como agente vigente a quien ya no ejerce.
--
-- Cómo se traduce al modelo
-- -------------------------
--   NOMBRE        → `core.actores.nombre_actual` (tal como está en `core.usuarios`).
--   CARGO         → `core.actores.cargo_actual = 'Sectorista'` para todos, por
--                   indicación de la Dirección. El cargo original de la cuenta
--                   («Especialista - Sector Sur», etc.) se conserva en
--                   `perfil_descripcion` para no perder el dato de la fuente.
--                   El patrón de la vista (`PATRON_AUTORIDAD`) no casa con
--                   «Sectorista», así que se muestran en la pestaña «Agente».
--   CORREO        → `email_contacto = null`. Los correos de `core.usuarios` son
--                   datos de la cuenta (uno personal de Gmail y otro con el
--                   dominio mal escrito «produce.gbo.pe»); no se publican en el
--                   directorio sin curación. Se pueden completar desde la ficha.
--   REGIÓN        → `region_id = null`: son personal de la OAIPCS, no de una
--                   jurisdicción territorial.
--   NIVEL GOBIERNO→ `'Nacional'` (servidores de un ministerio).
--   `nivel_identificacion_id = 3` cumple `ck_actor_sin_geo_si_no_identificado`
--   (sólo exige geografía nula a partir del nivel 4) y `ck_actor_anclaje`.
--   `origen_dato = 'MANUAL'`: carga nueva, no histórica.
--   `codigo_legado = 'OAIPCS-SECT-<uuid del usuario>'` es la clave natural de la
--   carga: hace la migración idempotente y permite revertirla sin tocar otras
--   filas. Se usa el UUID del usuario (no un correlativo) para que dos
--   ejecuciones o un alta posterior no choquen.
--
-- Esta migración NO toca teléfonos ni DNI (PII): no se pidió y el padrón de
-- usuarios no es una fuente curada para el directorio.
--
-- Cómo revertir
-- -------------
--   begin;
--   select set_config('app.rol_codigo', 'administrador', true);
--   select set_config('app.user_id',
--                     '00000000-0000-0000-0000-000000000001', true);
--   delete from core.actores where codigo_legado like 'OAIPCS-SECT-%';
--   commit;
-- =============================================================================

begin;

-- 1 · Contexto RLS, igual que la migración 63 (rol de lectura total y autoría).
select set_config('app.rol_codigo', 'administrador', true);
select set_config(
  'app.user_id',
  '00000000-0000-0000-0000-000000000001',
  true
);

-- 2 · Padrón derivado: sectoristas activos y vigentes, sin la cuenta demo.
create temp table padron_sectoristas on commit drop as
select
  u.id                        as usuario_id,
  u.nombre                    as nombre,
  nullif(btrim(u.cargo), '')  as cargo_usuario
from core.usuarios u
where u.activo
  and u.nombre <> 'Admin'
  -- André Jiménez Agapito salió de la OAIPCS (indicación de la Dirección, 2026-11-26).
  and u.nombre <> 'André Jiménez Agapito'
  and exists (
    select 1
      from core.usuario_roles ur
      join core.roles r on r.id = ur.rol_id
     where ur.usuario_id = u.id
       and r.codigo = 'sectorista'
       and (ur.hasta is null or ur.hasta >= current_date)
  );

-- 3 · Personas en el padrón de actores. Idempotente por `codigo_legado`.
insert into core.actores (
  nombre_actual,
  naturaleza,
  tipo_actor_id,
  rol_actor_id,
  origen_dato,
  email_contacto,
  cargo_actual,
  nivel_gobierno,
  region_id,
  nivel_clasificacion,
  nivel_identificacion_id,
  es_validado_humano,
  activo,
  perfil_descripcion,
  codigo_legado
)
select
  p.nombre,
  'persona',
  (select id from core.cat_tipos_actor    where nombre = 'Actor público'),
  (select id from core.cat_roles_actor    where nombre = 'No determinado'),
  'MANUAL',
  null,
  'Sectorista',
  'Nacional',
  null,
  2,
  3,
  true,
  true,
  'Sectorista de la OAIPCS.'
    || coalesce(' Cargo registrado: ' || p.cargo_usuario || '.', ''),
  'OAIPCS-SECT-' || p.usuario_id::text
from padron_sectoristas p
where not exists (
  select 1
    from core.actores a
   where a.codigo_legado = 'OAIPCS-SECT-' || p.usuario_id::text
);

-- 4 · Registro de la migración (idempotente, como el resto del repo).
insert into core.migracion_log (clave)
values ('64_autoridades_sectoristas_2026_11_26')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- Debe listar los sectoristas recién creados y su clasificación en la vista.
select count(*) as filas
  from core.actores
 where codigo_legado like 'OAIPCS-SECT-%';

select a.nombre_actual,
       a.cargo_actual,
       case
         when lower(coalesce(a.cargo_actual, '')) similar to
              '%(director|directora|jefe|jefa|president|secretari|procurador|titular|coordinador|ejecutor|viceministro)%'
           then 'autoridad'
         else 'agente'
       end as tipo_en_la_vista
  from core.actores a
  join core.cat_tipos_actor ta on ta.id = a.tipo_actor_id
 where a.codigo_legado like 'OAIPCS-SECT-%'
   and ta.nombre = 'Actor público'
   and a.naturaleza = 'persona'
 order by a.nombre_actual;
