-- 48 · Distrito real de los locales (core.locales.distrito_id)
--
-- PROPÓSITO
--   `core.locales.distrito_id` estaba NULL en los 27 locales del catálogo. Esta
--   migración lo rellena con el distrito en que efectivamente se ubica cada
--   local, para que la consulta existente derive provincia y región desde
--   `core.distritos` (no se guardan: siguen siendo datos derivados).
--
-- FUENTES
--   · OpenStreetMap / Nominatim (https://nominatim.openstreetmap.org), con
--     `addressdetails`: se contrasta city/town/village + código postal con la
--     localidad escrita en la dirección.
--   · Páginas oficiales gob.pe (regionica, regionica-direpro, regionpiura,
--     fondepes, produce), SUNAT/RUC, Gobierno Regional de Lambayeque y prensa
--     (La República, Diario El Pueblo) y datos de mapa (Waze) para verificar
--     sedes institucionales.
--
-- REGLA INNEGOCIABLE
--   No se inventa. Si la evidencia no alcanza, el local queda «sin dato»: no se
--   escribe su UPDATE y se documenta. En esta pasada los 27 locales quedaron
--   resueltos (0 sin dato); cada fila lleva su evidencia en el comentario.
--
-- CRITERIO CUANDO GEOCODER Y DIRECCIÓN DISCREPAN
--   Manda la localidad/institución escrita en la dirección y la fuente oficial.
--   Casos registrados:
--     · Av. Cutervo (GORE Ica) geocodifica en la Prolongación, ya en Parcona;
--       gob.pe/regionica declara «Ica - Ica - Ica» → distrito Ica.
--     · Av. Los Rosales (Colegio de Contadores) cae a ~100 m al norte del
--       límite norte del distrito La Victoria → distrito Chiclayo (CP 14820).
--     · Calle Bolívar (Consejo Regional Arequipa): OSM tiene una homónima en
--       Miraflores; la sede oficial es la del Cercado (CP 04001) → Arequipa.
--     · «Santa Victoria» y «Los Rosales» existen también en José Leonardo
--       Ortiz; la dirección dice Urb. Santa Victoria de Chiclayo (CP 14820).
--
-- DESFASE DECLARADO
--   El catálogo de distritos relevantes trae 22 ubigeos; se usan 17. Quedan sin
--   usar PARCONA (110106), VEINTISÉIS DE OCTUBRE (200115), CASTILLA (200104),
--   MÁNCORA (200706) y LAMBAYEQUE (140301): la evidencia no ubica ningún local
--   en ellos. No se fuerza ningún local a esos distritos.
--
-- ALCANCE
--   Sólo escribe `core.locales.distrito_id`. Idempotente: cada UPDATE filtra
--   `distrito_id is null`, así que re-ejecutarla no cambia nada. No toca código
--   de la aplicación ni otras tablas. Se resuelve siempre por `ubigeo` del
--   catálogo `core.distritos`, nunca por nombre de distrito.
--
--   ESTADO: aplicada. Los 27 locales tienen `distrito_id` y la migración figura
--   en `core.migracion_log` (verificación de sólo lectura del 2026-11-24). El
--   repositorio no la aplica en ningún automatismo: se ejecuta a mano.

begin;

-- -----------------------------------------------------------------------------
-- Ica
-- -----------------------------------------------------------------------------

-- 1 · Auditorio Centro de Operaciones de Emergencias Ica — Av. Túpac Amaru s/n, Ica
-- Web oficial (COER Ica): «Av. Túpac Amaru s/n, cercado de Ica», a espaldas del
-- GORE Ica. OSM/Nominatim: toda la Av. Túpac Amaru (incl. el sector Comatrana)
-- resuelve city=Ica, CP 11001/11002; ningún tramo cae en Parcona.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '110101')
 where id = '8d7b2ac8-5de9-48bd-8aa8-be587a77c401'
   and distrito_id is null;

-- 2 · Auditorio DIREPRO Ica — Av. San Martín 240, Pisco
-- Web oficial (gob.pe/regionica-direpro): «Sede Central: Av. San Martín N° 240 -
-- Pisco Ciudad», que es donde está el auditorio. La dirección manda: Pisco,
-- no la sede de Ica (el nombre del local alude a la Dirección Regional).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '110501')
 where id = 'eba411ff-cf76-4d97-b395-1bd7d846e7d3'
   and distrito_id is null;

