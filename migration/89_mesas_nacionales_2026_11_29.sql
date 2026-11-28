-- =============================================================================
-- 89 · Mesas de diálogo de alcance nacional
--
-- Fecha: 2026-11-29
-- Autor de la carga: OAIPCS
--
-- POR QUÉ EXISTE
-- --------------
-- `core.mesas_dialogo.ambito_departamento` es texto libre y la migración 81 sólo
-- copió a `core.casos.region_principal_id` las coincidencias **exactas** con un
-- nombre de departamento. Por eso:
--
--   * OAIPCS-001, 002 y 003 enumeran los 25 departamentos (más los rótulos
--     «Lima Provincias» y «Más de Uno») y quedaron sin región ni alcance;
--   * OAIPCS-013 dice «Junín, Pasco, Huánuco, Cusco, Ayacucho» (5 regiones) y
--     también quedó sin alcance;
--   * OAIPCS-015 dice literalmente «Nacional» y OAIPCS-034 «Lima (Chancay) /
--     Nacional», sin departamento resoluble.
--
-- En todos esos casos la mesa cubre más de tres regiones (o declara el carácter
-- nacional) y debe presentarse como de alcance **Nacional**, no como «sin
-- ámbito». `core.alcance_caso(uuid)` no puede deducirlo porque devuelve NULL
-- cuando el caso no tiene ninguna región asociada.
--
-- QUÉ HACE
-- --------
-- 1. Añade `core.mesas_dialogo.es_nacional boolean not null default false`: la
--    marca persistida que consume la ficha y el listado de mesas.
-- 2. Añade `core.casos.alcance_override smallint`: un override opcional del
--    alcance derivado, para que el caso espejo (`MD-AAAA-NNNN`) de esas mesas
--    también muestre «Nacional» en la ficha del caso.
-- 3. Reemplaza `core.alcance_caso(uuid)` por una versión que devuelve
--    `coalesce(alcance_override, <derivación anterior>)`. La derivación previa
--    (regiones del caso → macroregión única, o 5 si abarcan varias) queda
--    **idéntica**; el override sólo tiene efecto si está definido.
-- 4. Marca los datos:
--    a. `es_nacional = true` en las mesas cuyo `ambito_departamento` resuelve a
--       **más de tres** regiones de `core.regiones`;
--    b. `es_nacional = true` en las mesas cuyo texto contiene «Nacional».
--    La resolución de nombres ignora mayúsculas y diacríticos con
--    `core.normalizar_ref` («Junín» → «junin»), de modo que basta con que el
--    texto siga cambiando de grafía.
-- 5. Copia la marca al caso espejo: `alcance_override = <Nacional>` en los casos
--    de las mesas marcadas que aún no tengan override.
--
-- ES ADITIVA
-- ----------
-- Sólo **añade** dos columnas (una con DEFAULT y otra nullable) y escribe en
-- ellas. La única excepción a «sólo agregar» es el `create or replace` de
-- `core.alcance_caso`, que conserva firma y semántica previa y únicamente antepone
-- el override; las vistas y los llamadores (`CASE_FROM` en
-- `lib/db/repos/cases.ts`) no cambian. No hay DROP de columnas ni de datos.
--
-- Las mesas 004, 005 y 012 no tienen `ambito_departamento`: se dejan como están
-- porque no hay evidencia para clasificarlas. Las de una sola región (006..011,
-- 014, 016..020) conservan su alcance macroregional.
--
-- RLS
-- ---
-- `core.mesas_dialogo` y `core.casos` tienen FORCE ROW LEVEL SECURITY. Sin
-- BYPASSRLS el `update` vería 0 filas y el log registraría un falso éxito; el
-- preflight aborta antes de escribir.
-- =============================================================================

begin;

-- 0 · Preflight de RLS --------------------------------------------------------
do $preflight$
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = current_user
       and (rolsuper or rolbypassrls)
  ) then
    raise exception '89: el rol % no es superusuario ni tiene BYPASSRLS; FORCE ROW LEVEL SECURITY ocultaría core.mesas_dialogo y core.casos y la marca quedaría vacía. Ejecute la migración con el propietario BYPASSRLS.', current_user;
  end if;
end $preflight$;

-- 1 · Marca en la mesa --------------------------------------------------------
alter table core.mesas_dialogo
  add column if not exists es_nacional boolean not null default false;

comment on column core.mesas_dialogo.es_nacional is
  'Mesa de alcance nacional: su ámbito abarca más de tres regiones o el texto del ámbito declara «Nacional». La ficha y el listado la muestran como «Nacional» en lugar del texto crudo.';

-- 2 · Override del alcance derivado del caso ----------------------------------
alter table core.casos
  add column if not exists alcance_override smallint default null
  references core.cat_alcances_geograficos(id);

comment on column core.casos.alcance_override is
  'Alcance fijado a mano que reemplaza al derivado por core.alcance_caso(). Lo usa el caso espejo de una mesa nacional para mostrarse como «Nacional» aun sin regiones asociadas. NULL = derivar de las regiones.';

-- 3 · alcance_caso respeta el override ----------------------------------------
-- Semántica previa intacta: regiones del caso (o la región principal) → una
-- macroregión; varias → 5 (Nacional); ninguna → NULL. Sólo se antepone el
-- override cuando existe.
create or replace function core.alcance_caso(p_caso_id uuid)
 returns smallint
 language sql
 stable parallel safe
 set search_path to 'pg_catalog', 'core'
