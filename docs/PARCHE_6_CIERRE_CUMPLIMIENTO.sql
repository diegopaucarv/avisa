-- =============================================================================
-- PARCHE 6 — CIERRE DE CUMPLIMIENTO Y CLASIFICACIÓN DOCUMENTAL
-- AVISA / OAIPCS · PRODUCE
--
-- Qué hace. Dos cambios, ambos pequeños y reversibles:
--   1. Amplía el CHECK de `config.guardrail_contract` de G1–G18 a G1–G25.
--   2. Reclasifica de tipo 15 (`otro`) a tipo 10 (`ayuda_memoria`) los documentos
--      heredados de `DIM_Redaccion` (códigos `RED-2026-0xx`): 34 filas.
--
--      AVISO DE INCONSISTENCIA (no la resuelve este parche). De los 51 documentos
--      `RED-%`, 10 ya estaban en tipo 10 y 7 están en tipo 11 (`relatoria`). Son,
--      por título, el mismo producto: acta/ayuda memoria de una reunión. Tras el
--      parche quedarán 44 en tipo 10 y 7 en tipo 11. Si la política es una sola,
--      hay que decidir cuál: o los 7 bajan a 10, o los 44 suben a 11. No se toca
--      aquí porque el criterio es de contenido (OAIPCS), no de migración.
--
--      Los 3 documentos `CT-2026-00x` que también están en tipo 15 NO se mueven:
--      no vienen de `DIM_Redaccion` y su tipo correcto no está decidido.
--
-- Qué NO hace. No siembra las filas G19–G25 (decisión de contenido pendiente,
-- OAIPCS + OGTI) y no toca `core.documentos` tipo 15 que no sean `RED-%`.
--
-- Evidencia. `BRECHA_CAPA_DATOS_V9.md` §13.1 (defecto único de migración) y
-- `mvp.md` §2.5 / `v10` §16.1.quinquies (G23–G25).
--
-- Antes de ejecutar: leer el bloque 0. Cada consulta de verificación indica el
-- resultado esperado; si alguno no coincide, DETENERSE.
--
-- Ejecución prevista (usuario con permiso sobre el esquema):
--   docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--     -f - < docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql
--
-- REQUISITO DE SESIÓN (trampa conocida). `core.documentos` tiene RLS activo. Con
-- un rol sin BYPASSRLS, el UPDATE no falla: afecta 0 filas en silencio. El usuario
-- `avisa` es superusuario y por eso funciona, pero si se ejecuta con otro rol hay que
-- abrir la sesión explícitamente antes del BEGIN:
--   SET app.clasificacion_max = '3';
--   SET app.user_id = '<uuid de un usuario alta_direccion>';
-- La verificación 4.2 es la que delata el fallo silencioso: devolvería 37, no 0.
-- =============================================================================


-- =============================================================================
-- 0. VERIFICACIÓN PREVIA (solo lectura)
-- =============================================================================

-- 0.1 Filas de contrato hoy. Esperado: 18 (G1–G18). Con G19–G25 sembradas: 25.
SELECT count(*) AS contratos
FROM config.guardrail_contract;

-- 0.2 Definición actual del CHECK. Esperado: termina en 'G18'.
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'config.guardrail_contract'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%G1%';

-- 0.3 Distribución de tipos documentales. Esperado: 10 → 11, 15 → 37.
--     (Medido el 2026-11-18. Si 15 no da 37, la base cambió: revisar antes de seguir.)
SELECT tipo_id, count(*) AS filas
FROM core.documentos
GROUP BY tipo_id
ORDER BY tipo_id;

-- 0.4 Los documentos a mover. Esperado: 34, todos con prefijo RED-.
SELECT count(*) AS a_reclasificar
FROM core.documentos
WHERE tipo_id = 15
  AND codigo LIKE 'RED-%';

-- 0.5 Control de ambigüedad: documentos tipo 15 sin código legible.
--     Si devuelve filas, NO son reclasificables automáticamente: requiere criterio
--     humano. No ampliar el UPDATE a ciegas.
SELECT id, codigo, titulo, fecha
FROM core.documentos
WHERE tipo_id = 15
  AND (codigo IS NULL OR codigo NOT LIKE 'RED-%')
ORDER BY fecha;


BEGIN;

-- =============================================================================
-- 1. INSTANTÁNEA PARA ROLLBACK EXACTO
--    Sin esto, revertir devolvería también los 10 RED- que ya estaban en tipo 10.
-- =============================================================================

