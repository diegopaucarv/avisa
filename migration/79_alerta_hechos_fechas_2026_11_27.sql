-- =============================================================================
-- 79 · Fecha real de los hechos de alerta
--
-- Fecha: 2026-11-27
--
-- Por qué
-- -------
-- La migración 73 repartió `hechos_recientes` en filas y sólo supo extraer la
-- fecha cuando venía como `dd/mm/aaaa` al inicio (después del «- »). El texto
-- real usa otras formas, así que hoy 152 de los 153 hechos quedan con `fecha`
-- nula y la fecha vive dentro de `descripcion`:
--
--   · `12.06.2026 — …`        (dd.mm.aaaa)
--   · `08.SET.2025 — …`       (dd.MMM.aaaa, con SET por septiembre)
--   · `24.01.2026: …`         (dos puntos como separador)
--   · `27.04.2026 DIREPRO …`  (sólo un espacio)
--   · `28.04.2026–30.04.2026 — …` (rango: se toma la primera fecha)
--
-- Otras formas **no** dan una fecha sin inventar datos y se dejan intactas:
-- `11.06 – …` y `El 22/04, a las 11 h` (sin año), `ENE–MAY 2026`, `JUN 2026`
-- (sólo mes), `27–28.ABR.2026` (rango de días) y las fechas que aparecen a
-- mitad del relato (`El 15/01/2026 se registró …`).
--
-- Medición sobre la data actual: de los 152 hechos sin fecha, 45 quedan con
-- fecha y 107 siguen sin ella. De esos 107, 9 traen `dd.mm` sin año
-- (`13.06 – Se publicó la RM N.° 169-2026-PRODUCE`). El año se podría inferir
-- del número de la norma o de la fecha de reporte de la alerta, pero eso es
-- suponer: se dejan para corrección manual.
--
-- Qué hace
-- --------
-- 1. `pg_temp.fecha_hecho(text)`: devuelve la fecha del **prefijo** del relato
--    si es `dd.mm.aaaa`, `dd/mm/aaaa` o `dd.MMM.aaaa`, y `NULL` en cualquier
--    otro caso. Los meses aceptan las tres letras en español, incluida `SET`,
--    que es la que usa la data (`SEP` también vale). Una fecha imposible
--    (31/02) devuelve `NULL` en vez de abortar la migración.
-- 2. `pg_temp.sin_prefijo_hecho(text)`: quita ese mismo prefijo y un separador
--    opcional («—», «–», «-», «:» o espacios). Si el resultado quedara vacío
--    (la descripción era sólo la fecha), se conserva el texto original. Tampoco
--    limpia cuando lo que sigue es otra fecha (`28.04.2026–30.04.2026`): es un
--    rango y borrar la segunda fecha perdería contexto.
-- 3. Actualiza **sólo** las filas con `fecha IS NULL`, escribiendo `fecha` y la
--    descripción limpia.
--
-- Lo que no toca
-- --------------
-- `core.alertas_tempranas.hechos_recientes` se conserva tal cual: sigue siendo
-- el texto derivado que consumen la plantilla de WhatsApp y las exportaciones,
-- y su contenido no pierde nada porque sólo se han movido fechas al campo
-- estructurado. Si la aplicación recompone ese texto al guardar, lo hará con
-- las fechas ya normalizadas.
--
-- Idempotente: filtra por `fecha IS NULL`, de modo que reejecutar no reescribe
-- ni vuelve a quitar prefijos.
-- =============================================================================

begin;

-- 1 · Lectura del prefijo -----------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.fecha_hecho(p_texto text)
RETURNS date
LANGUAGE plpgsql
AS $$
DECLARE
  v text := btrim(coalesce(p_texto, ''));
  m text[];
  v_mes text;
  v_num int;
  v_meses text[] := array[
    'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
    'JUL', 'AGO', 'SET', 'SEP', 'OCT', 'NOV', 'DIC'
  ];
