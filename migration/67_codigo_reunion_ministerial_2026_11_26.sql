-- =============================================================================
-- 67 · Código especial para reuniones ministeriales
--
-- Fecha: 2026-11-26
--
-- Por qué existe
-- --------------
-- Las **reuniones ministeriales** son ejecutivas y de alto nivel: generan
-- compromisos con hitos y tienen actores involucrados, pero no siempre tienen
-- descripción de caso ni línea de tiempo. No deben mezclarse con la serie de
-- casos (`CS-…`) porque no son expedientes de conflictividad.
--
-- Decisión: se guardan en `core.casos` (es la única entidad a la que
-- `core.compromisos.caso_id` puede apuntar) pero con una **serie propia**:
--
--     RM-<año>-<NN>          p. ej. RM-2026-01
--
-- frente a la de casos:
--
--     CS-<subsector>-<temática>-<año>-<NN>
--
-- El prefijo `RM-` es la marca: no hace falta una columna nueva ni un catálogo
-- nuevo, y cualquier consulta puede separar ambos universos por el código.
--
-- Idempotente (`create or replace`) y aditiva: no toca
-- `core.siguiente_codigo_caso()` ni los códigos ya emitidos.
-- =============================================================================

begin;

create or replace function core.siguiente_codigo_reunion_ministerial()
returns text
language sql
security definer
set search_path to 'pg_catalog', 'core'
as $function$
  select core.siguiente_codigo(
    'CASO-RM-' || to_char(now() at time zone 'America/Lima', 'YYYY'),
    'RM-' || to_char(now() at time zone 'America/Lima', 'YYYY') || '-',
    2
  );
$function$;

comment on function core.siguiente_codigo_reunion_ministerial() is
  'Siguiente código de la serie RM-<año>-<NN>, para reuniones ministeriales: ejecutivas, de alto nivel, con compromisos e hitos pero sin expediente de conflictividad. Se guardan en core.casos porque es el padre de core.compromisos.';

insert into core.migracion_log (clave)
values ('67_codigo_reunion_ministerial_2026_11_26')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- La función existe y es SECURITY DEFINER con search_path endurecido.
select p.oid::regprocedure::text as firma,
       p.prosecdef as security_definer,
       p.proconfig as configuracion
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core'
   and p.proname = 'siguiente_codigo_reunion_ministerial';

-- -----------------------------------------------------------------------------
-- Reversión (comentada)
-- -----------------------------------------------------------------------------
-- begin;
-- drop function if exists core.siguiente_codigo_reunion_ministerial();
-- delete from core.migracion_log where clave = '67_codigo_reunion_ministerial_2026_11_26';
-- commit;
