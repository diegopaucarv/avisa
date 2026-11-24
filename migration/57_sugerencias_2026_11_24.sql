-- ============================================================================
-- AVISA — Migración aditiva 57: matriz de sugerencias de intervención
--
-- Fecha: 2026-11-24
--
-- POR QUÉ EXISTE
--   La pantalla «Gobierno y sugerencias» conduce la mesa de trabajo con las
--   sugerencias y recomendaciones de intervención, por caso o por territorio:
--   qué se sugiere, a quién, con qué prioridad, en qué estado va, quién la
--   atiende y con qué sustento. Hasta hoy no había dónde guardarlas.
--
--   Se revisó antes de crearla: no existe `core.sugerencia*`,
--   `core.recomendacion*` ni una vista `analytics.vw_*` equivalente. El esquema
--   `agent` (run_log, feedback_log, lessons_learned…) registra corridas de
--   modelos, no sugerencias de intervención con responsable y sustento, así que
--   no se usa aquí.
--
-- REGLAS
--   * ADITIVA: crea dos catálogos cortos y una tabla. No toca nada existente.
--   * IDEMPOTENTE: CREATE TABLE/INDEX IF NOT EXISTS, ON CONFLICT DO NOTHING.
--   * No siembra datos de negocio: sólo el vocabulario cerrado (estados, tipos),
--     que no es dato de negocio.
--   * RLS y auditoría copian el contrato de `core.normativas` /
--     `core.otros_documentos` (migración 45): FORCE ROW LEVEL SECURITY,
--     `core.set_audit()`, políticas `p_clasificacion`, `p_anulados`, `p_insert`,
--     `p_update`, `p_delete` y las restrictivas `r_rol_*`.
--   * PostgreSQL 16, esquema `core`.
-- ============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Catálogo de estados de la sugerencia
--     El estado nunca se deriva del texto libre: es una clave del catálogo.
--     `es_terminal` distingue las filas inertes (Pendiente/Expirada) de las
--     decididas; `categoria` agrupa sin_decision / decidida / inerte.
-- -----------------------------------------------------------------------------
create table if not exists core.cat_estados_sugerencia (
    id          smallint    primary key,
    codigo      varchar(40) not null unique,
    etiqueta    varchar(80) not null,
    categoria   varchar(20) not null
        check (categoria in ('sin_decision', 'decidida')),
    es_terminal boolean     not null default false,
    orden       smallint    not null default 0
);

comment on table core.cat_estados_sugerencia is
    'Estados de la sugerencia de intervención. `es_terminal` marca las filas que ya no esperan decisión humana; nunca se aplica una sugerencia en automático.';

insert into core.cat_estados_sugerencia (id, codigo, etiqueta, categoria, es_terminal, orden) values
    (1, 'pendiente',            'Pendiente',            'sin_decision', false, 1),
    (2, 'aceptada',             'Aceptada',             'decidida',     true,  2),
    (3, 'aceptada_con_cambios', 'Aceptada con cambios', 'decidida',     true,  3),
    (4, 'rechazada',            'Rechazada',            'decidida',     true,  4),
    (5, 'expirada',             'Expirada',             'sin_decision', true,  5)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2 · Catálogo de tipos de sugerencia
--     `codigo` es el valor estable que viaja en la API; `etiqueta` es lo que se
--     muestra. Así los acentos y guiones no ensucian las comparaciones.
-- -----------------------------------------------------------------------------
create table if not exists core.cat_tipos_sugerencia (
    id       smallint    primary key,
    codigo   varchar(40) not null unique,
    etiqueta varchar(80) not null,
    orden    smallint    not null default 0
);

comment on table core.cat_tipos_sugerencia is
    'Tipos de sugerencia de intervención. Vocabulario cerrado; `codigo` es la clave que usa la API y `etiqueta` el rótulo visible.';

insert into core.cat_tipos_sugerencia (id, codigo, etiqueta, orden) values
    (1, 'alerta_propuesta',           'Alerta propuesta',             1),
    (2, 'clasificacion_nivel',        'Clasificación de nivel',       2),
    (3, 'borrador_ayuda_memoria',     'Borrador de ayuda memoria',    3),
    (4, 'vinculo_caso_demanda',       'Vínculo caso–demanda',         4),
    (5, 'duplicado_detectado',        'Duplicado detectado',          5),
    (6, 'recomendacion_intervencion', 'Recomendación de intervención', 6),
    (7, 'seguimiento_compromiso',     'Seguimiento de compromiso',    7),
    (8, 'otro',                       'Otro',                         8)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 3 · Tabla core.sugerencia
