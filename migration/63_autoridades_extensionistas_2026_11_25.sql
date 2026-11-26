-- =============================================================================
-- 63 · Padrón de 21 autoridades y agentes de PRODUCE (extensionistas)
--
-- Fecha: 2026-11-25
-- Autor de la carga: OAIPCS
--
-- Por qué existe esta migración
-- -----------------------------
-- La vista `/directorio/autoridades` se alimenta de `core.actores` filtrado por
-- `cat_tipos_actor = 'Actor público'` y `naturaleza = 'persona'` (ver
-- `lib/db/repos/autoridades.ts`, CTE `base`). Esa vista mostraba sólo las 108
-- personas heredadas del prototipo y no tenía a los extensionistas de PRODUCE
-- que hoy hacen el trabajo de campo.
--
-- Esta migración carga el padrón que entregó la Dirección de Formalización
-- (21 filas: 20 extensionistas por jurisdicción y la coordinación nacional).
-- No crea tablas ni columnas: sólo inserta filas en `core.actores` y en
-- `core.actor_datos_personales`.
--
-- Cómo se traduce el padrón al modelo
-- -----------------------------------
-- El padrón trae cinco campos que no existen uno a uno en el esquema. La
-- traducción aplicada es explícita y no inventa columnas:
--
--   JURISDICCIÓN  → `core.actores.region_id`, tomado de `core.regiones`.
--                   El padrón parte provincias en mitades (p. ej. «Piura -
--                   Norte» y «Piura - Sur») y el modelo sólo llega a región,
--                   así que ambas mitades comparten el `region_id` de su
--                   región. «Lima y Callao» se registra en Lima (15) porque
--                   la mayor parte de su ámbito es Lima; Callao es región 7 y
--                   el padrón no permite separarlos.
--                   «Coordinación Nacional» no tiene región: `region_id = null`.
--   PROVINCIAS    → `core.actores.perfil_descripcion`, como texto («Jurisdicción:
--                   … · Provincias: …»). El modelo sólo tiene `region_id` y
--                   `distrito_id`, y el padrón no baja a distrito. Es lo que
--                   muestra la sección «Descripción del perfil» de la ficha.
--   EXTENSIONISTA → `core.actores.nombre_actual`, conservando el honorífico
--                   («Blgo.», «Ing.») porque el modelo no tiene columna de
--                   profesión y perderlo sería perder dato de la fuente.
--   TELÉFONO      → `core.actor_datos_personales.telefono_cifrado`, cifrado con
--                   AES-256 y `app.crypto_key`. NO se escribe en
--                   `core.actores.telefono_contacto` (columna no PII de la
--                   migración 55) porque el padrón es un directorio interno de
--                   personas y la regla del repositorio es no guardar teléfonos
--                   personales en claro. Se lee desde la ficha, pestaña «Datos
--                   personales», que exige rol con clasificación 3 y queda
--                   auditada (Ley 29733).
--   CORREO        → `core.actores.email_contacto` (dato de contacto
--                   institucional, presente ya en las 108 filas heredadas).
--
-- Campos derivados y su criterio:
--   * `cargo_actual = 'Extensionista'` para las 20 filas de jurisdicción. El
--     patrón de la vista (`PATRON_AUTORIDAD`) no casa con «Extensionista», así
--     que se muestran en la pestaña «Agente», que es lo correcto: no dirigen
--     una unidad.
--   * La fila «Coordinación Nacional» se registra con
--     `cargo_actual = 'Coordinador Nacional'`. La fuente declara una función de
--     coordinación y el patrón sí casa, así que aparece en «Autoridad».
--   * `nivel_gobierno = 'Nacional'` en las 21: son servidores de un ministerio,
--     con independencia de la región que atienden.
--   * `nivel_identificacion_id = 3` (identificado sin distrito). Cumple
--     `ck_actor_sin_geo_si_no_identificado`, que sólo exige geografía nula a
--     partir del nivel 4, y `ck_actor_anclaje`.
--   * `origen_dato = 'MANUAL'`: carga nueva, no histórica.
--   * `codigo_legado = 'PRODUCE-EXT-2026-NN'` es la clave natural de la carga.
--     Sirve para que la migración sea idempotente y para revertirla sin tocar
--     ninguna otra fila.
--
-- Requisito: la clave de cifrado
-- ------------------------------
-- La migración se niega a correr si la sesión no tiene `app.crypto_key`. Sin
-- esa guarda `pgp_sym_encrypt` devolvería NULL en silencio y los 21 teléfonos
-- se perderían sin error.
--
--   psql "<url de neon>" -v crypto_key='<32 bytes>' \
--        -f migration/63_autoridades_extensionistas_2026_11_25.sql
--
-- Si la sesión ya trae `app.crypto_key` puesta, alcanza con:
--
--   psql "<url de neon>" -f migration/63_autoridades_extensionistas_2026_11_25.sql
--
-- Cómo revertir
-- -------------
-- Todo lo que crea esta migración está marcado con `codigo_legado`; no toca
-- ninguna fila preexistente:
--
--   begin;
--   select set_config('app.rol_codigo', 'administrador', true);
--   select set_config('app.user_id',
--                     '00000000-0000-0000-0000-000000000001', true);
--   delete from core.actores
--    where codigo_legado like 'PRODUCE-EXT-2026-%';
--   commit;
--
-- El `delete` arrastra `core.actor_datos_personales` por `ON DELETE CASCADE`.
-- =============================================================================

