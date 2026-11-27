-- =============================================================================
-- 81 · Mesas de diálogo como casos (vínculo mesa ↔ base de casos)
--
-- Fecha: 2026-11-27
--
-- Por qué
-- -------
-- Las 21 mesas de `core.mesas_dialogo` (`OAIPCS-001..020` y `OAIPCS-034`) viven
-- en una tabla aislada: no tienen caso, ni compromisos, ni hitos, ni alertas.
-- La base de casos no las ve y los módulos de compromisos e indicadores no
-- pueden contar nada sobre ellas. Para que una mesa sea tratable como cualquier
-- otro espacio de diálogo, necesita un caso espejo en `core.casos` y una columna
-- que fije el vínculo.
--
-- Qué hace
-- --------
-- 1. Añade `core.mesas_dialogo.caso_id` (FK a `core.casos`, `on delete set
--    null`) y un índice único parcial: una mesa por caso y un caso por mesa.
-- 2. Crea `core.siguiente_codigo_mesa()`, que emite la serie opaca
--    `MD-<año>-<NNNN>` con el mismo mecanismo que la serie de casos
--    (`core.siguiente_codigo`, migraciones 68-70). El código no incrusta
--    catálogos: es estable y opaco, espejo de `CS-<año>-<NNNN>`.
-- 3. Crea `core.crear_caso_de_mesa(uuid)`: idempotente, bloquea la fila de la
--    mesa, crea el caso espejo si aún no existe y devuelve su id.
-- 4. Rellena `caso_id` de todas las mesas que aún no lo tengan (backfill).
--
-- Supuestos de los datos del caso
-- -------------------------------
-- El alta automática no inventa datos de negocio: usa los placeholders exigidos
-- por `core.casos` (`subsector_id`, `unidad_responsable_id`, `nivel_riesgo_id`,
-- `estado_id` = 1; donde 1 = OAIPCS en cada catálogo). Marca el origen como
-- `fuente_original = 'avisa_historico'` y deja el caso como no validado.
--   · `region_principal_id` sólo se rellena cuando `ambito_departamento`
--     coincide **exactamente**, tras `core.normalizar_ref`, con el nombre de
--     una `core.regiones`. Textos compuestos («Lima, Callao», «Más de Uno»,
--     «Nacional») quedan sin región: no se parte el texto ni se adivina.
--   · `codigo_legado` guarda el código de la mesa (`OAIPCS-001`) **sólo si no
--     colisiona** con la UNIQUE `casos_codigo_legado_key`; si ya existe, se deja
--     nulo para no revertir el alta.
--   · `origen_dato` se deja en su valor por defecto (`MANUAL`). El vínculo con
--     el histórico queda en `fuente_original` y en `codigo_legado`.
--
-- Seguridad (RLS)
-- ---------------
-- `core.mesas_dialogo`, `core.casos` y `core.compromisos` tienen
-- `FORCE ROW LEVEL SECURITY`. Ojo: `FORCE` somete a la RLS también al **owner**
-- de la tabla, así que esta migración debe ejecutarse con un rol **BYPASSRLS o
-- superusuario** (no basta con ser owner ni con `avisa_app`, cuyo
-- `app.rol_codigo` daría `core.clasificacion_max()` = 0 y no vería ni escribiría
-- filas). Las funciones son `SECURITY DEFINER` y heredan ese privilegio.
--
-- Idempotente: `add column if not exists`, `create index if not exists`,
-- `create or replace function`, `caso_id is null` en el backfill y
-- `on conflict do nothing` en el log. Puede reejecutarse sin efectos.
-- =============================================================================

begin;

-- 1 · Vínculo mesa → caso -----------------------------------------------------

alter table core.mesas_dialogo
  add column if not exists caso_id uuid
  references core.casos(id) on delete set null;

comment on column core.mesas_dialogo.caso_id is
  'Caso espejo de la mesa en la base de casos. Lo puebla core.crear_caso_de_mesa(); NULL mientras la mesa no tenga caso.';

