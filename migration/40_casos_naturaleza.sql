-- =============================================================================
--  40 · Naturaleza del caso: territorial frente a nacional o sectorial
--
--  Fecha: 2026-11-23
--
--  Por qué existe esta migración
--  -----------------------------
--  `core.cat_alcances_geograficos` (Norte / Centro / Sur / Oriente / Nacional)
--  es un dato **derivado**: `core.alcance_caso(uuid)` lo deduce de las regiones
--  del caso y, cuando hay varias, cae a «Nacional». Ese «Nacional» significa
--  «toca más de una región», NO «su causa es una norma, una cuota o una
--  temporada». Son dos ejes distintos y hasta hoy la interfaz tenía que
--  adivinar cuál mostraba:
--
--    · CS-PA-OAT-2026-01 (calamar gigante) afecta 11 regiones por una medida de
--      ordenamiento: es nacional/sectorial de naturaleza, no sólo de alcance.
--    · CS-PA-GOB-2026-02 (formalización pesquera) afecta Piura y Lambayeque:
--      también da «Nacional» por derivación, pero es territorial multirregional.
--
--  La solución no es retocar el alcance derivado (rompería el Anexo 15 y la
--  lectura por región), sino añadir un eje nuevo, **declarado a mano**, que
--  distinga los casos con causa territorial de los de causa nacional/sectorial.
--
--  Qué cambia
--  ----------
--  1 · `core.cat_naturalezas_caso` (id, codigo, descripcion) con dos filas:
--      `Territorial` y `Nacional o sectorial`.
--  2 · `core.casos.naturaleza_id` (FK, **anulable**). `NULL` = **sin declarar**:
--      el dato se declara, no se estima. La interfaz debe pintar «Sin declarar»
--      y nunca un valor verosímil.
--  3 · Siembra de 7 casos con evidencia inequívoca (tabla más abajo). El resto
--      queda en `NULL` a propósito.
--  4 · Respaldo del estado previo en `core.casos_naturaleza_backup_20261123`.
--
--  Criterio de siembra (y su límite)
--  ---------------------------------
--  Sólo se declara «Nacional o sectorial» cuando el **título** del caso nombra
--  un instrumento o medida de alcance nacional (ley, cuota, temporada, medida
--  de ordenamiento, DENP/CITES) y sus regiones son un reflejo del alcance de
--  esa medida, no su causa. NO se siembra cuando el conflicto nace en un
--  territorio concreto aunque toque a varios.
--
--  Excluido a propósito:
--    · CS-PA-GOB-2026-02 — «Ampliación del proceso de formalización pesquera
--      en Piura y Lambayeque». Su título lo sitúa en dos regiones concretas:
--      es territorial multirregional. Llamarlo nacional/sectorial sin evidencia
--      sería exactamente lo que esta columna quiere evitar. Queda en NULL.
--
--  La siembra es una propuesta documentada: OAIPCS puede revertir cualquier
--  fila a `NULL` (o cambiarla a `Territorial`) sin migración, con un UPDATE.
--
--  Qué NO cambia
--  -------------
--  · `core.alcance_caso(uuid)` y `core.cat_alcances_geograficos` quedan
--    intactos: el alcance sigue siendo geográfico y derivado.
--  · No se crean triggers ni índices: la columna es un atributo declarado, no
--    una derivación, y no se filtra por ella en caliente.
--  · No se toca `core.alertas_tempranas`: la naturaleza es del caso.
--
--  Cómo revertir
--  -------------
--  Bloque comentado al final: borra la columna y el catálogo. El respaldo
--  conserva qué casos se sembraron y con qué valor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1 · Catálogo de naturalezas
--     `codigo` e `id` estables; `descripcion` explica la distinción para que
--     nadie tenga que deducirla del nombre.
-- -----------------------------------------------------------------------------
create table if not exists core.cat_naturalezas_caso (
    id          smallint    primary key,
    codigo      varchar(40) not null unique,
    descripcion text
);

insert into core.cat_naturalezas_caso (id, codigo, descripcion) values
    (1, 'Territorial',
        'La causa del conflicto nace en un territorio concreto (una caleta, un '
        'distrito, una región). Sus demandas se explican por lo que ocurre allí.'),
    (2, 'Nacional o sectorial',
        'La causa es una medida de alcance nacional o de todo el sector (norma, '
        'cuota, temporada, ordenamiento, permiso). Las regiones afectadas son '
        'consecuencia de la medida, no su origen.')
on conflict (id) do update
    set codigo = excluded.codigo,
        descripcion = excluded.descripcion;

comment on table core.cat_naturalezas_caso is
    'Naturaleza declarada del caso: Territorial vs Nacional o sectorial. '
    'Eje independiente del alcance geográfico derivado (core.alcance_caso).';

comment on column core.cat_naturalezas_caso.descripcion is
    'Criterio para declarar la naturaleza. No es una regla automática: el valor '
    'se declara a mano y NULL significa «sin declarar».';

-- Idempotente también ante entornos sin ALTER DEFAULT PRIVILEGES.
grant select on core.cat_naturalezas_caso to avisa_app;

-- -----------------------------------------------------------------------------
-- 2 · Columna declarada en el caso (anulable)
-- -----------------------------------------------------------------------------
alter table core.casos add column if not exists naturaleza_id smallint;

alter table core.casos drop constraint if exists casos_naturaleza_id_fkey;
alter table core.casos add constraint casos_naturaleza_id_fkey
    foreign key (naturaleza_id) references core.cat_naturalezas_caso (id);

