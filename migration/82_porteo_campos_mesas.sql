-- =============================================================================
-- 82 · Porteo de la ficha de mesas de diálogo a un satélite del caso
--
-- **APLICADA el 2026-11-27** (una transacción, con COMMIT; ver
-- docs/06_operacion/migraciones-neon-estado.md §2.1)
-- Fecha de diseño: 2026-11-27
-- Autor: agente de base de datos (análisis y DDL; sin ejecución)
--
-- ESTADO
-- ------
-- Este fichero se aplicó en Neon el 2026-11-27 con el rol propietario
-- (`neondb_owner`, BYPASSRLS) en una única transacción: `core.mesa_ficha`
-- existe con 21 fichas alineadas a los casos `MD-2026-0001..0021` y la clave
-- `82_porteo_campos_mesas_2026_11_27` está en `core.migracion_log`. Antes de
-- aplicarlo se hizo un ensayo con `ROLLBACK` que pasó con los mismos conteos.
-- Los datos de este fichero se contrastaron contra el catálogo real de Neon
-- (tipos, nulos, CHECKs y valores distintos), no contra supuestos.
--
-- Por qué
-- -------
-- La 81 creó un caso espejo por mesa y copió a `core.casos` la identidad mínima:
-- `nombre_caso`, `subsector_id`, `unidad_responsable_id`, `nivel_riesgo_id`,
-- `estado_id`, `fuente_original`, `region_principal_id` (sólo coincidencia
-- exacta), `codigo_legado` y `es_validado_humano`. Dejó fuera la ficha
-- institucional: instrumento, base legal, fechas de norma e instalación,
-- vigencia, objetivo, rol de PRODUCE, evidencia, documento de designación,
-- ámbito textual y sectorista.
--
-- `core.casos` no tiene ninguna columna JSONB ni un campo libre equivalente
-- (verificado: sus columnas son escalares). `descripcion_riesgo` y
-- `resumen_ejecutivo` describen el conflicto, no el instrumento que crea la
-- mesa; forzar ahí estos campos mezclaría dos dominios y perdería estructura.
-- De ahí la tabla satélite 1:1.
--
-- Decisión sobre los 62 integrantes de `core.mesa_miembros`
-- --------------------------------------------------------
-- Se quedan donde están: `core.mesa_miembros` sigue siendo la fuente de verdad y
-- `core.mesa_ficha` sólo referencia la mesa (`mesa_id`). Portarlos a
-- `core.casos_actores` exigiría actores sintéticos (`actor_id` es NOT NULL y FK a
-- `core.actores`, que exige `naturaleza`, `tipo_actor_id`, `rol_actor_id` y
-- `nivel_identificacion_id` NOT NULL): contaminaría el registro de actores y
-- perdería el vocabulario de la mesa y `valid_from`/`valid_to`. La ruta
-- caso → mesa_ficha.mesa_id → mesa_miembros.mesa_id ya deja los 62 integrantes
-- alcanzables desde el caso sin escribir una fila nueva.
--
-- Qué hace
-- --------
-- 1. Crea `core.mesa_ficha`: `caso_id` PK (1:1 con `core.casos`, borrado en
--    cascada) y `mesa_id` UNIQUE (1:1 con `core.mesas_dialogo`). Copia los
--    campos huérfanos con los MISMOS tipos y CHECKs que `core.mesas_dialogo`
--    (verificado en information_schema).
-- 2. Backfill idempotente desde `core.mesas_dialogo` para las 21 mesas con
--    `caso_id`. `on conflict do nothing` conserva lo que ya exista.
-- 3. RLS (enable + force), políticas espejo de `core.casos`, trigger
--    `core.set_audit()` y grants guardados por existencia de rol.
--
-- Qué NO hace
-- -----------
-- · No modifica `core.casos`, `core.mesas_dialogo`, `core.mesa_miembros`,
--   `core.casos_actores`, `core.actores` ni `core.documentos`.
-- · No crea vistas, así que la nota de `security_invoker` no aplica aquí; si
--   más adelante se expone `core.mesa_ficha` mediante una vista, debe crearse
--   con `security_invoker = true` para no saltarse la RLS de la tabla.
-- · No registra la designación ni la evidencia como `core.documentos`.
--
-- Alcance de la verdad (leer antes de tocar el modelo)
-- ---------------------------------------------------
-- La aplicación sigue leyendo `m.tipo_instrumento`, `m.objetivo`, etc.
-- directamente de `core.mesas_dialogo` (`lib/db/repos/mesas.ts`), y este
-- borrador no cambia código de la app. Por tanto `core.mesas_dialogo` sigue
-- siendo el sistema de registro de la mesa y `core.mesa_ficha` es una copia
-- derivada para consultas centradas en el caso. Consecuencia: si alguien edita
-- la mesa después del backfill, la ficha queda desactualizada. El backfill es
-- de una sola pasada (`on conflict do nothing`) para no pisar ediciones; al
-- final del fichero hay un bloque de RESINCRONIZACIÓN OPCIONAL y una nota de
-- consolidación futura. Mientras no se ejecute esa consolidación, trate
-- `mesa_ficha` como lectura, no como fuente de escritura.
--
-- Requisitos
-- ----------
-- · Migración 81 aplicada (`core.mesas_dialogo.caso_id` existe y las 21 mesas
--   tienen caso: verificado).
-- · Rol superusuario o BYPASSRLS: `core.mesas_dialogo` y `core.casos` tienen
--   FORCE ROW LEVEL SECURITY y, sin `app.rol_codigo`,
--   `core.clasificacion_max()` devuelve 0. El preflight aborta si no se cumple.
-- · Aplicar 82 DESPUÉS de 81 y, si algún día se revierte, revertir 82 ANTES
--   que 81.
--
-- Idempotente: `create table if not exists`, `on conflict do nothing`,
-- `drop policy/trigger if exists`, guards por rol y verificaciones de conteo.
-- Salvedad: si el `create table` ya encontró la tabla a medio crear, los
-- constraints con nombre no se re-añaden (PostgreSQL no tiene
-- `ADD CONSTRAINT IF NOT EXISTS`); en ese caso hay que revisar el catálogo.
-- =============================================================================

