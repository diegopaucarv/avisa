-- =============================================================================
--  16 · Recodificación de casos al formato del Anexo N° 15
--
--  Requiere: migration/14_alineacion_guia.sql y 15_fusion_hechos_y_tematicas.sql.
--
--  Referencias normativas
--  ----------------------
--    · Anexo N° 15, columna 1: «CS–PA/MI–Temática–Año–Correlativo.
--      Ej.: CS-PA-INF-2026-01.»
--    · Anexo N° 12 / 14, columna «Código de Hito»: el código del hito es el
--      del compromiso más «_H00#» (Ej.: CS-PA-INF-2026-01_COMP001_H001).
--
--  Qué cambia
--  ----------
--  1. Dos funciones de traducción, sin cambios de esquema:
--       core.codigo_subsector(id) → 'PA' | 'MI'
--       core.codigo_tematica(id)  → 'INF' | 'OAT' | 'NOR' | 'DBE' | 'GOB' | 'ITE'
--     La Guía sólo fija los códigos de temática para Infraestructura («INF»);
--     los otros cinco se acuerdan aquí y quedan documentados en el comentario
--     de la función.
--  2. core.siguiente_codigo_caso(subsector, temática): nueva versión con el
--     contador persistente `core.secuencia_codigo`, un ámbito por
--     (año, subsector, temática). La firma conserva dos parámetros con valor
--     por defecto para no romper a quien llame sin argumentos.
--  3. Se recodifican los 35 casos. `codigo_caso` pasa al formato nuevo y
--     `codigo_legado` conserva el valor anterior (`CS-PRODUCE-…`), que es la
--     clave estable del ETL.
--  4. Se recodifican los compromisos y los hitos, porque su código se deriva
--     del de caso y quedarían apuntando a un código que ya no existe.
--     El valor anterior queda en el respaldo previo a esta migración y es
--     reconstruible a partir de `core.casos.codigo_legado`.
--  5. Se reinicia el contador `core.secuencia_codigo` para que el próximo
--     código que emita la base continúe la serie recodificada.
--
--  Cómo se asigna el año y el correlativo
--  --------------------------------------
--    · Año: el de `fecha_inicio` del caso; si falta, el de `created_at`.
--    · Correlativo: por (año, subsector, temática), ordenado por fecha de
--      inicio y luego por el código anterior. Dos dígitos.
--
--  Cómo revertir
--  -------------
--  El código anterior de cada caso vive en `core.casos.codigo_legado`, así que
--  basta con `update core.casos set codigo_caso = codigo_legado;` dentro de una
--  transacción, más el bloque de reversión de los compromisos del final.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Traductores de catálogo → sigla del código de caso
-- -----------------------------------------------------------------------------
create or replace function core.codigo_subsector(p_subsector_id integer)
returns text
language sql
immutable
as $$
  select case p_subsector_id
           when 1 then 'PA'   -- Pesca y Acuicultura
           when 2 then 'MI'   -- MYPE e Industria
           else 'XX'
         end;
$$;

comment on function core.codigo_subsector(integer) is
  'Sigla del subsector para el código de caso del Anexo 15: 1=PA (Pesca y Acuicultura), 2=MI (MYPE e Industria).';

create or replace function core.codigo_tematica(p_tematica_id integer)
returns text
language sql
immutable
as $$
  select case p_tematica_id
           when 1 then 'INF'   -- Infraestructura (fijado por la Guía)
           when 2 then 'OAT'   -- Ordenamiento y acceso territorial
           when 3 then 'NOR'   -- Normatividad
           when 4 then 'DBE'   -- Distribución de beneficios
           when 5 then 'GOB'   -- Gobernanza
           when 6 then 'ITE'   -- Impactos de terceros
           else 'XXX'
         end;
$$;

comment on function core.codigo_tematica(integer) is
  'Sigla de la temática para el código de caso del Anexo 15. La Guía sólo fija INF; OAT/NOR/DBE/GOB/ITE son el acuerdo de esta migración.';

-- -----------------------------------------------------------------------------
-- 2 · Generador de código con contador persistente por (año, subsector, temática)
-- -----------------------------------------------------------------------------
create or replace function core.siguiente_codigo_caso(
  p_subsector_id integer default 1,
  p_tematica_id  integer default 1
)
returns text
language sql
security definer
set search_path = pg_catalog, core
as $$
  select core.siguiente_codigo(
    'CASO-'
      || to_char(now() at time zone 'America/Lima', 'YYYY')
      || '-' || core.codigo_subsector(p_subsector_id)
      || '-' || core.codigo_tematica(p_tematica_id),
    'CS-'
      || core.codigo_subsector(p_subsector_id)
      || '-' || core.codigo_tematica(p_tematica_id)
      || '-' || to_char(now() at time zone 'America/Lima', 'YYYY')
      || '-',
    2
  );
$$;

comment on function core.siguiente_codigo_caso(integer, integer) is
  'Código de caso del Anexo 15 (CS-PA-INF-2026-01). Correlativo persistente por año, subsector y temática; nunca se reutiliza un número.';

