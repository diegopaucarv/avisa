-- =============================================================================
-- 90 · Regla automática «mesa nacional» (trigger)
--
-- Fecha: 2026-11-29
-- Autor de la carga: OAIPCS
--
-- POR QUÉ EXISTE
-- --------------
-- La migración 89 marcó como nacionales seis mesas cuyo ámbito abarca más de
-- tres regiones o declara «Nacional», pero lo hizo con un `update` de una sola
-- vez. Cualquier alta o corrección posterior de `ambito_departamento` volvía a
-- dejar la marca desincronizada, y el caso espejo (`MD-AAAA-NNNN`) perdía su
-- `alcance_override`. Esta migración convierte la regla en un trigger para que
-- no haya que recalcular a mano.
--
-- QUÉ HACE
-- --------
-- 1. `core.mesa_es_nacional(text)`: función pura que decide si un texto de
--    ámbito es nacional. Separa el texto por coma, punto y coma o barra, cuenta
--    las regiones distintas de `core.regiones` que resuelven esos tokens
--    comparando con `core.normalizar_ref` —ignora mayúsculas y diacríticos, de
--    modo que «Junín» casa con la región «Junin»— y devuelve verdadero si hay
--    más de tres regiones **o** si el texto dice «Nacional». Es determinista.
-- 2. BEFORE INSERT/UPDATE en `core.mesas_dialogo`: recalcula `es_nacional` a
--    partir de `ambito_departamento` en cada escritura. La marca pasa a ser un
--    valor DERIVADO: si alguien la edita a mano, el trigger la sobrescribe con
--    el resultado de la regla. Es intencional; queda documentado en el comentario
--    del trigger.
-- 3. AFTER INSERT/UPDATE en `core.mesas_dialogo`: propaga la marca al caso
--    espejo, fijando o limpiando `core.casos.alcance_override` (columna de la
--    89). Sólo actúa cuando cambia `es_nacional` o `caso_id`; así una edición
--    ajena (por ejemplo, el sectorista) no altera un override que ya estaba bien.
-- 4. Barrido de consistencia: recalcula todas las filas existentes para que la
--    marca almacenada coincida con la regla.
--
-- ES ADITIVA
-- ----------
-- Crea dos funciones y dos triggers; no altera columnas ni borra datos. Los
-- `drop trigger if exists` son sólo un guardia de idempotencia (en la primera
-- ejecución no existen). El barrido del punto 4 reescribe `es_nacional` con el
-- mismo valor que ya tenía (verificado antes de escribir esta migración), de
-- modo que no produce cambios observables ni dispara la propagación al caso.
--
-- SEGURIDAD
-- ---------
-- Ambas funciones son SECURITY DEFINER con `search_path` fijo: deben leer
-- `core.regiones` y `core.cat_alcances_geograficos` y escribir `core.casos`
-- (que tiene FORCE RLS) aunque quien dispare el trigger no tenga BYPASSRLS.
-- `core.mesas_dialogo` también tiene FORCE RLS: el preflight aborta si la
-- migración no corre con el propietario.
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
    raise exception '90: el rol % no es superusuario ni tiene BYPASSRLS; FORCE ROW LEVEL SECURITY ocultaría core.mesas_dialogo y core.casos y la marca quedaría vacía. Ejecute la migración con el propietario BYPASSRLS.', current_user;
  end if;
end $preflight$;

-- 1 · Regla pura: ¿el ámbito es nacional? -------------------------------------
create or replace function core.mesa_es_nacional(p_ambito text)
 returns boolean
 language sql
 stable parallel safe
 set search_path to 'pg_catalog', 'core'
as $function$
  with tokens as (
    select btrim(t.token) as token
      from regexp_split_to_table(
             coalesce(p_ambito, ''),
             '\s*[,;]\s*|\s*/\s*'
           ) as t(token)
     where btrim(t.token) <> ''
  ),
  regiones as (
    select distinct r.id
      from tokens tk
      join core.regiones r
        on core.normalizar_ref(r.nombre) = core.normalizar_ref(tk.token)
  )
  select (
    (select count(*) > 3 from regiones)
    or (core.normalizar_ref(coalesce(p_ambito, '')) like '%nacional%')
  )
$function$;

comment on function core.mesa_es_nacional(text) is
  'Verdadero si el texto de ámbito resuelve más de tres regiones de core.regiones (ignorando mayúsculas y diacríticos; separadores coma, punto y coma o barra) o declara «Nacional». Es la regla que mantiene core.mesas_dialogo.es_nacional.';

-- 2 · BEFORE: recalcular la marca ---------------------------------------------
create or replace function core.trg_mesa_nacional()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'core'
as $function$
begin
  new.es_nacional := core.mesa_es_nacional(new.ambito_departamento);
  return new;
end;
$function$;

comment on function core.trg_mesa_nacional() is
  'Recalcula core.mesas_dialogo.es_nacional a partir de ambito_departamento en cada escritura. La marca es derivada: una edición manual de es_nacional se sobrescribe.';

