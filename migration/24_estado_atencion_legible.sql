-- =============================================================================
--  24 · `core.demandas.estado_atencion` en vocabulario legible
--
--  Por qué existe esta migración
--  -----------------------------
--  El glosario (`docs/01_requisitos/GLOSARIO_ALINEACION_GUIA.md` §1.8) fija que
--  los estados se escriben con espacio: `En proceso`, `En ejecución`,
--  `Por iniciar`. El `CHECK` de `core.demandas.estado_atencion` seguía, en
--  cambio, con la forma heredada de guion bajo:
--
--    Pendiente · En_proceso · Atendida · Desestimada
--
--  Los otros dos catálogos de estado ya estaban alineados en la base viva:
--
--    core.cat_estados_compromiso → Por iniciar · En proceso · Cumplido ·
--                                  Redefinido · Desestimado
--    core.cat_estados_hito       → Registrado · En ejecución · Paralizado ·
--                                  Cumplido · Desestimado
--
--  Es decir: este `CHECK` era el único objeto del esquema `core` con el literal
--  heredado. Comprobado con:
--
--    select conrelid::regclass, conname
--      from pg_constraint
--     where connamespace = 'core'::regnamespace
--       and (pg_get_constraintdef(oid) like '%En_proceso%'
--         or pg_get_constraintdef(oid) like '%Por_iniciar%'
--         or pg_get_constraintdef(oid) like '%En_ejecucion%');
--    -- única fila: core.demandas · demandas_estado_atencion_check
--
--  Por qué no mueve datos
--  ----------------------
--  El valor heredado no tiene un solo registro: las 325 demandas están en
--  `Pendiente`. Aun así se incluye el `UPDATE`, para que la migración sea
--  correcta también sobre una base restaurada de un respaldo anterior.
--
--  `core.demandas` tiene RLS **forzada**, y el dueño de la migración es
--  superusuario (`avisa.rolsuper = true`), así que el `UPDATE` no queda
--  filtrado por políticas. La verificación final comprueba el recuento.
--
--  Qué cambia
--  ----------
--    1. `En_proceso` → `En proceso` (con espacio), que es la etiqueta canónica.
--    2. El `CHECK` se recrea con los cuatro valores legibles.
--    3. Se documenta el eje en un `COMMENT`, porque no es estado de hito ni de
--       compromiso: es el estado de atención de la demanda.
--
--  Efecto en el código
--  -------------------
--  `lib/db/repos/demandas.ts` normaliza la entrada a la etiqueta canónica, de
--  modo que la API acepta tanto `En proceso` como la forma legada
--  `En_proceso`, pero escribe siempre la primera. Las proyecciones que hacían
--  `replace(estado_atencion, '_', ' ')` quedan como no-ops: siguen siendo
--  válidas si alguna base antigua conserva el guion bajo.
--
--  Cómo revertir
--  -------------
--  Al final del archivo hay un bloque comentado que devuelve el `CHECK` a la
--  forma heredada. Revertirlo **rompe** la alineación con el glosario y exige
--  renombrar de vuelta cualquier fila que esté en `En proceso`.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Retirar el `CHECK` heredado
-- -----------------------------------------------------------------------------
alter table core.demandas
  drop constraint if exists demandas_estado_atencion_check;

-- -----------------------------------------------------------------------------
-- 2 · Llevar los registros existentes al valor canónico
--     (hoy 0 filas; se conserva para bases restauradas de respaldos previos)
-- -----------------------------------------------------------------------------
update core.demandas
   set estado_atencion = 'En proceso'
 where estado_atencion = 'En_proceso';

-- -----------------------------------------------------------------------------
-- 3 · Recrear el `CHECK` con la etiqueta legible
-- -----------------------------------------------------------------------------
alter table core.demandas
  add constraint demandas_estado_atencion_check
  check (estado_atencion in ('Pendiente', 'En proceso', 'Atendida', 'Desestimada'));

comment on column core.demandas.estado_atencion is
  'Estado de atención de la demanda: Pendiente · En proceso · Atendida · Desestimada. Eje independiente del estado de hito y del estado de compromiso (glosario §1.8).';

-- -----------------------------------------------------------------------------
-- Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
-- (a) El `CHECK` vigente debe mostrar `En proceso`, con espacio.
select conname, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'core.demandas'::regclass
   and conname = 'demandas_estado_atencion_check';

-- (b) Ningún registro puede quedar con el literal heredado.
select count(*) as filas_con_guion_bajo
  from core.demandas
 where estado_atencion = 'En_proceso';

-- (c) Distribución por estado (debe seguir siendo 325 en `Pendiente`).
select estado_atencion, count(*) as demandas
  from core.demandas
 group by estado_atencion
 order by estado_atencion;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar para volver al estado anterior. Rompe la alineación con el
--  glosario §1.8.
-- =============================================================================
--
-- begin;
-- alter table core.demandas
--   drop constraint if exists demandas_estado_atencion_check;
-- update core.demandas
--    set estado_atencion = 'En_proceso'
--  where estado_atencion = 'En proceso';
-- alter table core.demandas
--   add constraint demandas_estado_atencion_check
--   check (estado_atencion in ('Pendiente', 'En_proceso', 'Atendida', 'Desestimada'));
-- comment on column core.demandas.estado_atencion is null;
-- commit;
