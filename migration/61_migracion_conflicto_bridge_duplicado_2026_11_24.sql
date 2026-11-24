-- =============================================================================
-- 61 · Nueva categoría de conflicto: BRIDGE_CLAVE_DUPLICADA
--
-- Fecha: 2026-11-24
--
-- Por qué existe esta migración
-- -----------------------------
-- `p09_demandas.py` ahora detecta claves repetidas en
-- `BRIDGE_Alerta_Demandas.c01` y las encola en `core.migracion_conflicto` con
-- la categoría `BRIDGE_CLAVE_DUPLICADA`. El CHECK
-- `core.migracion_conflicto_categoria_chk` es una lista literal, así que sin
-- esta migración el primer conflicto de esa categoría aborta la carga.
--
-- La señal importa: `BAD-AT-2026-42-01` identifica a la vez una demanda de
-- Aceros Americanos y otra de pota; la numeración reinicia en `-01` y es el
-- síntoma de un bloque de filas pegado en la hoja equivocada. En el Excel
-- actual hay 22 claves repetidas que afectan a 46 filas.
--
-- Qué cambia
-- ----------
-- · Recrea el CHECK con las 10 categorías anteriores más
--   `BRIDGE_CLAVE_DUPLICADA`. No mueve datos: sólo valida lo que ya existe.
-- · Registra la migración en `core.migracion_log`.
-- · No cambia el esquema, ni los permisos, ni las políticas RLS, ni catálogos.
--
-- Contexto de sesión
-- ------------------
-- `core.migracion_conflicto` no tiene RLS, pero se fija el contexto igual que en
-- el resto de migraciones para que el entorno sea explícito y para no depender
-- de que esa ausencia se mantenga.
--
-- Cómo revertir
-- -------------
--   begin;
--   alter table core.migracion_conflicto
--     drop constraint if exists migracion_conflicto_categoria_chk;
--   alter table core.migracion_conflicto
--     add constraint migracion_conflicto_categoria_chk check (categoria in (
--       'DNI_DUPLICADO', 'PERSONA_HOMONIMA', 'MEMBRESIA_SIN_MATCH',
--       'ORGANIZACION_SIN_ACTOR', 'CASO_CODIGO_SERIE_ANTERIOR',
--       'ALERTA_INEXISTENTE', 'ESPECIE_NOMBRE_CIENTIFICO_DIVERGENTE',
--       'HITO_SIN_COMPROMISO', 'PARTICIPANTE_SIN_CAPACITACION',
--       'TERRITORIO_NO_RESUELTO'
--     ));
--   delete from core.migracion_log
--   where clave = '61_migracion_conflicto_bridge_duplicado_2026_11_24';
--   commit;
--
-- La reversión falla si ya hay filas con la categoría nueva; hay que borrarlas
-- o resolverlas antes.
-- =============================================================================

begin;

-- 1 · Contexto explícito (mismo patrón que 37/54).
select set_config('app.rol_codigo', 'administrador', true);
select set_config(
  'app.user_id',
  '00000000-0000-0000-0000-000000000001',
  true
);

-- 2 · Recrear el CHECK con la categoría nueva.
alter table core.migracion_conflicto
  drop constraint if exists migracion_conflicto_categoria_chk;

alter table core.migracion_conflicto
  add constraint migracion_conflicto_categoria_chk check (categoria in (
      'DNI_DUPLICADO',
      'PERSONA_HOMONIMA',
      'MEMBRESIA_SIN_MATCH',
      'ORGANIZACION_SIN_ACTOR',
      'CASO_CODIGO_SERIE_ANTERIOR',
      'ALERTA_INEXISTENTE',
      'ESPECIE_NOMBRE_CIENTIFICO_DIVERGENTE',
      'HITO_SIN_COMPROMISO',
      'PARTICIPANTE_SIN_CAPACITACION',
      'TERRITORIO_NO_RESUELTO',
      'BRIDGE_CLAVE_DUPLICADA'
  ));

-- 3 · Registro de la migración (idempotente).
insert into core.migracion_log (clave)
values ('61_migracion_conflicto_bridge_duplicado_2026_11_24')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- La definición debe incluir la categoría nueva.
select pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'core.migracion_conflicto'::regclass
   and conname = 'migracion_conflicto_categoria_chk';
