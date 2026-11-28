-- =============================================================================
-- 86 · C8 · Quitar la viñeta «*» que el legado dejó dentro del hecho
--
-- Fecha: 2026-11-27
--
-- Por qué
-- -------
-- Las líneas recuperadas por la 83 venían de `hechos_recientes`, donde cada
-- hecho es una línea. Algunas estaban escritas con viñeta de asterisco («* …»)
-- en lugar de guion. En la tabla cada fila ya es una viñeta, así que el «*»
-- quedaba duplicado: en el panel se ve «* 23-29MAR2026 — COP15…» y en el texto
-- derivado «- * 23-29MAR2026 — COP15…».
--
-- Qué hace
-- --------
-- 1. Recorta el «*» inicial (con sus espacios) de las descripciones de hechos.
-- 2. Recompone `hechos_recientes` de las alertas afectadas con el formato único
--    de `lineaHecho()` (`- 05NOV2026 — descripción`).
--
-- No toca las fechas: la 85 ya movió las que estaban al inicio del texto.
--
-- Idempotente: sin «*» inicial, la segunda pasada no encuentra filas.
--
-- Cómo revertir: `scripts/_respaldo_c8_2026-11-27.json` conserva descripciones
-- y textos previos de las alertas tocadas por la 85; para las que solo toca esta
-- migración, el cambio es la inserción de un «*» al inicio.
--
-- Requisitos: 73, 83 y 85 aplicadas.
-- =============================================================================

begin;

create temp table c8_vineta on commit drop as
select h.id, h.alerta_id, btrim(regexp_replace(h.descripcion, '^\*\s*', '')) as limpia
  from core.alerta_hechos h
 where h.anulado_en is null
   and h.descripcion ~ '^\*\s*';

update core.alerta_hechos h
   set descripcion = v.limpia
  from c8_vineta v
 where h.id = v.id
   and v.limpia <> '';

update core.alertas_tempranas a
   set hechos_recientes = sub.texto
  from (
    select h.alerta_id,
           string_agg(
             case
               when h.fecha is not null then
                 '- ' || to_char(h.fecha, 'DD')
                      || (array['ENE','FEB','MAR','ABR','MAY','JUN',
                               'JUL','AGO','SET','OCT','NOV','DIC']
                          )[extract(month from h.fecha)::int]
                      || to_char(h.fecha, 'YYYY')
                      || ' — ' || h.descripcion
               else '- ' || h.descripcion
             end,
             E'\n'
             order by h.orden asc, h.fecha asc nulls last, h.created_at asc
           ) as texto
      from core.alerta_hechos h
      join (select distinct alerta_id from c8_vineta) t on t.alerta_id = h.alerta_id
     where h.anulado_en is null
     group by h.alerta_id
  ) sub
 where a.id = sub.alerta_id;

insert into core.migracion_log (clave)
values ('86_c8_hechos_vineta_asterisco_2026_11_27')
on conflict (clave) do nothing;

commit;

-- Verificación (sólo lectura)
--  select count(*) from core.alerta_hechos
--   where anulado_en is null and descripcion ~ '^\*\s*';   -- esperado 0
