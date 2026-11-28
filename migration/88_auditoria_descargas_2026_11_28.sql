-- ============================================================================
-- AVISA — Migración aditiva 88: bitácora de descargas de datos
--
-- Fecha: 2026-11-28
--
-- POR QUÉ EXISTE
--   Hasta hoy sólo se auditaban las escrituras (`audit.cambios` y
--   `audit.datos_personales_acceso`). Una exportación también saca datos de la
--   base, pero no dejaba rastro de quién la pidió, de qué entidad, con qué
--   filtros ni de cuántas filas se llevó (ítems 42/43, pendiente histórico).
--
-- QUÉ CREA
--   `audit.descargas`: una fila por descarga, con la sesión que la pidió, la
--   entidad, el formato, los filtros aplicados y el número de filas, más la IP
--   y el `user_agent` de la petición.
--
-- PATRÓN DE AUDITORÍA
--   Repite el de `audit.datos_personales_acceso`: RLS habilitada y forzada, con
--   `p_audit_insert` (`WITH CHECK true`) y `p_audit_lectura`
--   (`USING core.puede_auditar()`). No hay políticas de UPDATE ni DELETE: la
--   bitácora no se corrige, se amplía con una fila nueva. `core.puede_auditar()`
--   ya existe en el esquema desde el parche 14 y lee `app.rol_codigo`.
--
-- ES ADITIVA
--   Sólo crea la tabla, sus índices y sus políticas; no modifica datos ni
--   objetos existentes. Puede quitarse con `drop table` sin migración de vuelta.
--   La aplicación tolera que la tabla no exista todavía (migración sin aplicar):
--   el helper `lib/db/auditoria-descargas.ts` deja un aviso y sigue con la
--   descarga, porque la auditoría no puede tumbar una exportación.
-- ============================================================================

begin;

create table if not exists audit.descargas (
    id uuid primary key default gen_random_uuid(),
    ocurrido_en timestamptz not null default now(),
    usuario_id uuid,
    usuario_nombre text,
    usuario_rol text,
    entidad text not null,
    formato text,
    filtros jsonb default '{}'::jsonb,
    filas integer,
    ip text,
    user_agent text
);

comment on table audit.descargas is
    'Bitácora de descargas de datos: quién pidió cada exportación, de qué entidad y formato, con qué filtros y cuántas filas se entregaron. No se corrige, se amplía con una fila nueva.';

comment on column audit.descargas.id is
    'Identificador interno del evento de descarga.';

comment on column audit.descargas.ocurrido_en is
    'Momento en que se registró la descarga.';

comment on column audit.descargas.usuario_id is
    'Usuario autenticado que pidió la descarga; nulo si la sesión no traía un identificador utilizable.';

comment on column audit.descargas.usuario_nombre is
    'Nombre legible del usuario al momento de la descarga; se conserva aunque después cambie.';

comment on column audit.descargas.usuario_rol is
    'Código del rol con el que se hizo la descarga.';

comment on column audit.descargas.entidad is
    'Entidad exportada: casos, alertas, anexo-14, anexo-15, anexos, analisis-caso, clima-social o base para el respaldo completo.';

comment on column audit.descargas.formato is
    'Formato entregado: csv, xlsx, pdf, html, json o texto.';

comment on column audit.descargas.filtros is
    'Parámetros de consulta aplicados a la exportación. Nunca incluye cookies ni tokens.';

comment on column audit.descargas.filas is
    'Cantidad de filas entregadas; nulo cuando el formato no permitía contarlas sin consumir el cuerpo.';

comment on column audit.descargas.ip is
    'IP de origen de la petición (x-forwarded-for o x-real-ip).';

comment on column audit.descargas.user_agent is
    'Cabecera User-Agent de la petición.';

-- Los accesos esperables: la lista más reciente, las descargas de una persona y
-- las de una entidad concreta.
create index if not exists ix_audit_descargas_ocurrido_en
    on audit.descargas (ocurrido_en desc);
create index if not exists ix_audit_descargas_usuario
    on audit.descargas (usuario_id);
create index if not exists ix_audit_descargas_entidad
    on audit.descargas (entidad);

alter table audit.descargas enable row level security;
alter table audit.descargas force row level security;

-- Se recrean las políticas para que la migración sea re-ejecutable.
drop policy if exists p_audit_insert on audit.descargas;
create policy p_audit_insert on audit.descargas
    for insert with check (true);

drop policy if exists p_audit_lectura on audit.descargas;
create policy p_audit_lectura on audit.descargas
    for select using (core.puede_auditar());

-- Sin política de UPDATE ni de DELETE: con RLS activa, la ausencia de política
-- cierra esas operaciones para todos.
grant select, insert on audit.descargas to avisa_app;

insert into core.migracion_log (clave)
values ('88_auditoria_descargas_2026_11_28')
on conflict (clave) do nothing;

commit;

-- Verificación (sólo lectura)
--   select count(*) from audit.descargas;
--   select polname, cmd from pg_policies
--    where schemaname = 'audit' and tablename = 'descargas';
