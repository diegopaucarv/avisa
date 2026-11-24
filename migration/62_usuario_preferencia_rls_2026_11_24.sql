-- ============================================================================
-- AVISA — Migración aditiva 62: RLS de core.usuario_preferencia
--
-- POR QUÉ EXISTE
--   La migración 49 creó `core.usuario_preferencia` (clave-valor por usuario)
--   pero no le puso RLS. El endpoint `GET/PATCH /api/v1/preferences` filtra por
--   `usuario_id` en cada consulta, y eso basta mientras nadie escriba otra
--   consulta; con RLS, la base es la que impide leer o escribir las
--   preferencias de otra persona, aunque una consulta futura olvide el
--   `where`.
--
-- QUÉ CAMBIA
--   · Activa RLS y FORCE RLS (el dueño no tiene privilegio implícito; sigue
--     viendo todo porque `neondb_owner` tiene BYPASSRLS, que es lo que usan los
--     mantenimientos).
--   · Una política por comando. Las cuatro comparan `usuario_id` con
--     `current_setting('app.usuario_id', true)`, el GUC que fija
--     `withSession()` en cada transacción de la API.
--   · Regrant explícito de SELECT/INSERT/UPDATE/DELETE a `avisa_app`
--     (`avisa_api` hereda de ese rol); ya existían, se dejan declarados.
--
-- CONTRATO DE FALLA
--   Si el GUC no está fijado, `current_setting(..., true)` devuelve NULL y la
--   comparación es NULL: no se ve ninguna fila y no se puede insertar. Un
--   proceso que use `avisa_app` fuera de la API deja de ver preferencias en
--   lugar de verlas todas. Es el mismo criterio que `core.usuarios`.
--
-- QUÉ NO CAMBIA
--   · No toca datos, ni la PK `(usuario_id, clave)`, ni la FK a `core.usuarios`.
--   · No cambia `core.configuracion` (configuración global, no personal).
--
-- CÓMO REVERTIR
--   begin;
--   drop policy if exists p62_pref_sel on core.usuario_preferencia;
--   drop policy if exists p62_pref_ins on core.usuario_preferencia;
--   drop policy if exists p62_pref_upd on core.usuario_preferencia;
--   drop policy if exists p62_pref_del on core.usuario_preferencia;
--   alter table core.usuario_preferencia no force row level security;
--   alter table core.usuario_preferencia disable row level security;
--   delete from core.migracion_log
--    where clave = '62_usuario_preferencia_rls_2026_11_24';
--   commit;
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1 · RLS
-- ---------------------------------------------------------------------------
alter table core.usuario_preferencia enable row level security;
alter table core.usuario_preferencia force row level security;

-- ---------------------------------------------------------------------------
-- 2 · Políticas: cada usuario sólo ve y escribe lo suyo
-- ---------------------------------------------------------------------------
drop policy if exists p62_pref_sel on core.usuario_preferencia;
create policy p62_pref_sel on core.usuario_preferencia
    as permissive for select
    to public
    using (usuario_id::text = current_setting('app.usuario_id', true));

drop policy if exists p62_pref_ins on core.usuario_preferencia;
create policy p62_pref_ins on core.usuario_preferencia
    as permissive for insert
    to public
    with check (usuario_id::text = current_setting('app.usuario_id', true));

drop policy if exists p62_pref_upd on core.usuario_preferencia;
create policy p62_pref_upd on core.usuario_preferencia
    as permissive for update
    to public
    using (usuario_id::text = current_setting('app.usuario_id', true))
    with check (usuario_id::text = current_setting('app.usuario_id', true));

drop policy if exists p62_pref_del on core.usuario_preferencia;
create policy p62_pref_del on core.usuario_preferencia
    as permissive for delete
    to public
    using (usuario_id::text = current_setting('app.usuario_id', true));

comment on policy p62_pref_sel on core.usuario_preferencia is
    'Cada sesión lee sólo sus preferencias (app.usuario_id).';
comment on policy p62_pref_ins on core.usuario_preferencia is
    'Sólo se pueden crear preferencias para el usuario de la sesión.';
comment on policy p62_pref_upd on core.usuario_preferencia is
    'Sólo se pueden editar las preferencias propias.';
comment on policy p62_pref_del on core.usuario_preferencia is
    'Sólo se pueden borrar las preferencias propias.';

-- ---------------------------------------------------------------------------
-- 3 · Privilegios (avisa_api hereda de avisa_app)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on core.usuario_preferencia to avisa_app;

-- ---------------------------------------------------------------------------
-- 4 · Registro de la migración
-- ---------------------------------------------------------------------------
insert into core.migracion_log (clave)
values ('62_usuario_preferencia_rls_2026_11_24')
on conflict (clave) do nothing;

commit;
