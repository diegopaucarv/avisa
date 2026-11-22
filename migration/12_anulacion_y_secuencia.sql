-- =============================================================================
--  12 · Anulación (borrado lógico), secuencia monolítica de códigos de caso
--
--  Contexto
--  --------
--  El borrado físico de un caso con alertas falla: `proceso_instancia.alerta_id`
--  no tiene cascada y el `DELETE` de la alerta queda bloqueado por esa FK. Por
--  eso el ciclo de vida pasa a ser lógico: ninguna entidad se borra, se anula.
--
--  Diseño
--  ------
--  · Cuatro columnas por entidad: `anulado_en`, `anulado_por`, `anulacion_id`
--    (lote) y `motivo_anulacion`.
--  · El filtro se aplica en la política RLS de SELECT, no en cada consulta: así
--    ninguna vista, join ni consulta nueva puede "olvidarse" de excluir lo
--    anulado. La política de UPDATE no filtra, para que restaurar sea posible.
--  · Anular un caso anula en cascada alertas, cronología, demandas, compromisos
--    (con sus hitos) y documentos, todo bajo el mismo `anulacion_id`. Restaurar
--    el caso restaura exactamente ese lote.
--  · El motivo es obligatorio (trazabilidad) y se guarda por fila.
--
--  Secuencia
--  ---------
--  `core.secuencia_codigo` guarda un contador por ámbito y se incrementa con un
--  único `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, que es atómico bajo
--  concurrencia. El código de caso es `CS-PRODUCE-<año>-<n>` con `n` global y
--  monótono: nunca se reutiliza un número, ni siquiera tras una anulación.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Columnas de anulación
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'casos',
    'alertas_tempranas',
    'compromisos',
    'hitos_compromiso',
    'documentos',
    'demandas',
    'caso_cronologia'
  ]
  loop
    execute format(
      'alter table core.%I add column if not exists anulado_en timestamptz', t);
    execute format(
      'alter table core.%I add column if not exists anulado_por uuid', t);
    execute format(
      'alter table core.%I add column if not exists anulacion_id uuid', t);
    execute format(
      'alter table core.%I add column if not exists motivo_anulacion text', t);

    -- Índice parcial: la papelera se consulta por lote y las lecturas normales
    -- nunca tocan filas anuladas.
    execute format(
      'create index if not exists %I on core.%I (anulacion_id) where anulado_en is not null',
      t || '_anulacion_idx', t);
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'casos',
    'alertas_tempranas',
    'compromisos',
    'hitos_compromiso',
    'documentos',
    'demandas',
    'caso_cronologia'
  ]
  loop
    if not exists (
      select 1 from pg_constraint where conname = t || '_anulado_por_fkey'
    ) then
      execute format(
        'alter table core.%I add constraint %I foreign key (anulado_por)
           references core.usuarios(id) on delete set null',
        t, t || '_anulado_por_fkey');
    end if;
  end loop;
end $$;

comment on column core.casos.anulado_en is
  'Momento de la anulación lógica. NULL = vigente.';
comment on column core.casos.anulacion_id is
  'Lote de anulación: agrupa el caso y sus dependencias para restaurarlos juntos.';
comment on column core.casos.motivo_anulacion is
  'Motivo declarado al anular (obligatorio).';

-- -----------------------------------------------------------------------------
-- 2 · RLS: lo anulado desaparece de todas las lecturas
--    El filtro vive en la política, no en las consultas.
-- -----------------------------------------------------------------------------
alter policy p_clasificacion on core.casos
  using (nivel_clasificacion <= core.clasificacion_max() and anulado_en is null);
alter policy p_clasificacion on core.alertas_tempranas
  using (nivel_clasificacion <= core.clasificacion_max() and anulado_en is null);
alter policy p_clasificacion on core.compromisos
  using (nivel_clasificacion <= core.clasificacion_max() and anulado_en is null);
alter policy p_clasificacion on core.hitos_compromiso
  using (nivel_clasificacion <= core.clasificacion_max() and anulado_en is null);
alter policy p_clasificacion on core.documentos
  using (nivel_clasificacion <= core.clasificacion_max() and anulado_en is null);
alter policy p_clasificacion on core.demandas
  using (nivel_clasificacion <= core.clasificacion_max() and anulado_en is null);
alter policy p_clasificacion on core.caso_cronologia
  using (nivel_clasificacion <= core.clasificacion_max() and anulado_en is null);

-- -----------------------------------------------------------------------------
-- 3 · Secuencia monolítica
-- -----------------------------------------------------------------------------
create table if not exists core.secuencia_codigo (
  ambito          text primary key,
  ultimo          bigint not null default 0 check (ultimo >= 0),
  actualizado_en  timestamptz not null default now()
);

comment on table core.secuencia_codigo is
  'Contadores monótonos por ámbito. Un número jamás se reutiliza.';

create or replace function core.siguiente_codigo(
  p_ambito text,
  p_prefijo text,
  p_ancho integer default 3
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, core
as $$
declare
  v_ultimo bigint;
begin
  insert into core.secuencia_codigo as s (ambito, ultimo, actualizado_en)
  values (p_ambito, 1, now())
  on conflict (ambito) do update
     set ultimo = s.ultimo + 1,
         actualizado_en = now()
  returning ultimo into v_ultimo;

  return p_prefijo || lpad(v_ultimo::text, greatest(coalesce(p_ancho, 3), 1), '0');
end $$;

create or replace function core.siguiente_codigo_caso()
returns text
language sql
security definer
set search_path = pg_catalog, core
as $$
  select core.siguiente_codigo(
    'CASO',
    'CS-PRODUCE-' || to_char(now() at time zone 'America/Lima', 'YYYY') || '-',
    3
  );
$$;

comment on function core.siguiente_codigo_caso() is
  'Código de caso con contador global monótono; el número nunca se reutiliza.';

-- -----------------------------------------------------------------------------
-- 4 · Anulación de un caso con sus dependencias
-- -----------------------------------------------------------------------------
create or replace function core.anular_caso(p_caso_id uuid, p_motivo text)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, core
as $$
declare
  v_lote    uuid := gen_random_uuid();
  v_usuario uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
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

  update core.casos
     set anulado_en = now(),
         anulado_por = v_usuario,
         anulacion_id = v_lote,
         motivo_anulacion = p_motivo
   where id = p_caso_id
     and anulado_en is null;
  get diagnostics n_casos = row_count;

  if n_casos = 0 then
    raise exception 'El caso no existe o ya está anulado'
      using errcode = 'P0002', hint = 'Verifique el identificador y el estado.';
  end if;

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
-- 5 · Restauración del lote (deshacer una anulación)
-- -----------------------------------------------------------------------------
create or replace function core.restaurar_registro(p_tabla text, p_id uuid)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, core
as $$
declare
  v_lote uuid;
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
    'select anulacion_id from core.%I where id = $1 and anulado_en is not null', p_tabla)
    into v_lote using p_id;

  if v_lote is null then
    raise exception 'El registro no existe o no está anulado'
      using errcode = 'P0002';
  end if;

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
security invoker
set search_path = pg_catalog, core
as $$
declare
  v_lote uuid;
  n_total integer := 0;
  n integer := 0;
  v_tablas text[] := array[
    'caso_cronologia', 'alertas_tempranas', 'demandas',
    'compromisos', 'hitos_compromiso', 'documentos', 'casos'
  ];
  t text;
begin
  select anulacion_id into v_lote
    from core.casos
   where id = p_caso_id and anulado_en is not null;

  if v_lote is null then
    raise exception 'El caso no existe o no está anulado'
      using errcode = 'P0002';
  end if;

  foreach t in array v_tablas loop
    execute format(
      'update core.%I
          set anulado_en = null, anulado_por = null,
              anulacion_id = null, motivo_anulacion = null
        where anulacion_id = $1', t)
      using v_lote;
    n_total := n_total + 1;
  end loop;

  return jsonb_build_object('anulacionId', v_lote, 'tablas', n_total);
end $$;

-- -----------------------------------------------------------------------------
-- 6 · Anulación genérica de una entidad (alertas, compromisos, etc.)
-- -----------------------------------------------------------------------------
create or replace function core.anular_registro(
  p_tabla text,
  p_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, core
as $$
declare
  v_lote uuid := gen_random_uuid();
  v_usuario uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
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
    'update core.%I
        set anulado_en = now(), anulado_por = $2,
            anulacion_id = $3, motivo_anulacion = $4
      where id = $1 and anulado_en is null', p_tabla)
    using p_id, v_usuario, v_lote, p_motivo;
  get diagnostics n = row_count;

  if n = 0 then
    raise exception 'El registro no existe o ya está anulado'
      using errcode = 'P0002';
  end if;

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
-- 7 · Recodificación de los casos existentes
--     Se renumera por fecha de creación con el formato vigente y se prepara el
--     contador. Es idempotente: si ya están numerados, el resultado es el mismo.
-- -----------------------------------------------------------------------------
create temporary table _recodificacion on commit drop as
  select id,
         row_number() over (order by created_at, codigo_caso) as n
    from core.casos;

-- Paso intermedio con un valor garantizado único: evita colisiones del índice
-- único mientras se reasignan códigos.
update core.casos c
   set codigo_caso = 'RECOD-' || c.id::text
  from _recodificacion r
 where c.id = r.id;

update core.casos c
   set codigo_caso = 'CS-PRODUCE-'
                     || to_char(c.created_at at time zone 'America/Lima', 'YYYY')
                     || '-' || lpad(r.n::text, 3, '0')
  from _recodificacion r
 where c.id = r.id;

-- Las referencias textuales deben seguir al código nuevo.
update core.proceso_instancia p
   set codigo_caso_legado = c.codigo_caso
  from core.casos c
 where p.caso_id = c.id
   and p.codigo_caso_legado is distinct from c.codigo_caso;

insert into core.secuencia_codigo (ambito, ultimo, actualizado_en)
values (
  'CASO',
  coalesce(
    (select max(substring(codigo_caso from '(\d+)$')::bigint) from core.casos),
    0
  ),
  now()
)
on conflict (ambito) do update
   set ultimo = greatest(core.secuencia_codigo.ultimo, excluded.ultimo),
       actualizado_en = now();

-- -----------------------------------------------------------------------------
-- 8 · Permisos
-- -----------------------------------------------------------------------------
grant select, insert, update on core.secuencia_codigo to avisa_app;

grant execute on function core.siguiente_codigo(text, text, integer) to avisa_app;
grant execute on function core.siguiente_codigo_caso() to avisa_app;
grant execute on function core.anular_caso(uuid, text) to avisa_app;
grant execute on function core.restaurar_caso(uuid) to avisa_app;
grant execute on function core.anular_registro(text, uuid, text) to avisa_app;
grant execute on function core.restaurar_registro(text, uuid) to avisa_app;

commit;
