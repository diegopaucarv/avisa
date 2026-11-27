-- =============================================================================
-- 83 · Recuperar los hechos heredados que la 73 descartó
--
-- Fecha: 2026-11-27
--
-- Por qué
-- -------
-- La migración 73 repartió `core.alertas_tempranas.hechos_recientes` en filas de
-- `core.alerta_hechos`, pero sólo tomó las líneas que empezaban por «- »
-- (`btrim(s.linea) LIKE '-%'`). El resto del relato —párrafos sin viñeta,
-- encabezados, notas del redactor— quedó fuera de la tabla.
--
-- El daño no fue visible de inmediato porque el panel cae al texto cuando una
-- alerta aún no tiene filas; pero una vez que la alerta tiene al menos un hecho,
-- el panel pinta **sólo** la tabla (`hechosVisibles`), y las líneas sin viñeta
-- desaparecen. Peor: la primera edición de los hechos recompone
-- `hechos_recientes` desde la tabla y borra esas líneas también del texto.
--
-- Qué hace
-- --------
-- 1. Parte de nuevo `hechos_recientes` de cada alerta en líneas no vacías.
-- 2. Limpia las que empiezan por «- » igual que la 73 (quitando viñeta y fecha
--    delante); las demás se conservan tal cual.
-- 3. Inserta sólo las líneas cuya descripción aún no existe como hecho de esa
--    alerta (comparación por `btrim`), añadiéndolas **al final** del orden con
--    `orden` creciente.
--
-- No reescribe `hechos_recientes`: sigue siendo el texto derivado. El repositorio
-- lo recompone en la siguiente edición de hechos, ya sin perder nada, porque la
-- tabla contendrá también estas líneas.
--
-- Efecto observable
-- -----------------
-- · Alertas con líneas sin viñeta: pasan a mostrarlas (y editarlas) en el panel.
-- · Alertas sin líneas pendientes: no cambia ninguna fila.
--
-- Idempotente: la comprobación `not exists` por descripción impide duplicar al
-- reejecutar.
--
-- Cómo revertir
--  · Borrar los hechos cuyo `created_by` sea nulo y `created_at` caiga en la
--    ventana de esta migración es impreciso; si hace falta revertir, use el
--    respaldo previo. La migración sólo añade filas, no modifica ni borra las
--    existentes.
--
-- Requisitos: migración 73 aplicada (`core.alerta_hechos` existe). La 79 y la 80
-- afinaron la extracción de fechas; esta migración las respeta al no tocar las
-- filas que ya existen.
-- =============================================================================

begin;

-- Fecha tolerante `dd/mm/aaaa`, igual que en la 73. Vive en `pg_temp` y muere al
-- cerrar la sesión.
create or replace function pg_temp.fecha_ddmmaaaa(texto text)
returns date
language plpgsql
as $$
begin
  return make_date(
    split_part(texto, '/', 3)::int,
    split_part(texto, '/', 2)::int,
    split_part(texto, '/', 1)::int
  );
exception
  when others then
    return null;
end;
$$;

with lineas as (
  select a.id as alerta_id,
         btrim(s.linea) as texto,
         s.orden::int as orden
    from core.alertas_tempranas a
   cross join lateral regexp_split_to_table(
                coalesce(a.hechos_recientes, ''),
                E'\r?\n'
              ) with ordinality as s(linea, orden)
   where coalesce(a.hechos_recientes, '') <> ''
     and btrim(s.linea) <> ''
), limpias as (
  select alerta_id,
         orden,
         -- Sólo las viñetas llevan fecha extraíble: replica la regla de la 73.
         case
           when texto like '-%'
             then pg_temp.fecha_ddmmaaaa(
                    (regexp_match(texto, '^-\s*(\d{1,2}/\d{1,2}/\d{4})'))[1]
                  )
           else null
         end as fecha,
         case
           when texto like '-%'
             then btrim(
                    regexp_replace(
                      texto,
                      '^-\s*(\d{1,2}/\d{1,2}/\d{4})?\s*[-–—]?\s*',
                      ''
                    )
                  )
           else texto
         end as descripcion
    from lineas
), pendientes as (
  select l.alerta_id, l.orden, l.fecha, l.descripcion
    from limpias l
   where l.descripcion <> ''
     and not exists (
           select 1
             from core.alerta_hechos h
            where h.alerta_id = l.alerta_id
              and btrim(h.descripcion) = l.descripcion
         )
), numeradas as (
  select p.alerta_id,
         p.fecha,
         p.descripcion,
         coalesce(
           (select max(h.orden)
              from core.alerta_hechos h
             where h.alerta_id = p.alerta_id),
           -1
         )
         + row_number() over (partition by p.alerta_id order by p.orden) as nuevo_orden
    from pendientes p
)
insert into core.alerta_hechos (alerta_id, fecha, descripcion, orden)
select alerta_id, fecha, descripcion, nuevo_orden
  from numeradas;

drop function if exists pg_temp.fecha_ddmmaaaa(text);

insert into core.migracion_log (clave)
values ('83_alerta_hechos_lineas_heredadas_2026_11_27')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Verificación (ejecutar fuera de la importación, sólo lectura)
-- =============================================================================
--  -- Cuántas alertas recibieron líneas nuevas:
--  select count(distinct alerta_id)
--    from core.alerta_hechos
--   where created_by is null
--     and created_at >= now() - interval '1 hour';
--
--  -- Ninguna línea del texto debe quedar fuera de la tabla:
--  select a.id, btrim(s.linea) as linea
--    from core.alertas_tempranas a
--   cross join lateral regexp_split_to_table(coalesce(a.hechos_recientes,''), E'\r?\n')
--                with ordinality as s(linea, orden)
--   where btrim(s.linea) <> ''
--     and not exists (
--       select 1 from core.alerta_hechos h
--        where h.alerta_id = a.id and btrim(h.descripcion) = btrim(s.linea)
--     );
-- =============================================================================