begin;

-- 0 · Preflight ---------------------------------------------------------------
-- Se comprueba todo lo que el DDL necesita para no fallar a mitad: privilegio
-- RLS, existencia de las columnas de origen, catálogos de destino y funciones
-- usadas por las políticas. Cada fallo dice exactamente qué falta.

do $preflight$
declare
  v_faltan      text;
  v_falta_cat   text;
  v_falta_fn    text;
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles
     where rolname = current_user
       and (rolsuper or rolbypassrls)
  ) then
    raise exception '82: el rol % no es superusuario ni tiene BYPASSRLS; FORCE ROW LEVEL SECURITY oculta core.mesas_dialogo y core.casos y el backfill quedaría vacío. Ejecute el borrador con el propietario BYPASSRLS.', current_user;
  end if;

  if to_regclass('core.mesas_dialogo') is null
     or to_regclass('core.casos') is null then
    raise exception '82: faltan core.mesas_dialogo o core.casos; revise el esquema';
  end if;

  -- Columnas de origen que este borrador copia. Si el esquema real no coincide,
  -- se aborta con la lista exacta en vez de fallar en mitad del INSERT.
  select string_agg(t.c, ', ' order by t.c)
    into v_faltan
    from unnest(array[
           'caso_id', 'tipo_espacio_id', 'linea_oaipcs', 'tipo_instrumento',
           'base_legal', 'fecha_norma', 'prorrogas_modificatorias',
           'fecha_instalacion', 'naturaleza', 'fecha_fin_vigencia',
           'estado_vigencia', 'objetivo', 'rol_produce', 'ambito_departamento',
           'doc_designacion', 'link_evidencia', 'sectorista_usuario_id',
           'tiene_norma', 'origen_dato', 'nivel_clasificacion'
         ]) as t(c)
   where not exists (
     select 1
       from information_schema.columns ic
      where ic.table_schema = 'core'
        and ic.table_name = 'mesas_dialogo'
        and ic.column_name = t.c
   );
  if v_faltan is not null then
    raise exception '82: faltan columnas en core.mesas_dialogo: %', v_faltan;
  end if;

  -- Catálogos referenciados por FK.
  select string_agg(t.c, ', ' order by t.c)
    into v_falta_cat
    from unnest(array[
           'core.cat_tipos_espacio_dialogo',
           'core.cat_clasificacion',
           'core.usuarios',
           'core.migracion_log'
         ]) as t(c)
   where to_regclass(t.c) is null;
  if v_falta_cat is not null then
    raise exception '82: faltan catálogos/tablas de destino: %', v_falta_cat;
  end if;

  -- Funciones que usan las políticas y el trigger de auditoría.
  select string_agg(t.c, ', ' order by t.c)
    into v_falta_fn
    from unnest(array[
           'core.clasificacion_max()',
           'core.puede_crear()',
           'core.puede_editar()',
           'core.puede_eliminar()',
           'core.set_audit()'
         ]) as t(c)
   where to_regprocedure(t.c) is null;
  if v_falta_fn is not null then
    raise exception '82: faltan funciones requeridas por RLS/auditoría: %', v_falta_fn;
  end if;
