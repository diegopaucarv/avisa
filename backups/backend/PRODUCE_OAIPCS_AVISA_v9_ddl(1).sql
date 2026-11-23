-- =====================================================================
-- PRODUCE-OAIPCS / AVISA · DDL unificado v9
-- =====================================================================
-- Ensamblado programáticamente a partir de 3 archivos fuente, en el
-- orden de ejecución probado contra PostgreSQL 16.15 + PostGIS 3.4 +
-- pgvector el 2026-10-28 (0 errores tras las correcciones listadas más
-- abajo; log completo de la corrida en el documento v9.md, Anexo D):
--
--   1) PRODUCE_OAIPCS_ddl_v8_3.sql   — ya incluye v8.2 núcleo + expansión
--      verbatim (verificado por diff estructural: 114/115 tablas de v8.2
--      idénticas byte-a-byte dentro de v8.3; la única diferencia es un
--      comentario). No se vuelven a cargar v8_2_nucleo_ddl.sql ni
--      v8_2_expansion_ddl.sql por separado: duplicarían CREATE TABLE.
--   2) v8_4_domain_ddl_probado.sql   — SOLO la parte domain.*/model.*/
--      config.* (schemas, tablas, triggers, RLS). Se omite su bloque
--      inicial de policy.* (schema mínimo standalone que el autor usó
--      para poder probar el pivote aislado): v8.3 ya trae policy.* real
--      y más completo (policy.gobierno, policy.titular, policy.escenario,
--      policy.escenario_regla, que el stub no tenía).
--   3) deepseek_sql_20261027_b8ecc6.sql (delta v9, CORREGIDO) — ind.*,
--      chat.* (14 tablas), proteccion.*, config.a2_transiciones,
--      config.guardrail_contract, config.schema_registry,
--      core.riesgo_social_ordinal, core.acuerdo_ospa_sni,
--      core.cat_tipos_fuente_integracion, core.feature_flags,
--      territorio.{parque_industrial,cuadricula_sismica,zona_pesca,
--      expansion_informal}, mype.*, pesca.* (tablas reales — ver nota
--      de reconciliación de arquitectura en v9.md §0.6), agent.plantilla_prompt,
--      guardrails G16-G18, seeds de policy.regla/config.parametro/
--      model.model_card/config.aplicacion, y RLS.
--
-- Las 6 correcciones aplicadas a (3) tras probarlo en Postgres real están
-- marcadas en el cuerpo con "NOTA DE CORRECCIÓN (validado en Postgres 16)":
--   a) DROP CONSTRAINT con nombre mal adivinado en ind.resultado
--      (ind_resultado_..._key -> resultado_..._key: Postgres no antepone
--      el schema al nombre por defecto de una constraint).
--   b) mismo error en avisa.raw_ingest (avisa_raw_ingest_fuente_check ->
--      raw_ingest_fuente_check).
--   c) dos filas sembradas en config.a2_transiciones con la misma clave
--      (estado_desde, estado_hasta, evento) — violaban el UNIQUE;
--      se fusionaron en una sola con el guard combinado (OR).
--   d) columna GENERATED ALWAYS ... STORED usando CURRENT_DATE en
--      mype.ejecucion_nec.dias_mora — Postgres exige que la expresión de
--      una columna generada sea inmutable; CURRENT_DATE no lo es. Se
--      acotó el cálculo a los casos con fecha_pago_efectivo (sí inmutable)
--      y se añadió una vista, mype.v_ejecucion_nec_mora_vigente, para la
--      mora "a hoy" de lotes aún impagos.
--   e) seed de policy.regla (10 normas N-*): usaba tipo_regla_id=1
--      asumiendo una tabla policy.cat_tipos_regla distinta (la del stub
--      que se omitió); en la tabla real de v8.3, tipo_regla_id=1 es
--      'prioridad_tematica' (exige clave 'tema'), no "norma". Se corrigió
--      a tipo_regla_id=5 ('restriccion', exige clave 'condicion') y se
--      añadió el fuente_documento_id que regla_check2 exige para clase
--      'N'. De paso, la cita "D.Leg. 1192" para Compras a MYPErú (heredada
--      de v8.3 y del batch C4/C5/C6) se verificó por búsqueda web y es
--      incorrecta: la norma real es el D.Leg. N.° 1414 (reglamentado por
--      el D.S. N.° 004-2019-PRODUCE; el programa en sí lo crea el D.S.
--      N.° 013-2021-PRODUCE).
--   f) ciclo config.aplicacion <-> model.model_card (un agente 'activo'
--      exige modelo_card_id; faltaban las 4 model_card de tipo 'llm' que
--      gobiernan A1/A2/A3/Critic). Se insertan las aplicaciones como
--      'propuesta', se insertan las 4 tarjetas LLM que faltaban, y se
--      activa todo al final.
--   g) el loop de RLS de chat.* intentaba aplicar una política por
--      nivel_clasificacion a chat.rama y chat.ref, que no tienen esa
--      columna (son punteros, no contenido clasificado). Se sacaron del
--      loop y reciben su propia política vía EXISTS contra chat.repositorio.
--
-- Requiere extensiones: vector (pgvector), postgis, pgcrypto, btree_gist.
-- Probado end-to-end: 254 tablas, 21 vistas, 25 schemas, 0 errores.
-- =====================================================================

-- =====================================================================
-- PRODUCE-OAIPCS · DDL v8.3 completo = Sección 20 (20.0–20.19) + Sección 14 (14.1–14.5) + Sección 20 (20.20–20.28)
-- Probado en PostgreSQL 16 con pgvector 0.6. Los errores 'schema already exists' de la Sección 14 son inocuos.
-- =====================================================================
-- =====================================================================
-- DDL v8.3 — Sistema de Inteligencia Sectorial PRODUCE-OAIPCS
-- Requiere: PostgreSQL >= 15 (NULLS NOT DISTINCT), extensión pgvector.
-- Opcionales (no validadas en sandbox): btree_gist, pg_trgm, pg_cron, postgis.
-- Cada tabla de negocio incluye el bloque estándar de auditoría (ver 3.2).
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS kag;
CREATE SCHEMA IF NOT EXISTS territorio;
CREATE SCHEMA IF NOT EXISTS ctx;
CREATE SCHEMA IF NOT EXISTS avisa;
CREATE SCHEMA IF NOT EXISTS agent;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS forecast;
CREATE SCHEMA IF NOT EXISTS economic;
CREATE SCHEMA IF NOT EXISTS community;
CREATE SCHEMA IF NOT EXISTS consultation;
CREATE SCHEMA IF NOT EXISTS impact;

CREATE TABLE core.cat_clasificacion (
    nivel SMALLINT PRIMARY KEY,
    nombre VARCHAR(20) NOT NULL UNIQUE
);
INSERT INTO core.cat_clasificacion VALUES (1,'Publico'),(2,'Reservado'),(3,'Confidencial');

CREATE TABLE core.entidades (            -- tenant: permite que otro ministerio adopte el sistema
    id SMALLINT PRIMARY KEY,
    siglas VARCHAR(20) NOT NULL UNIQUE,
    nombre VARCHAR(255) NOT NULL
);
INSERT INTO core.entidades VALUES (1,'PRODUCE','PRODUCE');

CREATE TABLE core.cat_niveles_conflicto (   -- Guía §7.5.1: 4 niveles (los HECHOS observables)
    id SMALLINT PRIMARY KEY, codigo VARCHAR(30) NOT NULL UNIQUE, nombre VARCHAR(50) NOT NULL, orden SMALLINT NOT NULL
);
INSERT INTO core.cat_niveles_conflicto VALUES
 (1,'Diferencia','Diferencia',1),(2,'Controversia','Controversia',2),
 (3,'Conflicto_social','Conflicto social',3),(4,'Crisis_social','Crisis social',4);

-- ---------- Gobernanza de core.cat_niveles_conflicto: solo el admin, con reversión ----------
-- Los 4 niveles vienen de la Guía (RM N.° 00207-2026-PRODUCE): no son un catálogo técnico libre.
-- Nadie escribe aquí con un INSERT/UPDATE/DELETE directo (el trigger de abajo lo bloquea); todo
-- cambio pasa por core.aplicar_cambio_normativo(), que exige quién aprobó y con qué norma, y que
-- queda registrado para poder revertirse exactamente si la decisión del admin cambia.
CREATE TABLE core.cambio_normativo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tabla_objetivo VARCHAR(60) NOT NULL,              -- 'core.cat_niveles_conflicto'
    accion VARCHAR(10) NOT NULL CHECK (accion IN ('insertar','modificar','desactivar')),
    fila_id SMALLINT,                                 -- id afectado (NULL si accion='insertar' y aún no existe)
    payload_antes JSONB,                              -- estado previo exacto (NULL si accion='insertar')
    payload_despues JSONB NOT NULL,                   -- estado a aplicar
    norma_referencia VARCHAR(120) NOT NULL,            -- 'RM N.° 00207-2026-PRODUCE' o la que la reemplace
    solicitado_por UUID NOT NULL REFERENCES core.usuarios(id),
    aprobado_por UUID REFERENCES core.usuarios(id),    -- solo el admin; sin esto no se puede aplicar
    aprobado_en TIMESTAMPTZ,
    aplicado_en TIMESTAMPTZ,
    revertido_en TIMESTAMPTZ,
    revertido_por UUID REFERENCES core.usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (aplicado_en IS NULL OR aprobado_por IS NOT NULL)
);
CREATE INDEX ix_cambio_normativo_tabla ON core.cambio_normativo(tabla_objetivo, aplicado_en DESC);

CREATE FUNCTION core.bloquear_escritura_directa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('app.cambio_normativo_en_curso', true), '') <> 'true' THEN
    RAISE EXCEPTION 'core.%: escritura directa no permitida. Use core.aplicar_cambio_normativo() — este catálogo representa la tipología oficial de la Guía (RM N.° 00207-2026-PRODUCE) y solo cambia por decisión del admin.', TG_TABLE_NAME;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_bloquear_niveles_conflicto BEFORE INSERT OR UPDATE OR DELETE ON core.cat_niveles_conflicto
  FOR EACH ROW EXECUTE FUNCTION core.bloquear_escritura_directa();

CREATE FUNCTION core.aplicar_cambio_normativo(p_cambio_id uuid, p_aprobado_por uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c core.cambio_normativo%ROWTYPE;
BEGIN
  SELECT * INTO c FROM core.cambio_normativo WHERE id = p_cambio_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'cambio_normativo % no existe', p_cambio_id; END IF;
  IF c.aplicado_en IS NOT NULL THEN RAISE EXCEPTION 'cambio_normativo % ya fue aplicado', p_cambio_id; END IF;
  PERFORM set_config('app.cambio_normativo_en_curso', 'true', true);
  IF c.accion = 'insertar' THEN
    INSERT INTO core.cat_niveles_conflicto (id, codigo, nombre, orden)
    SELECT (c.payload_despues->>'id')::smallint, c.payload_despues->>'codigo', c.payload_despues->>'nombre', (c.payload_despues->>'orden')::smallint;
  ELSIF c.accion = 'modificar' THEN
    UPDATE core.cat_niveles_conflicto SET codigo = c.payload_despues->>'codigo', nombre = c.payload_despues->>'nombre',
           orden = (c.payload_despues->>'orden')::smallint WHERE id = c.fila_id;
  ELSIF c.accion = 'desactivar' THEN
    DELETE FROM core.cat_niveles_conflicto WHERE id = c.fila_id;
  END IF;
  PERFORM set_config('app.cambio_normativo_en_curso', 'false', true);
  UPDATE core.cambio_normativo SET aprobado_por = p_aprobado_por, aprobado_en = now(), aplicado_en = now() WHERE id = p_cambio_id;
END $$;

CREATE FUNCTION core.revertir_cambio_normativo(p_cambio_id uuid, p_revertido_por uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c core.cambio_normativo%ROWTYPE;
BEGIN
  SELECT * INTO c FROM core.cambio_normativo WHERE id = p_cambio_id FOR UPDATE;
  IF c.aplicado_en IS NULL THEN RAISE EXCEPTION 'cambio_normativo % nunca se aplicó, no hay nada que revertir', p_cambio_id; END IF;
  IF c.revertido_en IS NOT NULL THEN RAISE EXCEPTION 'cambio_normativo % ya fue revertido', p_cambio_id; END IF;
  PERFORM set_config('app.cambio_normativo_en_curso', 'true', true);
  IF c.accion = 'insertar' THEN
    DELETE FROM core.cat_niveles_conflicto WHERE id = (c.payload_despues->>'id')::smallint;
  ELSIF c.accion = 'modificar' THEN
    UPDATE core.cat_niveles_conflicto SET codigo = c.payload_antes->>'codigo', nombre = c.payload_antes->>'nombre',
           orden = (c.payload_antes->>'orden')::smallint WHERE id = c.fila_id;
  ELSIF c.accion = 'desactivar' THEN
    INSERT INTO core.cat_niveles_conflicto (id, codigo, nombre, orden)
    SELECT c.fila_id, c.payload_antes->>'codigo', c.payload_antes->>'nombre', (c.payload_antes->>'orden')::smallint;
  END IF;
  PERFORM set_config('app.cambio_normativo_en_curso', 'false', true);
  UPDATE core.cambio_normativo SET revertido_en = now(), revertido_por = p_revertido_por WHERE id = p_cambio_id;
END $$;

CREATE TABLE core.cat_niveles_riesgo (      -- Guía §7.5.2: probabilidad de escalamiento (eje distinto al nivel)
    id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE, orden SMALLINT NOT NULL
);
INSERT INTO core.cat_niveles_riesgo VALUES (1,'Bajo',1),(2,'Moderado',2),(3,'Alto',3);

CREATE TABLE core.cat_prioridades_atencion ( -- Anexo 15, col. 10
    id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE, orden SMALLINT NOT NULL
);
INSERT INTO core.cat_prioridades_atencion VALUES (1,'Urgente',1),(2,'Moderado',2),(3,'Bajo',3);

CREATE TABLE core.cat_prioridades_alerta (   -- Anexo 3: SLA por prioridad
    id SMALLINT PRIMARY KEY, codigo VARCHAR(30) NOT NULL UNIQUE, sla_horas SMALLINT
);
INSERT INTO core.cat_prioridades_alerta VALUES
 (1,'Critica_Inmediata',24),(2,'Urgente',48),(3,'Temprana',72),(4,'Seguimiento',NULL);

CREATE TABLE core.cat_estados_caso (         -- A VALIDAR con OAIPCS (la Guía no lo enumera)
    id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE, es_activo BOOLEAN NOT NULL
);
INSERT INTO core.cat_estados_caso VALUES (1,'Activo',TRUE),(2,'En_seguimiento',TRUE),(3,'Resuelto',FALSE),(4,'Archivado',FALSE);

CREATE TABLE core.cat_alcances_geograficos (  -- Anexo 14, col. 6
    id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE
);
INSERT INTO core.cat_alcances_geograficos VALUES (1,'Norte'),(2,'Centro'),(3,'Sur'),(4,'Oriente'),(5,'Nacional');

CREATE TABLE core.cat_estados_compromiso (   -- Protocolo SGSD/SSGC: 2 niveles en un catálogo
    id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE,
    categoria VARCHAR(10) NOT NULL CHECK (categoria IN ('Abierto','Cerrado')),
    es_terminal BOOLEAN NOT NULL
);
INSERT INTO core.cat_estados_compromiso VALUES
 (1,'Por_iniciar','Abierto',FALSE),(2,'En_proceso','Abierto',FALSE),
 (3,'Cumplido','Cerrado',TRUE),(4,'Redefinido','Cerrado',TRUE),(5,'Desestimado','Cerrado',TRUE);

CREATE TABLE core.cat_estados_hito (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE, es_terminal BOOLEAN NOT NULL
);
INSERT INTO core.cat_estados_hito VALUES
 (1,'Registrado',FALSE),(2,'En_ejecucion',FALSE),(3,'Paralizado',FALSE),(4,'Cumplido',TRUE),(5,'Desestimado',TRUE);

CREATE TABLE core.cat_pip_fases (id SMALLINT PRIMARY KEY, nombre VARCHAR(30) NOT NULL UNIQUE, orden SMALLINT NOT NULL);
INSERT INTO core.cat_pip_fases VALUES (1,'Programacion',1),(2,'Pre_inversion',2),(3,'Inversion',3),
 (4,'Ejecucion',4),(5,'Funcionamiento',5),(6,'Desactivado',6);
CREATE TABLE core.cat_pip_etapas (           -- 12 etapas / ~32 hitos del Protocolo: cargar desde su Anexo
    id SMALLINT PRIMARY KEY, fase_id SMALLINT NOT NULL REFERENCES core.cat_pip_fases(id),
    numero SMALLINT NOT NULL, nombre VARCHAR(120) NOT NULL, UNIQUE (fase_id, numero)
);

CREATE TABLE core.cat_tipos_reunion (        -- vocabulario PCM (SGSD); Anexo 16 PRODUCE usa además 'programada'
    id SMALLINT PRIMARY KEY, codigo VARCHAR(40) NOT NULL UNIQUE
);
INSERT INTO core.cat_tipos_reunion VALUES (1,'Asistencia_Tecnica'),(2,'Reunion_Preparatoria'),(3,'Reunion_Ordinaria_Plenaria'),(4,'Otra');

CREATE TABLE core.cat_factores_contexto (    -- reemplaza los 'niveles' inventados (AlertaClimatica / CrisisExportadora)
    id SMALLINT PRIMARY KEY, codigo VARCHAR(30) NOT NULL UNIQUE, nombre VARCHAR(80) NOT NULL
);
INSERT INTO core.cat_factores_contexto VALUES
 (1,'climatico','Factor climático/oceanográfico'),(2,'exportador','Afectación exportadora'),
 (3,'geopolitico','Factor geopolítico'),(4,'sanitario','Factor sanitario'),(5,'social_vulnerabilidad','Vulnerabilidad social');

CREATE TABLE core.cat_subsectores (id SERIAL PRIMARY KEY, nombre VARCHAR(100) NOT NULL UNIQUE);
CREATE TABLE core.cat_tematicas (id SERIAL PRIMARY KEY, nombre VARCHAR(100) NOT NULL UNIQUE);
CREATE TABLE core.cat_unidades_organicas (
    id SERIAL PRIMARY KEY, entidad_id SMALLINT NOT NULL DEFAULT 1 REFERENCES core.entidades(id),
    siglas VARCHAR(20) NOT NULL, nombre_completo VARCHAR(255) NOT NULL, UNIQUE (entidad_id, siglas)
);
CREATE TABLE core.cat_tipos_actor (id SERIAL PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE);   -- Social/Público/Privado
CREATE TABLE core.cat_roles_actor (id SERIAL PRIMARY KEY, nombre VARCHAR(50) NOT NULL UNIQUE);   -- Principal/Secundario/Tercero
CREATE TABLE core.cat_tipos_documento (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(40) NOT NULL UNIQUE, nombre VARCHAR(120) NOT NULL,
    anexo_numero SMALLINT, esquema_json JSONB          -- JSON Schema de contenido_json por tipo
);
INSERT INTO core.cat_tipos_documento (id,codigo,nombre,anexo_numero) VALUES
 (1,'reporte_rapido','Reporte Rápido (RR)',NULL),(2,'clima_social_general','Clima Social General',4),
 (3,'clima_social_focalizado','Clima Social Focalizado',5),(4,'par','Plan de Acción Rápida',6),
 (5,'pae','Plan de Acción Estratégico',7),(6,'analisis_caso','Análisis de Caso',8),
 (7,'argumentario','Argumentario Institucional',9),(8,'acta','Acta de Acuerdo',10),
 (9,'reporte_actividad','Reporte de Actividad',11),(10,'ayuda_memoria','Ayuda Memoria',12),
 (11,'relatoria','Relatoría',13),(12,'informe_oficial','Informe/Reporte institucional (POI, Willaqniki, bimestral…)',NULL);
CREATE TABLE core.cat_especies (
    id SMALLINT PRIMARY KEY, nombre_comun VARCHAR(80) NOT NULL UNIQUE, nombre_cientifico VARCHAR(120)
);

CREATE TABLE core.regiones (
    id SERIAL PRIMARY KEY, ubigeo CHAR(2) NOT NULL UNIQUE CHECK (ubigeo ~ '^[0-9]{2}$'), nombre VARCHAR(100) NOT NULL UNIQUE
);
CREATE TABLE core.provincias (
    id SERIAL PRIMARY KEY, region_id INT NOT NULL REFERENCES core.regiones(id),
    ubigeo CHAR(4) NOT NULL UNIQUE CHECK (ubigeo ~ '^[0-9]{4}$'), nombre VARCHAR(100) NOT NULL, UNIQUE (region_id, nombre)
);
CREATE TABLE core.distritos (
    id SERIAL PRIMARY KEY, provincia_id INT NOT NULL REFERENCES core.provincias(id),
    ubigeo CHAR(6) NOT NULL UNIQUE CHECK (ubigeo ~ '^[0-9]{6}$'), nombre VARCHAR(100) NOT NULL, UNIQUE (provincia_id, nombre)
);
CREATE INDEX ix_provincias_region ON core.provincias(region_id);
CREATE INDEX ix_distritos_provincia ON core.distritos(provincia_id);

CREATE TABLE core.roles (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(30) NOT NULL UNIQUE,
    max_clasificacion SMALLINT NOT NULL REFERENCES core.cat_clasificacion(nivel)
);
INSERT INTO core.roles VALUES   -- RF-03 (OGTI): sectorista, administrador, consulta/lectura, Alta Dirección
 (1,'sectorista',3),(2,'administrador',3),(3,'consulta_lectura',2),(4,'alta_direccion',3),
 (5,'servicio_agente',3),(6,'auditor',3),(7,'externo_publico',1);
CREATE TABLE core.usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sso_subject VARCHAR(255) UNIQUE,
    nombre VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE,
    unidad_id INT REFERENCES core.cat_unidades_organicas(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE core.usuario_roles (
    usuario_id UUID NOT NULL REFERENCES core.usuarios(id), rol_id SMALLINT NOT NULL REFERENCES core.roles(id),
    desde DATE NOT NULL DEFAULT CURRENT_DATE, hasta DATE, PRIMARY KEY (usuario_id, rol_id, desde)
);

CREATE TABLE core.actores (
    actor_uid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_actual VARCHAR(255) NOT NULL,                -- caché derivada de kag.actor_name_history
    fecha_ultimo_cambio_nombre DATE,
    naturaleza VARCHAR(12) NOT NULL DEFAULT 'organizacion' CHECK (naturaleza IN ('persona','organizacion')),
    tipo_actor_id INT NOT NULL REFERENCES core.cat_tipos_actor(id),
    rol_actor_id INT NOT NULL REFERENCES core.cat_roles_actor(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE TABLE core.actor_datos_personales (          -- Ley 29733 / Convenio 169: aislar y proteger
    actor_uid UUID PRIMARY KEY REFERENCES core.actores(actor_uid) ON DELETE CASCADE,
    telefono_contacto VARCHAR(50), genero VARCHAR(30) CHECK (genero IN ('Femenino','Masculino','No_binario','No_declara')),
    autoidentificacion_etnica VARCHAR(100), base_legal VARCHAR(100), fecha_consentimiento DATE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 3 REFERENCES core.cat_clasificacion(nivel),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE core.organizaciones (                  -- RF-08/09/10/11/12 (OSPA y gremios)
    actor_uid UUID PRIMARY KEY REFERENCES core.actores(actor_uid) ON DELETE CASCADE,
    ruc CHAR(11) UNIQUE, razon_social VARCHAR(255), representante_uid UUID REFERENCES core.actores(actor_uid),
    numero_integrantes INT CHECK (numero_integrantes >= 0), expediente_ospa VARCHAR(50), estado_ospa VARCHAR(50),
    vigencia_desde DATE, vigencia_hasta DATE, fuente_sync VARCHAR(50), ultima_sync TIMESTAMPTZ,
    CHECK (vigencia_hasta IS NULL OR vigencia_desde IS NULL OR vigencia_hasta >= vigencia_desde)
);
CREATE TABLE core.actor_membresia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_uid UUID NOT NULL REFERENCES core.actores(actor_uid), organizacion_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    cargo VARCHAR(100), valid_from DATE NOT NULL, valid_to DATE, CHECK (persona_uid <> organizacion_uid)
);
CREATE INDEX ix_membresia_org ON core.actor_membresia(organizacion_uid) WHERE valid_to IS NULL;

CREATE TABLE territorio.cat_tipos_lugar (id SMALLINT PRIMARY KEY, codigo VARCHAR(40) NOT NULL UNIQUE);
INSERT INTO territorio.cat_tipos_lugar VALUES (1,'terminal_pesquero'),(2,'desembarcadero_artesanal'),(3,'planta_procesadora'),(4,'caleta');
CREATE TABLE territorio.lugares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tipo_id SMALLINT NOT NULL REFERENCES territorio.cat_tipos_lugar(id),
    distrito_id INT NOT NULL REFERENCES core.distritos(id), nombre VARCHAR(255) NOT NULL,
    latitud NUMERIC(10,7) CHECK (latitud BETWEEN -90 AND 90), longitud NUMERIC(10,7) CHECK (longitud BETWEEN -180 AND 180),
    operativo BOOLEAN NOT NULL DEFAULT TRUE, administrador_uid UUID REFERENCES core.actores(actor_uid),
    fuente_dato VARCHAR(100), fecha_actualizacion DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE (distrito_id, tipo_id, nombre)
);
CREATE INDEX ix_lugares_distrito ON territorio.lugares(distrito_id, tipo_id);
CREATE TABLE territorio.terminal_detalle (lugar_id UUID PRIMARY KEY REFERENCES territorio.lugares(id) ON DELETE CASCADE, capacidad_tn_dia NUMERIC(12,2));
CREATE TABLE territorio.desembarcadero_detalle (lugar_id UUID PRIMARY KEY REFERENCES territorio.lugares(id) ON DELETE CASCADE, embarcaciones_registradas INT);
CREATE TABLE territorio.planta_detalle (
    lugar_id UUID PRIMARY KEY REFERENCES territorio.lugares(id) ON DELETE CASCADE, razon_social VARCHAR(255),
    tipo_procesamiento VARCHAR(60), capacidad_tn_dia NUMERIC(12,2), empleo_directo INT
);
CREATE TABLE territorio.caleta_detalle (
    lugar_id UUID PRIMARY KEY REFERENCES territorio.lugares(id) ON DELETE CASCADE,
    tipo VARCHAR(20) CHECK (tipo IN ('Pesquera','Turistica','Mixta')),
    nivel_organizacion VARCHAR(10) CHECK (nivel_organizacion IN ('Alto','Medio','Bajo'))   -- nº de actores: se DERIVA con COUNT
);
CREATE TABLE territorio.lugar_actores (
    lugar_id UUID NOT NULL REFERENCES territorio.lugares(id), actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    vinculo VARCHAR(40) NOT NULL DEFAULT 'presente', valid_from DATE NOT NULL DEFAULT CURRENT_DATE, valid_to DATE,
    PRIMARY KEY (lugar_id, actor_uid, valid_from)
);
CREATE TABLE territorio.certificaciones_planta (    -- ex supply_chain.compliance_status (fusionado en territorio)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), planta_id UUID NOT NULL REFERENCES territorio.planta_detalle(lugar_id),
    certificacion VARCHAR(20) NOT NULL CHECK (certificacion IN ('MSC','SANIPES','MMPA','INDNR')),
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('Vigente','Por_vencer','Vencida','Suspendida')),
    fecha_vigencia_hasta DATE, fuente VARCHAR(100), fecha_actualizacion DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE territorio.anomalias_ais (             -- ex security.ais_anomalies (datos agregados, sin PII)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), vessel_hash CHAR(64) NOT NULL, zona_maritima VARCHAR(100) NOT NULL,
    fecha DATE NOT NULL, tipo_anomalia VARCHAR(50) NOT NULL, severidad VARCHAR(10) CHECK (severidad IN ('Baja','Media','Alta')),
    source_data_hash CHAR(64), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE territorio.patrones_seguridad_caleta ( -- ex security.patrones_caleta (solo agregado; MININTER es la fuente)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caleta_id UUID NOT NULL REFERENCES territorio.caleta_detalle(lugar_id),
    periodo VARCHAR(20) NOT NULL, tipo_patron VARCHAR(30) NOT NULL CHECK (tipo_patron IN ('Extorsion','Narcotrafico','Pesca_Ilegal','Trata_Personas')),
    severidad VARCHAR(10) CHECK (severidad IN ('Baja','Media','Alta')), fuente VARCHAR(100) NOT NULL,
    fecha_registro DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE core.casos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entidad_id SMALLINT NOT NULL DEFAULT 1 REFERENCES core.entidades(id),
    codigo_caso VARCHAR(50) NOT NULL UNIQUE, nombre_caso VARCHAR(255) NOT NULL,
    distrito_principal_id INT NOT NULL REFERENCES core.distritos(id),
    alcance_id SMALLINT REFERENCES core.cat_alcances_geograficos(id),
    subsector_id INT NOT NULL REFERENCES core.cat_subsectores(id), tematica_id INT NOT NULL REFERENCES core.cat_tematicas(id),
    unidad_responsable_id INT NOT NULL REFERENCES core.cat_unidades_organicas(id),
    punto_focal_usuario_id UUID REFERENCES core.usuarios(id),          -- Anexo 15, col. 15 (área responsable / punto focal)
    nivel_conflicto_id SMALLINT NOT NULL REFERENCES core.cat_niveles_conflicto(id),
    nivel_riesgo_id SMALLINT NOT NULL REFERENCES core.cat_niveles_riesgo(id),
    prioridad_id SMALLINT REFERENCES core.cat_prioridades_atencion(id),
    estado_id SMALLINT NOT NULL DEFAULT 1 REFERENCES core.cat_estados_caso(id),
    descripcion_riesgo TEXT, latitud NUMERIC(10,7), longitud NUMERIC(10,7),
    fecha_inicio DATE, fecha_cierre DATE, fecha_ultima_actualizacion TIMESTAMPTZ NOT NULL DEFAULT now(),
    fuente_original VARCHAR(30) CHECK (fuente_original IN ('avisa_historico','whatsapp','acta','audio','manual')),
    es_seed_historico BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX ix_casos_distrito ON core.casos(distrito_principal_id);
CREATE INDEX ix_casos_activos ON core.casos(nivel_riesgo_id, fecha_ultima_actualizacion DESC) WHERE estado_id IN (1,2);
CREATE TABLE core.caso_distritos (   -- un caso puede abarcar varios distritos (Anexo 14/15 'Alcance')
    caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE, distrito_id INT NOT NULL REFERENCES core.distritos(id),
    PRIMARY KEY (caso_id, distrito_id)
);
CREATE TABLE core.caso_lugares (
    caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE, lugar_id UUID NOT NULL REFERENCES territorio.lugares(id),
    PRIMARY KEY (caso_id, lugar_id)
);
CREATE TABLE core.caso_estado_historial (   -- historia de nivel/riesgo/estado: habilita 'tiempo en estado' y la máquina de estados
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
    nivel_conflicto_id SMALLINT NOT NULL REFERENCES core.cat_niveles_conflicto(id),
    nivel_riesgo_id SMALLINT NOT NULL REFERENCES core.cat_niveles_riesgo(id),
    estado_id SMALLINT NOT NULL REFERENCES core.cat_estados_caso(id),
    desde TIMESTAMPTZ NOT NULL DEFAULT now(), hasta TIMESTAMPTZ, motivo TEXT,
    usuario_id UUID REFERENCES core.usuarios(id), CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE UNIQUE INDEX ux_caso_historial_vigente ON core.caso_estado_historial(caso_id) WHERE hasta IS NULL;
CREATE TABLE core.caso_factores (
    caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE, factor_id SMALLINT NOT NULL REFERENCES core.cat_factores_contexto(id),
    desde DATE NOT NULL DEFAULT CURRENT_DATE, hasta DATE, PRIMARY KEY (caso_id, factor_id, desde)
);
CREATE TABLE core.casos_actores (
    caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE, actor_id UUID NOT NULL REFERENCES core.actores(actor_uid),
    nivel_influencia SMALLINT NOT NULL CHECK (nivel_influencia BETWEEN 1 AND 100),
    posicion VARCHAR(20) NOT NULL CHECK (posicion IN ('Apoyo','Oposicion','Neutral','No_dialogante')),
    PRIMARY KEY (caso_id, actor_id)
);
CREATE INDEX ix_casos_actores_actor ON core.casos_actores(actor_id);

CREATE TABLE territorio.impacto_conflicto_planta (  -- ex supply_chain.conflict_impact
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id),
    planta_id UUID REFERENCES territorio.planta_detalle(lugar_id), certificaciones_en_riesgo JSONB,
    impacto_estimado VARCHAR(10) CHECK (impacto_estimado IN ('Bajo','Medio','Alto')), evaluado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.alertas_tempranas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), codigo_alerta VARCHAR(50) NOT NULL UNIQUE,
    caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
    prioridad_id SMALLINT NOT NULL REFERENCES core.cat_prioridades_alerta(id), fecha_reporte DATE NOT NULL DEFAULT CURRENT_DATE,
    situacion_actual TEXT, riesgos_json JSONB, acciones_sugeridas_json JSONB,   -- narrativa semiestructurada (no se consulta relacionalmente)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX ix_alertas_caso ON core.alertas_tempranas(caso_id);
CREATE TABLE core.alertas_actores (
    alerta_id UUID NOT NULL REFERENCES core.alertas_tempranas(id) ON DELETE CASCADE, actor_id UUID NOT NULL REFERENCES core.actores(actor_uid),
    PRIMARY KEY (alerta_id, actor_id)
);
CREATE TABLE core.derivaciones_alerta (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), alerta_id UUID NOT NULL REFERENCES core.alertas_tempranas(id) ON DELETE CASCADE,
    area_destino_id INT NOT NULL REFERENCES core.cat_unidades_organicas(id),
    fecha_derivacion TIMESTAMPTZ NOT NULL DEFAULT now(), fecha_limite TIMESTAMPTZ, fecha_atencion TIMESTAMPTZ,
    estado_atencion VARCHAR(20) NOT NULL DEFAULT 'Pendiente' CHECK (estado_atencion IN ('Pendiente','En_atencion','Atendida'))  -- 'Vencida' se DERIVA de fecha_limite
);
CREATE INDEX ix_deriv_pendientes ON core.derivaciones_alerta(fecha_limite) WHERE estado_atencion <> 'Atendida';

CREATE TABLE core.reuniones_dialogo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), codigo_reunion VARCHAR(50) UNIQUE,
    caso_id UUID NOT NULL REFERENCES core.casos(id), convocante_unidad_id INT NOT NULL REFERENCES core.cat_unidades_organicas(id),
    tipo_id SMALLINT REFERENCES core.cat_tipos_reunion(id), programada BOOLEAN NOT NULL DEFAULT TRUE,   -- Anexo 16: Programado / No programado
    titulo VARCHAR(255), fecha TIMESTAMPTZ NOT NULL, lugar VARCHAR(255), responsable_usuario_id UUID REFERENCES core.usuarios(id),
    nota_publicacion_url VARCHAR(500),                                  -- Anexo 16, col. 12 (publicación / nota)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX ix_reuniones_caso ON core.reuniones_dialogo(caso_id, fecha DESC);
CREATE TABLE core.reunion_participantes (
    reunion_id UUID NOT NULL REFERENCES core.reuniones_dialogo(id) ON DELETE CASCADE,
    actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid), institucion_uid UUID REFERENCES core.actores(actor_uid),
    cargo VARCHAR(100), asistio BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (reunion_id, actor_uid)
);
CREATE TABLE core.documentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tipo_id SMALLINT NOT NULL REFERENCES core.cat_tipos_documento(id),
    codigo VARCHAR(60) UNIQUE, caso_id UUID REFERENCES core.casos(id), reunion_id UUID REFERENCES core.reuniones_dialogo(id),
    titulo VARCHAR(255) NOT NULL, fecha DATE NOT NULL DEFAULT CURRENT_DATE, resumen_ejecutivo TEXT,
    contenido_json JSONB NOT NULL DEFAULT '{}', url_pdf VARCHAR(500), responsable_usuario_id UUID REFERENCES core.usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX ix_documentos_caso ON core.documentos(caso_id, tipo_id, fecha DESC);
CREATE INDEX ix_documentos_reunion ON core.documentos(reunion_id) WHERE reunion_id IS NOT NULL;
CREATE TABLE core.planes_accion (   -- subtipo 1:1 de documentos (PAR/PAE) con columnas consultables
    documento_id UUID PRIMARY KEY REFERENCES core.documentos(id) ON DELETE CASCADE,
    monto_presupuestal NUMERIC(15,2), plazo_limite TIMESTAMPTZ,
    estado_aprobacion VARCHAR(20) NOT NULL DEFAULT 'Borrador' CHECK (estado_aprobacion IN ('Borrador','En_revision','Aprobado','Rechazado'))
);
CREATE TABLE core.plan_acciones (   -- acciones inmediatas del Anexo 6 (antes: JSON opaco)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plan_id UUID NOT NULL REFERENCES core.planes_accion(documento_id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL, responsable_uid UUID REFERENCES core.actores(actor_uid), responsable_texto VARCHAR(255),
    plazo_codigo VARCHAR(12) CHECK (plazo_codigo IN ('Inmediato','Hoy','48h')), plazo_limite TIMESTAMPTZ,
    criterio_contencion TEXT, estado VARCHAR(15) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','En_curso','Cumplida','Descartada'))
);

CREATE TABLE core.caso_cronologia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
    fecha_evento DATE NOT NULL, descripcion_hecho TEXT NOT NULL, es_hecho_verificable BOOLEAN NOT NULL DEFAULT TRUE,
    actor_uid UUID REFERENCES core.actores(actor_uid), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX ix_cronologia_caso ON core.caso_cronologia(caso_id, fecha_evento DESC);
CREATE TABLE core.fuentes_evidencia (           -- triangulación: Medios / Institucional / Relacionamiento
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cronologia_id UUID NOT NULL REFERENCES core.caso_cronologia(id) ON DELETE CASCADE,
    tipo_fuente VARCHAR(20) NOT NULL CHECK (tipo_fuente IN ('Medios','Institucional','Relacionamiento')),
    url_referencia VARCHAR(500), nivel_confiabilidad VARCHAR(10) NOT NULL CHECK (nivel_confiabilidad IN ('Alto','Medio','Bajo'))
);
CREATE TABLE core.cronologia_vinculos (         -- 'Alertas vinculadas' del Anexo 15 = AT, RR o PAR
    cronologia_id UUID NOT NULL REFERENCES core.caso_cronologia(id) ON DELETE CASCADE,
    alerta_id UUID REFERENCES core.alertas_tempranas(id), documento_id UUID REFERENCES core.documentos(id),
    CHECK (num_nonnulls(alerta_id, documento_id) = 1)
);
CREATE TABLE core.demandas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
    problema_3p TEXT NOT NULL, propuesta_3p TEXT, pedido_3p TEXT NOT NULL,
    estado_atencion VARCHAR(20) NOT NULL DEFAULT 'Pendiente' CHECK (estado_atencion IN ('Pendiente','En_proceso','Atendida','Desestimada')),
    motivo_no_atencion TEXT, fecha_vencimiento_respuesta DATE, afecta_diferenciadamente_mujeres BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX ix_demandas_caso ON core.demandas(caso_id);
CREATE TABLE core.demandas_actores (
    demanda_id UUID NOT NULL REFERENCES core.demandas(id) ON DELETE CASCADE, actor_id UUID NOT NULL REFERENCES core.actores(actor_uid),
    rol_en_demanda VARCHAR(20) NOT NULL CHECK (rol_en_demanda IN ('Formulador','Coadyuvante','Opositor','Afectado')),
    PRIMARY KEY (demanda_id, actor_id)
);
CREATE TABLE core.demandas_evidencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), demanda_id UUID NOT NULL REFERENCES core.demandas(id) ON DELETE CASCADE,
    fuente_tipo VARCHAR(20) NOT NULL CHECK (fuente_tipo IN ('Medios','Institucional','Relacionamiento')),
    url_referencia VARCHAR(500), archivo_adjunto_url VARCHAR(500), fecha_incorporacion DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE core.compromisos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_compromiso VARCHAR(60) NOT NULL UNIQUE CHECK (codigo_compromiso ~ '_COMP[0-9]{3}$'),   -- Anexo 14: <caso>_COMP00#
    caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE, reunion_id UUID REFERENCES core.reuniones_dialogo(id),
    documento_origen_id UUID REFERENCES core.documentos(id), unidad_responsable_id INT NOT NULL REFERENCES core.cat_unidades_organicas(id),
    alcance_id SMALLINT REFERENCES core.cat_alcances_geograficos(id), tematica_id INT REFERENCES core.cat_tematicas(id),
    fecha_inicio DATE NOT NULL, accion_compromiso TEXT NOT NULL, tipo_compromiso VARCHAR(10) NOT NULL CHECK (tipo_compromiso IN ('Actividad','PIP')),
    nivel_gobierno VARCHAR(15) CHECK (nivel_gobierno IN ('Nacional','Regional','Local','Empresa','Sociedad_Civil')),
    estado_id SMALLINT NOT NULL DEFAULT 1 REFERENCES core.cat_estados_compromiso(id),
    redefinido_de_id UUID UNIQUE REFERENCES core.compromisos(id),     -- UNIQUE: una sola redefinición permitida
    evidencia_cumplimiento_uri VARCHAR(500), atiende_brecha_genero BOOLEAN NOT NULL DEFAULT FALSE, criterios_smart JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX ix_compromisos_caso ON core.compromisos(caso_id);
CREATE TABLE core.compromiso_distritos (
    compromiso_id UUID NOT NULL REFERENCES core.compromisos(id) ON DELETE CASCADE, distrito_id INT NOT NULL REFERENCES core.distritos(id),
    PRIMARY KEY (compromiso_id, distrito_id)
);
CREATE TABLE core.compromiso_pip (
    compromiso_id UUID PRIMARY KEY REFERENCES core.compromisos(id) ON DELETE CASCADE,
    codigo_snip VARCHAR(50), codigo_unificado VARCHAR(50), denominacion TEXT, unidad_formuladora VARCHAR(255), unidad_ejecutora VARCHAR(255),
    etapa_id SMALLINT REFERENCES core.cat_pip_etapas(id),            -- la FASE se deriva de la etapa (3FN)
    monto_total NUMERIC(15,2), pim NUMERIC(15,2), devengado NUMERIC(15,2), devengado_acumulado NUMERIC(15,2)   -- avance % se DERIVA
);
CREATE TABLE core.compromiso_colaboradores (
    compromiso_id UUID NOT NULL REFERENCES core.compromisos(id) ON DELETE CASCADE, actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    PRIMARY KEY (compromiso_id, actor_uid)
);
CREATE TABLE core.hitos_compromiso (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), compromiso_id UUID NOT NULL REFERENCES core.compromisos(id) ON DELETE CASCADE,
    codigo_hito VARCHAR(70) NOT NULL UNIQUE, descripcion_hito TEXT NOT NULL, fecha_vencimiento DATE,
    estado_id SMALLINT NOT NULL DEFAULT 1 REFERENCES core.cat_estados_hito(id)       -- caché del último estado histórico
);
CREATE INDEX ix_hitos_compromiso ON core.hitos_compromiso(compromiso_id);
CREATE INDEX ix_hitos_por_vencer ON core.hitos_compromiso(fecha_vencimiento) WHERE estado_id NOT IN (4,5);
CREATE TABLE core.hitos_compromiso_estado_historico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), hito_id UUID NOT NULL REFERENCES core.hitos_compromiso(id) ON DELETE CASCADE,
    fecha_corte DATE NOT NULL, estado_id SMALLINT NOT NULL REFERENCES core.cat_estados_hito(id), observacion TEXT,
    registrado_por UUID REFERENCES core.usuarios(id), registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (hito_id, fecha_corte)
);