-- 3 · AFTER: propagar al caso espejo ------------------------------------------
create or replace function core.trg_mesa_nacional_caso()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'core'
as $function$
begin
  -- INSERT: alinear el caso recién vinculado, si lo hay.
  if tg_op = 'INSERT' then
    if new.caso_id is not null then
      if new.es_nacional then
        update core.casos c
           set alcance_override = a.id
          from core.cat_alcances_geograficos a
         where c.id = new.caso_id
           and a.codigo = 'Nacional';
      else
        update core.casos set alcance_override = null where id = new.caso_id;
      end if;
    end if;
    return null;
  end if;

  -- UPDATE: nada que hacer si ni la marca ni el vínculo cambiaron.
  if new.es_nacional is not distinct from old.es_nacional
     and new.caso_id is not distinct from old.caso_id then
    return null;
  end if;

  -- Si la mesa dejó de apuntar al caso anterior, se limpia ese caso.
  if old.caso_id is not null and old.caso_id is distinct from new.caso_id then
    update core.casos set alcance_override = null where id = old.caso_id;
  end if;

  if new.caso_id is not null then
    if new.es_nacional then
      update core.casos c
         set alcance_override = a.id
        from core.cat_alcances_geograficos a
       where c.id = new.caso_id
         and a.codigo = 'Nacional';
    else
      update core.casos set alcance_override = null where id = new.caso_id;
    end if;
  end if;

  return null;
end;
$function$;

comment on function core.trg_mesa_nacional_caso() is
  'Propaga core.mesas_dialogo.es_nacional a core.casos.alcance_override del caso espejo. Actúa sólo cuando cambia es_nacional o caso_id.';

-- 4 · Triggers (guardia de idempotencia) --------------------------------------
drop trigger if exists trg_mesa_nacional on core.mesas_dialogo;
create trigger trg_mesa_nacional
  before insert or update on core.mesas_dialogo
  for each row
  execute function core.trg_mesa_nacional();

drop trigger if exists trg_mesa_nacional_caso on core.mesas_dialogo;
create trigger trg_mesa_nacional_caso
  after insert or update on core.mesas_dialogo
  for each row
  execute function core.trg_mesa_nacional_caso();

-- 5 · Barrido de consistencia -------------------------------------------------
-- Reescribe cada fila con el valor que la regla deriva. Las filas que ya eran
-- correctas conservan su valor y no disparan la propagación al caso.
update core.mesas_dialogo set ambito_departamento = ambito_departamento;

-- 6 · Guardas finales ---------------------------------------------------------
do $verifica$
declare
  v_funciones int;
  v_triggers int;
begin
  if not exists (
    select 1 from core.cat_alcances_geograficos where codigo = 'Nacional'
  ) then
    raise exception '90: no existe el alcance «Nacional» en core.cat_alcances_geograficos; el trigger no podría fijar alcance_override';
  end if;

  select count(*) into v_funciones
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'core'
     and p.proname in ('mesa_es_nacional', 'trg_mesa_nacional', 'trg_mesa_nacional_caso');
  if v_funciones < 3 then
    raise exception '90: faltan funciones del trigger (encontradas %)', v_funciones;
  end if;

  select count(*) into v_triggers
    from pg_trigger
   where tgrelid = 'core.mesas_dialogo'::regclass
     and not tgisinternal
     and tgname in ('trg_mesa_nacional', 'trg_mesa_nacional_caso');
  if v_triggers < 2 then
    raise exception '90: los triggers no quedaron creados (encontrados %)', v_triggers;
  end if;
end $verifica$;

insert into core.migracion_log (clave)
values ('90_trigger_mesa_nacional_2026_11_29')
on conflict (clave) do nothing;

commit;

-- =============================================================================
-- Verificación (sólo lectura). Ejecutar con el mismo rol BYPASSRLS.
--
--   -- a) La regla debe reproducir exactamente las seis mesas ya marcadas:
--   select codigo, ambito_departamento, es_nacional,
--          core.mesa_es_nacional(ambito_departamento) as derivado
--     from core.mesas_dialogo
--    order by codigo;
--
--   -- b) El caso espejo de una mesa nacional devuelve 5 (Nacional):
--   select m.codigo, c.codigo_caso, c.alcance_override, core.alcance_caso(c.id)
--     from core.mesas_dialogo m
--     join core.casos c on c.id = m.caso_id
--    where m.es_nacional;
--
--   -- c) Ningún caso ajeno quedó con override:
--   select count(*) from core.casos
--    where alcance_override is not null
--      and codigo_caso not like 'MD-%';
--
-- Prueba del trigger (dentro de una transacción CON rollback, no dejar aplicado)
-- -----------------------------------------------------------------------------
--   begin;
--     update core.mesas_dialogo
--        set ambito_departamento = 'Loreto'
--      where codigo = 'OAIPCS-013';
--     -- Esperado: es_nacional pasa a false y el caso MD-2026-0013 pierde el
--     -- override (vuelve a NULL).
--     select m.codigo, m.es_nacional, c.alcance_override
--       from core.mesas_dialogo m join core.casos c on c.id = m.caso_id
--      where m.codigo = 'OAIPCS-013';
--   rollback;
--
-- Cómo revertir
-- -------------
--   begin;
--   drop trigger if exists trg_mesa_nacional on core.mesas_dialogo;
--   drop trigger if exists trg_mesa_nacional_caso on core.mesas_dialogo;
--   drop function if exists core.trg_mesa_nacional_caso();
--   drop function if exists core.trg_mesa_nacional();
--   drop function if exists core.mesa_es_nacional(text);
--   delete from core.migracion_log where clave = '90_trigger_mesa_nacional_2026_11_29';
--   commit;
--   -- Las marcas es_nacional y los alcance_override ya escritos se conservan.
-- =============================================================================
