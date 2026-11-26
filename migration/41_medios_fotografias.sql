-- =============================================================================
--  41 · Medios y galería fotográfica
--
--  Fecha: 2026-11-23
--
--  Por qué existe esta migración
--  -----------------------------
--  El directorio necesita **más de una fotografía por entidad** (personas,
--  organizaciones, locales) y la ficha del caso puede reunir evidencias
--  gráficas. Hasta hoy cada tabla guardaba, como mucho, una URL suelta
--  (`core.locales.foto_url`, `core.documentos.url_foto`), lo que impide:
--
--    · una galería ordenada por entidad;
--    · declarar cuál es la foto principal;
--    · registrar pie de foto, crédito y texto alternativo (accesibilidad);
--    · separar la foto de la persona de sus datos personales cifrados.
--
--  La solución es **una sola tabla de medios** (`core.medios`) con una clave
--  polimórfica (`entidad_tipo`, `entidad_id`). No se crean tablas por tipo de
--  entidad: la pantalla de galería es la misma para todas.
--
--  Decisión de diseño: `entidad_id` es texto
--  ------------------------------------------
--  Los actores y documentos usan UUID; los locales y las organizaciones pueden
--  usar códigos o enteros. Guardar el identificador como texto permite una sola
--  tabla sin convertir claves. La integridad referencial queda **del lado de la
--  aplicación**: el endpoint valida el tipo y quien escribe conoce la entidad.
--  Se documenta aquí para que nadie suponga una FK que no existe.
--
--  Qué cambia
--  ----------
--  1 · Tabla `core.medios`.
--  2 · Índice único parcial: como máximo **una foto principal vigente** por
--      entidad.
--  3 · RLS y políticas equivalentes a las del resto de `core` (PARCHE 16).
--  4 · Permisos para `avisa_app` (de quien hereda `avisa_api`).
--
--  Qué NO cambia
--  -------------
--  · No se toca `core.locales.foto_url` ni `core.documentos.url_foto`: siguen
--    siendo la foto «de portada» heredada. La galería nueva convive con ellas.
--  · No se cargan fotos: la regla del proyecto es que el dato ausente se
--    declara. La tabla nace vacía y la UI muestra «Sin fotografías».
--
--  Cómo revertir
--  -------------
--  Bloque comentado al final. Al no haber datos sembrados, revertir no pierde
--  nada salvo las fotos que se hayan cargado después.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Tabla de medios
-- -----------------------------------------------------------------------------
create table if not exists core.medios (
    id                  uuid        primary key default gen_random_uuid(),

    -- Clave polimórfica. `organizacion` se mantiene separada de `actor`
    -- porque la pantalla de organizaciones no siempre es un actor.
    entidad_tipo        varchar(24) not null
        check (entidad_tipo in (
            'actor', 'organizacion', 'local', 'caso', 'documento', 'reunion'
        )),
    entidad_id          text        not null,

    -- Papel dentro de la galería. `principal` es la que se muestra en la tabla;
    -- `galeria` son las adicionales; `adjunto` y `evidencia` quedan para
    -- documentos y expedientes.
    rol                 varchar(12) not null default 'galeria'
        check (rol in ('principal', 'galeria', 'adjunto', 'evidencia')),

    titulo              varchar(160),
    descripcion         text,
    url                 text        not null,
    mime                varchar(100) not null default 'image/jpeg',
    ancho               integer     check (ancho is null or ancho > 0),
    alto                integer     check (alto is null or alto > 0),
    bytes               bigint      check (bytes is null or bytes >= 0),
    orden               smallint    not null default 0,
    es_principal        boolean     not null default false,

    -- Accesibilidad y trazabilidad de la imagen.
    alt                 varchar(240),
    credito             varchar(160),
    fuente              varchar(20) not null default 'MANUAL'
        check (fuente in (
            'MANUAL', 'CARGA', 'WORKFLOW', 'AVISA_HISTORICO', 'WHATSAPP', 'KAG'
        )),

    -- Consentimiento y base legal: una foto de una persona es dato personal
    -- (Ley 29733). La fecha es opcional porque puede no haberse registrado;
    -- la UI debe decir «sin dato» en vez de suponer que existe.
    consentimiento_fecha date,
    base_legal          varchar(120),

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

comment on table core.medios is
    'Galería de medios por entidad (persona, organización, local, caso, '
    'documento o reunión). Una entidad puede tener varias fotos; la principal '
    'se marca con es_principal. La clave es polimórfica: la integridad la '
    'valida la aplicación, no una FK.';

comment on column core.medios.entidad_tipo is
    'Tipo de entidad dueña del medio. No es una FK: el endpoint valida el valor.';

comment on column core.medios.entidad_id is
    'Identificador de la entidad en texto (UUID, código o entero).';

comment on column core.medios.rol is
    'principal | galeria | adjunto | evidencia. Ordena el uso en la interfaz.';

comment on column core.medios.es_principal is
    'Foto que se muestra en la tabla y en la cabecera. Hay un único índice '
    'parcial que impide dos principales vigentes por entidad.';

comment on column core.medios.url is
    'URL o ruta del archivo. No se guardan binarios en la base.';

comment on column core.medios.alt is
    'Texto alternativo para lectores de pantalla. Si falta, la UI usa el título.';

comment on column core.medios.consentimiento_fecha is
    'Fecha del consentimiento para publicar la imagen. NULL = sin dato; no se '
    'estima.';

comment on column core.medios.nivel_clasificacion is
    'Nivel de acceso de la imagen (1 público … 3 restringido). Se aplica con '
    'la misma RLS que el resto de core.';

-- Una sola foto principal vigente por entidad.
create unique index if not exists medios_principal_unico
    on core.medios (entidad_tipo, entidad_id)
    where es_principal and anulado_en is null;

create index if not exists medios_entidad_idx
    on core.medios (entidad_tipo, entidad_id, orden);

create index if not exists medios_vigentes_idx
    on core.medios (entidad_tipo, entidad_id)
    where anulado_en is null;

-- -----------------------------------------------------------------------------
-- 2 · RLS (mismo contrato que PARCHE 16)
-- -----------------------------------------------------------------------------
alter table core.medios enable row level security;
alter table core.medios force row level security;

drop policy if exists p_clasificacion on core.medios;
create policy p_clasificacion on core.medios as permissive for select
    to public
    using (anulado_en is null
           and nivel_clasificacion <= core.clasificacion_max());

drop policy if exists p_insert on core.medios;
create policy p_insert on core.medios as permissive for insert
    to public
    with check (core.clasificacion_max() >= 2
                and nivel_clasificacion <= core.clasificacion_max());

drop policy if exists p_update on core.medios;
create policy p_update on core.medios as permissive for update
    to public
    using (core.clasificacion_max() >= 2
           and nivel_clasificacion <= core.clasificacion_max())
    with check (nivel_clasificacion <= core.clasificacion_max());

drop policy if exists p_delete on core.medios;
create policy p_delete on core.medios as permissive for delete
    to public
    using (core.clasificacion_max() >= 3
           and nivel_clasificacion <= core.clasificacion_max());

-- La papelera de medios sigue el mismo patrón que compromisos y documentos:
-- invisible por defecto y visible sólo con `app.ver_anulados = 'on'`.
drop policy if exists p_anulados on core.medios;
create policy p_anulados on core.medios as permissive for select
    to public
    using (
        anulado_en is not null
        and nivel_clasificacion <= core.clasificacion_max()
        and current_setting('app.ver_anulados', true) = 'on'
    );

drop policy if exists r_rol_insert on core.medios;
create policy r_rol_insert on core.medios as restrictive for insert
    to public with check (core.puede_crear());

drop policy if exists r_rol_update on core.medios;
create policy r_rol_update on core.medios as restrictive for update
    to public with check (core.puede_editar());

-- -----------------------------------------------------------------------------
-- 3 · Privilegios
-- -----------------------------------------------------------------------------
do $$ begin
    if exists (select 1 from pg_roles where rolname = 'avisa_app') then
        execute 'grant select, insert, update, delete on core.medios to avisa_app';
    else
        raise notice 'rol avisa_app ausente: no se otorgaron privilegios sobre core.medios';
    end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4 · Registro de la migración
-- -----------------------------------------------------------------------------
insert into core.migracion_log (clave) values ('41_medios_fotografias')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
-- =============================================================================
--
-- begin;
-- drop policy if exists p_clasificacion on core.medios;
-- drop policy if exists p_insert on core.medios;
-- drop policy if exists p_update on core.medios;
-- drop policy if exists p_delete on core.medios;
-- drop policy if exists p_anulados on core.medios;
-- drop policy if exists r_rol_insert on core.medios;
-- drop policy if exists r_rol_update on core.medios;
-- drop table if exists core.medios;
-- delete from core.migracion_log where clave = '41_medios_fotografias';
-- commit;