CREATE TABLE kag.documento_fuente (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), core_documento_id UUID REFERENCES core.documentos(id),
    titulo VARCHAR(255) NOT NULL, tipo VARCHAR(60) NOT NULL, url VARCHAR(500), hash_contenido CHAR(64),
    fecha_ingesta TIMESTAMPTZ NOT NULL DEFAULT now(), nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE TABLE kag.documento_fragmento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), documento_id UUID NOT NULL REFERENCES kag.documento_fuente(id) ON DELETE CASCADE,
    orden INT NOT NULL, pagina_o_minuto INT, texto TEXT NOT NULL, nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    UNIQUE (documento_id, orden)
);
CREATE TABLE kag.actor_profile (                -- cabecera 1:1; tipo/rol/nombre se leen de core (sin duplicar)
    actor_uid UUID PRIMARY KEY REFERENCES core.actores(actor_uid) ON DELETE CASCADE,
    resumen TEXT, formas_trabajo TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE kag.actor_profile_attribute (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid) ON DELETE CASCADE,
    attribute_type VARCHAR(30) NOT NULL CHECK (attribute_type IN ('interes_declarado','interes_real','necesidad_basica','limitacion_legal',
        'limitacion_presupuestal','limitacion_politica','limitacion_cultural','estrategia_historica','capacidad')),
    value TEXT NOT NULL, severity SMALLINT CHECK (severity BETWEEN 1 AND 5),
    valid_from TIMESTAMPTZ NOT NULL, valid_to TIMESTAMPTZ,                         -- tiempo válido
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_at TIMESTAMPTZ,       -- tiempo de transacción
    supersedes_id UUID REFERENCES kag.actor_profile_attribute(id),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1), origen_dato VARCHAR(20) NOT NULL DEFAULT 'KAG',
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE, nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX ix_attr_actor ON kag.actor_profile_attribute(actor_uid, attribute_type) WHERE superseded_at IS NULL;
CREATE TABLE kag.atributo_evidencia (
    atributo_id UUID NOT NULL REFERENCES kag.actor_profile_attribute(id) ON DELETE CASCADE,
    fragmento_id UUID NOT NULL REFERENCES kag.documento_fragmento(id), cita_textual TEXT, confidence NUMERIC(3,2),
    PRIMARY KEY (atributo_id, fragmento_id)
);
CREATE TABLE kag.actor_name_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid) ON DELETE CASCADE,
    nombre VARCHAR(255) NOT NULL, valid_from DATE NOT NULL, valid_to DATE, fuente VARCHAR(255), confidence NUMERIC(3,2),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX ux_name_history_vigente ON kag.actor_name_history(actor_uid) WHERE valid_to IS NULL;
CREATE TABLE kag.objetivo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL, tipo VARCHAR(50), valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_to TIMESTAMPTZ
);
CREATE TABLE kag.nodos (                         -- integridad de los extremos de arista (antes: FK solo a actores)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('actor','caso','objetivo','demanda','solucion','lugar')),
    ref_id UUID NOT NULL, etiqueta VARCHAR(255), UNIQUE (tipo, ref_id)
);
CREATE TABLE kag.cat_tipos_arista (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(40) NOT NULL UNIQUE,
    clase VARCHAR(15) NOT NULL CHECK (clase IN ('relacion','influencia','posicion','participacion','causal')),
    dirigida BOOLEAN NOT NULL DEFAULT TRUE, origen_tipo VARCHAR(20), destino_tipo VARCHAR(20)
);
INSERT INTO kag.cat_tipos_arista VALUES
 (1,'ALIANZA','relacion',FALSE,'actor','actor'),(2,'TENSION','relacion',FALSE,'actor','actor'),(3,'NEUTRAL','relacion',FALSE,'actor','actor'),
 (4,'INFLUYE_SOBRE','influencia',TRUE,'actor','actor'),(5,'A_FAVOR_DE','posicion',TRUE,'actor','objetivo'),
 (6,'EN_CONTRA_DE','posicion',TRUE,'actor','objetivo'),(7,'PARTICIPA_EN','participacion',TRUE,'actor','caso'),
 (8,'EXIGE','participacion',TRUE,'actor','demanda'),(9,'SE_RESOLVIO_CON','causal',TRUE,'caso','solucion'),
 (10,'SUSTENTA_TECNICAMENTE','participacion',TRUE,'actor','solucion');
CREATE TABLE kag.aristas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origen_id UUID NOT NULL REFERENCES kag.nodos(id), destino_id UUID NOT NULL REFERENCES kag.nodos(id),
    tipo_id SMALLINT NOT NULL REFERENCES kag.cat_tipos_arista(id), caso_id UUID REFERENCES core.casos(id),
    intensidad SMALLINT CHECK (intensidad BETWEEN 1 AND 5), justificacion TEXT,
    valid_from TIMESTAMPTZ NOT NULL, valid_to TIMESTAMPTZ,                         -- tiempo válido: cuándo fue cierto en el mundo
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_at TIMESTAMPTZ,       -- tiempo de transacción: cuándo lo supimos
    supersedes_id UUID REFERENCES kag.aristas(id), split_from_id UUID REFERENCES kag.aristas(id),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'KAG', es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    CHECK (origen_id <> destino_id), CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX ix_aristas_origen ON kag.aristas(origen_id, tipo_id) WHERE superseded_at IS NULL;
CREATE INDEX ix_aristas_destino ON kag.aristas(destino_id, tipo_id) WHERE superseded_at IS NULL;
CREATE INDEX ix_aristas_caso ON kag.aristas(caso_id) WHERE caso_id IS NOT NULL;
CREATE UNIQUE INDEX ux_aristas_vigente ON kag.aristas(origen_id, destino_id, tipo_id, valid_from) WHERE superseded_at IS NULL;
CREATE TABLE kag.arista_evidencia (
    arista_id UUID NOT NULL REFERENCES kag.aristas(id) ON DELETE CASCADE, fragmento_id UUID NOT NULL REFERENCES kag.documento_fragmento(id),
    cita_textual TEXT, confidence NUMERIC(3,2), PRIMARY KEY (arista_id, fragmento_id)
);
CREATE TABLE kag.entity_merge_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tipo_operacion VARCHAR(10) NOT NULL CHECK (tipo_operacion IN ('merge','split')),
    resultante_uid UUID NOT NULL REFERENCES core.actores(actor_uid), usuario_id UUID NOT NULL REFERENCES core.usuarios(id),
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(), justificacion TEXT NOT NULL, reversible BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE kag.entity_merge_members (
    merge_log_id UUID NOT NULL REFERENCES kag.entity_merge_log(id) ON DELETE CASCADE, actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    rol VARCHAR(12) NOT NULL CHECK (rol IN ('absorbido','resultante','escindido')), PRIMARY KEY (merge_log_id, actor_uid, rol)
);
CREATE TABLE kag.embedding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fragmento_id UUID REFERENCES kag.documento_fragmento(id) ON DELETE CASCADE,
    atributo_id UUID REFERENCES kag.actor_profile_attribute(id) ON DELETE CASCADE,
    modelo VARCHAR(80) NOT NULL, version_modelo VARCHAR(30) NOT NULL, embedding vector(1024) NOT NULL,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(fragmento_id, atributo_id) = 1)
);
CREATE INDEX ix_embedding_hnsw ON kag.embedding USING hnsw (embedding vector_cosine_ops);

CREATE TABLE ctx.cat_dominios (id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE);
INSERT INTO ctx.cat_dominios VALUES (1,'oceanografico'),(2,'economico'),(3,'socioeconomico'),(4,'geopolitico'),(5,'territorial');
CREATE TABLE ctx.cat_fuentes (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(30) NOT NULL UNIQUE, nombre VARCHAR(120) NOT NULL, url_base VARCHAR(255)
);
CREATE TABLE ctx.cat_variables (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(40) NOT NULL UNIQUE, nombre VARCHAR(150) NOT NULL,
    dominio_id SMALLINT NOT NULL REFERENCES ctx.cat_dominios(id), unidad VARCHAR(30),
    ambito VARCHAR(15) NOT NULL CHECK (ambito IN ('nacional','region','provincia','distrito','lugar','zona_maritima')),
    por_especie BOOLEAN NOT NULL DEFAULT FALSE, periodicidad_dias SMALLINT, ttl_frescura_dias SMALLINT NOT NULL DEFAULT 90   -- guardrail de frescura: DATO, no código
);
CREATE TABLE ctx.variable_fuentes (variable_id SMALLINT REFERENCES ctx.cat_variables(id), fuente_id SMALLINT REFERENCES ctx.cat_fuentes(id), PRIMARY KEY (variable_id, fuente_id));  -- guardrail de fuente
CREATE TABLE ctx.zonas_maritimas (id SMALLINT PRIMARY KEY, nombre VARCHAR(100) NOT NULL UNIQUE);
CREATE TABLE ctx.observaciones (
    id BIGINT GENERATED ALWAYS AS IDENTITY, fecha DATE NOT NULL,
    variable_id SMALLINT NOT NULL REFERENCES ctx.cat_variables(id), fuente_id SMALLINT NOT NULL REFERENCES ctx.cat_fuentes(id),
    valor NUMERIC(18,4) NOT NULL, especie_id SMALLINT REFERENCES core.cat_especies(id),
    region_id INT REFERENCES core.regiones(id), provincia_id INT REFERENCES core.provincias(id), distrito_id INT REFERENCES core.distritos(id),
    lugar_id UUID REFERENCES territorio.lugares(id), zona_maritima_id SMALLINT REFERENCES ctx.zonas_maritimas(id),
    ingerido_en TIMESTAMPTZ NOT NULL DEFAULT now(), metadata JSONB,
    PRIMARY KEY (id, fecha), CHECK (num_nonnulls(region_id, provincia_id, distrito_id, lugar_id, zona_maritima_id) <= 1)
) PARTITION BY RANGE (fecha);
CREATE UNIQUE INDEX ux_obs ON ctx.observaciones (fecha, variable_id, fuente_id, especie_id, region_id, provincia_id, distrito_id, lugar_id, zona_maritima_id) NULLS NOT DISTINCT;
CREATE INDEX ix_obs_dist ON ctx.observaciones (variable_id, distrito_id, fecha DESC) WHERE distrito_id IS NOT NULL;
CREATE INDEX ix_obs_nac ON ctx.observaciones (variable_id, fecha DESC);
CREATE TABLE ctx.observaciones_default PARTITION OF ctx.observaciones DEFAULT;
CREATE TABLE ctx.snapshot (          -- congela el contexto con que se generó una recomendación (evidencia inmutable)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id), fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    contenido JSONB NOT NULL, hash CHAR(64) NOT NULL, creado_por UUID REFERENCES core.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE avisa.raw_ingest (
    id UUID NOT NULL DEFAULT gen_random_uuid(), received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    fuente VARCHAR(15) NOT NULL CHECK (fuente IN ('whatsapp','acta_pdf','audio','email')),
    sender_hmac CHAR(64) NOT NULL,                      -- HMAC-SHA256 con secreto (un hash simple de teléfono es reversible)
    raw_text TEXT, audio_uri VARCHAR(500), payload_json JSONB, schema_version VARCHAR(10), extractor_version VARCHAR(30),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    estado VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','procesado','rechazado','en_hitl')),
    caso_id UUID REFERENCES core.casos(id), PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);
CREATE INDEX ix_raw_pendiente ON avisa.raw_ingest(received_at) WHERE estado IN ('pendiente','en_hitl');
CREATE TABLE avisa.raw_ingest_rejected (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), raw_id UUID NOT NULL, raw_received_at TIMESTAMPTZ NOT NULL,
    error_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (raw_id, raw_received_at) REFERENCES avisa.raw_ingest(id, received_at)
);
CREATE TABLE agent.run_log (
    id UUID NOT NULL DEFAULT gen_random_uuid(), ts TIMESTAMPTZ NOT NULL DEFAULT now(), query_id UUID, usuario_id UUID,
    rol VARCHAR(30), agente VARCHAR(30) NOT NULL, decision VARCHAR(30), confidence NUMERIC(3,2), input_hash CHAR(64), detalle JSONB,
    prev_hash CHAR(64), hash CHAR(64), PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);
CREATE INDEX ix_runlog_query ON agent.run_log(query_id);
CREATE TABLE agent.feedback_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ts TIMESTAMPTZ NOT NULL DEFAULT now(), agente VARCHAR(30) NOT NULL,
    input_ref JSONB, output_agente JSONB, correccion_humano JSONB, justificacion TEXT, revisado_por UUID REFERENCES core.usuarios(id)
);
CREATE INDEX ix_feedback_pendiente ON agent.feedback_log(ts) WHERE correccion_humano IS NULL;
CREATE TABLE agent.lessons_learned (     -- absorbe agent.correction_patterns (era redundante)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agente_destino VARCHAR(30) NOT NULL, tipo_error VARCHAR(60), patron TEXT NOT NULL,
    ejemplo_json JSONB, feedback_id UUID REFERENCES agent.feedback_log(id), activo BOOLEAN NOT NULL DEFAULT FALSE,
    aprobado_por UUID REFERENCES core.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE agent.synthetic_test_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_semilla_id UUID NOT NULL REFERENCES core.casos(id),
    variacion VARCHAR(20) NOT NULL CHECK (variacion IN ('fecha','actor','demanda','territorio','rol')),
    campo_modificado VARCHAR(80) NOT NULL, entrada JSONB NOT NULL, esperado JSONB NOT NULL, resultado JSONB,
    exactitud NUMERIC(4,3), valido BOOLEAN NOT NULL DEFAULT TRUE, ejecutado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.output_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), query_id UUID NOT NULL, usuario_id UUID NOT NULL REFERENCES core.usuarios(id),
    formato VARCHAR(10) NOT NULL CHECK (formato IN ('office','minister')), caso_id UUID REFERENCES core.casos(id),
    response_json JSONB, response_uri VARCHAR(500), snapshot_id UUID REFERENCES ctx.snapshot(id),
    nivel_clasificacion SMALLINT NOT NULL REFERENCES core.cat_clasificacion(nivel), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE core.query_cache (   -- la clave incluye el nivel de acceso: evita fuga entre roles
    clave_hash CHAR(64) NOT NULL, clasificacion_max SMALLINT NOT NULL REFERENCES core.cat_clasificacion(nivel),
    respuesta JSONB NOT NULL, creado TIMESTAMPTZ NOT NULL DEFAULT now(), expira TIMESTAMPTZ NOT NULL, PRIMARY KEY (clave_hash, clasificacion_max)
);
CREATE TABLE core.notificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id UUID NOT NULL REFERENCES core.usuarios(id),
    tipo VARCHAR(30) NOT NULL, entidad_tipo VARCHAR(30), entidad_id UUID, vence_en TIMESTAMPTZ,
    estado VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviada','leida')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE core.integraciones (   -- frontera de adapter (13.4): SIN acceso directo a bases externas (RS-07)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), sistema_origen VARCHAR(100) NOT NULL, sistema_destino VARCHAR(100) NOT NULL,
    entidad_origen_tipo VARCHAR(50) NOT NULL, entidad_origen_id UUID NOT NULL,
    entidad_destino_ref VARCHAR(100),                      -- id en el sistema externo (no es UUID por regla general)
    tipo_sync VARCHAR(5) NOT NULL CHECK (tipo_sync IN ('push','pull','dual')),
    estado VARCHAR(15) NOT NULL DEFAULT 'pendiente_auth' CHECK (estado IN ('activa','pausada','error','pendiente_auth')),
    workflow_state VARCHAR(50), ultima_sincronizacion TIMESTAMPTZ, metadata_json JSONB,
    UNIQUE (sistema_destino, entidad_origen_tipo, entidad_origen_id)
);

CREATE FUNCTION core.set_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := NULLIF(current_setting('app.user_id', true), '')::uuid;
  IF TG_OP = 'INSERT' THEN NEW.created_by := COALESCE(NEW.created_by, NEW.updated_by); END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['actores','casos','alertas_tempranas','reuniones_dialogo','documentos','caso_cronologia','demandas','compromisos'] LOOP
    EXECUTE format('CREATE TRIGGER trg_audit BEFORE INSERT OR UPDATE ON core.%I FOR EACH ROW EXECUTE FUNCTION core.set_audit()', t);
  END LOOP;
END $$;

CREATE FUNCTION kag.actor_nace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO kag.actor_name_history(actor_uid, nombre, valid_from, fuente) VALUES (NEW.actor_uid, NEW.nombre_actual, CURRENT_DATE, 'alta');
  INSERT INTO kag.nodos(tipo, ref_id, etiqueta) VALUES ('actor', NEW.actor_uid, NEW.nombre_actual);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_actor_nace AFTER INSERT ON core.actores FOR EACH ROW EXECUTE FUNCTION kag.actor_nace();
CREATE FUNCTION kag.nombre_cierra_previo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE kag.actor_name_history SET valid_to = GREATEST(valid_from, NEW.valid_from - 1)
   WHERE actor_uid = NEW.actor_uid AND valid_to IS NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_nombre_cierra BEFORE INSERT ON kag.actor_name_history FOR EACH ROW EXECUTE FUNCTION kag.nombre_cierra_previo();
CREATE FUNCTION kag.sync_nombre_actual() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.valid_to IS NULL THEN
    UPDATE core.actores SET nombre_actual = NEW.nombre, fecha_ultimo_cambio_nombre = NEW.valid_from WHERE actor_uid = NEW.actor_uid;
    UPDATE kag.nodos SET etiqueta = NEW.nombre WHERE tipo = 'actor' AND ref_id = NEW.actor_uid;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sync_nombre AFTER INSERT ON kag.actor_name_history FOR EACH ROW EXECUTE FUNCTION kag.sync_nombre_actual();

CREATE FUNCTION core.caso_historial() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (NEW.nivel_conflicto_id, NEW.nivel_riesgo_id, NEW.estado_id) IS DISTINCT FROM (OLD.nivel_conflicto_id, OLD.nivel_riesgo_id, OLD.estado_id) THEN
    UPDATE core.caso_estado_historial SET hasta = now() WHERE caso_id = NEW.id AND hasta IS NULL;
    INSERT INTO core.caso_estado_historial(caso_id, nivel_conflicto_id, nivel_riesgo_id, estado_id, usuario_id)
    VALUES (NEW.id, NEW.nivel_conflicto_id, NEW.nivel_riesgo_id, NEW.estado_id, NULLIF(current_setting('app.user_id', true), '')::uuid);
  END IF;
  IF TG_OP = 'INSERT' THEN INSERT INTO kag.nodos(tipo, ref_id, etiqueta) VALUES ('caso', NEW.id, NEW.nombre_caso); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_caso_historial AFTER INSERT OR UPDATE ON core.casos FOR EACH ROW EXECUTE FUNCTION core.caso_historial();

CREATE FUNCTION core.deriv_limite() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_sla smallint;
BEGIN
  SELECT p.sla_horas INTO v_sla FROM core.alertas_tempranas a JOIN core.cat_prioridades_alerta p ON p.id = a.prioridad_id WHERE a.id = NEW.alerta_id;
  IF NEW.fecha_limite IS NULL AND v_sla IS NOT NULL THEN NEW.fecha_limite := NEW.fecha_derivacion + make_interval(hours => v_sla); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_deriv_limite BEFORE INSERT ON core.derivaciones_alerta FOR EACH ROW EXECUTE FUNCTION core.deriv_limite();

CREATE FUNCTION core.chk_compromiso() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cod text;
BEGIN
  SELECT codigo INTO v_cod FROM core.cat_estados_compromiso WHERE id = NEW.estado_id;
  IF v_cod = 'Cumplido' AND NEW.evidencia_cumplimiento_uri IS NULL THEN
    RAISE EXCEPTION 'Compromiso % no puede cerrarse como Cumplido sin evidencia (Protocolo SGSD/SSGC)', NEW.codigo_compromiso;
  END IF;
  IF v_cod = 'Redefinido' AND NOT EXISTS (SELECT 1 FROM core.compromisos x WHERE x.redefinido_de_id = NEW.id) AND TG_OP = 'UPDATE' THEN
    NULL;  -- la fila sucesora se inserta después; la unicidad la garantiza UNIQUE(redefinido_de_id)
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_chk_compromiso BEFORE INSERT OR UPDATE ON core.compromisos FOR EACH ROW EXECUTE FUNCTION core.chk_compromiso();

