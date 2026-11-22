-- =============================================================================
--  28 · `core.anular_registro` no encontraba la fila (FOUND no lo actualiza
--       un EXECUTE)
--
--  Fecha: 2026-11-22
--
--  Por qué existe esta migración
--  -----------------------------
--  `migration/12_anulacion_y_secuencia.sql` definió `core.anular_registro`
--  comprobando el resultado con `if v_lote is null`, que es correcto.
--  `migration/13_anulacion_segura.sql` (línea 180) la redefinió con
--
--      execute format('select nivel_clasificacion from core.%I where id = $1
--                      and anulado_en is null', p_tabla)
--        into v_nivel using p_id;
--
--      if not found then
--        raise exception 'El registro no existe o ya está anulado'
--          using errcode = 'P0002';
--      end if;
--
--  y ahí está el defecto: **`EXECUTE` no actualiza `FOUND`**. Lo deja con el
--  valor de la sentencia anterior; en la práctica, `false`, así que la
--  condición `if not found` es siempre verdadera y la función lanza P0002
--  aunque la fila exista y esté activa.
--
--  Consecuencia: la anulación por la API (`DELETE /api/v1/documents/{id}`,
--  `/commitments/{id}`, `/alerts/{id}`, `/demandas/{id}`) devolvía
--  `404 El registro no existe o excede el nivel de acceso.` para **cualquier**
--  fila. Nunca funcionó desde la migración 13. La papelera sólo tenía
--  contenido porque los anulados del legado se crearon con
--  `core.anular_caso`, que usa un `SELECT INTO` estático (donde `FOUND` sí se
--  actualiza).
--
--  Evidencia medida antes de escribir esto
--  ---------------------------------------
--  · En una transacción con `set local role avisa_app`,
--    `app.rol_codigo = 'administrador'` y `app.usuario_id` de un administrador:
--
--        select core.clasificacion_max();          -- 3
--        select core.puede_editar();               -- true
--        select count(*) from core.documentos
--         where id = '<uuid activo>' and anulado_en is null;   -- 1
--        select core.anular_registro('documentos', '<uuid>', 'prueba');
--        ERROR: El registro no existe o ya está anulado
--        CONTEXT: PL/pgSQL function anular_registro(text,uuid,text) line 29
--
--  · La misma consulta dinámica, con `EXECUTE … INTO`, deja `FOUND` en `false`:
--
--        do $$ declare v int; begin
--          execute 'select 1 from core.documentos where id = $1'
--            into v using '<uuid>'::uuid;
--          raise notice 'found=% valor=%', found, v;   -- found=f valor=1
--        end $$;
--
--  Qué hace este bloque
--  --------------------
--  · Redefine `core.anular_registro(text, uuid, text)` con `CREATE OR REPLACE`
--    conservando firma, `SECURITY DEFINER`, `search_path`, la lista de tablas
--    admitidas, la comprobación de motivo, `core.exigir_anulacion`, el arrastre
--    de los hitos del compromiso y el `return` del lote.
--  · Cambia **sólo** la detección de «no encontrado»: `GET DIAGNOSTICS` sobre
--    el `EXECUTE`, que sí informa de las filas devueltas.
--  · No toca datos, catálogos, políticas ni la semántica del lote de anulación.
--  · `CREATE OR REPLACE` preserva los `GRANT` existentes a `avisa_app`.
--
--  Qué NO cambia
--  -------------
--  · El lote sigue siendo la unidad de restauración de una baja en cascada
--    (migración 12): `core.anular_caso` asigna un `anulacion_id` común al caso
--    y a sus dependencias, y `core.restaurar_caso` restaura ese lote. Anular
--    una entidad suelta por `core.anular_registro` le da su propio lote, de
--    modo que restaurarla afecta sólo a esa fila (más los hitos de su
--    compromiso, que acompañan al compromiso por diseño).
--  · `core.anular_caso`, `core.restaurar_caso` y `core.restaurar_registro` no
--    se tocan: ninguno tiene este defecto.
--
--  Cómo revertir
--  -------------
--  Volver a aplicar el bloque de `migration/13_anulacion_segura.sql` §6. No se
--  recomienda: reintroduce el 404 en toda anulación por API.
-- =============================================================================

begin;

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

  perform core.exigir_anulacion(v_nivel);

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

commit;

-- -----------------------------------------------------------------------------
-- Verificación de sólo lectura
-- -----------------------------------------------------------------------------
-- (a) La función es la nueva y sigue siendo SECURITY DEFINER.
select p.proname,
       p.prosecdef as security_definer,
       pg_get_function_identity_arguments(p.oid) as argumentos
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core'
   and p.proname = 'anular_registro';

-- (b) Ciclo real anular → restaurar sobre una fila activa, dentro de una
--     transacción que se revierte: no deja ningún dato cambiado.
begin;
set local role avisa_app;
select set_config('app.rol_codigo', 'administrador', true) as rol;
select set_config(
         'app.usuario_id',
         (select u.id::text from core.usuarios u order by u.id limit 1),
         true) as usuario;
do $$
declare
  v_id uuid;
  v_lote uuid;
begin
  select d.id into v_id
    from core.documentos d
   where d.anulado_en is null
   limit 1;

  v_lote := core.anular_registro('documentos', v_id, 'Verificación de la migración 28');
  raise notice 'anular_registro OK: documento % anulado en el lote %', v_id, v_lote;

  perform core.restaurar_registro('documentos', v_id);
  raise notice 'restaurar_registro OK: documento % restaurado', v_id;
end $$;
rollback;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
-- =============================================================================
--
-- begin;
--   -- reaplicar el §6 de migration/13_anulacion_segura.sql
--   \i migration/13_anulacion_segura.sql
-- commit;