begin;

-- 1 · Contexto RLS: rol de lectura total y autoría de la carga.
select set_config('app.rol_codigo', 'administrador', true);
select set_config(
  'app.user_id',
  '00000000-0000-0000-0000-000000000001',
  true
);

-- 2 · Clave de cifrado: obligatoria y no vacía.
do $$
declare
  v_clave text := current_setting('app.crypto_key', true);
begin
  if v_clave is null or btrim(v_clave) = '' then
    raise exception
      'Falta app.crypto_key en la sesión: sin clave, los teléfonos se guardarían NULL. Ejecute con psql -v crypto_key=''...''.';
  end if;
end $$;

-- 3 · Padrón tal como lo entregó la fuente, sin transformar.
create temp table padron_extensionistas (
  orden       integer primary key,
  jurisdiccion text not null,
  provincias  text,
  nombre      text not null,
  telefono    text not null,
  correo      text not null,
  cargo       text not null,
  region_id   integer
) on commit drop;

insert into padron_extensionistas
  (orden, jurisdiccion, provincias, nombre, telefono, correo, cargo, region_id)
values
  ( 1, 'Tumbes', 'Tumbes, Contralmirante Villar, Zarumilla',
    'Blgo. Carlos Gaspar Malca Aguilar', '950813236',
    'cmalca@produce.gob.pe', 'Extensionista', 24),
  ( 2, 'Tumbes', 'Tumbes, Contralmirante Villar, Zarumilla',
    'Ing. Juan Ullilen Zaravia', '998536337',
    'dipforpa_temp80@produce.gob.pe', 'Extensionista', 24),
  ( 3, 'Piura - Norte', 'Talara',
    'Blgo. Dammer Llin Castillo Paredes', '969827176',
    'dipforpa_temp88@produce.gob.pe', 'Extensionista', 20),
  ( 4, 'Piura - Centro', 'Paita',
    'Ing. Carlos Samuel Ruiz Paiva', '945250430',
    'dipforpa_temp37@produce.gob.pe', 'Extensionista', 20),
  ( 5, 'Piura - Sur', 'Sechura',
    'Ing. Claudia Araceli Córdova Rojas', '928465682',
    'dipforpa_temp26@produce.gob.pe', 'Extensionista', 20),
  ( 6, 'Lambayeque', 'Lambayeque, Chiclayo',
    'Blgo. Franco Acosta Davila', '926596981',
    'facosta@produce.gob.pe', 'Extensionista', 14),
  ( 7, 'La Libertad', 'Chepen, Pacasmayo, Ascope, Trujillo, Viru',
    'Blgo. Jorge Jaime Alcántara Minchola', '948535681',
    'dipforpa_temp31@produce.gob.pe', 'Extensionista', 13),
  ( 8, 'Ancash - Norte', 'Santa',
    'Blgo. Elvis Ruiz La Rosa', '972209614',
    'dipforpa_temp71@produce.gob.pe', 'Extensionista', 2),
  ( 9, 'Ancash - Sur', 'Casma, Huarmey',
    'Ing. Elibrando Escobar Feria', '943343486',
    'eescobar@produce.gob.pe', 'Extensionista', 2),
  (10, 'Lima y Callao - Norte', 'Huaral, Huara, Barranca',
    'Ing. Marco Antonio Peche Celi', '948677286',
    'dipforpa_temp67@produce.gob.pe', 'Extensionista', 15),
  (11, 'Lima y Callao', 'Lima, Callao',
    'Ing. Yosse Diana Guadalupe Lozada', '941380168',
    'dipforpa_temp59@produce.gob.pe', 'Extensionista', 15),
  (12, 'Ica', 'Chincha, Pisco, Ica, Nasca',
    'Ing. Marco Quispe Aguilar', '956662261',
    'dipforpa_temp61@produce.gob.pe', 'Extensionista', 11),
  (13, 'Arequipa - Norte', 'Caravelí',
    'Ing. Dionisio Eugenio Yancce Ucharima', '988556432',
    'dipforpa_temp46@produce.gob.pe', 'Extensionista', 4),
  (14, 'Arequipa - Sur', 'Islay',
    'Ing. Ana María Arcos Arcos', '915397626',
    'dipforpa_temp84@produce.gob.pe', 'Extensionista', 4),
  (15, 'Moquegua', 'Mariscal Nieto, Sánchez Cerro, Ilo',
    'Ing. William Cotrado Cotrado', '953669533',
    'dipforpa_temp85@produce.gob.pe', 'Extensionista', 18),
  (16, 'Tacna', 'Tacna, Jorge Basadre',
    'Ing. Cristhian Daniel Sánchez Alfaro', '990500072',
    'dipforpa_temp32@produce.gob.pe', 'Extensionista', 23),
  (17, 'Puno', 'Puno, Huancane, Moho, Lampa, San Ramón, Azangaro, El Collao, Chucuito, Yunguyo',
    'Blgo. Emeterio Morales Condori', '972514754',
    'dipforpa_temp42@produce.gob.pe', 'Extensionista', 21),
  (18, 'Ucayali', 'Coronel Portillo, Padre Abad',
    'Blgo. César Enrique Escurra Robles', '956154947',
    'dipforpa_temp23@produce.gob.pe', 'Extensionista', 25),
  (19, 'Loreto Norte', 'Maynas, Ramón Castilla',
    'Blgo. José Antonio Yuto Aguilar', '942166508',
    'dipforpa_temp28@produce.gob.pe', 'Extensionista', 16),
  (20, 'Loreto Sur', 'Requena',
    'Ing. Nelson Matamoros Amasifuen', '985445936',
    'dipforpa_temp81@produce.gob.pe', 'Extensionista', 16),
  (21, 'Coordinación Nacional', null,
    'Nidia Colchado Colona', '971406021',
    'ncolchado@produce.gob.pe', 'Coordinador Nacional', null);

