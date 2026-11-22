-- =============================================================================
--  29 · Restauración estrictamente por fila
--
--  Fecha: 2026-11-22
--
--  Por qué existe esta migración
--  -----------------------------
--  `core.restaurar_registro` restauraba **por lote**: leía el `anulacion_id` de
--  la fila y hacía
--
--      update core.%I set anulado_en = null, ...
--       where anulacion_id = $1
--
--  `core.anular_caso` sella el caso y todas sus dependencias con un mismo
--  `anulacion_id` (migración 13), así que restaurar **un** documento de un caso
--  anulado levantaba los diez documentos del lote. El usuario quiere que
--  restaurar actúe sobre esa fila y sólo esa fila.
--
--  Evidencia medida antes de escribir esto
--  ---------------------------------------
--  Caso `CS-MI-ITE-2026-02` en la papelera, lote
--  `35f6ccf9-649d-4275-915c-8051293c5b37` con 10 documentos anulados. Con la
--  función anterior, `select core.restaurar_registro('documentos', <un id>)`
--  devolvía `10` y dejaba activos los diez documentos: restaurar una fila
--  reabría el lote entero.
--
--  Qué hace este bloque
--  --------------------
--  · Redefine `core.restaurar_registro(p_tabla text, p_id uuid)` con
--    `CREATE OR REPLACE`, conservando exactamente la firma, `SECURITY DEFINER`,
--    `set search_path`, la lista de tablas admitidas, la validación `22023` de
--    tabla, `core.exigir_anulacion(v_nivel)`, el error `P0002` y el retorno del
--    número de filas (los `GRANT` los preserva `CREATE OR REPLACE`).
--  · Cambia **sólo** el `where`: `anulacion_id = $1` → `id = $1 using p_id`.
--  · Cuando `p_tabla = 'compromisos'`, restaura además sus hitos, que
--    acompañan al compromiso por diseño, igual que en `core.anular_registro`.
--  · No toca datos, catálogos, políticas ni ninguna otra función.
--
--  Detección de «no encontrado»
--  ----------------------------
--  El `SELECT … INTO` de cabecera sí actualiza `FOUND`; se conserva la guarda
--  `if v_lote is null` (`P0002`), que ya era correcta. La escritura es un
--  `EXECUTE`, y un `EXECUTE` **no** actualiza `FOUND` —error que arrastraron las
--  migraciones 13 y 28—, por eso el recuento se toma con
--  `GET DIAGNOSTICS n = ROW_COUNT` y no con `IF NOT FOUND`.
--
--  Qué NO cambia (intencional)
--  ---------------------------
--  · `core.anular_caso`, `core.anular_registro` y **`core.restaurar_caso`** no
--    se tocan. `core.restaurar_caso` sigue restaurando el caso con su lote
--    completo: es la acción «reabrir el caso» y así debe permanecer. Restaurar
--    la fila del caso por `restaurar_registro('casos', …)` levanta sólo el caso;
--    para devolver también sus documentos, alertas y demandas se usa
--    `restaurar_caso`.
--  · La unidad de anulación en cascada sigue siendo el lote; sólo cambia la
--    granularidad de la restauración puntual.
--
--  Cómo revertir
--  -------------
--  Volver a aplicar el bloque de `migration/13_anulacion_segura.sql` §4. No se
--  recomienda: reintroduce la restauración por lote.
-- =============================================================================

begin;

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

  perform core.exigir_anulacion(v_nivel);

  -- Restauración por fila: antes era `where anulacion_id = $1`, lo que
  -- levantaba todo el lote. `EXECUTE` no actualiza `FOUND`; el recuento va por
  -- `GET DIAGNOSTICS`.
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

commit;

-- -----------------------------------------------------------------------------
-- Verificación de sólo lectura: la función es la nueva y definer.
-- -----------------------------------------------------------------------------
select p.proname,
       p.prosecdef as security_definer,
       pg_get_function_identity_arguments(p.oid) as argumentos
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'core'
   and p.proname = 'restaurar_registro';

-- -----------------------------------------------------------------------------
-- Prueba por fila sobre el lote de `CS-MI-ITE-2026-02` (10 documentos).
-- Todo ocurre dentro de una transacción que se revierte: no deja datos tocados.
-- -----------------------------------------------------------------------------
begin;
set local role avisa_app;
select set_config('app.rol_codigo', 'administrador', true) as rol;
select set_config('app.usuario_id', '00000000-0000-0000-0000-000000000001', true) as usuario;
select set_config('app.ver_anulados', 'on', true) as ver_anulados;

do $$
declare
  v_lote        constant uuid := '35f6ccf9-649d-4275-915c-8051293c5b37';
  v_id          uuid;
  v_restaurados integer;
  v_activo      integer;
  v_otros       integer;
  v_caso        boolean;
begin
  select d.id into v_id
    from core.documentos d
   where d.anulacion_id = v_lote
   order by d.id
   limit 1;

  raise notice 'documento a restaurar: %', v_id;

  v_restaurados := core.restaurar_registro('documentos', v_id);
  raise notice 'restaurar_registro devolvio: %', v_restaurados;

  select count(*) into v_activo
    from core.documentos
   where id = v_id and anulado_en is null;

  select count(*) into v_otros
    from core.documentos
   where anulacion_id = v_lote and anulado_en is not null;

  select anulado_en is not null into v_caso
    from core.casos
   where codigo_caso = 'CS-MI-ITE-2026-02';

  raise notice 'restaurado activo=%, otros anulados=%, caso anulado=%',
    v_activo, v_otros, v_caso;

  if v_restaurados <> 1 then
    raise exception 'esperaba 1 restaurado, obtuve %', v_restaurados;
  end if;
  if v_activo <> 1 then
    raise exception 'el documento restaurado no quedo activo';
  end if;
  if v_otros <> 9 then
    raise exception 'esperaba 9 documentos anulados restantes, obtuve %', v_otros;
  end if;
  if not v_caso then
    raise exception 'el caso dejo de estar anulado';
  end if;

  raise notice 'OK: restauracion por fila verificada';
end $$;
rollback;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
-- =============================================================================
--
-- begin;
--   -- reaplicar el §4 de migration/13_anulacion_segura.sql
--   \i migration/13_anulacion_segura.sql
-- commit;