end $preflight$;

-- Guarda: la 81 debe haber dejado todas las mesas con caso. Si no, no se crea
-- una ficha sin caso al que colgar.
do $guardas$
declare
  v_total    bigint;
  v_con_caso bigint;
begin
  select count(*), count(caso_id)
    into v_total, v_con_caso
    from core.mesas_dialogo;

  if v_total = 0 then
    raise exception '82: core.mesas_dialogo está vacía; no hay nada que portar';
  end if;

  if v_con_caso <> v_total then
    raise exception '82: quedaron % de % mesas sin caso; complete la migración 81 antes de portar la ficha', v_total - v_con_caso, v_total;
  end if;
end $guardas$;

-- 1 · Tabla satélite 1:1 ------------------------------------------------------
-- `caso_id` es la PK: un caso espejo tiene como máximo una ficha y el borrado
-- del caso arrastra la ficha (`on delete cascade`), lo que hace segura la
-- reversión de la 81. `mesa_id` es UNIQUE: una mesa no puede volcar su ficha en
-- dos casos. Se guardan ambas claves aunque sean funcionalmente dependientes
-- (mesa → caso lo fija `mesas_dialogo.caso_id`): `caso_id` permite la lectura
-- centrada en el caso sin join y hereda el borrado en cascada del caso; el
-- guard final detecta cualquier desalineación entre ambas.
--
-- Tipos y CHECKs copiados literalmente de `core.mesas_dialogo`: `naturaleza`
-- (Permanente/Temporal/No definida) y `origen_dato` con su default
-- `AVISA_HISTORICO`. `estado_vigencia` NO lleva CHECK porque el catálogo real
-- trae valores fuera de la tríada clásica (`Sin fecha`, `Permanente` además de
-- `Vigente`/`Por vencer`/`Vencido`); un CHECK rompería el backfill.
--
-- `chk_mesa_ficha_vigencia` se validó contra los datos: 0 filas con
-- `fecha_fin_vigencia < fecha_instalacion`.

create table if not exists core.mesa_ficha (
    caso_id                     uuid        not null
        references core.casos(id) on delete cascade,
    mesa_id                     uuid        not null
        references core.mesas_dialogo(id) on delete cascade,
    tipo_espacio_id             smallint
        references core.cat_tipos_espacio_dialogo(id),
    linea_oaipcs                varchar(60),
    tipo_instrumento            varchar(80),
    base_legal                  varchar(150),
    fecha_norma                 date,
    prorrogas_modificatorias    text,
    fecha_instalacion           date,
    naturaleza                  varchar(30),
    fecha_fin_vigencia          date,
    estado_vigencia             varchar(30),
    objetivo                    text,
    rol_produce                 varchar(40),
    ambito_departamento         text,
    doc_designacion             text,
    link_evidencia              varchar(500),
    sectorista_usuario_id       uuid        references core.usuarios(id),
    tiene_norma                 boolean,
    origen_dato                 varchar(20) not null default 'AVISA_HISTORICO',
    nivel_clasificacion         smallint    not null default 2
        references core.cat_clasificacion(nivel),
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now(),
    created_by                  uuid        references core.usuarios(id),
    updated_by                  uuid        references core.usuarios(id),

    constraint mesa_ficha_pkey
        primary key (caso_id),
    constraint ux_mesa_ficha_mesa
        unique (mesa_id),
    constraint chk_mesa_ficha_naturaleza
        check (naturaleza is null
               or naturaleza in ('Permanente', 'Temporal', 'No definida')),
    constraint chk_mesa_ficha_origen_dato
        check (origen_dato in ('MANUAL', 'KAG', 'WORKFLOW',
                               'AVISA_HISTORICO', 'WHATSAPP')),
    constraint chk_mesa_ficha_vigencia
        check (fecha_fin_vigencia is null
               or fecha_instalacion is null
               or fecha_fin_vigencia >= fecha_instalacion)
);