--     La entidad afectada es un caso (uuid) o un territorio (región/provincia/
--     distrito o texto libre). No hay FK polimórfica: `entidad_tipo` decide qué
--     columnas deben venir y el CHECK lo exige.
-- -----------------------------------------------------------------------------
create table if not exists core.sugerencia (
    id                   uuid        primary key default gen_random_uuid(),
    codigo               varchar(40) not null unique,

    entidad_tipo         varchar(20) not null
        check (entidad_tipo in ('caso', 'territorio')),
    caso_id              uuid        references core.casos (id),
    region_id            integer     references core.regiones (id),
    provincia_id         integer     references core.provincias (id),
    distrito_id          integer     references core.distritos (id),
    territorio_texto     varchar(200),

    tipo_id              smallint    not null default 6
        references core.cat_tipos_sugerencia (id),
    titulo               varchar(240) not null,
    detalle              text,

    destinatario         varchar(200),
    unidad_responsable_id integer    references core.cat_unidades_organicas (id),
    prioridad_id         smallint    not null default 2
        references core.cat_prioridades_atencion (id),
    estado_id            smallint    not null default 1
        references core.cat_estados_sugerencia (id),

    responsable_usuario_id uuid,
    responsable_texto      varchar(160),

    sustento             text,
    sustento_uri         varchar(500),

    origen               varchar(20) not null default 'persona'
        check (origen in ('persona', 'agente', 'mesa', 'sistema')),
    confianza            numeric(5, 2)
        check (confianza is null or (confianza >= 0 and confianza <= 100)),

    decision_nota        text,
    motivo_rechazo       text,
    -- Sin FK a core.usuarios: el uid de sesión no siempre tiene fila allí
    -- (patrón de trazas). El nombre se resuelve por join y, si falta, se
    -- declara «sin dato»; nunca se bloquea una decisión por eso.
    decidido_por         uuid,
    decidido_en          timestamptz,
    vence_en             date,

    nivel_clasificacion  smallint    not null default 2
        references core.cat_clasificacion (nivel),
    anulado_en           timestamptz,
    anulado_por          uuid,
    motivo_anulacion     text,

    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    created_by           uuid,
    updated_by           uuid
);

-- La entidad afectada es excluyente: un caso no necesita territorio y un
-- territorio no puede quedarse sin ninguna referencia.
alter table core.sugerencia
    drop constraint if exists chk_sugerencia_entidad;
alter table core.sugerencia
    add constraint chk_sugerencia_entidad
    check (
        (entidad_tipo = 'caso' and caso_id is not null)
        or (entidad_tipo = 'territorio'
            and (region_id is not null
                 or provincia_id is not null
                 or distrito_id is not null
                 or territorio_texto is not null))
    );

comment on table core.sugerencia is
    'Sugerencias y recomendaciones de intervención por caso o territorio: qué se sugiere, a quién, con qué prioridad, en qué estado, quién la atiende y con qué sustento. La decisión siempre es humana; `decidido_por` y `decidido_en` la registran.';
comment on column core.sugerencia.entidad_tipo is
    'caso = la sugerencia apunta a core.casos; territorio = apunta a región/provincia/distrito o a territorio_texto.';
comment on column core.sugerencia.decidido_por is
    'Usuario que tomó la decisión. Obligatorio para los estados decididos; nunca lo completa el sistema.';
comment on column core.sugerencia.confianza is
    'Confianza declarada de la sugerencia, 0–100. NULL = sin dato; no se estima.';
comment on column core.sugerencia.sustento is
    'Sustento declarado de la sugerencia (qué la respalda). NULL = sin dato.';

-- Si una versión anterior de esta migración llegó a crear las claves foráneas
-- hacia core.usuarios, se retiran: el uid de sesión no siempre tiene fila en
-- esa tabla y una decisión nunca debe fallar por una referencia de traza.
alter table core.sugerencia drop constraint if exists sugerencia_decidido_por_fkey;
alter table core.sugerencia drop constraint if exists sugerencia_anulado_por_fkey;

create index if not exists ix_sugerencia_created
    on core.sugerencia (created_at desc)
    where anulado_en is null;
create index if not exists ix_sugerencia_estado_prioridad
    on core.sugerencia (estado_id, prioridad_id)
    where anulado_en is null;