CREATE FUNCTION core.sync_hito_estado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE core.hitos_compromiso h SET estado_id = NEW.estado_id
   WHERE h.id = NEW.hito_id AND NEW.fecha_corte = (SELECT MAX(fecha_corte) FROM core.hitos_compromiso_estado_historico WHERE hito_id = NEW.hito_id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sync_hito AFTER INSERT OR UPDATE ON core.hitos_compromiso_estado_historico FOR EACH ROW EXECUTE FUNCTION core.sync_hito_estado();

CREATE FUNCTION agent.run_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prev CHAR(64);
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'agent.run_log es append-only'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('agent.run_log'));
  SELECT hash INTO v_prev FROM agent.run_log ORDER BY ts DESC, id DESC LIMIT 1;
  NEW.prev_hash := v_prev;
  NEW.hash := encode(sha256(convert_to(coalesce(v_prev,'') || NEW.id::text || NEW.ts::text || NEW.agente || coalesce(NEW.decision,'') || coalesce(NEW.detalle::text,''), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_runlog_guard BEFORE INSERT OR UPDATE OR DELETE ON agent.run_log FOR EACH ROW EXECUTE FUNCTION agent.run_log_guard();

CREATE FUNCTION core.crear_particion(p_schema text, p_tabla text, p_desde date, p_hasta date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
                 p_schema, p_tabla || '_' || to_char(p_desde, 'YYYYMM'), p_schema, p_tabla, p_desde, p_hasta);
END $$;
-- pg_cron (opcional): SELECT cron.schedule('particiones','0 3 25 * *', $q$ ...core.crear_particion(mes siguiente)... $q$);
CREATE TABLE avisa.raw_ingest_default PARTITION OF avisa.raw_ingest DEFAULT;
CREATE TABLE agent.run_log_default PARTITION OF agent.run_log DEFAULT;
DO $$ DECLARE m date; BEGIN
  FOR m IN SELECT generate_series(date '2026-11-01', date '2027-03-01', interval '1 month')::date LOOP
    PERFORM core.crear_particion('avisa','raw_ingest', m, (m + interval '1 month')::date);
    PERFORM core.crear_particion('agent','run_log', m, (m + interval '1 month')::date);
  END LOOP;
  FOR m IN SELECT generate_series(date '2026-01-01', date '2030-01-01', interval '1 year')::date LOOP
    EXECUTE format('CREATE TABLE ctx.observaciones_%s PARTITION OF ctx.observaciones FOR VALUES FROM (%L) TO (%L)',
                   to_char(m,'YYYY'), m, (m + interval '1 year')::date);
  END LOOP;
END $$;

-- Subgrafo bitemporal: recorrido acotado en SQL (reemplaza la carga en NetworkX para consultas interactivas)
CREATE FUNCTION kag.subgrafo(p_nodo uuid, p_prof int DEFAULT 2, p_valido_en timestamptz DEFAULT now(), p_conocido_en timestamptz DEFAULT now())
RETURNS TABLE (arista_id uuid, origen_id uuid, destino_id uuid, tipo_id smallint, intensidad smallint, profundidad int)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE act AS (
    SELECT a.* FROM kag.aristas a
     WHERE a.valid_from <= p_valido_en AND (a.valid_to IS NULL OR a.valid_to > p_valido_en)
       AND a.recorded_at <= p_conocido_en AND (a.superseded_at IS NULL OR a.superseded_at > p_conocido_en)
  ), alc(nodo_id, d, ruta) AS (
    SELECT p_nodo, 0, ARRAY[p_nodo]
    UNION ALL
    SELECT CASE WHEN a.origen_id = alc.nodo_id THEN a.destino_id ELSE a.origen_id END, alc.d + 1,
           alc.ruta || CASE WHEN a.origen_id = alc.nodo_id THEN a.destino_id ELSE a.origen_id END
      FROM alc JOIN act a ON a.origen_id = alc.nodo_id OR a.destino_id = alc.nodo_id
     WHERE alc.d < p_prof
       AND NOT (CASE WHEN a.origen_id = alc.nodo_id THEN a.destino_id ELSE a.origen_id END) = ANY (alc.ruta)
  ), vis AS (SELECT nodo_id, MIN(d) AS d FROM alc GROUP BY nodo_id)
  SELECT a.id, a.origen_id, a.destino_id, a.tipo_id, a.intensidad, LEAST(vo.d, vd.d) + 1
    FROM act a JOIN vis vo ON vo.nodo_id = a.origen_id JOIN vis vd ON vd.nodo_id = a.destino_id
   WHERE LEAST(vo.d, vd.d) < p_prof;
$$;

-- Última observación vigente con degradación geográfica distrito → provincia → región → nacional
CREATE FUNCTION ctx.ultima_observacion(p_codigo text, p_distrito int DEFAULT NULL, p_especie smallint DEFAULT NULL)
RETURNS TABLE (valor numeric, fecha date, vigente boolean, ambito_resuelto text) LANGUAGE sql STABLE AS $$
  WITH v AS (SELECT id, ttl_frescura_dias FROM ctx.cat_variables WHERE codigo = p_codigo),
  u AS (SELECT d.id AS did, p.id AS pid, p.region_id AS rid FROM core.distritos d JOIN core.provincias p ON p.id = d.provincia_id WHERE d.id = p_distrito),
  c AS (
    SELECT o.valor, o.fecha, v.ttl_frescura_dias,
           CASE WHEN o.distrito_id IS NOT NULL THEN 1 WHEN o.provincia_id IS NOT NULL THEN 2 WHEN o.region_id IS NOT NULL THEN 3 ELSE 4 END AS nivel,
           CASE WHEN o.distrito_id IS NOT NULL THEN 'distrito' WHEN o.provincia_id IS NOT NULL THEN 'provincia' WHEN o.region_id IS NOT NULL THEN 'region' ELSE 'nacional' END AS amb
      FROM ctx.observaciones o JOIN v ON v.id = o.variable_id LEFT JOIN u ON TRUE
     WHERE (p_especie IS NULL OR o.especie_id = p_especie)
       AND ((o.distrito_id = u.did) OR (o.provincia_id = u.pid) OR (o.region_id = u.rid)
            OR (num_nonnulls(o.region_id, o.provincia_id, o.distrito_id, o.lugar_id, o.zona_maritima_id) = 0))
  )
  SELECT valor, fecha, (CURRENT_DATE - fecha) <= ttl_frescura_dias, amb FROM c ORDER BY nivel, fecha DESC LIMIT 1;
$$;

CREATE FUNCTION core.clasificacion_max() RETURNS smallint LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.clasificacion_max', true), '')::smallint, 0)
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['core.casos','core.actores','core.alertas_tempranas','core.documentos','core.demandas','core.compromisos',
                           'core.caso_cronologia','core.reuniones_dialogo','core.actor_datos_personales','kag.aristas','kag.documento_fuente',
                           'kag.documento_fragmento','kag.embedding','kag.actor_profile_attribute'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_clasificacion ON %s FOR SELECT USING (nivel_clasificacion <= core.clasificacion_max())', t);
    -- escritura por comando (una política FOR ALL también aplicaría a SELECT y filtraría hacia afuera: bug detectado en pruebas)
    EXECUTE format('CREATE POLICY p_insert ON %s FOR INSERT WITH CHECK (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max())', t);
    EXECUTE format('CREATE POLICY p_update ON %s FOR UPDATE USING (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max()) WITH CHECK (nivel_clasificacion <= core.clasificacion_max())', t);
    EXECUTE format('CREATE POLICY p_delete ON %s FOR DELETE USING (core.clasificacion_max() >= 3 AND nivel_clasificacion <= core.clasificacion_max())', t);
  END LOOP;
END $$;

CREATE VIEW analytics.vw_geo_distrito AS
SELECT d.id AS distrito_id, d.nombre AS distrito, p.id AS provincia_id, p.nombre AS provincia, r.id AS region_id, r.nombre AS region
  FROM core.distritos d JOIN core.provincias p ON p.id = d.provincia_id JOIN core.regiones r ON r.id = p.region_id;

CREATE VIEW analytics.vw_anexo_02_panorama_regional AS
SELECT g.region, s.nombre AS subsector, COUNT(*) AS total_casos,
       COUNT(*) FILTER (WHERE nr.codigo = 'Alto') AS casos_riesgo_alto,
       COUNT(*) FILTER (WHERE nc.codigo = 'Crisis_social') AS casos_crisis
  FROM core.casos c JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id
  JOIN core.cat_subsectores s ON s.id = c.subsector_id JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
  JOIN core.cat_niveles_conflicto nc ON nc.id = c.nivel_conflicto_id JOIN core.cat_estados_caso e ON e.id = c.estado_id AND e.es_activo
 GROUP BY g.region, s.nombre;

CREATE VIEW analytics.vw_anexo_14_seguimiento_compromisos AS
SELECT c.codigo_compromiso, cs.codigo_caso,
  (SELECT string_agg(DISTINCT g.region, ', ')    FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS region,
  (SELECT string_agg(DISTINCT g.provincia, ', ') FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS provincia,
  (SELECT string_agg(DISTINCT g.distrito, ', ')  FROM core.compromiso_distritos cd JOIN analytics.vw_geo_distrito g ON g.distrito_id = cd.distrito_id WHERE cd.compromiso_id = c.id) AS distrito,
  al.codigo AS alcance_geografico, td.nombre AS documento_origen, c.fecha_inicio, tm.nombre AS tematica,
  c.accion_compromiso, uo.siglas AS area_responsable, h.codigo_hito, h.descripcion_hito AS hito, eh.codigo AS estado_hito,
  CASE WHEN eh.es_terminal THEN 'VERDE' WHEN h.fecha_vencimiento < CURRENT_DATE THEN 'ROJO'
       WHEN h.fecha_vencimiento <= CURRENT_DATE + 15 THEN 'AMARILLO' ELSE 'VERDE' END AS semaforo
  FROM core.compromisos c JOIN core.casos cs ON cs.id = c.caso_id JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
  LEFT JOIN core.cat_alcances_geograficos al ON al.id = c.alcance_id LEFT JOIN core.documentos dc ON dc.id = c.documento_origen_id
  LEFT JOIN core.cat_tipos_documento td ON td.id = dc.tipo_id LEFT JOIN core.cat_tematicas tm ON tm.id = c.tematica_id
  LEFT JOIN core.hitos_compromiso h ON h.compromiso_id = c.id LEFT JOIN core.cat_estados_hito eh ON eh.id = h.estado_id;

CREATE VIEW analytics.vw_anexo_15_matriz_conflictividad AS
SELECT c.codigo_caso, g.region, al.codigo AS alcance, s.nombre AS subsector, tm.nombre AS tematica, uo.siglas AS responsable,
       nc.nombre AS nivel_conflicto, nr.codigo AS nivel_riesgo, c.descripcion_riesgo, pa.codigo AS prioridad_atencion, c.nombre_caso,
       (SELECT string_agg(to_char(k.fecha_evento,'DD.MM.YYYY') || ' ' || k.descripcion_hecho, E'\n' ORDER BY k.fecha_evento DESC) FROM core.caso_cronologia k WHERE k.caso_id = c.id) AS narracion_cronologica,
       (SELECT string_agg(a.codigo_alerta, ', ') FROM core.alertas_tempranas a WHERE a.caso_id = c.id) AS alertas_vinculadas,
       (SELECT string_agg(ac.nombre_actual, '; ') FROM core.casos_actores ca JOIN core.actores ac ON ac.actor_uid = ca.actor_id WHERE ca.caso_id = c.id) AS actores_involucrados,
       pf.nombre AS punto_focal
  FROM core.casos c LEFT JOIN core.usuarios pf ON pf.id = c.punto_focal_usuario_id JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id JOIN core.cat_subsectores s ON s.id = c.subsector_id
  JOIN core.cat_tematicas tm ON tm.id = c.tematica_id JOIN core.cat_unidades_organicas uo ON uo.id = c.unidad_responsable_id
  JOIN core.cat_niveles_conflicto nc ON nc.id = c.nivel_conflicto_id JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
  LEFT JOIN core.cat_alcances_geograficos al ON al.id = c.alcance_id LEFT JOIN core.cat_prioridades_atencion pa ON pa.id = c.prioridad_id;

CREATE VIEW analytics.vw_anexo_16_registro_reuniones AS
SELECT CASE WHEN r.programada THEN 'Programado' ELSE 'No programado' END AS tipo, r.codigo_reunion AS codigo, s.nombre AS sector,
       u.nombre AS responsable, r.fecha, g.region AS departamento, r.lugar, r.titulo,
       (SELECT COUNT(*) FROM core.reunion_participantes p WHERE p.reunion_id = r.id AND p.asistio) AS asistentes,
       EXISTS (SELECT 1 FROM core.documentos d WHERE d.reunion_id = r.id AND d.tipo_id = 10) AS tiene_ayuda_memoria,
       EXISTS (SELECT 1 FROM core.documentos d WHERE d.reunion_id = r.id AND d.tipo_id = 11) AS tiene_relatoria,
       r.nota_publicacion_url AS publicacion_nota
  FROM core.reuniones_dialogo r JOIN core.casos c ON c.id = r.caso_id JOIN core.cat_subsectores s ON s.id = c.subsector_id
  JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id LEFT JOIN core.usuarios u ON u.id = r.responsable_usuario_id;

CREATE VIEW analytics.vw_anexo_17_registro_reportes AS
SELECT td.nombre AS tipo, d.codigo AS codigo_reporte, c.codigo_caso, u.nombre AS responsable, d.fecha, g.region,
       g.provincia || ' / ' || g.distrito AS ubicacion, d.titulo, d.resumen_ejecutivo,
       d.contenido_json ->> 'contenido' AS contenido, d.contenido_json ->> 'conclusiones_recomendaciones' AS conclusiones_recomendaciones
  FROM core.documentos d JOIN core.cat_tipos_documento td ON td.id = d.tipo_id LEFT JOIN core.casos c ON c.id = d.caso_id
  LEFT JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id LEFT JOIN core.usuarios u ON u.id = d.responsable_usuario_id
 WHERE td.codigo IN ('reporte_rapido','clima_social_general','clima_social_focalizado','reporte_actividad','informe_oficial')
UNION ALL
SELECT 'Alerta Temprana', a.codigo_alerta, c.codigo_caso, NULL, a.fecha_reporte, g.region, g.provincia || ' / ' || g.distrito, c.nombre_caso, a.situacion_actual, NULL, NULL
  FROM core.alertas_tempranas a JOIN core.casos c ON c.id = a.caso_id JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id;

CREATE VIEW analytics.vw_mactor_red_actores AS
SELECT a.caso_id, no.etiqueta AS actor_origen, nd.etiqueta AS actor_destino, t.codigo AS tipo, t.clase, a.intensidad,
       a.valid_from, a.valid_to, a.confidence
  FROM kag.aristas a JOIN kag.nodos no ON no.id = a.origen_id AND no.tipo = 'actor' JOIN kag.nodos nd ON nd.id = a.destino_id AND nd.tipo = 'actor'
  JOIN kag.cat_tipos_arista t ON t.id = a.tipo_id
 WHERE a.superseded_at IS NULL AND t.clase IN ('relacion','influencia');

CREATE VIEW analytics.vw_casos_estancados AS
SELECT c.id, c.codigo_caso, (CURRENT_DATE - c.fecha_ultima_actualizacion::date) AS dias_estancado
  FROM core.casos c JOIN core.cat_estados_caso e ON e.id = c.estado_id AND e.es_activo;

CREATE VIEW analytics.vw_organizaciones_vigencia AS   -- RF-11
SELECT a.actor_uid, a.nombre_actual, o.vigencia_hasta, (o.vigencia_hasta - CURRENT_DATE) AS dias_para_vencer,
       CASE WHEN o.vigencia_hasta < CURRENT_DATE THEN 'VENCIDA' WHEN o.vigencia_hasta <= CURRENT_DATE + 60 THEN 'POR_VENCER' ELSE 'VIGENTE' END AS estado_vigencia
  FROM core.organizaciones o JOIN core.actores a ON a.actor_uid = o.actor_uid;

CREATE VIEW analytics.vw_riesgo_sistemico AS
SELECT c.codigo_caso, nr.codigo AS riesgo_social,
       enos.valor AS indice_enos, enos.vigente AS enos_vigente, pob.valor AS pobreza_monetaria, pob.vigente AS pobreza_vigente,
       CASE WHEN enos.vigente AND enos.valor > 1.5 AND nr.codigo = 'Alto' THEN 'ALTO: señal climática + riesgo social alto'
            WHEN pob.vigente AND pob.valor > 30 AND nr.codigo = 'Alto' THEN 'ALTO: vulnerabilidad social + riesgo alto'
            WHEN NOT COALESCE(enos.vigente, FALSE) AND NOT COALESCE(pob.vigente, FALSE) THEN 'SIN CONTEXTO VIGENTE' ELSE 'MODERADO' END AS riesgo_sistemico
  FROM core.casos c JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
  LEFT JOIN LATERAL ctx.ultima_observacion('ENOS_ICEN', c.distrito_principal_id) enos ON TRUE
  LEFT JOIN LATERAL ctx.ultima_observacion('POBREZA_MONETARIA', c.distrito_principal_id) pob ON TRUE;

CREATE MATERIALIZED VIEW analytics.mv_dashboard_alta_direccion AS
WITH base AS (
  SELECT g.region_id, g.region, nc.codigo AS nivel, nr.codigo AS riesgo, c.fecha_ultima_actualizacion
    FROM core.casos c JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id
    JOIN core.cat_niveles_conflicto nc ON nc.id = c.nivel_conflicto_id JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
    JOIN core.cat_estados_caso e ON e.id = c.estado_id AND e.es_activo),
venc AS (   -- pre-agregado: evita el producto cartesiano casos x hitos de la versión anterior
  SELECT g.region_id, COUNT(*) AS n
    FROM core.hitos_compromiso h JOIN core.cat_estados_hito eh ON eh.id = h.estado_id AND NOT eh.es_terminal
    JOIN core.compromisos co ON co.id = h.compromiso_id JOIN core.casos c ON c.id = co.caso_id
    JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id
   WHERE h.fecha_vencimiento < CURRENT_DATE GROUP BY g.region_id)
SELECT b.region_id, b.region, COUNT(*) AS casos_activos, COUNT(*) FILTER (WHERE b.riesgo = 'Alto') AS riesgo_alto,
       COUNT(*) FILTER (WHERE b.nivel = 'Crisis_social') AS crisis, COALESCE(MAX(v.n), 0) AS compromisos_vencidos,
       MAX(b.fecha_ultima_actualizacion) AS ultima_actividad, MAX(CURRENT_DATE - b.fecha_ultima_actualizacion::date) AS max_dias_estancado
  FROM base b LEFT JOIN venc v ON v.region_id = b.region_id GROUP BY b.region_id, b.region;
CREATE UNIQUE INDEX ux_mv_dashboard ON analytics.mv_dashboard_alta_direccion(region_id);   -- permite REFRESH ... CONCURRENTLY

CREATE INDEX ix_synthetic_test_cases_caso_semilla_id ON agent.synthetic_test_cases(caso_semilla_id);
CREATE INDEX ix_raw_ingest_rejected_raw_id ON avisa.raw_ingest_rejected(raw_id);
CREATE INDEX ix_actor_membresia_persona_uid ON core.actor_membresia(persona_uid);
CREATE INDEX ix_alertas_actores_actor_id ON core.alertas_actores(actor_id);
CREATE INDEX ix_caso_cronologia_actor_uid ON core.caso_cronologia(actor_uid);
CREATE INDEX ix_caso_distritos_distrito_id ON core.caso_distritos(distrito_id);
CREATE INDEX ix_caso_lugares_lugar_id ON core.caso_lugares(lugar_id);
CREATE INDEX ix_compromiso_colaboradores_actor_uid ON core.compromiso_colaboradores(actor_uid);
CREATE INDEX ix_compromiso_distritos_distrito_id ON core.compromiso_distritos(distrito_id);
CREATE INDEX ix_compromisos_documento_origen_id ON core.compromisos(documento_origen_id);
CREATE INDEX ix_compromisos_reunion_id ON core.compromisos(reunion_id);
CREATE INDEX ix_cronologia_vinculos_alerta_id ON core.cronologia_vinculos(alerta_id);
CREATE INDEX ix_cronologia_vinculos_cronologia_id ON core.cronologia_vinculos(cronologia_id);
CREATE INDEX ix_cronologia_vinculos_documento_id ON core.cronologia_vinculos(documento_id);
CREATE INDEX ix_demandas_actores_actor_id ON core.demandas_actores(actor_id);
CREATE INDEX ix_demandas_evidencias_demanda_id ON core.demandas_evidencias(demanda_id);
CREATE INDEX ix_derivaciones_alerta_alerta_id ON core.derivaciones_alerta(alerta_id);
CREATE INDEX ix_fuentes_evidencia_cronologia_id ON core.fuentes_evidencia(cronologia_id);
CREATE INDEX ix_organizaciones_representante_uid ON core.organizaciones(representante_uid);
CREATE INDEX ix_output_contracts_caso_id ON core.output_contracts(caso_id);
CREATE INDEX ix_output_contracts_snapshot_id ON core.output_contracts(snapshot_id);
CREATE INDEX ix_plan_acciones_plan_id ON core.plan_acciones(plan_id);
CREATE INDEX ix_plan_acciones_responsable_uid ON core.plan_acciones(responsable_uid);
CREATE INDEX ix_reunion_participantes_actor_uid ON core.reunion_participantes(actor_uid);
CREATE INDEX ix_reunion_participantes_institucion_uid ON core.reunion_participantes(institucion_uid);
CREATE INDEX ix_snapshot_caso_id ON ctx.snapshot(caso_id);
CREATE INDEX ix_actor_profile_attribute_supersedes_id ON kag.actor_profile_attribute(supersedes_id);
CREATE INDEX ix_arista_evidencia_fragmento_id ON kag.arista_evidencia(fragmento_id);
CREATE INDEX ix_aristas_split_from_id ON kag.aristas(split_from_id);
CREATE INDEX ix_aristas_supersedes_id ON kag.aristas(supersedes_id);
CREATE INDEX ix_atributo_evidencia_fragmento_id ON kag.atributo_evidencia(fragmento_id);
CREATE INDEX ix_documento_fuente_core_documento_id ON kag.documento_fuente(core_documento_id);
CREATE INDEX ix_embedding_atributo_id ON kag.embedding(atributo_id);
CREATE INDEX ix_embedding_fragmento_id ON kag.embedding(fragmento_id);
CREATE INDEX ix_entity_merge_log_resultante_uid ON kag.entity_merge_log(resultante_uid);
CREATE INDEX ix_entity_merge_members_actor_uid ON kag.entity_merge_members(actor_uid);
CREATE INDEX ix_objetivo_caso_id ON kag.objetivo(caso_id);
CREATE INDEX ix_certificaciones_planta_planta_id ON territorio.certificaciones_planta(planta_id);
CREATE INDEX ix_impacto_conflicto_planta_caso_id ON territorio.impacto_conflicto_planta(caso_id);
CREATE INDEX ix_impacto_conflicto_planta_planta_id ON territorio.impacto_conflicto_planta(planta_id);
CREATE INDEX ix_lugar_actores_actor_uid ON territorio.lugar_actores(actor_uid);
CREATE INDEX ix_lugares_administrador_uid ON territorio.lugares(administrador_uid);
CREATE INDEX ix_patrones_seguridad_caleta_caleta_id ON territorio.patrones_seguridad_caleta(caleta_id);

CREATE MATERIALIZED VIEW analytics.mv_compromisos_inter_ministeriales AS
SELECT c.codigo_caso, co.codigo_compromiso, ec.codigo AS estado_compromiso, i.sistema_destino, i.workflow_state, i.ultima_sincronizacion
  FROM core.compromisos co JOIN core.casos c ON co.caso_id = c.id JOIN core.cat_estados_compromiso ec ON ec.id = co.estado_id
  JOIN core.integraciones i ON i.entidad_origen_id = co.id AND i.entidad_origen_tipo = 'compromiso'
 WHERE i.sistema_destino IN ('MEF','MINAM','MINCETUR','MININTER','RREE');
CREATE UNIQUE INDEX ux_mv_inter_min ON analytics.mv_compromisos_inter_ministeriales(codigo_compromiso, sistema_destino);

-- ===== Sección 14 (módulos) =====
CREATE SCHEMA IF NOT EXISTS forecast;

CREATE TABLE forecast.model_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_type VARCHAR(100) NOT NULL,
    model_version VARCHAR(20) NOT NULL,
    training_data_hash CHAR(64) NOT NULL,
    last_trained_at TIMESTAMPTZ NOT NULL,
    accuracy_metrics_json JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    deactivated_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE forecast.predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES forecast.model_registry(id),
    target_type VARCHAR(50) NOT NULL CHECK (target_type IN
        ('caso','caleta','subsector','region')),
    target_id UUID NOT NULL,
    prediction_date DATE NOT NULL,
    prediction_horizon_days INT NOT NULL,
    probability NUMERIC(5,4) CHECK (probability BETWEEN 0 AND 1),
    confidence_interval_low NUMERIC(5,4),
    confidence_interval_high NUMERIC(5,4),
    contributing_factors_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE forecast.model_drift_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES forecast.model_registry(id),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    drift_type VARCHAR(50) NOT NULL,
    drift_magnitude NUMERIC(5,4),
    action_taken VARCHAR(100)
);

CREATE SCHEMA IF NOT EXISTS economic;

CREATE TABLE economic.impact_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caso_id UUID NOT NULL REFERENCES core.casos(id),
    scenario_type VARCHAR(20) NOT NULL CHECK (scenario_type IN
        ('base','optimista','pesimista')),
    assumptions_json JSONB NOT NULL,
    estimated_loss_usd NUMERIC(15,2),
    estimated_job_loss INT,
    estimated_fiscal_impact NUMERIC(15,2),
    methodology_version VARCHAR(20) NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE economic.anexo_metodologico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version VARCHAR(20) NOT NULL UNIQUE,
    cadena_causal_json JSONB NOT NULL,
    fuentes_por_dato_json JSONB NOT NULL,
    supuestos_documentados_json JSONB NOT NULL,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES core.usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE economic.counterfactual_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caso_resuelto_id UUID NOT NULL REFERENCES core.casos(id),
    analog_cases_json JSONB NOT NULL,
    estimated_without_intervention_usd NUMERIC(15,2),
    estimated_with_intervention_usd NUMERIC(15,2),
    difference_usd NUMERIC(15,2),
    methodology_version VARCHAR(20) NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS community;

CREATE TABLE community.encuestas_percepcion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caleta_id UUID NOT NULL REFERENCES territorio.caleta_detalle(lugar_id),
    fecha DATE NOT NULL,
    consentimiento BOOLEAN NOT NULL DEFAULT FALSE,
    satisfaccion_likert SMALLINT CHECK (satisfaccion_likert BETWEEN 1 AND 5),
    confianza_institucional_likert SMALLINT CHECK (confianza_institucional_likert BETWEEN 1 AND 5),
    percepcion_seguridad_likert SMALLINT CHECK (percepcion_seguridad_likert BETWEEN 1 AND 5),
    percepcion_servicios_likert SMALLINT CHECK (percepcion_servicios_likert BETWEEN 1 AND 5),
    comentario_texto TEXT,
    encuestador_id UUID REFERENCES core.usuarios(id)
);

CREATE SCHEMA IF NOT EXISTS consultation;

CREATE TABLE consultation.procesos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caso_id UUID NOT NULL REFERENCES core.casos(id),
    pueblo_indigena VARCHAR(255) NOT NULL,
    fase_actual VARCHAR(50) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_estimada_cierre DATE,
    estado VARCHAR(30) NOT NULL CHECK (estado IN
        ('En_curso','Cerrado_acuerdo','Cerrado_desacuerdo','Suspendido')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    nivel_clasificacion VARCHAR(20) NOT NULL DEFAULT 'Reservado'
);

CREATE TABLE consultation.etapas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proceso_id UUID NOT NULL REFERENCES consultation.procesos(id),
    tipo_etapa VARCHAR(50) NOT NULL CHECK (tipo_etapa IN
        ('Publicidad','Informacion','Evaluacion_Interna','Dialogo','Decision')),
    fecha_inicio DATE,
    fecha_fin DATE,
    documento_evidencia_url VARCHAR(500),
    observaciones TEXT
);

CREATE TABLE consultation.actores (
    proceso_id UUID NOT NULL REFERENCES consultation.procesos(id),
    actor_id UUID NOT NULL REFERENCES core.actores(actor_uid),
    rol_en_consulta VARCHAR(50),
    PRIMARY KEY (proceso_id, actor_id)
);

CREATE TABLE consultation.resultados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proceso_id UUID NOT NULL REFERENCES consultation.procesos(id),
    tipo_resultado VARCHAR(50) NOT NULL CHECK (tipo_resultado IN
        ('Acuerdo','Desacuerdo','Acuerdo_Parcial')),
    descripcion TEXT NOT NULL,
    documento_url VARCHAR(500),
    fecha DATE NOT NULL
);

CREATE SCHEMA IF NOT EXISTS impact;

CREATE TABLE impact.encuestas_post_resolucion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caso_id UUID NOT NULL REFERENCES core.casos(id),
    actor_id UUID NOT NULL REFERENCES core.actores(actor_uid),
    fecha DATE NOT NULL,
    consentimiento BOOLEAN NOT NULL DEFAULT FALSE,
    satisfaccion_likert SMALLINT CHECK (satisfaccion_likert BETWEEN 1 AND 5),
    confianza_institucional_likert SMALLINT CHECK (confianza_institucional_likert BETWEEN 1 AND 5),
    percepcion_resolucion TEXT
);

CREATE TABLE impact.indicadores_bienestar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caso_id UUID NOT NULL REFERENCES core.casos(id),
    actor_id UUID NOT NULL REFERENCES core.actores(actor_uid),
    fecha DATE NOT NULL,
    ingreso_promedio NUMERIC(10,2),
    empleo_formal BOOLEAN,
    acceso_servicios_basicos BOOLEAN,
    seguridad_alimentaria VARCHAR(20) CHECK (seguridad_alimentaria IN
        ('Alta','Media','Baja')),
    fuente VARCHAR(100)
);

CREATE TABLE impact.analisis_recurrencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caso_resuelto_id UUID NOT NULL REFERENCES core.casos(id),
    recurrencia_12m BOOLEAN,
    recurrencia_24m BOOLEAN,
    recurrencia_36m BOOLEAN,
    caso_recurrente_id UUID REFERENCES core.casos(id),
    notas TEXT
);

CREATE TABLE impact.evaluaciones_efectividad (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_intervencion VARCHAR(100) NOT NULL,
    tipo_caso VARCHAR(100) NOT NULL,
    total_casos INT NOT NULL,
    casos_resueltos_sin_recurrencia INT NOT NULL,
    tasa_exito NUMERIC(5,4),
    periodo_analizado_desde DATE NOT NULL,
    periodo_analizado_hasta DATE NOT NULL,
    calculado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE impact.lecciones_aprendidas_automaticas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caso_id UUID NOT NULL REFERENCES core.casos(id),
    leccion TEXT NOT NULL,
    tipo_leccion VARCHAR(50) CHECK (tipo_leccion IN
        ('Que_funciono','Que_fallo','Que_aprender')),
    evidencia_json JSONB,
    revisado_por_ds BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Sección 20.20–20.28 (v8.3) =====
-- @@20.0bis
-- Schemas nuevos de v8.3 (se suman a los de 20.0)
CREATE SCHEMA IF NOT EXISTS policy;
CREATE SCHEMA IF NOT EXISTS ind;
CREATE SCHEMA IF NOT EXISTS analisis;
CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS qda;
CREATE SCHEMA IF NOT EXISTS lex;

-- @@20.20
-- Reglas de política
CREATE TABLE policy.gobierno (
    id SMALLINT PRIMARY KEY, nombre VARCHAR(120) NOT NULL, inicio DATE NOT NULL, fin DATE,
    CHECK (fin IS NULL OR fin > inicio)
);
CREATE TABLE policy.titular (
    id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gobierno_id SMALLINT NOT NULL REFERENCES policy.gobierno(id),
    cargo VARCHAR(80) NOT NULL, persona VARCHAR(160) NOT NULL, desde DATE NOT NULL, hasta DATE,
    CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE TABLE policy.cat_tipos_regla (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(40) NOT NULL UNIQUE, nombre VARCHAR(100) NOT NULL,
    claves_requeridas TEXT[] NOT NULL DEFAULT '{}',   -- validación estructural mínima en la base
    esquema_json JSONB                                -- JSON Schema completo: lo valida la aplicación
);
INSERT INTO policy.cat_tipos_regla (id, codigo, nombre, claves_requeridas) VALUES
 (1,'prioridad_tematica','Prioridad temática','{tema}'),
 (2,'prioridad_territorial','Prioridad territorial','{ambito}'),
 (3,'vocabulario_preferido','Vocabulario preferido','{terminos}'),
 (4,'indicador_requerido','Indicador requerido','{indicador}'),
 (5,'restriccion','Restricción','{condicion}');

CREATE TABLE policy.regla (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(30) NOT NULL,
    clase CHAR(1) NOT NULL CHECK (clase IN ('N','P','L')),   -- N normativa, P prioridad de gobierno, L lente analítico
    tipo_regla_id SMALLINT NOT NULL REFERENCES policy.cat_tipos_regla(id),
    titulo VARCHAR(200) NOT NULL, texto TEXT NOT NULL,
    parametros JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parametros) = 'object'),
    alcance VARCHAR(25) NOT NULL CHECK (alcance IN ('ordenamiento','seleccion_indicadores','encuadre','prompt_contexto')),
    estado VARCHAR(12) NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador','en_tramite','vigente','suspendida','vencida','derogada')),
    gobierno_id SMALLINT REFERENCES policy.gobierno(id),
    titular_id SMALLINT REFERENCES policy.titular(id),
    fuente_documento_id UUID REFERENCES kag.documento_fuente(id),
    tipo_fuente VARCHAR(25) NOT NULL
        CHECK (tipo_fuente IN ('norma','discurso','plan_gobierno','instruccion_escrita','hipotesis_analitica')),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_to TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_at TIMESTAMPTZ,
    supersedes_id UUID REFERENCES policy.regla(id),
    disparador_vencimiento_fecha DATE, disparador_vencimiento_evento TEXT,
    propuesto_por UUID REFERENCES core.usuarios(id),
    aprobado_por UUID REFERENCES core.usuarios(id), aprobado_por_2 UUID REFERENCES core.usuarios(id),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    -- cuarentena: una hipótesis analítica jamás se inyecta como contexto
    CHECK (tipo_fuente <> 'hipotesis_analitica' OR estado <> 'vigente'),
    -- fuente obligatoria para clases N y P (salvo la hipótesis, que no puede estar vigente)
    CHECK (clase = 'L' OR tipo_fuente = 'hipotesis_analitica' OR fuente_documento_id IS NOT NULL),
    -- cuatro ojos para clase P vigente
    CHECK (clase <> 'P' OR estado <> 'vigente'
           OR (aprobado_por IS NOT NULL AND aprobado_por_2 IS NOT NULL AND aprobado_por <> aprobado_por_2))
);
CREATE UNIQUE INDEX ux_regla_codigo_vigente ON policy.regla (codigo) WHERE superseded_at IS NULL;

CREATE FUNCTION policy.chk_regla() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req TEXT[];
BEGIN
  SELECT claves_requeridas INTO req FROM policy.cat_tipos_regla WHERE id = NEW.tipo_regla_id;
  IF req IS NOT NULL AND cardinality(req) > 0 AND NOT (NEW.parametros ?& req) THEN
    RAISE EXCEPTION 'regla %: faltan claves requeridas en parametros (%)', NEW.codigo, req;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = 'vigente' AND NEW.estado = 'vigente'
     AND (NEW.parametros IS DISTINCT FROM OLD.parametros OR NEW.texto IS DISTINCT FROM OLD.texto) THEN
    RAISE EXCEPTION 'una regla vigente no se edita: se sustituye con una fila nueva (supersedes_id)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_chk_regla BEFORE INSERT OR UPDATE ON policy.regla FOR EACH ROW EXECUTE FUNCTION policy.chk_regla();

CREATE FUNCTION policy.aviso_vencimiento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.disparador_vencimiento_fecha IS NOT NULL AND NEW.propuesto_por IS NOT NULL AND NEW.estado <> 'vencida' THEN
    INSERT INTO core.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, vence_en)
    VALUES (NEW.propuesto_por, 'regla_por_vencer', 'policy.regla', NEW.id, NEW.disparador_vencimiento_fecha::timestamptz);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_aviso_vencimiento AFTER INSERT ON policy.regla FOR EACH ROW EXECUTE FUNCTION policy.aviso_vencimiento();

-- Reglas activas en (valido_en, conocido_en), con el nivel que permite el rol. SECURITY INVOKER: la RLS del usuario se aplica.
CREATE FUNCTION policy.reglas_activas(p_rol TEXT, p_valido_en TIMESTAMPTZ DEFAULT now(), p_conocido_en TIMESTAMPTZ DEFAULT now())
RETURNS SETOF policy.regla LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT r.* FROM policy.regla r
   WHERE r.estado = 'vigente' AND r.tipo_fuente <> 'hipotesis_analitica'
     AND r.valid_from <= p_valido_en AND (r.valid_to IS NULL OR r.valid_to > p_valido_en)
     AND r.recorded_at <= p_conocido_en AND (r.superseded_at IS NULL OR r.superseded_at > p_conocido_en)
     AND r.nivel_clasificacion <= COALESCE((SELECT max_clasificacion FROM core.roles WHERE codigo = p_rol), 1)
$$;
CREATE FUNCTION policy.contexto_activo(p_rol TEXT, p_valido_en TIMESTAMPTZ DEFAULT now(), p_conocido_en TIMESTAMPTZ DEFAULT now())
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT jsonb_build_object('valido_en', p_valido_en, 'conocido_en', p_conocido_en,
           'reglas', COALESCE(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'clase', r.clase, 'alcance', r.alcance,
                       'titulo', r.titulo, 'parametros', r.parametros)
                     ORDER BY CASE r.clase WHEN 'N' THEN 0 WHEN 'P' THEN 1 ELSE 2 END, r.codigo), '[]'::jsonb))
    FROM policy.reglas_activas(p_rol, p_valido_en, p_conocido_en) r
$$;

CREATE TABLE policy.snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    creado_por UUID REFERENCES core.usuarios(id), rol VARCHAR(30) NOT NULL,
    valido_en TIMESTAMPTZ NOT NULL, conocido_en TIMESTAMPTZ NOT NULL, policy_hash CHAR(64) NOT NULL
);
CREATE TABLE policy.snapshot_regla (
    snapshot_id UUID NOT NULL REFERENCES policy.snapshot(id) ON DELETE CASCADE,
    regla_id UUID NOT NULL REFERENCES policy.regla(id), PRIMARY KEY (snapshot_id, regla_id)
);
CREATE FUNCTION policy.crear_snapshot(p_rol TEXT, p_valido_en TIMESTAMPTZ DEFAULT now(), p_conocido_en TIMESTAMPTZ DEFAULT now())
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID := gen_random_uuid(); v_hash TEXT;
BEGIN
  SELECT encode(sha256(convert_to(COALESCE(string_agg(r.id::text, ',' ORDER BY r.id), ''), 'UTF8')), 'hex') INTO v_hash
    FROM policy.reglas_activas(p_rol, p_valido_en, p_conocido_en) r;
  INSERT INTO policy.snapshot (id, rol, valido_en, conocido_en, policy_hash) VALUES (v_id, p_rol, p_valido_en, p_conocido_en, v_hash);
  INSERT INTO policy.snapshot_regla (snapshot_id, regla_id)
    SELECT v_id, r.id FROM policy.reglas_activas(p_rol, p_valido_en, p_conocido_en) r;
  RETURN v_id;
END $$;

-- Vencimiento automático (programable con pg_cron): sustituye la fila vigente por una fila 'vencida'
CREATE FUNCTION policy.vencer_reglas(p_hoy DATE DEFAULT CURRENT_DATE) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE r policy.regla%ROWTYPE; n INT := 0;
BEGIN
  FOR r IN SELECT * FROM policy.regla
            WHERE estado = 'vigente' AND superseded_at IS NULL
              AND disparador_vencimiento_fecha IS NOT NULL AND disparador_vencimiento_fecha < p_hoy LOOP
    UPDATE policy.regla SET superseded_at = now() WHERE id = r.id;
    INSERT INTO policy.regla (codigo, clase, tipo_regla_id, titulo, texto, parametros, alcance, estado, gobierno_id, titular_id,
                              fuente_documento_id, tipo_fuente, valid_from, valid_to, supersedes_id, disparador_vencimiento_fecha,
                              disparador_vencimiento_evento, propuesto_por, aprobado_por, aprobado_por_2, nivel_clasificacion)
    VALUES (r.codigo, r.clase, r.tipo_regla_id, r.titulo, r.texto, r.parametros, r.alcance, 'vencida', r.gobierno_id, r.titular_id,
            r.fuente_documento_id, r.tipo_fuente, r.disparador_vencimiento_fecha::timestamptz, NULL, r.id,
            r.disparador_vencimiento_fecha, r.disparador_vencimiento_evento, r.propuesto_por, r.aprobado_por, r.aprobado_por_2,
            r.nivel_clasificacion);
    IF r.propuesto_por IS NOT NULL THEN
      INSERT INTO core.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id) VALUES (r.propuesto_por, 'regla_vencida', 'policy.regla', r.id);
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Escenarios de política (análisis «qué pasaría si»; M5a)
CREATE TABLE policy.escenario (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nombre VARCHAR(160) NOT NULL UNIQUE, descripcion TEXT,
    creado_por UUID REFERENCES core.usuarios(id), creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE policy.escenario_regla (
    escenario_id UUID NOT NULL REFERENCES policy.escenario(id) ON DELETE CASCADE,
    regla_id UUID NOT NULL REFERENCES policy.regla(id), PRIMARY KEY (escenario_id, regla_id)
);

-- Enlaces con el núcleo
ALTER TABLE core.output_contracts ADD COLUMN policy_snapshot_id UUID REFERENCES policy.snapshot(id);
ALTER TABLE core.query_cache ADD COLUMN policy_hash CHAR(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE core.query_cache DROP CONSTRAINT query_cache_pkey;
ALTER TABLE core.query_cache ADD PRIMARY KEY (clave_hash, clasificacion_max, policy_hash);

-- @@20.21
CREATE TABLE ind.indicador (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), codigo VARCHAR(40) NOT NULL UNIQUE, nombre VARCHAR(200) NOT NULL, definicion TEXT,
    componente_guia VARCHAR(25) NOT NULL
        CHECK (componente_guia IN ('prevencion_estrategica','prevencion_operativa','tratamiento','monitoreo','conocimiento')),
    anexo_origen SMALLINT CHECK (anexo_origen BETWEEN 1 AND 17),
    naturaleza VARCHAR(20), direccion VARCHAR(12) CHECK (direccion IN ('mayor_mejor','menor_mejor','neutral'))
);
CREATE TABLE ind.variante (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), indicador_id UUID NOT NULL REFERENCES ind.indicador(id),
    clase VARCHAR(10) NOT NULL CHECK (clase IN ('estandar','factible','proxy','brecha')),
    especificacion JSONB NOT NULL DEFAULT '{}',           -- apunta a una vista o a una variable de ctx.cat_variables
    variable_id SMALLINT REFERENCES ctx.cat_variables(id),
    nivel_evidencia SMALLINT NOT NULL CHECK (nivel_evidencia BETWEEN 1 AND 5),
    requiere_campo BOOLEAN NOT NULL DEFAULT FALSE, horas_estimadas NUMERIC(6,1) CHECK (horas_estimadas >= 0),
    estado VARCHAR(12) NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta','activa','retirada')),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by UUID REFERENCES core.usuarios(id)
);
CREATE TABLE ind.proxy_justificacion (
    variante_id UUID PRIMARY KEY REFERENCES ind.variante(id) ON DELETE CASCADE,
    constructo_objetivo TEXT NOT NULL, fuente_validez_id UUID NOT NULL REFERENCES kag.documento_fuente(id),
    supuestos TEXT NOT NULL, limites TEXT NOT NULL,
    incertidumbre VARCHAR(5) NOT NULL CHECK (incertidumbre IN ('baja','media','alta'))
);
-- Toda variante 'proxy' exige su justificación (se verifica al cerrar la transacción)
CREATE FUNCTION ind.exigir_justificacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clase = 'proxy' AND NOT EXISTS (SELECT 1 FROM ind.proxy_justificacion WHERE variante_id = NEW.id) THEN
    RAISE EXCEPTION 'la variante proxy % requiere una fila en ind.proxy_justificacion', NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_proxy_justificacion AFTER INSERT OR UPDATE ON ind.variante
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ind.exigir_justificacion();

