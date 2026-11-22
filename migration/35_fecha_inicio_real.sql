-- =============================================================================
-- 35 · fecha_inicio real del caso, no la fecha de carga
--
-- `core.casos.fecha_inicio` debe ser la fecha del caso que trae el legado
-- (`legacy.fact_casos.c06`), no el instante de carga. `fecha_ultima_actualizacion`
-- es 2026-10-31 en las 34 filas vigentes y ese valor es el que se colaba como
-- «Inicio». No inventa fechas: si el legado no trae c06, fecha_inicio sigue nulo.
--
-- Verificado el 2026-11-22: 31 con fecha real (2012-08-01 … 2026-05-01), 3 sin
-- fecha en origen, 0 filas con la fecha de carga. Hoy afecta 0 filas; queda como
-- guarda idempotente para una recarga que vuelva a copiar la fecha de carga.
-- =============================================================================

begin;

with origen as (
  select c.id,
         to_date(substring(btrim(l.c06) from 1 for 10), 'YYYY-MM-DD') as fecha_origen
    from core.casos c
    join legacy.fact_casos l on l.c01 = c.codigo_legado
   where btrim(l.c06) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
     and (
       c.fecha_inicio is null
       or c.fecha_inicio = (c.fecha_ultima_actualizacion at time zone 'America/Lima')::date
     )
)
update core.casos c
   set fecha_inicio = o.fecha_origen
  from origen o
 where c.id = o.id
   and c.fecha_inicio is distinct from o.fecha_origen;

commit;

-- -----------------------------------------------------------------------------
-- Verificación por caso
-- -----------------------------------------------------------------------------
select c.codigo_caso,
       c.codigo_legado,
       c.fecha_inicio,
       case when btrim(l.c06) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            then to_date(substring(btrim(l.c06) from 1 for 10), 'YYYY-MM-DD')
       end as fecha_legado,
       case when c.fecha_inicio is null then 'sin fecha origen'
            when btrim(l.c06) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
             and c.fecha_inicio = to_date(substring(btrim(l.c06) from 1 for 10), 'YYYY-MM-DD')
            then 'ok'
            else 'revisar' end as estado
  from core.casos c
  left join legacy.fact_casos l on l.c01 = c.codigo_legado
 where c.anulado_en is null
 order by c.codigo_caso;