-- 3 · Auditorio Gobierno Regional de Ica — Av. Cutervo 920, Ica
-- Web oficial (gob.pe/regionica): «Sede Central: Av. Cutervo N° 920 - Ica - Ica
-- - Ica». OSM geocodifica Av. Cutervo en la Prolongación (Parcona): se prioriza
-- la localidad oficial declarada por la entidad (distrito Ica).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '110101')
 where id = 'b08e1c56-a743-483c-aa35-8587c6b2c277'
   and distrito_id is null;

-- 4 · Auditorio Municipalidad Provincial de Pisco — Calle Ramón Aspillaga 901
-- OSM/Nominatim: Calle Ramón Aspillaga, Pisco, CP 11601 (La Alameda / Nueva
-- Alameda, cercado de Pisco). La municipalidad provincial tiene su sede en el
-- distrito de Pisco.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '110501')
 where id = '8119ba24-54a4-4ee2-be8f-2fb94a1836e7'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- Piura
-- -----------------------------------------------------------------------------

-- 5 · Auditorio de CEP PAITA — Av. Playa Hermosa 1501, Tierra Colorada
-- OSM/Nominatim: Tierra Colorada es caserío de la ciudad de Paita (provincia
-- Paita). Web oficial (FONDEPES): «Sede Paita – Av. Playa Hermosa 1501,
-- Paita - Piura». Coinciden localidad y número.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '200501')
 where id = '60010ad0-d3b3-4f1a-9eaf-d23221ae0361'
   and distrito_id is null;

-- 6 · Auditorio de Cámara de Comercio de Piura — Av. Fortunato Chirichigno,
--     Mz A Lt 2A, Urb. San Eduardo
-- SUNAT/RUC de la Cámara de Comercio y Producción de Piura: «AV. FORTUNATO
-- CHIRICHIGNO URB. SAN EDUARDO LOTE 2A MZ A, PIURA - PIURA - PIURA», CP 200101.
-- OSM/Nominatim: Av. Fortunato Chirichigno, barrio San Eduardo, city Piura,
-- CP 20002; San Eduardo está al noreste del centro, dentro del distrito Piura
-- (no en Veintiséis de Octubre).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '200101')
 where id = 'f0ed2fdc-d98b-41be-b515-d814775e4870'
   and distrito_id is null;

-- 8 · Auditorio de la Municipalidad Provincial de Piura — Jr. Ayacucho 377,
--     Centro Cívico de Piura
-- OSM/Nominatim: Jirón Ayacucho, barrio Clarke, city Piura, CP 20001 (cercado).
-- La sede de la municipalidad provincial corresponde al distrito de Piura.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '200101')
 where id = '96d1e57e-0aa5-4d42-aee7-5f3fc5f22a54'
   and distrito_id is null;

-- 11 · Auditorio del Gobierno Regional de Piura — Av. San Ramón 525,
--      Urb. San Eduardo
-- Web oficial (gob.pe/regionpiura): «Local Principal: Av. San Ramón 525,
-- Urb. San Eduardo - Piura - Piura - Piura». OSM/Nominatim: Av. San Ramón y
-- barrio San Eduardo, city Piura, CP 20002 (distrito Piura).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '200101')
 where id = '8df02e1f-90b6-4a98-b355-5e9a93de3858'
   and distrito_id is null;

-- 13 · Cámara de Comercio y Producción de Piura – Sala de Directorio —
--      Urb. San Eduardo Mz A lote 02, Piura
-- Misma sede que el auditorio de la misma entidad: SUNAT/RUC declara
-- «PIURA - PIURA - PIURA», CP 200101; OSM: barrio San Eduardo, city Piura.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '200101')
 where id = '61316a16-8dbf-4ec5-ab77-1b10a51ea3b0'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- Talara (Piura)
-- -----------------------------------------------------------------------------

-- 12 · Comunal Gremio de Pescadores del Ñuro — Calle Miguel Grau s/n,
--      frente a la plazuela principal del Ñuro, Talara
-- OSM/Nominatim: El Ñuro es caserío de la ciudad de Los Órganos, provincia
-- Talara. La dirección nombra la localidad; el distrito es Los Órganos.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '200705')
 where id = '96ca611f-b074-498d-b643-4f89122b6abb'
   and distrito_id is null;