CREATE TABLE IF NOT EXISTS core.patch6_documentos_snapshot (
    documento_id UUID PRIMARY KEY,
    tipo_previo  SMALLINT NOT NULL,
    codigo       VARCHAR(60),
    capturado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.patch6_documentos_snapshot IS
    'Instantánea previa al parche 6 (reclasificación RED-% a tipo 10). Se puede DROP tras validar.';

INSERT INTO core.patch6_documentos_snapshot (documento_id, tipo_previo, codigo)
SELECT id, tipo_id, codigo
FROM core.documentos
WHERE tipo_id = 15
  AND codigo LIKE 'RED-%'
ON CONFLICT (documento_id) DO NOTHING;


-- =============================================================================
-- 2. RECLASIFICACIÓN DOCUMENTAL (34 filas esperadas)
--    El código `RED-2026-0xx` viene de `DIM_Redaccion`; el tipo correcto es
--    Ayuda Memoria (id 10, anexo 12), no «Otro».
-- =============================================================================

UPDATE core.documentos
SET tipo_id    = 10,
    updated_at = now()
WHERE tipo_id = 15
  AND codigo LIKE 'RED-%';


-- =============================================================================
-- 3. CONTRATO DE GUARDRAILS: G1–G18 → G1–G25
--    El nombre del CHECK lo genera PostgreSQL; se descubre en vez de suponerlo.
--    Es la única alteración no aditiva del esquema.
-- =============================================================================

DO $$
DECLARE
    cname text;
BEGIN
    FOR cname IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'config.guardrail_contract'::regclass
          AND contype  = 'c'
          AND pg_get_constraintdef(oid) LIKE '%G1%'
    LOOP
        EXECUTE format('ALTER TABLE config.guardrail_contract DROP CONSTRAINT %I', cname);
    END LOOP;

    ALTER TABLE config.guardrail_contract
      ADD CONSTRAINT guardrail_contract_guardrail_check
      CHECK (guardrail IN (
        'G1','G2','G3','G4','G5','G6','G7','G8','G9','G10',
        'G11','G12','G13','G14','G15','G16','G17','G18',
        'G19','G20','G21','G22','G23','G24','G25'));
END $$;


COMMIT;


-- =============================================================================
-- 4. VERIFICACIÓN POSTERIOR
-- =============================================================================

-- 4.1 El CHECK ya admite G25. Esperado: definición que incluye 'G25'.
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'config.guardrail_contract'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%G1%';

-- 4.2 Ningún RED- queda en «Otro». Esperado: 0.
SELECT count(*) AS red_sin_reclasificar
FROM core.documentos
WHERE tipo_id = 15
  AND codigo LIKE 'RED-%';

-- 4.3 Reparto nuevo. Esperado: tipo 10 → 45, tipo 15 → 3 (los CT-2026).
SELECT tipo_id, count(*) AS filas
FROM core.documentos
GROUP BY tipo_id
ORDER BY tipo_id;

-- 4.4 Las 34 filas movidas son exactamente las de la instantánea. Esperado: 34 / 34.
SELECT
    (SELECT count(*) FROM core.patch6_documentos_snapshot)                    AS en_instantanea,
    (SELECT count(*) FROM core.documentos d
       JOIN core.patch6_documentos_snapshot s ON s.documento_id = d.id
      WHERE d.tipo_id = 10)                                                    AS movidas_ok;

-- 4.5 La prueba T108 del anexo legal sigue siendo válida: ningún documento puede
--     rotular «criminal» sin sentencia firme. Comprobación de que el tipo 15 no era
--     el refugio de esos documentos. Esperado: 0.
SELECT count(*) AS posibles_etiquetas_indebidas
FROM core.documentos
WHERE tipo_id = 15
  AND (titulo ILIKE '%criminal%' OR titulo ILIKE '%saboteador%');


-- =============================================================================
-- 5. ROLLBACK (ejecutar solo si 4.2–4.4 no cuadran)
-- =============================================================================
--
-- BEGIN;
--   UPDATE core.documentos d
--   SET tipo_id = s.tipo_previo,
--       updated_at = now()
--   FROM core.patch6_documentos_snapshot s
--   WHERE d.id = s.documento_id;
--
--   ALTER TABLE config.guardrail_contract
--     DROP CONSTRAINT guardrail_contract_guardrail_check;
--   ALTER TABLE config.guardrail_contract
--     ADD CONSTRAINT guardrail_contract_guardrail_check
--     CHECK (guardrail IN (
--       'G1','G2','G3','G4','G5','G6','G7','G8','G9','G10',
--       'G11','G12','G13','G14','G15','G16','G17','G18'));
-- COMMIT;
--
-- Tras validar, la instantánea se puede retirar:
--   DROP TABLE core.patch6_documentos_snapshot;


-- =============================================================================
-- 6. LO QUE ESTE PARCHE DEJA PENDIENTE (a propósito)
-- =============================================================================
--
-- a) Sembrar G19–G25 en `config.guardrail_contract`. El CHECK ya los admite, pero
--    las filas no existen: el contrato queda «abierto pero vacío». Requiere el texto
--    de cada guardrail (OAIPCS + OGTI).
-- b) `core.actor_datos_personales`: 847 filas con `dni` en claro (642) y
--    `fecha_consentimiento` = 0 en todas. Es un cambio de cifrado y de datos, no un
--    parche: exige decisión de OGTI sobre el par de claves (DC-05, DC-06).
-- c) `ssl=off` y rol único `avisa` con `rolsuper` + `rolbypassrls`: mientras eso no
--    cambie, el RLS de 169 políticas es inerte (DC-02). No se arregla con SQL de
--    parche.
-- d) `pgaudit`: no instalado. Sin él no hay bitácora inalterable verificable
--    (DC-09, DC-11).
