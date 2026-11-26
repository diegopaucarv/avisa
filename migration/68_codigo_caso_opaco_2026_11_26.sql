-- =============================================================================
-- 68 · Código de caso sin subsector ni temática
--
-- Fecha: 2026-11-26
--
-- Por qué
-- -------
-- El código actual incrusta dos catálogos:
--
--     CS-<subsector>-<temática>-<año>-<NN>   p. ej. CS-MI-INF-2025-01
--
-- Eso envejece mal:
--   · la **temática** pasó a ser un atributo de CADA DEMANDA (2026-11-25), no
--     del caso, así que el segmento temático del código ya no describe nada;
--   · el **subsector** es un dato corregible: si se rectifica, el código queda
--     mintiendo y no se puede cambiar sin romper enlaces.
--
-- Un identificador debe ser estable y opaco. El nuevo esquema es:
--
--     CS-<año>-<NNNN>     p. ej. CS-2026-0001
--     RM-<año>-<NNNN>     p. ej. RM-2026-0001   (reuniones ministeriales)
--
-- Secuencia por año, cuatro dígitos, sin dependencia de catálogos.
--
-- Compatibilidad
-- --------------
-- Se conserva la firma `core.siguiente_codigo_caso(integer, integer)` para no
-- romper a quien la llama (la API de alta de caso), pero **los parámetros se
-- ignoran**: quedan documentados como obsoletos.
--
-- Los códigos YA emitidos no se tocan aquí. Renombrarlos es una decisión aparte
-- porque `codigo_caso` aparece en URLs (`/casos/:codigo`), exportes y enlaces
-- compartidos.
-- =============================================================================

begin;

create or replace function core.siguiente_codigo_caso(
  p_subsector_id integer default 1,
  p_tematica_id integer default 1
)
returns text
language sql
security definer
set search_path to 'pg_catalog', 'core'
as $function$
  select core.siguiente_codigo(
    'CASO-' || to_char(now() at time zone 'America/Lima', 'YYYY'),
    'CS-' || to_char(now() at time zone 'America/Lima', 'YYYY') || '-',
    4
  );
$function$;

comment on function core.siguiente_codigo_caso(integer, integer) is
  'Siguiente código de caso, serie opaca CS-<año>-<NNNN>. Los parámetros p_subsector_id y p_tematica_id están OBSOLETOS y se ignoran: la temática es por demanda y el subsector es corregible.';

create or replace function core.siguiente_codigo_reunion_ministerial()
returns text
language sql
security definer
set search_path to 'pg_catalog', 'core'
as $function$
  select core.siguiente_codigo(
    'CASO-RM-' || to_char(now() at time zone 'America/Lima', 'YYYY'),
    'RM-' || to_char(now() at time zone 'America/Lima', 'YYYY') || '-',
    4
  );
$function$;

comment on function core.siguiente_codigo_reunion_ministerial() is
  'Siguiente código de reunión ministerial, serie RM-<año>-<NNNN>. Se guarda en core.casos porque es el padre de core.compromisos.';

insert into core.migracion_log (clave)
values ('68_codigo_caso_opaco_2026_11_26')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
select p.oid::regprocedure::text as firma
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core'
   and p.proname in ('siguiente_codigo_caso', 'siguiente_codigo_reunion_ministerial')
 order by 1;
