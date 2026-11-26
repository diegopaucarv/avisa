-- =============================================================================
-- 65 · Puente compromiso ↔ demanda para la matriz 2026
--
-- Fecha: 2026-11-26
-- Estado: PREPARADA, NO EJECUTADA.
--
-- Por qué existe
-- --------------
-- La matriz 2026 trae 4 compromisos que atienden **3 demandas cada uno**
-- (verificado en el XLSX: 19 vínculos demanda–compromiso en total). El modelo
-- actual sólo tiene `core.compromisos.demanda_id`, un único uuid, así que no
-- puede representar esa relación m:n.
--
-- Alternativas descartadas
-- ------------------------
-- · Duplicar el compromiso por demanda: crearía 8 filas extra con códigos
--   nuevos (son UNIQUE globales), duplicaría o dejaría sin seguimiento los
--   hitos, e inflaría el Anexo 14 y los KPIs.
-- · Un puente compromiso ↔ caso: sólo 2 compromisos aparecen en 2 casos; se
--   resuelve duplicando la fila por caso (cada caso ejecuta su instancia) y
--   evitando relajar `compromisos.caso_id NOT NULL`.
--
-- Decisión: **una sola tabla puente**, `compromiso_demandas`.
--
-- Reglas
-- ------
-- · ADITIVA e IDEMPOTENTE: `create table if not exists`, `create index if not
--   exists`, `on conflict do nothing`.
-- · NO toca `compromisos.demanda_id`, que sigue existiendo como «demanda
--   principal» por compatibilidad. Para los compromisos con varias demandas,
--   la importación dejará `demanda_id` NULL y usará el puente: mientras
--   `demanda_id` siga poblado, su FK (NO ACTION) bloquearía el borrado de esa
--   demanda.
-- · La llave de importación es **`core.mapa_matriz_excel`**, no el nombre del
--   caso: los 37 nombres del Excel no coinciden con `core.casos.nombre_caso`
--   (0 exactos) y el mapa identifica 33 casos.
--
-- NOTA DE NUMERACIÓN: la 64 se aplicó y se revirtió el 2026-11-25 (columnas de
-- sectorista y validación, innecesarias). No se reutiliza el número para que
-- el historial no confunda dos intentos distintos.
-- =============================================================================

begin;

select set_config('app.rol_codigo', 'administrador', true);
select set_config(
  'app.user_id',
  '00000000-0000-0000-0000-000000000001',
  true
);

-- ============================================================================
-- 1 · Tabla puente
-- ============================================================================
create table if not exists core.compromiso_demandas (
  compromiso_id uuid        not null
    references core.compromisos(id) on delete cascade,
  demanda_id   uuid        not null
    references core.demandas(id)    on delete cascade,
  es_principal boolean     not null default false,
  orden        smallint    not null default 1,
  created_at   timestamptz not null default now(),
  primary key (compromiso_id, demanda_id)
);

comment on table core.compromiso_demandas is
  'Vínculo m:n entre compromisos y demandas de la matriz 2026. compromisos.demanda_id se conserva como demanda principal por compatibilidad.';

comment on column core.compromiso_demandas.es_principal is
  'Marca la demanda que además se refleja en compromisos.demanda_id, si la hay.';

comment on column core.compromiso_demandas.orden is
  'Orden de la demanda dentro del compromiso, según la fila de la matriz.';

-- Una sola demanda principal por compromiso.
create unique index if not exists uq_compromiso_demandas_principal
  on core.compromiso_demandas (compromiso_id)
  where es_principal;

create index if not exists ix_compromiso_demandas_demanda
  on core.compromiso_demandas (demanda_id);

-- ============================================================================
-- 2 · Registro de la migración
-- ============================================================================
insert into core.migracion_log (clave)
values ('65_compromiso_demandas_2026_11_26')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Cómo revertir (comentado; no ejecutar a ciegas)
-- -----------------------------------------------------------------------------
-- begin;
-- drop table if exists core.compromiso_demandas;
-- delete from core.migracion_log where clave = '65_compromiso_demandas_2026_11_26';
-- commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones (sólo lectura)
-- -----------------------------------------------------------------------------
-- Debe existir la tabla con 6 columnas y 1 PK.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'core' and table_name = 'compromiso_demandas'
 order by ordinal_position;

-- Mientras no se importe, debe estar vacía.
select count(*) as filas from core.compromiso_demandas;

-- Tras la importación, los 19 vínculos deben cuadrar con el JSON de caché
-- (scripts/matriz/salida/relaciones.json → vinculos.demanda_compromiso).
select count(*) as vinculos from core.compromiso_demandas;
