-- =====================================================================
-- PRODUCE-OAIPCS / AVISA · v9 · Edición SESIGUE — bloque DDL ejecutable aislado
-- =====================================================================
-- Es la sección 4.5.bis del archivo unificado PRODUCE_OAIPCS_AVISA_v9_ddl.sql,
-- extraída aquí para que el script de pruebas de comportamiento
-- (test_v9_edicion_sesigue.py) la cargue desde disco sin ejecutar las ~4,300
-- líneas del DDL completo.
--
-- Requiere el núcleo ya cargado, en particular core.usuarios, core.integraciones
-- y core.hitos_compromiso. La sección 0 de este archivo reproduce —de forma
-- IDEMPOTENTE— los dos objetos de §4.5 de los que el bloque depende y que no
-- vienen en ningún DDL de v8.x: core.cat_tipos_fuente_integracion y la columna
-- core.integraciones.tipo_fuente_id. Si ya existen (caso del archivo completo),
-- la sección 0 no hace nada.
--
-- Principio rector de esta edición: nada lleva "sesigue" en el nombre de tabla.
-- El outbox es genérico (core.outbox_integracion) y sirve para VUCE, ANA,
-- SANIPES y las demás fuentes ya registradas. La agregación N:1 es una vista
-- sobre core.integraciones, no una tabla de concordancia nueva. El gate HITL
-- reutiliza el idioma de gobernanza de core.cambio_normativo.
--
-- Caveat que NO se borra: nada de esto confirma que SESIGUE exista con ese
-- nombre, ese endpoint o ese stack (ver §1.1.bis del documento). El bloque
-- describe cómo se construiría el adaptador SI existiera.
-- =====================================================================

-- ---------- 0) Prerrequisitos de §4.5 (idempotentes) ----------
CREATE TABLE IF NOT EXISTS core.cat_tipos_fuente_integracion (
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
 (20,'sbs','SBS (tasa MYPE)')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE core.integraciones
    ADD COLUMN IF NOT EXISTS tipo_fuente_id SMALLINT REFERENCES core.cat_tipos_fuente_integracion(id);
CREATE INDEX IF NOT EXISTS ix_integ_tipo_fuente ON core.integraciones(tipo_fuente_id);

-- ---------- 1) Catálogo de estados del ciclo de vida de un envío ----------
CREATE TABLE core.cat_estados_integracion (
    id SMALLINT PRIMARY KEY,
    codigo VARCHAR(30) NOT NULL UNIQUE,
    es_terminal BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO core.cat_estados_integracion (id, codigo, es_terminal) VALUES
 (1,'pendiente_aprobacion',FALSE), (2,'aprobado_para_envio',FALSE), (3,'enviado',FALSE),
 (4,'confirmado',TRUE), (5,'rechazado_por_destino',TRUE), (6,'rechazado_por_enlace',TRUE),
 (7,'reintentando',FALSE), (8,'fallo_definitivo',TRUE);

-- ---------- 2) Outbox transaccional genérico ----------
CREATE TABLE core.outbox_integracion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integracion_id UUID NOT NULL REFERENCES core.integraciones(id),
    payload_local JSONB NOT NULL,
    payload_transformado JSONB,
    estado_id SMALLINT NOT NULL DEFAULT 1 REFERENCES core.cat_estados_integracion(id),
    intentos INT NOT NULL DEFAULT 0,
    ultimo_error TEXT,
    proximo_intento_en TIMESTAMPTZ,
    aprobado_por UUID REFERENCES core.usuarios(id),
    aprobado_en TIMESTAMPTZ,
    ticket_externo VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_outbox_pendientes ON core.outbox_integracion(estado_id, proximo_intento_en)
  WHERE estado_id IN (2,7);
CREATE INDEX ix_outbox_integracion ON core.outbox_integracion(integracion_id);

-- Gate HITL impuesto por la base (estados 2, 3 y 4).
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

-- ---------- 3) Agregación N:1 como vista, no como tabla ----------
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

-- ---------- 4) Nivel de integración por fuente ----------
ALTER TABLE core.integraciones ADD COLUMN IF NOT EXISTS protocolo_sincronizacion VARCHAR(20)
    CHECK (protocolo_sincronizacion IN ('api_rest_pide', 'batch_sftp', 'oficio_manual'))
    DEFAULT 'oficio_manual';

COMMENT ON COLUMN core.integraciones.workflow_state IS
  'Estado del trámite en el sistema externo (texto libre, p. ej. el workflow inter-ministerial de §13.4). NO confundir con core.outbox_integracion.estado_id, que es el ciclo de vida del mensaje de transporte.';

-- ---------- 5) Mapeo de estados locales -> externos (hipótesis) ----------
CREATE TABLE core.cat_mapeo_estado_externo (
    id SMALLINT PRIMARY KEY,
    sistema_destino VARCHAR(100) NOT NULL,
    estado_local VARCHAR(60) NOT NULL,
    estado_externo VARCHAR(60) NOT NULL,
    UNIQUE (sistema_destino, estado_local)
);
-- ¡verificar! Filas ilustrativas, no confirmadas por la SSGC.
INSERT INTO core.cat_mapeo_estado_externo (id, sistema_destino, estado_local, estado_externo) VALUES
 (1,'SESIGUE','En_Contratación','En_Cumplimiento_En_Plazo'),
 (2,'SESIGUE','En_Elaboración_TDR','En_Cumplimiento_En_Plazo'),
 (3,'SESIGUE','Vencido_Sin_Sustento','En_Cumplimiento_Vencido');

-- ---------- 6) La fuente externa como fila de catálogo ----------
INSERT INTO core.cat_tipos_fuente_integracion (id, codigo, nombre) VALUES
 (21,'sesigue','SESIGUE (SSGC — PCM)');
