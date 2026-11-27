-- =============================================================================
-- 81 · Mesas de diálogo como casos (vínculo mesa ↔ base de casos)
--
-- Fecha: 2026-11-27
-- Autor de la carga: OAIPCS
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
-- 4. Siembra `core.secuencia_codigo` con el mayor `MD-<año>-<NNNN>` ya emitido
--    (misma mecánica que la 70) y luego rellena `caso_id` de todas las mesas
--    que aún no lo tengan (backfill).
--
-- Supuestos de los datos del caso
-- -------------------------------
-- El alta automática no inventa ids de catálogo: los **resuelve en runtime** y
-- aborta con un `raise exception` si no encuentra la fila. Nunca usa `1/1/1/1`.
--
--   · `subsector_id` = `core.cat_subsectores.nombre` normalizado
--     «Gestión y Prevención de Conflictos».
--     No existe un subsector llamado «OAIPCS»: el catálogo real sólo tiene
--     `Pesca y Acuicultura` (1), `Mype e Industria` (2) y
--     `Gestión y Prevención de Conflictos` (3). Lo confirma la propia función
--     `core.codigo_subsector()` (backups/avisa_neon_schema.sql:1056: 1=PA,
--     2=MI, cualquier otro=GEN) y el sembrado del esquema
--     (docs/AVISA_V10_ESQUEMA_UNIFICADO.sql:8734). Las mesas de diálogo son
--     espacios de prevención de conflictos, así que el tercero es el valor
--     conservador; si OAIPCS decide otro, se cambia el literal de resolución.
--   · `unidad_responsable_id` = `core.cat_unidades_organicas.siglas` 'OAIPCS'
--     (backups/avisa_neon_schema.sql:7344; la fila se siembra en
--     docs/AVISA_V10_ESQUEMA_UNIFICADO.sql:9607).
--   · `nivel_riesgo_id` = `core.cat_niveles_riesgo.codigo` 'Bajo'
--     (backups/avisa_neon_schema.sql:5837; ids 1=Bajo, 2=Moderado, 3=Alto).
--     Se elige el nivel más bajo para no inflar el riesgo de un alta espejo.
--   · `estado_id` = `core.cat_estados_caso.codigo` 'Activo'
--     (backups/avisa_neon_schema.sql:5712; es el estado inicial y coincide con
--     `core.casos.estado_id default 1`).
--
-- La comparación de códigos usa `core.normalizar_ref` para tolerar mayúsculas,
-- tildes y separadores (`Activo`/`activo`, `En_seguimiento`/`En seguimiento`).
--
-- Además:
--   · Marca el origen como `fuente_original = 'avisa_historico'` y deja el caso
--     como no validado (`es_validado_humano = false` cuando la columna existe).
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
-- `FORCE ROW LEVEL SECURITY`, y sus políticas de SELECT exigen
-- `nivel_clasificacion <= core.clasificacion_max()`. Sin `app.rol_codigo`,
-- `core.clasificacion_max()` devuelve 0 y la sesión no ve ninguna mesa
-- (backups/avisa_neon_schema.sql:1032). `FORCE` somete también al **owner**, así
-- que esta migración debe ejecutarse con un rol **BYPASSRLS o superusuario**.
-- Por eso el bloque 0 comprueba el privilegio y **aborta** si no se cumple: sin
-- esa guarda el backfill vería 0 filas, no iteraría y el log registraría un
-- falso éxito.
--
-- Permisos de los SECURITY DEFINER
-- --------------------------------
-- `core.crear_caso_de_mesa(uuid)` corre como el propietario (con BYPASSRLS) y
-- por tanto **salta la RLS**: si se concediera a `avisa_app`/`avisa_api`,
-- cualquier usuario podría crear el caso espejo de cualquier mesa sin pasar por
-- `core.puede_crear()`. Se revoca de `public` y de los dos roles de aplicación y
-- se deja **sólo al propietario**. El backfill corre en la misma sesión del
-- propietario y sigue funcionando. Se eligió el ACL mínimo en lugar de un check
-- interno con `core.puede_crear()` porque ese check fallaría en el backfill: el
-- propietario no fija `app.rol_codigo`, `core.rol_actual()` es NULL y
-- `core.puede_crear()` devuelve false. Si en el futuro la API necesita el alta
-- bajo demanda, una migración posterior debe conceder EXECUTE a un rol
-- operativo explícito y añadir aquí la comprobación de permiso.
-- `core.siguiente_codigo_mesa()` recibe el mismo trato (sólo propietario): no
-- hay llamador de aplicación y así no se pueden quemar correlativos.
--
-- Idempotente: `add column if not exists`, `create index if not exists`,
-- `create or replace function`, siembra con `greatest(...)`, `caso_id is null`
-- en el backfill y `on conflict do nothing` en el log. Puede reejecutarse sin
-- efectos.
-- =============================================================================

