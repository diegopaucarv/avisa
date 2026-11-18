-- ==================================================================
-- PARCHE 11 · GRAFO KAG: nodos de caso, nodos faltantes y aristas mínimas
-- AVISA / SIPRECS · OAIPCS · 2026-11-18
-- ==================================================================
--
-- Qué arregla
--   1. El alta de nodos de caso estaba escondida dentro de core.caso_historial().
--      Se separa en kag.caso_nace(), con su propio trigger, igual que actores.
--   2. La etiqueta del nodo no se actualizaba cuando cambiaba el nombre del caso
--      ni cuando cambiaba el nombre del actor. Se añaden dos sincronizadores.
--   3. kag.nodos no tenía marca de tiempo ni índice por referencia. Se añaden.
--   4. Solo había nodos de actor (1160) y caso (35). Faltaban las demandas (325),
--      que el catálogo de tipos ya admite.
--   5. kag.aristas estaba vacía. Se crean las relaciones mínimas que la propia
--      base ya declara en sus tablas puente: participación, exigencia y membresía.
--   6. Se añaden los disparadores para que el grafo no vuelva a divergir cuando
--      se inserte en las tablas puente.
--
-- Qué no hace
--   No cierra la validez de una arista cuando se borra el vínculo de origen.
--   No inventa relaciones que no estén escritas en core (nada de ALIANZA ni
--   TENSION: eso exige lectura documental o análisis de agente).
--
-- Nota sobre las marcas de tiempo
--   Las 1 195 filas que ya existían reciben created_at = updated_at = now(),
--   que es el momento de aplicación del parche y no el de su alta real. El dato
--   anterior no existe en la base; se prefiere una fecha declarada a un nulo.
--
-- Se aplica sobre la base viva, después de la carga del legado.
-- ==================================================================

BEGIN;

-- ------------------------------------------------------------------
-- 1. Catálogo: el tipo de arista que faltaba
-- ------------------------------------------------------------------
INSERT INTO kag.cat_tipos_arista (id, codigo, clase, dirigida, origen_tipo, destino_tipo)
SELECT 20, 'MIEMBRO_DE', 'relacion', TRUE, 'actor', 'actor'
WHERE NOT EXISTS (SELECT 1 FROM kag.cat_tipos_arista WHERE codigo = 'MIEMBRO_DE');

COMMENT ON TABLE kag.cat_tipos_arista IS
  'Catálogo de tipos de relación del grafo, con su clase, si es dirigida y los tipos de nodo que conecta.';

-- ------------------------------------------------------------------
-- 2. kag.nodos: marcas de tiempo e índice por referencia
-- ------------------------------------------------------------------
ALTER TABLE kag.nodos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE kag.nodos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS ix_nodos_ref ON kag.nodos (ref_id);

CREATE OR REPLACE FUNCTION kag.nodo_toca() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nodo_toca ON kag.nodos;
CREATE TRIGGER trg_nodo_toca BEFORE UPDATE ON kag.nodos
  FOR EACH ROW EXECUTE FUNCTION kag.nodo_toca();

COMMENT ON COLUMN kag.nodos.created_at IS
  'Momento en que el nodo se insertó en el grafo. Las filas anteriores al parche 11 llevan la fecha de aplicación.';
COMMENT ON COLUMN kag.nodos.updated_at IS
  'Última vez que cambió el nodo, normalmente por actualización de su etiqueta.';

-- ------------------------------------------------------------------
-- 3. Helpers idempotentes
-- ------------------------------------------------------------------

-- Devuelve el id del nodo, creándolo si no existe. No duplica ni actualiza
-- si la etiqueta no cambió, para no ensuciar updated_at.
CREATE OR REPLACE FUNCTION kag.nodo_asegura(p_tipo VARCHAR, p_ref UUID, p_etiqueta VARCHAR)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO kag.nodos (tipo, ref_id, etiqueta)
  VALUES (p_tipo, p_ref, left(p_etiqueta, 255))
  ON CONFLICT (tipo, ref_id) DO UPDATE
    SET etiqueta = COALESCE(EXCLUDED.etiqueta, kag.nodos.etiqueta)
    WHERE kag.nodos.etiqueta IS DISTINCT FROM COALESCE(EXCLUDED.etiqueta, kag.nodos.etiqueta)
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM kag.nodos WHERE tipo = p_tipo AND ref_id = p_ref;
  END IF;
  RETURN v_id;
END $$;

