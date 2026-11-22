-- =============================================================================
--  23 · Vistas de anexos con `security_invoker` (cierre del gap E4)
--
--  Por qué existe esta migración
--  -----------------------------
--  `analytics.vw_anexo_17_registro_reportes` (Registro de reportes, Anexo 17)
--  y `analytics.vw_anexo_16_registro_reuniones` (Registro de reuniones, Anexo
--  16) son vistas ordinarias de Postgres. Una vista ordinaria se ejecuta con
--  los privilegios de su **dueño**, no de quien consulta. Como el dueño es el
--  rol `avisa` (superusuario, `rolbypassrls = true`), las vistas se saltan por
--  completo las políticas RLS de `core.documentos`, `core.casos` y
--  `core.alertas_tempranas`, que están forzadas (`FORCE ROW LEVEL SECURITY`).
--
--  Evidencia del problema (medida el 2026-11-22, conectando como el rol de la
--  aplicación `avisa_api`, que no es superusuario):
--
--    begin;
--      select set_config('app.rol_codigo', 'externo_publico', true);
--      -- externo_publico tiene max_clasificacion = 1 y los documentos son 2
--      select count(*) from core.documentos;                            -- 0
--      select count(*) from core.alertas_tempranas;                     -- 0
--      select count(*) from analytics.vw_anexo_17_registro_reportes;    -- 42
--    rollback;
--
--  La lectura directa devuelve 0 filas (RLS oculta lo de clasificación 2),
--  pero la vista devuelve 42: el listado del Anexo 17 filtraba por RLS sólo
--  de boquilla y exponía filas fuera del ámbito del perfil.
--
--  Qué cambia
--  ----------
--  `security_invoker = true` (PostgreSQL 15+) hace que la vista se evalúe con
--  los privilegios y las políticas RLS de quien la consulta. Tras esta
--  migración, un perfil restringido ve exactamente las mismas filas a través de
--  la vista que consultando las tablas base.
--
--  Requisitos que ya se cumplen
--  ----------------------------
--    · `avisa_api` (la credencial del contenedor `ui`) hereda de `avisa_app`
--      SELECT sobre ambas vistas y sobre todos los objetos base:
--      `core.documentos`, `core.cat_tipos_documento`, `core.casos`,
--      `core.usuarios`, `core.alertas_tempranas`, `core.reuniones_dialogo`,
--      `core.cat_subsectores` y `analytics.vw_geo_distrito`.
--    · `analytics.vw_geo_distrito` no contiene datos personales ni tiene RLS;
--      que se evalúe con los privilegios de su dueño no amplía el ámbito.
--
--  Notas de seguridad
--  ------------------
--    · No se crea ninguna tabla: el Anexo 17 se sirve desde la vista existente,
--      tal como decidió la revisión de E4. Esta migración sólo cierra la fuga
--      de la vista.
--    · Las vistas siguen siendo de sólo lectura; no se otorgan privilegios de
--      escritura nuevos.
--
--  Cómo revertir
--  -------------
--  Al final del archivo, tras el `commit;`, hay un bloque comentado que
--  devuelve ambas vistas a `security_invoker = false`. Revertir **reabre** la
--  fuga de RLS descrita arriba; sólo tiene sentido si el dueño de las vistas
--  deja de ser un superusuario.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Anexo 17 · Registro de reportes
-- -----------------------------------------------------------------------------
alter view analytics.vw_anexo_17_registro_reportes
  set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 2 · Anexo 16 · Registro de reuniones
--    Mismo dueño y mismo patrón (une `core.casos`, con RLS forzada). Hoy la
--    tabla de reuniones está vacía, de modo que la fuga no se puede observar
--    con datos; el cambio es preventivo y deja ambas vistas con la misma regla.
-- -----------------------------------------------------------------------------
alter view analytics.vw_anexo_16_registro_reuniones
  set (security_invoker = true);

-- -----------------------------------------------------------------------------
-- Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
-- Ambas vistas deben mostrar `security_invoker=true`.
select c.relname as vista, c.reloptions
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'analytics'
   and c.relname in (
     'vw_anexo_17_registro_reportes',
     'vw_anexo_16_registro_reuniones'
   )
 order by c.relname;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Descomentar para volver al comportamiento anterior. REABRE la fuga de RLS.
-- =============================================================================
--
-- alter view analytics.vw_anexo_17_registro_reportes
--   set (security_invoker = false);
--
-- alter view analytics.vw_anexo_16_registro_reuniones
--   set (security_invoker = false);