-- Comentarios. Se documenta cada campo que no es obvio y por qué no vive en
-- `core.casos`; sin esto el satélite se vuelve opaco para el siguiente lector.

comment on table core.mesa_ficha is
    'Ficha institucional de una mesa de diálogo, 1:1 con su caso espejo (migración 81). Conserva los campos que core.casos no puede representar sin mezclar el expediente del conflicto con el instrumento de diálogo. Copia derivada de core.mesas_dialogo: la mesa sigue siendo el sistema de registro hasta la consolidación.';

comment on column core.mesa_ficha.caso_id is
    'Caso espejo de la mesa. PK y FK con borrado en cascada (permite revertir la 81 sin fichas huérfanas).';
comment on column core.mesa_ficha.mesa_id is
    'Mesa de origen. UNIQUE: una mesa sólo puede tener una ficha. Ruta caso → mesa → mesa_miembros.';
comment on column core.mesa_ficha.tipo_espacio_id is
    'Tipo de espacio de diálogo según core.cat_tipos_espacio_dialogo.';
comment on column core.mesa_ficha.linea_oaipcs is
    'Línea de trabajo OAIPCS a la que pertenece la mesa (texto de la carga histórica).';
comment on column core.mesa_ficha.tipo_instrumento is
    'Instrumento que crea o reconoce la mesa (ley, decreto, resolución, etc.). Texto original de la mesa.';
comment on column core.mesa_ficha.base_legal is
    'Base legal declarada por la mesa. No es una FK a core.normativas: ese registro es independiente y no cuelga del caso.';
comment on column core.mesa_ficha.fecha_norma is
    'Fecha de la norma que sustenta la mesa, distinta de fecha_instalacion y de la fecha de inicio del caso.';
comment on column core.mesa_ficha.prorrogas_modificatorias is
    'Texto libre con las prórrogas o modificaciones del instrumento. Sin estructura en el origen; no se inventa un modelo de vigencias.';
comment on column core.mesa_ficha.fecha_instalacion is
    'Fecha de instalación de la mesa. No se copia a core.casos.fecha_inicio: son hitos distintos.';
comment on column core.mesa_ficha.naturaleza is
    'Permanente · Temporal · No definida. Mismo CHECK que core.mesas_dialogo.';
comment on column core.mesa_ficha.fecha_fin_vigencia is
    'Fin de la vigencia del instrumento. No se copia a core.casos.fecha_cierre: el caso puede seguir abierto después de que la mesa venza.';
comment on column core.mesa_ficha.estado_vigencia is
    'Estado de vigencia de la mesa (Vigente, Por vencer, Vencido, Permanente, Sin fecha…). Sin CHECK: el origen no tiene vocabulario cerrado. No es core.casos.estado_id, que describe el flujo del caso.';
comment on column core.mesa_ficha.objetivo is
    'Objetivo de la mesa. No se copia a resumen_ejecutivo ni a descripcion_riesgo: esos campos describen el conflicto.';
comment on column core.mesa_ficha.rol_produce is
    'Rol que cumple PRODUCE en la mesa.';
comment on column core.mesa_ficha.ambito_departamento is
    'Ámbito textual original. La 81 sólo pudo copiar a region_principal_id las coincidencias exactas; los textos compuestos o nacionales quedan aquí completos.';
comment on column core.mesa_ficha.doc_designacion is
    'Documento de designación de la mesa (nivel mesa). No confundir con core.mesa_miembros.doc_designacion, que es por integrante.';
comment on column core.mesa_ficha.link_evidencia is
    'Enlace de evidencia declarado por la mesa. Si se formaliza como documento, puede registrarse además en core.documentos.url_pdf.';
comment on column core.mesa_ficha.sectorista_usuario_id is
    'Usuario sectorista de la mesa. No es core.casos.punto_focal_usuario_id: cumplen funciones distintas.';