as $function$
  select coalesce(
    (select c.alcance_override
       from core.casos c
      where c.id = p_caso_id),
    (
      with alcances as (
        select r.alcance_id
          from core.caso_regiones cr
          join core.regiones r on r.id = cr.region_id
         where cr.caso_id = p_caso_id
           and r.alcance_id is not null
        union
        select r.alcance_id
          from core.casos c
          join core.regiones r
            on r.id = coalesce(
                 c.region_principal_id,
                 (select p.region_id from core.provincias p where p.id = c.provincia_principal_id),
                 (select p.region_id from core.distritos d join core.provincias p on p.id = d.provincia_id
                   where d.id = c.distrito_principal_id)
               )
         where c.id = p_caso_id
           and r.alcance_id is not null
           and not exists (select 1 from core.caso_regiones x where x.caso_id = p_caso_id)
      )
      select case
               when count(*) = 0 then null
               when count(distinct alcance_id) = 1 then min(alcance_id)
               else 5::smallint
             end
        from alcances
    )
  )
$function$;

comment on function core.alcance_caso(uuid) is
  'Alcance geográfico derivado de un caso: devuelve core.casos.alcance_override si está definido; si no, la macroregión única de sus regiones, 5 (Nacional) si abarca varias, o NULL si no tiene regiones.';

-- 4 · Marca de datos ----------------------------------------------------------
-- 4a y 4b en un solo paso: se cuentan las regiones resueltas por mesa y se
-- suman las que declaran «Nacional» en el texto.
with tokens as (
  select m.id as mesa_id,
         btrim(t.token) as token
    from core.mesas_dialogo m
    cross join lateral regexp_split_to_table(
      coalesce(m.ambito_departamento, ''),
      '\s*[,;]\s*|\s*/\s*'
    ) as t(token)
   where coalesce(btrim(m.ambito_departamento), '') <> ''
),
region_de_token as (
  select tk.mesa_id, r.id as region_id
    from tokens tk
    join core.regiones r
      on core.normalizar_ref(r.nombre) = core.normalizar_ref(tk.token)
),
conteo as (
  select mesa_id, count(distinct region_id)::int as n_regiones
    from region_de_token
   group by mesa_id
),
nacionales as (
  select mesa_id from conteo where n_regiones > 3
  union
  select m.id
    from core.mesas_dialogo m
   where core.normalizar_ref(m.ambito_departamento) like '%nacional%'
)
update core.mesas_dialogo m
   set es_nacional = true
  from nacionales n
 where n.mesa_id = m.id
   and m.es_nacional = false;

-- 5 · Copia la marca al caso espejo -------------------------------------------
update core.casos c
   set alcance_override = a.id
  from core.mesas_dialogo m
  join core.cat_alcances_geograficos a on a.codigo = 'Nacional'
 where m.caso_id = c.id
   and m.es_nacional
   and c.alcance_override is null;

-- 6 · Guardas: el catálogo y la marca deben existir ---------------------------
do $verifica$
declare
  v_nacional smallint;
  v_marcadas int;
begin
  select id into v_nacional
    from core.cat_alcances_geograficos
   where codigo = 'Nacional';
  if v_nacional is null then
    raise exception '89: no existe el alcance «Nacional» en core.cat_alcances_geograficos';
  end if;

  select count(*) into v_marcadas
    from core.mesas_dialogo
   where es_nacional;
  if v_marcadas = 0 then
    raise exception '89: ninguna mesa quedó marcada como nacional (¿se ejecutó sin BYPASSRLS?); revise core.mesas_dialogo.ambito_departamento antes de continuar';
  end if;
end $verifica$;

insert into core.migracion_log (clave)
values ('89_mesas_nacionales_2026_11_29')
on conflict (clave) do nothing;

commit;

-- =============================================================================
-- Verificación (sólo lectura). Ejecutar con el mismo rol BYPASSRLS.
--
--   -- a) Qué mesas quedaron nacionales y por qué:
--   select m.codigo, m.ambito_departamento, m.es_nacional,
--          c.codigo_caso, core.alcance_caso(c.id) as alcance_id
--     from core.mesas_dialogo m
--     left join core.casos c on c.id = m.caso_id
--    order by m.codigo;
--
--   -- b) El caso espejo devuelve 5 (Nacional):
--   select m.codigo, c.codigo_caso, core.alcance_caso(c.id)
--     from core.mesas_dialogo m
--     join core.casos c on c.id = m.caso_id
--    where m.es_nacional;
--
--   -- c) Ningún caso ajeno cambió: los que no son de mesa siguen con override nulo
--   select count(*) from core.casos
--    where alcance_override is not null
--      and codigo_caso not like 'MD-%';
--
-- Cómo revertir
-- -------------
--    begin;
--    update core.mesas_dialogo set es_nacional = false;
--    update core.casos set alcance_override = null where codigo_caso like 'MD-%';
--    -- Restaurar la definición previa de core.alcance_caso (sin el coalesce) y
--    -- luego:
--    alter table core.casos drop column alcance_override;
--    alter table core.mesas_dialogo drop column es_nacional;
--    delete from core.migracion_log where clave = '89_mesas_nacionales_2026_11_29';
--    commit;
-- =============================================================================
