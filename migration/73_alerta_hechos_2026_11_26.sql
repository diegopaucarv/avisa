-- =============================================================================
-- 73 · Hechos de la alerta como filas (tabla)
--
-- Fecha: 2026-11-26
--
-- Por qué
-- -------
-- Los «hechos recientes» de una alerta viven hoy en un único campo de texto
-- (`core.alertas_tempranas.hechos_recientes`), donde cada hecho es una línea que
-- empieza por «- » y puede traer la fecha delante. Eso impide ordenar,
-- individualizar, corregir o quitar un hecho sin reescribir el relato completo,
-- y obliga a la interfaz a reparsear texto para pintar una tabla.
--
-- Qué hace
-- --------
-- 1. Crea `core.alerta_hechos`: un hecho por fila, con fecha opcional
--    (un hecho puede no tenerla) y `orden` para conservar la secuencia del
--    relato original.
-- 2. Reparte el texto existente: una fila por cada línea que empiece por «- »,
--    tomando la fecha `dd/mm/aaaa` si la línea la trae. Las líneas que no
--    empiezan por «- » no se migran (no son hechos; su contenido sigue en el
--    texto original).
-- 3. **Mantiene `hechos_recientes`**: es el texto derivado que consumen la
--    plantilla de WhatsApp y las exportaciones. No se borra ni se deja de
--    escribir; pasa a recomponerse desde la tabla.
--
-- Nada de esto elimina información: la tabla nace vacía y el texto se conserva
-- tal cual, de modo que revertir la interfaz no pierde nada.
--
-- Idempotente: no duplica hechos si se reejecuta sin cambios en el texto.
-- =============================================================================

begin;

create table if not exists core.alerta_hechos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alerta_id     uuid NOT NULL REFERENCES core.alertas_tempranas (id) ON DELETE CASCADE,
  fecha         date,
  descripcion   text NOT NULL,
  orden         integer NOT NULL DEFAULT 0,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  created_by    uuid,
  anulado_en    timestamp with time zone
);

COMMENT ON TABLE core.alerta_hechos IS
  'Hechos recientes de una alerta, uno por fila. `core.alertas_tempranas.hechos_recientes` se mantiene como texto derivado.';
COMMENT ON COLUMN core.alerta_hechos.fecha IS
  'Fecha del hecho; nula cuando el relato no la trae.';
COMMENT ON COLUMN core.alerta_hechos.orden IS
  'Posición en el relato original, para conservar la secuencia.';
COMMENT ON COLUMN core.alerta_hechos.anulado_en IS
  'Borrado lógico: el hecho no se muestra pero se conserva.';

CREATE INDEX IF NOT EXISTS alerta_hechos_alerta_idx
  ON core.alerta_hechos (alerta_id, orden)
  WHERE anulado_en IS NULL;

-- Fecha tolerante: el texto viene de carga manual y puede traer un 31/02. En vez
-- de abortar la migración entera, el hecho se guarda sin fecha.
-- Vive en `pg_temp`: desaparece al cerrar la sesión y no deja nada en el esquema.
CREATE OR REPLACE FUNCTION pg_temp.fecha_ddmmaaaa(texto text)
RETURNS date
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN make_date(
    split_part(texto, '/', 3)::int,
    split_part(texto, '/', 2)::int,
    split_part(texto, '/', 1)::int
  );
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

-- Reparto del texto existente. Solo para alertas que aún no tienen hechos, con
-- lo que reejecutar no duplica nada.
WITH lineas AS (
  SELECT a.id AS alerta_id,
         btrim(s.linea) AS texto,
         s.orden::int AS orden,
         regexp_match(btrim(s.linea), '^-\s*(\d{1,2}/\d{1,2}/\d{4})') AS fecha_partes
    FROM core.alertas_tempranas a
   CROSS JOIN LATERAL regexp_split_to_table(
                coalesce(a.hechos_recientes, ''),
                E'\r?\n'
              ) WITH ORDINALITY AS s(linea, orden)
   WHERE coalesce(a.hechos_recientes, '') <> ''
     AND btrim(s.linea) LIKE '-%'
     AND NOT EXISTS (
           SELECT 1 FROM core.alerta_hechos h WHERE h.alerta_id = a.id
         )
), limpias AS (
  SELECT alerta_id,
         orden,
         pg_temp.fecha_ddmmaaaa(fecha_partes[1]) AS fecha,
         btrim(
           regexp_replace(
             texto,
             '^-\s*(\d{1,2}/\d{1,2}/\d{4})?\s*[-–—]?\s*',
             ''
           )
         ) AS descripcion
    FROM lineas
)
INSERT INTO core.alerta_hechos (alerta_id, fecha, descripcion, orden)
SELECT alerta_id, fecha, descripcion, orden
  FROM limpias
 WHERE descripcion <> '';

DROP FUNCTION IF EXISTS pg_temp.fecha_ddmmaaaa(text);

insert into core.migracion_log (clave)
values ('73_alerta_hechos_2026_11_26')
on conflict (clave) do nothing;

commit;
