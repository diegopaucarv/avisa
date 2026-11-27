-- =============================================================================
-- 80 · Fecha de los hechos «dd.mm» sin año y limpieza del log
--
-- Fecha: 2026-11-27
--
-- Por qué
-- -------
-- 1. Tras la 79 quedan 9 hechos de alerta cuya descripción empieza por
--    `dd.mm` sin año (`13.06 – Se publicó la RM N.° 169-2026-PRODUCE`). La 79
--    no los toca porque el año no está escrito y no quiso suponerlo.
--    Comprobación sobre la data: en los 9 casos el día/mes es anterior o igual
--    a la fecha de reporte de su propia alerta (AT-2026-30 → 2026-06-14,
--    AT-2026-86 → 2026-07-03), así que el año del reporte es el año del hecho.
-- 2. `core.migracion_log` aún podía arrastrar las claves
--    `71_proceso_instancia_cascada_2026_11_26` y
--    `72_cronologia_vinculos_cascada_2026_11_26`: ambos guiones se fusionaron en
--    la 66 y la 76/77 ocuparon esos números después. En la base actual esas
--    claves ya no existen; el borrado se deja por si otro entorno las conserva.
--
-- Qué hace
-- --------
-- 1. Rellena `core.alerta_hechos.fecha` para los hechos que empiezan por
--    `dd.mm` sin año, tomando el año de `core.alertas_tempranas.fecha_reporte`.
--    Si la fecha resultante quedara **después** del reporte, se resta un año
--    (el hecho sería del año anterior). Si la alerta no tiene fecha de reporte,
--    el hecho se queda sin fecha: no se inventa nada.
--    Además quita el prefijo `dd.mm` y su separador de la descripción, porque
--    ya vive en la columna `fecha`.
-- 2. Borra las dos claves huérfanas de `core.migracion_log`.
--
-- Idempotente: sólo mira filas con `fecha IS NULL` y el `DELETE` es por clave
-- exacta (no falla si ya no están).
-- =============================================================================

begin;

-- 0 · Fecha tolerante ---------------------------------------------------------
-- Un `31.02` en otro entorno no debe abortar la migración: devuelve NULL y el
-- hecho se queda sin fecha. Vive en `pg_temp` y desaparece con la sesión.

CREATE OR REPLACE FUNCTION pg_temp.fecha_ddmmaa(p_dia int, p_mes int, p_anio int)
RETURNS date
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN make_date(p_anio, p_mes, p_dia);
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- 1 · Fecha a partir del reporte de la alerta ---------------------------------

WITH candidatos AS (
  SELECT h.id,
         h.descripcion,
         a.fecha_reporte,
         (regexp_match(h.descripcion, '^(\d{1,2})[./](\d{1,2})'))[1]::int AS dia,
         (regexp_match(h.descripcion, '^(\d{1,2})[./](\d{1,2})'))[2]::int AS mes
    FROM core.alerta_hechos h
    JOIN core.alertas_tempranas a ON a.id = h.alerta_id
   WHERE h.fecha IS NULL
     AND a.fecha_reporte IS NOT NULL
     -- `dd.mm` seguido de separador: excluye `dd.mm.aaaa`, que ya trató la 79.
     AND h.descripcion ~ '^\d{1,2}[./]\d{1,2}\s*[–—-]'
), tentativos AS (
  SELECT c.*,
         COALESCE(
           -- El hecho es del año del reporte…
           CASE
             WHEN pg_temp.fecha_ddmmaa(c.dia, c.mes, extract(year FROM c.fecha_reporte)::int)
                  > c.fecha_reporte
             -- …salvo que caiga después: entonces es del año anterior.
             THEN pg_temp.fecha_ddmmaa(c.dia, c.mes, extract(year FROM c.fecha_reporte)::int - 1)
             ELSE pg_temp.fecha_ddmmaa(c.dia, c.mes, extract(year FROM c.fecha_reporte)::int)
           END,
           pg_temp.fecha_ddmmaa(c.dia, c.mes, extract(year FROM c.fecha_reporte)::int)
         ) AS fecha
    FROM candidatos c
), validos AS (
  SELECT t.*,
         btrim(
           regexp_replace(t.descripcion, '^\d{1,2}[./]\d{1,2}\s*[–—-]?\s*:?\s*', '')
         ) AS texto
    FROM tentativos t
   WHERE t.fecha IS NOT NULL
)
UPDATE core.alerta_hechos h
   SET fecha = v.fecha,
       descripcion = CASE
                       WHEN btrim(v.texto) = '' THEN h.descripcion
                       ELSE v.texto
                     END
  FROM validos v
 WHERE h.id = v.id;

DROP FUNCTION IF EXISTS pg_temp.fecha_ddmmaa(int, int, int);

-- 2 · Claves huérfanas del log ------------------------------------------------

DELETE FROM core.migracion_log
 WHERE clave IN (
   '71_proceso_instancia_cascada_2026_11_26',
   '72_cronologia_vinculos_cascada_2026_11_26'
 );

INSERT INTO core.migracion_log (clave)
VALUES ('80_alerta_hechos_sin_anio_2026_11_27')
ON CONFLICT (clave) DO NOTHING;

COMMIT;

-- =============================================================================
--  Verificación
-- =============================================================================
--  -- Debe quedar en 0: ningún hecho «dd.mm» sin año pendiente.
--  SELECT count(*) FROM core.alerta_hechos
--   WHERE fecha IS NULL AND descripcion ~ '^\d{1,2}[./]\d{1,2}\s*[–—-]';
--
--  -- Distribución final.
--  SELECT count(*) AS total,
--         count(fecha) AS con_fecha,
--         count(*) FILTER (WHERE fecha IS NULL) AS sin_fecha
--    FROM core.alerta_hechos;
--
--  -- El log no debe tener las claves 71/72.
--  SELECT clave FROM core.migracion_log WHERE clave LIKE '71%' OR clave LIKE '72%';
