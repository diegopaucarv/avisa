-- =============================================================================
-- 85 · C8 · Fechas compactas que quedaron dentro del texto del hecho
--
-- Fecha: 2026-11-27
--
-- Por qué
-- -------
-- Las migraciones 73 y 83 repartieron `hechos_recientes` en filas, pero su regla
-- de fecha solo entendía viñeta «- » y fecha `dd/mm/aaaa`. Los hechos heredados
-- del legado vienen con otra forma:
--
--     * 01ABR2026 — MINAM remite a PRODUCE el Oficio N° D000085-2026-…
--     * 17ABR2026 Municipalidad informó que se activó fiscalización…
--
-- Al no reconocerlas, la 83 insertó la línea completa como descripción con
-- `fecha` nula. En pantalla se lee «01ABR2026 - * 01ABR2026 — …»: el día repetido
-- y la viñeta dentro del texto —el defecto reportado como «2NOV2026 - 7NOV2026»—.
--
-- Qué hace
-- --------
-- 1. Detecta los hechos cuya descripción **empieza** por «*» + fecha compacta
--    (`DDMMMAAAA` o `DDMMMAA`, tolerando `SEP` por `SET`).
-- 2. Si el mes existe, mueve la fecha a la columna `fecha` y deja la descripción
--    sin viñeta ni fecha. Los rangos («* 23-29MAR2026 — …») no se tocan: no
--    empiezan por una fecha simple y su dato es un periodo, no un día.
-- 3. Recompone `hechos_recientes` de las alertas afectadas con exactamente el
--    mismo formato que `lineaHecho()` de `lib/db/repos/alerts-hechos.ts`
--    (`- 05NOV2026 — descripción`), para no introducir una tercera variante.
--
-- No toca los textos donde la fecha aparece a media frase («… el 15ABR2026 se
-- emitió…»): ahí la fecha es parte de la redacción y `fecha` quedaría con un día
-- que no corresponde al hecho.
--
-- Efecto observable
-- -----------------
-- · Las fechas de esos hechos dejan de duplicarse y se ordenan por fecha.
-- · `hechos_recientes` (WhatsApp y exportaciones) pierde la viñeta «*» y gana
--   el formato único de la tabla.
--
-- Idempotente: tras la primera pasada ninguna descripción empieza por «*» +
-- fecha, así que la segunda ejecución no encuentra filas.
--
-- Cómo revertir
--  · Restaurar las filas afectadas desde el respaldo
--    `scripts/_respaldo_c8_2026-11-27.json` (incluye `descripcion`, `fecha` y el
--    `hechos_recientes` previo de cada alerta tocada).
--
-- Requisitos: 73 y 83 aplicadas (`core.alerta_hechos` existe y está poblada).
-- =============================================================================

begin;

-- «01ABR2026» → 2026-04-01. Null si el mes no es reconocible, de modo que los
-- textos que no son fechas («* Compromiso 03 : …») quedan intactos.
create or replace function pg_temp.fecha_compacta(texto text)
returns date
language plpgsql
as $$
declare
  partes text[] := regexp_match(texto, '^(\d{1,2})([A-Za-z]{3,4})(\d{4})$');
  mes int;
begin
  if partes is null then
    return null;
  end if;

  mes := case upper(partes[2])
           when 'ENE' then 1  when 'FEB' then 2  when 'MAR' then 3
           when 'ABR' then 4  when 'MAY' then 5  when 'JUN' then 6
           when 'JUL' then 7  when 'AGO' then 8  when 'SET' then 9
           when 'SEP' then 9  when 'OCT' then 10 when 'NOV' then 11
           when 'DIC' then 12 else null
         end;
  if mes is null then
    return null;
  end if;

  return make_date(partes[3]::int, mes, partes[1]::int);
exception
  when others then return null;
end;
$$;

-- Alertas que hay que recomponer al final (antes de modificar nada).
create temp table c8_afectadas on commit drop as
select distinct h.alerta_id
  from core.alerta_hechos h
 where h.anulado_en is null
   and pg_temp.fecha_compacta(
         (regexp_match(h.descripcion, '^\*\s*(\d{1,2}[A-Za-z]{3,4}\d{4})(?![A-Za-z0-9])'))[1]
       ) is not null;

with objetivo as (
  select h.id,
         pg_temp.fecha_compacta(
           (regexp_match(h.descripcion, '^\*\s*(\d{1,2}[A-Za-z]{3,4}\d{4})(?![A-Za-z0-9])'))[1]
         ) as fecha,
         btrim(
           regexp_replace(
             h.descripcion,
             '^\*\s*\d{1,2}[A-Za-z]{3,4}\d{4}\s*(?:[—–-]\s*)?',
             ''
           )
         ) as resto
    from core.alerta_hechos h
   where h.anulado_en is null
     and h.descripcion ~ '^\*\s*\d{1,2}[A-Za-z]{3,4}\d{4}'
)
update core.alerta_hechos h
   set fecha = o.fecha,
       descripcion = o.resto
  from objetivo o
 where h.id = o.id
   and o.fecha is not null
   and o.resto <> ''
   and h.descripcion is distinct from o.resto;

-- Misma proyección que `lineaHecho()`: «- 05NOV2026 — descripción».
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
      join c8_afectadas t on t.alerta_id = h.alerta_id
     where h.anulado_en is null
     group by h.alerta_id
  ) sub
 where a.id = sub.alerta_id;

drop function if exists pg_temp.fecha_compacta(text);

insert into core.migracion_log (clave)
values ('85_c8_hechos_fecha_compacta_2026_11_27')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Verificación (sólo lectura, fuera de la importación)
-- =============================================================================
--  -- No debe quedar ninguna descripción que empiece por «*» + fecha:
--  select count(*) from core.alerta_hechos
--   where anulado_en is null and descripcion ~ '^\*\s*\d{1,2}[A-Za-z]{3,4}\d{4}';
--
--  -- Los hechos con fecha deben proyectarse en el texto derivado:
--  select count(*) from core.alerta_hechos
--   where anulado_en is null and fecha is not null;
-- =============================================================================