begin;

-- 0 · Preflight de RLS --------------------------------------------------------
-- Sin BYPASSRLS ni superuser, FORCE RLS oculta las mesas y el backfill sería un
-- no-op silencioso. Se corta antes de crear o modificar nada. Se comprueba el
-- atributo directo del rol de sesión; un rol que herede BYPASSRLS por
-- membresía debe hacer `set role` al rol que lo tiene (comportamiento de
-- PostgreSQL) o ejecutar como superusuario.

do $preflight$
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = current_user
       and (rolsuper or rolbypassrls)
  ) then
    raise exception '81: el rol % no es superusuario ni tiene BYPASSRLS; FORCE ROW LEVEL SECURITY oculta core.mesas_dialogo y core.casos (clasificacion_max() = 0 sin app.rol_codigo) y el backfill quedaría vacío. Ejecute la migración con el propietario BYPASSRLS.', current_user;
  end if;
end $preflight$;

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
  v_mesa       core.mesas_dialogo%rowtype;
  v_caso_id    uuid;
  v_codigo     text;
  v_subsector  integer;
  v_unidad     integer;
  v_riesgo     smallint;
  v_estado     smallint;
  v_region_id  integer;
  v_legado     text;
  v_validado   boolean;
  v_columnas   text;
  v_valores    text;
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

  -- Catálogos resueltos por su clave estable, nunca por id fijo. Cada bloque
  -- aborta si el catálogo no tiene la fila esperada (fail-safe): un id
  -- arbitrario metería el caso en el subsector o estado equivocado.
  select s.id into v_subsector
    from core.cat_subsectores s
   where core.normalizar_ref(s.nombre)
       = core.normalizar_ref('Gestión y Prevención de Conflictos')
   order by s.id
   limit 1;
  if v_subsector is null then
    raise exception '81: no existe el subsector «Gestión y Prevención de Conflictos» en core.cat_subsectores; revise el catálogo antes de crear el caso de la mesa %', p_mesa_id;
  end if;

  select u.id into v_unidad
    from core.cat_unidades_organicas u
   where core.normalizar_ref(u.siglas) = core.normalizar_ref('OAIPCS')
   order by (u.entidad_id = 1) desc, u.id
   limit 1;
  if v_unidad is null then
    raise exception '81: no existe la unidad «OAIPCS» en core.cat_unidades_organicas; revise el catálogo antes de crear el caso de la mesa %', p_mesa_id;
  end if;

  select r.id into v_riesgo
    from core.cat_niveles_riesgo r
   where core.normalizar_ref(r.codigo) = core.normalizar_ref('Bajo')
   order by r.orden, r.id
   limit 1;
  if v_riesgo is null then
    raise exception '81: no existe el nivel de riesgo «Bajo» en core.cat_niveles_riesgo; revise el catálogo antes de crear el caso de la mesa %', p_mesa_id;
  end if;

  select e.id into v_estado
    from core.cat_estados_caso e
   where core.normalizar_ref(e.codigo) = core.normalizar_ref('Activo')
   order by e.id
   limit 1;
  if v_estado is null then
    raise exception '81: no existe el estado «Activo» en core.cat_estados_caso; revise el catálogo antes de crear el caso de la mesa %', p_mesa_id;
  end if;

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
  v_valores  := '$1, left($2, 255), $3, $4, $5, $6, ''avisa_historico'', $7, $8';

  if v_validado then
    v_columnas := v_columnas || ', es_validado_humano';
    v_valores  := v_valores || ', false';
  end if;

  execute format(
    'insert into core.casos (%s) values (%s) returning id',
    v_columnas, v_valores)
    into v_caso_id
    using v_codigo, v_mesa.titulo, v_subsector, v_unidad, v_riesgo, v_estado,
          v_region_id, v_legado;

  update core.mesas_dialogo
     set caso_id = v_caso_id
   where id = p_mesa_id;

  return v_caso_id;