-- Un caso no debe representar dos mesas: la relación es 1:1 en la práctica.
create unique index if not exists ux_mesas_dialogo_caso
  on core.mesas_dialogo (caso_id)
  where caso_id is not null;

-- 2 · Serie opaca de códigos de mesa -----------------------------------------

create or replace function core.siguiente_codigo_mesa()
returns text
language sql
security definer
set search_path to 'pg_catalog', 'core'
as $function$
  select core.siguiente_codigo(
    'MESA-' || to_char(now() at time zone 'America/Lima', 'YYYY'),
    'MD-' || to_char(now() at time zone 'America/Lima', 'YYYY') || '-',
    4
  );
$function$;

comment on function core.siguiente_codigo_mesa() is
  'Siguiente código de mesa, serie opaca MD-<año>-<NNNN>. Correlativo persistente por año vía core.secuencia_codigo; nunca se reutiliza un número.';

-- 3 · Alta idempotente del caso espejo ---------------------------------------

create or replace function core.crear_caso_de_mesa(p_mesa_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'core'
as $function$
declare
  v_mesa      core.mesas_dialogo%rowtype;
  v_caso_id   uuid;
  v_codigo    text;
  v_region_id integer;
  v_legado    text;
  v_validado  boolean;
  v_columnas  text;
  v_valores   text;
begin
  -- El bloqueo serializa dos altas concurrentes de la misma mesa: la segunda
  -- espera y, al entrar, ya encuentra `caso_id` poblado y lo devuelve.
  select * into v_mesa
    from core.mesas_dialogo
   where id = p_mesa_id
   for update;

  if not found then
    raise exception 'La mesa % no existe', p_mesa_id
      using errcode = 'P0002';
  end if;

  if v_mesa.caso_id is not null then
    return v_mesa.caso_id;
  end if;

  v_codigo := core.siguiente_codigo_mesa();

  -- Región principal: sólo coincidencia exacta normalizada. `normalizar_ref`
  -- quita tildes, mayúsculas y separadores, no trocea listas.
  if v_mesa.ambito_departamento is not null then
    select r.id into v_region_id
      from core.regiones r
     where core.normalizar_ref(r.nombre) = core.normalizar_ref(v_mesa.ambito_departamento)
     order by r.id
     limit 1;
  end if;

  -- Código legado sólo si no colisiona con la UNIQUE de core.casos.
  if not exists (select 1 from core.casos c where c.codigo_legado = v_mesa.codigo) then
    v_legado := v_mesa.codigo;
  end if;

  -- `es_validado_humano` existe en el esquema verificado; se comprueba por si
  -- otro entorno no la tiene y el insert debe seguir funcionando sin ella.
  v_validado := exists (
    select 1 from information_schema.columns
     where table_schema = 'core' and table_name = 'casos'
       and column_name = 'es_validado_humano'
  );

  v_columnas := 'codigo_caso, nombre_caso, subsector_id, unidad_responsable_id, '
             || 'nivel_riesgo_id, estado_id, fuente_original, region_principal_id, codigo_legado';
  v_valores  := '$1, left($2, 255), 1, 1, 1, 1, ''avisa_historico'', $3, $4';

  if v_validado then
    v_columnas := v_columnas || ', es_validado_humano';
    v_valores  := v_valores || ', false';
  end if;

  execute format(
    'insert into core.casos (%s) values (%s) returning id',
    v_columnas, v_valores)
    into v_caso_id
    using v_codigo, v_mesa.titulo, v_region_id, v_legado;

  update core.mesas_dialogo
     set caso_id = v_caso_id
   where id = p_mesa_id;

  return v_caso_id;
end $function$;

comment on function core.crear_caso_de_mesa(uuid) is
  'Crea el caso espejo de una mesa de diálogo (serie MD) y fija mesas_dialogo.caso_id. Idempotente: si ya existe, devuelve el id sin crear otra fila.';

revoke all on function core.crear_caso_de_mesa(uuid) from public;
revoke all on function core.siguiente_codigo_mesa() from public;
grant execute on function core.crear_caso_de_mesa(uuid) to avisa_app, avisa_api;
grant execute on function core.siguiente_codigo_mesa() to avisa_app, avisa_api;

-- 4 · Guardas de catálogo -----------------------------------------------------
-- El alta usa 1/1/1/1 como placeholders. Si en este entorno faltara alguna fila,
-- el insert fallaría por FK con un mensaje críptico. Se corta aquí, antes del
-- backfill, indicando qué catálogo corregir.

do $guardas$
begin
  if not exists (select 1 from core.cat_subsectores where id = 1) then
    raise exception 'Falta core.cat_subsectores id = 1 (placeholder de subsector): revise el catálogo antes de la migración 81';
  end if;
  if not exists (select 1 from core.cat_unidades_organicas where id = 1) then
    raise exception 'Falta core.cat_unidades_organicas id = 1 (placeholder de unidad responsable): revise el catálogo antes de la migración 81';
  end if;
  if not exists (select 1 from core.cat_niveles_riesgo where id = 1) then
    raise exception 'Falta core.cat_niveles_riesgo id = 1 (placeholder de nivel de riesgo): revise el catálogo antes de la migración 81';
  end if;
  if not exists (select 1 from core.cat_estados_caso where id = 1) then
    raise exception 'Falta core.cat_estados_caso id = 1 (placeholder de estado Abierto): revise el catálogo antes de la migración 81';
  end if;
end $guardas$;

-- 5 · Backfill ----------------------------------------------------------------

do $backfill$
declare
  r record;
begin
  for r in select id from core.mesas_dialogo where caso_id is null loop
    perform core.crear_caso_de_mesa(r.id);
  end loop;
end $backfill$;

insert into core.migracion_log (clave)
values ('81_mesas_como_casos_2026_11_27')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- Ninguna mesa debe quedar sin caso.
select count(*) filter (where caso_id is null) as mesas_sin_caso,
       count(*) as mesas_total
  from core.mesas_dialogo;

-- Casos espejo creados y su numeración (todos MD-<año>-<NNNN>).
select split_part(codigo_caso, '-', 2) as anio, count(*)
  from core.casos
 where codigo_caso like 'MD-%'
 group by 1
 order by 1;

-- El código de la mesa debe haberse conservado en codigo_legado salvo colisión.
select m.codigo as mesa,
       m.caso_id is not null as con_caso,
       c.codigo_caso,
       c.codigo_legado,
       (c.codigo_legado is null) as legado_omitido
  from core.mesas_dialogo m
  left join core.casos c on c.id = m.caso_id
 order by m.codigo;

-- El contador de la serie MD debe ir por delante del último código emitido.
select ambito, ultimo
  from core.secuencia_codigo
 where ambito like 'MESA-%'
 order by ambito;

-- -----------------------------------------------------------------------------
-- Reversión
-- -----------------------------------------------------------------------------
-- 1) Deshacer el backfill SOLO si esos casos no tienen compromisos, hitos ni
--    alertas: borrar de `core.casos` arrastra `core.compromisos` por
--    `ON DELETE CASCADE` y perdería trabajo real. Compruebe antes:
--      select count(*) from core.compromisos
--       where caso_id in (select caso_id from core.mesas_dialogo where caso_id is not null);
--
-- 2) Secuencia de reversión (con la precaución anterior):
--      update core.casos set codigo_legado = null where codigo_legado like 'OAIPCS-%';
--      delete from core.casos
--       where id in (select caso_id from core.mesas_dialogo where caso_id is not null);
--      update core.mesas_dialogo set caso_id = null;
--      drop function if exists core.crear_caso_de_mesa(uuid);
--      drop function if exists core.siguiente_codigo_mesa();
--      drop index if exists core.ux_mesas_dialogo_caso;
--      alter table core.mesas_dialogo drop column if exists caso_id;
--      delete from core.secuencia_codigo where ambito like 'MESA-%';
--      delete from core.migracion_log where clave = '81_mesas_como_casos_2026_11_27';
