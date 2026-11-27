-- =============================================================================
-- 78 · La Dirección puede anular alertas (G1)
--
-- Fecha: 2026-11-27
--
-- Por qué
-- -------
-- La interfaz ofrece «Anular» en la sección «Dirección OAIPCS» del menú de
-- acciones de una alerta (5.6), pero la base la rechaza:
--
--   · `core.roles.puede_eliminar = false` para `direccion_oaipcs` (migración 32).
--   · `core.exigir_anulacion` —la única puerta que atraviesan
--     `core.anular_registro` y `core.restaurar_registro`— exige
--     `core.puede_eliminar()`.
--   · Resultado: `DELETE /api/v1/alerts/{id}` responde 403 (42501) a la
--     Directora, y el botón que la interfaz ya muestra no funciona.
--
-- Dar `puede_eliminar = true` a `direccion_oaipcs` no es opción: abriría la baja
-- en *todas* las tablas (casos, documentos, demandas…), mucho más de lo que
-- pide el flujo de alertas.
--
-- Qué hace
-- --------
-- 1. Crea `core.exigir_anulacion(smallint, text)`: la misma puerta, con la
--    tabla como segundo argumento, que además deja pasar a `direccion_oaipcs`
--    **sólo** cuando la tabla es `alertas_tempranas`.
-- 2. Redefine `core.anular_registro(text, uuid, text)` y
--    `core.restaurar_registro(text, uuid)` con `CREATE OR REPLACE`, cambiando
--    únicamente la llamada a la puerta: `exigir_anulacion(v_nivel)` →
--    `exigir_anulacion(v_nivel, p_tabla)`. Todo lo demás (firma, `SECURITY
--    DEFINER`, lista de tablas, `P0002`, hitos del compromiso, recuento por
--    `GET DIAGNOSTICS`) se conserva literal de las migraciones 28 y 29.
-- 3. Mantiene la sobrecarga de un argumento intacta: las llamadas antiguas
--    (`core.anular_caso`, `core.restaurar_caso`) siguen resolviendo a ella y
--    conservan la regla estricta de `puede_eliminar`.
--
-- Efecto observable
-- -----------------
-- · `administrador` y `sectorista`: sin cambios (anulan y restauran todo).
-- · `direccion_oaipcs`: puede anular y restaurar alertas; en cualquier otra
--   tabla sigue recibiendo 42501.
-- · Ningún otro rol cambia.
--
-- Cómo revertir
--  · Volver a definir ambas funciones llamando a `core.exigir_anulacion(v_nivel)`
--    (migraciones 28 y 29) y `drop function core.exigir_anulacion(smallint, text)`.
--    No se recomienda: el botón de la interfaz vuelve a fallar.
--
-- Idempotente: `CREATE OR REPLACE` sobre firmas existentes y `CREATE` de la
-- sobrecarga nueva son seguros al reejecutar.
-- =============================================================================

begin;

-- 1 · Puerta con tabla --------------------------------------------------------

create or replace function core.exigir_anulacion(p_nivel smallint, p_tabla text)
returns void
language plpgsql
stable
set search_path = pg_catalog, core
as $$
begin
  if not (
    core.puede_eliminar()
    -- Excepción acotada: la baja de alertas es una acción del flujo de la
    -- Dirección, aunque su rol no tenga `puede_eliminar` en la matriz.
    or (p_tabla = 'alertas_tempranas' and core.rol_actual() = 'direccion_oaipcs')
  ) then
    raise exception 'Su rol no permite anular ni restaurar registros'
      using errcode = '42501';
  end if;

  if coalesce(p_nivel, 99) > core.clasificacion_max() then
    raise exception 'El registro excede su nivel de acceso'
      using errcode = '42501';
  end if;
end $$;

revoke all on function core.exigir_anulacion(smallint, text) from public;
grant execute on function core.exigir_anulacion(smallint, text) to avisa_app;

-- 2 · Anulación genérica: pasa la tabla a la puerta ---------------------------