comment on column core.casos.naturaleza_id is
    'Naturaleza declarada (Territorial / Nacional o sectorial). NULL = sin '
    'declarar: no se deriva del alcance ni de las regiones.';

create index if not exists casos_naturaleza_idx on core.casos (naturaleza_id);

-- -----------------------------------------------------------------------------
-- 3 · Respaldo del estado previo
--     Se copia la columna ya creada (todas las filas, anuladas incluidas) para
--     dejar constancia del punto de partida. `origen` marca qué filas sembró
--     esta migración y cuáles no.
-- -----------------------------------------------------------------------------
create table if not exists core.casos_naturaleza_backup_20261123 (
    caso_id       uuid        primary key,
    codigo_caso   text        not null,
    naturaleza_id smallint,
    origen        text        not null default 'previo',
    copiado_en    timestamptz not null default now()
);

insert into core.casos_naturaleza_backup_20261123 (caso_id, codigo_caso, naturaleza_id)
select id, codigo_caso, naturaleza_id
  from core.casos
on conflict (caso_id) do nothing;

-- -----------------------------------------------------------------------------
-- 4 · Siembra: 7 casos de causa nacional/sectorial con evidencia inequívoca
--
--  código              | regiones | por qué es nacional/sectorial
--  --------------------+----------+--------------------------------------------------
--  CS-PA-ITE-2026-02   | 11       | Impacto del Fenómeno El Niño: fenómeno climático,
--                      |          | no un conflicto de un territorio.
--  CS-PA-NOR-2025-01   | 7        | Implementación de la Ley 31749: norma nacional.
--  CS-PA-OAT-2024-03   | 5        | Cuotas de jurel y caballa: medida sectorial.
--  CS-PA-OAT-2026-01   | 11       | Ordenamiento del calamar gigante (pota): medida sectorial.
--  CS-PA-OAT-2026-02   | 10       | Ordenamiento del bonito: medida sectorial.
--  CS-PA-OAT-2026-03   | 4        | Continuidad del tiburón y DENP/CITES: normativa nacional.
--  CS-PA-OAT-2026-04   | 7        | Cancelación de temporada de anchoveta: medida sectorial.
--
--  `and c.naturaleza_id is null` mantiene la siembra reejecutable y evita
--  pisar una declaración manual posterior.
-- -----------------------------------------------------------------------------
update core.casos c
   set naturaleza_id = (select id from core.cat_naturalezas_caso
                         where codigo = 'Nacional o sectorial')
 where c.codigo_caso in (
        'CS-PA-ITE-2026-02',
        'CS-PA-NOR-2025-01',
        'CS-PA-OAT-2024-03',
        'CS-PA-OAT-2026-01',
        'CS-PA-OAT-2026-02',
        'CS-PA-OAT-2026-03',
        'CS-PA-OAT-2026-04'
       )
   and c.naturaleza_id is null;

-- Marca en el respaldo qué filas quedaron sembradas.
update core.casos_naturaleza_backup_20261123 b
   set naturaleza_id = c.naturaleza_id,
       origen = 'siembra_migracion_40'
  from core.casos c
 where c.id = b.caso_id
   and c.naturaleza_id is not null;

-- -----------------------------------------------------------------------------
-- 5 · Verificación (dentro de la transacción)
-- -----------------------------------------------------------------------------
-- (a) El catálogo tiene exactamente dos naturalezas.
select count(*) as naturalezas,
       string_agg(codigo, ' | ' order by id) as valores
  from core.cat_naturalezas_caso;

-- (b) 7 declaradas, 27 sin declarar (34 casos vivos).
select coalesce(n.codigo, 'Sin declarar') as naturaleza,
       count(*) as casos
  from core.casos c
  left join core.cat_naturalezas_caso n on n.id = c.naturaleza_id
 where c.anulado_en is null
 group by n.codigo
 order by n.codigo nulls last;

-- (c) Los 7 sembrados, con sus regiones.
select c.codigo_caso, n.codigo as naturaleza,
       (select count(*) from core.caso_regiones cr where cr.caso_id = c.id) as regiones
  from core.casos c
  left join core.cat_naturalezas_caso n on n.id = c.naturaleza_id
 where c.naturaleza_id is not null
 order by c.codigo_caso;

-- (d) El alcance derivado NO cambia (los 7 siguen derivando Nacional).
select c.codigo_caso, ag.codigo as alcance_derivado
  from core.casos c
  left join core.cat_alcances_geograficos ag on ag.id = core.alcance_caso(c.id)
 where c.naturaleza_id is not null
 order by c.codigo_caso;

-- -----------------------------------------------------------------------------
-- 6 · Registro de la migración
-- -----------------------------------------------------------------------------
insert into core.migracion_log (clave) values ('40_casos_naturaleza')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--  Devuelve la columna y el catálogo al estado previo. El respaldo
--  `core.casos_naturaleza_backup_20261123` no se borra: sirve de constancia.
-- =============================================================================
--
-- begin;
-- alter table core.casos drop constraint if exists casos_naturaleza_id_fkey;
-- drop index if exists core.casos_naturaleza_idx;
-- alter table core.casos drop column if exists naturaleza_id;
-- drop table if exists core.cat_naturalezas_caso;
-- delete from core.migracion_log where clave = '40_casos_naturaleza';
-- commit;
