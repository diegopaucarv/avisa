-- =============================================================================
-- 34 · Un solo tramo en el historial de estado
--
-- Contexto (2026-11-22): la migración 33 corrigió `core.casos.estado_id` de 2 a
-- 1. El trigger `core.caso_historial()` responde a ese cambio cerrando el tramo
-- vigente y abriendo otro con el mismo estado y `desde = now()`. El resultado
-- eran dos tramos por caso con el mismo nombre («Abierto»), que es justo la
-- ambigüedad que la 33 quería quitar: el primero con la fecha real de inicio
-- (2026-10-31) cerrado, y el segundo abierto hoy.
--
-- Este script retira ese tramo sintético y reabre el original, de modo que cada
-- caso quede con un único tramo abierto cuya fecha de inicio es la real. No
-- toca `core.casos`: los expedientes ya están en el estado correcto.
--
-- Criterio del tramo sintético: es un tramo abierto que duplica un tramo más
-- antiguo del mismo caso y del mismo estado. El trigger abrió un tramo nuevo
-- con el estado corregido en lugar de reutilizar el histórico.
--
-- Reversible: el tramo sintético se puede reconstruir con el trigger si vuelve
-- a cambiar el estado del caso.
-- =============================================================================

begin;

-- 1 · Retirar el tramo sintético de cada caso.
delete from core.caso_estado_historial h
 where h.hasta is null
   and exists (
     select 1
       from core.caso_estado_historial o
      where o.caso_id = h.caso_id
        and o.estado_id = h.estado_id
        and o.id <> h.id
        and o.desde < h.desde
   );

-- 2 · Reabrir el tramo original: el único que queda por caso.
update core.caso_estado_historial h
   set hasta = null
 where h.hasta is not null
   and not exists (
     select 1
       from core.caso_estado_historial o
      where o.caso_id = h.caso_id
        and o.id <> h.id
   );

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------

-- Un tramo por caso, todos abiertos.
select count(*) as tramos,
       count(distinct caso_id) as casos,
       count(*) filter (where hasta is null) as abiertos
  from core.caso_estado_historial;

-- Debe devolver 0 filas.
select caso_id, count(*) as tramos
  from core.caso_estado_historial
 group by 1
having count(*) > 1;

-- El tramo abierto conserva la fecha de inicio del legado (31 oct 2026).
select min(desde) as primer_inicio, max(desde) as ultimo_inicio
  from core.caso_estado_historial
 where hasta is null;