-- 4 · Personas en el padrón de actores. Idempotente por `codigo_legado`.
insert into core.actores (
  nombre_actual,
  naturaleza,
  tipo_actor_id,
  rol_actor_id,
  origen_dato,
  email_contacto,
  cargo_actual,
  nivel_gobierno,
  region_id,
  nivel_clasificacion,
  nivel_identificacion_id,
  es_validado_humano,
  activo,
  perfil_descripcion,
  codigo_legado
)
select
  p.nombre,
  'persona',
  1,                            -- cat_tipos_actor: Actor público
  7,                            -- cat_roles_actor: No determinado
  'MANUAL',
  p.correo,
  p.cargo,
  'Nacional',
  p.region_id,
  2,
  3,
  true,
  true,
  'Extensionista de PRODUCE. Jurisdicción: ' || p.jurisdiccion
    || coalesce(' · Provincias: ' || p.provincias, '') || '.',
  'PRODUCE-EXT-2026-' || lpad(p.orden::text, 2, '0')
from padron_extensionistas p
where not exists (
  select 1
    from core.actores a
   where a.codigo_legado = 'PRODUCE-EXT-2026-' || lpad(p.orden::text, 2, '0')
);

-- 5 · Teléfono cifrado (PII). Sólo rellena fichas que aún no tienen teléfono:
--     nunca sobrescribe un dato ya curado.
insert into core.actor_datos_personales (
  actor_uid,
  telefono_cifrado,
  telefono_raw,
  base_legal,
  base_legal_id,
  nivel_clasificacion
)
select
  a.actor_uid,
  public.pgp_sym_encrypt(
    p.telefono,
    current_setting('app.crypto_key'),
    'cipher-algo=aes256'
  ),
  p.telefono,
  'INTERES_PUBLICO',
  4,                            -- ref.base_legal_tratamiento: INTERES_PUBLICO
  3
from padron_extensionistas p
join core.actores a
  on a.codigo_legado = 'PRODUCE-EXT-2026-' || lpad(p.orden::text, 2, '0')
on conflict (actor_uid) do update
   set telefono_cifrado = excluded.telefono_cifrado,
       telefono_raw     = excluded.telefono_raw
 where core.actor_datos_personales.telefono_cifrado is null;

-- 6 · Registro de la migración (idempotente, como el resto del repo).
insert into core.migracion_log (clave)
values ('63_autoridades_extensionistas_2026_11_25')
on conflict (clave) do nothing;

commit;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
-- Debe dar 21 filas, todas con región salvo la coordinación nacional.
select count(*)                                    as filas,
       count(*) filter (where region_id is null)   as sin_region,
       count(*) filter (where cargo_actual = 'Extensionista') as extensionistas
  from core.actores
 where codigo_legado like 'PRODUCE-EXT-2026-%';

-- Los 21 deben tener teléfono cifrado legible con la misma clave de la sesión.
select count(*) as con_telefono_cifrado
  from core.actores a
  join core.actor_datos_personales d on d.actor_uid = a.actor_uid
 where a.codigo_legado like 'PRODUCE-EXT-2026-%'
   and d.telefono_cifrado is not null;

-- El universo de la vista debe pasar de 108 a 129.
select count(*)::int as universo
  from core.actores a
  join core.cat_tipos_actor ta on ta.id = a.tipo_actor_id
 where ta.nombre = 'Actor público'
   and a.naturaleza = 'persona';
