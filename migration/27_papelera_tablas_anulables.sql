-- =============================================================================
--  27 · Papelera de las tablas anulables que faltaban
--       (casos, alertas tempranas y demandas)
--
--  Fecha: 2026-11-22
--
--  Por qué existe esta migración
--  -----------------------------
--  La migración 26 abrió la papelera de `core.compromisos` y `core.documentos`
--  para que la API pudiera **listar** los anulados. Faltaban tres tablas con el
--  mismo `anulado_en` y el mismo patrón de política, y su ausencia rompía dos
--  cosas:
--
--    1 · La columna «Caso» de la papelera. El `left join` contra `core.casos`
--        no veía el caso anulado, así que los 10 documentos de
--        `CS-MI-ITE-2026-02` salían con `casoCode = null` («Sin caso») justo
--        cuando se decide si restaurarlos.
--
--    2 · La restauración. Los cinco endpoints `POST …/restaurar` resuelven la
--        fila antes de llamar a `core.restaurar_registro` / `core.restaurar_caso`
--        (`select id from core.<tabla> where …`). Esa lectura pasa por la RLS,
--        que esconde lo anulado, así que el prefetch devolvía 0 filas y la ruta
--        respondía `404 NOT_FOUND`: restaurar no funcionaba en ninguna entidad.
--        Las rutas ahora abren esta misma bandera (`{ verAnulados: true }`) en
--        su transacción, de modo que el prefetch encuentre la fila.
--
--  Qué cambia
--  ----------
--  Se añade **sólo** una política de SELECT permisiva por tabla, idéntica a la
--  de la migración 26:
--
--    · `anulado_en is not null`  → sólo alcanza a lo anulado;
--    · `nivel_clasificacion <= core.clasificacion_max()` → respeta el nivel del
--      rol, igual que `p_clasificacion`;
--    · `current_setting('app.ver_anulados', true) = 'on'` → cerrada por omisión.
--
--  Como las políticas permisivas se combinan con OR, esto no quita ni relaja
--  nada de lo existente: sólo añade la franja de anulados, y únicamente dentro
--  de la transacción en la que `lib/db/tenant.ts` enciende `app.ver_anulados`.
--  Esa bandera la encienden las rutas que ya exigen el permiso de anulación
--  (`puedeAnularRegistros`) para servir `?anulados=true`, y las rutas de
--  restauración mientras resuelven el registro.
--
--  Qué NO cambia
--  -------------
--  · `p_clasificacion`, `p_insert`, `p_update`, `p_delete` y `r_rol_*` intactas.
--  · No se abre la escritura sobre registros anulados: sólo lectura. Anular y
--    restaurar siguen pasando por `core.anular_*` / `core.restaurar_*`, que son
--    `SECURITY DEFINER`.
--  · No se crean columnas, índices ni funciones.
--  · La papelera como **listado propio** de casos, alertas y demandas sigue sin
--    existir en la API (ver `docs/01_requisitos/GAPS_GUIA_SQL_UI.md` §3.4).
--
--  Cómo revertir
--  -------------
--  Bloque comentado al final.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Casos
-- -----------------------------------------------------------------------------
drop policy if exists p_anulados on core.casos;
create policy p_anulados on core.casos for select
  using (
    anulado_en is not null
    and nivel_clasificacion <= core.clasificacion_max()
    and current_setting('app.ver_anulados', true) = 'on'
  );

-- -----------------------------------------------------------------------------
-- 2 · Alertas tempranas
-- -----------------------------------------------------------------------------
drop policy if exists p_anulados on core.alertas_tempranas;
create policy p_anulados on core.alertas_tempranas for select
  using (
    anulado_en is not null
    and nivel_clasificacion <= core.clasificacion_max()
    and current_setting('app.ver_anulados', true) = 'on'
  );

-- -----------------------------------------------------------------------------
-- 3 · Demandas
-- -----------------------------------------------------------------------------
drop policy if exists p_anulados on core.demandas;
create policy p_anulados on core.demandas for select
  using (
    anulado_en is not null
    and nivel_clasificacion <= core.clasificacion_max()
    and current_setting('app.ver_anulados', true) = 'on'
  );

-- -----------------------------------------------------------------------------
-- Verificación (sólo lectura)
-- -----------------------------------------------------------------------------
-- (a) Las cinco tablas de la papelera tienen `p_anulados`.
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'core'
   and tablename in ('casos', 'compromisos', 'documentos', 'alertas_tempranas', 'demandas')
   and policyname = 'p_anulados'
 order by tablename;

-- (b) Las cinco `p_clasificacion` siguen en pie y sin cambios.
select tablename, policyname, qual
  from pg_policies
 where schemaname = 'core'
   and tablename in ('casos', 'compromisos', 'documentos', 'alertas_tempranas', 'demandas')
   and policyname = 'p_clasificacion'
 order by tablename;

commit;

-- (c) Comprobación funcional con el rol de la aplicación: con el GUC en 'off'
--     no se ve nada anulado; con 'on' aparecen exactamente las filas anuladas.
begin;
set local role avisa_app;
select set_config('app.rol_codigo', 'administrador', true) as rol;
select set_config('app.ver_anulados', 'off', true) as ver_anulados;
select count(*) as casos_off from core.casos;
select set_config('app.ver_anulados', 'on', true) as ver_anulados;
select count(*) as casos_on from core.casos;
select count(*) as casos_anulados from core.casos where anulado_en is not null;
rollback;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
-- =============================================================================
--
-- begin;
-- drop policy if exists p_anulados on core.casos;
-- drop policy if exists p_anulados on core.alertas_tempranas;
-- drop policy if exists p_anulados on core.demandas;
-- commit;