end $function$;

comment on function core.crear_caso_de_mesa(uuid) is
  'Crea el caso espejo de una mesa de diálogo (serie MD) y fija mesas_dialogo.caso_id. Resuelve los catálogos por código/nombre y aborta si no existen. Idempotente: si ya existe, devuelve el id sin crear otra fila. Sólo el propietario puede ejecutarla.';

-- ACL mínimo: sólo el propietario (que corre con BYPASSRLS). Ver la sección
-- «Permisos de los SECURITY DEFINER» del encabezado.
revoke all on function core.crear_caso_de_mesa(uuid) from public;
revoke all on function core.crear_caso_de_mesa(uuid) from avisa_app, avisa_api;
revoke all on function core.siguiente_codigo_mesa() from public;
revoke all on function core.siguiente_codigo_mesa() from avisa_app, avisa_api;

-- 4 · Guardas de catálogo -----------------------------------------------------
-- Se resuelven las mismas filas que usará core.crear_caso_de_mesa(). Si falta
-- alguna, se corta aquí, antes de la siembra y del backfill, diciendo qué
-- catálogo corregir. Sustituye a las guardas anteriores, que comprobaban ids
-- fijos `= 1` afirmando falsamente «1 = OAIPCS en cada catálogo».

do $guardas$
declare
  v_subsector integer;
  v_unidad    integer;
  v_riesgo    smallint;
  v_estado    smallint;
begin
  select s.id into v_subsector
    from core.cat_subsectores s
   where core.normalizar_ref(s.nombre)
       = core.normalizar_ref('Gestión y Prevención de Conflictos')
   order by s.id
   limit 1;
  if v_subsector is null then
    raise exception '81: falta el subsector «Gestión y Prevención de Conflictos» en core.cat_subsectores (no existe un subsector OAIPCS); revise el catálogo antes de la migración 81';
  end if;

  select u.id into v_unidad
    from core.cat_unidades_organicas u
   where core.normalizar_ref(u.siglas) = core.normalizar_ref('OAIPCS')
   order by (u.entidad_id = 1) desc, u.id
   limit 1;
  if v_unidad is null then
    raise exception '81: falta la unidad «OAIPCS» en core.cat_unidades_organicas; revise el catálogo antes de la migración 81';
  end if;

  select r.id into v_riesgo
    from core.cat_niveles_riesgo r
   where core.normalizar_ref(r.codigo) = core.normalizar_ref('Bajo')
   order by r.orden, r.id
   limit 1;
  if v_riesgo is null then
    raise exception '81: falta el nivel de riesgo «Bajo» en core.cat_niveles_riesgo; revise el catálogo antes de la migración 81';
  end if;

  select e.id into v_estado
    from core.cat_estados_caso e
   where core.normalizar_ref(e.codigo) = core.normalizar_ref('Activo')
   order by e.id
   limit 1;
  if v_estado is null then
    raise exception '81: falta el estado «Activo» en core.cat_estados_caso; revise el catálogo antes de la migración 81';
  end if;
end $guardas$;

-- 5 · Sembrado del contador de la serie MD ------------------------------------
-- Análogo a la migración 70. Si una reejecución o una restauración parcial dejó
-- el contador `MESA-<año>` por detrás del último `MD-<año>-<NNNN>` ya emitido,
-- el próximo `siguiente_codigo_mesa()` volvería a ese número y chocaría con
-- `casos_codigo_caso_key`. `greatest(...)` nunca baja un contador ya avanzado.

