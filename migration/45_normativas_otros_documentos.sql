-- =============================================================================
--  45 · Normativas y otros documentos
--
--  Fecha: 2026-11-24
--
--  Por qué existe esta migración
--  -----------------------------
--  El árbol del RAG debía «incluir todo y las normativas», pero hasta hoy sólo
--  existía `core.documentos` (documentos de caso, alerta, reunión o resultado)
--  y la rama «Normativas» se declaraba sin dato porque no había tabla. Faltaba
--  además un cajón explícito para documentos que no encajan en el catálogo de
--  tipos ni son marco normativo.
--
--  Qué cambia
--  ----------
--  1 · Tabla `core.normativas`: marco normativo con ámbito, entidad emisora y
--      fecha de publicación.
--  2 · Tabla `core.otros_documentos`: documentos sueltos fuera del expediente
--      del caso (estudios, comunicados, material de capacitación, etc.).
--  3 · RLS forzada y políticas equivalentes a `core.documentos`.
--  4 · Privilegios para `avisa_app` (de quien hereda `avisa_api`).
--
--  Qué NO cambia
--  -------------
--  · No se toca `core.documentos` ni su catálogo de tipos.
--  · No se mueven filas: los 3 documentos de tipo «Otro (sin clasificar)» que
--    ya existen siguen en `core.documentos`.
--  · No se siembran normativas: no hay fuente cargada. La regla del proyecto
--    es declarar el vacío, no inventarlo.
--
--  Cómo revertir
--  -------------
--  Bloque comentado al final. Al nacer vacías, revertir no pierde datos.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Normativas
-- -----------------------------------------------------------------------------
create table if not exists core.normativas (
    id                  uuid        primary key default gen_random_uuid(),

    codigo              varchar(60) unique,
    titulo              varchar(255) not null,

    -- Tipo de norma: se mantiene como texto con catálogo cerrado por CHECK
    -- para no crear un catálogo nuevo por una lista corta y estable.
    tipo_norma          varchar(40) not null default 'Otra'
        check (tipo_norma in (
            'Ley', 'Ley Orgánica', 'Decreto Supremo', 'Decreto Legislativo',
            'Decreto de Urgencia', 'Resolución Ministerial',
            'Resolución Directoral', 'Resolución Jefatural', 'Ordenanza',
            'Acuerdo', 'Directiva', 'Convenio', 'Otra'
        )),

    ambito              varchar(20) not null default 'nacional'
        check (ambito in ('nacional', 'regional', 'local', 'sectorial')),

    entidad_emisora     varchar(200),
    fecha_publicacion   date,
    url                 varchar(500),
    resumen             text,

    origen_dato         varchar(20) not null default 'MANUAL'
        check (origen_dato in (
            'MANUAL', 'KAG', 'WORKFLOW', 'AVISA_HISTORICO', 'WHATSAPP'
        )),

    nivel_clasificacion smallint    not null default 1
        references core.cat_clasificacion (nivel),

    anulado_en          timestamptz,
    motivo_anulacion    text,
    anulado_por         uuid        references core.usuarios (id),
    anulacion_id        uuid,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    created_by          uuid        references core.usuarios (id),
    updated_by          uuid        references core.usuarios (id)
);

comment on table core.normativas is
    'Marco normativo para el árbol del RAG. Incluye leyes, decretos, '
    'resoluciones, ordenanzas y convenios, con ámbito y entidad emisora.';

comment on column core.normativas.tipo_norma is
    'Tipo de norma. Lista corta y estable: se valida con CHECK, no con catálogo.';

comment on column core.normativas.ambito is
    'nacional | regional | local | sectorial.';

comment on column core.normativas.nivel_clasificacion is
    'Nivel de acceso (1 público … 3 restringido). Por defecto 1: la normativa '
    'es pública.';

create index if not exists normativas_fecha_idx
    on core.normativas (fecha_publicacion desc nulls last);

create index if not exists normativas_ambito_idx
    on core.normativas (ambito, tipo_norma);

create index if not exists normativas_vigentes_idx
    on core.normativas (id)
    where anulado_en is null;

-- -----------------------------------------------------------------------------
-- 2 · Otros documentos
-- -----------------------------------------------------------------------------
create table if not exists core.otros_documentos (
    id                  uuid        primary key default gen_random_uuid(),

    codigo              varchar(60) unique,
    titulo              varchar(255) not null,

    -- Clasificación libre: este cajón no pertenece al catálogo de tipos de
    -- `core.documentos` y no debe forzarlos.
    tipo                varchar(80),
    fecha               date,
    entidad             varchar(200),
    url                 varchar(500),
    resumen             text,

    origen_dato         varchar(20) not null default 'MANUAL'
        check (origen_dato in (
            'MANUAL', 'KAG', 'WORKFLOW', 'AVISA_HISTORICO', 'WHATSAPP'
        )),

    nivel_clasificacion smallint    not null default 2
        references core.cat_clasificacion (nivel),

    anulado_en          timestamptz,
    motivo_anulacion    text,
    anulado_por         uuid        references core.usuarios (id),
    anulacion_id        uuid,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    created_by          uuid        references core.usuarios (id),
    updated_by          uuid        references core.usuarios (id)
);

comment on table core.otros_documentos is
    'Documentos sueltos que no son normativa ni forman parte del expediente de '
    'un caso. Alimentan la rama «Otros documentos» del árbol del RAG.';

comment on column core.otros_documentos.tipo is
    'Tipo libre (estudio, comunicado, material de capacitación…). No usa el '
    'catálogo de tipos documentales de core.documentos.';

create index if not exists otros_documentos_fecha_idx
    on core.otros_documentos (fecha desc nulls last);

create index if not exists otros_documentos_vigentes_idx
    on core.otros_documentos (id)
    where anulado_en is null;

-- -----------------------------------------------------------------------------
-- 3 · RLS y auditoría (mismo contrato que core.documentos)
-- -----------------------------------------------------------------------------
alter table core.normativas enable row level security;
alter table core.normativas force row level security;
alter table core.otros_documentos enable row level security;
alter table core.otros_documentos force row level security;

-- La auditoría de alta/edición reutiliza la función del resto de `core`.
drop trigger if exists trg_audit on core.normativas;
create trigger trg_audit before insert or update on core.normativas
    for each row execute function core.set_audit();

drop trigger if exists trg_audit on core.otros_documentos;
create trigger trg_audit before insert or update on core.otros_documentos
    for each row execute function core.set_audit();

do $$
declare
    tabla text;
begin
    foreach tabla in array array['normativas', 'otros_documentos'] loop
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
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4 · Privilegios
-- -----------------------------------------------------------------------------
do $$ begin
    if exists (select 1 from pg_roles where rolname = 'avisa_app') then
        execute 'grant select, insert, update, delete on core.normativas to avisa_app';
        execute 'grant select, insert, update, delete on core.otros_documentos to avisa_app';
    else
        raise notice 'rol avisa_app ausente: no se otorgaron privilegios';
    end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5 · Registro de la migración
-- -----------------------------------------------------------------------------
insert into core.migracion_log (clave) values ('45_normativas_otros_documentos')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
-- =============================================================================
--
-- begin;
-- drop table if exists core.normativas;
-- drop table if exists core.otros_documentos;
-- delete from core.migracion_log where clave = '45_normativas_otros_documentos';
-- commit;