CREATE TABLE ind.plantilla (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), codigo VARCHAR(40) NOT NULL UNIQUE, nombre VARCHAR(200) NOT NULL,
    tipo_documento_id SMALLINT REFERENCES core.cat_tipos_documento(id),   -- comparte JSON Schema con cat_tipos_documento.esquema_json
    descripcion TEXT
);
CREATE TABLE ind.plantilla_slot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plantilla_id UUID NOT NULL REFERENCES ind.plantilla(id) ON DELETE CASCADE,
    orden SMALLINT NOT NULL, codigo VARCHAR(40) NOT NULL, indicador_id UUID NOT NULL REFERENCES ind.indicador(id),
    UNIQUE (plantilla_id, codigo), UNIQUE (plantilla_id, orden)
);
CREATE TABLE ind.seleccion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slot_id UUID NOT NULL REFERENCES ind.plantilla_slot(id),
    caso_id UUID REFERENCES core.casos(id), distrito_id INT REFERENCES core.distritos(id), periodo VARCHAR(10) NOT NULL,
    variante_id UUID NOT NULL REFERENCES ind.variante(id), alternativas_mostradas JSONB NOT NULL,
    seleccionada_por UUID NOT NULL REFERENCES core.usuarios(id), motivo TEXT,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_to TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_at TIMESTAMPTZ, supersedes_id UUID REFERENCES ind.seleccion(id)
);
CREATE INDEX ix_seleccion_vigente ON ind.seleccion (slot_id, periodo) WHERE superseded_at IS NULL;
CREATE TABLE ind.resultado (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), variante_id UUID NOT NULL REFERENCES ind.variante(id),
    distrito_id INT REFERENCES core.distritos(id), periodo VARCHAR(10) NOT NULL,
    valor NUMERIC, incertidumbre VARCHAR(5) CHECK (incertidumbre IN ('baja','media','alta')),
    run_id UUID,                                          -- referencia lógica a agent.run_log (tabla particionada)
    calculado_en TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (variante_id, distrito_id, periodo)
);
CREATE TABLE ind.brecha (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), indicador_id UUID NOT NULL REFERENCES ind.indicador(id),
    descripcion TEXT NOT NULL, propuesta_recoleccion TEXT, requiere_campo BOOLEAN NOT NULL DEFAULT TRUE,
    horas_estimadas NUMERIC(6,1) NOT NULL CHECK (horas_estimadas >= 0), mes_previsto DATE,
    estado VARCHAR(10) NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta','aprobada','en_campo','cerrada','descartada')),
    decidido_por UUID REFERENCES core.usuarios(id), decision_escrita_uri VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE core.capacidad_campo (
    usuario_id UUID NOT NULL REFERENCES core.usuarios(id), mes DATE NOT NULL CHECK (mes = date_trunc('month', mes)::date),
    horas_disponibles NUMERIC(6,1) NOT NULL CHECK (horas_disponibles >= 0), PRIMARY KEY (usuario_id, mes)
);
-- Una brecha solo pasa a 'aprobada' si cabe en la capacidad del mes o existe decisión escrita de la Dirección
CREATE FUNCTION ind.chk_brecha_capacidad() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_cap NUMERIC; v_carga NUMERIC;
BEGIN
  IF NEW.estado IN ('aprobada','en_campo') AND NEW.requiere_campo
     AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('aprobada','en_campo')) THEN
    IF NEW.decision_escrita_uri IS NULL THEN
      SELECT COALESCE(sum(horas_disponibles), 0) INTO v_cap FROM core.capacidad_campo WHERE mes = NEW.mes_previsto;
      SELECT COALESCE(sum(horas_estimadas), 0) INTO v_carga FROM ind.brecha
       WHERE mes_previsto = NEW.mes_previsto AND requiere_campo AND estado IN ('aprobada','en_campo') AND id <> NEW.id;
      IF v_carga + NEW.horas_estimadas > v_cap THEN
        RAISE EXCEPTION 'la brecha excede la capacidad de campo de % (% h cargadas + % h > % h): requiere decisión escrita o un proxy',
          NEW.mes_previsto, v_carga, NEW.horas_estimadas, v_cap;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_brecha_capacidad BEFORE INSERT OR UPDATE ON ind.brecha FOR EACH ROW EXECUTE FUNCTION ind.chk_brecha_capacidad();

-- @@20.22
CREATE TABLE analisis.cat_herramientas (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(30) NOT NULL UNIQUE, nombre VARCHAR(80) NOT NULL
);
INSERT INTO analisis.cat_herramientas VALUES (1,'maxqda','MAXQDA'),(2,'atlas_ti','ATLAS.ti'),(3,'nvivo','NVivo'),
 (4,'iramuteq','IRaMuTeQ'),(5,'r','R'),(6,'excel','Excel'),(7,'otra','Otra');
CREATE TABLE analisis.punto_ingesta (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(40) NOT NULL UNIQUE, descripcion TEXT NOT NULL, esquema_validacion JSONB,
    destino VARCHAR(5) NOT NULL CHECK (destino IN ('qda','lex','kag','ind','core'))
);
INSERT INTO analisis.punto_ingesta (id, codigo, descripcion, destino) VALUES
 (1,'PI-01','Plan de análisis','core'),
 (2,'PI-02','Proyecto cualitativo .qdpx y libro de códigos .qdc','qda'),
 (3,'PI-03','Resultados léxicos CSV','lex'),
 (4,'PI-04','Validación de aristas del grafo','kag'),
 (5,'PI-05','Selección de indicadores','ind'),
 (6,'PI-06','Tabla externa CSV o XLSX con esquema','core'),
 (7,'PI-07','Salida final aprobada','core');
CREATE TABLE analisis.plan (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID REFERENCES core.casos(id), pregunta TEXT NOT NULL,
    tipo VARCHAR(12) NOT NULL CHECK (tipo IN ('cualitativo','lexico','mixto','cuantitativo')),
    estado VARCHAR(25) NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador','aprobado','en_ejecucion','resultados_ingestados','cerrado')),
    pauta JSONB, version INT NOT NULL DEFAULT 1,
    creado_por UUID REFERENCES core.usuarios(id), aprobado_por UUID REFERENCES core.usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    CHECK (estado = 'borrador' OR aprobado_por IS NOT NULL)
);
CREATE TABLE analisis.plan_paso (    -- el flujo (DAG) es dato: cada persona edita su plan sin tocar el agente
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plan_id UUID NOT NULL REFERENCES analisis.plan(id) ON DELETE CASCADE,
    orden SMALLINT NOT NULL, tipo_paso VARCHAR(40) NOT NULL, instruccion TEXT NOT NULL,
    herramienta_id SMALLINT REFERENCES analisis.cat_herramientas(id),
    entregable_esperado VARCHAR(5) CHECK (entregable_esperado IN ('qdpx','qdc','csv','xlsx','pdf')),
    punto_ingesta_id SMALLINT REFERENCES analisis.punto_ingesta(id),
    depende_de UUID REFERENCES analisis.plan_paso(id),
    estado VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','entregado','ingestado','omitido')),
    UNIQUE (plan_id, orden)
);
CREATE TABLE staging.lote (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), punto_ingesta_id SMALLINT NOT NULL REFERENCES analisis.punto_ingesta(id),
    plan_paso_id UUID REFERENCES analisis.plan_paso(id), origen_software VARCHAR(60), version_software VARCHAR(30),
    archivo_uri VARCHAR(500) NOT NULL, hash_archivo CHAR(64) NOT NULL,
    estado VARCHAR(12) NOT NULL DEFAULT 'recibido' CHECK (estado IN ('recibido','validado','con_errores','promovido','rechazado')),
    validacion JSONB, cargado_por UUID REFERENCES core.usuarios(id), aprobado_por UUID REFERENCES core.usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    CHECK (estado <> 'promovido' OR aprobado_por IS NOT NULL)
);
CREATE TABLE staging.registro (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, lote_id UUID NOT NULL REFERENCES staging.lote(id) ON DELETE CASCADE,
    n INT NOT NULL, payload JSONB NOT NULL, errores JSONB
);
-- Promoción: solo lotes 'validado'. Corre con el rol de quien aprueba (SECURITY INVOKER), de modo que la RLS sigue vigente.
-- Los cargadores por destino (qda, lex, kag, ind) se invocan después de esta verificación.
CREATE FUNCTION staging.promover(p_lote UUID, p_aprobador UUID) RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_estado TEXT;
BEGIN
  SELECT estado INTO v_estado FROM staging.lote WHERE id = p_lote FOR UPDATE;
  IF v_estado IS NULL THEN RAISE EXCEPTION 'lote % inexistente o no visible', p_lote; END IF;
  IF v_estado <> 'validado' THEN
    RAISE EXCEPTION 'el lote % está en estado %, solo se promueven lotes validados', p_lote, v_estado;
  END IF;
  UPDATE staging.lote SET estado = 'promovido', aprobado_por = p_aprobador WHERE id = p_lote;
END $$;

-- @@20.23
-- Anclas de texto: los segmentos cualitativos se miden en caracteres del texto exportado (versionado)
ALTER TABLE kag.documento_fuente ADD COLUMN texto_version INT NOT NULL DEFAULT 1;   -- hash_contenido se calcula sobre el texto normalizado (NFC, saltos fijos)
ALTER TABLE kag.documento_fragmento
    ADD COLUMN inicio_char INT, ADD COLUMN fin_char INT, ADD COLUMN texto_version INT NOT NULL DEFAULT 1,
    ADD CONSTRAINT ck_fragmento_offsets CHECK ((inicio_char IS NULL AND fin_char IS NULL) OR (inicio_char >= 0 AND fin_char > inicio_char));

CREATE TABLE qda.proyecto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nombre VARCHAR(200) NOT NULL,
    software_origen VARCHAR(60), version_software VARCHAR(30), version_estandar VARCHAR(20),
    archivo_uri VARCHAR(500), hash CHAR(64), plan_paso_id UUID REFERENCES analisis.plan_paso(id),
    importado_por UUID REFERENCES core.usuarios(id), importado_en TIMESTAMPTZ,
    estado VARCHAR(10) NOT NULL DEFAULT 'staging' CHECK (estado IN ('staging','validado','rechazado','anulado')),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE TABLE qda.libro_codigos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), proyecto_id UUID REFERENCES qda.proyecto(id),
    nombre VARCHAR(200) NOT NULL, version INT NOT NULL DEFAULT 1,
    origen VARCHAR(10) NOT NULL CHECK (origen IN ('sistema','analista','importado')),
    vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE, vigente_hasta DATE, UNIQUE (nombre, version)
);
CREATE TABLE qda.codigo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), libro_id UUID NOT NULL REFERENCES qda.libro_codigos(id) ON DELETE CASCADE,
    guid_externo VARCHAR(64) NOT NULL, padre_id UUID REFERENCES qda.codigo(id), nombre VARCHAR(200) NOT NULL,
    descripcion TEXT, color VARCHAR(9), es_codificable BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE (libro_id, guid_externo)
);
CREATE TABLE qda.fuente (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), proyecto_id UUID NOT NULL REFERENCES qda.proyecto(id) ON DELETE CASCADE,
    documento_id UUID NOT NULL REFERENCES kag.documento_fuente(id), guid_externo VARCHAR(64) NOT NULL, tipo VARCHAR(30),
    texto_version INT NOT NULL, hash_texto_exportado CHAR(64) NOT NULL, longitud_caracteres INT NOT NULL CHECK (longitud_caracteres >= 0),
    idioma VARCHAR(10) NOT NULL DEFAULT 'spa',          -- ISO 639-3
    solo_manual BOOLEAN NOT NULL DEFAULT FALSE,          -- lenguas originarias: solo codificación manual
    UNIQUE (proyecto_id, guid_externo)
);
CREATE TABLE qda.segmento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), fuente_id UUID NOT NULL REFERENCES qda.fuente(id) ON DELETE CASCADE,
    codigo_id UUID NOT NULL REFERENCES qda.codigo(id), inicio_char INT NOT NULL CHECK (inicio_char >= 0),
    fin_char INT NOT NULL, guid_externo VARCHAR(64), codificador_usuario_id UUID REFERENCES core.usuarios(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_at TIMESTAMPTZ, supersedes_id UUID REFERENCES qda.segmento(id),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    CHECK (fin_char > inicio_char)
);
CREATE TABLE qda.segmento_fragmento (    -- segmentos y fragmentos no coinciden: se cruzan por solape
    segmento_id UUID NOT NULL REFERENCES qda.segmento(id) ON DELETE CASCADE,
    fragmento_id UUID NOT NULL REFERENCES kag.documento_fragmento(id), solape_chars INT NOT NULL CHECK (solape_chars > 0),
    PRIMARY KEY (segmento_id, fragmento_id)
);
CREATE TABLE qda.memo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), proyecto_id UUID NOT NULL REFERENCES qda.proyecto(id) ON DELETE CASCADE,
    ambito VARCHAR(10) NOT NULL CHECK (ambito IN ('proyecto','documento','codigo','segmento','caso')), objeto_id UUID,
    texto TEXT NOT NULL, autor UUID REFERENCES core.usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE TABLE qda.mapeo_pseudonimo (      -- nivel 3: legible solo por la función de importación
    proyecto_id UUID NOT NULL REFERENCES qda.proyecto(id) ON DELETE CASCADE, token VARCHAR(40) NOT NULL,
    actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 3 CHECK (nivel_clasificacion = 3) REFERENCES core.cat_clasificacion(nivel),
    PRIMARY KEY (proyecto_id, token)
);
CREATE TABLE qda.perdida_roundtrip (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), proyecto_id UUID NOT NULL REFERENCES qda.proyecto(id) ON DELETE CASCADE,
    elemento VARCHAR(60) NOT NULL, software VARCHAR(60) NOT NULL, descripcion TEXT
);
CREATE TABLE qda.exportacion (           -- cada exportación sale del perímetro OGTI: queda registrada (RS-05)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), proyecto_id UUID REFERENCES qda.proyecto(id),
    usuario_id UUID NOT NULL REFERENCES core.usuarios(id), exportado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    descripcion_corpus JSONB NOT NULL, hash_archivo CHAR(64) NOT NULL,
    pseudonimizado BOOLEAN NOT NULL DEFAULT TRUE, excepcion_aprobada_por UUID REFERENCES core.usuarios(id),
    dispositivo_institucional BOOLEAN NOT NULL DEFAULT TRUE, caduca_en TIMESTAMPTZ NOT NULL, run_id UUID,
    CHECK (pseudonimizado OR excepcion_aprobada_por IS NOT NULL),
    CHECK (caduca_en > exportado_en)
);
-- Herencia de clasificación: el segmento hereda la máxima de su fuente; el memo, la del texto que cita
CREATE FUNCTION qda.hereda_clasificacion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_nivel SMALLINT; v_long INT;
BEGIN
  IF TG_TABLE_NAME = 'segmento' THEN
    SELECT GREATEST(d.nivel_clasificacion, 1), f.longitud_caracteres INTO v_nivel, v_long
      FROM qda.fuente f JOIN kag.documento_fuente d ON d.id = f.documento_id WHERE f.id = NEW.fuente_id;
    IF v_long IS NOT NULL AND NEW.fin_char > v_long THEN
      RAISE EXCEPTION 'segmento fuera del texto: fin_char % > longitud %', NEW.fin_char, v_long;
    END IF;
  ELSIF TG_TABLE_NAME = 'memo' THEN
    IF NEW.ambito = 'segmento' THEN
      SELECT s.nivel_clasificacion INTO v_nivel FROM qda.segmento s WHERE s.id = NEW.objeto_id;
    ELSIF NEW.ambito = 'documento' THEN
      SELECT d.nivel_clasificacion INTO v_nivel FROM qda.fuente f JOIN kag.documento_fuente d ON d.id = f.documento_id WHERE f.id = NEW.objeto_id;
    END IF;
  END IF;
  IF v_nivel IS NOT NULL THEN NEW.nivel_clasificacion := GREATEST(NEW.nivel_clasificacion, v_nivel); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hereda BEFORE INSERT OR UPDATE ON qda.segmento FOR EACH ROW EXECUTE FUNCTION qda.hereda_clasificacion();
CREATE TRIGGER trg_hereda BEFORE INSERT OR UPDATE ON qda.memo FOR EACH ROW EXECUTE FUNCTION qda.hereda_clasificacion();
-- Exportar sin pseudonimizar exige un permiso de aprobación vigente (core.permiso_aprobacion, 20.27)
CREATE FUNCTION qda.chk_exportacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.pseudonimizado AND NOT EXISTS (
       SELECT 1 FROM core.permiso_aprobacion p
        WHERE p.usuario_id = NEW.excepcion_aprobada_por AND p.objeto = 'qda.exportar_sin_pseudonimo'
          AND p.vigente_desde <= CURRENT_DATE AND (p.vigente_hasta IS NULL OR p.vigente_hasta >= CURRENT_DATE)) THEN
    RAISE EXCEPTION 'exportar sin pseudonimizar exige un permiso de aprobación vigente de la Dirección';
  END IF;
  IF NOT NEW.dispositivo_institucional THEN
    RAISE EXCEPTION 'la exportación solo se admite a dispositivos institucionales';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_chk_exportacion BEFORE INSERT ON qda.exportacion FOR EACH ROW EXECUTE FUNCTION qda.chk_exportacion();

-- @@20.24
CREATE TABLE lex.corpus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nombre VARCHAR(200) NOT NULL UNIQUE, filtro JSONB NOT NULL DEFAULT '{}',
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),   -- clasificación máxima de sus documentos
    congelado BOOLEAN NOT NULL DEFAULT FALSE, hash_corpus CHAR(64), CHECK (NOT congelado OR hash_corpus IS NOT NULL)
);
CREATE TABLE lex.corpus_documento (
    corpus_id UUID NOT NULL REFERENCES lex.corpus(id) ON DELETE CASCADE, fuente_id UUID NOT NULL REFERENCES kag.documento_fuente(id),
    texto_version INT NOT NULL, variables JSONB NOT NULL DEFAULT '{}',   -- caso, región, fecha, tipo de actor
    PRIMARY KEY (corpus_id, fuente_id)
);
CREATE TABLE lex.corrida (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), corpus_id UUID NOT NULL REFERENCES lex.corpus(id),
    metodo VARCHAR(15) NOT NULL CHECK (metodo IN ('frecuencias','coocurrencia','chd_reinert','diccionario','especificidades')),
    software VARCHAR(60), version VARCHAR(30), parametros JSONB NOT NULL DEFAULT '{}', semilla BIGINT,
    origen VARCHAR(10) NOT NULL CHECK (origen IN ('interno','importado')), archivo_hash CHAR(64),
    plan_paso_id UUID REFERENCES analisis.plan_paso(id),
    estado VARCHAR(12) NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','completa','fallida','descartada')),
    metricas JSONB NOT NULL DEFAULT '{}',    -- % de UCE clasificadas, número de clases, estabilidad
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (origen = 'interno' OR archivo_hash IS NOT NULL)
);
CREATE UNIQUE INDEX ux_corrida_importada ON lex.corrida (corpus_id, metodo, archivo_hash) WHERE origen = 'importado';
CREATE TABLE lex.uce (                    -- unidad de contexto elemental: por desplazamientos, sin copiar texto
    corrida_id UUID NOT NULL REFERENCES lex.corrida(id) ON DELETE CASCADE, n INT NOT NULL,
    fuente_id UUID NOT NULL REFERENCES kag.documento_fuente(id), inicio_char INT NOT NULL, fin_char INT NOT NULL,
    retenida BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY (corrida_id, n), CHECK (fin_char > inicio_char)
);
CREATE TABLE lex.termino (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, lema VARCHAR(120) NOT NULL, categoria VARCHAR(30) NOT NULL DEFAULT '',
    idioma VARCHAR(10) NOT NULL DEFAULT 'spa', UNIQUE (lema, categoria, idioma)
);
CREATE TABLE lex.clase (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), corrida_id UUID NOT NULL REFERENCES lex.corrida(id) ON DELETE CASCADE,
    num SMALLINT NOT NULL, pct_uce NUMERIC(5,2) CHECK (pct_uce BETWEEN 0 AND 100), descripcion_analista TEXT, UNIQUE (corrida_id, num)
);
CREATE TABLE lex.clase_termino (
    clase_id UUID NOT NULL REFERENCES lex.clase(id) ON DELETE CASCADE, termino_id BIGINT NOT NULL REFERENCES lex.termino(id),
    chi2 NUMERIC, frec_clase INT, frec_total INT, p_valor NUMERIC, PRIMARY KEY (clase_id, termino_id)
);
CREATE TABLE lex.coocurrencia (           -- dispersa: solo pares observados
    corrida_id UUID NOT NULL REFERENCES lex.corrida(id) ON DELETE CASCADE,
    termino_a BIGINT NOT NULL REFERENCES lex.termino(id), termino_b BIGINT NOT NULL REFERENCES lex.termino(id),
    valor NUMERIC NOT NULL, medida VARCHAR(20) NOT NULL, PRIMARY KEY (corrida_id, termino_a, termino_b), CHECK (termino_a < termino_b)
);
CREATE TABLE lex.diccionario (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nombre VARCHAR(160) NOT NULL UNIQUE, descripcion TEXT,
    version INT NOT NULL DEFAULT 1, autor UUID REFERENCES core.usuarios(id)
);
CREATE TABLE lex.diccionario_entrada (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), diccionario_id UUID NOT NULL REFERENCES lex.diccionario(id) ON DELETE CASCADE,
    patron VARCHAR(200) NOT NULL, tipo VARCHAR(5) NOT NULL CHECK (tipo IN ('lema','regex')), categoria VARCHAR(60)
);
CREATE TABLE lex.serie (                  -- desplazamientos frente a una línea base de ventana configurable
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), diccionario_id UUID REFERENCES lex.diccionario(id),
    termino_id BIGINT REFERENCES lex.termino(id), periodo DATE NOT NULL, ambito VARCHAR(60) NOT NULL,
    frecuencia_normalizada NUMERIC NOT NULL, ventana_base_dias INT NOT NULL DEFAULT 90,
    CHECK ((diccionario_id IS NULL) <> (termino_id IS NULL))
);

-- @@20.25
-- Catálogos del grafo (los CHECK de 20.11 pasan a catálogos: principio 3.1(4))
CREATE TABLE kag.cat_tipos_nodo (
    codigo VARCHAR(20) PRIMARY KEY, nombre VARCHAR(60) NOT NULL
);
INSERT INTO kag.cat_tipos_nodo VALUES
 ('actor','Actor'),('caso','Caso'),('objetivo','Objetivo'),('demanda','Demanda'),('solucion','Solución'),('lugar','Lugar'),
 ('concepto','Concepto (capa cualitativa y léxica)'),('hipotesis','Hipótesis'),('comunidad','Comunidad del grafo'),('documento','Documento fuente');
ALTER TABLE kag.nodos DROP CONSTRAINT nodos_tipo_check;
ALTER TABLE kag.nodos ADD CONSTRAINT nodos_tipo_fk FOREIGN KEY (tipo) REFERENCES kag.cat_tipos_nodo(codigo);

CREATE TABLE kag.cat_clases_arista (
    codigo VARCHAR(20) PRIMARY KEY, nombre VARCHAR(60) NOT NULL
);
INSERT INTO kag.cat_clases_arista VALUES
 ('relacion','Relación'),('influencia','Influencia'),('posicion','Posición'),('participacion','Participación'),('causal','Causal'),('discurso','Discurso');
ALTER TABLE kag.cat_tipos_arista DROP CONSTRAINT cat_tipos_arista_clase_check;
ALTER TABLE kag.cat_tipos_arista ADD CONSTRAINT cat_tipos_arista_clase_fk FOREIGN KEY (clase) REFERENCES kag.cat_clases_arista(codigo);
INSERT INTO kag.cat_tipos_arista (id, codigo, clase, dirigida, origen_tipo, destino_tipo) VALUES
 (11,'EVOCA','discurso',true,'actor','concepto'),
 (12,'CODIFICADO_COMO','discurso',true,'documento','concepto'),
 (13,'CO_OCURRE_CON','discurso',false,'concepto','concepto');

CREATE TABLE kag.contraste (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id),
    afirmacion_a TEXT NOT NULL, fragmento_a_id UUID REFERENCES kag.documento_fragmento(id),
    escala_a VARCHAR(12) NOT NULL CHECK (escala_a IN ('campo','dato_oficial','medios','redes','actor')),
    afirmacion_b TEXT, fragmento_b_id UUID REFERENCES kag.documento_fragmento(id),
    escala_b VARCHAR(12) CHECK (escala_b IN ('campo','dato_oficial','medios','redes','actor')),
    tipo VARCHAR(15) NOT NULL CHECK (tipo IN ('coincidencia','contradiccion','vacio','diferencia')),
    estado VARCHAR(15) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','explicada','sin_explicacion')),
    explicacion TEXT, propuesto_por VARCHAR(10) NOT NULL DEFAULT 'A2' CHECK (propuesto_por IN ('A2','persona')),
    calificado_por UUID REFERENCES core.usuarios(id),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_to TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_at TIMESTAMPTZ, supersedes_id UUID REFERENCES kag.contraste(id),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    CHECK (estado <> 'explicada' OR explicacion IS NOT NULL)
);
CREATE TABLE kag.saturacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id), iteracion INT NOT NULL,
    nuevas_afirmaciones INT NOT NULL CHECK (nuevas_afirmaciones >= 0), cambia_comprension BOOLEAN NOT NULL,
    decidido_por UUID REFERENCES core.usuarios(id), fecha DATE NOT NULL DEFAULT CURRENT_DATE, UNIQUE (caso_id, iteracion)
);
CREATE TABLE kag.validacion_hallazgo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id),
    hallazgo_ref VARCHAR(80) NOT NULL, nivel_confianza VARCHAR(5) NOT NULL CHECK (nivel_confianza IN ('baja','media','alta')),
    justificacion TEXT NOT NULL, decidido_por UUID REFERENCES core.usuarios(id), fecha DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE kag.anomalia_contextual (    -- insumo de la coherencia contextual del marco situacional
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), caso_id UUID NOT NULL REFERENCES core.casos(id),
    descripcion TEXT NOT NULL, origen VARCHAR(30), estado VARCHAR(10) NOT NULL DEFAULT 'marcada' CHECK (estado IN ('marcada','explicada')),
    explicacion TEXT, fecha DATE NOT NULL DEFAULT CURRENT_DATE, CHECK (estado <> 'explicada' OR explicacion IS NOT NULL)
);
CREATE VIEW analytics.vw_marco_situacional_robustez AS
SELECT c.id AS caso_id,
  NOT EXISTS (SELECT 1 FROM kag.contraste k WHERE k.caso_id = c.id AND k.superseded_at IS NULL AND k.estado = 'sin_explicacion') AS consistencia,
  EXISTS     (SELECT 1 FROM kag.contraste k WHERE k.caso_id = c.id AND k.superseded_at IS NULL
                 AND (k.escala_a = 'dato_oficial' OR k.escala_b = 'dato_oficial')) AS correspondencia,
  NOT EXISTS (SELECT 1 FROM kag.anomalia_contextual a WHERE a.caso_id = c.id AND a.estado = 'marcada') AS coherencia_contextual,
  COALESCE((SELECT NOT s.cambia_comprension FROM kag.saturacion s WHERE s.caso_id = c.id ORDER BY s.iteracion DESC LIMIT 1), FALSE) AS saturacion,
  NOT EXISTS (SELECT 1 FROM kag.contraste k WHERE k.caso_id = c.id AND k.superseded_at IS NULL
                 AND (k.fragmento_a_id IS NULL OR (k.fragmento_b_id IS NULL AND k.tipo <> 'vacio'))) AS trazabilidad
FROM core.casos c;

-- @@20.26
CREATE TABLE kag.cat_corpus (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE, nombre VARCHAR(80) NOT NULL
);
INSERT INTO kag.cat_corpus VALUES (1,'campo','Campo'),(2,'normativa','Normativa'),(3,'literatura','Literatura'),
 (4,'metodologia','Metodología'),(5,'medios','Medios'),(6,'dato_oficial','Dato oficial');
ALTER TABLE kag.documento_fuente ADD COLUMN corpus_id SMALLINT REFERENCES kag.cat_corpus(id);

CREATE TABLE ctx.herramienta (
    id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, codigo VARCHAR(40) NOT NULL UNIQUE,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('api','descarga','web','rss','busqueda_cientifica')),
    dominios_permitidos TEXT[] NOT NULL CHECK (cardinality(dominios_permitidos) > 0),   -- lista blanca
    limite_tasa_hora INT NOT NULL DEFAULT 60, requiere_aprobacion BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE ctx.trabajo_recoleccion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), variable_id SMALLINT REFERENCES ctx.cat_variables(id),
    indicador_id UUID REFERENCES ind.indicador(id), herramienta_id SMALLINT NOT NULL REFERENCES ctx.herramienta(id),
    estado VARCHAR(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','pausado','error')),
    ultima_ejecucion TIMESTAMPTZ, error TEXT, CHECK (variable_id IS NOT NULL OR indicador_id IS NOT NULL)
);
CREATE TABLE ctx.captura (                -- evidencia inmutable de cada página capturada
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), trabajo_id UUID NOT NULL REFERENCES ctx.trabajo_recoleccion(id),
    url VARCHAR(2000) NOT NULL, obtenido_en TIMESTAMPTZ NOT NULL DEFAULT now(), hash CHAR(64) NOT NULL,
    uri_archivo VARCHAR(500) NOT NULL, tipo_contenido VARCHAR(80), corpus_id SMALLINT REFERENCES kag.cat_corpus(id),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 1 REFERENCES core.cat_clasificacion(nivel)
);
CREATE FUNCTION ctx.captura_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_host TEXT; v_ok BOOLEAN;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN RAISE EXCEPTION 'ctx.captura es inmutable'; END IF;
  v_host := lower(substring(NEW.url from '^[a-z]+://([^/:?#]+)'));
  SELECT EXISTS (SELECT 1 FROM ctx.trabajo_recoleccion t JOIN ctx.herramienta h ON h.id = t.herramienta_id,
                        unnest(h.dominios_permitidos) d
                  WHERE t.id = NEW.trabajo_id AND (v_host = lower(d) OR v_host LIKE '%.' || lower(d))) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'dominio % fuera de la lista blanca de la herramienta', v_host; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_captura_guard BEFORE INSERT OR UPDATE OR DELETE ON ctx.captura FOR EACH ROW EXECUTE FUNCTION ctx.captura_guard();

CREATE TABLE kag.hipotesis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), enunciado TEXT NOT NULL, caso_id UUID REFERENCES core.casos(id),
    origen VARCHAR(10) NOT NULL CHECK (origen IN ('A2','persona','modelo')),
    estado VARCHAR(12) NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta','en_contraste','sostenida','refutada','archivada')),
    nivel_confianza VARCHAR(5) CHECK (nivel_confianza IN ('baja','media','alta')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by UUID REFERENCES core.usuarios(id),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE TABLE kag.hipotesis_evidencia (
    hipotesis_id UUID NOT NULL REFERENCES kag.hipotesis(id) ON DELETE CASCADE,
    fragmento_id UUID NOT NULL REFERENCES kag.documento_fragmento(id),
    sentido VARCHAR(10) NOT NULL CHECK (sentido IN ('a_favor','en_contra')), PRIMARY KEY (hipotesis_id, fragmento_id)
);
CREATE TABLE kag.vacio_informacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), descripcion TEXT NOT NULL, indicador_id UUID REFERENCES ind.indicador(id),
    brecha_id UUID REFERENCES ind.brecha(id), razon TEXT, propuesta TEXT,
    estado VARCHAR(12) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','en_brecha','cerrado','descartado'))
);
CREATE TABLE kag.hipotesis_en_salida (    -- una hipótesis citada en una salida lleva siempre su rótulo y su estado
    output_id UUID NOT NULL REFERENCES core.output_contracts(id), hipotesis_id UUID NOT NULL REFERENCES kag.hipotesis(id),
    rotulo VARCHAR(30) NOT NULL DEFAULT 'HIPÓTESIS' CHECK (rotulo = 'HIPÓTESIS'), PRIMARY KEY (output_id, hipotesis_id)
);
CREATE FUNCTION kag.chk_hipotesis_en_salida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM kag.hipotesis_evidencia WHERE hipotesis_id = NEW.hipotesis_id) THEN
    RAISE EXCEPTION 'la hipótesis % no tiene evidencia enlazada y no puede citarse en una salida', NEW.hipotesis_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hipotesis_salida BEFORE INSERT ON kag.hipotesis_en_salida FOR EACH ROW EXECUTE FUNCTION kag.chk_hipotesis_en_salida();

-- Comunidades del grafo (trabajo por lotes; una corrida por nivel de clasificación)
CREATE TABLE kag.comunidad_corrida (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), valido_en TIMESTAMPTZ NOT NULL, conocido_en TIMESTAMPTZ NOT NULL,
    nivel_max SMALLINT NOT NULL, algoritmo VARCHAR(20) NOT NULL DEFAULT 'leiden', resolucion NUMERIC NOT NULL, semilla BIGINT NOT NULL,
    n_aristas INT NOT NULL, nivel_clasificacion SMALLINT NOT NULL REFERENCES core.cat_clasificacion(nivel),   -- L: subgrafo de nivel <= L
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE kag.comunidad (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), corrida_id UUID NOT NULL REFERENCES kag.comunidad_corrida(id) ON DELETE CASCADE,
    num INT NOT NULL, nivel_jerarquico SMALLINT NOT NULL DEFAULT 0, padre_id UUID REFERENCES kag.comunidad(id),
    nivel_clasificacion SMALLINT NOT NULL REFERENCES core.cat_clasificacion(nivel), UNIQUE (corrida_id, num, nivel_jerarquico)
);
CREATE TABLE kag.comunidad_miembro (
    comunidad_id UUID NOT NULL REFERENCES kag.comunidad(id) ON DELETE CASCADE, nodo_id UUID NOT NULL REFERENCES kag.nodos(id),
    nivel_clasificacion SMALLINT NOT NULL REFERENCES core.cat_clasificacion(nivel), PRIMARY KEY (comunidad_id, nodo_id)
);
CREATE TABLE kag.comunidad_resumen (
    comunidad_id UUID PRIMARY KEY REFERENCES kag.comunidad(id) ON DELETE CASCADE, texto TEXT NOT NULL,
    modelo VARCHAR(80) NOT NULL, version_modelo VARCHAR(40) NOT NULL, es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL REFERENCES core.cat_clasificacion(nivel)
);
CREATE FUNCTION kag.hereda_nivel_corrida() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_nivel SMALLINT;
BEGIN
  IF TG_TABLE_NAME = 'comunidad' THEN
    SELECT nivel_clasificacion INTO v_nivel FROM kag.comunidad_corrida WHERE id = NEW.corrida_id;
  ELSE
    SELECT c.nivel_clasificacion INTO v_nivel FROM kag.comunidad c WHERE c.id = NEW.comunidad_id;
  END IF;
  NEW.nivel_clasificacion := GREATEST(NEW.nivel_clasificacion, COALESCE(v_nivel, 1));   -- el resumen hereda L
  RETURN NEW;
