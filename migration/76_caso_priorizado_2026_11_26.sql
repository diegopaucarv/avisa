-- =============================================================================
-- 76 · Marca de caso priorizado
--
-- Fecha: 2026-11-26
--
-- Numeración
-- ----------
-- Se numera 76 y no 71 porque la clave `71_proceso_instancia_cascada_2026_11_26`
-- ya está aplicada en la base (su archivo se consolidó después en la 66 y no se
-- conservó). Mantener el 71 dejaría dos migraciones distintas con el mismo
-- número, y quien comprobara `clave like '71%'` creería que esta ya corrió.
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

begin;

alter table core.casos
  add column if not exists priorizado boolean not null default false;

comment on column core.casos.priorizado is
  'Caso marcado como priorizado por la Dirección OAIPCS. Alimenta la tabla «Casos priorizados» del panorama territorial.';

insert into core.migracion_log (clave)
values ('76_caso_priorizado_2026_11_26')
on conflict (clave) do nothing;

commit;
