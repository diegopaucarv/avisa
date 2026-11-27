-- =============================================================================
-- 66 · Política de borrado para la recarga de la matriz 2026
--
-- Fecha: 2026-11-26
-- Estado: AUTORIZADA por el solicitante (permiso especial y excepcional).
--
-- Por qué existe
-- --------------
-- Borrar los 33 casos mapeados de la matriz deja 481 filas hijas que hoy
-- bloquean el DELETE porque sus FK son NO ACTION o RESTRICT:
--
--   core.demandas.alerta_id            133   NO ACTION
--   core.proceso_instancia.alerta_id     83   NO ACTION
--   kag.aristas.caso_id                 150   NO ACTION
--   core.documentos.caso_id              78   NO ACTION
--   core.mapa_matriz_excel.caso_id       34   RESTRICT (NOT NULL)
--   core.cronologia_vinculos.alerta_id    3   NO ACTION
--
-- La recarga de la matriz va a repetirse, así que se fija la política en el
-- esquema en vez de repetir seis pasos manuales cada vez.
--
-- Criterio (qué se conserva y qué se va con el caso)
-- --------------------------------------------------
-- · CASCADE  → datos DERIVADOS o de equivalencia, que se reconstruyen:
--                kag.aristas (grafo de conocimiento)
--                core.mapa_matriz_excel (tabla de equivalencias de la matriz)
-- · SET NULL → datos PROPIOS que deben sobrevivir sin el caso:
--                core.documentos (evidencia documental)
--                core.proceso_instancia (instancias de proceso)
--                core.cronologia_vinculos (vínculos de la cronología)
--                core.demandas.alerta_id (la demanda puede vivir sin la alerta)
--
-- Las columnas que pasan a SET NULL ya son anulables (verificado); la única
-- NOT NULL es core.mapa_matriz_excel.caso_id, que por eso va a CASCADE.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.
-- Reversible: el bloque de reversión está al final, comentado.
--
-- Claves huérfanas 71 y 72
-- -------------------------
-- Esta migración absorbió dos cambios que se habían numerado por separado y
-- cuyo archivo no se conservó:
--
--   71_proceso_instancia_cascada_2026_11_26
--       → lo cubre el bloque 1: proceso_instancia.alerta_id pasa a ON DELETE SET NULL.
--   72_cronologia_vinculos_cascada_2026_11_26
--       → lo cubre el bloque 1: cronologia_vinculos.alerta_id pasa a ON DELETE SET NULL.
--
-- Ambas claves se retiraron de `core.migracion_log` para que una comprobación por
-- prefijo `71%`/`72%` no dé por aplicada una migración que ya no existe. Por eso
-- las migraciones siguientes empiezan en 73 (números 71 y 72 quedan retirados).
-- =============================================================================

begin;

-- 1 · alertas → hijos que deben sobrevivir
alter table core.cronologia_vinculos
  drop constraint if exists cronologia_vinculos_alerta_id_fkey;
alter table core.cronologia_vinculos
  add constraint cronologia_vinculos_alerta_id_fkey
  foreign key (alerta_id) references core.alertas_tempranas(id) on delete set null;

alter table core.demandas
  drop constraint if exists demandas_alerta_id_fkey;
alter table core.demandas
  add constraint demandas_alerta_id_fkey
  foreign key (alerta_id) references core.alertas_tempranas(id) on delete set null;

alter table core.proceso_instancia
  drop constraint if exists proceso_instancia_alerta_id_fkey;
alter table core.proceso_instancia
  add constraint proceso_instancia_alerta_id_fkey
  foreign key (alerta_id) references core.alertas_tempranas(id) on delete set null;

-- 2 · casos → hijos que deben sobrevivir
alter table core.documentos
  drop constraint if exists documentos_caso_id_fkey;
alter table core.documentos
  add constraint documentos_caso_id_fkey
  foreign key (caso_id) references core.casos(id) on delete set null;

-- 3 · casos → datos derivados que se reconstruyen
alter table kag.aristas
  drop constraint if exists aristas_caso_id_fkey;
alter table kag.aristas
  add constraint aristas_caso_id_fkey
  foreign key (caso_id) references core.casos(id) on delete cascade;

alter table core.mapa_matriz_excel
  drop constraint if exists mapa_matriz_excel_caso_id_fkey;
alter table core.mapa_matriz_excel
  add constraint mapa_matriz_excel_caso_id_fkey
  foreign key (caso_id) references core.casos(id) on delete cascade;

insert into core.migracion_log (clave)
values ('66_fk_borrado_cascada_2026_11_26')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- confdeltype: 'c' = CASCADE, 'n' = SET NULL.
select c.conname, c.confdeltype
  from pg_constraint c
 where c.conname in (
   'cronologia_vinculos_alerta_id_fkey', 'demandas_alerta_id_fkey',
   'proceso_instancia_alerta_id_fkey', 'documentos_caso_id_fkey',
   'aristas_caso_id_fkey', 'mapa_matriz_excel_caso_id_fkey'
 )
 order by c.conname;

-- -----------------------------------------------------------------------------
-- Reversión (comentada): vuelve al NO ACTION / RESTRICT original
-- -----------------------------------------------------------------------------
-- begin;
-- alter table core.cronologia_vinculos drop constraint cronologia_vinculos_alerta_id_fkey;
-- alter table core.cronologia_vinculos add constraint cronologia_vinculos_alerta_id_fkey
--   foreign key (alerta_id) references core.alertas_tempranas(id);
-- alter table core.demandas drop constraint demandas_alerta_id_fkey;
-- alter table core.demandas add constraint demandas_alerta_id_fkey
--   foreign key (alerta_id) references core.alertas_tempranas(id);
-- alter table core.proceso_instancia drop constraint proceso_instancia_alerta_id_fkey;
-- alter table core.proceso_instancia add constraint proceso_instancia_alerta_id_fkey
--   foreign key (alerta_id) references core.alertas_tempranas(id);
-- alter table core.documentos drop constraint documentos_caso_id_fkey;
-- alter table core.documentos add constraint documentos_caso_id_fkey
--   foreign key (caso_id) references core.casos(id);
-- alter table kag.aristas drop constraint aristas_caso_id_fkey;
-- alter table kag.aristas add constraint aristas_caso_id_fkey
--   foreign key (caso_id) references core.casos(id);
-- alter table core.mapa_matriz_excel drop constraint mapa_matriz_excel_caso_id_fkey;
-- alter table core.mapa_matriz_excel add constraint mapa_matriz_excel_caso_id_fkey
--   foreign key (caso_id) references core.casos(id) on delete restrict;
-- delete from core.migracion_log where clave = '66_fk_borrado_cascada_2026_11_26';
-- commit;
