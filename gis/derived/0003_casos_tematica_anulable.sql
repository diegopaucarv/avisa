-- 0003 · `core.casos.tematica_id` deja de ser NOT NULL.
--
-- Motivo: `core.cat_tematicas` tiene seis valores y ninguno es «sin
-- clasificar». Un caso del legado o una alerta promovida puede llegar sin
-- temática decidida; hoy eso rompe el alta (NOT NULL → 500, o 422 si la API lo
-- intercepta). Se vuelve anulable para que «pendiente» se represente como NULL,
-- sin inventar una fila de catálogo ni tocar el código permanente del caso.
--
-- El código del caso no cambia: `core.codigo_tematica(NULL)` ya devuelve 'GEN'
-- y `core.siguiente_codigo_caso(sub, NULL)` emite `CS-<sub>-GEN-<año>-NN`.
-- Por eso NO se siembra un «Sin clasificar» en el catálogo: contaminaría el
-- sufijo del código, que es inmutable.
--
-- Idempotente: se puede ejecutar más de una vez (`drop not null` no falla).
--
-- Reversa (sólo si no quedan filas con NULL):
--   alter table core.casos alter column tematica_id set not null;
--   delete from core.migracion_log where clave = 'casos_tematica_anulable';

BEGIN;

-- Respaldo de los valores actuales (35 filas): la reversa de la restricción
-- exige que ninguna quede en NULL, y esto permite auditar cuáles había.
CREATE TABLE IF NOT EXISTS core.casos_tematica_backup_20261123 AS
SELECT id, codigo_caso, tematica_id
FROM core.casos;

ALTER TABLE core.casos ALTER COLUMN tematica_id DROP NOT NULL;

INSERT INTO core.migracion_log (clave)
VALUES ('casos_tematica_anulable')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
