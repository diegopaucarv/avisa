-- =============================================================================
--  32 · `core.exigir_anulacion` exige `puede_eliminar`, no `puede_editar`
--
--  Fecha: 2026-11-22
--
--  Por qué existe esta migración
--  -----------------------------
--  La regla de la base es que **sólo** los roles con `core.roles.puede_eliminar`
--  anulan y restauran registros: hoy `administrador` y `sectorista` (parche 15 de
--  la DDL). Esa regla se cumplía en dos de las tres capas:
--
--    · `core.roles.puede_eliminar` — la matriz, correcta.
--    · SPA `capacidades.service.ts` (`puedeEliminar`) — oculta la acción.
--    · API: los listados de papelera responden 403 con
--      `puedeAnularRegistros(session.roles)`.
--
--  Faltaba la tercera. `core.exigir_anulacion` —la puerta que atraviesan
--  `anular_registro`, `anular_caso`, `restaurar_registro` y `restaurar_caso`—
--  comprobaba `core.puede_editar()`, no `core.puede_eliminar()`. Con eso,
--  cualquier rol con permiso de edición podía anular y restaurar por la API
--  aunque la interfaz le ocultara la acción.
--
--  Evidencia medida antes de escribir esto
--  ---------------------------------------
--  · `core.roles` marca `puede_eliminar = false` y `puede_editar = true` para
--    `direccion_oaipcs`, `analista_cualitativo`, `auditor`, `curador_politica`
--    y `servicio_agente`.
--  · En una transacción con `set local role avisa_app` y
--    `app.rol_codigo = 'direccion_oaipcs'`, `select core.exigir_anulacion(1)`
--    **no** lanzaba error: la Directora podía anular, en contra de la regla.
--  · El listado `GET /api/v1/alerts?anulados=true` con su sesión respondía
--    `403 Sin permiso para consultar registros anulados.`: la papelera le estaba
--    cerrada, pero la escritura no.
--
--  Qué cambia
--  ----------
--  · Redefine `core.exigir_anulacion(smallint)` con `CREATE OR REPLACE`
--    conservando firma, `returns void`, `language plpgsql`, `stable`,
--    `set search_path = pg_catalog, core` y el mensaje/errcode `42501`. Los
--    `GRANT` los preserva `CREATE OR REPLACE`.
--  · Cambia **sólo** la primera guarda: `core.puede_editar()` →
--    `core.puede_eliminar()`.
--  · No toca la guarda de clasificación (`v_nivel > core.clasificacion_max()`),
--    ni las cuatro funciones de anulación/restauración, ni datos, catálogos ni
--    políticas.
--
--  Efecto observable
--  -----------------
--  · `administrador` y `sectorista` siguen anulando y restaurando.
--  · `direccion_oaipcs` conserva la edición, pero un `DELETE` o un
--    `POST …/restaurar` responden `403` (`42501` traducido por `lib/db/errors`).
--
--  Cómo revertir
--  -------------
--  Volver a aplicar el bloque de `migration/13_anulacion_segura.sql` §1
--  (`puede_editar`). No se recomienda: reabre el hueco.
-- =============================================================================

begin;

create or replace function core.exigir_anulacion(p_nivel smallint)
returns void
language plpgsql
stable
set search_path = pg_catalog, core
as $$
begin
  if not core.puede_eliminar() then
    raise exception 'Su rol no permite anular ni restaurar registros'
      using errcode = '42501';
  end if;

  if coalesce(p_nivel, 99) > core.clasificacion_max() then
    raise exception 'El registro excede su nivel de acceso'
      using errcode = '42501';
  end if;
end $$;

commit;

-- =============================================================================
--  Verificación (no ejecutar fuera de una transacción con rollback)
-- =============================================================================
--  begin;
--  set local role avisa_app;
--
--  -- Debe PASAR (puede_eliminar = true).
--  select set_config('app.rol_codigo', 'administrador', true);
--  select core.exigir_anulacion(1);
--
--  -- Debe PASAR (puede_eliminar = true).
--  select set_config('app.rol_codigo', 'sectorista', true);
--  select core.exigir_anulacion(1);
--
--  -- Debe FALLAR con 42501 (puede_editar = true, puede_eliminar = false).
--  select set_config('app.rol_codigo', 'direccion_oaipcs', true);
--  select core.exigir_anulacion(1);
--
--  -- Debe FALLAR con 42501 (puede_editar = true, puede_eliminar = false).
--  select set_config('app.rol_codigo', 'analista_cualitativo', true);
--  select core.exigir_anulacion(1);
--
--  rollback;
