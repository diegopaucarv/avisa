-- =============================================================================
--  26 · Papelera de compromisos y documentos
--
--  Fecha: 2026-11-22
--
--  Por qué existe esta migración
--  -----------------------------
--  La política de SELECT `p_clasificacion` de `core.compromisos` y
--  `core.documentos` termina en `and anulado_en is null`. Esa condición hace
--  invisible cualquier registro anulado, de modo que la API puede anular y
--  restaurar por id, pero no puede **listar** lo anulado: la papelera no existe.
--
--  Comprobado con `pg_policies` antes de escribir esto:
--
--    core.compromisos · p_clasificacion
--      qual = ((nivel_clasificacion <= core.clasificacion_max())
--              AND (anulado_en IS NULL))
--    core.documentos   · p_clasificacion
--      qual = idéntico
--
--  Qué cambia
--  ----------
--  Se añade **sólo** una política de SELECT adicional por tabla. En PostgreSQL
--  las políticas permisivas de una misma operación se combinan con OR, así que
--  `p_anulados` no abre ninguna fila nueva por sí sola: restringe las anuladas
--  a quien pide la papelera y mantiene intacto el resto.
--
--  La condición `nivel_clasificacion <= core.clasificacion_max()` es
--  **obligatoria**: sin ella la política mostraría anulados de clasificación
--  superior a la del rol. La apertura se controla con el GUC
--  `app.ver_anulados`, que sólo dura la transacción (ver `withSession` en
--  `lib/db/tenant.ts`); por omisión vale `'off'` y la papelera sigue cerrada.
--
--  Semántica de restauración (leer antes de usarla)
--  ------------------------------------------------
--  Restaurar es **de fila, nunca en cascada**. La papelera lista registros
--  anulados individualmente; restaurar uno no debe resucitar nada más:
--
--    · `core.compromisos.documento_origen_id` y
--      `core.demandas.documento_origen_id` son 1:n (un documento origina
--      muchos registros). Restaurar el documento no restaura los compromisos
--      ni las demandas que lo citan, ni al revés.
--    · Los enlaces n:m de un documento viven en `core.documento_actores`,
--      `core.cronologia_vinculos` y `core.planes_accion`; cada uno se anula y
--      se restaura por su cuenta.
--
--  Esta migración no implementa la restauración: sólo habilita el listado. La
--  restauración sigue pasando por `core.restaurar_registro`, que ya trabaja por
--  lote de anulación y se invoca registro a registro.
--
--  Qué NO cambia
--  -------------
--  · Ninguna otra tabla ni política existente (`p_clasificacion`, `p_insert`,
--    `p_update`, `p_delete`, `r_rol_*`) se toca.
--  · No se crean índices, columnas, permisos ni funciones.
--  · `avisa_app` y `avisa_api` ya tienen SELECT sobre ambas tablas.
--
--  Cómo revertir
--  -------------
--  Al final del archivo hay un bloque comentado que retira `p_anulados` de
--  ambas tablas. Revertirlo vuelve a ocultar por completo los anulados.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Compromisos
-- -----------------------------------------------------------------------------
-- `drop policy if exists` permite reejecutar la migración sin error.
drop policy if exists p_anulados on core.compromisos;
create policy p_anulados on core.compromisos for select
  using (
    anulado_en is not null
    and nivel_clasificacion <= core.clasificacion_max()
    and current_setting('app.ver_anulados', true) = 'on'
  );

-- -----------------------------------------------------------------------------
-- 2 · Documentos
-- -----------------------------------------------------------------------------
drop policy if exists p_anulados on core.documentos;
create policy p_anulados on core.documentos for select
  using (
    anulado_en is not null
    and nivel_clasificacion <= core.clasificacion_max()
    and current_setting('app.ver_anulados', true) = 'on'
  );

-- -----------------------------------------------------------------------------
-- Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
-- (a) Las dos políticas deben existir con la misma expresión.
select schemaname, tablename, policyname, cmd, qual
  from pg_policies
 where schemaname = 'core'
   and tablename in ('compromisos', 'documentos')
   and policyname = 'p_anulados'
 order by tablename;

-- (b) La política permisiva anterior sigue en pie y sin cambios.
select tablename, policyname, qual
  from pg_policies
 where schemaname = 'core'
   and tablename in ('compromisos', 'documentos')
   and policyname = 'p_clasificacion'
 order by tablename;

commit;

-- (c) Comprobación funcional como rol de la aplicación (`avisa_app`, no
--     superusuario): con el GUC en 'off' la papelera permanece cerrada; con el
--     GUC en 'on' aparecen las filas anuladas. La diferencia entre ambos
--     recuentos debe igualar el número de anulados por tabla.
begin;
set local role avisa_app;
select set_config('app.rol_codigo', 'administrador', true) as rol;
select set_config('app.ver_anulados', 'off', true) as ver_anulados;
select count(*) as compromisos_visibles_off from core.compromisos;
select count(*) as documentos_visibles_off from core.documentos;
select set_config('app.ver_anulados', 'on', true) as ver_anulados;
select count(*) as compromisos_visibles_on from core.compromisos;
select count(*) as documentos_visibles_on from core.documentos;
select count(*) as compromisos_anulados
  from core.compromisos
 where anulado_en is not null;
select count(*) as documentos_anulados
  from core.documentos
 where anulado_en is not null;
rollback;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar para retirar la papelera. Los anulados vuelven a ser invisibles
--  y la API deja de poder listarlos.
-- =============================================================================
--
-- begin;
-- drop policy if exists p_anulados on core.compromisos;
-- drop policy if exists p_anulados on core.documentos;
-- commit;