-- 17 · Local San Pedro de Gremio de Pescadores — Calle San Pedro, frente al
--      Parque San Pedro, Los Órganos, Talara
-- La dirección nombra el distrito: Los Órganos, provincia Talara. La localidad
-- y el distrito coinciden (mismo nombre), sin ambigüedad en la provincia.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '200705')
 where id = 'e15888db-e7ce-44c1-8943-4269e3edcef5'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- Lima
-- -----------------------------------------------------------------------------

-- 7 · Auditorio de FONDEPES — Av. Petit Thouars 115, Cercado de Lima
-- Web oficial (gob.pe/fondepes): «Sede Central: Av. Petit Thouars 110-115 -
-- Lima - Lima - Lima»; la intranet de FONDEPES la ubica en el Cercado de Lima.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '150101')
 where id = '5d0580dd-ba43-4f1e-8a1b-e25c2d39253b'
   and distrito_id is null;

-- 19 · Local del Gremio de Pescadores de Pucusana — (sin dirección propia)
-- Web oficial (FONDEPES): «Sede Pucusana – Pucusana - Lima». El nombre del
-- gremio y del local corresponde al distrito de Pucusana, único ámbito posible
-- de la caleta (provincia de Lima).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '150124')
 where id = '878aaca3-8ccc-43c3-9c1e-e795416837c0'
   and distrito_id is null;

-- 21 · Sala 1 - Sótano Auditorio de PRODUCE — Calle Uno Oeste 60,
--      Urb. Corpac, San Isidro
-- La dirección nombra el distrito: Urb. Corpac, San Isidro. Es la sede central
-- de PRODUCE (Calle Uno Oeste 60).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '150131')
 where id = '34b5ffd4-d488-46e0-acf2-e36d24f16798'
   and distrito_id is null;

-- 25 · Sala de Reuniones - Piso 11 — Calle Uno Oeste 60, Urb. Corpac, San Isidro
-- Mismo edificio que la Sala 1 (sede central de PRODUCE): distrito San Isidro.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '150131')
 where id = 'ada0a2aa-a97f-479e-92c6-bfaf6110813e'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- Lambayeque
-- -----------------------------------------------------------------------------

-- 9 · Auditorio del Centro del Colegio de Arquitectos de Lambayeque —
--     Calle Juan Cuglievan 140, Chiclayo
-- OSM/Nominatim: Calle Juan Cuglievan, city Chiclayo, CP 14001 (cercado de
-- Chiclayo); el colegio profesional tiene su sede regional en la capital.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '140101')
 where id = '3a9170ac-f7b4-4b0f-8417-0eccbe42cb34'
   and distrito_id is null;

-- 10 · Auditorio del Colegio de Contadores Públicos de Lambayeque —
--      Av. Los Rosales 196, Urb. Santa Victoria, Chiclayo
-- OSM/Nominatim: «Los Rosales, Urbanización Santa Victoria, Chiclayo, 14820»
-- coincide con la dirección. El punto geocodificado (-6.7834) queda al norte
-- del límite norte del distrito La Victoria (-6.7843): distrito Chiclayo.
-- Se descartan las homónimas «Santa Victoria»/«Los Rosales» de José Leonardo
-- Ortiz (CP 14001/14013).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '140101')
 where id = '7cf31ad0-4c8c-4139-aa28-3ecbb97784ee'
   and distrito_id is null;

-- 18 · Local de la Asociación Sociedad Marítima Unión de Pescadores —
--      Av. Augusto B. Leguía 930, San José
-- Web oficial (Gobierno Regional de Lambayeque) y prensa regional:
-- «Asociación Sociedad Marítima Unión de Pescadores de San José» (ASMUP),
-- distrito San José, provincia Lambayeque. Se descarta el San José de
-- Pacasmayo (La Libertad): la entidad es lambayecana.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '140311')
 where id = 'c1f85014-2c6c-4aad-bf98-43a07409a096'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- Tacna
-- -----------------------------------------------------------------------------