BEGIN
  -- dd.mm.aaaa (o dd/mm/aaaa). El lookahead evita comerse los dos primeros
  -- dígitos de un año de cinco cifras.
  m := regexp_match(v, '^(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)');
  IF m IS NOT NULL THEN
    BEGIN
      RETURN make_date(m[3]::int, m[2]::int, m[1]::int);
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
  END IF;

  -- dd.MMM.aaaa
  m := regexp_match(upper(v), '^(\d{1,2})\.([A-Z]{3})\.(\d{4})(?!\d)');
  IF m IS NOT NULL THEN
    v_mes := m[2];
    -- `SET` es la abreviatura que trae la data; `SEP` es la del estándar.
    v_num := array_position(v_meses, v_mes);
    IF v_num IS NULL AND v_mes = 'SEP' THEN
      v_num := 9;
    END IF;
    IF v_num IS NULL THEN
      RETURN NULL;
    END IF;
    BEGIN
      RETURN make_date(m[3]::int, v_num, m[1]::int);
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
  END IF;

  RETURN NULL;
END;
$$;

-- 2 · Limpieza del prefijo ----------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.sin_prefijo_hecho(p_texto text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v text := btrim(coalesce(p_texto, ''));
  v_limpio text;
BEGIN
  -- Mismo prefijo que reconoce `fecha_hecho`, más un separador opcional.
  v_limpio := regexp_replace(
    v,
    '^\d{1,2}[./]\d{1,2}[./]\d{4}\s*[–—-]?\s*:?\s*',
    ''
  );
  v_limpio := regexp_replace(
    v_limpio,
    '^\d{1,2}\.[A-Za-z]{3}\.\d{4}\s*[–—-]?\s*:?\s*',
    ''
  );

  -- Sin texto detrás no se limpia: mejor conservar el relato original.
  IF btrim(v_limpio) = '' THEN
    RETURN v;
  END IF;

  -- Si lo que queda empieza por otra fecha, el prefijo era un rango
  -- (`28.04.2026–30.04.2026 — …`). Se devuelve el original para no borrar la
  -- segunda fecha; la columna `fecha` ya guarda la primera.
  IF v_limpio ~ '^\d{1,2}[./]\d{1,2}[./]\d{4}' THEN
    RETURN v;
  END IF;

  RETURN btrim(v_limpio);
END;
$$;

-- 3 · Normalización -----------------------------------------------------------

WITH calculado AS (
  SELECT h.id,
         pg_temp.fecha_hecho(h.descripcion) AS fecha,
         pg_temp.sin_prefijo_hecho(h.descripcion) AS texto
    FROM core.alerta_hechos h
   WHERE h.fecha IS NULL
), cambios AS (
  SELECT *
    FROM calculado
   WHERE fecha IS NOT NULL
)
UPDATE core.alerta_hechos h
   SET fecha = c.fecha,
       descripcion = c.texto
  FROM cambios c
 WHERE h.id = c.id;

DROP FUNCTION IF EXISTS pg_temp.fecha_hecho(text);
DROP FUNCTION IF EXISTS pg_temp.sin_prefijo_hecho(text);

INSERT INTO core.migracion_log (clave)
VALUES ('79_alerta_hechos_fechas_2026_11_27')
ON CONFLICT (clave) DO NOTHING;

COMMIT;

-- =============================================================================
--  Verificación
-- =============================================================================
--  -- Cuántos hechos quedan con y sin fecha después de la migración.
--  SELECT count(*) AS total,
--         count(fecha) AS con_fecha,
--         count(*) FILTER (WHERE fecha IS NULL) AS sin_fecha
--    FROM core.alerta_hechos;
--
--  -- Debe quedar como antes (nada perdido).
--  SELECT count(*) FROM core.alerta_hechos;
--
--  -- Los que siguen sin fecha deben conservar su prefijo intacto.
--  SELECT left(descripcion, 30)
--    FROM core.alerta_hechos
--   WHERE fecha IS NULL
--   ORDER BY created_at
--   LIMIT 20;