create index if not exists ix_sugerencia_caso
    on core.sugerencia (caso_id)
    where anulado_en is null;
create index if not exists ix_sugerencia_region
    on core.sugerencia (entidad_tipo, region_id)
    where anulado_en is null;

-- -----------------------------------------------------------------------------
-- 4 · RLS y auditoría (mismo contrato que core.normativas, migración 45)
-- -----------------------------------------------------------------------------
alter table core.sugerencia enable row level security;
alter table core.sugerencia force row level security;

drop trigger if exists trg_audit on core.sugerencia;
create trigger trg_audit before insert or update on core.sugerencia
    for each row execute function core.set_audit();

do $$
declare
    tabla text := 'sugerencia';
begin
    execute format('drop policy if exists p_clasificacion on core.%I', tabla);
    execute format($f$
        create policy p_clasificacion on core.%I as permissive for select
            to public
            using (anulado_en is null
                   and nivel_clasificacion <= core.clasificacion_max())
    $f$, tabla);

    execute format('drop policy if exists p_insert on core.%I', tabla);
    execute format($f$
        create policy p_insert on core.%I as permissive for insert
            to public
            with check (core.clasificacion_max() >= 2
                        and nivel_clasificacion <= core.clasificacion_max())
    $f$, tabla);

    execute format('drop policy if exists p_update on core.%I', tabla);
    execute format($f$
        create policy p_update on core.%I as permissive for update
            to public
            using (core.clasificacion_max() >= 2
                   and nivel_clasificacion <= core.clasificacion_max())
            with check (nivel_clasificacion <= core.clasificacion_max())
    $f$, tabla);

    execute format('drop policy if exists p_delete on core.%I', tabla);
    execute format($f$
        create policy p_delete on core.%I as permissive for delete
            to public
            using (core.clasificacion_max() >= 3
                   and nivel_clasificacion <= core.clasificacion_max())
    $f$, tabla);

    execute format('drop policy if exists p_anulados on core.%I', tabla);
    execute format($f$
        create policy p_anulados on core.%I as permissive for select
            to public
            using (
                anulado_en is not null
                and nivel_clasificacion <= core.clasificacion_max()
                and current_setting('app.ver_anulados', true) = 'on'
            )
    $f$, tabla);

    execute format('drop policy if exists r_rol_insert on core.%I', tabla);
    execute format($f$
        create policy r_rol_insert on core.%I as restrictive for insert
            to public with check (core.puede_crear())
    $f$, tabla);

    execute format('drop policy if exists r_rol_update on core.%I', tabla);
    execute format($f$
        create policy r_rol_update on core.%I as restrictive for update
            to public with check (core.puede_editar())
    $f$, tabla);

    execute format('drop policy if exists r_rol_delete on core.%I', tabla);
    execute format($f$
        create policy r_rol_delete on core.%I as restrictive for delete
            to public using (core.puede_eliminar())
    $f$, tabla);
end $$;

-- -----------------------------------------------------------------------------
-- 5 · Privilegios (avisa_api hereda de avisa_app)
-- -----------------------------------------------------------------------------
do $$ begin
    if exists (select 1 from pg_roles where rolname = 'avisa_app') then
        execute 'grant select, insert, update, delete on core.sugerencia to avisa_app';
        execute 'grant select on core.cat_estados_sugerencia to avisa_app';
        execute 'grant select on core.cat_tipos_sugerencia to avisa_app';
    else
        raise notice 'rol avisa_app ausente: no se otorgaron privilegios';
    end if;
    if exists (select 1 from pg_roles where rolname = 'avisa_api') then
        execute 'grant select, insert, update, delete on core.sugerencia to avisa_api';
        execute 'grant select on core.cat_estados_sugerencia to avisa_api';
        execute 'grant select on core.cat_tipos_sugerencia to avisa_api';
    end if;
end $$;

-- -----------------------------------------------------------------------------
-- 6 · Registro de la migración
-- -----------------------------------------------------------------------------
insert into core.migracion_log (clave) values ('57_sugerencias_2026_11_24')
on conflict (clave) do nothing;

commit;

-- ============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
-- ============================================================================
--
-- begin;
-- delete from core.migracion_log where clave = '57_sugerencias_2026_11_24';
-- drop table if exists core.sugerencia;
-- drop table if exists core.cat_tipos_sugerencia;
-- drop table if exists core.cat_estados_sugerencia;
-- commit;
