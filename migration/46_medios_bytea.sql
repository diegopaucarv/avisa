-- =============================================================================
--  46 · Medios: copia de los bytes en la base (bytea) como respaldo servible
--
--  Fecha: 2026-11-23
--
--  Por qué existe esta migración
--  -----------------------------
--  Las 142 fotografías del directorio viven hoy en tres copias, de las cuales
--  sólo una es fuente:
--
--    · `angular/public/medios/`              — fuente de verdad, **untracked**;
--    · `angular/dist/avisa/browser/medios/`  — artefacto del build de Angular;
--    · `public/medios/`                      — lo arma `scripts/copiar-spa.mjs`
--                                              desde `dist` para que Next lo
--                                              sirva en producción.
--
--  Un clon limpio o un CI no tendrá la primera, y sin ella el build tampoco
--  produce la segunda. La 44 sólo siembra la `url` (`/medios/...`), de modo que
--  en producción las fotos saldrían rotas. Se añade, por tanto, una copia de
--  los bytes en `core.medios.contenido` para que el endpoint
--  `GET /api/v1/media/<id>/contenido` pueda servirlas desde la base.
--
--  Excepción aprobada al criterio de la 41
--  ---------------------------------------
--  La 41 documentó expresamente «No se guardan binarios en la base» y la 44
--  respetó esa regla. Esta migración la **exceptúa de forma deliberada y
--  aprobada** para estas fotografías: se guardan los bytes como respaldo
--  servible. La excepción queda escrita aquí y en el `COMMENT` de
--  `core.medios.contenido`, no se oculta.
--
--  El archivo estático se **conserva**: `angular/public/medios/` sigue siendo
--  la fuente y `public/medios/` el artefacto de producción. La base es la
--  segunda copia, no la única. Nada en esta migración borra ni mueve archivos.
--
--  Qué cambia
--  ----------
--  1 · Cuatro columnas nuevas en `core.medios`: `contenido`, `content_type`,
--      `hash` y `cargado_en`. Todas admiten NULL: una fila sin bytes cargados
--      es un dato ausente declarado, no un error.
--  2 · Índice sobre `hash` para la carga idempotente y la detección de
--      duplicados.
--  3 · Comentarios de columna, con la constancia de la excepción.
--
--  Qué NO cambia
--  -------------
--  · No se toca `url`. La reescritura a `/api/v1/media/<id>/contenido` es
--    opt-in y la hace, si se pide, `scripts/cargar-medios-neon.mjs`.
--  · No se tocan RLS, políticas ni privilegios: el `GRANT` de la 41 es de
--    tabla y cubre las columnas nuevas.
--  · No se tocan `mime`, `bytes` ni la semilla de la 44.
--
--  Reglas: ADITIVA, IDEMPOTENTE, PostgreSQL 16+, esquema `core`.
--
--  Cómo revertir
--  -------------
--  Bloque comentado al final. Ojo: en un clon limpio `contenido` puede ser la
--  única copia servible; revertir sin haber republicado los archivos estáticos
--  deja las fotos rotas.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Columnas de contenido
-- -----------------------------------------------------------------------------
alter table core.medios
    add column if not exists contenido    bytea,
    add column if not exists content_type text,
    add column if not exists hash         text,
    add column if not exists cargado_en   timestamptz;

comment on column core.medios.contenido is
    'Bytes de la imagen almacenados en la base. Es una EXCEPCIÓN APROBADA al '
    'criterio «no se guardan binarios en la base» de la migración 41: sirve '
    'como respaldo servible porque el archivo estático (angular/public/medios, '
    'untracked en git) no llega a un clon limpio ni a producción. El archivo '
    'estático se conserva como respaldo. NULL = aún no cargado; no se estima.';

comment on column core.medios.content_type is
    'Tipo MIME de `contenido` (p. ej. image/jpeg), deducido de la extensión al '
    'cargar con scripts/cargar-medios-neon.mjs. NULL si no se ha cargado.';

comment on column core.medios.hash is
    'sha256 hexadecimal de `contenido`. Es la guarda de idempotencia de la '
    'carga (si coincide, no se reescribe) y el ETag estable que expone el '
    'endpoint de contenido. NULL si no se ha cargado.';

comment on column core.medios.cargado_en is
    'Momento en que se guardaron los bytes en la base. NULL si aún no se cargó.';

-- -----------------------------------------------------------------------------
-- 2 · Índice por huella
-- -----------------------------------------------------------------------------
create index if not exists medios_hash_idx
    on core.medios (hash);

comment on index core.medios_hash_idx is
    'Búsqueda por huella sha256: evita recargar el mismo binario, permite '
    'detectar duplicados entre filas y respalda el ETag del endpoint.';

-- -----------------------------------------------------------------------------
-- 3 · Registro de la migración
-- -----------------------------------------------------------------------------
insert into core.migracion_log (clave) values ('46_medios_bytea')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
-- =============================================================================
--  Sólo si los archivos estáticos están republicados: si no, las fotos de
--  producción quedarán rotas al perder la única copia servible.
--
-- begin;
-- drop index if exists core.medios_hash_idx;
-- alter table core.medios
--     drop column if exists contenido,
--     drop column if exists content_type,
--     drop column if exists hash,
--     drop column if exists cargado_en;
-- delete from core.migracion_log where clave = '46_medios_bytea';
-- commit;