-- Crea una arista si no existe una vigente equivalente. Devuelve su id.
CREATE OR REPLACE FUNCTION kag.arista_asegura(
  p_origen UUID, p_destino UUID, p_codigo VARCHAR, p_caso UUID DEFAULT NULL,
  p_justificacion TEXT DEFAULT NULL, p_confidence NUMERIC DEFAULT 0.90,
  p_nivel INT DEFAULT 2, p_origen_dato VARCHAR DEFAULT 'MIGRACION'
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_tipo SMALLINT; v_id UUID;
BEGIN
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_tipo FROM kag.cat_tipos_arista WHERE codigo = p_codigo;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'tipo de arista desconocido: %', p_codigo;
  END IF;

  SELECT id INTO v_id FROM kag.aristas
   WHERE origen_id = p_origen AND destino_id = p_destino
     AND tipo_id = v_tipo AND superseded_at IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO kag.aristas (origen_id, destino_id, tipo_id, caso_id, justificacion,
                           valid_from, confidence, origen_dato, nivel_clasificacion)
  VALUES (p_origen, p_destino, v_tipo, p_caso, p_justificacion,
          now(), p_confidence, p_origen_dato, p_nivel)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ------------------------------------------------------------------
-- 4. Disparadores de alta y de renombre
-- ------------------------------------------------------------------

-- Actor: alta de nodo e histórico de nombre (antes ya existía, ahora idempotente).
CREATE OR REPLACE FUNCTION kag.actor_nace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO kag.actor_name_history (actor_uid, nombre, valid_from, fuente)
  VALUES (NEW.actor_uid, NEW.nombre_actual, CURRENT_DATE, 'alta');
  PERFORM kag.nodo_asegura('actor', NEW.actor_uid, NEW.nombre_actual);
  RETURN NEW;
END $$;

-- Caso: alta de nodo, separada del historial de estado.
CREATE OR REPLACE FUNCTION kag.caso_nace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM kag.nodo_asegura('caso', NEW.id, NEW.nombre_caso);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_caso_nace ON core.casos;
CREATE TRIGGER trg_caso_nace AFTER INSERT ON core.casos
  FOR EACH ROW EXECUTE FUNCTION kag.caso_nace();

-- Demanda: alta de nodo. La etiqueta es el pedido, no el código.
CREATE OR REPLACE FUNCTION kag.demanda_nace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM kag.nodo_asegura(
    'demanda', NEW.id,
    coalesce(NEW.problema_3p, NEW.descripcion_demanda, 'Demanda ' || coalesce(NEW.codigo_legado, ''))
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_demanda_nace ON core.demandas;
CREATE TRIGGER trg_demanda_nace AFTER INSERT ON core.demandas
  FOR EACH ROW EXECUTE FUNCTION kag.demanda_nace();

-- Renombre de caso: el nodo debe decir lo mismo que la tabla de origen.
CREATE OR REPLACE FUNCTION kag.caso_renombra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE kag.nodos SET etiqueta = NEW.nombre_caso
   WHERE tipo = 'caso' AND ref_id = NEW.id
     AND etiqueta IS DISTINCT FROM NEW.nombre_caso;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_caso_renombra ON core.casos;
CREATE TRIGGER trg_caso_renombra AFTER UPDATE OF nombre_caso ON core.casos
  FOR EACH ROW EXECUTE FUNCTION kag.caso_renombra();

-- Renombre de actor: cubre el UPDATE directo, que no pasaba por el histórico.
CREATE OR REPLACE FUNCTION kag.actor_renombra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE kag.nodos SET etiqueta = NEW.nombre_actual
   WHERE tipo = 'actor' AND ref_id = NEW.actor_uid
     AND etiqueta IS DISTINCT FROM NEW.nombre_actual;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_actor_renombra ON core.actores;
CREATE TRIGGER trg_actor_renombra AFTER UPDATE OF nombre_actual ON core.actores
  FOR EACH ROW EXECUTE FUNCTION kag.actor_renombra();

-- ------------------------------------------------------------------
-- 5. El historial de estado deja de escribir en el grafo
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.caso_historial() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (NEW.nivel_conflicto_id, NEW.nivel_riesgo_id, NEW.estado_id)
     IS DISTINCT FROM (OLD.nivel_conflicto_id, OLD.nivel_riesgo_id, OLD.estado_id) THEN
    UPDATE core.caso_estado_historial SET hasta = now() WHERE caso_id = NEW.id AND hasta IS NULL;
    INSERT INTO core.caso_estado_historial (caso_id, nivel_conflicto_id, nivel_riesgo_id, estado_id, usuario_id)
    VALUES (NEW.id, NEW.nivel_conflicto_id, NEW.nivel_riesgo_id, NEW.estado_id,
            NULLIF(current_setting('app.user_id', true), '')::uuid);
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION core.caso_historial() IS
  'Mantiene core.caso_estado_historial. El alta del nodo en el grafo la hace kag.caso_nace() desde el parche 11.';

-- ------------------------------------------------------------------
-- 6. Disparadores de aristas sobre las tablas de relación
-- ----------------------------------------------------------------------

-- caso ↔ actor (casos_actores)
CREATE OR REPLACE FUNCTION kag.caso_actor_nace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor UUID; v_caso UUID;
BEGIN
  SELECT kag.nodo_asegura('actor', a.actor_uid, a.nombre_actual) INTO v_actor
    FROM core.actores a WHERE a.actor_uid = NEW.actor_id;
  SELECT kag.nodo_asegura('caso', c.id, c.nombre_caso) INTO v_caso
    FROM core.casos c WHERE c.id = NEW.caso_id;
  PERFORM kag.arista_asegura(v_actor, v_caso, 'PARTICIPA_EN', NEW.caso_id,
    'Vínculo actor-caso registrado en core.casos_actores', 0.95, 2, 'MIGRACION');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_caso_actor_nace ON core.casos_actores;
CREATE TRIGGER trg_caso_actor_nace AFTER INSERT ON core.casos_actores
  FOR EACH ROW EXECUTE FUNCTION kag.caso_actor_nace();

-- actor ↔ demanda (demandas_actores)
CREATE OR REPLACE FUNCTION kag.demanda_actor_nace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_actor UUID; v_demanda UUID; v_caso UUID;
BEGIN
  SELECT kag.nodo_asegura('actor', a.actor_uid, a.nombre_actual) INTO v_actor
    FROM core.actores a WHERE a.actor_uid = NEW.actor_id;
  SELECT kag.nodo_asegura('demanda', d.id,
           coalesce(d.problema_3p, d.descripcion_demanda, 'Demanda ' || coalesce(d.codigo_legado, ''))),
         d.caso_id
    INTO v_demanda, v_caso
    FROM core.demandas d WHERE d.id = NEW.demanda_id;
  PERFORM kag.arista_asegura(v_actor, v_demanda, 'EXIGE', v_caso,
    'Demanda formulada por el actor, según core.demandas_actores', 0.90, 2, 'MIGRACION');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_demanda_actor_nace ON core.demandas_actores;
CREATE TRIGGER trg_demanda_actor_nace AFTER INSERT ON core.demandas_actores
  FOR EACH ROW EXECUTE FUNCTION kag.demanda_actor_nace();

-- persona ↔ organización (actor_membresia). Nivel 3: revela afiliación.
CREATE OR REPLACE FUNCTION kag.membresia_nace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_persona UUID; v_org UUID;
BEGIN
  SELECT kag.nodo_asegura('actor', a.actor_uid, a.nombre_actual) INTO v_persona
    FROM core.actores a WHERE a.actor_uid = NEW.persona_uid;
  SELECT kag.nodo_asegura('actor', a.actor_uid, a.nombre_actual) INTO v_org
    FROM core.actores a WHERE a.actor_uid = NEW.organizacion_uid;
  PERFORM kag.arista_asegura(v_persona, v_org, 'MIEMBRO_DE', NULL,
    'Pertenencia registrada en core.actor_membresia', 0.95, 3, 'MIGRACION');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_membresia_nace ON core.actor_membresia;
CREATE TRIGGER trg_membresia_nace AFTER INSERT ON core.actor_membresia
  FOR EACH ROW EXECUTE FUNCTION kag.membresia_nace();

-- ------------------------------------------------------------------
-- 7. Relleno de nodos existentes
-- ------------------------------------------------------------------
INSERT INTO kag.nodos (tipo, ref_id, etiqueta)
SELECT 'actor', a.actor_uid, a.nombre_actual FROM core.actores a
ON CONFLICT (tipo, ref_id) DO NOTHING;

INSERT INTO kag.nodos (tipo, ref_id, etiqueta)
SELECT 'caso', c.id, c.nombre_caso FROM core.casos c
ON CONFLICT (tipo, ref_id) DO NOTHING;

INSERT INTO kag.nodos (tipo, ref_id, etiqueta)
SELECT 'demanda', d.id,
       left(coalesce(d.problema_3p, d.descripcion_demanda, 'Demanda ' || coalesce(d.codigo_legado, '')), 255)
FROM core.demandas d
ON CONFLICT (tipo, ref_id) DO NOTHING;

-- ------------------------------------------------------------------
-- 8. Relleno de aristas mínimas ya declaradas en core
-- ------------------------------------------------------------------
SELECT kag.arista_asegura(
         (SELECT id FROM kag.nodos WHERE tipo='actor' AND ref_id = ca.actor_id),
         (SELECT id FROM kag.nodos WHERE tipo='caso'  AND ref_id = ca.caso_id),
         'PARTICIPA_EN', ca.caso_id,
         'Vínculo actor-caso registrado en core.casos_actores', 0.95, 2, 'MIGRACION')
FROM core.casos_actores ca;

SELECT kag.arista_asegura(
         (SELECT id FROM kag.nodos WHERE tipo='actor'   AND ref_id = da.actor_id),
         (SELECT id FROM kag.nodos WHERE tipo='demanda' AND ref_id = da.demanda_id),
         'EXIGE', d.caso_id,
         'Demanda formulada por el actor, según core.demandas_actores', 0.90, 2, 'MIGRACION')
FROM core.demandas_actores da
JOIN core.demandas d ON d.id = da.demanda_id;

SELECT kag.arista_asegura(
         (SELECT id FROM kag.nodos WHERE tipo='actor' AND ref_id = m.persona_uid),
         (SELECT id FROM kag.nodos WHERE tipo='actor' AND ref_id = m.organizacion_uid),
         'MIEMBRO_DE', NULL,
         'Pertenencia registrada en core.actor_membresia', 0.95, 3, 'MIGRACION')
FROM core.actor_membresia m;

-- ------------------------------------------------------------------
-- 9. Verificación
-- ------------------------------------------------------------------
DO $$
DECLARE v_nodos INT; v_actores INT; v_casos INT; v_demandas INT;
        v_aristas INT; v_participa INT; v_exige INT; v_miembro INT; v_huerfanas INT;
BEGIN
  SELECT count(*) INTO v_nodos FROM kag.nodos;
  SELECT count(*) INTO v_actores FROM kag.nodos WHERE tipo='actor';
  SELECT count(*) INTO v_casos FROM kag.nodos WHERE tipo='caso';
  SELECT count(*) INTO v_demandas FROM kag.nodos WHERE tipo='demanda';
  SELECT count(*) INTO v_aristas FROM kag.aristas WHERE superseded_at IS NULL;
  SELECT count(*) INTO v_participa FROM kag.aristas a JOIN kag.cat_tipos_arista t ON t.id=a.tipo_id
    WHERE t.codigo='PARTICIPA_EN' AND a.superseded_at IS NULL;
  SELECT count(*) INTO v_exige FROM kag.aristas a JOIN kag.cat_tipos_arista t ON t.id=a.tipo_id
    WHERE t.codigo='EXIGE' AND a.superseded_at IS NULL;
  SELECT count(*) INTO v_miembro FROM kag.aristas a JOIN kag.cat_tipos_arista t ON t.id=a.tipo_id
    WHERE t.codigo='MIEMBRO_DE' AND a.superseded_at IS NULL;
  SELECT count(*) INTO v_huerfanas FROM kag.aristas a
    WHERE NOT EXISTS (SELECT 1 FROM kag.nodos n WHERE n.id=a.origen_id)
       OR NOT EXISTS (SELECT 1 FROM kag.nodos n WHERE n.id=a.destino_id);

  RAISE NOTICE 'nodos=% (actor=% caso=% demanda=%)', v_nodos, v_actores, v_casos, v_demandas;
  RAISE NOTICE 'aristas=% (PARTICIPA_EN=% EXIGE=% MIEMBRO_DE=%)', v_aristas, v_participa, v_exige, v_miembro;
  RAISE NOTICE 'aristas con extremo inexistente=%', v_huerfanas;
END $$;

COMMIT;

-- ==================================================================
-- Comprobación posterior sugerida
--   SELECT tipo, count(*) FROM kag.nodos GROUP BY 1 ORDER BY 2 DESC;
--   SELECT t.codigo, count(*) FROM kag.aristas a
--     JOIN kag.cat_tipos_arista t ON t.id = a.tipo_id
--    GROUP BY 1 ORDER BY 2 DESC;
-- ==================================================================