comment on column core.mesa_ficha.tiene_norma is
    'Indicador de si la mesa tiene norma de creación, tal como vino en la carga histórica.';
comment on column core.mesa_ficha.origen_dato is
    'Procedencia del dato. Mismo CHECK y default que core.mesas_dialogo; en el backfill todas las filas quedan en AVISA_HISTORICO.';
comment on column core.mesa_ficha.nivel_clasificacion is
    'Copia del nivel de clasificación de la mesa al momento del alta. Si cambia en core.mesas_dialogo, debe actualizarse aquí; la política RLS de esta tabla usa este valor.';
comment on column core.mesa_ficha.created_at is
    'Alta de la ficha. Lo fija el default; el trigger de auditoría mantiene updated_at.';
comment on column core.mesa_ficha.updated_at is
    'Última modificación. La fija core.set_audit() en cada INSERT/UPDATE.';
comment on column core.mesa_ficha.created_by is
    'Autor del alta según app.user_id (trigger core.set_audit()). NULL en el backfill.';
comment on column core.mesa_ficha.updated_by is
    'Autor de la última edición según app.user_id (trigger core.set_audit()).';

-- 2 · Backfill -----------------------------------------------------------------
-- Se copia el texto original sin normalizar ni truncar (los tipos de destino
-- son idénticos a los de origen; no hay pérdida de longitud). `on conflict do
-- nothing` hace que una reejecución conserve lo ya existente y no pise nada; el
-- guard siguiente detecta cualquier fila que no se haya podido insertar.

insert into core.mesa_ficha (
    caso_id, mesa_id, tipo_espacio_id, linea_oaipcs, tipo_instrumento,
    base_legal, fecha_norma, prorrogas_modificatorias, fecha_instalacion,
    naturaleza, fecha_fin_vigencia, estado_vigencia, objetivo, rol_produce,
    ambito_departamento, doc_designacion, link_evidencia, sectorista_usuario_id,
    tiene_norma, origen_dato, nivel_clasificacion
)
select
    m.caso_id, m.id, m.tipo_espacio_id, m.linea_oaipcs, m.tipo_instrumento,
    m.base_legal, m.fecha_norma, m.prorrogas_modificatorias, m.fecha_instalacion,
    m.naturaleza, m.fecha_fin_vigencia, m.estado_vigencia, m.objetivo,
    m.rol_produce, m.ambito_departamento, m.doc_designacion, m.link_evidencia,
    m.sectorista_usuario_id, m.tiene_norma, m.origen_dato, m.nivel_clasificacion
  from core.mesas_dialogo m
 where m.caso_id is not null
on conflict do nothing;

-- 3 · Guarda final -------------------------------------------------------------
-- Aborta la transacción completa si el porteo no es exacto: conteo de fichas,
-- alineación mesa/caso y comparación fila a fila de los 19 campos copiados
-- (los tipos de origen y destino son idénticos, por eso la comparación de filas
-- es válida). Va antes del log y del commit para no registrar un falso éxito.

do $verifica$
declare
  v_mesas        bigint;
  v_fichas       bigint;
  v_desalineadas bigint;
  v_discrepan    bigint;
begin
  select count(*) into v_mesas
    from core.mesas_dialogo
   where caso_id is not null;

  select count(*) into v_fichas
    from core.mesa_ficha;

  if v_fichas <> v_mesas then
    raise exception '82: hay % fichas pero % mesas con caso; el backfill quedó incompleto o hay fichas sueltas', v_fichas, v_mesas;
  end if;

  select count(*) into v_desalineadas
    from core.mesa_ficha f
    join core.mesas_dialogo m on m.id = f.mesa_id
   where m.caso_id is distinct from f.caso_id;

  if v_desalineadas > 0 then
    raise exception '82: % fichas tienen mesa_id y caso_id desalineados; revise core.mesas_dialogo.caso_id', v_desalineadas;
  end if;

  select count(*) into v_discrepan
    from core.mesa_ficha f
    join core.mesas_dialogo m on m.id = f.mesa_id
   where (f.tipo_espacio_id, f.linea_oaipcs, f.tipo_instrumento, f.base_legal,
          f.fecha_norma, f.prorrogas_modificatorias, f.fecha_instalacion,
          f.naturaleza, f.fecha_fin_vigencia, f.estado_vigencia, f.objetivo,
          f.rol_produce, f.ambito_departamento, f.doc_designacion,
          f.link_evidencia, f.sectorista_usuario_id, f.tiene_norma,
          f.origen_dato, f.nivel_clasificacion)
       is distinct from
         (m.tipo_espacio_id, m.linea_oaipcs, m.tipo_instrumento, m.base_legal,
          m.fecha_norma, m.prorrogas_modificatorias, m.fecha_instalacion,
          m.naturaleza, m.fecha_fin_vigencia, m.estado_vigencia, m.objetivo,
          m.rol_produce, m.ambito_departamento, m.doc_designacion,
          m.link_evidencia, m.sectorista_usuario_id, m.tiene_norma,
          m.origen_dato, m.nivel_clasificacion);

  if v_discrepan > 0 then
    raise exception '82: % fichas no coinciden campo a campo con su mesa; el porteo perdió o alteró datos', v_discrepan;
  end if;
