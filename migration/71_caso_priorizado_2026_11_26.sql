-- =============================================================================
-- 71 · Marca de caso priorizado
--
-- Fecha: 2026-11-26
--
-- Por qué
-- -------
-- El panorama territorial necesita distinguir los casos que la Dirección ha
-- marcado como priorizados, y hoy esa decisión no vive en ningún sitio: se
-- deduce de la combinación de riesgo y conflictividad, que no es lo mismo.
--
-- Qué hace
-- --------
-- Agrega `core.casos.priorizado` (booleano, NOT NULL, default `false`):
-- los 21.851 casos existentes quedan como no priorizados, que es el valor
-- correcto —nadie los ha marcado— y no un hueco.
--
-- La columna es aditiva y con default: no reescribe filas ni bloquea escrituras
-- en tablas grandes (Postgres 11+ guarda el default en el catálogo).
--
-- Quién la escribe
-- ----------------
-- `PATCH /api/v1/cases/{codigo}` acepta `priorizado` solo para los roles
-- `administrador`, `direccion_oaipcs` y `alta_direccion` (`esDireccion` en la
-- SPA). El resto recibe 403.
--
-- Idempotente: puede reejecutarse sin efectos.
-- =============================================================================

ALTER TABLE core.casos
  ADD COLUMN IF NOT EXISTS priorizado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core.casos.priorizado IS
  'Caso marcado como priorizado por la Dirección OAIPCS. Alimenta la tabla «Casos priorizados» del panorama territorial.';
