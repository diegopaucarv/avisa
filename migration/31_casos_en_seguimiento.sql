-- 31 · Los casos abiertos del legado pasan a «En seguimiento»
--
-- La carga histórica dejó los 35 casos en `Activo` (estado_id = 1): un valor que
-- el catálogo marca como abierto pero que no distingue seguimiento. La operación
-- de la OAIPCS trata esos expedientes como casos en seguimiento, y el catálogo
-- ya tiene ese valor (id 2, `es_activo = true`), así que la reclasificación no
-- cambia qué casos cuentan como abiertos: cambia su etiqueta.
--
-- `Activo` queda reservado para el alta de casos nuevos. Como los dos estados
-- tienen `es_activo = true`, las vistas y los índices que filtran por esa columna
-- (o por `estado_id in (1,2)`) siguen viendo el mismo conjunto.
--
-- Reversión: `update core.casos set estado_id = 1 where estado_id = 2;` y retirar
-- los tramos abiertos con el motivo «Reclasificación del legado…».

begin;

-- Cierra el tramo abierto en el historial de cada caso que se reclasifica.
update core.caso_estado_historial h
   set hasta = now()
 where h.hasta is null
   and h.caso_id in (select c.id from core.casos c where c.estado_id = 1);

-- Abre el tramo nuevo, con el riesgo y el nivel de conflicto vigentes del caso.
insert into core.caso_estado_historial
       (caso_id, nivel_conflicto_id, nivel_riesgo_id, estado_id, motivo)
select c.id,
       c.nivel_conflicto_id,
       c.nivel_riesgo_id,
       2,
       'Reclasificación del legado: el expediente está abierto y en seguimiento'
  from core.casos c
 where c.estado_id = 1;

update core.casos c
   set estado_id = 2
 where c.estado_id = 1;

commit;