end $verifica$;

-- 4 · RLS, auditoría y permisos ------------------------------------------------
-- Mismo contrato que core.casos (verificado en pg_policies): lectura por
-- clasificación, escritura desde nivel 2, borrado desde nivel 3 y políticas
-- restrictivas por rol. Se omite `p_anulados` a propósito: `mesa_ficha` no
-- tiene columnas de anulación; si se añaden, hay que replicar esa política.
-- Todas las llamadas van cualificadas con `core.` y las funciones ya fijan su
-- propio `search_path`; no se depende del search_path de la sesión.

alter table core.mesa_ficha enable row level security;
alter table core.mesa_ficha force row level security;

drop policy if exists p_clasificacion on core.mesa_ficha;
create policy p_clasificacion on core.mesa_ficha as permissive for select
    to public
    using (nivel_clasificacion <= core.clasificacion_max());

drop policy if exists p_insert on core.mesa_ficha;
create policy p_insert on core.mesa_ficha as permissive for insert
    to public
    with check (core.clasificacion_max() >= 2
                and nivel_clasificacion <= core.clasificacion_max());

drop policy if exists p_update on core.mesa_ficha;
create policy p_update on core.mesa_ficha as permissive for update
    to public
    using (core.clasificacion_max() >= 2
           and nivel_clasificacion <= core.clasificacion_max())
    with check (core.clasificacion_max() >= 2
                and nivel_clasificacion <= core.clasificacion_max());

drop policy if exists p_delete on core.mesa_ficha;
create policy p_delete on core.mesa_ficha as permissive for delete
    to public
    using (core.clasificacion_max() >= 3
           and nivel_clasificacion <= core.clasificacion_max());

drop policy if exists r_rol_insert on core.mesa_ficha;
create policy r_rol_insert on core.mesa_ficha as restrictive for insert
    with check (core.puede_crear());

drop policy if exists r_rol_update on core.mesa_ficha;
create policy r_rol_update on core.mesa_ficha as restrictive for update
    using (core.puede_editar())
    with check (core.puede_editar());

drop policy if exists r_rol_delete on core.mesa_ficha;
create policy r_rol_delete on core.mesa_ficha as restrictive for delete
    using (core.puede_eliminar());

drop trigger if exists trg_audit on core.mesa_ficha;
create trigger trg_audit
    before insert or update on core.mesa_ficha
    for each row execute function core.set_audit();

-- Grants guardados por existencia de rol (como en 51/52/56/57): un `grant` a un
-- rol ausente abortaría la migración en un entorno local sin esos roles.
-- `avisa_api` ya es miembro de `avisa_app` en Neon, pero se otorga explícito
-- para no depender de la herencia si alguien cambia la membresía.
do $grants$
begin
  if exists (select 1 from pg_roles where rolname = 'avisa_app') then
    execute 'grant select, insert, update, delete on core.mesa_ficha to avisa_app';
  else
    raise notice '82: rol avisa_app ausente; no se otorgaron privilegios sobre core.mesa_ficha';
  end if;

  if exists (select 1 from pg_roles where rolname = 'avisa_api') then
    execute 'grant select, insert, update, delete on core.mesa_ficha to avisa_api';
  end if;
end $grants$;

-- 5 · Registro de la migración ------------------------------------------------
-- Clave con la convención del repositorio: <número>_<nombre>_<fecha>.

