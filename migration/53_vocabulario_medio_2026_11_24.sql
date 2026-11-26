-- ============================================================================
-- AVISA — Migración 53: vocabulario «Medio» en lugar de «Moderado»
--
-- POR QUÉ EXISTE
--   El vocabulario congelado usaba «Moderado» como nivel intermedio de riesgo
--   (§7.5.2) y de prioridad de atención (Anexo 15, col. 10). Se decide pasar a
--   «Medio» en toda la aplicación. El frontend ya emite `Medio`; esta migración
--   alinea los catálogos de la base para que la API devuelva la misma etiqueta.
--
-- REGLAS
--   * ADITIVA en el sentido de que no elimina filas: sólo renombra el `codigo`
--     de las dos filas intermedias. No toca `id` ni `orden`, así que las FKs
--     (que apuntan a `id`) no se ven afectadas.
--   * IDEMPOTENTE: si «Moderado» ya no existe, el UPDATE no hace nada.
--   * No toca `cat_prioridades_alerta` (Crítica inmediata / Urgente / Temprana /
--     Seguimiento): ese eje no usa «Moderado».
-- ============================================================================

BEGIN;

UPDATE core.cat_niveles_riesgo
   SET codigo = 'Medio'
 WHERE codigo = 'Moderado';

UPDATE core.cat_prioridades_atencion
   SET codigo = 'Medio'
 WHERE codigo = 'Moderado';

INSERT INTO core.migracion_log (clave) VALUES ('53_vocabulario_medio_2026_11_24')
ON CONFLICT (clave) DO NOTHING;

COMMIT;