with usados as (
  select
    split_part(codigo_caso, '-', 2) as anio,
    max(split_part(codigo_caso, '-', 3)::bigint) as ultimo
  from core.casos
  where codigo_caso ~ '^MD-[0-9]{4}-[0-9]+$'
  group by 1
)
insert into core.secuencia_codigo (ambito, ultimo, actualizado_en)
select
    'MESA-' || anio,
    ultimo,
    now()
  from usados
on conflict (ambito) do update
   set ultimo = greatest(core.secuencia_codigo.ultimo, excluded.ultimo),
       actualizado_en = now();

-- 6 · Backfill ----------------------------------------------------------------
-- Ordena por `codigo` para que la numeración MD sea reproducible entre
-- ejecuciones. Bajo BYPASSRLS ve todas las mesas; el preflight ya garantizó ese
-- privilegio.

do $backfill$
declare
  r record;
begin
  for r in select id from core.mesas_dialogo where caso_id is null order by codigo loop
    perform core.crear_caso_de_mesa(r.id);
  end loop;
end $backfill$;

-- 7 · Guarda final: aborta si la RLS volvió a ocultar el trabajo --------------
-- Va ANTES del log y del commit: si algo quedó a medias, la transacción entera
-- se revierte y no se registra un falso éxito.
do $verifica$
declare
  v_mesas     bigint;
  v_con_caso  bigint;
  v_casos_md  bigint;
begin
  select count(*), count(caso_id)
    into v_mesas, v_con_caso
    from core.mesas_dialogo;

  if v_con_caso <> v_mesas then
    raise exception '81: quedaron % mesas sin caso de % (¿se ejecutó sin BYPASSRLS?)', v_mesas - v_con_caso, v_mesas;
  end if;

  select count(*) into v_casos_md
    from core.casos
   where codigo_caso ~ '^MD-[0-9]{4}-[0-9]+$';

  if v_casos_md <> v_mesas then
    raise exception '81: hay % casos MD-AAAA-NNNN pero % mesas; el backfill quedó incompleto o hay casos espejo sueltos', v_casos_md, v_mesas;
  end if;
end $verifica$;

insert into core.migracion_log (clave)
values ('81_mesas_como_casos_2026_11_27')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- Ejecutarlas con el mismo rol BYPASSRLS que aplicó la migración: con
-- `avisa_app`/`avisa_api` (sin app.rol_codigo) devolverían 0 por la RLS.

-- Ninguna mesa debe quedar sin caso.
select count(*) filter (where caso_id is null) as mesas_sin_caso,
       count(*) as mesas_total
  from core.mesas_dialogo;