insert into core.migracion_log (clave)
values ('82_porteo_campos_mesas_2026_11_27')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- VERIFICACIÓN POSTERIOR
-- -----------------------------------------------------------------------------
-- Ejecutar con el mismo rol BYPASSRLS que aplique el borrador: con
-- `avisa_app`/`avisa_api` y sin `app.rol_codigo`, `clasificacion_max()` = 0 y
-- estas consultas devolverían 0 por RLS.
--
-- Resultados esperados con los datos actuales (2026-11-27):
--   fichas = 21 · mesas_sin_ficha = 0 · fichas_sin_caso = 0
--   desalineadas = 0 · discrepantes = 0 · integrantes = 62 · integrantes_sin_mesa = 0
--   integrantes_con_caso = 62 · casos_MD = 21 · mesas_sin_caso = 0

-- 1) Fichas creadas (esperado 21).
select count(*) as fichas
  from core.mesa_ficha;

-- 2) Mesas con caso sin ficha (esperado 0).
select count(*) as mesas_sin_ficha
  from core.mesas_dialogo m
  left join core.mesa_ficha f on f.mesa_id = m.id
 where m.caso_id is not null
   and f.caso_id is null;

-- 3) Fichas cuyo caso no es el de su mesa (esperado 0).
select count(*) as desalineadas
  from core.mesa_ficha f
  join core.mesas_dialogo m on m.id = f.mesa_id
 where m.caso_id is distinct from f.caso_id;

-- 4) Fichas huérfanas de caso o de mesa (esperado 0 y 0).
select count(*) filter (where c.id is null) as fichas_sin_caso,
       count(*) filter (where m.id is null) as fichas_sin_mesa
  from core.mesa_ficha f
  left join core.casos c on c.id = f.caso_id
  left join core.mesas_dialogo m on m.id = f.mesa_id;

-- 5) Integrantes: total, sin mesa y alcanzables desde un caso
--    (esperado 62 · 0 · 62). No se portan: la fuente sigue siendo la mesa.
select count(*) as integrantes,
       count(*) filter (where m.id is null) as integrantes_sin_mesa,
       count(*) filter (where m.caso_id is not null) as integrantes_con_caso
  from core.mesa_miembros mm
  left join core.mesas_dialogo m on m.id = mm.mesa_id;

-- 6) Porteo campo a campo: fichas que difieren de su mesa (esperado 0).
select count(*) as discrepantes
  from core.mesa_ficha f
  join core.mesas_dialogo m on m.id = f.mesa_id
 where (f.tipo_espacio_id, f.linea_oaipcs, f.tipo_instrumento, f.base_legal,
        f.fecha_norma, f.prorrogas_modificatorias, f.fecha_instalacion,
        f.naturaleza, f.fecha_fin_vigencia, f.estado_vigencia, f.objetivo,
        f.rol_produce, f.ambito_departamento, f.doc_designacion,
        f.link_evidencia, f.sectorista_usuario_id, f.tiene_norma,
        f.origen_dato, f.nivel_clasificacion)
     is distinct from
       (m.tipo_espacio_id, m.linea_oaipcs, m.tipo_instrumento, m.base_legal,
        m.fecha_norma, m.prorrogas_modificatorias, m.fecha_instalacion,
        m.naturaleza, m.fecha_fin_vigencia, m.estado_vigencia, m.objetivo,
        m.rol_produce, m.ambito_departamento, m.doc_designacion,
        m.link_evidencia, m.sectorista_usuario_id, m.tiene_norma,
        m.origen_dato, m.nivel_clasificacion);

-- 7) Cuadre con la 81 (esperado 21 · 0 · 21).
select (select count(*) from core.casos
         where codigo_caso ~ '^MD-[0-9]{4}-[0-9]+$')      as casos_md,
       (select count(*) from core.mesas_dialogo
         where caso_id is null)                            as mesas_sin_caso,
       (select count(*) from core.mesas_dialogo)           as mesas_total;

-- 8) Ficha de una mesa concreta para inspección visual (sin datos personales).
select m.codigo, c.codigo_caso, f.tipo_instrumento, f.naturaleza,
       f.estado_vigencia, f.fecha_instalacion, f.fecha_fin_vigencia,
       f.rol_produce, (f.objetivo is not null) as tiene_objetivo,
       (f.link_evidencia is not null) as tiene_evidencia
  from core.mesa_ficha f
  join core.mesas_dialogo m on m.id = f.mesa_id
  join core.casos c on c.id = f.caso_id
 order by m.codigo;