create or replace function core.anular_registro(p_tabla text, p_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, core
as $$
declare
  v_lote uuid := gen_random_uuid();
  v_usuario uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
  v_nivel smallint;
  n_filas integer := 0;
  v_tablas text[] := array[
    'alertas_tempranas', 'compromisos', 'hitos_compromiso',
    'documentos', 'demandas', 'caso_cronologia'
  ];
begin
  if not (p_tabla = any (v_tablas)) then
    raise exception
      'Tabla no admitida para anulación: % (los casos usan core.anular_caso)', p_tabla
      using errcode = '22023';
  end if;

  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de la anulación es obligatorio'
      using errcode = '22023';
  end if;

  -- `EXECUTE` no actualiza `FOUND`: la comprobación va por `GET DIAGNOSTICS`.
  execute format(
    'select nivel_clasificacion from core.%I where id = $1 and anulado_en is null',
    p_tabla)
    into v_nivel using p_id;
  get diagnostics n_filas = row_count;

  if n_filas = 0 then
    raise exception 'El registro no existe o ya está anulado'
      using errcode = 'P0002';
  end if;

  perform core.exigir_anulacion(v_nivel, p_tabla);

  execute format(
    'update core.%I
        set anulado_en = now(), anulado_por = $2,
            anulacion_id = $3, motivo_anulacion = $4
      where id = $1 and anulado_en is null', p_tabla)
    using p_id, v_usuario, v_lote, p_motivo;

  -- Los hitos acompañan a su compromiso.
  if p_tabla = 'compromisos' then
    update core.hitos_compromiso
       set anulado_en = now(), anulado_por = v_usuario,
           anulacion_id = v_lote, motivo_anulacion = p_motivo
     where compromiso_id = p_id and anulado_en is null;
  end if;

  return v_lote;
end $$;

-- 3 · Restauración por fila: igual, con la tabla ------------------------------

create or replace function core.restaurar_registro(p_tabla text, p_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, core
as $$
declare
  v_lote uuid;
  v_nivel smallint;
  n integer := 0;
  v_tablas text[] := array[
    'casos', 'alertas_tempranas', 'compromisos', 'hitos_compromiso',
    'documentos', 'demandas', 'caso_cronologia'
  ];
begin
  if not (p_tabla = any (v_tablas)) then
    raise exception 'Tabla no admitida para restauración: %', p_tabla
      using errcode = '22023';
  end if;

  execute format(
    'select anulacion_id, nivel_clasificacion from core.%I
      where id = $1 and anulado_en is not null', p_tabla)
    into v_lote, v_nivel using p_id;

  if v_lote is null then
    raise exception 'El registro no existe o no está anulado'
      using errcode = 'P0002';
  end if;

  perform core.exigir_anulacion(v_nivel, p_tabla);

  execute format(
    'update core.%I
        set anulado_en = null, anulado_por = null,
            anulacion_id = null, motivo_anulacion = null
      where id = $1', p_tabla)
    using p_id;
  get diagnostics n = row_count;

  -- Los hitos acompañan a su compromiso, igual que en `core.anular_registro`.
  if p_tabla = 'compromisos' then
    update core.hitos_compromiso
       set anulado_en = null, anulado_por = null,
           anulacion_id = null, motivo_anulacion = null
     where compromiso_id = p_id and anulado_en is not null;
  end if;

  return n;
end $$;

insert into core.migracion_log (clave)
values ('78_alertas_anulacion_direccion_2026_11_27')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Verificación (no ejecutar fuera de una transacción con rollback)
-- =============================================================================
--  begin;
--  set local role avisa_app;
--
--  -- Debe PASAR: la Dirección anula una alerta.
--  select set_config('app.rol_codigo', 'direccion_oaipcs', true);
--  select core.exigir_anulacion(1, 'alertas_tempranas');
--
--  -- Debe FALLAR con 42501: la misma Dirección no anula un documento.
--  select core.exigir_anulacion(1, 'documentos');
--
--  -- Debe FALLAR con 42501: un analista no anula alertas.
--  select set_config('app.rol_codigo', 'analista_cualitativo', true);
--  select core.exigir_anulacion(1, 'alertas_tempranas');
--
--  -- Debe PASAR: el rol con puede_eliminar sigue sin restricciones.
--  select set_config('app.rol_codigo', 'administrador', true);
--  select core.exigir_anulacion(1, 'documentos');
--
--  rollback;
