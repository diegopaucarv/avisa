-- =============================================================================
--  56 · Triaje de la bandeja RED-RADAR
--
--  Fecha: 2026-11-24
--
--  Por qué existe esta migración
--  -----------------------------
--  El mockup «bandeja-red-radar» (item 76, Anexo 03) exige que cada señal de la
--  cola tenga un ESTADO DE TRIAJE persistido y que el descarte y la marca de
--  duplicada lleven MOTIVO obligatorio. La base sólo tiene
--  `core.alertas_tempranas`: no hay tabla de señales, ni estado de triaje, ni
--  columna de motivo. Sin persistencia, la bandeja no puede guardar ninguna
--  decisión y el triaje sería decorativo.
--
--  Qué cambia
--  ----------
--  1 · Tabla `core.alerta_triaje`: una fila por alerta temprana triada, con
--      estado, motivo, alerta duplicada de referencia y rastro de quién y
--      cuándo trió.
--  2 · RLS forzada y políticas equivalentes a las tablas hermanas de `core`
--      (mismo contrato que `core.normativas` / `core.otros_documentos`).
--  3 · Trigger de auditoría `core.set_audit()` y privilegios para `avisa_app`.
--
--  Qué NO cambia
--  -------------
--  · No se añaden columnas a `core.alertas_tempranas` ni se mueven filas.
--  · No se siembran triajes: la tabla nace vacía. La regla del proyecto es
--    declarar el vacío, no inventarlo.
--
--  Cómo revertir
--  -------------
--  Bloque comentado al final. Al nacer vacía, revertir no pierde datos.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Tabla de triaje
-- -----------------------------------------------------------------------------
create table if not exists core.alerta_triaje (
    id                  uuid        primary key default gen_random_uuid(),

    -- Una sola decisión vigente por alerta: el triaje se rehace, no se acumula.
    alerta_id           uuid        not null unique
        references core.alertas_tempranas (id) on delete cascade,

    -- Estados del triaje de la cola RED-RADAR. «pendiente» es el estado
    -- implícito de toda alerta que aún no tiene fila aquí; se admite
    -- explícitamente para que «devolver a pendiente» sea una acción real.
    estado              varchar(20) not null default 'pendiente'
        check (estado in (
            'pendiente', 'en_triage', 'confirmada', 'descartada', 'duplicada'
        )),

    -- Obligatorio cuando se descarta o se marca duplicada (item 38).
    motivo              text,

    -- Alerta de la que ésta es duplicada; `null` mientras no se declare.
    duplicada_de        uuid        references core.alertas_tempranas (id)
        on delete set null,

    -- Copia del nivel de acceso de la alerta dueña, para que la RLS pueda
    -- decidir sin leer la tabla padre.
    nivel_clasificacion smallint    not null default 2
        references core.cat_clasificacion (nivel),

    triado_por          uuid        references core.usuarios (id),
    triado_en           timestamptz not null default now(),

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    created_by          uuid        references core.usuarios (id),
    updated_by          uuid        references core.usuarios (id),

    constraint alerta_triaje_motivo_obligatorio check (
        estado not in ('descartada', 'duplicada')
        or (motivo is not null and btrim(motivo) <> '')
    ),

    constraint alerta_triaje_no_autoduplicada check (
        duplicada_de is null or duplicada_de <> alerta_id
    )
);

comment on table core.alerta_triaje is
    'Estado de triaje de una alerta temprana en la bandeja RED-RADAR. Una fila '
    'por alerta; guarda la decisión (confirmada, descartada, duplicada…), su '
    'motivo obligatorio y quién la tomó.';

comment on column core.alerta_triaje.estado is
    'pendiente | en_triage | confirmada | descartada | duplicada. Una alerta sin '
    'fila aquí se trata como «pendiente» en la cola.';

comment on column core.alerta_triaje.motivo is
    'Motivo de la decisión. Obligatorio cuando el estado es «descartada» o '
    '«duplicada» (Anexo 03 · item 38).';

comment on column core.alerta_triaje.duplicada_de is
    'Alerta existente de la que ésta es duplicada. Sólo aplica al estado '
    '«duplicada»; la regla de deduplicación es manual.';

create index if not exists alerta_triaje_estado_idx
    on core.alerta_triaje (estado);

-- -----------------------------------------------------------------------------
-- 2 · RLS y auditoría (mismo contrato que core.normativas)
-- -----------------------------------------------------------------------------
alter table core.alerta_triaje enable row level security;
alter table core.alerta_triaje force row level security;

-- La auditoría de alta/edición reutiliza la función del resto de `core`.
-- Exige `created_at`, `created_by`, `updated_at` y `updated_by` (ya presentes).
drop trigger if exists trg_audit on core.alerta_triaje;
create trigger trg_audit before insert or update on core.alerta_triaje
    for each row execute function core.set_audit();

do $$
begin
    execute 'drop policy if exists p_clasificacion on core.alerta_triaje';
    execute $f$
        create policy p_clasificacion on core.alerta_triaje as permissive for select
            to public
            using (nivel_clasificacion <= core.clasificacion_max())
    $f$;

    execute 'drop policy if exists p_insert on core.alerta_triaje';
    execute $f$
        create policy p_insert on core.alerta_triaje as permissive for insert
            to public
            with check (core.clasificacion_max() >= 2
                        and nivel_clasificacion <= core.clasificacion_max())
    $f$;

    execute 'drop policy if exists p_update on core.alerta_triaje';
    execute $f$
        create policy p_update on core.alerta_triaje as permissive for update
            to public
            using (core.clasificacion_max() >= 2
                   and nivel_clasificacion <= core.clasificacion_max())
            with check (nivel_clasificacion <= core.clasificacion_max())
    $f$;

    execute 'drop policy if exists p_delete on core.alerta_triaje';
    execute $f$
        create policy p_delete on core.alerta_triaje as permissive for delete
            to public
            using (core.clasificacion_max() >= 3
                   and nivel_clasificacion <= core.clasificacion_max())
    $f$;

    execute 'drop policy if exists r_rol_insert on core.alerta_triaje';
    execute $f$
        create policy r_rol_insert on core.alerta_triaje as restrictive for insert
            to public with check (core.puede_crear())
    $f$;

    execute 'drop policy if exists r_rol_update on core.alerta_triaje';
    execute $f$
        create policy r_rol_update on core.alerta_triaje as restrictive for update
            to public with check (core.puede_editar())
    $f$;

    execute 'drop policy if exists r_rol_delete on core.alerta_triaje';
    execute $f$
        create policy r_rol_delete on core.alerta_triaje as restrictive for delete
            to public using (core.puede_eliminar())
    $f$;
end $$;

-- -----------------------------------------------------------------------------
-- 3 · Privilegios
-- -----------------------------------------------------------------------------
do $$ begin
    if exists (select 1 from pg_roles where rolname = 'avisa_app') then
        execute 'grant select, insert, update, delete on core.alerta_triaje to avisa_app';
    else
        raise notice 'rol avisa_app ausente: no se otorgaron privilegios';
    end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4 · Registro de la migración
-- -----------------------------------------------------------------------------
insert into core.migracion_log (clave) values ('56_red_radar_triaje_2026_11_24')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
-- =============================================================================
--
-- begin;
-- drop table if exists core.alerta_triaje;
-- delete from core.migracion_log where clave = '56_red_radar_triaje_2026_11_24';
-- commit;