-- -----------------------------------------------------------------------------
-- RESINCRONIZACIÓN OPCIONAL (no se ejecuta)
-- -----------------------------------------------------------------------------
-- `core.mesas_dialogo` sigue siendo el sistema de registro mientras la app lea
-- de ahí. Si alguien edita una mesa y quiere reflejarlo en la ficha, ejecute
-- este bloque a mano, en una transacción, sabiendo que SOBREESCRIBE la ficha.
-- No está incluido en el flujo normal para no pisar ediciones hechas sobre la
-- ficha.
--
-- begin;
-- update core.mesa_ficha f
--    set tipo_espacio_id = m.tipo_espacio_id,
--        linea_oaipcs = m.linea_oaipcs,
--        tipo_instrumento = m.tipo_instrumento,
--        base_legal = m.base_legal,
--        fecha_norma = m.fecha_norma,
--        prorrogas_modificatorias = m.prorrogas_modificatorias,
--        fecha_instalacion = m.fecha_instalacion,
--        naturaleza = m.naturaleza,
--        fecha_fin_vigencia = m.fecha_fin_vigencia,
--        estado_vigencia = m.estado_vigencia,
--        objetivo = m.objetivo,
--        rol_produce = m.rol_produce,
--        ambito_departamento = m.ambito_departamento,
--        doc_designacion = m.doc_designacion,
--        link_evidencia = m.link_evidencia,
--        sectorista_usuario_id = m.sectorista_usuario_id,
--        tiene_norma = m.tiene_norma,
--        origen_dato = m.origen_dato,
--        nivel_clasificacion = m.nivel_clasificacion,
--        updated_at = now()
--   from core.mesas_dialogo m
--  where m.id = f.mesa_id
--    and m.caso_id is not distinct from f.caso_id;
-- commit;

-- -----------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- Idempotente y acotado: la única tabla nueva es `core.mesa_ficha`, y nada más
-- la referencia (sin vistas, sin FKs entrantes, sin funciones). El borrado se
-- lleva consigo políticas, trigger, índices y grants. No toca `core.casos`,
-- `core.mesas_dialogo`, `core.mesa_miembros` ni los casos MD de la 81.
--
-- Se usa `drop table` SIN `cascade` a propósito: si alguien colgó una vista de la
-- ficha, el rollback falla en voz alta en lugar de arrastrarla en silencio.
--
-- AVISO: revierte ANTES que la 81. Si revierte primero la 81, el borrado en
-- cascada de los casos ya habrá eliminado las fichas.
--
-- Si la aplicación llegó a escribir en la ficha, esos datos se pierden: respalde
-- antes (`pg_dump --data-only --table=core.mesa_ficha`).
--
-- begin;
--   drop table if exists core.mesa_ficha;
--   delete from core.migracion_log
--    where clave = '82_porteo_campos_mesas_2026_11_27';
-- commit;

-- -----------------------------------------------------------------------------
-- Orden de despliegue
-- -----------------------------------------------------------------------------
-- 1. Respaldo: `pg_dump` con datos de `core.mesas_dialogo` y de
--    `core.mesa_ficha` si ya existiera. La reversión no reconstruye ediciones.
-- 2. Aplicar ESTE borrador con el rol propietario BYPASSRLS (owner de Neon).
--    Nunca con `avisa_app`/`avisa_api`: sin `app.rol_codigo` la RLS oculta las
--    mesas y el preflight aborta.
-- 3. Ejecutar el bloque VERIFICACIÓN POSTERIOR y comparar con los valores
--    esperados del encabezado de ese bloque.
-- 4. No hace falta reiniciar Next: ningún módulo lee `core.mesa_ficha` todavía
--    (`lib/db/repos/mesas.ts` sigue leyendo `core.mesas_dialogo`).
-- 5. Consolidación futura (migración aparte, fuera de este borrador): decidir
--    si la app pasa a leer/escribir la ficha o si se añade un trigger de
--    sincronización sobre `core.mesas_dialogo`, y retirar entonces la
--    duplicación.
