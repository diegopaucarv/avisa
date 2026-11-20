-- =============================================================================
-- AVISA · PREPARACIÓN DE v9 PARA RECIBIR EL LEGADO 2026
-- Base destino : avisa  (sección A del esquema unificado v10)
-- Fuente       : BASE_CONFLICTOS_SOCIALES_2026.xlsx (86 hojas; 4 649 filas en el libro, 4 643 con algún valor)
--
-- ORDEN DE EJECUCIÓN OBLIGATORIO
--   1. backups/backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql  (DDL + catálogos base)
--   2. este script                                     (preparación)
--   3. cargador                                        (legacy.* -> core.*)
--
-- Propiedades: idempotente (se puede repetir), transaccional, no borra datos
--             (solo suelta y recrea la FK de alertas_tempranas.mesa_id, §4.1).
-- Requisitos : PostgreSQL 16 + PostGIS + pgvector.
--
-- Principios aplicados (los que fijó OAIPCS):
--   (a) toda columna legada sin destino recibe una columna nueva NULL-able
--   (b) core.casos.nivel_conflicto_id pasa a NULL-able
--   (c) se modelan las tablas sin destino: capacitaciones, login, intervención
--   (d) se resuelven colisiones (caso #85 área/unidad orgánica)
--   (e) DNI y teléfonos se conservan en core.actor_datos_personales
--   (f) mesas / grupos de diálogo pasan a tabla propia
--   (g) el vínculo alerta <-> demanda se conserva como FK
--   (h) nivel_conflicto se LEE de DIM_Tipo_Caso / FACT_Casos.ID_Tipo (ver §3.1)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. CONTEXTO OBLIGATORIO
--    Hoy 48 tablas de core tienen FORCE ROW LEVEL SECURITY (eran 11 en el DDL
--    v9). Sin un rol que pase las politicas, el INSERT falla (viola el WITH
--    CHECK); lo que queda en silencio es el SELECT, que ve 0 filas.
-- -----------------------------------------------------------------------------
SET LOCAL app.user_id                  = '00000000-0000-0000-0000-000000000001';
SET LOCAL app.rol_codigo             = 'administrador';  -- el parche 15 deriva el nivel del rol
SET LOCAL app.staff_bypass_subject_rls = 'true';

-- NOTA: el cargador debe reemplazar app.user_id por un UUID real de
-- core.usuarios, porque created_by / updated_by tienen FK a esa tabla.


-- =============================================================================
-- 1. CATÁLOGOS SOLICITADOS
--    DIM_Tipo_Tematica (7) · DIM_Tipo_Sector (3) · DIM_Tipo_Actor (3)
--    DIM_Rol_Actor (4)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 Temáticas — 7 filas (TEMA-01..TEMA-07)
--     DEFECTO DE ORIGEN: en la hoja, la descripción de TEMA-03 corresponde a
--     TEMA-04, y la de TEMA-04 es un texto copiado de DIM_Tipo_Caso TC-04
--     ("Ruptura institucional, violencia generalizada e ingobernabilidad").
--     Se conserva el texto crudo en descripcion_legado y se documenta el
--     defecto en nota_calidad. No se inventa la descripción de TEMA-03.
-- -----------------------------------------------------------------------------
ALTER TABLE core.cat_tematicas
  ADD COLUMN IF NOT EXISTS descripcion         TEXT,
  ADD COLUMN IF NOT EXISTS descripcion_legado  TEXT,
  ADD COLUMN IF NOT EXISTS codigo_legado       VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS nota_calidad        TEXT;

INSERT INTO core.cat_tematicas
  (id, nombre, descripcion, descripcion_legado, codigo_legado, nota_calidad)
VALUES
 (1, 'Infraestructura',
  'Conflictos derivados de las limitaciones o brechas en la provisión estatal de bienes públicos físicos, infraestructura productiva o asistencia técnica, sin los cuales se compromete el óptimo desarrollo de las actividades productivas y/o su adecuación a las normas vigentes.',
  'Conflictos derivados de las limitaciones o brechas en la provisión estatal de bienes públicos físicos, infraestructura productiva o asistencia técnica, sin los cuales se compromete el óptimo desarrollo de las actividades productivas y/o su adecuación a las normas vigentes.',
  'TEMA-01', NULL),
 (2, 'Ordenamiento y acceso territorial',
  'Conflictos originados por la superposición de actividades o actores en zonas de pesca o territorios productivos vinculados al ordenamiento espacial del recurso. Incluyen disputas por delimitación de áreas, uso exclusivo de espacios, zonas reservadas o coexistencia con otras actividades productivas.',
  'Conflictos originados por la superposición de actividades o actores en zonas de pesca o territorios productivos vinculados al ordenamiento espacial del recurso. Incluyen disputas por delimitación de áreas, uso exclusivo de espacios, zonas reservadas o coexistencia con otras actividades productivas.',
  'TEMA-02', 'El origen escribe "Ordenanamiento": error tipográfico corregido sólo en nombre.'),
 (3, 'Normatividad',
  NULL, NULL, 'TEMA-03',
  'DEFECTO: la hoja trae aquí la descripción que corresponde a TEMA-04 (distribución de beneficios). Se descarta para no propagar el error; OAIPCS debe redactar la descripción real.'),
 (4, 'Distribución de beneficios',
  'Conflictos vinculados a la forma en que se distribuyen los beneficios económicos y sociales derivados de las actividades productivas o los programas del sector. Incluye disputas por acceso inequitativo a mercados, concentración de cuotas, participación en la cadena de valor o percepciones de favorecimiento competitivo.',
  'Conflictos vinculados a la forma en que se distribuyen los beneficios económicos y sociales derivados de las actividades productivas o los programas del sector. Incluye disputas por acceso inequitativo a mercados, concentración de cuotas, participación en la cadena de valor o percepciones de favorecimiento competitivo.',
  'TEMA-04',
  'DEFECTO: la hoja trae aquí un texto copiado de DIM_Tipo_Caso TC-04. Se reasigna el texto que sí corresponde a esta temática.'),
 (5, 'Gobernanza',
  'Conflictos relacionados con los procesos de toma de decisiones, la legitimidad de las autoridades y las reglas institucionales que regulan la actividad y los espacios comunes. Incluyen disputas por participación, centralización de decisiones, legitimidad representativa y capacidad de los actores para incidir en la gestión del recurso.',
  'Conflictos relacionados con los procesos de toma de decisiones, la legitimidad de las autoridades y las reglas institucionales que regulan la actividad y los espacios comunes. Incluyen disputas por participación, centralización de decisiones, legitimidad representativa y capacidad de los actores para incidir en la gestión del recurso.',
  'TEMA-05', NULL),
 (6, 'Impactos de terceros',
  'Conflictos vinculados con impactos negativos, amenazas o perturbaciones cuyo origen es externo a la cadena productiva: otras industrias, fenómenos naturales, criminalidad o actores que operan fuera del marco de regulación de PRODUCE.',
  'Conflictos vinculados con impactos negativos, amenazas o perturbaciones cuyo origen es externo a la cadena productiva: otras industrias, fenómenos naturales, criminalidad o actores que operan fuera del marco de regulación de PRODUCE.',
  'TEMA-06', NULL),
 (7, 'Otros', 'Otros', 'Otros', 'TEMA-07',
  'La descripción de origen es literalmente "Otros".')
ON CONFLICT DO NOTHING;

SELECT setval(pg_get_serial_sequence('core.cat_tematicas', 'id'),
              (SELECT max(id) FROM core.cat_tematicas));

-- -----------------------------------------------------------------------------
-- 1.2 Subsectores — 3 filas (Sector-01..Sector-03)
--     "Mype e Industria " trae espacio final en el origen: se normaliza.
-- -----------------------------------------------------------------------------
ALTER TABLE core.cat_subsectores
  ADD COLUMN IF NOT EXISTS codigo_legado  VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS id_area_legado VARCHAR(20);

INSERT INTO core.cat_subsectores (id, nombre, codigo_legado, id_area_legado) VALUES
 (1, 'Pesca y Acuicultura',                'Sector-01', 'AR-001'),
 (2, 'Mype e Industria',                   'Sector-02', 'AR-002'),
 (3, 'Gestión y Prevención de Conflictos', 'Sector-03', 'AR-047')
ON CONFLICT DO NOTHING;

SELECT setval(pg_get_serial_sequence('core.cat_subsectores', 'id'),
              (SELECT max(id) FROM core.cat_subsectores));

-- -----------------------------------------------------------------------------
-- 1.3 Tipos de actor — 3 filas (Tipo-Act-01..03) -> ids 1..3
--     El DDL ya siembra los ids 4..7 (NEC, Exportador CITES, CITE, SANIPES);
--     ambos bloques pertenecen al mismo eje (tipo de institución/actor).
-- -----------------------------------------------------------------------------
ALTER TABLE core.cat_tipos_actor
  ADD COLUMN IF NOT EXISTS codigo_legado VARCHAR(50) UNIQUE;

INSERT INTO core.cat_tipos_actor (id, nombre, codigo_legado) VALUES
 (1, 'Actor del Estado',        'Tipo-Act-01'),
 (2, 'Actor Sociedad Civil',    'Tipo-Act-02'),
 (3, 'Actor Privado',           'Tipo-Act-03')
ON CONFLICT DO NOTHING;

SELECT setval(pg_get_serial_sequence('core.cat_tipos_actor', 'id'),
              (SELECT max(id) FROM core.cat_tipos_actor));

-- -----------------------------------------------------------------------------
-- 1.4 Roles de actor — SON DOS EJES DISTINTOS, no caben en una sola tabla
--
--   core.cat_roles_actor  = POSICIÓN relacional en el conflicto
--                           (Principal / Secundario / Tercero)
--                           => origen legado: dim_actores.categoria
--                              ('Actor Primario' / 'Actor Secundario')
--
--   dim_rol_actor         = FUNCIÓN operativa del actor
--                           (Decisor / Proveedor de evidencia / Implementador /
--                            Articulador territorial)
--                           => catálogo propio, ver abajo
--
-- Meter las 4 funciones en cat_roles_actor junto a Principal/Secundario/Tercero
-- sería una mentira semántica que rompe cualquier KPI de influencia.
-- -----------------------------------------------------------------------------
ALTER TABLE core.cat_roles_actor
  ADD COLUMN IF NOT EXISTS codigo_legado VARCHAR(50) UNIQUE;

INSERT INTO core.cat_roles_actor (id, nombre, codigo_legado) VALUES
 (1, 'Principal',      NULL),
 (2, 'Secundario',     NULL),
 (3, 'Tercero',        NULL),
 (7, 'No_determinado', 'categoria.vacia')
ON CONFLICT DO NOTHING;

SELECT setval(pg_get_serial_sequence('core.cat_roles_actor', 'id'),
              (SELECT max(id) FROM core.cat_roles_actor));

CREATE TABLE IF NOT EXISTS core.cat_roles_funcionales (
    id            SMALLINT PRIMARY KEY,
    nombre        VARCHAR(80) NOT NULL UNIQUE,
    descripcion   TEXT,
    codigo_legado VARCHAR(50) UNIQUE
);

INSERT INTO core.cat_roles_funcionales (id, nombre, descripcion, codigo_legado) VALUES
 (1, 'Decisor Principal',        NULL, 'ROL-01'),
 (2, 'Proveedor de evidencia',   NULL, 'ROL-02'),
 (3, 'Implementador',            NULL, 'ROL-03'),
 (4, 'Articulador territorial',  NULL, 'ROL-04')
ON CONFLICT DO NOTHING;


-- =============================================================================
-- 2. CATÁLOGOS ADICIONALES QUE EL LEGADO EXIGE
-- =============================================================================

-- 2.1 Ciclos de intervención (DIM_Intervencion, 4)
CREATE TABLE IF NOT EXISTS core.cat_ciclos_intervencion (
    id            SMALLINT PRIMARY KEY,
    nombre        VARCHAR(80) NOT NULL UNIQUE,
    codigo_legado VARCHAR(50) UNIQUE
);
INSERT INTO core.cat_ciclos_intervencion VALUES
 (1, 'Prevención',                  'Ciclo-001'),
 (2, 'Intervención y tratamiento',  'Ciclo-002'),
 (3, 'Seguimiento',                 'Ciclo-003'),
 (4, 'Gestión del Conocimiento',    'Ciclo-004')
ON CONFLICT DO NOTHING;

-- 2.2 Tipos de organización (DIM_TIPO_ORG, 4 + 3 observados en la hoja)
--     Eje distinto de cat_tipos_actor: tipo de persona jurídica.
CREATE TABLE IF NOT EXISTS core.cat_tipos_organizacion (
    id            SMALLINT PRIMARY KEY,
    nombre        VARCHAR(100) NOT NULL UNIQUE,
    codigo_legado VARCHAR(50) UNIQUE
);
INSERT INTO core.cat_tipos_organizacion VALUES
 (1, 'ASOCIACIÓN',                  'TIPO_ORG_001'),
 (2, 'ASOCIACIÓN DE ASOCIACIONES',  'TIPO_ORG_002'),
 (3, 'SINDICATO',                   'TIPO_ORG_003'),
 (4, 'COOPERATIVA',                 'TIPO_ORG_004'),
 (5, 'GREMIO (no formalizado)',     NULL),
 (6, 'COMITÉ',                      NULL),
 (7, 'FEDERACIÓN',                  NULL)
ON CONFLICT DO NOTHING;

-- 2.3 Perfiles de actor (DIM_Perfil, 3)
CREATE TABLE IF NOT EXISTS core.cat_perfiles_actor (
    id            SMALLINT PRIMARY KEY,
    nombre        VARCHAR(40) NOT NULL UNIQUE,
    codigo_legado VARCHAR(50) UNIQUE
);
INSERT INTO core.cat_perfiles_actor VALUES
 (1, 'Dialogante',   'Perfil-01'),
 (2, 'Legitimante',  'Perfil-02'),
 (3, 'Disruptivo',   'Perfil-03')
ON CONFLICT DO NOTHING;

-- 2.4 Niveles de alerta (DIM_Nivel_Alertas, 4)
--     OJO: esto es un SLA de respuesta, NO un nivel de conflicto.
CREATE TABLE IF NOT EXISTS core.cat_niveles_alerta (
    id            SMALLINT PRIMARY KEY,
    nombre        VARCHAR(60) NOT NULL UNIQUE,
    descripcion   TEXT,
    categoria     VARCHAR(20) CHECK (categoria IN ('Reactivo','Preventivo')),
    sla_horas     SMALLINT,
    codigo_legado VARCHAR(50) UNIQUE
);
INSERT INTO core.cat_niveles_alerta
  (id, nombre, descripcion, categoria, sla_horas, codigo_legado) VALUES
 (1, 'Inmediato (24h)',
  'Requiere despliegue de campo o enlace urgente: orden público o seguridad ciudadana.',
  'Reactivo', 24, 'NA-001'),
 (2, 'Táctico (24h - 48h)',
  'Requiere elaboración de estrategia de contingencia y comunicados.',
  'Preventivo', 48, 'NA-002'),
 (3, 'Preventivo (48h - 72h)',
  'Permite diálogo y/o desactivar medidas de fuerza o acciones de riesgo.',
  'Preventivo', 72, 'NA-003'),
 (4, 'Monitoreo',
  'Seguimiento de indicadores de alertas de posibles riesgos.',
  'Preventivo', NULL, 'NA-004')
ON CONFLICT DO NOTHING;

-- 2.5 Tipos de cambio de estado del caso (DIM_Tipo_Cambio, 6)
CREATE TABLE IF NOT EXISTS core.cat_tipos_cambio_caso (
    id            SMALLINT PRIMARY KEY,
    nombre        VARCHAR(60) NOT NULL UNIQUE,
    descripcion   TEXT,
    codigo_legado VARCHAR(50) UNIQUE
);
INSERT INTO core.cat_tipos_cambio_caso VALUES
 (1, 'Escalada',        'El caso sube de nivel de riesgo',                  'TC-01'),
 (2, 'Desescalada',     'El caso baja de nivel de riesgo',                  'TC-02'),
 (3, 'Cierre',          'El caso se cierra formalmente',                    'TC-03'),
 (4, 'Reapertura',      'El caso se reactiva',                              'TC-04'),
 (5, 'Desestimación',   'El caso se cierra sin intervención',               'TC-05'),
 (6, 'Cambio de fase',  'El caso cambia de fase sin cambio de riesgo',      'TC-06')
ON CONFLICT DO NOTHING;

-- 2.6 Tipos de hecho (FACT_Hechos_Casos.Tipo_Hecho, 9 valores)
CREATE TABLE IF NOT EXISTS core.cat_tipos_hecho (
    id            SMALLINT PRIMARY KEY,
    nombre        VARCHAR(80) NOT NULL UNIQUE
);
INSERT INTO core.cat_tipos_hecho (id, nombre) VALUES
 (1, 'Aprobación de Normatividad'),
 (2, 'Bloqueo'),
 (3, 'Comunicado'),
 (4, 'Comunicado o documento'),
 (5, 'Espacio de diálogo'),
 (6, 'Otro'),
 (7, 'Protesta o Bloqueo'),
 (8, 'Reunión Técnica'),
 (9, 'Visita de campo')
ON CONFLICT DO NOTHING;

-- 2.7 Tipos de capacitación (DIM_Capacitaciones.Tipo_Capacitacion, 1 observado)
CREATE TABLE IF NOT EXISTS core.cat_tipos_capacitacion (
    id     SMALLINT PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL UNIQUE
);
INSERT INTO core.cat_tipos_capacitacion VALUES
 (1, 'Taller'), (2, 'Curso'), (3, 'Charla'), (4, 'Asistencia Técnica')
ON CONFLICT DO NOTHING;

-- 2.8 Tipos de espacio de diálogo (DIM_MESAS_GRUPOS.Tipo_Espacio, 7)
CREATE TABLE IF NOT EXISTS core.cat_tipos_espacio_dialogo (
    id     SMALLINT PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL UNIQUE
);
INSERT INTO core.cat_tipos_espacio_dialogo (id, nombre) VALUES
 (1, 'Comisión Intergubernamental'),
 (2, 'Comisión Multisectorial Permanente'),
 (3, 'Comisión Sectorial'),
 (4, 'Espacio sin norma'),
 (5, 'Grupo de Trabajo Multisectorial'),
 (6, 'Grupo de Trabajo Sectorial'),
 (7, 'Mesa de Diálogo formalizada')
ON CONFLICT DO NOTHING;

-- 2.9 Tipos de documento que faltan para los reportes legados
INSERT INTO core.cat_tipos_documento (id, codigo, nombre) VALUES
 (13, 'reporte_alerta_temprana', 'Reporte de Alerta Temprana (AT)'),
 (14, 'capacitacion',            'Memoria de capacitación'),
 (15, 'otro',                    'Otro (sin clasificar)')
ON CONFLICT DO NOTHING;

-- 2.10 Atributos de especie que el legado trae (DIM_Recurso_Pesca, 37)
ALTER TABLE core.cat_especies
  ADD COLUMN IF NOT EXISTS familia           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS grupo_biologico   VARCHAR(80),
  ADD COLUMN IF NOT EXISTS ambito            VARCHAR(30),
  ADD COLUMN IF NOT EXISTS codigo_legado     VARCHAR(50) UNIQUE;


-- =============================================================================
-- 3. ALTERACIONES A TABLAS v9 EXISTENTES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 (h) nivel_conflicto_id LEÍDO DE DIM_Tipo_Caso
--
--   El legado YA tiene la escala de 4 niveles de la Guía §7.5.1, y es
--   fact_casos.id_tipo -> DIM_Tipo_Caso:
--
--     TC-01 Diferencias       "posiciones distintas... sin acciones de protesta"
--       -> 1 Diferencia
--     TC-02 Controversias     "disputas formales... sin escalamiento"
--       -> 2 Controversia
--     TC-03 Conflicto Activo  "acciones colectivas, protestas o riesgo de violencia"
--       -> 3 Conflicto_social
--     TC-04 Crísis            "ruptura institucional, violencia generalizada..."
--       -> 4 Crisis_social
--
--   Cobertura: 34/35 casos. El caso sin id_tipo queda en NULL (principio b).
--   NO se deriva de id_riesgos ni de id_nivel_alerta: son ejes distintos
--   (§7.5.2 probabilidad de escalamiento / SLA de respuesta).
-- -----------------------------------------------------------------------------
ALTER TABLE core.casos ALTER COLUMN nivel_conflicto_id DROP NOT NULL;

-- 3.2 12/35 casos sólo tienen departamento, no distrito -> NULL permitido.
ALTER TABLE core.casos ALTER COLUMN distrito_principal_id DROP NOT NULL;

ALTER TABLE core.casos
  ADD COLUMN IF NOT EXISTS ciclo_intervencion_id   SMALLINT REFERENCES core.cat_ciclos_intervencion(id),
  ADD COLUMN IF NOT EXISTS pct_avance              NUMERIC(5,2) CHECK (pct_avance BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS resumen_ejecutivo       TEXT,
  ADD COLUMN IF NOT EXISTS region_principal_id     INT REFERENCES core.regiones(id),
  ADD COLUMN IF NOT EXISTS provincia_principal_id  INT REFERENCES core.provincias(id),
  ADD COLUMN IF NOT EXISTS fecha_reapertura        DATE,
  ADD COLUMN IF NOT EXISTS n_reaperturas           SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motivo_cierre           TEXT,
  ADD COLUMN IF NOT EXISTS link_reporte_pdf        VARCHAR(500),
  ADD COLUMN IF NOT EXISTS codigo_legado           VARCHAR(50) UNIQUE;

-- -----------------------------------------------------------------------------
-- 3.3 Alertas: 33 de 83 no tienen caso vinculado en el origen.
--     No se inventan casos sintéticos: caso_id pasa a NULL-able.
-- -----------------------------------------------------------------------------
ALTER TABLE core.alertas_tempranas ALTER COLUMN caso_id DROP NOT NULL;

ALTER TABLE core.alertas_tempranas
  ADD COLUMN IF NOT EXISTS titulo                 VARCHAR(500),
  ADD COLUMN IF NOT EXISTS nivel_alerta_id        SMALLINT REFERENCES core.cat_niveles_alerta(id),
  ADD COLUMN IF NOT EXISTS descripcion_riesgo     TEXT,
  ADD COLUMN IF NOT EXISTS hechos_recientes       TEXT,
  ADD COLUMN IF NOT EXISTS acciones_oaipcs        TEXT,
  ADD COLUMN IF NOT EXISTS paso_actual            SMALLINT,
  ADD COLUMN IF NOT EXISTS fecha_validacion       DATE,
  ADD COLUMN IF NOT EXISTS fecha_remision         DATE,
  ADD COLUMN IF NOT EXISTS estado_legado          VARCHAR(40),
  ADD COLUMN IF NOT EXISTS fuente_tipo            VARCHAR(120),
  ADD COLUMN IF NOT EXISTS fuente_descripcion     TEXT,
  ADD COLUMN IF NOT EXISTS fuente_url             VARCHAR(500),
  ADD COLUMN IF NOT EXISTS distrito_id            INT REFERENCES core.distritos(id),
  ADD COLUMN IF NOT EXISTS sectorista_usuario_id  UUID REFERENCES core.usuarios(id),
  ADD COLUMN IF NOT EXISTS mesa_id                UUID,      -- FK se añade en §4.1
  ADD COLUMN IF NOT EXISTS codigo_legado          VARCHAR(50) UNIQUE;

-- -----------------------------------------------------------------------------
-- 3.4 Demandas
--     (a) el legado sólo tiene descripcion_demanda de texto libre: se conserva
--         íntegra y NO se fabrica la estructura 3P.
--     (g) se conserva el vínculo alerta <-> demanda como FK.
-- -----------------------------------------------------------------------------
ALTER TABLE core.demandas
  ALTER COLUMN caso_id     DROP NOT NULL,
  ALTER COLUMN problema_3p DROP NOT NULL,
  ALTER COLUMN pedido_3p   DROP NOT NULL;

ALTER TABLE core.demandas
  ADD COLUMN IF NOT EXISTS descripcion_demanda          TEXT,
  ADD COLUMN IF NOT EXISTS alerta_id                    UUID REFERENCES core.alertas_tempranas(id),
  ADD COLUMN IF NOT EXISTS tematica_id                  INT REFERENCES core.cat_tematicas(id),
  ADD COLUMN IF NOT EXISTS fecha_registro               DATE,
  ADD COLUMN IF NOT EXISTS tipo_evidencia_legado        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS referencia_evidencia_legado  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS codigo_legado                VARCHAR(50) UNIQUE;

CREATE INDEX IF NOT EXISTS ix_demandas_alerta
  ON core.demandas(alerta_id) WHERE alerta_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3.5 (e) Actores: DNI y teléfonos se conservan.
--     dni del origen es INT en el esquema pero la hoja guarda texto con ceros
--     a la izquierda ('00245199') -> VARCHAR. Teléfonos vienen como float
--     ('222.0', '22302037.0') -> se normalizan en el cargador.
-- -----------------------------------------------------------------------------
ALTER TABLE core.actores
  ADD COLUMN IF NOT EXISTS email_contacto     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cargo_actual       VARCHAR(150),
  ADD COLUMN IF NOT EXISTS nivel_gobierno     VARCHAR(15)
      CHECK (nivel_gobierno IN ('Nacional','Regional','Local','Empresa','Sociedad_Civil')),
  ADD COLUMN IF NOT EXISTS categoria          VARCHAR(40),
  ADD COLUMN IF NOT EXISTS perfil_id          SMALLINT REFERENCES core.cat_perfiles_actor(id),
  ADD COLUMN IF NOT EXISTS rol_funcional_id   SMALLINT REFERENCES core.cat_roles_funcionales(id),
  ADD COLUMN IF NOT EXISTS distrito_id        INT REFERENCES core.distritos(id),
  ADD COLUMN IF NOT EXISTS foto_url           VARCHAR(500),
  ADD COLUMN IF NOT EXISTS activo             BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS perfil_descripcion TEXT,
  ADD COLUMN IF NOT EXISTS abreviatura        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS codigo_legado      VARCHAR(50) UNIQUE;

ALTER TABLE core.actor_datos_personales
  ADD COLUMN IF NOT EXISTS dni           VARCHAR(12),
  ADD COLUMN IF NOT EXISTS email         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS telefono_alt  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS telefono_raw  VARCHAR(50);

-- Índice NORMAL, no único: D43 decidió que los DNI compartidos (45 grupos,
-- 100 filas) van a core.migracion_conflicto y no abortan la carga. El parche 3
-- borra core.ux_actor_dni, así que recrearlo como único contradice esa decisión.
CREATE INDEX IF NOT EXISTS ix_actor_dni
  ON core.actor_datos_personales(dni) WHERE dni IS NOT NULL;

ALTER TABLE core.organizaciones
  ADD COLUMN IF NOT EXISTS direccion            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS fecha_constitucion   DATE,
  ADD COLUMN IF NOT EXISTS tipo_organizacion_id SMALLINT REFERENCES core.cat_tipos_organizacion(id),
  ADD COLUMN IF NOT EXISTS inscripcion_sunarp   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS n_embarcaciones      INT,
  ADD COLUMN IF NOT EXISTS n_armadores          INT,
  ADD COLUMN IF NOT EXISTS foto_url             VARCHAR(500),
  ADD COLUMN IF NOT EXISTS perfil               TEXT,
  ADD COLUMN IF NOT EXISTS abreviatura          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS facebook_url         VARCHAR(500);

-- -----------------------------------------------------------------------------
-- 3.6 (d) COLISIÓN #85 RESUELTA
--     DIM_Area_Responsable (66) y DIM_Unidades_Organicas_Responsa (27) NO son
--     dos niveles: las 27 "unidades" son las MISMAS 27 entidades que 27 de las
--     66 "áreas", con sigla y nombre idénticos (verificado: 27/27).
--     Por tanto: se insertan SÓLO las 66 áreas; la fila de área recibe ambos
--     códigos legados. No se crea jerarquía padre/hijo porque no existe en el
--     origen; padre_id queda disponible por si OAIPCS la define después.
-- -----------------------------------------------------------------------------
ALTER TABLE core.cat_unidades_organicas
  ADD COLUMN IF NOT EXISTS padre_id              INT REFERENCES core.cat_unidades_organicas(id),
  ADD COLUMN IF NOT EXISTS codigo_legado_area    VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS codigo_legado_unidad  VARCHAR(20) UNIQUE,
  ADD COLUMN IF NOT EXISTS estado                VARCHAR(20);

-- -----------------------------------------------------------------------------
-- 3.7 Usuarios internos: sectoristas (15), puntos focales (17), autoridades (2)
--     clave_sectorista / clave_pf / clave_autoridades son credenciales en claro
--     (INT). NO se trasladan tal cual: se usa clave_hash y se fuerza reseteo.
--     Ver decisión D11 en docs/_archivo/MAPA_CARGA_LEGADO_A_V9.md
-- -----------------------------------------------------------------------------
ALTER TABLE core.usuarios
  ADD COLUMN IF NOT EXISTS dni           VARCHAR(12),
  ADD COLUMN IF NOT EXISTS telefono      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cargo         VARCHAR(150),
  ADD COLUMN IF NOT EXISTS foto_url      VARCHAR(500),
  ADD COLUMN IF NOT EXISTS clave_hash    TEXT,
  ADD COLUMN IF NOT EXISTS codigo_legado VARCHAR(50) UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_dni
  ON core.usuarios(dni) WHERE dni IS NOT NULL;

-- 3.8 Cronología, historial y documentos
ALTER TABLE core.caso_cronologia
  ADD COLUMN IF NOT EXISTS tipo_hecho_id          SMALLINT REFERENCES core.cat_tipos_hecho(id),
  ADD COLUMN IF NOT EXISTS es_hecho_critico       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sectorista_usuario_id  UUID REFERENCES core.usuarios(id),
  ADD COLUMN IF NOT EXISTS link_evidencia         VARCHAR(500),
  ADD COLUMN IF NOT EXISTS tipo_evidencia_legado  VARCHAR(80),
  ADD COLUMN IF NOT EXISTS codigo_legado          VARCHAR(50) UNIQUE;

ALTER TABLE core.caso_estado_historial
  ADD COLUMN IF NOT EXISTS tipo_cambio_id SMALLINT REFERENCES core.cat_tipos_cambio_caso(id),
  ADD COLUMN IF NOT EXISTS codigo_legado  VARCHAR(50) UNIQUE;

ALTER TABLE core.documentos
  ADD COLUMN IF NOT EXISTS codigo_legado VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS estado        VARCHAR(40),
  ADD COLUMN IF NOT EXISTS distrito_id   INT REFERENCES core.distritos(id),
  ADD COLUMN IF NOT EXISTS url_lista     VARCHAR(500),
  ADD COLUMN IF NOT EXISTS url_foto      VARCHAR(500);

-- 3.9 casos_actores: el legado no trae nivel de influencia ni posición.
ALTER TABLE core.casos_actores
  ALTER COLUMN nivel_influencia SET DEFAULT 50,
  ALTER COLUMN posicion         SET DEFAULT 'Neutral';


-- =============================================================================
-- 4. TABLAS NUEVAS  (principios c, d, f)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 4.1 (f) Mesas y grupos de diálogo — DIM_MESAS_GRUPOS (21 filas x 23 columnas)
--     core.reuniones_dialogo son reuniones puntuales y siempre cuelgan de un
--     caso; no sirven para espacios permanentes con base legal y vigencia.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.mesas_dialogo (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                    VARCHAR(50) NOT NULL UNIQUE,      -- OAIPCS-001
    tipo_espacio_id           SMALLINT REFERENCES core.cat_tipos_espacio_dialogo(id),
    linea_oaipcs              VARCHAR(60),
    titulo                    VARCHAR(255) NOT NULL,
    tipo_instrumento          VARCHAR(80),
    base_legal                VARCHAR(150),
    fecha_norma               DATE,
    prorrogas_modificatorias  TEXT,
    fecha_instalacion         DATE,
    naturaleza                VARCHAR(30)
        CHECK (naturaleza IN ('Permanente','Temporal','No definida')),
    fecha_fin_vigencia        DATE,
    estado_vigencia           VARCHAR(30),
    objetivo                  TEXT,
    rol_produce               VARCHAR(40),
    ambito_departamento       TEXT,
    doc_designacion           TEXT,
    link_evidencia            VARCHAR(500),
    sectorista_usuario_id     UUID REFERENCES core.usuarios(id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    origen_dato               VARCHAR(20) NOT NULL DEFAULT 'AVISA_HISTORICO'
        CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    nivel_clasificacion       SMALLINT NOT NULL DEFAULT 2
        REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX IF NOT EXISTS ix_mesas_tipo ON core.mesas_dialogo(tipo_espacio_id);
CREATE INDEX IF NOT EXISTS ix_mesas_vigencia ON core.mesas_dialogo(fecha_fin_vigencia);

-- Titular y alterno son personas, no atributos: van a filas.
CREATE TABLE IF NOT EXISTS core.mesa_miembros (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mesa_id         UUID NOT NULL REFERENCES core.mesas_dialogo(id) ON DELETE CASCADE,
    rol             VARCHAR(30) NOT NULL
        CHECK (rol IN ('Presidente','Secretario_tecnico','Titular','Alterno','Integrante','Invitado')),
    actor_uid       UUID REFERENCES core.actores(actor_uid),
    nombre_texto    VARCHAR(255),          -- cuando no se puede resolver el actor
    doc_designacion VARCHAR(255),
    valid_from      DATE,
    valid_to        DATE,
    CHECK (actor_uid IS NOT NULL OR nombre_texto IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_mesa_miembros_mesa ON core.mesa_miembros(mesa_id);

-- FK diferida de alertas.mesa_id (la columna se creó en §3.3)
ALTER TABLE core.alertas_tempranas
  DROP CONSTRAINT IF EXISTS alertas_tempranas_mesa_id_fkey;
ALTER TABLE core.alertas_tempranas
  ADD CONSTRAINT alertas_tempranas_mesa_id_fkey
  FOREIGN KEY (mesa_id) REFERENCES core.mesas_dialogo(id);

-- -----------------------------------------------------------------------------
-- 4.2 (c) Capacitaciones — DIM_Capacitaciones (1) + BRIDGE (9)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.capacitaciones (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo           VARCHAR(50) NOT NULL UNIQUE,      -- CAP-2026-001
    tipo_id          SMALLINT REFERENCES core.cat_tipos_capacitacion(id),
    titulo           VARCHAR(255) NOT NULL,
    objetivo         TEXT,
    lugar            VARCHAR(255),
    distrito_id      INT REFERENCES core.distritos(id),
    modalidad        VARCHAR(40),
    fecha_inicio     DATE,
    fecha_fin        DATE,
    duracion         VARCHAR(60),
    url_documento    VARCHAR(500),
    estado           VARCHAR(40),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    origen_dato      VARCHAR(20) NOT NULL DEFAULT 'AVISA_HISTORICO'
        CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2
        REFERENCES core.cat_clasificacion(nivel)
);

CREATE TABLE IF NOT EXISTS core.capacitacion_participantes (
    capacitacion_id UUID NOT NULL REFERENCES core.capacitaciones(id) ON DELETE CASCADE,
    actor_uid       UUID NOT NULL REFERENCES core.actores(actor_uid),
    inscrito        BOOLEAN NOT NULL DEFAULT TRUE,
    culmino         BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (capacitacion_id, actor_uid)
);

-- -----------------------------------------------------------------------------
-- 4.3 (c) Login / auditoría de accesos — LOG_Accesos (857 filas)
--     Es traza de seguridad: nivel de clasificación 3.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.log_accesos (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha               TIMESTAMPTZ NOT NULL,
    dni                 VARCHAR(12),
    nombre              VARCHAR(255),
    rol_declarado       VARCHAR(60),
    resultado           VARCHAR(10) NOT NULL CHECK (resultado IN ('OK','FALLIDO')),
    usuario_id          UUID REFERENCES core.usuarios(id),
    origen              VARCHAR(20) NOT NULL DEFAULT 'AVISA_HISTORICO',
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 3
        REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX IF NOT EXISTS ix_log_accesos_fecha ON core.log_accesos(fecha DESC);
CREATE INDEX IF NOT EXISTS ix_log_accesos_dni   ON core.log_accesos(dni);

-- -----------------------------------------------------------------------------
-- 4.4 Locales / sedes de reunión — DIM_Locales (27)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.locales (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo                VARCHAR(50) NOT NULL UNIQUE,
    nombre                VARCHAR(255) NOT NULL,
    distrito_id           INT REFERENCES core.distritos(id),
    direccion             VARCHAR(255),
    ubicacion_ref         VARCHAR(255),
    foto_url              VARCHAR(500),
    aforo                 INT,
    ingresos              VARCHAR(100),
    tiene_proyector       BOOLEAN,
    tiene_equipos_computo BOOLEAN,
    tiene_audio_micro     BOOLEAN,
    contacto_nombre       VARCHAR(255),
    contacto_celular      VARCHAR(50),
    contacto_email        VARCHAR(255),
    recomendacion         TEXT,
    activo                BOOLEAN NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- 4.5 Envíos y suscripciones — LOG_Envios (17) + columnas de envío de la hoja
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.envios_comunicacion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              VARCHAR(50) UNIQUE,
    fecha_envio         TIMESTAMPTZ NOT NULL,
    canal               VARCHAR(20) NOT NULL CHECK (canal IN ('Correo','WhatsApp','Otro')),
    entidad_tipo        VARCHAR(30),
    entidad_id          UUID,
    remitente_usuario_id UUID REFERENCES core.usuarios(id),
    rol_remitente       VARCHAR(60),
    destinatario_texto  TEXT,
    url_pdf             VARCHAR(500),
    resultado           VARCHAR(255),
    observacion         TEXT
);

CREATE TABLE IF NOT EXISTS core.suscripcion_notificacion (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unidad_id             INT REFERENCES core.cat_unidades_organicas(id),
    recibe_alerta         BOOLEAN NOT NULL DEFAULT FALSE,
    recibe_clima_social   BOOLEAN NOT NULL DEFAULT FALSE,
    recibe_reporte_rapido BOOLEAN NOT NULL DEFAULT FALSE,
    canal_preferido       VARCHAR(30),
    activo                BOOLEAN NOT NULL DEFAULT TRUE,
    codigo_legado         VARCHAR(50) UNIQUE
);

-- -----------------------------------------------------------------------------
-- 4.6 Especies por alerta — BRIDGE_Alerta_Recurso (32)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.alerta_especies (
    alerta_id  UUID NOT NULL REFERENCES core.alertas_tempranas(id) ON DELETE CASCADE,
    especie_id SMALLINT NOT NULL REFERENCES core.cat_especies(id),
    PRIMARY KEY (alerta_id, especie_id)
);

-- -----------------------------------------------------------------------------
-- 4.7 Actores por documento y territorio por usuario
--     (bridges reporte/clima -> actor, y BRIDGE_Sectorista_Departamento)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.documento_actores (
    documento_id UUID NOT NULL REFERENCES core.documentos(id) ON DELETE CASCADE,
    actor_uid    UUID NOT NULL REFERENCES core.actores(actor_uid),
    rol          VARCHAR(40),
    es_principal BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (documento_id, actor_uid)
);

CREATE TABLE IF NOT EXISTS core.usuario_territorio (
    usuario_id UUID NOT NULL REFERENCES core.usuarios(id) ON DELETE CASCADE,
    region_id  INT  NOT NULL REFERENCES core.regiones(id),
    PRIMARY KEY (usuario_id, region_id)
);

COMMIT;


-- =============================================================================
-- 5. VERIFICACIÓN POST-EJECUCIÓN
-- =============================================================================
-- Catálogos solicitados
--   SELECT * FROM core.cat_tematicas            ORDER BY id;   -- 7 filas
--   SELECT * FROM core.cat_subsectores          ORDER BY id;   -- 3 filas
--   SELECT id, nombre, codigo_legado FROM core.cat_tipos_actor  ORDER BY id;  -- 1..7
--   SELECT id, nombre, codigo_legado FROM core.cat_roles_actor  ORDER BY id;  -- 1,2,3,4,5,6,7
--   SELECT * FROM core.cat_roles_funcionales    ORDER BY id;   -- 4 filas
--
-- Restricciones relajadas (deben devolver 'YES' en is_nullable)
--   SELECT table_name, column_name, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'core'
--      AND (table_name, column_name) IN (
--            ('casos','nivel_conflicto_id'),
--            ('casos','distrito_principal_id'),
--            ('alertas_tempranas','caso_id'),
--            ('demandas','caso_id'),
--            ('demandas','problema_3p'),
--            ('demandas','pedido_3p'));
--
-- Tablas nuevas (deben existir las 11: estas 9 más documento_actores y
-- usuario_territorio, que crea §4.7)
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema='core'
--      AND table_name IN ('mesas_dialogo','mesa_miembros','capacitaciones',
--                         'capacitacion_participantes','log_accesos','locales',
--                         'envios_comunicacion','suscripcion_notificacion',
--                         'alerta_especies');
--
-- Ningún catálogo normativo tocado (cat_niveles_conflicto sigue con 4 filas)
--   SELECT * FROM core.cat_niveles_conflicto ORDER BY id;
