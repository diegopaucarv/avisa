-- =============================================================================
-- 33 · Un solo estado abierto: Activo + En seguimiento → Abierto
--
-- Motivo (2026-11-22): el catálogo tenía cuatro valores y dos significaban lo
-- mismo (`Activo` y `En seguimiento` comparten `es_activo = true`). Tras la
-- migración 31 todos los expedientes quedaron en `En seguimiento` y la
-- interfaz mostraba «Abiertos» en el filtro y «En seguimiento» en la ficha: el
-- usuario leía dos nombres para el mismo hecho. Se unifica en tres estados
-- operativos y el catálogo pasa a coincidir con los chips de la lista.
--
--   id 1 → Abierto    (es_activo = true)
--   id 3 → Resuelto
--   id 4 → Archivado
--
-- No se toca `anular`/`restaurar` ni la RLS: la anulación es otra dimensión
-- (`core.casos.anulado_en`) y sigue intacta. Los indicadores se calculan con
-- `ec.es_activo`, que no cambia de valor.
--
-- Reversible con el bloque final.
-- =============================================================================

begin;

-- 1 · El estado abierto toma el nombre que ya usan los chips y el glosario.
update core.cat_estados_caso
   set codigo = 'Abierto'
 where id = 1
   and codigo = 'Activo';

-- 2 · Los expedientes vigentes pasan al estado abierto único.
update core.casos
   set estado_id = 1
 where estado_id = 2;

-- 3 · Historial. Los tramos que abrió la migración 31 describían el paso a
--     «En seguimiento», un nombre que deja de existir; se retiran, y el tramo
--     original (estado 1) vuelve a quedar abierto. Así cada caso conserva un
--     único tramo, con su fecha de inicio real y sin un cambio ficticio.
delete from core.caso_estado_historial
 where estado_id = 2;

-- La guarda evita chocar con `ux_caso_historial_vigente` si un caso ya tiene
-- un tramo abierto: sólo se reabre el tramo cerrado cuando no hay otro abierto.
update core.caso_estado_historial h
   set hasta = null
 where h.estado_id = 1
   and h.hasta is not null
   and not exists (
     select 1
       from core.caso_estado_historial o
      where o.caso_id = h.caso_id
        and o.hasta is null
   );

-- 4 · Retirar el estado duplicado (ya no lo referencia ninguna fila).
delete from core.cat_estados_caso
 where id = 2
   and codigo = 'En seguimiento';

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
select id, codigo, es_activo
  from core.cat_estados_caso
 order by id;

select ec.codigo as estado, count(*) as casos
  from core.casos c
  join core.cat_estados_caso ec on ec.id = c.estado_id
 where c.anulado_en is null
 group by 1
 order by 2 desc;

-- Un solo tramo abierto por caso (35).
select count(*) as tramos_abiertos,
       count(distinct caso_id) as casos_con_tramo_abierto
  from core.caso_estado_historial
 where hasta is null;

-- Ningún caso con dos tramos abiertos (debe devolver 0 filas).
select caso_id, count(*) as abiertos
  from core.caso_estado_historial
 where hasta is null
 group by 1
having count(*) > 1;

-- -----------------------------------------------------------------------------
-- Reversión (descomentar si hay que volver atrás):
--
-- insert into core.cat_estados_caso (id, codigo, es_activo)
-- values (2, 'En seguimiento', true);
-- update core.cat_estados_caso set codigo = 'Activo' where id = 1;
-- -- Los 35 casos vuelven a `En seguimiento` y se reabre su tramo:
-- update core.casos set estado_id = 2 where estado_id = 1 and anulado_en is null;
-- -----------------------------------------------------------------------------