END $$;
CREATE TRIGGER trg_hereda BEFORE INSERT ON kag.comunidad FOR EACH ROW EXECUTE FUNCTION kag.hereda_nivel_corrida();
CREATE TRIGGER trg_hereda BEFORE INSERT ON kag.comunidad_miembro FOR EACH ROW EXECUTE FUNCTION kag.hereda_nivel_corrida();
CREATE TRIGGER trg_hereda BEFORE INSERT ON kag.comunidad_resumen FOR EACH ROW EXECUTE FUNCTION kag.hereda_nivel_corrida();

-- Métricas de nodo calculadas por lote (centralidad de intermediación, etc.)
CREATE TABLE kag.metrica_nodo (
    nodo_id UUID NOT NULL REFERENCES kag.nodos(id), periodo DATE NOT NULL, metrica VARCHAR(30) NOT NULL,
    valor NUMERIC NOT NULL, es_critico BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY (nodo_id, periodo, metrica)
);

-- @@20.27
CREATE TABLE core.permiso_aprobacion (    -- las aprobaciones no se dan por rol sino por permiso con vigencia
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id UUID NOT NULL REFERENCES core.usuarios(id),
    objeto VARCHAR(60) NOT NULL, vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE, vigente_hasta DATE,
    otorgado_por UUID REFERENCES core.usuarios(id), CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
INSERT INTO core.roles VALUES (8,'analista_cualitativo',3),(9,'curador_politica',2);

CREATE TABLE agent.modelo_registro (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), modelo VARCHAR(80) NOT NULL, version VARCHAR(40) NOT NULL, hash_pesos CHAR(64),
    alta DATE NOT NULL DEFAULT CURRENT_DATE, destinos_permitidos JSONB NOT NULL,   -- p. ej. {"1":["local","nube"],"2":["local"],"3":["local"]}
    estado VARCHAR(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','retirado')), UNIQUE (modelo, version)
);
CREATE TABLE agent.llm_call (
    id UUID NOT NULL DEFAULT gen_random_uuid(), run_id UUID, ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    modelo VARCHAR(80) NOT NULL, version_modelo VARCHAR(40) NOT NULL, destino VARCHAR(5) NOT NULL CHECK (destino IN ('local','nube')),
    temperatura NUMERIC(3,2), prompt_hash CHAR(64) NOT NULL, version_plantilla_prompt VARCHAR(40),
    policy_snapshot_id UUID REFERENCES policy.snapshot(id), tokens_in INT, tokens_out INT, latencia_ms INT,
    veredicto_guardrails JSONB, nivel_clasificacion SMALLINT NOT NULL REFERENCES core.cat_clasificacion(nivel),
    PRIMARY KEY (id, ts),
    -- R-LLM: el contenido Confidencial nunca sale a la nube
    CHECK (nivel_clasificacion < 3 OR destino = 'local')
) PARTITION BY RANGE (ts);
SELECT core.crear_particion('agent','llm_call', d::date, (d + interval '1 month')::date)
  FROM generate_series('2026-11-01'::date, '2027-03-01'::date, interval '1 month') d;
CREATE TABLE agent.llm_call_default PARTITION OF agent.llm_call DEFAULT;
CREATE TABLE agent.llm_call_fragmento (
    call_id UUID NOT NULL, call_ts TIMESTAMPTZ NOT NULL, fragmento_id UUID NOT NULL REFERENCES kag.documento_fragmento(id),
    rank_rrf INT, score_rrf NUMERIC, score_rerank NUMERIC, PRIMARY KEY (call_id, call_ts, fragmento_id),
    FOREIGN KEY (call_id, call_ts) REFERENCES agent.llm_call(id, ts)
);
CREATE TABLE agent.sesion (               -- estado de la sesión conversacional del Generador de Pautas (A2)
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), usuario_id UUID NOT NULL REFERENCES core.usuarios(id),
    plan_id UUID REFERENCES analisis.plan(id), estado VARCHAR(10) NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE TABLE agent.sesion_paso (
    sesion_id UUID NOT NULL REFERENCES agent.sesion(id) ON DELETE CASCADE, n INT NOT NULL,
    tipo VARCHAR(25) NOT NULL CHECK (tipo IN ('pregunta_dato_faltante','pauta','reapertura','explicacion_divergencia','respuesta_usuario')),
    contenido JSONB NOT NULL, ts TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (sesion_id, n)
);
CREATE TABLE agent.cat_detalle_schema (   -- JSON Schema versionado del campo run_log.detalle (lo valida la aplicación)
    version SMALLINT PRIMARY KEY, agente VARCHAR(40), esquema_json JSONB NOT NULL, vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE
);
ALTER TABLE agent.run_log ADD COLUMN detalle_schema_version SMALLINT;

-- @@20.28
CREATE VIEW analytics.vw_carga_campo AS
SELECT m.mes,
       COALESCE((SELECT sum(c.horas_disponibles) FROM core.capacidad_campo c WHERE c.mes = m.mes), 0) AS horas_capacidad,
       COALESCE(sum(b.horas_estimadas) FILTER (WHERE b.estado IN ('aprobada','en_campo') AND b.requiere_campo), 0) AS horas_aprobadas
  FROM (SELECT mes_previsto AS mes FROM ind.brecha WHERE mes_previsto IS NOT NULL
        UNION SELECT mes FROM core.capacidad_campo) m
  LEFT JOIN ind.brecha b ON b.mes_previsto = m.mes
 GROUP BY m.mes;
CREATE VIEW analytics.vw_selecciones_vigentes AS
SELECT s.id AS seleccion_id, p.codigo AS plantilla, sl.codigo AS slot, i.codigo AS indicador, s.caso_id, s.distrito_id, s.periodo,
       v.id AS variante_id, v.clase, v.es_validado_humano, pj.incertidumbre, s.seleccionada_por, s.valid_from
  FROM ind.seleccion s JOIN ind.plantilla_slot sl ON sl.id = s.slot_id JOIN ind.plantilla p ON p.id = sl.plantilla_id
  JOIN ind.variante v ON v.id = s.variante_id JOIN ind.indicador i ON i.id = v.indicador_id
  LEFT JOIN ind.proxy_justificacion pj ON pj.variante_id = v.id
 WHERE s.superseded_at IS NULL AND (s.valid_to IS NULL OR s.valid_to > now());
-- G14: en la Minister View un proxy entra solo si está validado por una persona y su incertidumbre no es alta
CREATE VIEW analytics.vw_indicadores_minister AS
SELECT sv.*, r.valor, r.incertidumbre AS incertidumbre_resultado
  FROM analytics.vw_selecciones_vigentes sv
  LEFT JOIN ind.resultado r ON r.variante_id = sv.variante_id AND r.periodo = sv.periodo
 WHERE sv.clase <> 'proxy' OR (sv.es_validado_humano AND sv.incertidumbre <> 'alta');
CREATE VIEW lex.vw_clases_publicables AS     -- no se muestra una clase sin métricas de estabilidad
SELECT cl.*, c.metricas->>'estabilidad' AS estabilidad
  FROM lex.clase cl JOIN lex.corrida c ON c.id = cl.corrida_id
 WHERE c.estado = 'completa' AND c.metricas ? 'estabilidad';

CREATE MATERIALIZED VIEW analytics.mv_tablero_decisional AS
WITH casos_v AS (
  SELECT c.id, g.region_id, g.region, nr.codigo AS riesgo
    FROM core.casos c JOIN analytics.vw_geo_distrito g ON g.distrito_id = c.distrito_principal_id
    JOIN core.cat_niveles_riesgo nr ON nr.id = c.nivel_riesgo_id
    JOIN core.cat_estados_caso e ON e.id = c.estado_id AND e.es_activo
   WHERE c.es_validado_humano),
alertas_v AS (
  SELECT cv.region_id, count(*) AS n FROM core.alertas_tempranas a JOIN casos_v cv ON cv.id = a.caso_id
   WHERE a.es_validado_humano GROUP BY cv.region_id),
aristas_v AS (
  SELECT cv.region_id, count(*) AS total, count(*) FILTER (WHERE ar.es_validado_humano) AS validadas
    FROM kag.aristas ar JOIN casos_v cv ON cv.id = ar.caso_id
   WHERE ar.superseded_at IS NULL AND ar.valid_to IS NULL GROUP BY cv.region_id)
SELECT cv.region_id, cv.region, count(*) AS casos_validados,
       count(*) FILTER (WHERE cv.riesgo = 'Alto') AS riesgo_alto,
       COALESCE(max(al.n), 0) AS alertas_activas,
       count(*) FILTER (WHERE rb.consistencia AND rb.correspondencia AND rb.coherencia_contextual AND rb.saturacion AND rb.trazabilidad) AS casos_marco_robusto,
       count(*) FILTER (WHERE NOT (rb.consistencia AND rb.correspondencia AND rb.coherencia_contextual AND rb.saturacion AND rb.trazabilidad)) AS casos_marco_provisional,
       COALESCE(max(ar.validadas)::numeric / NULLIF(max(ar.total), 0), 0) AS proporcion_aristas_validadas
  FROM casos_v cv JOIN analytics.vw_marco_situacional_robustez rb ON rb.caso_id = cv.id
  LEFT JOIN alertas_v al ON al.region_id = cv.region_id LEFT JOIN aristas_v ar ON ar.region_id = cv.region_id
 GROUP BY cv.region_id, cv.region;
CREATE UNIQUE INDEX ux_mv_tablero ON analytics.mv_tablero_decisional (region_id);

CREATE MATERIALIZED VIEW analytics.mv_drift_embeddings AS
SELECT mes, modelo, version_modelo, n, centroide <=> lag(centroide) OVER (PARTITION BY modelo ORDER BY mes) AS distancia_coseno_mes_previo
  FROM (SELECT date_trunc('month', created_at)::date AS mes, modelo, version_modelo, count(*) AS n, avg(embedding) AS centroide
          FROM kag.embedding GROUP BY 1, 2, 3) x;
CREATE UNIQUE INDEX ux_mv_drift_emb ON analytics.mv_drift_embeddings (mes, modelo, version_modelo);
CREATE MATERIALIZED VIEW analytics.mv_drift_grafo AS
SELECT nodo_id, periodo, valor, valor - lag(valor) OVER (PARTITION BY nodo_id ORDER BY periodo) AS cambio_vs_periodo_previo
  FROM kag.metrica_nodo WHERE metrica = 'intermediacion' AND es_critico;
CREATE UNIQUE INDEX ux_mv_drift_grafo ON analytics.mv_drift_grafo (nodo_id, periodo);

-- RLS por nivel de clasificación en las tablas nuevas (misma política que 20.16)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['policy.regla','analisis.plan','staging.lote','qda.proyecto','qda.segmento','qda.memo','qda.mapeo_pseudonimo',
      'lex.corpus','lex.corrida','kag.contraste','kag.hipotesis','kag.comunidad_corrida','kag.comunidad','kag.comunidad_miembro',
      'kag.comunidad_resumen','agent.llm_call','agent.sesion','ctx.captura'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_clasificacion ON %s FOR SELECT USING (nivel_clasificacion <= core.clasificacion_max())', t);
    EXECUTE format('CREATE POLICY p_insert ON %s FOR INSERT WITH CHECK (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max())', t);
    EXECUTE format('CREATE POLICY p_update ON %s FOR UPDATE USING (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max()) WITH CHECK (nivel_clasificacion <= core.clasificacion_max())', t);
    EXECUTE format('CREATE POLICY p_delete ON %s FOR DELETE USING (core.clasificacion_max() >= 3 AND nivel_clasificacion <= core.clasificacion_max())', t);
  END LOOP;
END $$;

-- Índices de claves foráneas de los objetos nuevos (excluye created_by/updated_by); se crean solo si no existe uno con esa columna inicial
DO $$ DECLARE r record; cols text; idx text; BEGIN
  FOR r IN SELECT c.conrelid, c.conkey, c.conrelid::regclass::text AS tabla, cl.relname
             FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
            WHERE c.contype = 'f' AND cl.relkind IN ('r','p')
              AND n.nspname IN ('policy','ind','analisis','staging','qda','lex')
               OR (c.contype = 'f' AND c.conrelid::regclass::text IN ('kag.contraste','kag.saturacion','kag.validacion_hallazgo','kag.anomalia_contextual',
                   'kag.hipotesis','kag.hipotesis_evidencia','kag.vacio_informacion','kag.hipotesis_en_salida','kag.comunidad','kag.comunidad_miembro',
                   'kag.metrica_nodo','ctx.trabajo_recoleccion','ctx.captura','agent.llm_call','agent.llm_call_fragmento','agent.sesion','agent.sesion_paso',
                   'core.capacidad_campo','core.permiso_aprobacion','core.output_contracts')) LOOP
    SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO cols
      FROM unnest(r.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = r.conrelid AND a.attnum = k.attnum;
    CONTINUE WHEN cols IN ('created_by','updated_by');
    CONTINUE WHEN EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = r.conrelid AND i.indkey[0] = r.conkey[1]);
    idx := left('ix_' || r.relname || '_' || replace(cols, ',', '_'), 63);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', idx, r.tabla, cols);
  END LOOP;
END $$;


-- =====================================================================
-- CAPA v8.4 -- domain.*, model.*, config.* (pivote generico de dominio)
-- =====================================================================

-- =====================================================================
-- v8.4 — Capa de dominio genérico (domain.*, model.*, config.*)
-- Pivote: reemplaza tablas fijas por dominio (mype.*, pesca.*, etc.)
-- por un artefacto único + registro de tipos + registro de reglas.
-- Requiere: PostgreSQL >= 15, extensión pgcrypto. Se añade sobre el
-- núcleo v8.2 (core.*, kag.*, territorio.*, ctx.*, agent.*, avisa.*).
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS domain;
CREATE SCHEMA IF NOT EXISTS model;
CREATE SCHEMA IF NOT EXISTS config;

-- ---------- 1. config.* : parámetros, librerías, aplicaciones ----------
CREATE TABLE config.libreria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(60) NOT NULL, nombre VARCHAR(120) NOT NULL, version VARCHAR(30) NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('embedding','nlp','ml','stats','transcripcion','reranker','orquestacion','otro')),
    licencia VARCHAR(40), hardware_requerido VARCHAR(10) CHECK (hardware_requerido IN ('cpu','gpu','nube')),
    dependencias JSONB NOT NULL DEFAULT '[]', parametros_default JSONB NOT NULL DEFAULT '{}',
    estado VARCHAR(10) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','retirada')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (codigo, version)
);
CREATE INDEX ix_libreria_activa ON config.libreria(codigo) WHERE estado = 'activa';

CREATE TABLE model.model_card (            -- genérico: reemplaza forecast.model_registry + forecast.model_card
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(60) NOT NULL, version VARCHAR(20) NOT NULL DEFAULT '1.0',
    tipo_modelo VARCHAR(20) NOT NULL CHECK (tipo_modelo IN
        ('clasificacion','regresion','serie_tiempo','did','glmm','regla','score_aditivo','llm','otro')),
    libreria_id UUID REFERENCES config.libreria(id),             -- NULLable hasta activar (ver trigger de activación)
    aplicacion_id UUID,                                          -- FK diferida a config.aplicacion (ciclo: ver §3)
    proposito TEXT NOT NULL,
    datos_entrenamiento_hash CHAR(64),
    variables_entrada JSONB NOT NULL DEFAULT '[]',
    variables_salida JSONB NOT NULL DEFAULT '[]',
    parametros JSONB NOT NULL DEFAULT '{}',
    metricas JSONB,
    limitaciones TEXT, incertidumbre VARCHAR(30),
    estado VARCHAR(12) NOT NULL DEFAULT 'propuesto' CHECK (estado IN ('propuesto','activo','en_revision','retirado')),
    reviewer VARCHAR(120), proximo_review DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (codigo, version)
);
CREATE UNIQUE INDEX ux_model_card_activo ON model.model_card(codigo) WHERE estado = 'activo';

CREATE TABLE config.aplicacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(60) NOT NULL UNIQUE, nombre VARCHAR(120) NOT NULL,
    tipo VARCHAR(12) NOT NULL CHECK (tipo IN ('agente','servicio','modulo','worker','cron')),
    modelo_card_id UUID REFERENCES model.model_card(id),
    libreria_ids UUID[] NOT NULL DEFAULT '{}',
    config JSONB NOT NULL DEFAULT '{}',
    estado VARCHAR(12) NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta','activa','en_revision','retirada')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- requisito 5.4: agente requiere modelo_card_id; servicio requiere >=1 librería
    CHECK (estado <> 'activa' OR tipo <> 'agente' OR modelo_card_id IS NOT NULL),
    CHECK (estado <> 'activa' OR tipo NOT IN ('servicio','worker') OR cardinality(libreria_ids) >= 1)
);
ALTER TABLE model.model_card ADD CONSTRAINT fk_model_card_aplicacion
    FOREIGN KEY (aplicacion_id) REFERENCES config.aplicacion(id) DEFERRABLE INITIALLY DEFERRED;

-- requisito 5.1/5.3: modelo activo exige librería Y aplicación
ALTER TABLE model.model_card ADD CONSTRAINT chk_model_card_activo_completo
    CHECK (estado <> 'activo' OR (libreria_id IS NOT NULL));  -- aplicacion_id validado por trigger (differed FK no basta para NOT NULL condicional)

CREATE FUNCTION model.chk_activo_requiere_aplicacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'activo' AND NEW.aplicacion_id IS NULL THEN
    RAISE EXCEPTION 'model.model_card %: no puede estar activo sin aplicacion_id (5.1)', NEW.codigo;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER trg_model_card_activo AFTER INSERT OR UPDATE ON model.model_card
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION model.chk_activo_requiere_aplicacion();

CREATE TABLE config.parametro (           -- bitemporal: nueva fila con supersedes_id, nunca UPDATE destructivo
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(80) NOT NULL,          -- 'IECP.umbral_rojo', 'G16.hhi_max', 'BCA_ECA.od_min'
    valor JSONB NOT NULL, tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('numero','texto','booleano','json','fecha')),
    unidad VARCHAR(30), descripcion TEXT,
    fuente_normativa_id UUID REFERENCES policy.regla(id),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_to TIMESTAMPTZ,
    supersedes_id UUID REFERENCES config.parametro(id),
    aprobado_por UUID REFERENCES core.usuarios(id), aprobado_en TIMESTAMPTZ,
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX ux_parametro_vigente ON config.parametro(codigo) WHERE valid_to IS NULL;
CREATE INDEX ix_parametro_codigo ON config.parametro(codigo);

CREATE FUNCTION config.parametro_cierra_previo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    UPDATE config.parametro SET valid_to = NEW.valid_from WHERE id = NEW.supersedes_id AND valid_to IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_parametro_cierra BEFORE INSERT ON config.parametro
  FOR EACH ROW EXECUTE FUNCTION config.parametro_cierra_previo();

-- lectura de parámetro vigente: lo que todo guardrail debe usar (5.2)
CREATE FUNCTION config.leer_parametro(p_codigo text, p_en timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT valor FROM config.parametro
   WHERE codigo = p_codigo AND valid_from <= p_en AND (valid_to IS NULL OR valid_to > p_en)
   ORDER BY valid_from DESC LIMIT 1;
$$;

-- ---------- 2. domain.* : artefacto genérico + tipos + reglas ----------
CREATE TABLE domain.cat_estados_artefacto (
    id SMALLINT PRIMARY KEY, codigo VARCHAR(20) NOT NULL UNIQUE, es_terminal BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO domain.cat_estados_artefacto VALUES
 (1,'borrador',FALSE),(2,'pendiente_validacion',FALSE),(3,'validado',FALSE),
 (4,'aprobado',TRUE),(5,'rechazado',TRUE),(6,'cerrado',TRUE);

CREATE TABLE domain.tipo_artefacto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(60) NOT NULL, dominio VARCHAR(30) NOT NULL,   -- 'mype','pesca','hidrico','cites','generico', C7...C100
    version VARCHAR(10) NOT NULL DEFAULT '1.0',
    esquema_json JSONB NOT NULL,                                  -- JSON Schema del payload
    estado VARCHAR(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','deprecado','retirado')),
    requiere_caso BOOLEAN NOT NULL DEFAULT TRUE,
    sujeto_requerido VARCHAR(10) CHECK (sujeto_requerido IN ('actor','lugar','especie','documento','ninguno')),
    model_card_id UUID REFERENCES model.model_card(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (codigo, version)
);
CREATE UNIQUE INDEX ux_tipo_artefacto_activo ON domain.tipo_artefacto(codigo) WHERE estado = 'activo';

CREATE TABLE domain.regla_negocio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_artefacto_id UUID NOT NULL REFERENCES domain.tipo_artefacto(id),
    codigo VARCHAR(60) NOT NULL,
    tipo_regla VARCHAR(12) NOT NULL CHECK (tipo_regla IN ('transicion','invariante','validacion','calculo','alerta')),
    -- transición: estado_desde/estado_hasta; invariante/validación: condicion_sql debe evaluar TRUE para pasar
    estado_desde_id SMALLINT REFERENCES domain.cat_estados_artefacto(id),
    estado_hasta_id SMALLINT REFERENCES domain.cat_estados_artefacto(id),
    condicion_sql TEXT,                 -- expresión booleana sobre NEW.payload / NEW.* (evaluada por el runtime, no por PG directamente)
    mensaje_error TEXT NOT NULL,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    activo BOOLEAN NOT NULL DEFAULT TRUE, version VARCHAR(10) NOT NULL DEFAULT '1.0',
    UNIQUE (tipo_artefacto_id, codigo, version)
);
CREATE INDEX ix_regla_tipo ON domain.regla_negocio(tipo_artefacto_id) WHERE activo;

CREATE TABLE domain.artefacto (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_id UUID NOT NULL REFERENCES domain.tipo_artefacto(id),
    caso_id UUID REFERENCES core.casos(id),
    sujeto_actor_uid UUID REFERENCES core.actores(actor_uid),
    sujeto_lugar_id UUID REFERENCES territorio.lugares(id),
    sujeto_especie_id SMALLINT REFERENCES core.cat_especies(id),
    sujeto_documento_id UUID REFERENCES kag.documento_fuente(id),
    payload JSONB NOT NULL,
    version_esquema VARCHAR(10) NOT NULL DEFAULT '1.0',
    estado_id SMALLINT NOT NULL DEFAULT 1 REFERENCES domain.cat_estados_artefacto(id),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(), valid_to TIMESTAMPTZ,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), superseded_at TIMESTAMPTZ,
    supersedes_id UUID REFERENCES domain.artefacto(id),
    created_by UUID REFERENCES core.usuarios(id), updated_by UUID REFERENCES core.usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen_dato IN ('MANUAL','KAG','WORKFLOW','AVISA_HISTORICO','WHATSAPP','AGENTE','IMPORT')),
    confidence NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX ix_artefacto_tipo ON domain.artefacto(tipo_id) WHERE superseded_at IS NULL;
CREATE INDEX ix_artefacto_caso ON domain.artefacto(caso_id) WHERE caso_id IS NOT NULL;
CREATE INDEX ix_artefacto_sujeto_actor ON domain.artefacto(sujeto_actor_uid) WHERE sujeto_actor_uid IS NOT NULL;
CREATE INDEX ix_artefacto_sujeto_lugar ON domain.artefacto(sujeto_lugar_id) WHERE sujeto_lugar_id IS NOT NULL;
CREATE INDEX ix_artefacto_payload_gin ON domain.artefacto USING GIN (payload);
CREATE INDEX ix_artefacto_vigente ON domain.artefacto(tipo_id, valid_from, valid_to) WHERE superseded_at IS NULL;

-- Trigger 1: valida payload contra esquema_json del tipo (validación estructural mínima en SQL;
-- la validación completa de JSON Schema corre en el Extractor/Resolver Agent antes del INSERT —
-- este trigger es un backstop de campos obligatorios, no un validador de JSON Schema completo).
CREATE FUNCTION domain.validar_artefacto() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tipo domain.tipo_artefacto%ROWTYPE; v_campo text; v_req jsonb;
BEGIN
  SELECT * INTO v_tipo FROM domain.tipo_artefacto WHERE id = NEW.tipo_id;
  IF v_tipo.estado <> 'activo' THEN
    RAISE EXCEPTION 'domain.artefacto: tipo % no está activo', v_tipo.codigo;
  END IF;
  IF v_tipo.requiere_caso AND NEW.caso_id IS NULL THEN
    RAISE EXCEPTION 'domain.artefacto: tipo % requiere caso_id', v_tipo.codigo;
  END IF;
  IF v_tipo.sujeto_requerido = 'actor' AND NEW.sujeto_actor_uid IS NULL THEN
    RAISE EXCEPTION 'domain.artefacto: tipo % requiere sujeto_actor_uid', v_tipo.codigo;
  END IF;
  IF v_tipo.sujeto_requerido = 'lugar' AND NEW.sujeto_lugar_id IS NULL THEN
    RAISE EXCEPTION 'domain.artefacto: tipo % requiere sujeto_lugar_id', v_tipo.codigo;
  END IF;
  v_req := v_tipo.esquema_json -> 'required';
  IF v_req IS NOT NULL THEN
    FOR v_campo IN SELECT jsonb_array_elements_text(v_req) LOOP
      IF NOT (NEW.payload ? v_campo) THEN
        RAISE EXCEPTION 'domain.artefacto: payload no tiene el campo requerido "%" (tipo %)', v_campo, v_tipo.codigo;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validar_artefacto BEFORE INSERT OR UPDATE ON domain.artefacto
  FOR EACH ROW EXECUTE FUNCTION domain.validar_artefacto();

-- Trigger 2: bitemporal — nueva versión cierra la anterior (patrón idéntico a kag.aristas)
CREATE FUNCTION domain.artefacto_supersede() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    UPDATE domain.artefacto SET superseded_at = NEW.recorded_at WHERE id = NEW.supersedes_id AND superseded_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_artefacto_supersede BEFORE INSERT ON domain.artefacto
  FOR EACH ROW EXECUTE FUNCTION domain.artefacto_supersede();

CREATE TRIGGER trg_artefacto_audit BEFORE INSERT OR UPDATE ON domain.artefacto
  FOR EACH ROW EXECUTE FUNCTION core.set_audit();

-- Trigger 3: transición de estado solo si hay una regla 'transicion' que la permita
CREATE FUNCTION domain.chk_transicion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.estado_id IS DISTINCT FROM NEW.estado_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM domain.regla_negocio r
       WHERE r.tipo_artefacto_id = NEW.tipo_id AND r.tipo_regla = 'transicion' AND r.activo
         AND r.estado_desde_id = OLD.estado_id AND r.estado_hasta_id = NEW.estado_id
    ) THEN
      RAISE EXCEPTION 'domain.artefacto: transición % -> % no permitida para el tipo %', OLD.estado_id, NEW.estado_id,
        (SELECT codigo FROM domain.tipo_artefacto WHERE id = NEW.tipo_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_chk_transicion BEFORE UPDATE ON domain.artefacto
  FOR EACH ROW EXECUTE FUNCTION domain.chk_transicion();

-- Recorrido bitemporal: estado de un artefacto "tal como se conocía" en un instante pasado
CREATE FUNCTION domain.artefacto_en(p_id uuid, p_valido_en timestamptz DEFAULT now(), p_conocido_en timestamptz DEFAULT now())
RETURNS domain.artefacto LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cadena AS (
    SELECT * FROM domain.artefacto WHERE id = p_id
    UNION ALL
    SELECT a.* FROM domain.artefacto a JOIN cadena c ON a.id = c.supersedes_id
  )
  SELECT * FROM cadena
   WHERE valid_from <= p_valido_en AND (valid_to IS NULL OR valid_to > p_valido_en)
     AND recorded_at <= p_conocido_en AND (superseded_at IS NULL OR superseded_at > p_conocido_en)
   ORDER BY recorded_at DESC LIMIT 1;
$$;

-- RLS: clasificación + sujeto (requisito 7.1)
ALTER TABLE domain.artefacto ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain.artefacto FORCE ROW LEVEL SECURITY;
CREATE POLICY p_clasificacion ON domain.artefacto FOR SELECT
  USING (nivel_clasificacion <= core.clasificacion_max());
-- app.staff_bypass_subject_rls (booleano, lo fija la app SOLO para roles no acotados a un actor:
-- sectorista, administrador, consulta_lectura, alta_direccion, auditor, servicio_agente).
-- No se deriva de clasificacion_max: un rol acotado a un actor (mype, exportador_cites) nunca
-- debe ver artefactos de otro actor, sin importar su nivel de clasificación (bug detectado en pruebas:
-- la primera versión usaba "clasificacion_max() >= 3" como bypass, lo que habría dejado a un
-- hipotético usuario MYPE con autorización Confidencial ver los artefactos de otras MYPE).
CREATE FUNCTION core.staff_bypass_subject_rls() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.staff_bypass_subject_rls', true), '')::boolean, FALSE)
$$;
-- RESTRICTIVE, no PERMISSIVE: varias políticas PERMISSIVE para el mismo comando se combinan con OR
-- en PostgreSQL (bug detectado en pruebas: con dos PERMISSIVE, un nivel de clasificación alto
-- bastaba para ver artefactos de cualquier sujeto). RESTRICTIVE siempre se exige con AND sobre
-- el resultado de las políticas PERMISSIVE, logrando "clasificación Y sujeto", no "clasificación O sujeto".
CREATE POLICY p_sujeto_actor ON domain.artefacto AS RESTRICTIVE FOR SELECT
  USING (sujeto_actor_uid IS NULL OR core.staff_bypass_subject_rls()
         OR sujeto_actor_uid = NULLIF(current_setting('app.actor_uid', true), '')::uuid);
CREATE POLICY p_insert ON domain.artefacto FOR INSERT
  WITH CHECK (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max());
CREATE POLICY p_update ON domain.artefacto FOR UPDATE
  USING (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max())
  WITH CHECK (nivel_clasificacion <= core.clasificacion_max());
-- Revisión quirúrgica de las 8 excepciones de v9 (evaluación de las tablas fijas vs. domain.artefacto):
-- de las 8 originales, solo DOS pasan el criterio de v9 (volumen de consulta de dashboard + forma
-- estable) y se quedan como tabla física de verdad: nec_lote (mype.ejecucion_nec) y cites_permiso
-- (pesca.licencia_cites_denp) — ambas abajo en §3.3-bis, con un tipo_artefacto_id que las conecta a
-- este mismo registro para que el inventario de tipos y el blame sigan siendo uniformes aunque el
-- almacenamiento físico no lo sea. Las otras seis dejan de tener tabla propia:
--   - nec_concentracion: no es un hecho, es un AGREGADO calculado de nec_lote → vista materializada
--     mype.mv_concentracion_lotes (§3.3-bis), no domain.tipo_artefacto.
--   - inspeccion_cite y cites_cuota: volumen bajo, sin guardrail en caliente → vuelven a
--     domain.artefacto (quedan registradas aquí) con su vista de compatibilidad.
--   - cites_qr: es un LOG de eventos de escaneo (append-only), no una entidad de dominio con
--     estado → se queda como tabla física (pesca.trazabilidad_qr) pero fuera de este registro,
--     igual que avisa.raw_ingest no es un domain.tipo_artefacto.
--   - hidrico_estacion / hidrico_muestra: ver nota siguiente.
INSERT INTO domain.tipo_artefacto (codigo, dominio, esquema_json, requiere_caso, sujeto_requerido) VALUES
 ('nec_lote','mype','{"required":["nec_codigo","lote_codigo","monto_adjudicado_sol"]}'::jsonb, true, 'actor'),
 ('inspeccion_cite','mype','{"required":["ejecucion_id","nec_codigo","lote_codigo","resultado"]}'::jsonb, false, 'ninguno'),
 ('cites_permiso','cites','{"required":["solicitud_vuce_codigo","estado_permiso"]}'::jsonb, false, 'actor'),
 ('cites_cuota','cites','{"required":["anio","cuota_total_kg"]}'::jsonb, false, 'especie');
-- 'hidrico_estacion' e 'hidrico_muestra' NO se registran como domain.tipo_artefacto (edición
-- quirúrgica, ver más abajo §3.3-bis): una estación es un LUGAR (ya tiene su tipo en
-- territorio.cat_tipos_lugar, id=6 'estacion_hidrica') y una muestra es una OBSERVACIÓN de
-- contexto (ya tiene sus variables en ctx.cat_variables, id=29 OXIGENO_DISUELTO, 30 PH_AGUA,
-- 31 METALES_PESADOS). Registrar un domain.tipo_artefacto para lo mismo sería la misma
-- duplicación que esta edición corrige en territorio.* más abajo.

-- 'evento_contextual_externo': destino por defecto para cualquier dato que llegue de un sector
-- nuevo conectado por API (core.integraciones) y que no amerite su propio tipo de artefacto
-- todavía. No complejiza el esquema: un caso de un sector que recién empieza a conectarse
-- (una API de otro ministerio, un registro administrativo que aún no se ha estudiado a fondo)
-- entra aquí como "evento contextual importante" ligado al caso, sin que haga falta diseñar un
-- tipo de artefacto propio hasta que el volumen o la estructura lo justifiquen (mismo criterio
-- de las 8 excepciones: no se crea una forma especial hasta que haga falta).
INSERT INTO domain.tipo_artefacto (codigo, dominio, esquema_json, requiere_caso, sujeto_requerido) VALUES
 ('evento_contextual_externo','contexto_externo',
  '{"required":["fuente_integracion_codigo","tipo_evento","fecha_evento"]}'::jsonb, true, 'ninguno');

-- reglas de transición mínimas para nec_lote (borrador -> pendiente_validacion -> validado -> aprobado/rechazado)
INSERT INTO domain.regla_negocio (tipo_artefacto_id, codigo, tipo_regla, estado_desde_id, estado_hasta_id, mensaje_error)
SELECT id, 'T1', 'transicion', 1, 2, 'borrador debe pasar por validación' FROM domain.tipo_artefacto WHERE codigo='nec_lote';
INSERT INTO domain.regla_negocio (tipo_artefacto_id, codigo, tipo_regla, estado_desde_id, estado_hasta_id, mensaje_error)
SELECT id, 'T2', 'transicion', 2, 3, 'validación debe preceder aprobación' FROM domain.tipo_artefacto WHERE codigo='nec_lote';
INSERT INTO domain.regla_negocio (tipo_artefacto_id, codigo, tipo_regla, estado_desde_id, estado_hasta_id, mensaje_error)
SELECT id, 'T3', 'transicion', 3, 4, 'validado puede aprobarse' FROM domain.tipo_artefacto WHERE codigo='nec_lote';
-- G16 ya no cuelga de un tipo de artefacto: nec_concentracion es ahora mype.mv_concentracion_lotes
-- (vista materializada, §3.3-bis). El guardrail lee directamente esa vista y el umbral de
-- config.parametro ('G16.hhi_max'), sin necesitar una fila en domain.regla_negocio para dispararse.

-- Vista tipada de compatibilidad (reemplaza la tabla fija mype.ejecucion_nec)
CREATE SCHEMA IF NOT EXISTS mype;
CREATE VIEW mype.ejecucion_nec AS
SELECT a.id, a.payload->>'nec_codigo' AS nec_codigo, a.payload->>'lote_codigo' AS lote_codigo,
       a.sujeto_actor_uid AS mype_actor_uid, (a.payload->>'monto_adjudicado_sol')::numeric AS monto_adjudicado_sol,
       (a.payload->>'dias_mora')::int AS dias_mora, e.codigo AS estado, a.nivel_clasificacion, a.caso_id
  FROM domain.artefacto a JOIN domain.tipo_artefacto t ON t.id = a.tipo_id
  JOIN domain.cat_estados_artefacto e ON e.id = a.estado_id
 WHERE t.codigo = 'nec_lote' AND a.superseded_at IS NULL;

CREATE SCHEMA IF NOT EXISTS pesca;
CREATE VIEW pesca.licencia_cites_denp AS
SELECT a.id, a.payload->>'solicitud_vuce_codigo' AS solicitud_vuce_codigo, a.sujeto_actor_uid AS exportador_actor_uid,
       a.payload->>'estado_permiso' AS estado_permiso, (a.payload->>'volumen_autorizado_denp_kg')::numeric AS volumen_autorizado_denp_kg,
       a.nivel_clasificacion
  FROM domain.artefacto a JOIN domain.tipo_artefacto t ON t.id = a.tipo_id
 WHERE t.codigo = 'cites_permiso' AND a.superseded_at IS NULL;


-- =====================================================================
-- DELTA v9 -- ind.*, chat.*, proteccion.*, config.a2_transiciones/
-- guardrail_contract/schema_registry, catalogos y tablas C4-C6,
-- guardrails G16-G18, seeds, RLS (corregido y probado)
-- =====================================================================

-- =====================================================================
-- PRODUCE-OAIPCS · DDL v9 — consolidado (delta sobre v8.4)
-- Requiere: PostgreSQL >= 15, pgvector, postgis.
-- Ejecuta DESPUÉS de:
--   v8.2_nucleo_ddl.sql
--   v8.2_expansion_ddl.sql
--   v8.3 DDL (§20.20–20.28)
--   v8.4_domain_ddl_probado.sql
-- Marca [§X] referencia a la sección del documento v9 que esta DDL
-- implementa. [REEMPLAZA] indica que sustituye algo de v8.4.
-- =====================================================================

-- =====================================================================
-- §1. Extensiones [§A.1 de v9]
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS postgis;      -- [DM-3, §3.bis]
-- pgcrypto no es necesario: sha256(bytea) es built-in desde PG 11.

-- =====================================================================
-- §2. DM-1..4 (§3.bis) — 7 tablas + 12 columnas + 1 tabla rel + 3 vistas
-- =====================================================================

-- ---------- 2.1 DM-1: 7 tablas nuevas ----------

-- 2.1.1 core.riesgo_social_ordinal (IRSAM, C1)
CREATE TABLE core.riesgo_social_ordinal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lugar_id UUID NOT NULL REFERENCES territorio.lugares(id),
    fecha DATE NOT NULL,
    nivel VARCHAR(10) NOT NULL CHECK (nivel IN ('verde','ambar','rojo')),
    eventos_count INT NOT NULL DEFAULT 0 CHECK (eventos_count >= 0),
    convocatorias_count INT NOT NULL DEFAULT 0 CHECK (convocatorias_count >= 0),
    fuente VARCHAR(60) NOT NULL,   -- 'defensoria','acled','prensa','whatsapp'
    justificacion TEXT,
    es_validado_humano BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    UNIQUE (lugar_id, fecha, fuente)
);
CREATE INDEX ix_irsa_lugar_fecha ON core.riesgo_social_ordinal(lugar_id, fecha DESC);
CREATE INDEX ix_irsa_nivel ON core.riesgo_social_ordinal(nivel) WHERE nivel <> 'verde';

