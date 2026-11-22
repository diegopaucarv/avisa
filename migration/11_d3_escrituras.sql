-- =============================================================================
--  D3 · Escrituras y auditoría (migración revisada, no destructiva)
--
--  1. audit.cambios: bitácora genérica de altas, cambios y bajas. La escribe la
--     aplicación en la misma transacción que el cambio; si el cambio falla, la
--     auditoría también revierte.
--  2. core.compromisos.fecha_vencimiento: vencimiento manual. Si es NULL, la
--     API lo deriva del próximo hito no terminal.
--
--  Aplicación:
--    docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--      < migration/11_d3_escrituras.sql
-- =============================================================================

create table if not exists audit.cambios (
    id uuid primary key default gen_random_uuid(),
    tabla text not null,
    registro_id text not null,
    accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
    usuario_id uuid,
    rol_codigo text,
    datos_antes jsonb,
    datos_despues jsonb,
    created_at timestamptz not null default now()
);

comment on table audit.cambios is
    'D3: bitácora genérica de escrituras. La aplicación la escribe en la misma transacción del cambio.';
comment on column audit.cambios.datos_antes is
    'Estado previo de la fila (sólo UPDATE/DELETE). No debe contener PII descifrada.';
comment on column audit.cambios.datos_despues is
    'Estado posterior de la fila (sólo INSERT/UPDATE). No debe contener PII descifrada.';

create index if not exists cambios_tabla_registro_idx
    on audit.cambios (tabla, registro_id, created_at desc);
create index if not exists cambios_usuario_idx
    on audit.cambios (usuario_id, created_at desc);

grant usage on schema audit to avisa_app;
grant select, insert on audit.cambios to avisa_app;

alter table core.compromisos
    add column if not exists fecha_vencimiento date;

comment on column core.compromisos.fecha_vencimiento is
    'D3: vencimiento manual del compromiso. Si es NULL, se deriva del próximo hito no terminal.';