-- 14 · Local Colegio de Ingenieros de Tacna — Av. Manuel A. Odría 1562
-- OSM/Nominatim: Av. Manuel A. Odría, city Tacna, CP 23006. La jerarquía
-- administrativa resuelta es distrito Tacna (los sectores vecinos sí se
-- resuelven como Alto de la Alianza o C. G. Albarracín: aquí no ocurre).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '230101')
 where id = 'feeadf4a-2b2b-47c4-ae36-e49ce6b0a06a'
   and distrito_id is null;

-- 16 · Local Gobierno Regional de Tacna - Auditorio — Av. Manuel A. Odría 1245
--      (Villa Panamericana)
-- OSM/Nominatim: «Complejo Deportivo Villa Panamericana» (zona Para / Para
-- Chico, CP 23006) y su reverse geocoding resuelven city=Tacna, es decir
-- distrito Tacna.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '230101')
 where id = 'bfe5a1da-23b0-4b1a-8332-c0c2a7e41fb9'
   and distrito_id is null;

-- 27 · Sala de Usos Múltiples del Centro de Convenciones Jorge Basadre
--      Grohmann — Blondell 114, a espaldas de la Catedral
-- OSM/Nominatim: Calle Blondell, city Tacna, CP 23001 (centro histórico, junto
-- a la Catedral). Existe otra Calle Blondell en Alto de la Alianza, que se
-- descarta por la referencia «a espaldas de la Catedral».
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '230101')
 where id = '81c1915c-446b-4599-8302-b66984c6dee2'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- La Libertad
-- -----------------------------------------------------------------------------

-- 15 · Local Gerencia Regional La Libertad - Sala de Reuniones —
--      Jr. Junín 324, Trujillo
-- OSM/Nominatim: Jirón Junín, city Trujillo, CP 13001 (cercado de Trujillo).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '130101')
 where id = '4adc5a9e-3572-471b-aded-774035fff628'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- Moquegua
-- -----------------------------------------------------------------------------

-- 20 · SALÓN DE CEP ILO — Carretera Costanera Sur Km. 3.5, Puerto de Ilo
-- Web oficial (FONDEPES): «Sede Ilo – Av. Costanera Sur Km. 3.5, Ilo -
-- Moquegua». La dirección nombra el puerto y el distrito de Ilo.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '180301')
 where id = 'b4396e6e-7608-4a4b-8b84-070c1f87e53f'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- Arequipa
-- -----------------------------------------------------------------------------

-- 22 · Sala Principal Centro Cultural de Mollendo — (sin dirección)
-- Sin dirección postal. El recinto se identifica por la ciudad de Mollendo,
-- capital y núcleo urbano del distrito Mollendo (OSM/Nominatim: city Mollendo,
-- CP 04416); no hay otra localidad homónima en el país. Evidencia por nombre
-- de localidad: es el caso menos fino de esta migración.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '040701')
 where id = '02b87f73-cad8-4883-84ae-fcb62f19638d'
   and distrito_id is null;

-- 26 · Sala de Reuniones de Consejo - Arequipa — Calle Bolívar 206, Arequipa
-- Web (La República, Diario El Pueblo, Waze, near-place): la sede del Consejo
-- Regional de Arequipa está en «calle Bolívar 206, en el Cercado», CP 04001.
-- OSM/Nominatim: Calle Simón Bolívar, San Lázaro, city Arequipa (coordenadas
-- -16.3961 / -71.5376, coincidentes). Se descarta la Calle Bolívar de
-- Miraflores (CP 04003) y la de Tiabaya.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '040101')
 where id = 'e0528f13-ca83-4455-bcb9-97abd7a1cbc9'
   and distrito_id is null;

-- -----------------------------------------------------------------------------
-- Ancash (Santa)
-- -----------------------------------------------------------------------------

-- 23 · Sala de Colegio de Ingenieros Nuevo Chimbote — Av. Pacífico Mz C1 Lt 11,
--      Urb. Las Casuarinas 2da Etapa, Nuevo Chimbote
-- La dirección nombra el distrito: Nuevo Chimbote, provincia del Santa.
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '021809')
 where id = 'd21e5d92-ee19-4b1b-a238-ab23d93d753e'
   and distrito_id is null;

