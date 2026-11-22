-- =============================================================================
--  13 · Anulación como operación controlada
--
--  Por qué existe esta migración
--  -----------------------------
--  La migración 12 filtró las filas anuladas en la política RLS de SELECT. Eso
--  es lo que queremos para las lecturas, pero tiene un efecto colateral: en
--  PostgreSQL las políticas de SELECT también se evalúan sobre la *fila nueva*
--  de un UPDATE, así que ningún rol puede poner `anulado_en` a NOT NULL desde
--  SQL normal: la fila recién anulada deja de cumplir `anulado_en IS NULL`.
--
--  Solución: la anulación y la restauración pasan a ser operaciones explícitas
--  ejecutadas por funciones SECURITY DEFINER, con permisos verificados dentro
--  de la propia función. Así:
--    · las lecturas siguen ocultando lo anulado (RLS, imposible de olvidar);
--    · nadie puede anular saltándose las reglas de rol y clasificación;
--    · cada operación queda en `audit.cambios` desde la capa de aplicación.
--
--  Las funciones ya no dependen de RLS para decidir: lo hacen explícitamente.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Puerta de permisos reutilizable
-- -----------------------------------------------------------------------------
create or replace function core.exigir_anulacion(p_nivel smallint)
returns void
language plpgsql
stable
set search_path = pg_catalog, core
as $$
begin
  if not core.puede_editar() then
    raise exception 'Su rol no permite anular ni restaurar registros'
      using errcode = '42501';
  end if;

  if coalesce(p_nivel, 99) > core.clasificacion_max() then
    raise exception 'El registro excede su nivel de acceso'
      using errcode = '42501';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2 · Anulación de un caso con sus dependencias
-- -----------------------------------------------------------------------------
create or replace function core.anular_caso(p_caso_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, core
as $$
declare
  v_lote    uuid := gen_random_uuid();
  v_usuario uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
  v_nivel   smallint;
  n_casos   integer := 0;
  n_alertas integer := 0;
  n_eventos integer := 0;
  n_demandas integer := 0;
  n_compromisos integer := 0;
  n_hitos   integer := 0;
  n_docs    integer := 0;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de la anulación es obligatorio'
      using errcode = '22023';
  end if;

  select nivel_clasificacion into v_nivel
    from core.casos
   where id = p_caso_id and anulado_en is null;

  if not found then
    raise exception 'El caso no existe o ya está anulado'
      using errcode = 'P0002';
  end if;

  perform core.exigir_anulacion(v_nivel);

  update core.casos
     set anulado_en = now(),
         anulado_por = v_usuario,
         anulacion_id = v_lote,
         motivo_anulacion = p_motivo
   where id = p_caso_id;
  get diagnostics n_casos = row_count;

  update core.caso_cronologia
     set anulado_en = now(), anulado_por = v_usuario,
         anulacion_id = v_lote, motivo_anulacion = p_motivo
   where caso_id = p_caso_id and anulado_en is null;
  get diagnostics n_eventos = row_count;

  update core.alertas_tempranas
     set anulado_en = now(), anulado_por = v_usuario,
         anulacion_id = v_lote, motivo_anulacion = p_motivo
   where caso_id = p_caso_id and anulado_en is null;
  get diagnostics n_alertas = row_count;

  update core.demandas
     set anulado_en = now(), anulado_por = v_usuario,
         anulacion_id = v_lote, motivo_anulacion = p_motivo
   where caso_id = p_caso_id and anulado_en is null;
  get diagnostics n_demandas = row_count;

  update core.compromisos
     set anulado_en = now(), anulado_por = v_usuario,
         anulacion_id = v_lote, motivo_anulacion = p_motivo
   where caso_id = p_caso_id and anulado_en is null;
  get diagnostics n_compromisos = row_count;

  update core.hitos_compromiso h
     set anulado_en = now(), anulado_por = v_usuario,
         anulacion_id = v_lote, motivo_anulacion = p_motivo
    from core.compromisos c
   where c.id = h.compromiso_id
     and c.caso_id = p_caso_id
     and h.anulado_en is null;
  get diagnostics n_hitos = row_count;

  update core.documentos
     set anulado_en = now(), anulado_por = v_usuario,
         anulacion_id = v_lote, motivo_anulacion = p_motivo
   where caso_id = p_caso_id and anulado_en is null;
  get diagnostics n_docs = row_count;

  return jsonb_build_object(
    'anulacionId', v_lote,
    'casos', n_casos,
    'alertas', n_alertas,
    'eventos', n_eventos,
    'demandas', n_demandas,
    'compromisos', n_compromisos,
    'hitos', n_hitos,
    'documentos', n_docs
  );
end $$;

-- -----------------------------------------------------------------------------
-- 3 · Anulación genérica de una entidad
-- -----------------------------------------------------------------------------
create or replace function core.anular_registro(
  p_tabla text,
  p_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, core
as $$
declare
  v_lote uuid := gen_random_uuid();
  v_usuario uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
  v_nivel smallint;
  n integer := 0;
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

  execute format(
    'select nivel_clasificacion from core.%I where id = $1 and anulado_en is null',
    p_tabla)
    into v_nivel using p_id;

  if not found then
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
  get diagnostics n = row_count;

  -- Los hitos acompañan a su compromiso.
  if p_tabla = 'compromisos' then
    update core.hitos_compromiso
       set anulado_en = now(), anulado_por = v_usuario,
           anulacion_id = v_lote, motivo_anulacion = p_motivo
     where compromiso_id = p_id and anulado_en is null;
  end if;

  return v_lote;
end $$;

-- -----------------------------------------------------------------------------
-- 4 · Restauración
-- -----------------------------------------------------------------------------
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

  execute format(
    'update core.%I
        set anulado_en = null, anulado_por = null,
            anulacion_id = null, motivo_anulacion = null
      where anulacion_id = $1', p_tabla)
    using v_lote;
  get diagnostics n = row_count;

  return n;
end $$;

create or replace function core.restaurar_caso(p_caso_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, core
as $$
declare
  v_lote uuid;
  v_nivel smallint;
  v_total integer := 0;
  v_tablas text[] := array[
    'caso_cronologia', 'alertas_tempranas', 'demandas',
    'compromisos', 'hitos_compromiso', 'documentos', 'casos'
  ];
  t text;
begin
  select anulacion_id, nivel_clasificacion into v_lote, v_nivel
    from core.casos
   where id = p_caso_id and anulado_en is not null;

  if v_lote is null then
    raise exception 'El caso no existe o no está anulado'
      using errcode = 'P0002';
  end if;

  perform core.exigir_anulacion(v_nivel);

  foreach t in array v_tablas loop
    execute format(
      'update core.%I
          set anulado_en = null, anulado_por = null,
              anulacion_id = null, motivo_anulacion = null
        where anulacion_id = $1', t)
      using v_lote;
    v_total := v_total + 1;
  end loop;

  return jsonb_build_object('anulacionId', v_lote, 'tablas', v_total);
end $$;

revoke all on function core.exigir_anulacion(smallint) from public;
grant execute on function core.exigir_anulacion(smallint) to avisa_app;

commit;