-- Casos espejo creados y su numeración (todos MD-<año>-<NNNN>).
select split_part(codigo_caso, '-', 2) as anio, count(*)
  from core.casos
 where codigo_caso ~ '^MD-[0-9]{4}-[0-9]+$'
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
-- Ejecutar en UNA transacción y con el mismo rol BYPASSRLS. El orden importa:
-- primero se capturan los ids, luego se comprueba que no haya trabajo
-- dependiente, después se desenlaza y se borra SÓLO ese conjunto, y al final se
-- sueltan funciones, índice y columna.
--
-- NO use `codigo_legado like 'OAIPCS-%'`: esa condición alcanza casos que no son
-- mesas. Todo va acotado a los `caso_id` capturados de `core.mesas_dialogo`.
--
-- Borrar un caso arrastra `core.compromisos`, `core.alertas_tempranas`,
-- `core.demandas`, `core.hitos_compromiso` (vía compromisos), `core.caso_*`,
-- `core.casos_actores`, etc. por `ON DELETE CASCADE` (ver
-- backups/avisa_neon_schema.sql:39114 y ss.). Por eso se aborta si hay
-- dependencias: no se borra trabajo real de forma indiscriminada.
--
-- begin;
--
-- -- 1) Capturar el conjunto ANTES de desenlazar (si pone caso_id = null primero
-- --    pierde la lista de casos a borrar).
-- create temp table _mesas_casos_81 on commit drop as
--   select m.caso_id, c.codigo_legado
--     from core.mesas_dialogo m
--     join core.casos c on c.id = m.caso_id
--    where m.caso_id is not null;
--
-- -- 2) Abortar si esos casos ya tienen trabajo real. Si salta, revise y decida
-- --    a mano caso por caso; no borre.
-- do $rev$
-- begin
--   if exists (select 1 from core.compromisos
--               where caso_id in (select caso_id from _mesas_casos_81))
--      or exists (select 1 from core.alertas_tempranas
--                  where caso_id in (select caso_id from _mesas_casos_81))
--      or exists (select 1 from core.demandas
--                  where caso_id in (select caso_id from _mesas_casos_81))
--      or exists (select 1
--                   from core.hitos_compromiso h
--                   join core.compromisos c on c.id = h.compromiso_id
--                  where c.caso_id in (select caso_id from _mesas_casos_81))
--   then
--     raise exception '81 rollback: los casos espejo tienen trabajo dependiente; revíselo antes de borrar';
--   end if;
-- end $rev$;
--
-- -- 3) Si prefiere CONSERVAR los casos, limpie aquí el legado acotado a esos
-- --    ids (el `update` global por LIKE era el defecto). Si va a borrarlos en el
-- --    paso 5, este update no hace falta: la fila desaparece con el caso.
-- update core.casos c
--    set codigo_legado = null
--   from _mesas_casos_81 t
--  where c.id = t.caso_id;
--
-- -- 4) Desenlazar (la FK es `on delete set null`, pero se explicita).
-- update core.mesas_dialogo
--    set caso_id = null
--  where caso_id in (select caso_id from _mesas_casos_81);
--
-- -- 5) Borrar SÓLO los casos espejo capturados (sin huérfanos).
-- delete from core.casos
--  where id in (select caso_id from _mesas_casos_81);
--
-- -- 6) Soltar objetos, de lo dependiente a lo estructural.
-- drop function if exists core.crear_caso_de_mesa(uuid);
-- drop function if exists core.siguiente_codigo_mesa();
-- drop index if exists core.ux_mesas_dialogo_caso;
-- alter table core.mesas_dialogo drop column if exists caso_id;
--
-- -- 7) Limpiar el contador y el log de la migración.
-- delete from core.secuencia_codigo where ambito like 'MESA-%';
-- delete from core.migracion_log where clave = '81_mesas_como_casos_2026_11_27';
--
-- commit;

-- -----------------------------------------------------------------------------
-- Orden de despliegue
-- -----------------------------------------------------------------------------
-- 1. Respaldo: `pg_dump` con datos de `core.casos`, `core.mesas_dialogo` y
--    `core.secuencia_codigo`. Sin respaldo, la reversión no puede reconstruir
--    los casos espejo ni sus códigos.
-- 2. Desplegar la app con los filtros de los casos espejo ya incluidos:
--    `lib/db/repos/casos-filtro.ts` (`excluirCasosMesa`) usado por listados,
--    `lib/db/repos/cases.ts`, `matriz.ts` y `export-anexos.ts` (Anexos 14/15).
--    Así los `MD-…` no aparecen como filas vacías mientras se aplica la
--    migración.
-- 3. Aplicar ESTA migración con el rol propietario BYPASSRLS (p. ej. el owner
--    de Neon). Nunca con `avisa_app`/`avisa_api`: sin `app.rol_codigo`,
--    `core.clasificacion_max()` = 0 y la RLS oculta las mesas (el bloque 0 y la
--    guarda final abortarían).
-- 4. Reiniciar el proceso Next: `lib/db/repos/mesas.ts` memoriza en
--    `vinculoCache` si `mesas_dialogo.caso_id` existe y no lo vuelve a
--    consultar mientras el proceso viva. Recargar la página no basta.