-- 2.1.2 core.acuerdo_ospa_sni (TCAOS, VCDO, C1)
CREATE TABLE core.acuerdo_ospa_sni (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ospa_actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    planta_actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    caso_id UUID REFERENCES core.casos(id),
    fecha_suscripcion DATE NOT NULL,
    vigencia_hasta DATE,
    volumen_comprometido_tn NUMERIC(12,2) CHECK (volumen_comprometido_tn IS NULL OR volumen_comprometido_tn >= 0),
    volumen_entregado_tn NUMERIC(12,2) CHECK (volumen_entregado_tn IS NULL OR volumen_entregado_tn >= 0),
    precio_acordado_sol_kg NUMERIC(10,2) CHECK (precio_acordado_sol_kg IS NULL OR precio_acordado_sol_kg >= 0),
    precio_efectivo_sol_kg NUMERIC(10,2) CHECK (precio_efectivo_sol_kg IS NULL OR precio_efectivo_sol_kg >= 0),
    estado VARCHAR(15) NOT NULL CHECK (estado IN ('vigente','vencido','incumplido','suspendido')),
    fuente_documento_id UUID REFERENCES kag.documento_fuente(id),
    denominador_conocido BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    notas TEXT,
    CHECK (volumen_entregado_tn IS NULL OR volumen_comprometido_tn IS NULL OR volumen_entregado_tn <= volumen_comprometido_tn)
);
CREATE INDEX ix_acuerdo_ospa ON core.acuerdo_ospa_sni(ospa_actor_uid);
CREATE INDEX ix_acuerdo_planta ON core.acuerdo_ospa_sni(planta_actor_uid);
CREATE INDEX ix_acuerdo_caso ON core.acuerdo_ospa_sni(caso_id) WHERE caso_id IS NOT NULL;

-- 2.1.3 territorio.parque_industrial (TIPI, VEAI, IATT, TOPS, C2)
CREATE TABLE territorio.parque_industrial (
    lugar_id UUID PRIMARY KEY REFERENCES territorio.lugares(id) ON DELETE CASCADE,
    poligono GEOGRAPHY(POLYGON),
    hectareas_total NUMERIC(10,2) NOT NULL CHECK (hectareas_total > 0),
    hectareas_utiles NUMERIC(10,2) CHECK (hectareas_utiles IS NULL OR hectareas_utiles >= 0),
    hectareas_saneadas NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (hectareas_saneadas >= 0),
    hectareas_con_cerco NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (hectareas_con_cerco >= 0),
    estado_saneamiento VARCHAR(20) NOT NULL
        CHECK (estado_saneamiento IN ('sin_saneamiento','parcial','completo','en_disputa')),
    instrumento_legal VARCHAR(80),
    fecha_ultima_actualizacion DATE NOT NULL DEFAULT CURRENT_DATE,
    CHECK (hectareas_utiles IS NULL OR hectareas_utiles <= hectareas_total)
);
CREATE INDEX ix_pi_poligono ON territorio.parque_industrial USING GIST (poligono);

-- 2.1.4 territorio.cuadricula_sismica (ISER, BZ, VCPUE, C3)
CREATE TABLE territorio.cuadricula_sismica (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote VARCHAR(20) NOT NULL,
    operador VARCHAR(120) NOT NULL,
    fase VARCHAR(20) NOT NULL CHECK (fase IN ('sismica_2d','sismica_3d','perforacion','produccion')),
    periodo_inicio DATE NOT NULL,
    periodo_fin DATE,
    poligono GEOGRAPHY(POLYGON),
    area_km2 NUMERIC(10,2) CHECK (area_km2 IS NULL OR area_km2 > 0),
    fuente_documento_id UUID REFERENCES kag.documento_fuente(id),
    CHECK (periodo_fin IS NULL OR periodo_fin >= periodo_inicio)
);
CREATE INDEX ix_cs_lote_fase ON territorio.cuadricula_sismica(lote, fase);
CREATE INDEX ix_cs_poligono ON territorio.cuadricula_sismica USING GIST (poligono);

-- 2.1.5 territorio.zona_pesca (ISER, BZ, VCPUE, C3)
CREATE TABLE territorio.zona_pesca (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(120) NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('caladero','desove','cria','mixta')),
    poligono GEOGRAPHY(POLYGON),
    fuente VARCHAR(60) NOT NULL,   -- 'ENEPA_IV','VMS_footprint','LEK','IMARPE'
    especie_id SMALLINT REFERENCES core.cat_especies(id),
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to DATE,
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX ix_zp_especie ON territorio.zona_pesca(especie_id);
CREATE INDEX ix_zp_poligono ON territorio.zona_pesca USING GIST (poligono);

-- 2.1.6 territorio.expansion_informal (VEAI, IATT, C2)
CREATE TABLE territorio.expansion_informal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lugar_id UUID NOT NULL REFERENCES territorio.lugares(id),
    fecha_deteccion DATE NOT NULL,
    area_m2 NUMERIC(10,2) NOT NULL CHECK (area_m2 > 0),
    precision NUMERIC(4,3) CHECK (precision IS NULL OR (precision BETWEEN 0 AND 1)),
    exhaustividad NUMERIC(4,3) CHECK (exhaustividad IS NULL OR (exhaustividad BETWEEN 0 AND 1)),
    fuente_satelite VARCHAR(40) NOT NULL,
    unidad_minima_mapeable_m2 NUMERIC(6,2) NOT NULL CHECK (unidad_minima_mapeable_m2 > 0),
    validacion_humana BOOLEAN NOT NULL DEFAULT FALSE,
    puntos_validados INT CHECK (puntos_validados IS NULL OR puntos_validados >= 0),
    puntos_correctos INT CHECK (puntos_correctos IS NULL OR puntos_correctos >= 0),
    UNIQUE (lugar_id, fecha_deteccion, fuente_satelite),
    CHECK (puntos_correctos IS NULL OR puntos_validados IS NULL OR puntos_correctos <= puntos_validados)
);
CREATE INDEX ix_ei_lugar_fecha ON territorio.expansion_informal(lugar_id, fecha_deteccion DESC);

-- 2.1.7 proteccion.registro_parametrico (TCPP, CPE, C1+C3)
CREATE SCHEMA IF NOT EXISTS proteccion;
CREATE TABLE proteccion.registro_parametrico (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programa VARCHAR(120) NOT NULL,
    actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    caso_id UUID REFERENCES core.casos(id),
    umbral_icen NUMERIC(5,2) NOT NULL,
    monto_maximo_sol NUMERIC(12,2) CHECK (monto_maximo_sol IS NULL OR monto_maximo_sol >= 0),
    fecha_cobertura_desde DATE NOT NULL,
    fecha_cobertura_hasta DATE,
    estado VARCHAR(15) NOT NULL CHECK (estado IN ('piloto','activo','vencido','suspendido')),
    fuente_documento_id UUID REFERENCES kag.documento_fuente(id),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 3 REFERENCES core.cat_clasificacion(nivel),
    CHECK (fecha_cobertura_hasta IS NULL OR fecha_cobertura_hasta >= fecha_cobertura_desde)
);
CREATE INDEX ix_rp_actor ON proteccion.registro_parametrico(actor_uid);
CREATE INDEX ix_rp_programa ON proteccion.registro_parametrico(programa);

-- ---------- 2.2 DM-2: 12 columnas nuevas en ind.* ----------

-- 2.2.1 ind.resultado: 8 columnas nuevas + bitemporalidad
ALTER TABLE ind.resultado
    ADD COLUMN valor_categoria VARCHAR(20)
        CHECK (valor_categoria IS NULL OR valor_categoria IN ('verde','ambar','rojo','sin_dato')),
    ADD COLUMN denominador NUMERIC,
    ADD COLUMN cobertura_pct NUMERIC(5,2)
        CHECK (cobertura_pct IS NULL OR (cobertura_pct BETWEEN 0 AND 100)),
    ADD COLUMN fuente_denominador VARCHAR(120),
    ADD COLUMN requiere_censo BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN censo_referencia VARCHAR(40),
    ADD COLUMN valido_desde TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN superseded_at TIMESTAMPTZ;

-- Reemplaza UNIQUE (variante_id, distrito_id, periodo) por parcial
ALTER TABLE ind.resultado
    DROP CONSTRAINT resultado_variante_id_distrito_id_periodo_key;
CREATE UNIQUE INDEX ux_ind_resultado_vigente
    ON ind.resultado (variante_id, distrito_id, periodo)
    WHERE superseded_at IS NULL;
CREATE INDEX ix_ind_resultado_variante ON ind.resultado(variante_id, periodo DESC);

-- Invariantes (business rules §8.7.6)
ALTER TABLE ind.resultado
    ADD CONSTRAINT chk_ind_resultado_denominador
        CHECK ((denominador IS NULL AND fuente_denominador IS NULL)
            OR (denominador IS NOT NULL AND fuente_denominador IS NOT NULL)),
    ADD CONSTRAINT chk_ind_resultado_censo
        CHECK (NOT requiere_censo OR censo_referencia IS NOT NULL);

-- 2.2.2 ind.variante: 1 columna
ALTER TABLE ind.variante
    ADD COLUMN requiere_censo BOOLEAN NOT NULL DEFAULT FALSE;

-- 2.2.3 ind.brecha: 2 columnas
ALTER TABLE ind.brecha
    ADD COLUMN requiere_censo BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN censo_referencia VARCHAR(40);

-- 2.2.4 ind.proxy_justificacion: 1 columna
ALTER TABLE ind.proxy_justificacion
    ADD COLUMN advertencia_metodologica TEXT;

-- Invariante: incertidumbre='alta' exige advertencia
ALTER TABLE ind.proxy_justificacion
    ADD CONSTRAINT chk_proxy_advertencia_alta
        CHECK (incertidumbre <> 'alta' OR (advertencia_metodologica IS NOT NULL
                                         AND length(trim(advertencia_metodologica)) > 0));