-- 24 · Sala de Reuniones - Dirección Regional de Producción de Ancash —
--      Av. Pardo 347, Chimbote
-- OSM/Nominatim: Av. José Pardo, city Chimbote, provincia del Santa (cercado
-- de Chimbote).
update core.locales
   set distrito_id = (select id from core.distritos where ubigeo = '021801')
 where id = '0b5adde0-8167-4178-a319-27c1bce57512'
   and distrito_id is null;

insert into core.migracion_log (clave) values ('48_locales_distritos')
on conflict (clave) do nothing;

commit;

-- =============================================================================
--  Reversión manual (ejecutar a mano, en su propia transacción)
--
--  Devuelve a NULL sólo los 27 locales que esta migración pudo haber rellenado.
--  Es exacto porque todos partían de NULL y la migración nunca sobrescribe un
--  valor existente (`and distrito_id is null`).
-- =============================================================================
--
-- begin;
-- update core.locales
--    set distrito_id = null
--  where id in (
--    '8d7b2ac8-5de9-48bd-8aa8-be587a77c401',  -- 1  COE Ica
--    'eba411ff-cf76-4d97-b395-1bd7d846e7d3',  -- 2  DIREPRO Ica (Pisco)
--    'b08e1c56-a743-483c-aa35-8587c6b2c277',  -- 3  GORE Ica
--    '8119ba24-54a4-4ee2-be8f-2fb94a1836e7',  -- 4  Municipalidad Provincial de Pisco
--    '60010ad0-d3b3-4f1a-9eaf-d23221ae0361',  -- 5  CEP Paita
--    'f0ed2fdc-d98b-41be-b515-d814775e4870',  -- 6  Cámara de Comercio de Piura
--    '5d0580dd-ba43-4f1e-8a1b-e25c2d39253b',  -- 7  FONDEPES
--    '96d1e57e-0aa5-4d42-aee7-5f3fc5f22a54',  -- 8  Municipalidad Provincial de Piura
--    '3a9170ac-f7b4-4b0f-8417-0eccbe42cb34',  -- 9  Colegio de Arquitectos Lambayeque
--    '7cf31ad0-4c8c-4139-aa28-3ecbb97784ee',  -- 10 Colegio de Contadores Lambayeque
--    '8df02e1f-90b6-4a98-b355-5e9a93de3858',  -- 11 GORE Piura
--    '96ca611f-b074-498d-b643-4f89122b6abb',  -- 12 Gremio del Ñuro
--    '61316a16-8dbf-4ec5-ab77-1b10a51ea3b0',  -- 13 Cámara de Comercio (Sala de Directorio)
--    'feeadf4a-2b2b-47c4-ae36-e49ce6b0a06a',  -- 14 Colegio de Ingenieros Tacna
--    '4adc5a9e-3572-471b-aded-774035fff628',  -- 15 Gerencia Regional La Libertad
--    'bfe5a1da-23b0-4b1a-8332-c0c2a7e41fb9',  -- 16 GORE Tacna
--    'e15888db-e7ce-44c1-8943-4269e3edcef5',  -- 17 Gremio Los Órganos
--    'c1f85014-2c6c-4aad-bf98-43a07409a096',  -- 18 Sociedad Marítima Unión de Pescadores
--    '878aaca3-8ccc-43c3-9c1e-e795416837c0',  -- 19 Gremio de Pescadores de Pucusana
--    'b4396e6e-7608-4a4b-8b84-070c1f87e53f',  -- 20 CEP Ilo
--    '34b5ffd4-d488-46e0-acf2-e36d24f16798',  -- 21 PRODUCE Sala 1
--    '02b87f73-cad8-4883-84ae-fcb62f19638d',  -- 22 Centro Cultural de Mollendo
--    'd21e5d92-ee19-4b1b-a238-ab23d93d753e',  -- 23 Colegio de Ingenieros Nuevo Chimbote
--    '0b5adde0-8167-4178-a319-27c1bce57512',  -- 24 Dirección Regional de Producción Ancash
--    'ada0a2aa-a97f-479e-92c6-bfaf6110813e',  -- 25 PRODUCE Piso 11
--    'e0528f13-ca83-4455-bcb9-97abd7a1cbc9',  -- 26 Consejo Regional Arequipa
--    '81c1915c-446b-4599-8302-b66984c6dee2'   -- 27 Centro de Convenciones Jorge Basadre
--  );
-- delete from core.migracion_log where clave = '48_locales_distritos';
-- commit;