grant execute on function core.codigo_subsector(integer)              to avisa_app, avisa_api;
grant execute on function core.codigo_tematica(integer)               to avisa_app, avisa_api;
grant execute on function core.siguiente_codigo_caso(integer, integer) to avisa_app, avisa_api;

-- -----------------------------------------------------------------------------
-- 3 · Recodificación de los 35 casos
-- -----------------------------------------------------------------------------
create temp table _recodificacion on commit drop as
with base as (
  select c.id,
         c.codigo_caso                                              as viejo,
         coalesce(c.fecha_inicio, c.created_at::date)               as ref,
         extract(year from coalesce(c.fecha_inicio, c.created_at::date))::int as anio,
         core.codigo_subsector(c.subsector_id)                      as sub,
         core.codigo_tematica(c.tematica_id)                        as tem
    from core.casos c
),
ranked as (
  select b.*,
         row_number() over (
           partition by b.anio, b.sub, b.tem
           order by b.ref, b.viejo
         ) as rn
    from base b
)
select id,
       viejo,
       'CS-' || sub || '-' || tem || '-' || anio || '-' || lpad(rn::text, 2, '0') as nuevo,
       anio, sub, tem, rn
  from ranked;

update core.casos c
   set codigo_caso  = r.nuevo,
       codigo_legado = coalesce(c.codigo_legado, r.viejo)
  from _recodificacion r
 where c.id = r.id;

-- -----------------------------------------------------------------------------
-- 4 · Compromisos e hitos: el código se deriva del de caso
-- -----------------------------------------------------------------------------
-- 4.1 · Compromisos: se reemplaza el prefijo de caso y se conserva el sufijo.
update core.compromisos k
   set codigo_compromiso = c.codigo_caso
                           || substring(k.codigo_compromiso from '_COMP[0-9]+$')
  from core.casos c
 where k.caso_id = c.id
   and k.codigo_compromiso like 'CS-PRODUCE-%';

-- 4.2 · Hitos: Anexo 12/14 exige «código de compromiso» + «_H00#».
with r as (
  select h.id,
         k.codigo_compromiso,
         row_number() over (
           partition by h.compromiso_id
           order by h.codigo_hito
         ) as rn
    from core.hitos_compromiso h
    join core.compromisos k on k.id = h.compromiso_id
   where h.codigo_hito like 'HIT-%'
)
update core.hitos_compromiso h
   set codigo_hito = r.codigo_compromiso || '_H' || lpad(r.rn::text, 3, '0')
  from r
 where h.id = r.id;

-- -----------------------------------------------------------------------------
-- 5 · Reinicio del contador persistente
-- -----------------------------------------------------------------------------
delete from core.secuencia_codigo where ambito like 'CASO%';

insert into core.secuencia_codigo (ambito, ultimo, actualizado_en)
select 'CASO-'
         || extract(year from coalesce(c.fecha_inicio, c.created_at::date))::int
         || '-' || core.codigo_subsector(c.subsector_id)
         || '-' || core.codigo_tematica(c.tematica_id),
       max((regexp_match(c.codigo_caso, '-(\d+)$'))[1]::bigint),
       now()
  from core.casos c
 group by 1;

-- -----------------------------------------------------------------------------
-- 6 · Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
select codigo_caso, codigo_legado, subsector_id, tematica_id, fecha_inicio
  from core.casos
 order by codigo_caso;

select codigo_compromiso from core.compromisos order by 1;
select codigo_hito from core.hitos_compromiso order by 1;

select ambito, ultimo from core.secuencia_codigo order by ambito;

-- Ningún código debe repetirse y todos deben casar con el patrón del Anexo 15.
select 'casos_fuera_de_formato' as control, count(*) as filas
  from core.casos
 where codigo_caso !~ '^CS-(PA|MI)-(INF|OAT|NOR|DBE|GOB|ITE)-[0-9]{4}-[0-9]{2}$';

select 'casos_codigo_duplicado' as control, count(*) as filas
  from (select codigo_caso from core.casos group by 1 having count(*) > 1) d;

refresh materialized view analytics.mv_dashboard_alta_direccion;

commit;

-- =============================================================================
--  Reversión manual (descomentar y ejecutar en su propia transacción)
-- =============================================================================
--
-- begin;
--
-- update core.compromisos k
--    set codigo_compromiso = c.codigo_legado
--                            || substring(k.codigo_compromiso from '_COMP[0-9]+$')
--   from core.casos c
--  where k.caso_id = c.id
--    and k.codigo_compromiso like 'CS-PA-%';
--
-- update core.casos set codigo_caso = codigo_legado;
--
-- -- Los hitos vuelven a su serie anterior sólo si se restauran desde el
-- -- respaldo previo; la serie HIT-#### no es reconstruible desde el dato actual.
--
-- delete from core.secuencia_codigo where ambito like 'CASO%';
-- insert into core.secuencia_codigo (ambito, ultimo) values ('CASO', 35);
--
-- refresh materialized view analytics.mv_dashboard_alta_direccion;
--
-- commit;