-- ---------- 2.3 ind.relacion_dependencia + vw_indicadores_obsoletos [§8.4.bis] ----------
CREATE TABLE ind.relacion_dependencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    indicador_id UUID NOT NULL REFERENCES ind.indicador(id),
    depende_de_indicador_id UUID REFERENCES ind.indicador(id),
    depende_de_variable_id SMALLINT REFERENCES ctx.cat_variables(id),
    tipo_dependencia VARCHAR(20) NOT NULL
        CHECK (tipo_dependencia IN ('componente','insumo','control','validacion','agregacion')),
    peso NUMERIC(5,4) CHECK (peso IS NULL OR peso > 0),
    CHECK (num_nonnulls(depende_de_indicador_id, depende_de_variable_id) = 1),
    CHECK (tipo_dependencia NOT IN ('componente','agregacion') OR peso IS NOT NULL),
    CHECK (indicador_id <> COALESCE(depende_de_indicador_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    UNIQUE (indicador_id, depende_de_indicador_id, depende_de_variable_id)
);
CREATE INDEX ix_rel_dep_indicador ON ind.relacion_dependencia(indicador_id);
CREATE INDEX ix_rel_dep_depende ON ind.relacion_dependencia(depende_de_indicador_id)
    WHERE depende_de_indicador_id IS NOT NULL;

-- Trigger anti-ciclo (recursivo)
CREATE OR REPLACE FUNCTION ind.chk_sin_ciclo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.depende_de_indicador_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.indicador_id = NEW.depende_de_indicador_id THEN
    RAISE EXCEPTION 'ind.relacion_dependencia: ciclo trivial % -> %', NEW.indicador_id, NEW.depende_de_indicador_id;
  END IF;
  IF EXISTS (
    WITH RECURSIVE alcanza AS (
      SELECT NEW.depende_de_indicador_id AS id, 1 AS d
      UNION
      SELECT rd.depende_de_indicador_id, a.d + 1
        FROM alcanza a JOIN ind.relacion_dependencia rd ON rd.indicador_id = a.id
       WHERE rd.depende_de_indicador_id IS NOT NULL AND a.d < 50
    )
    SELECT 1 FROM alcanza WHERE id = NEW.indicador_id
  ) THEN
    RAISE EXCEPTION 'ind.relacion_dependencia: ciclo detectado al insertar % -> %', NEW.indicador_id, NEW.depende_de_indicador_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_rel_dep_ciclo BEFORE INSERT OR UPDATE ON ind.relacion_dependencia
  FOR EACH ROW EXECUTE FUNCTION ind.chk_sin_ciclo();

-- ---------- 2.4 DM-4: 3 vistas nuevas [§3.bis] ----------

-- 2.4.1 vw_indicadores_obsoletos (propagación recursiva de frescura)
CREATE OR REPLACE VIEW analytics.vw_indicadores_obsoletos AS
WITH RECURSIVE cadena AS (
    SELECT i.id AS indicador_id, i.codigo, NULL::uuid AS padre, 0 AS nivel
      FROM ind.indicador i
    UNION
    SELECT rd.indicador_id, i.codigo, c.indicador_id, c.nivel + 1
      FROM cadena c
      JOIN ind.relacion_dependencia rd ON rd.depende_de_indicador_id = c.indicador_id
      JOIN ind.indicador i ON i.id = rd.indicador_id
     WHERE c.nivel < 6
), vars_stale AS (
    SELECT rd.indicador_id,
           bool_or(
             COALESCE(
               (SELECT (CURRENT_DATE - o.fecha) > v.ttl_frescura_dias
                  FROM ctx.cat_variables v
                  LEFT JOIN LATERAL ctx.ultima_observacion(v.codigo) o ON TRUE
                 WHERE v.id = rd.depende_de_variable_id),
               FALSE)
           ) AS stale
      FROM ind.relacion_dependencia rd
     WHERE rd.depende_de_variable_id IS NOT NULL
     GROUP BY rd.indicador_id
)
SELECT c.indicador_id, c.codigo, c.padre, c.nivel,
       COALESCE(vs.stale, FALSE) AS variable_obsoleta
  FROM cadena c
  LEFT JOIN vars_stale vs ON vs.indicador_id = c.indicador_id;

-- 2.4.2 vw_eravisa_survival (Kaplan-Meier de casos abiertos)
CREATE OR REPLACE VIEW analytics.vw_eravisa_survival AS
WITH base AS (
    SELECT c.id,
           c.codigo_caso,
           c.fecha_inicio,
           c.fecha_cierre,
           CASE WHEN c.fecha_cierre IS NULL THEN CURRENT_DATE - c.fecha_inicio
                ELSE c.fecha_cierre - c.fecha_inicio
           END AS dias_abierto,
           (c.fecha_cierre IS NOT NULL) AS evento_cierre
      FROM core.casos c
)
SELECT codigo_caso, dias_abierto, evento_cierre,
       count(*) OVER () AS total_casos,
       count(*) FILTER (WHERE NOT evento_cierre) OVER () AS censurados
  FROM base
 WHERE dias_abierto IS NOT NULL;

-- 2.4.3 vw_erop_milestones (estado de hitos del ROP)
CREATE OR REPLACE VIEW analytics.vw_erop_milestones AS
SELECT r.codigo AS regla_codigo,
       r.titulo,
       r.estado AS regla_estado,
       r.disparador_vencimiento_fecha,
       r.disparador_vencimiento_evento,
       r.fuente_documento_id
  FROM policy.regla r
 WHERE r.clase = 'N'
   AND r.codigo LIKE 'N-ROP-%';

-- =====================================================================
-- §3. DM-5 (§3.ter) — mype, pesca, territorio extension
-- =====================================================================

-- ---------- 3.1 mype: reemplaza view v8.4 por tabla ----------
-- v8.4 creó mype.ejecucion_nec y mype.v_ejecucion_nec_legacy como VIEWs
-- sobre domain.artefacto. v9 las reemplaza por tablas reales (superset
-- de columnas; SELECTs existentes siguen funcionando).
DROP VIEW IF EXISTS mype.ejecucion_nec CASCADE;
DROP VIEW IF EXISTS pesca.licencia_cites_denp CASCADE;

CREATE TABLE mype.ejecucion_nec (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nec_codigo VARCHAR(60) NOT NULL,
    lote_codigo VARCHAR(60) NOT NULL,
    mype_actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    monto_adjudicado_sol NUMERIC(15,2) NOT NULL CHECK (monto_adjudicado_sol >= 0),
    fecha_adjudicacion DATE NOT NULL,
    fecha_entrega_pactada DATE,
    fecha_recepcion_cite DATE,
    fecha_conformidad DATE,
    fecha_pago_efectivo DATE,
    estado_pago VARCHAR(20) NOT NULL DEFAULT 'pendiente'
        CHECK (estado_pago IN ('pendiente','en_revision','aprobado','pagado','rechazado')),
    -- NOTA DE CORRECCIÓN (validado en Postgres 16): un GENERATED ALWAYS...STORED
    -- no admite CURRENT_DATE (no es inmutable). dias_mora queda inmutable (solo
    -- se calcula cuando ya hay fecha_pago_efectivo); la mora "a hoy" de un lote
    -- aún impago se expone en la vista mype.v_ejecucion_nec_mora_vigente (abajo),
    -- que sí puede usar CURRENT_DATE porque no es una columna generada.
    dias_mora INT GENERATED ALWAYS AS (
        CASE WHEN fecha_pago_efectivo IS NOT NULL AND fecha_entrega_pactada IS NOT NULL
               THEN GREATEST(0, fecha_pago_efectivo - fecha_entrega_pactada)
             ELSE NULL
        END
    ) STORED,
    fuente_documento_id UUID REFERENCES kag.documento_fuente(id),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    -- Vínculo de inventario (edición quirúrgica): aunque nec_lote se queda como excepción física
    -- justificada, sigue registrado en domain.tipo_artefacto para que el blame y el inventario de
    -- tipos sigan siendo uniformes sin importar dónde vive el dato físicamente.
    -- PostgreSQL no admite subconsultas en DEFAULT (bug real, detectado al probar esta edición):
    -- se completa con un trigger (core.set_tipo_artefacto_nec_lote, más abajo), no con DEFAULT.
    tipo_artefacto_id UUID REFERENCES domain.tipo_artefacto(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (nec_codigo, lote_codigo)
);
CREATE INDEX ix_mype_nec ON mype.ejecucion_nec(mype_actor_uid);
CREATE FUNCTION mype.set_tipo_artefacto_nec_lote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo_artefacto_id IS NULL THEN
    NEW.tipo_artefacto_id := (SELECT id FROM domain.tipo_artefacto WHERE codigo = 'nec_lote' AND estado = 'activo');
    IF NEW.tipo_artefacto_id IS NULL THEN RAISE EXCEPTION 'domain.tipo_artefacto ''nec_lote'' no existe o no está activo'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_nec_lote_tipo BEFORE INSERT ON mype.ejecucion_nec
  FOR EACH ROW EXECUTE FUNCTION mype.set_tipo_artefacto_nec_lote();
ALTER TABLE mype.ejecucion_nec ALTER COLUMN tipo_artefacto_id SET NOT NULL;
CREATE INDEX ix_mype_nec_codigo ON mype.ejecucion_nec(nec_codigo);
CREATE INDEX ix_mype_pendientes ON mype.ejecucion_nec(estado_pago) WHERE estado_pago <> 'pagado';

-- Mora "a hoy" para lotes aún impagos (CURRENT_DATE no cabe en una columna
-- GENERATED STORED; se expone como vista, consistente con el resto del
-- corpus donde los cálculos dependientes del reloj viven en vistas, no en
-- columnas almacenadas).
CREATE VIEW mype.v_ejecucion_nec_mora_vigente WITH (security_invoker = true) AS
SELECT *,
       COALESCE(dias_mora,
                CASE WHEN fecha_entrega_pactada IS NOT NULL AND fecha_pago_efectivo IS NULL
                       THEN GREATEST(0, CURRENT_DATE - fecha_entrega_pactada)
                     ELSE NULL END) AS dias_mora_vigente
  FROM mype.ejecucion_nec;

-- mype.concentracion_lotes (edición quirúrgica): no es un hecho, es un AGREGADO calculado de
-- mype.ejecucion_nec. Guardarlo como tabla aparte crea una segunda fuente de verdad del mismo
-- dato (si se corrige un lote, alguien tiene que acordarse de recalcular la concentración). Se
-- reemplaza por una vista materializada, con el mismo patrón que analytics.mv_dashboard_alta_direccion.
CREATE MATERIALIZED VIEW mype.mv_concentracion_lotes AS
WITH lote AS (
    SELECT date_trunc('month', fecha_adjudicacion)::date AS periodo, nec_codigo, mype_actor_uid,
           SUM(monto_adjudicado_sol) AS monto_mype
      FROM mype.ejecucion_nec GROUP BY 1, 2, 3
), total AS (
    SELECT periodo, nec_codigo, SUM(monto_mype) AS monto_total, COUNT(*) AS numero_mypes
      FROM lote GROUP BY 1, 2
)
SELECT l.periodo, l.nec_codigo, t.numero_mypes,
       (SELECT COUNT(*) FROM mype.ejecucion_nec e WHERE date_trunc('month', e.fecha_adjudicacion)::date = l.periodo AND e.nec_codigo = l.nec_codigo) AS numero_lotes,
       -- HHI real: suma de las participaciones al cuadrado (0..1). El Gini, por requerir ordenar
       -- y acumular participaciones, se deja al job de M11 (config.aplicacion), no a esta vista,
       -- para no convertir una vista materializada en un cálculo que no se puede indexar bien.
       SUM(POWER(l.monto_mype / NULLIF(t.monto_total, 0), 2)) AS hhi,
       jsonb_agg(jsonb_build_object('mype_actor_uid', l.mype_actor_uid, 'monto', l.monto_mype) ORDER BY l.monto_mype DESC) AS top_mypes_json
  FROM lote l JOIN total t ON t.periodo = l.periodo AND t.nec_codigo = l.nec_codigo
 GROUP BY l.periodo, l.nec_codigo, t.numero_mypes, t.monto_total;
CREATE UNIQUE INDEX ux_mv_concentracion_lotes ON mype.mv_concentracion_lotes(periodo, nec_codigo);  -- habilita REFRESH ... CONCURRENTLY
-- G16 lee esta vista directamente contra config.parametro('G16.hhi_max'), sin pasar por domain.regla_negocio.

-- mype.inspeccion_cite (edición quirúrgica): volumen bajo (una por lote, no por día) y sin
-- guardrail que la consulte en caliente → no justifica tabla propia; vuelve a domain.artefacto
-- (tipo 'inspeccion_cite', registrado más arriba) con esta vista de compatibilidad.
-- Nota honesta: "ejecucion_id" deja de ser una FK exigida por la base de datos (las vistas sobre
-- domain.artefacto no pueden imponerla) y pasa a validarse por el Resolver antes del INSERT —
-- el mismo reparto de responsabilidades que ya usa avisa.raw_ingest para sus referencias cruzadas.
CREATE VIEW mype.inspeccion_cite AS
SELECT a.id, (a.payload->>'ejecucion_id')::uuid AS ejecucion_id,
       (a.payload->>'fecha_inspeccion')::date AS fecha_inspeccion,
       a.payload->>'resultado' AS resultado, a.payload->>'observaciones' AS observaciones,
       a.payload->>'inspector' AS inspector, a.nivel_clasificacion, a.created_at
  FROM domain.artefacto a JOIN domain.tipo_artefacto t ON t.id = a.tipo_id
 WHERE t.codigo = 'inspeccion_cite' AND a.superseded_at IS NULL;

-- ---------- 3.2 pesca ----------
CREATE TABLE pesca.licencia_cites_denp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitud_vuce_codigo VARCHAR(80) NOT NULL UNIQUE,
    exportador_actor_uid UUID NOT NULL REFERENCES core.actores(actor_uid),
    especie_id SMALLINT NOT NULL REFERENCES core.cat_especies(id),
    volumen_solicitado_kg NUMERIC(12,2) CHECK (volumen_solicitado_kg IS NULL OR volumen_solicitado_kg >= 0),
    volumen_autorizado_denp_kg NUMERIC(12,2) CHECK (volumen_autorizado_denp_kg IS NULL OR volumen_autorizado_denp_kg >= 0),
    fecha_solicitud TIMESTAMPTZ NOT NULL,
    fecha_dictamen_imarpe TIMESTAMPTZ,
    fecha_emision_permiso TIMESTAMPTZ,
    estado_permiso VARCHAR(20) NOT NULL DEFAULT 'solicitado'
        CHECK (estado_permiso IN ('solicitado','dictaminado','emitido','rechazado','vencido')),
    trazabilidad_qr_validada BOOLEAN NOT NULL DEFAULT FALSE,
    fuente_documento_id UUID REFERENCES kag.documento_fuente(id),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (volumen_autorizado_denp_kg IS NULL OR volumen_solicitado_kg IS NULL
           OR volumen_autorizado_denp_kg <= volumen_solicitado_kg),
    CHECK (estado_permiso <> 'emitido' OR fecha_emision_permiso IS NOT NULL),
    -- mismo vínculo de inventario que mype.ejecucion_nec (edición quirúrgica; mismo motivo:
    -- sin subconsulta en DEFAULT, se completa con un trigger, no con DEFAULT)
    tipo_artefacto_id UUID REFERENCES domain.tipo_artefacto(id)
);
CREATE INDEX ix_licencia_exportador ON pesca.licencia_cites_denp(exportador_actor_uid);
CREATE INDEX ix_licencia_especie ON pesca.licencia_cites_denp(especie_id);
CREATE INDEX ix_licencia_pendientes ON pesca.licencia_cites_denp(estado_permiso) WHERE estado_permiso <> 'emitido';
CREATE FUNCTION pesca.set_tipo_artefacto_cites_permiso() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo_artefacto_id IS NULL THEN
    NEW.tipo_artefacto_id := (SELECT id FROM domain.tipo_artefacto WHERE codigo = 'cites_permiso' AND estado = 'activo');
    IF NEW.tipo_artefacto_id IS NULL THEN RAISE EXCEPTION 'domain.tipo_artefacto ''cites_permiso'' no existe o no está activo'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cites_permiso_tipo BEFORE INSERT ON pesca.licencia_cites_denp
  FOR EACH ROW EXECUTE FUNCTION pesca.set_tipo_artefacto_cites_permiso();
ALTER TABLE pesca.licencia_cites_denp ALTER COLUMN tipo_artefacto_id SET NOT NULL;

-- pesca.cuota_cites_especie (edición quirúrgica): una fila por especie-año — decenas de filas,
-- no miles; el volumen no justifica tabla propia. Vuelve a domain.artefacto (tipo 'cites_cuota').
CREATE VIEW pesca.cuota_cites_especie AS
SELECT a.id, a.sujeto_especie_id AS especie_id, (a.payload->>'anio')::int AS anio,
       (a.payload->>'cuota_total_kg')::numeric AS cuota_total_kg,
       COALESCE((a.payload->>'cuota_consumida_kg')::numeric, 0) AS cuota_consumida_kg,
       COALESCE(a.payload->>'estado', 'vigente') AS estado, a.sujeto_documento_id AS fuente_documento_id
  FROM domain.artefacto a JOIN domain.tipo_artefacto t ON t.id = a.tipo_id
 WHERE t.codigo = 'cites_cuota' AND a.superseded_at IS NULL;

-- pesca.trazabilidad_qr (edición quirúrgica, reclasificación): esto NO es una entidad de dominio
-- con estado — es un LOG de eventos de escaneo (append-only, un registro por lectura de QR, nunca
-- se edita). Mezclarlo con nec_lote o cites_permiso en la misma categoría de "excepción física
-- por volumen" confunde dos cosas distintas: un hecho que cambia de estado y un evento que ocurre
-- una vez. Se queda como tabla física (el patrón correcto es el de avisa.raw_ingest, no el de
-- domain.artefacto ni el de una tabla de negocio con transiciones) y, por eso, no se registra en
-- domain.tipo_artefacto.
CREATE TABLE pesca.trazabilidad_qr (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qr_code VARCHAR(200) NOT NULL,
    licencia_id UUID NOT NULL REFERENCES pesca.licencia_cites_denp(id) ON DELETE CASCADE,
    lugar_desembarque_id UUID REFERENCES territorio.lugares(id),
    fecha_escaneo TIMESTAMPTZ NOT NULL,
    etapa VARCHAR(20) NOT NULL CHECK (etapa IN ('desembarque','procesamiento','exportacion')),
    valido BOOLEAN NOT NULL DEFAULT TRUE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);
CREATE INDEX ix_qr_licencia ON pesca.trazabilidad_qr(licencia_id);
CREATE INDEX ix_qr_code ON pesca.trazabilidad_qr(qr_code);
CREATE UNIQUE INDEX ux_qr_desembarque ON pesca.trazabilidad_qr(qr_code) WHERE etapa = 'desembarque';

-- ---------- 3.3 territorio extension (edición quirúrgica: ya resuelto desde el núcleo, no hace
-- falta tabla nueva) ----------
-- territorio.estacion_hidrica: una estación es, estructuralmente, un LUGAR — exactamente lo que
-- territorio.lugares + un detalle 1:1 ya resuelven para terminal/desembarcadero/planta/caleta
-- (líneas 354-357). territorio.cat_tipos_lugar ya tenía 'estacion_hidrica' seedeado (id=6) antes
-- de esta edición: la tabla original la duplicaba sin usarla. Se reemplaza por el mismo patrón de
-- detalle que ya existe para los otros cuatro tipos de lugar.
CREATE TABLE territorio.estacion_hidrica_detalle (
    lugar_id UUID PRIMARY KEY REFERENCES territorio.lugares(id) ON DELETE CASCADE,
    codigo_ana VARCHAR(40) NOT NULL UNIQUE,
    cuenca VARCHAR(120) NOT NULL,
    subcuenca VARCHAR(120),
    altitud_msnm NUMERIC(8,2),
    tipo_estacion VARCHAR(20) NOT NULL
        CHECK (tipo_estacion IN ('rio','quebrada','lago','laguna','embalse','glaciar'))
);
CREATE INDEX ix_estacion_cuenca ON territorio.estacion_hidrica_detalle(cuenca);

-- territorio.monitoreo_hidrico: una muestra de agua es una OBSERVACIÓN de una variable en un
-- lugar y una fecha — exactamente lo que ctx.observaciones (formato largo) ya resuelve. Las tres
-- variables (OXIGENO_DISUELTO id=29, PH_AGUA id=30, METALES_PESADOS id=31) ya existían como
-- *concepto* en este mismo documento (§4.7/§8.6, más abajo en el archivo: ctx.cat_dominios y
-- ctx.cat_variables para C4/C5/C6) antes de esta edición — la tabla territorio.monitoreo_hidrico
-- duplicaba esa infraestructura en vez de usarla, aunque sus filas de INSERT aparezcan más
-- adelante en el archivo (el orden textual no afecta a una vista: solo necesita que la tabla
-- ctx.observaciones exista, no que ya tenga datos). Se añade aquí la variable de temperatura que
-- faltaba y una vista de conveniencia que
-- reconstruye "excede ECA" leyendo los mismos umbrales que ya usa el guardrail G17
-- (config.parametro, 'G17.od_min' y 'G17.metales_max_ppm'), en vez de una columna GENERATED
-- propia — así un cambio de umbral por norma nueva no exige alterar una tabla.
INSERT INTO ctx.cat_variables (id, codigo, nombre, dominio_id, ambito, periodicidad_dias, ttl_frescura_dias) VALUES
 (38,'TEMPERATURA_AGUA','Temperatura del agua (°C)',7,'lugar',7,15)
ON CONFLICT (id) DO NOTHING;

CREATE VIEW territorio.vw_monitoreo_hidrico_excede_eca AS
WITH od AS (SELECT lugar_id, fecha, valor AS od FROM ctx.observaciones WHERE variable_id = 29),
     ph AS (SELECT lugar_id, fecha, valor AS ph FROM ctx.observaciones WHERE variable_id = 30),
     met AS (SELECT lugar_id, fecha, valor AS metales FROM ctx.observaciones WHERE variable_id = 31)
SELECT COALESCE(od.lugar_id, ph.lugar_id, met.lugar_id) AS lugar_id,
       COALESCE(od.fecha, ph.fecha, met.fecha) AS fecha, od.od, ph.ph, met.metales,
       -- COALESCE(...,FALSE), no comparación desnuda: sin este COALESCE, una lectura ausente de
       -- alguna variable (p. ej. sin muestra de metales ese día) vuelve NULL toda la expresión en
       -- vez de FALSE, por la lógica de tres valores de SQL (FALSE OR NULL = NULL, no FALSE).
       -- Bug real, encontrado al probar esta vista: la tabla original sí usaba COALESCE y esta
       -- reescritura lo había perdido.
       COALESCE(od.od < (config.leer_parametro('G17.od_min') #>> '{}')::numeric, FALSE)
         OR COALESCE(met.metales > (config.leer_parametro('G17.metales_max_ppm') #>> '{}')::numeric, FALSE)
         OR COALESCE(ph.ph < 6.5 OR ph.ph > 9.0, FALSE) AS excede_eca
  FROM od FULL JOIN ph ON ph.lugar_id = od.lugar_id AND ph.fecha = od.fecha
          FULL JOIN met ON met.lugar_id = COALESCE(od.lugar_id, ph.lugar_id) AND met.fecha = COALESCE(od.fecha, ph.fecha);

-- =====================================================================
-- §4. DM-6..13 (§3.ter) — catálogos, variables, feature flags, fuentes
-- =====================================================================

-- ---------- 4.1 DM-6..7: tipos de nodo y arista KAG ----------
INSERT INTO kag.cat_tipos_nodo (codigo, nombre) VALUES
 ('nec','Núcleo Ejecutor de Compras'),
 ('lote','Lote de manufactura MYPE'),
 ('estacion_hidrica','Estación de monitoreo hídrico'),
 ('cuenca','Cuenca hidrográfica'),
 ('permiso_cites','Permiso CITES')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO kag.cat_tipos_arista (id, codigo, clase, dirigida, origen_tipo, destino_tipo) VALUES
 (14,'ABASTECE_A','participacion',TRUE,'actor','nec'),
 (15,'ADJUDICADO_A','participacion',TRUE,'nec','actor'),
 (16,'INSPECCIONADO_POR','participacion',TRUE,'lote','actor'),
 (17,'MONITOREA','participacion',TRUE,'actor','estacion_hidrica'),
 (18,'AFECTA_CUENCA','causal',TRUE,'caso','cuenca'),
 (19,'AUTORIZA_EXPORTACION','participacion',TRUE,'actor','permiso_cites')
ON CONFLICT (id) DO NOTHING;

-- ---------- 4.2 DM-8: tipos de lugar ----------
INSERT INTO territorio.cat_tipos_lugar (id, codigo) VALUES
 (5,'cite'),(6,'estacion_hidrica'),(7,'camara_frio'),(8,'piscigranja'),(9,'nec')
ON CONFLICT (id) DO NOTHING;

-- ---------- 4.3 DM-9: tipos de actor y roles ----------
INSERT INTO core.cat_tipos_actor (id, nombre) VALUES
 (4,'NEC'),(5,'Exportador CITES'),(6,'CITE'),(7,'SANIPES')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.cat_roles_actor (id, nombre) VALUES
 (4,'Proveedor MYPE'),(5,'Exportador CITES'),(6,'Inspector CITE')
ON CONFLICT (id) DO NOTHING;

-- ---------- 4.4 DM-10: especies ----------
INSERT INTO core.cat_especies (id, nombre_comun, nombre_cientifico) VALUES
 (11,'Trucha arcoíris','Oncorhynchus mykiss'),
 (12,'Tiburón martillo','Sphyrna lewini'),
 (13,'Tiburón zorro','Alopias vulpinus'),
 (14,'Tiburón ballena','Rhincodon typus'),
 (15,'Tiburón azul','Prionace glauca')
ON CONFLICT (id) DO NOTHING;

-- ---------- 4.5 DM-12: tipos de fuente de integración ----------
CREATE TABLE core.cat_tipos_fuente_integracion (
    id SMALLINT PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    nombre VARCHAR(120) NOT NULL
);
INSERT INTO core.cat_tipos_fuente_integracion (id, codigo, nombre) VALUES
 (1,'dgsfs_pa','DGSFS-PA (SISESAT, SITRAPESCA)'),
 (2,'dicapi','DICAPI (capitanías, arribos)'),
 (3,'imarpe','IMARPE (CPUE, biomasa, boletines)'),
 (4,'senace','SENACE (EIA-d)'),
 (5,'oefa','OEFA (supervisión)'),
 (6,'minem','MINEM (lotes)'),
 (7,'sbn','SBN (catastro)'),
 (8,'proinversion','PROINVERSIÓN (pipeline)'),
 (9,'defensoria','Defensoría (reporte mensual)'),
 (10,'gfw','Global Fishing Watch (VMS/AIS)'),
 (11,'snia','SNIA (repositorio técnico)'),
 (12,'sunat_comprobantes','SUNAT (comprobantes electrónicos)'),
 (13,'vuce','VUCE (permisos CITES)'),
 (14,'ana_siagua','ANA SiAGUA (series hidrológicas)'),
 (15,'sanipes_acuicola','SANIPES (PCR acuícola)'),
 (16,'citered','CITEred (actas de inspección)'),
 (17,'cites_secretariat','CITES Secretariat'),
 (18,'dgsfs_pa_tiburon','DGSFS-PA (desembarque tiburón)'),
 (19,'oefa_pam','OEFA (pasivos ambientales)'),
 (20,'sbs','SBS (tasa MYPE)');

ALTER TABLE core.integraciones
    ADD COLUMN tipo_fuente_id SMALLINT REFERENCES core.cat_tipos_fuente_integracion(id);
CREATE INDEX ix_integ_tipo_fuente ON core.integraciones(tipo_fuente_id);

-- ---------- 4.5.bis Edición SESIGUE: outbox transaccional genérico + gate HITL ----------
-- Nada de aquí lleva "sesigue" en el nombre: el mismo patrón sirve para VUCE, ANA, SANIPES
-- y las demás fuentes ya registradas en core.cat_tipos_fuente_integracion.

-- Estados controlados del ciclo de vida de un envío a un sistema externo. Reemplaza, para
-- el outbox, el workflow_state de texto libre: mismo principio que cat_estados_compromiso y
-- cat_estados_hito (los estados no son texto libre).
CREATE TABLE core.cat_estados_integracion (
    id SMALLINT PRIMARY KEY,
    codigo VARCHAR(30) NOT NULL UNIQUE,
    es_terminal BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO core.cat_estados_integracion (id, codigo, es_terminal) VALUES
 (1,'pendiente_aprobacion',FALSE), (2,'aprobado_para_envio',FALSE), (3,'enviado',FALSE),
 (4,'confirmado',TRUE), (5,'rechazado_por_destino',TRUE), (6,'rechazado_por_enlace',TRUE),
 (7,'reintentando',FALSE), (8,'fallo_definitivo',TRUE);

-- Outbox transaccional genérico: cualquier módulo que registre un hecho local que algún día
-- deba propagarse a un sistema externo inserta aquí EN LA MISMA TRANSACCIÓN que el hecho
-- local, nunca después. Un worker asíncrono (fuera de la base de datos) lee las filas
-- 'aprobado_para_envio'/'reintentando' y las empuja; el trigger que crea el hecho local nunca
-- escribe al sistema externo. No vive en domain.artefacto: es infraestructura de transporte
-- (como avisa.raw_ingest o agent.run_log), no un hecho de dominio con estado de negocio.
CREATE TABLE core.outbox_integracion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integracion_id UUID NOT NULL REFERENCES core.integraciones(id),
    payload_local JSONB NOT NULL,          -- lo que el sistema local sabe, tal cual
    payload_transformado JSONB,            -- salida del Transformador de Esquema; la llena el worker, no la DB
    estado_id SMALLINT NOT NULL DEFAULT 1 REFERENCES core.cat_estados_integracion(id),
    intentos INT NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    proximo_intento_en TIMESTAMPTZ,         -- backoff exponencial del worker
    -- Gate HITL: el mismo idioma que core.cambio_normativo. Nadie empuja sin que alguien con
    -- autoridad (el "Coordinador Sectorial / Enlace") lo apruebe, y el destinatario del
    -- permiso queda registrado.
    aprobado_por UUID REFERENCES core.usuarios(id),
    aprobado_en TIMESTAMPTZ,
    ticket_externo VARCHAR(100),            -- ticket/hash de confirmación que devuelve el destino
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_outbox_pendientes ON core.outbox_integracion(estado_id, proximo_intento_en)
  WHERE estado_id IN (2,7);                 -- lo que el worker debe mirar
CREATE INDEX ix_outbox_integracion ON core.outbox_integracion(integracion_id);

-- Gate impuesto por la base, no confiado a la aplicación: igual que el bloqueo de escritura
-- directa en core.cat_niveles_conflicto. Cubre los estados 2, 3 y 4 (aprobado, enviado y
-- confirmado): ninguno de los tres puede existir sin aprobado_por, porque los tres implican
-- que la fila ya cruzó el gate. Además sella la marca de tiempo de la aprobación y el primer
-- próximo intento, y lo hace solo dentro de ese bloque (una fila en estado 1 no queda
-- marcada como aprobada).
CREATE FUNCTION core.chk_outbox_aprobacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado_id IN (2,3,4) THEN
    IF NEW.aprobado_por IS NULL THEN
      RAISE EXCEPTION 'core.outbox_integracion %: no puede pasar al estado % sin aprobado_por (gate HITL)',
                      NEW.id, NEW.estado_id;
    END IF;
    IF NEW.aprobado_en IS NULL THEN NEW.aprobado_en := now(); END IF;
    IF NEW.proximo_intento_en IS NULL THEN NEW.proximo_intento_en := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_outbox_aprobacion BEFORE INSERT OR UPDATE ON core.outbox_integracion
  FOR EACH ROW EXECUTE FUNCTION core.chk_outbox_aprobacion();

-- Agregación N:1: varios hitos locales (varias filas de core.integraciones que comparten el
-- mismo entidad_destino_ref) se agregan hacia un único compromiso del sistema externo. No es
-- una tabla de concordancia nueva: es la misma core.integraciones, vista agrupada por destino.
-- primera_sincronizacion es MIN(ultima_sincronizacion): core.integraciones no guarda una
-- marca de creación, así que el nombre describe la primera sincronización conocida, no el
-- alta de la fila.
CREATE VIEW core.vw_agregacion_compromiso_externo AS
SELECT sistema_destino, entidad_destino_ref,
       COUNT(*) AS hitos_locales_asociados,
       array_agg(DISTINCT entidad_origen_tipo ORDER BY entidad_origen_tipo) AS tipos_origen,
       MIN(ultima_sincronizacion) AS primera_sincronizacion,
       MAX(ultima_sincronizacion) AS ultima_sincronizacion,
       bool_and(estado = 'activa') AS todos_activos
  FROM core.integraciones
 WHERE entidad_destino_ref IS NOT NULL
 GROUP BY sistema_destino, entidad_destino_ref;

-- Nivel de integración por fuente. No se asume API REST por defecto: la mayoría de las 12
-- fuentes registradas hoy no tienen API confirmada y operan por oficio o convenio manual.
ALTER TABLE core.integraciones ADD COLUMN IF NOT EXISTS protocolo_sincronizacion VARCHAR(20)
    CHECK (protocolo_sincronizacion IN ('api_rest_pide', 'batch_sftp', 'oficio_manual'))
    DEFAULT 'oficio_manual';

-- workflow_state sigue siendo texto libre a propósito: describe el trámite del lado del
-- sistema externo ("Solicitado -> En revisión MEF -> Aprobado -> Ejecutado", §13.4), una
-- granularidad distinta de la del outbox, que describe el ciclo de vida del mensaje.
COMMENT ON COLUMN core.integraciones.workflow_state IS
  'Estado del trámite en el sistema externo (texto libre, p. ej. el workflow inter-ministerial de §13.4). NO confundir con core.outbox_integracion.estado_id, que es el ciclo de vida del mensaje de transporte.';

-- Traducción de estados locales a la semántica del destino. Metadata-driven: una fila nueva
-- por cada par (sistema, estado_local, estado_externo); nunca un CASE en código ni una columna
-- ENUM que haya que migrar cuando el destino cambie su propia taxonomía.
CREATE TABLE core.cat_mapeo_estado_externo (
    id SMALLINT PRIMARY KEY,
    sistema_destino VARCHAR(100) NOT NULL,
    estado_local VARCHAR(60) NOT NULL,      -- p. ej. 'En_Contratación', 'En_Elaboración_TDR'
    estado_externo VARCHAR(60) NOT NULL,    -- p. ej. 'En_Cumplimiento_En_Plazo'
    UNIQUE (sistema_destino, estado_local)
);
-- ¡verificar! Estas tres filas son ILUSTRATIVAS: no están confirmadas contra la taxonomía real
-- de la SSGC y además sus estado_local no coinciden con los cinco códigos de
-- core.cat_estados_compromiso ('Por_iniciar','En_proceso','Cumplido','Redefinido','Desestimado').
-- Se siembran como hipótesis de trabajo; la Mesa Técnica Institucional (Fase 3, §15.7) debe
-- reemplazarlas o confirmarlas antes de que el worker las use. Trazado en Q33/D21.
INSERT INTO core.cat_mapeo_estado_externo (id, sistema_destino, estado_local, estado_externo) VALUES
 (1,'SESIGUE','En_Contratación','En_Cumplimiento_En_Plazo'),
 (2,'SESIGUE','En_Elaboración_TDR','En_Cumplimiento_En_Plazo'),
 (3,'SESIGUE','Vencido_Sin_Sustento','En_Cumplimiento_Vencido');

-- La fuente externa como fila del catálogo (no como tabla propia). El código sigue la
-- convención de las otras 20 filas: minúsculas.
INSERT INTO core.cat_tipos_fuente_integracion (id, codigo, nombre) VALUES
 (21,'sesigue','SESIGUE (SSGC — PCM)');

-- ---------- 4.6 DM-13: feature flags ----------
CREATE TABLE core.feature_flags (
    codigo VARCHAR(40) PRIMARY KEY,
    descripcion TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT FALSE,
    activado_en TIMESTAMPTZ,
    activado_por UUID REFERENCES core.usuarios(id),
    metadata_json JSONB
);
INSERT INTO core.feature_flags (codigo, descripcion, activo) VALUES
 ('M11_mype','Inteligencia de compras públicas (C4)',FALSE),
 ('M12_acuicultura','Vigilancia hídrico-sanitaria (C5)',FALSE),
 ('M13_cites','Gobernanza CITES (C6)',FALSE),
 ('qda_import','Importación REFI-QDA (Nivel 1b)',FALSE),
 ('lex_import','Importación léxica (Nivel 1b)',FALSE),
 ('communities','Comunidades del grafo (Nivel 2)',FALSE),
 ('chat_v4','Conversaciones versionadas chat.*',FALSE),
 ('c7_domain_ready','Tipo de artefacto C7 listo',FALSE),
 ('M4_sesigue','Seguimiento externo SESIGUE (M4, SSGC/PCM)',FALSE);

-- ---------- 4.7 DM-11: dominios nuevos en ctx.cat_dominios ----------
INSERT INTO ctx.cat_dominios (id, codigo) VALUES
 (6,'mype_financiero'),
 (7,'hidrico_sanitario'),
 (8,'comercio_cites')
ON CONFLICT (id) DO NOTHING;

-- Variables C4/C5/C6 (13) — [§8.6 de v9]
INSERT INTO ctx.cat_variables (id, codigo, nombre, dominio_id, ambito, periodicidad_dias, ttl_frescura_dias) VALUES
 (25,'MORA_PAGO_PROMEDIO','Días de mora promedio en NEC',6,'nacional',7,15),
 (26,'CONCENTRACION_LOTES_HHI','Índice Herfindahl de concentración de lotes',6,'nacional',30,45),
 (27,'TASA_INTERES_SBS','Tasa de interés promedio MYPE (SBS)',6,'nacional',30,45),
 (28,'INSPECCION_CITE_DIAS','Días entre inspección CITE y conformidad',6,'nacional',7,15),
 (29,'OXIGENO_DISUELTO','Oxígeno disuelto (mg/L)',7,'lugar',7,15),
 (30,'PH_AGUA','pH del agua',7,'lugar',7,15),
 (31,'METALES_PESADOS','Metales pesados (ppm)',7,'lugar',30,45),
 (32,'CAUDAL_RIO','Caudal del río (m³/s)',7,'lugar',1,7),
 (33,'BIOMASA_TRUCHA_PERDIDA','Biomasa de trucha perdida (kg)',7,'lugar',30,45),
 (34,'PREVALENCIA_PATOGENO','Prevalencia de patógenos (%)',7,'lugar',30,45),
 (35,'EXPORTACION_TIBURON','Exportación de tiburón (kg)',8,'nacional',30,45),
 (36,'CUOTA_CITES_CONSUMIDA','Cuota CITES consumida (%)',8,'nacional',7,15),
 (37,'TRAZABILIDAD_QR_VALIDA','Trazabilidad QR validada (%)',8,'nacional',7,15)
ON CONFLICT (id) DO NOTHING;

-- Variables C1/C3 (representativas; full seed en scripts/seed_v9_full.sql)
INSERT INTO ctx.cat_variables (id, codigo, nombre, dominio_id, ambito, periodicidad_dias, ttl_frescura_dias) VALUES
 (1,'ICEN_N12','Índice Costero El Niño (Niño 1+2)',1,'nacional',30,35),
 (4,'PRECIO_MAYORISTA','Precio mayorista (S/ por kg)',2,'distrito',1,7),
 (6,'CPUE_POTA_PUERTO','CPUE de pota por puerto',1,'lugar',7,15),
 (12,'FLOTA_SISESAT','Embarcaciones con SISESAT',4,'nacional',30,45),
 (15,'DISTANCIA_MINIMA_SISMICA','Distancia mínima sísmica-pesca',4,'zona_maritima',7,15),
 (16,'FRECUENCIA_DISPARO_SISMICO','Frecuencia de disparos sísmicos',4,'zona_maritima',7,15)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- §5. avisa.raw_ingest.v2 [§4.bis.1]
-- =====================================================================

ALTER TABLE avisa.raw_ingest ALTER COLUMN fuente TYPE VARCHAR(30);
ALTER TABLE avisa.raw_ingest DROP CONSTRAINT raw_ingest_fuente_check;
ALTER TABLE avisa.raw_ingest ADD CONSTRAINT raw_ingest_fuente_check
    CHECK (fuente IN ('whatsapp','acta_pdf','audio','email',
                      'sunat_comprobante','vuce_permiso','ana_siagua',
                      'sanipes_pcr','citered_acta','dgsfs_tiburon'));
ALTER TABLE avisa.raw_ingest
    ADD COLUMN tipo_registro VARCHAR(20) NOT NULL DEFAULT 'evento'
        CHECK (tipo_registro IN ('evento','serie','permiso','comprobante','inspeccion','diagnostico')),
    ADD COLUMN policy_snapshot_id UUID REFERENCES policy.snapshot(id);

-- Registry de schemas versionados
CREATE TABLE config.schema_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(40) NOT NULL,
    version VARCHAR(20) NOT NULL,
    esquema_json JSONB NOT NULL,
    vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
    vigente_hasta DATE,
    UNIQUE (codigo, version)
);

-- =====================================================================
-- §6. S-01 chat.* (§9.13) — 14 tablas
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS chat;

-- 6.1 chat.repositorio (sin FK a rama todavía; DEFERRABLE después)
CREATE TABLE chat.repositorio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(80) NOT NULL UNIQUE,
    caso_id UUID REFERENCES core.casos(id),
    sujeto_actor_uid UUID REFERENCES core.actores(actor_uid),
    territorio_lugar_id UUID REFERENCES territorio.lugares(id),
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('caso','actor','territorio','libre')),
    descripcion TEXT,
    default_branch_id UUID,   -- FK diferida más abajo
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    estado VARCHAR(15) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','archivado','eliminado')),
    creado_por UUID REFERENCES core.usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    archivado_en TIMESTAMPTZ
);
CREATE INDEX ix_repo_caso ON chat.repositorio(caso_id) WHERE caso_id IS NOT NULL;
CREATE INDEX ix_repo_actor ON chat.repositorio(sujeto_actor_uid) WHERE sujeto_actor_uid IS NOT NULL;
CREATE INDEX ix_repo_tipo_estado ON chat.repositorio(tipo, estado);

-- 6.2 chat.commit
CREATE TABLE chat.commit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repositorio_id UUID NOT NULL REFERENCES chat.repositorio(id),
    hash CHAR(64) NOT NULL UNIQUE,
    parent_ids UUID[] NOT NULL DEFAULT '{}',
    tree_hash CHAR(64) NOT NULL DEFAULT repeat('0', 64),
    autor_tipo VARCHAR(10) NOT NULL CHECK (autor_tipo IN ('usuario','agente','sistema')),
    autor_id UUID NOT NULL,
    mensaje TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    modelo_card_id UUID NOT NULL REFERENCES model.model_card(id),
    parametros_snapshot JSONB NOT NULL DEFAULT '{}',
    parametros_hash CHAR(64) NOT NULL DEFAULT repeat('0', 64),
    librerias_snapshot JSONB NOT NULL DEFAULT '[]',
    librerias_hash CHAR(64) NOT NULL DEFAULT repeat('0', 64),
    aplicacion_id UUID NOT NULL REFERENCES config.aplicacion(id),
    politica_snapshot_id UUID NOT NULL REFERENCES policy.snapshot(id),
    artefacto_id UUID REFERENCES domain.artefacto(id),
    es_merge BOOLEAN NOT NULL DEFAULT FALSE,
    es_revert BOOLEAN NOT NULL DEFAULT FALSE,
    es_amend BOOLEAN NOT NULL DEFAULT FALSE,
    es_cherry_pick BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    origen_dato VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
        CHECK (origen_dato IN ('MANUAL','WORKFLOW','AGENTE','IMPORT')),
    CHECK (cardinality(parent_ids) <= 2),
    CHECK (NOT es_merge OR cardinality(parent_ids) = 2),
    CHECK (NOT es_amend OR cardinality(parent_ids) = 1)
);
CREATE INDEX ix_commit_repo_ts ON chat.commit(repositorio_id, timestamp DESC);
CREATE INDEX ix_commit_parents ON chat.commit USING GIN (parent_ids);
CREATE INDEX ix_commit_politica ON chat.commit(politica_snapshot_id);
CREATE INDEX ix_commit_modelo ON chat.commit(modelo_card_id);

-- 6.3 chat.blob
CREATE TABLE chat.blob (
    hash CHAR(64) PRIMARY KEY,
    contenido TEXT,
    contenido_binario BYTEA,
    tipo_contenido VARCHAR(80),
    tamano_bytes BIGINT NOT NULL CHECK (tamano_bytes >= 0),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    ref_count INT NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
    CHECK (num_nonnulls(contenido, contenido_binario) = 1)
);
CREATE INDEX ix_blob_gc ON chat.blob(ref_count) WHERE ref_count = 0;

-- 6.4 chat.turno
CREATE TABLE chat.turno (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commit_id UUID NOT NULL REFERENCES chat.commit(id) ON DELETE CASCADE,
    orden INT NOT NULL CHECK (orden >= 0),
    rol VARCHAR(10) NOT NULL CHECK (rol IN ('user','assistant','tool','system')),
    contenido TEXT,
    contenido_json JSONB,
    hash CHAR(64) NOT NULL,
    blob_ref CHAR(64) REFERENCES chat.blob(hash),
    tool_calls JSONB,
    tokens_in INT,
    tokens_out INT,
    latencia_ms INT,
    modelo_id UUID REFERENCES model.model_card(id),
    agente VARCHAR(30) CHECK (agente IS NULL OR agente IN ('A1','A2','A3','critic')),
    llm_call_id UUID,
    politica_snapshot_id UUID REFERENCES policy.snapshot(id),
    atributos JSONB,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    UNIQUE (commit_id, orden),
    CHECK (rol <> 'assistant' OR (modelo_id IS NOT NULL AND agente IS NOT NULL)),
    CHECK (rol = 'assistant' OR modelo_id IS NULL)
);
CREATE INDEX ix_turno_hash ON chat.turno(hash);
CREATE INDEX ix_turno_llm_call ON chat.turno(llm_call_id) WHERE llm_call_id IS NOT NULL;
CREATE INDEX ix_turno_agente ON chat.turno(agente) WHERE agente IS NOT NULL;

-- 6.5 chat.rama
CREATE TABLE chat.rama (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repositorio_id UUID NOT NULL REFERENCES chat.repositorio(id),
    nombre VARCHAR(120) NOT NULL,
    head_commit_id UUID NOT NULL REFERENCES chat.commit(id),
    rama_padre_id UUID REFERENCES chat.rama(id),
    protegida BOOLEAN NOT NULL DEFAULT FALSE,
    descripcion TEXT,
    creado_por UUID REFERENCES core.usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado VARCHAR(15) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','archivada')),
    UNIQUE (repositorio_id, nombre)
);
CREATE INDEX ix_rama_head ON chat.rama(head_commit_id);

-- 6.5.bis FK circular (repositorio.default_branch_id → rama) DEFERRABLE
ALTER TABLE chat.repositorio ADD CONSTRAINT fk_repo_default_branch
    FOREIGN KEY (default_branch_id) REFERENCES chat.rama(id)
    DEFERRABLE INITIALLY DEFERRED;

-- 6.6 chat.ref
CREATE TABLE chat.ref (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repositorio_id UUID NOT NULL REFERENCES chat.repositorio(id),
    nombre VARCHAR(255) NOT NULL,
    tipo VARCHAR(15) NOT NULL CHECK (tipo IN ('branch','tag','head','remote')),
    commit_id UUID NOT NULL REFERENCES chat.commit(id),
    tag_message TEXT,
    tag_autor_id UUID REFERENCES core.usuarios(id),
    tag_fecha TIMESTAMPTZ,
    vigente BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (repositorio_id, nombre),
    CHECK (tipo <> 'tag' OR tag_message IS NULL OR (tag_autor_id IS NOT NULL AND tag_fecha IS NOT NULL))
);
CREATE INDEX ix_ref_tipo ON chat.ref(tipo);
CREATE INDEX ix_ref_commit ON chat.ref(commit_id);

-- 6.7 chat.merge
CREATE TABLE chat.merge (
    commit_id UUID PRIMARY KEY REFERENCES chat.commit(id),
    rama_origen_id UUID NOT NULL REFERENCES chat.rama(id),
    rama_destino_id UUID NOT NULL REFERENCES chat.rama(id),
    merge_base_id UUID NOT NULL REFERENCES chat.commit(id),
    estrategia VARCHAR(15) NOT NULL CHECK (estrategia IN ('ort','recursive','ours','theirs')),
    conflictos_resueltos INT NOT NULL DEFAULT 0 CHECK (conflictos_resueltos >= 0),
    conflictos_json JSONB
);

-- 6.8 chat.diff
CREATE TABLE chat.diff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commit_a_id UUID NOT NULL REFERENCES chat.commit(id),
    commit_b_id UUID NOT NULL REFERENCES chat.commit(id),
    tipo_diff VARCHAR(30) NOT NULL CHECK (tipo_diff IN
        ('turnos_agregados','turnos_modificados','turnos_eliminados','contexto_cambiado',
         'modelo_cambiado','parametros_cambiados','librerias_cambiadas','politica_cambiada','mixto')),
    detalle_json JSONB NOT NULL,
    calculado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (commit_a_id, commit_b_id, tipo_diff)
);

-- 6.9 chat.blame
CREATE TABLE chat.blame (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commit_id UUID NOT NULL REFERENCES chat.commit(id),
    turno_id UUID NOT NULL REFERENCES chat.turno(id),
    afirmacion_hash CHAR(64) NOT NULL,
    origen_turno_id UUID NOT NULL REFERENCES chat.turno(id),
    origen_commit_id UUID NOT NULL REFERENCES chat.commit(id),
    autor_original UUID,
    timestamp_original TIMESTAMPTZ,
    es_herencia BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX ix_blame_commit ON chat.blame(commit_id);
CREATE INDEX ix_blame_turno ON chat.blame(turno_id);
CREATE INDEX ix_blame_afirm ON chat.blame(afirmacion_hash);

-- 6.10 chat.reflog (append-only)
CREATE TABLE chat.reflog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repositorio_id UUID NOT NULL REFERENCES chat.repositorio(id),
    ref VARCHAR(255) NOT NULL,
    old_commit_id UUID,
    new_commit_id UUID NOT NULL,
    autor_id UUID NOT NULL REFERENCES core.usuarios(id),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    mensaje TEXT,
    operacion VARCHAR(20) NOT NULL CHECK (operacion IN
        ('commit','checkout','merge','revert','reset','tag','cherry_pick','stash'))
);
CREATE INDEX ix_reflog_repo_ts ON chat.reflog(repositorio_id, timestamp DESC);
CREATE INDEX ix_reflog_ref ON chat.reflog(ref);

CREATE OR REPLACE FUNCTION chat.reflog_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE','DELETE') THEN
        RAISE EXCEPTION 'chat.reflog es append-only';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_reflog_guard
    BEFORE INSERT OR UPDATE OR DELETE ON chat.reflog
    FOR EACH ROW EXECUTE FUNCTION chat.reflog_guard();

-- 6.11 chat.stash
CREATE TABLE chat.stash (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repositorio_id UUID NOT NULL REFERENCES chat.repositorio(id),
    mensaje TEXT NOT NULL,
    tree_hash CHAR(64) NOT NULL,
    turnos_json JSONB NOT NULL,
    rama_origen_id UUID NOT NULL REFERENCES chat.rama(id),
    creado_por UUID NOT NULL REFERENCES core.usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    aplicado BOOLEAN NOT NULL DEFAULT FALSE,
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel)
);

-- 6.12 chat.remote
CREATE TABLE chat.remote (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repositorio_id UUID NOT NULL REFERENCES chat.repositorio(id),
    nombre VARCHAR(80) NOT NULL,
    url VARCHAR(500) NOT NULL,
    tipo VARCHAR(15) NOT NULL CHECK (tipo IN ('interno','pcm','externo')),
    credencial_ref VARCHAR(100),
    ultima_sincronizacion TIMESTAMPTZ,
    estado VARCHAR(15) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','pausado','error')),
    nivel_clasificacion SMALLINT NOT NULL DEFAULT 2 REFERENCES core.cat_clasificacion(nivel),
    UNIQUE (repositorio_id, nombre)
);

-- 6.13 chat.cherry_pick
CREATE TABLE chat.cherry_pick (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commit_origen_id UUID NOT NULL REFERENCES chat.commit(id),
    commit_destino_id UUID NOT NULL REFERENCES chat.commit(id),
    rama_destino_id UUID NOT NULL REFERENCES chat.rama(id),
    aplicado_por UUID NOT NULL REFERENCES core.usuarios(id),
    aplicado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado VARCHAR(15) NOT NULL DEFAULT 'aplicado' CHECK (estado IN ('aplicado','conflicto','revertido')),
    conflictos_json JSONB
);

-- 6.14 chat.hook
CREATE TABLE chat.hook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repositorio_id UUID NOT NULL REFERENCES chat.repositorio(id),
    evento VARCHAR(20) NOT NULL CHECK (evento IN
        ('pre_commit','post_commit','pre_merge','post_merge','pre_push','post_push')),
    codigo VARCHAR(80) NOT NULL,
    lenguaje VARCHAR(20) NOT NULL CHECK (lenguaje IN ('sql','python','http')),
    contenido TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    orden INT NOT NULL DEFAULT 0,
    UNIQUE (repositorio_id, evento, codigo)
);
CREATE INDEX ix_hook_activo ON chat.hook(repositorio_id, evento) WHERE activo = TRUE;

-- ---------- 6.15 Triggers de hash y snapshot ----------
CREATE OR REPLACE FUNCTION chat.turno_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.hash := encode(
        sha256(convert_to(
            COALESCE(NEW.rol,'') || '|' || COALESCE(NEW.contenido,'') || '|'
            || COALESCE(NEW.contenido_json::text,'') || '|'
            || COALESCE(NEW.modelo_id::text,'') || '|'
            || to_char(COALESCE(NEW.ts, now()), 'YYYYMMDDHH24MISSUS'),
        'UTF8')),
        'hex');
    RETURN NEW;
END $$;
-- (la columna ts no existe en el DDL actual; usar now() o añadir ts)
-- Simplificado: usar el timestamp del commit (ya está en la tabla padre).

CREATE OR REPLACE FUNCTION chat.commit_snapshot_y_hash() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_tree CHAR(64);
    v_parents TEXT;
BEGIN
    -- Snapshot de parámetros y librerías vigentes al commit (si no vienen)
    IF NEW.parametros_snapshot IS NULL OR NEW.parametros_snapshot = '{}'::jsonb THEN
        SELECT COALESCE(jsonb_object_agg(codigo, valor), '{}'::jsonb)
          INTO NEW.parametros_snapshot
          FROM config.parametro WHERE valid_to IS NULL;
    END IF;
    NEW.parametros_hash := encode(sha256(convert_to(NEW.parametros_snapshot::text, 'UTF8')), 'hex');

    IF NEW.librerias_snapshot IS NULL OR NEW.librerias_snapshot = '[]'::jsonb THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('codigo', codigo, 'version', version)), '[]'::jsonb)
          INTO NEW.librerias_snapshot
          FROM config.libreria WHERE estado = 'activa';
    END IF;
    NEW.librerias_hash := encode(sha256(convert_to(NEW.librerias_snapshot::text, 'UTF8')), 'hex');

    -- tree_hash desde los turnos ya insertados (si es UPDATE, no recalcula)
    SELECT COALESCE(
        encode(sha256(convert_to(string_agg(hash, '' ORDER BY orden), 'UTF8')), 'hex'),
        encode(sha256(convert_to('', 'UTF8')), 'hex'))
      INTO v_tree
      FROM chat.turno WHERE commit_id = NEW.id;
    NEW.tree_hash := v_tree;

    -- hash del commit
    SELECT string_agg(hash, '' ORDER BY hash) INTO v_parents
      FROM chat.commit WHERE id = ANY(NEW.parent_ids);

    NEW.hash := encode(sha256(convert_to(
        COALESCE(v_parents,'') || NEW.tree_hash
        || NEW.autor_tipo || COALESCE(NEW.autor_id::text,'')
        || to_char(NEW.timestamp, 'YYYYMMDDHH24MISSUS')
        || NEW.mensaje
        || COALESCE(NEW.modelo_card_id::text,'')
        || NEW.parametros_hash || NEW.librerias_hash
        || COALESCE(NEW.politica_snapshot_id::text,''),
        'UTF8')), 'hex');
    RETURN NEW;
END $$;
-- Se deja sin CREATE TRIGGER en v9: la aplicación setea el hash.
-- Si se quiere trigger, ejecutar:
--   CREATE TRIGGER trg_commit_snapshot BEFORE INSERT ON chat.commit
--     FOR EACH ROW EXECUTE FUNCTION chat.commit_snapshot_y_hash();

CREATE OR REPLACE FUNCTION chat.blob_ref_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.blob_ref IS NOT NULL THEN
        UPDATE chat.blob SET ref_count = ref_count + 1 WHERE hash = NEW.blob_ref;
    ELSIF TG_OP = 'DELETE' AND OLD.blob_ref IS NOT NULL THEN
        UPDATE chat.blob SET ref_count = ref_count - 1 WHERE hash = OLD.blob_ref;
    ELSIF TG_OP = 'UPDATE' AND OLD.blob_ref IS DISTINCT FROM NEW.blob_ref THEN
        IF OLD.blob_ref IS NOT NULL THEN UPDATE chat.blob SET ref_count = ref_count - 1 WHERE hash = OLD.blob_ref; END IF;
        IF NEW.blob_ref IS NOT NULL THEN UPDATE chat.blob SET ref_count = ref_count + 1 WHERE hash = NEW.blob_ref; END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_blob_ref_count
    AFTER INSERT OR UPDATE OR DELETE ON chat.turno
    FOR EACH ROW EXECUTE FUNCTION chat.blob_ref_count();

-- ---------- 6.16 chat.* como artefacto de dominio [§3.quater S-02] ----------
INSERT INTO domain.tipo_artefacto (codigo, dominio, esquema_json, sujeto_requerido, requiere_caso)
VALUES (
    'conversacion_ia',
    'chat',
    '{"type":"object","properties":{"chat_repositorio_id":{"type":"string","format":"uuid"},"estado":{"enum":["activo","archivado"]}},"required":["chat_repositorio_id"]}'::jsonb,
    'ninguno',
    false
)
ON CONFLICT (codigo, version) DO NOTHING;

-- ---------- 6.17 Enlaces con el corpus ----------
ALTER TABLE core.output_contracts
    ADD COLUMN chat_commit_id UUID REFERENCES chat.commit(id);

-- =====================================================================
-- §7. Agent config: prompt templates, A2 transitions, guardrail contracts
-- =====================================================================

-- ---------- 7.1 agent.plantilla_prompt [§9.8, §9.9] ----------
CREATE TABLE agent.plantilla_prompt (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(20) NOT NULL CHECK (codigo IN ('A1','A2','A3','critic')),
    version VARCHAR(20) NOT NULL,
    hash_prompt CHAR(64) NOT NULL,
    system_prompt TEXT NOT NULL,
    few_shot_json JSONB NOT NULL DEFAULT '[]',
    output_schema_id VARCHAR(60) NOT NULL,
    vigente_desde TIMESTAMPTZ NOT NULL DEFAULT now(),
    vigente_hasta TIMESTAMPTZ,
    supersedes_id UUID REFERENCES agent.plantilla_prompt(id),
    activo BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (codigo, version)
);
CREATE UNIQUE INDEX ux_plantilla_activa ON agent.plantilla_prompt(codigo) WHERE activo;

-- 4 plantillas iniciales (representativas; full seed en scripts/)
INSERT INTO agent.plantilla_prompt
    (codigo, version, hash_prompt, system_prompt, few_shot_json, output_schema_id, activo)
VALUES
 ('A1','v1.0.0', repeat('0',64),
  'Eres A1, extractor de información de la OAIPCS-PRODUCE. Recibes texto y devuelves JSON que valida contra avisa.raw_ingest.v2. No inventes: si un campo no está, no lo pongas.',
  '[]', 'avisa.raw_ingest.v2', TRUE),
 ('A2','v1.0.0', repeat('0',64),
  'Eres A2, generador de pautas. Produces pauta con 4 secciones: criterios, evidencia disponible, evidencia faltante, preguntas abiertas. No decidas por la persona.',
  '[]', 'pauta_a2.v1', TRUE),
 ('A3','v1.0.0', repeat('0',64),
  'Eres A3, sintetizador. Office View (JSON) o Minister View (≤200 palabras + 3 viñetas + 3 citas). Pie del lente obligatorio en Minister. Rótulo IA en ambas.',
  '[]', 'minister_view_v1', TRUE),
 ('critic','v1.0.0', repeat('0',64),
  'Eres el Critic. Evalúas 5 dimensiones (D1..D5) en escala 0-3. D1=0 o D2=0 es rechazo automático. Score ≥0.75 Office, ≥0.85 Minister.',
  '[]', 'critic_v1', TRUE);

-- ---------- 7.2 config.a2_transiciones [§9.6.bis] ----------
CREATE TABLE config.a2_transiciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estado_desde VARCHAR(30) NOT NULL,
    estado_hasta VARCHAR(30) NOT NULL,
    evento VARCHAR(40) NOT NULL,
    guard_sql TEXT,
    severidad VARCHAR(10) NOT NULL DEFAULT 'block' CHECK (severidad IN ('block','warn')),
    UNIQUE (estado_desde, estado_hasta, evento)
);
INSERT INTO config.a2_transiciones (estado_desde, estado_hasta, evento, guard_sql, severidad) VALUES
 ('inicio','aclaracion_pendiente','T-Q-01','pregunta IS NULL OR length(trim(pregunta))=0','block'),
 ('aclaracion_pendiente','recoleccion_contexto','T-Q-02',NULL,'block'),
 ('recoleccion_contexto','pauta_propuesta','T-Q-03',NULL,'block'),
 ('pauta_propuesta','decision_humana_pendiente','T-Q-04',NULL,'block'),
 ('decision_humana_pendiente','pauta_decidida','T-Q-05',NULL,'block'),
 -- NOTA DE CORRECCIÓN (validado en Postgres 16): la tabla original tenía dos filas
 -- con la misma clave (estado_desde, estado_hasta, evento) = (pauta_decidida, cerrada,
 -- T-Q-08) distinguidas solo por guard_sql, lo que viola el UNIQUE declarado. Se
 -- fusionan en una sola fila con el guard combinado (OR), que es equivalente.
 ('pauta_decidida','cerrada','T-Q-08',
  'decision IN (''rechazada'',''modificada'') OR (decision = ''aprobada'' AND producto_id IS NOT NULL)',
  'block'),
 ('pauta_decidida','reapertura','T-Q-07','decision = ''modificada'' AND evidencia_nueva = TRUE','block'),
 ('cualquier','explicacion_divergencia','T-Q-06',NULL,'warn'),
 ('explicacion_divergencia','pauta_decidida','T-Q-06',NULL,'block'),
 ('reapertura','pauta_propuesta','T-Q-07',NULL,'block');

-- ---------- 7.3 config.guardrail_contract [§16.4.bis] ----------
CREATE TABLE config.guardrail_contract (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guardrail VARCHAR(10) NOT NULL CHECK (guardrail IN
        ('G1','G2','G3','G4','G5','G6','G7','G8','G9','G10',
         'G11','G12','G13','G14','G15','G16','G17','G18',
         'G19','G20','G21','G22','G23','G24','G25')),
    input_dispara JSONB NOT NULL,
    input_no_dispara JSONB NOT NULL,
    output_esperado_dispara JSONB NOT NULL,
    output_esperado_no_dispara JSONB NOT NULL,
    severidad VARCHAR(10) NOT NULL CHECK (severidad IN ('block','warn')),
    UNIQUE (guardrail)
);
INSERT INTO config.guardrail_contract
    (guardrail, input_dispara, input_no_dispara, output_esperado_dispara, output_esperado_no_dispara, severidad)
VALUES
 ('G1',
  '{"fragmento_nivel":3,"usuario_nivel":2}',
  '{"fragmento_nivel":2,"usuario_nivel":2}',
  '{"ok":false,"code":"G1_PRIV","msg":"fragmento nivel 3 no visible a nivel 2","fix":{"excluir":"fragmento"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G2',
  '{"texto":"X causa Y","arista_causal":false}',
  '{"texto":"X se relaciona con Y","arista_causal":true}',
  '{"ok":false,"code":"G2_CAUSAL","msg":"afirmación causal sin respaldo","fix":{"reformular":"X se relaciona con Y"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G3',
  '{"variable":"ICEN_N12","dias_desde_obs":40,"ttl":35}',
  '{"variable":"ICEN_N12","dias_desde_obs":10,"ttl":35}',
  '{"ok":false,"code":"G3_FRESH","msg":"variable ICEN_N12 desactualizada (40>35 días)","fix":{"rotular":"desactualizado"}}',
  '{"ok":true,"code":null,"msg":null}',
  'warn'),
 ('G4',
  '{"variable_sin_fuente":true}',
  '{"variable_con_fuente":true}',
  '{"ok":false,"code":"G4_FUENTE","msg":"variable sin fuente autorizada","fix":{"agregar":"ctx.variable_fuentes"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G5',
  '{"estado":"en_proceso","catalogo":["pendiente","aprobado"]}',
  '{"estado":"pendiente","catalogo":["pendiente","aprobado"]}',
  '{"ok":false,"code":"G5_TAXO","msg":"estado fuera de catálogo","fix":{"reemplazar":"pendiente"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G6',
  '{"tipo":"forecast","ic_presente":false}',
  '{"tipo":"forecast","ic_presente":true,"narrativa_presente":true}',
  '{"ok":false,"code":"G6_PREV","msg":"predicción sin IC ni narrativa","fix":{"agregar":"IC + narrativa"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G7',
  '{"proximo_review":"2026-01-01","hoy":"2026-10-27"}',
  '{"proximo_review":"2027-01-31","hoy":"2026-10-27"}',
  '{"ok":false,"code":"G7_MODEL","msg":"model card vencida","fix":{"marcar":"no usar en decisiones"}}',
  '{"ok":true,"code":null,"msg":null}',
  'warn'),
 ('G8',
  '{"actores_caleta":15,"dato_individual":true}',
  '{"actores_caleta":25,"dato_individual":true}',
  '{"ok":false,"code":"G8_COM","msg":"caleta con <20 actores, agregar","fix":{"agregar":"a distrito"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G9',
  '{"escritura_externa":true}',
  '{"api_autorizada":true}',
  '{"ok":false,"code":"G9_SOB","msg":"escritura a base externa no autorizada","fix":{"usar":"core.integraciones"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G10',
  '{"actor":"X","marcado":"criminal","sentencia_firme":false}',
  '{"actor":"X","marcado":"bajo_investigacion"}',
  '{"ok":false,"code":"G10_INOC","msg":"marcar criminal sin sentencia","fix":{"reformular":"bajo investigación"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G11',
  '{"campo":"genero","consentimiento":false}',
  '{"campo":"genero","consentimiento":true}',
  '{"ok":false,"code":"G11_CONS","msg":"campo sensible sin consentimiento","fix":{"omitir":"campo"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G12',
  '{"vista_publica":true,"min_grupo":3}',
  '{"vista_publica":true,"min_grupo":10}',
  '{"ok":false,"code":"G12_ANON","msg":"vista pública con grupo <5","fix":{"agregar":"grupo"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G13',
  '{"minister_view":true,"pie_lente":null}',
  '{"minister_view":true,"pie_lente":"P-FEN-02, P-FEN-03"}',
  '{"ok":false,"code":"G13_LENTE","msg":"Minister View sin pie","fix":{"agregar":"pie"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G14',
  '{"proxy":true,"incertidumbre":"alta","minister_view":true}',
  '{"proxy":true,"incertidumbre":"media","minister_view":true,"validado":true}',
  '{"ok":false,"code":"G14_PROXY","msg":"proxy alta incertidumbre no entra a Minister","fix":{"rechazar":"de Minister"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G15',
  '{"norma_citada":"Ley N.° 99999","en_registro":false}',
  '{"norma_citada":"Ley N.° 31749","en_registro":true}',
  '{"ok":false,"code":"G15_NORMA","msg":"norma no resuelve contra registro","fix":{"quitar":"cita"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G16',
  '{"hhi":0.30,"gini":0.72}',
  '{"hhi":0.15,"gini":0.45}',
  '{"ok":false,"code":"G16_CONC","msg":"concentración alta","fix":{"rotular":"concentración alta"}}',
  '{"ok":true,"code":null,"msg":null}',
  'warn'),
 ('G17',
  '{"od_mg_l":3.5,"metales_ppm":0.02}',
  '{"od_mg_l":6.0,"metales_ppm":0.02}',
  '{"ok":false,"code":"G17_ECA","msg":"OD bajo umbral ECA","fix":{"rotular":"excede ECA"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block'),
 ('G18',
  '{"estado_permiso":"solicitado","qr_validada":false}',
  '{"estado_permiso":"emitido","qr_validada":true}',
  '{"ok":false,"code":"G18_CITES","msg":"permiso CITES no emitido o QR no validado","fix":{"rotular":"permiso pendiente"}}',
  '{"ok":true,"code":null,"msg":null}',
  'block');

-- NOTA (parche DC): el CHECK admite ya hasta G25, pero las filas de contrato de
-- G19–G25 NO están sembradas arriba: sus reason codes están definidos en
-- v10 §16.1.quater (G19–G22) y §16.1.quinquies (G23–G25) y su seed queda pendiente.
-- Ampliar el dominio del CHECK sin sembrar las filas es seguro (no valida nada por sí solo),
-- pero ningún guardrail nuevo se ejecuta hasta que su fila exista.

-- =====================================================================
-- §8. Seeds consolidados (representativos; full en scripts/seed_v9_full.sql)
-- =====================================================================

-- ---------- 8.1 policy.regla (base legal C1–C6, clase N) ----------
-- NOTAS DE CORRECCIÓN (validado en Postgres 16 contra el policy.* REAL de v8.3,
-- no contra el stub mínimo standalone de v8.4 donde se escribió este seed):
--  1. policy.cat_tipos_regla en v8.3 NO es "tipo de fuente" (eso ya es la columna
--     tipo_fuente='norma'); es el EFECTO que la regla tiene sobre el sistema
--     (prioridad temática, prioridad territorial, vocabulario, indicador
--     requerido, restricción). Las 10 normas de abajo restringen comportamiento,
--     así que tipo_regla_id=5 ('restriccion', requiere clave 'condicion').
--  2. regla_check2 exige fuente_documento_id cuando clase<>'L' y tipo_fuente
--     <> 'hipotesis_analitica' (10 normas → 10 documentos fuente).
--  3. Compras a MYPErú NO se crea con "D.Leg. 1192" (verificado por búsqueda
--     web durante la redacción de v9): es el D.Leg. N.° 1414, reglamentado por
--     el D.S. N.° 004-2019-PRODUCE; el programa en sí lo crea el D.S. N.°
--     013-2021-PRODUCE. Se corrige aquí.
INSERT INTO kag.documento_fuente (id, titulo, tipo, nivel_clasificacion) VALUES
 ('00000000-0000-0000-00a1-000000000001','D.S. 003-2025-PRODUCE — ROP de la pota','normativo',1),
 ('00000000-0000-0000-00a1-000000000002','R.M. 00348-2026-PRODUCE — Estrategia adaptativa pota','normativo',1),
 ('00000000-0000-0000-00a1-000000000003','D.S. 012-2026-PRODUCE — Emergencia pesquera El Niño','normativo',1),
 ('00000000-0000-0000-00a1-000000000004','D.S. 013-2024-PRODUCE — Reglamento Ley 31749','normativo',1),
 ('00000000-0000-0000-00a1-000000000005','D.Leg. 1414 y D.S. 004-2019-PRODUCE / D.S. 013-2021-PRODUCE — Compras a MYPErú','normativo',1),
 ('00000000-0000-0000-00a1-000000000006','TUO de la Ley N.° 30225 — Contrataciones del Estado','normativo',1),
 ('00000000-0000-0000-00a1-000000000007','D.S. 004-2017-MINAM — ECA para Agua','normativo',1),
 ('00000000-0000-0000-00a1-000000000008','D.S. 003-2024-PRODUCE — Reglamento de acuicultura','normativo',1),
 ('00000000-0000-0000-00a1-000000000009','Convención CITES (1973), Apéndices I-III','normativo',1),
 ('00000000-0000-0000-00a1-00000000000a','PAN Tiburones — Dictamen de Extracción No Perjudicial (IMARPE)','normativo',1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO policy.regla
    (codigo, clase, tipo_regla_id, titulo, texto, parametros, alcance, estado, tipo_fuente,
     fuente_documento_id, disparador_vencimiento_fecha)
VALUES
 ('N-ROP-01','N',5,'ROP vigente de la pota',
  'D.S. 003-2025-PRODUCE reglamenta el ordenamiento de la pota.',
  '{"norma":"D.S. 003-2025-PRODUCE","condicion":"operaciones de pesca de pota sujetas al ROP vigente"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000001',NULL),
 ('N-ROP-02','N',5,'Estrategia adaptativa de pota 2026',
  'R.M. 00348-2026-PRODUCE implementa estrategia adaptativa con pesca exploratoria durante El Niño 2026-27.',
  '{"norma":"R.M. 00348-2026-PRODUCE","condicion":"pesca exploratoria durante El Niño 2026-27"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000002','2026-12-31'),
 ('N-FEN-01','N',5,'Emergencia pesquera por El Niño',
  'DS N.° 012-2026-PRODUCE declara emergencia por 120 días.',
  '{"norma":"DS 012-2026-PRODUCE","condicion":"emergencia pesquera declarada, vigente 120 días"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000003','2026-12-21'),
 ('N-31749-01','N',5,'Reglamento de la Ley 31749',
  'DS N.° 013-2024-PRODUCE reglamenta la Ley 31749 (franja de cinco millas).',
  '{"norma":"DS 013-2024-PRODUCE","condicion":"restricción de pesca industrial en la franja de 5 millas"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000004',NULL),
 ('N-MYPE-01','N',5,'Compras a MYPErú',
  'D.Leg. N.° 1414, reglamentado por el D.S. N.° 004-2019-PRODUCE; el Programa Nacional '
  '"Compras a MYPErú" lo crea el D.S. N.° 013-2021-PRODUCE (corrección de v9: v8.3/C4-C6 '
  'citaban "D.Leg. 1192", verificado como incorrecto).',
  '{"norma":"D.Leg. 1414; D.S. 004-2019-PRODUCE; D.S. 013-2021-PRODUCE","condicion":"adjudicación de lotes a MYPE vía NEC"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000005',NULL),
 ('N-MYPE-02','N',5,'Contrataciones del Estado',
  'TUO de la Ley N.° 30225 regula las contrataciones.',
  '{"norma":"Ley 30225","condicion":"contrataciones públicas sujetas al TUO"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000006',NULL),
 ('N-ECA-01','N',5,'ECA para agua',
  'D.S. N.° 004-2017-MINAM fija umbrales de OD, pH y metales.',
  '{"norma":"DS 004-2017-MINAM","condicion":"OD >= 4.0 mg/L, metales <= 0.05 ppm","od_min":4.0,"metales_max_ppm":0.05}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000007',NULL),
 ('N-ACUICULTURA-01','N',5,'Reglamento de acuicultura',
  'D.S. N.° 003-2024-PRODUCE regula el ordenamiento acuícola.',
  '{"norma":"DS 003-2024-PRODUCE","condicion":"operación de piscigranjas sujeta al reglamento de acuicultura"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000008',NULL),
 ('N-CITES-01','N',5,'Convención CITES',
  'Los Apéndices I, II y III regulan el comercio internacional de especies amenazadas.',
  '{"norma":"CITES","condicion":"exportación de especies en Apéndice II sujeta a permiso"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-000000000009',NULL),
 ('N-DENP-01','N',5,'Dictamen de Extracción No Perjudicial',
  'El IMARPE emite DENP previo al permiso CITES.',
  '{"norma":"PAN Tiburones","condicion":"exportación de tiburón CITES requiere DENP previo"}'::jsonb,
  'ordenamiento','vigente','norma','00000000-0000-0000-00a1-00000000000a',NULL)
ON CONFLICT DO NOTHING;

-- ---------- 8.2 config.parametro (parámetros de guardrails) ----------
INSERT INTO config.parametro (codigo, valor, tipo, descripcion)
VALUES
 ('IECP.umbral_rojo','0.70'::jsonb,'numero','IECP: umbral de rojo'),
 ('IECP.umbral_ambar','0.40'::jsonb,'numero','IECP: umbral de ámbar'),
 ('G16.hhi_max','0.25'::jsonb,'numero','G16: HHI máximo tolerado'),
 ('G16.gini_max','0.70'::jsonb,'numero','G16: Gini máximo tolerado'),
 ('G17.od_min','4.0'::jsonb,'numero','G17: OD mínimo (mg/L, ECA)'),
 ('G17.metales_max_ppm','0.05'::jsonb,'numero','G17: metales máximos (ppm, ECA)'),
 ('G18.cuota_max_pct','0.90'::jsonb,'numero','G18: cuota máxima antes de bloquear'),
 ('CITES.cuota_alerta_pct','0.80'::jsonb,'numero','CITES: alerta a 80% de cuota'),
 ('IRSAM.umbral_rojo','10'::jsonb,'numero','IRSAM: eventos+convocatorias para rojo'),
 ('IRSAM.umbral_ambar','5'::jsonb,'numero','IRSAM: eventos+convocatorias para ámbar'),
 ('critic.office_sample_pct','10'::jsonb,'numero','Critic: % muestreo Office View'),
 ('drift.embedding_coseno_max','0.15'::jsonb,'numero','Drift: coseno máximo'),
 ('drift.grafo_centralidad_max','0.20'::jsonb,'numero','Drift: cambio de centralidad máximo'),
 ('drift.mype_hhi_max','0.05'::jsonb,'numero','Drift: HHI mensual'),
 ('drift.hidrico_od_max','0.5'::jsonb,'numero','Drift: OD mensual'),
 ('drift.cites_cuota_max','0.10'::jsonb,'numero','Drift: cuota consumida mensual')
ON CONFLICT (codigo) WHERE valid_to IS NULL DO NOTHING;

-- ---------- 8.3 model.model_card (12 tarjetas: 8 de pronóstico/alerta + 4 de gobierno de agentes LLM) ----------
-- NOTA DE CORRECCIÓN (validado en Postgres 16): config.aplicacion exige
-- modelo_card_id cuando tipo='agente' y estado='activa'; model.model_card
-- referencia aplicacion_id. Para romper el ciclo sin FKs DEFERRABLE (que el
-- DDL probado de v8.4 no declaró así), las aplicaciones se insertan primero
-- como 'propuesta' (el CHECK solo exige modelo_card_id para 'activa'), luego
-- se insertan las model_card (incluidas 4 de tipo 'llm' que faltaban — sin
-- ellas A1/A2/A3/critic no tienen qué modelo activar), y al final se
-- actualizan ambos lados a su estado real en una sola transacción implícita
-- del script. IATT también tenía libreria_id NULL con estado 'activo', lo
-- que viola chk_model_card_activo_completo; se le asigna statsmodels (el
-- umbral de distancia+pendiente igual se calcula con esa librería).
INSERT INTO config.libreria (codigo, nombre, version, tipo, licencia)
VALUES
 ('statsmodels','statsmodels','0.14','stats','BSD-3'),
 ('scikit_learn','scikit-learn','1.4','ml','BSD-3'),
 ('bge_m3','BGE-M3','1.0','embedding','MIT'),
 ('bge_reranker','BGE reranker','2.3','reranker','MIT'),
 ('spacy_es','spaCy es','3.7','nlp','MIT'),
 ('whisper','Whisper','small','transcripcion','MIT')
ON CONFLICT (codigo, version) DO NOTHING;

INSERT INTO config.aplicacion (codigo, nombre, tipo, estado, libreria_ids)
VALUES
 ('A1_extractor','A1 Extractor','agente','propuesta', ARRAY(SELECT id FROM config.libreria WHERE codigo='spacy_es')),
 ('A2_pautas','A2 Pautas','agente','propuesta', ARRAY(SELECT id FROM config.libreria WHERE codigo='bge_m3')),
 ('A3_sintetizador','A3 Sintetizador','agente','propuesta', ARRAY(SELECT id FROM config.libreria WHERE codigo='bge_m3')),
 ('critic','Critic','agente','propuesta', ARRAY(SELECT id FROM config.libreria WHERE codigo='bge_m3'))
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO model.model_card
    (codigo, version, tipo_modelo, libreria_id, aplicacion_id, proposito, estado, reviewer, proximo_review)
VALUES
 ('extractor_base','1.0','llm',
  (SELECT id FROM config.libreria WHERE codigo='spacy_es'),
  (SELECT id FROM config.aplicacion WHERE codigo='A1_extractor'),
  'LLM que gobierna A1 (extracción y estructuración de turnos)','activo','Model Reviewer','2027-01-31'),
 ('pautas_base','1.0','llm',
  (SELECT id FROM config.libreria WHERE codigo='bge_m3'),
  (SELECT id FROM config.aplicacion WHERE codigo='A2_pautas'),
  'LLM que gobierna A2 (generación de pautas conversacionales)','activo','Model Reviewer','2027-01-31'),
 ('sintetizador_base','1.0','llm',
  (SELECT id FROM config.libreria WHERE codigo='bge_m3'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'LLM que gobierna A3 (síntesis de Office View y Minister View)','activo','Model Reviewer','2027-01-31'),
 ('critic_base','1.0','llm',
  (SELECT id FROM config.libreria WHERE codigo='bge_m3'),
  (SELECT id FROM config.aplicacion WHERE codigo='critic'),
  'LLM que gobierna el Critic (rúbrica de 5 dimensiones)','activo','Model Reviewer','2027-01-31'),
 ('IECP','1.0','score_aditivo',
  (SELECT id FROM config.libreria WHERE codigo='statsmodels'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'Nivel de alerta de escalada en un DPA','activo','Model Reviewer','2027-01-31'),
 ('IVSEC','1.0','score_aditivo',
  (SELECT id FROM config.libreria WHERE codigo='statsmodels'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'Vulnerabilidad combinada en zona sísmica','activo','Model Reviewer','2027-01-31'),
 ('IATT','1.0','regla',
  (SELECT id FROM config.libreria WHERE codigo='statsmodels'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'Alerta temprana territorial (Ancón)','activo','Model Reviewer','2027-01-31'),
 ('VCPUE','1.0','did',
  (SELECT id FROM config.libreria WHERE codigo='statsmodels'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'Efecto de la sísmica sobre la CPUE de pota','activo','Model Reviewer','2027-01-31'),
 ('COIB','1.0','regresion',
  (SELECT id FROM config.libreria WHERE codigo='statsmodels'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'Capacidad ociosa industrial','activo','Model Reviewer','2027-01-31'),
 ('GDP','1.0','regresion',
  (SELECT id FROM config.libreria WHERE codigo='statsmodels'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'Gradiente de dispersión de la pota','activo','Model Reviewer','2027-01-31'),
 ('IAC-NEC','1.0','regla',
  (SELECT id FROM config.libreria WHERE codigo='scikit_learn'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'Alertas de concentración en NEC','propuesto','DGPIP','2027-01-31'),
 ('RCID','1.0','glmm',
  (SELECT id FROM config.libreria WHERE codigo='statsmodels'),
  (SELECT id FROM config.aplicacion WHERE codigo='A3_sintetizador'),
  'Ratio de captura incidental de tiburón','propuesto','Model Reviewer','2027-01-31')
ON CONFLICT (codigo, version) DO NOTHING;

-- Cierra el ciclo: las 4 aplicaciones tipo agente ya tienen su model_card; se activan.
UPDATE config.aplicacion a SET estado = 'activa',
       modelo_card_id = (SELECT id FROM model.model_card m WHERE m.aplicacion_id = a.id AND m.tipo_modelo = 'llm')
 WHERE a.tipo = 'agente' AND a.codigo IN ('A1_extractor','A2_pautas','A3_sintetizador','critic');

-- ---------- 8.4 core.integraciones (fuentes) ----------
INSERT INTO core.integraciones
    (sistema_origen, sistema_destino, entidad_origen_tipo, entidad_origen_id, tipo_sync, estado, tipo_fuente_id)
VALUES
 ('SUNAT','PRODUCE','comprobante', gen_random_uuid(),'pull','pendiente_auth',12),
 ('VUCE','PRODUCE','permiso_cites', gen_random_uuid(),'pull','pendiente_auth',13),
 ('ANA_SIAGUA','PRODUCE','serie_hidrica', gen_random_uuid(),'pull','pendiente_auth',14),
 ('SANIPES','PRODUCE','diagnostico_pcr', gen_random_uuid(),'pull','pendiente_auth',15),
 ('CITERED','PRODUCE','acta_inspeccion', gen_random_uuid(),'pull','pendiente_auth',16),
 ('CITES_SECRETARIAT','PRODUCE','especie_cites', gen_random_uuid(),'pull','activa',17),
 ('DGSFS_PA_TIBURON','PRODUCE','desembarque_tiburon', gen_random_uuid(),'pull','pendiente_auth',18),
 ('OEFA_PAM','PRODUCE','pasivo_ambiental', gen_random_uuid(),'pull','pendiente_auth',19),
 ('SBS','PRODUCE','tasa_interes', gen_random_uuid(),'pull','pendiente_auth',20),
 -- SESIGUE: push (el sistema local empuja el hito al compromiso externo); el
 -- entidad_destino_ref lo completa el worker al confirmar el alta del compromiso remoto.
 ('PRODUCE','SESIGUE','compromiso', gen_random_uuid(),'push','pendiente_auth',21)
ON CONFLICT (sistema_destino, entidad_origen_tipo, entidad_origen_id) DO NOTHING;

-- Backfill del nivel de integración por fuente (§15.bis). Coherente con la vía ya declarada
-- para cada agencia: API -> api_rest_pide, lote -> batch_sftp, y oficio/convenio manual para
-- CITEred (16), DGSFS-PA tiburón (18), OEFA PAM (19) y SBS (20), que conservan el DEFAULT.
UPDATE core.integraciones SET protocolo_sincronizacion = 'api_rest_pide'
 WHERE sistema_destino = 'PRODUCE' AND tipo_fuente_id IN (12,13,14,17);
UPDATE core.integraciones SET protocolo_sincronizacion = 'batch_sftp'
 WHERE sistema_destino = 'PRODUCE' AND tipo_fuente_id = 15;

-- =====================================================================
-- §9. RLS consolidada
-- =====================================================================

-- ---------- 9.1 DM-1 tablas: RLS por clasificación ----------
ALTER TABLE core.riesgo_social_ordinal ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.riesgo_social_ordinal FORCE ROW LEVEL SECURITY;
CREATE POLICY p_clasif ON core.riesgo_social_ordinal FOR SELECT
    USING (nivel_clasificacion <= core.clasificacion_max());
CREATE POLICY p_ins ON core.riesgo_social_ordinal FOR INSERT
    WITH CHECK (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max());

ALTER TABLE core.acuerdo_ospa_sni ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.acuerdo_ospa_sni FORCE ROW LEVEL SECURITY;
CREATE POLICY p_clasif ON core.acuerdo_ospa_sni FOR SELECT
    USING (nivel_clasificacion <= core.clasificacion_max());
CREATE POLICY p_ins ON core.acuerdo_ospa_sni FOR INSERT
    WITH CHECK (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max());

ALTER TABLE proteccion.registro_parametrico ENABLE ROW LEVEL SECURITY;
ALTER TABLE proteccion.registro_parametrico FORCE ROW LEVEL SECURITY;
CREATE POLICY p_clasif ON proteccion.registro_parametrico FOR SELECT
    USING (nivel_clasificacion <= core.clasificacion_max());

-- ---------- 9.2 mype y pesca: RLS por clasificación Y sujeto ----------
ALTER TABLE mype.ejecucion_nec ENABLE ROW LEVEL SECURITY;
ALTER TABLE mype.ejecucion_nec FORCE ROW LEVEL SECURITY;
CREATE POLICY p_clasif ON mype.ejecucion_nec FOR SELECT
    USING (nivel_clasificacion <= core.clasificacion_max());
CREATE POLICY p_ins ON mype.ejecucion_nec FOR INSERT
    WITH CHECK (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max());
CREATE POLICY p_sujeto ON mype.ejecucion_nec AS RESTRICTIVE FOR SELECT
    USING (core.staff_bypass_subject_rls()
           OR mype_actor_uid = NULLIF(current_setting('app.actor_uid', true), '')::uuid);

ALTER TABLE pesca.licencia_cites_denp ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesca.licencia_cites_denp FORCE ROW LEVEL SECURITY;
CREATE POLICY p_clasif ON pesca.licencia_cites_denp FOR SELECT
    USING (nivel_clasificacion <= core.clasificacion_max());
CREATE POLICY p_ins ON pesca.licencia_cites_denp FOR INSERT
    WITH CHECK (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max());
CREATE POLICY p_sujeto ON pesca.licencia_cites_denp AS RESTRICTIVE FOR SELECT
    USING (core.staff_bypass_subject_rls()
           OR exportador_actor_uid = NULLIF(current_setting('app.actor_uid', true), '')::uuid);

ALTER TABLE pesca.trazabilidad_qr ENABLE ROW LEVEL SECURITY;
ALTER TABLE pesca.trazabilidad_qr FORCE ROW LEVEL SECURITY;
CREATE POLICY p_clasif ON pesca.trazabilidad_qr FOR SELECT
    USING (nivel_clasificacion <= core.clasificacion_max());

-- ---------- 9.3 chat.*: RLS por clasificación + sujeto (repositorio) ----------
-- NOTA DE CORRECCIÓN (validado en Postgres 16): chat.rama y chat.ref son
-- punteros (a un commit), no contenido clasificado — no tienen columna
-- nivel_clasificacion (confirmado contra su CREATE TABLE), así que el loop
-- original fallaba en la cuarta iteración. Se sacan del loop y reciben su
-- propia política: visibles solo si su chat.repositorio es visible (la RLS
-- de chat.repositorio, clasificación + sujeto, se hereda por el EXISTS).
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['chat.repositorio','chat.commit','chat.turno','chat.blob',
                            'chat.stash','chat.remote'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_clasif ON %s FOR SELECT USING (nivel_clasificacion <= core.clasificacion_max())', t);
    EXECUTE format('CREATE POLICY p_ins ON %s FOR INSERT WITH CHECK (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max())', t);
    EXECUTE format('CREATE POLICY p_upd ON %s FOR UPDATE USING (core.clasificacion_max() >= 2 AND nivel_clasificacion <= core.clasificacion_max())', t);
  END LOOP;
END $$;

CREATE POLICY p_sujeto ON chat.repositorio AS RESTRICTIVE FOR SELECT
    USING (sujeto_actor_uid IS NULL
           OR core.staff_bypass_subject_rls()
           OR sujeto_actor_uid = NULLIF(current_setting('app.actor_uid', true), '')::uuid);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['chat.rama','chat.ref'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY p_via_repositorio ON %s FOR SELECT USING ('
      'EXISTS (SELECT 1 FROM chat.repositorio r WHERE r.id = %s.repositorio_id))', t, t);
    EXECUTE format(
      'CREATE POLICY p_ins ON %s FOR INSERT WITH CHECK ('
      'core.clasificacion_max() >= 2 AND EXISTS (SELECT 1 FROM chat.repositorio r WHERE r.id = %s.repositorio_id))', t, t);
    EXECUTE format(
      'CREATE POLICY p_upd ON %s FOR UPDATE USING ('
      'core.clasificacion_max() >= 2 AND EXISTS (SELECT 1 FROM chat.repositorio r WHERE r.id = %s.repositorio_id))', t, t);
  END LOOP;
END $$;

-- ---------- 9.4 territorio.monitoreo_hidrico (edición quirúrgica: tabla eliminada) ----------
-- La RLS de las muestras de agua ya no hace falta aquí: viven en ctx.observaciones, que no lleva
-- nivel_clasificacion propio por fila (el contexto sistémico es, por diseño, de menor sensibilidad
-- que los artefactos de dominio — ver §3.17 de v8.2). Si una cuenca necesitara reservarse, la vía
-- es clasificar el territorio.lugares correspondiente, no la observación.

-- =====================================================================
-- §10. Índices consolidados de FKs
-- =====================================================================
CREATE INDEX IF NOT EXISTS ix_irsa_fk_actor ON core.acuerdo_ospa_sni(ospa_actor_uid);
CREATE INDEX IF NOT EXISTS ix_rel_dep_peso ON ind.relacion_dependencia(indicador_id, tipo_dependencia);
CREATE INDEX IF NOT EXISTS ix_licencia_creado ON pesca.licencia_cites_denp(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_commit_artefacto ON chat.commit(artefacto_id) WHERE artefacto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_output_chat_commit ON core.output_contracts(chat_commit_id) WHERE chat_commit_id IS NOT NULL;

-- =====================================================================
-- §11. Smoke tests (opcional, correr manualmente)
-- =====================================================================
-- SELECT COUNT(*) FROM domain.tipo_artefacto WHERE codigo='conversacion_ia';  -- 1
-- SELECT COUNT(*) FROM kag.cat_tipos_nodo;  -- ≥ 15 (10 v8.4 + 5 v9)
-- SELECT COUNT(*) FROM kag.cat_tipos_arista; -- ≥ 16 (10 + 6)
-- SELECT COUNT(*) FROM ctx.cat_variables;    -- ≥ 30 (24 + 13, menos solapamientos)
-- SELECT COUNT(*) FROM config.guardrail_contract;  -- 18
-- SELECT COUNT(*) FROM config.a2_transiciones;     -- 11
-- SELECT COUNT(*) FROM model.model_card;           -- ≥ 8
-- SELECT COUNT(*) FROM config.parametro WHERE valid_to IS NULL;  -- ≥ 16
-- SELECT COUNT(*) FROM core.feature_flags;         -- 8
-- SELECT COUNT(*) FROM policy.regla WHERE clase='N';  -- ≥ 10
-- SELECT COUNT(*) FROM chat.repositorio;           -- 0 (vacío, listo)
-- SELECT COUNT(*) FROM ind.relacion_dependencia;   -- 0 (vacío; seeds en scripts/)
-- SELECT COUNT(*) FROM territorio.parque_industrial;  -- 0 (seeds en scripts/)
-- =====================================================================

-- =====================================================================
-- FIN DEL DDL v9
-- =====================================================================
