-- =============================================================================
-- PARCHE 7 — CONTRATO DE COMPORTAMIENTO DE LOS GUARDRAILS G19–G25
-- AVISA / OAIPCS · PRODUCE
--
-- Qué hace. Siembra 7 filas en `config.guardrail_contract`, una por guardrail
-- G19–G25, con la forma exacta que ya usan las 18 filas existentes (G1–G18):
--   input_dispara              → JSON pequeño que HACE FALLAR la regla
--   input_no_dispara           → JSON pequeño que LA PASA
--   output_esperado_dispara    → {"ok": false, "fix": {...}, "msg": "...", "code": "<CODE>"}
--   output_esperado_no_dispara → {"ok": true, "msg": null, "code": null}
--
-- Fuente normativa del texto y del reason code (no se inventa nada):
--   v10 §16.1.quater  → G19, G20, G21, G22
--   v10 §16.1.quinquies → G23, G24, G25
--   v10 §9.9          → el contrato de test sintético por guardrail
--
-- Severidad. Las 7 son `block`. §16.1.quater dice expresamente que estos
-- guardrails «rechazan, no solo advierten».
--
-- Qué NO hace.
--   - No toca las 18 filas G1–G18: el ON CONFLICT solo puede afectar a las
--     claves que este INSERT aporta (G19–G25).
--   - No toca `config.parametro` (lo usa otro parche).
--   No altera el CHECK de `guardrail`: el parche 6 ya lo amplió a G1–G25.
--
-- Idempotente. Re-ejecutable: `ON CONFLICT (guardrail) DO UPDATE` deja las 7
-- filas convergiendo al mismo contenido (también corrige una fila que se haya
-- desviado a mano). El conteo no cambia entre la primera y la segunda corrida.
--
-- Ejecución (forma obligatoria en este repo):
--   docker exec -i avisa-db psql -U avisa -d avisa -f - \
--     < docs/PARCHE_7_GUARDRAILS_G19_G25.sql
--
-- Antes de ejecutar: leer el bloque 0. Cada consulta de verificación indica el
-- resultado esperado; si alguno no coincide, DETENERSE.
-- =============================================================================


-- =============================================================================
-- 0. VERIFICACIÓN PREVIA (solo lectura)
-- =============================================================================

-- 0.1 Filas de contrato hoy. Esperado: 18, sin duplicados.
SELECT count(*) AS contratos,
       count(DISTINCT guardrail) AS distintos
FROM config.guardrail_contract;

-- 0.2 El CHECK ya admite G25 (lo hizo el parche 6). Esperado: definición que
--     contiene 'G25'. Si no lo contiene, este parche fallará en el INSERT.
SELECT conname, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'config.guardrail_contract'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%G1%';

-- 0.3 G19–G25 hoy no existen. Esperado: 0.
SELECT count(*) AS g19_g25_presentes
FROM config.guardrail_contract
WHERE guardrail IN ('G19','G20','G21','G22','G23','G24','G25');


BEGIN;

-- =============================================================================
-- 1. SIEMBRA DEL CONTRATO G19–G25 (7 filas)
--
--    Cada `input_dispara` contiene el valor que rompe la regla; cada
--    `input_no_dispara` cambia solo lo imprescindible para pasarla. Así el
--    caso negativo es legible y verificable sin ejecutar el motor.
-- =============================================================================

INSERT INTO config.guardrail_contract (
    guardrail,
    input_dispara,
    input_no_dispara,
    output_esperado_dispara,
    output_esperado_no_dispara,
    severidad
)
VALUES
    -- G19 — No reidentificación (v10 §16.1.quater).
    -- Un actor nivel 4 no puede quedar vinculado a un nombre civil; el alias sí
    -- es admisible y el caso va a HITL.
    (
        'G19',
        '{"nivel_identidad": 4, "vinculo_propuesto": "nombre_civil", "validado_humano": false}'::jsonb,
        '{"nivel_identidad": 4, "vinculo_propuesto": "alias", "validado_humano": false}'::jsonb,
        '{"ok": false, "fix": {"sustituir": "alias"}, "msg": "actor nivel 4 vinculado a nombre o documento sin validación humana", "code": "G19_REIDENTIFICACION"}'::jsonb,
        '{"ok": true, "msg": null, "code": null}'::jsonb,
        'block'
    ),
    -- G20 — Cita literal (v10 §16.1.quater).
    -- La fuente dice «Dejen trabajar a la gente»; la cita propuesta añade
    -- «de la caleta» y por tanto no existe literalmente: se descarta.
    (
        'G20',
        '{"texto_fuente": "Dejen trabajar a la gente", "cita_propuesta": "Dejen trabajar a la gente de la caleta", "offset_inicio": 412, "offset_fin": 437, "verificada_literal": false}'::jsonb,
        '{"texto_fuente": "Dejen trabajar a la gente", "cita_propuesta": "Dejen trabajar a la gente", "offset_inicio": 412, "offset_fin": 437, "verificada_literal": true}'::jsonb,
        '{"ok": false, "fix": {"descartar": "cita"}, "msg": "cita no literal en la fuente u offsets fuera del texto", "code": "G20_CITA_NO_LITERAL"}'::jsonb,
        '{"ok": true, "msg": null, "code": null}'::jsonb,
        'block'
    ),
    -- G21 — Aprobación humana antes de visibilidad (v10 §16.1.quater).
    -- Con `visibilidad` distinta de 'interna', `aprobada_por` nulo hace fallar el trigger;
    -- con aprobación registrada (usuario y fecha) la alerta es visible.
    (
        'G21',
        '{"visibilidad": "perfil_b", "aprobada_por": null, "aprobada_en": null}'::jsonb,
        '{"visibilidad": "perfil_b", "aprobada_por": "3f9c2a41-7b8e-4d6f-9a01-5c2e8b7d4a63", "aprobada_en": "2026-11-18T10:15:00-05:00"}'::jsonb,
        '{"ok": false, "fix": {"restringir": "visibilidad interna"}, "msg": "alerta visible a perfiles B o C sin aprobación humana", "code": "G21_SIN_APROBACION"}'::jsonb,
        '{"ok": true, "msg": null, "code": null}'::jsonb,
        'block'
    ),
    -- G22 — Fuente permitida (v10 §16.1.quater, lista blanca de §7.5.v10).
    -- Recolección por scraping de un grupo privado: fuera de lista y sin API
    -- oficial. La cuenta aprobada por API oficial sí pasa.
    (
        'G22',
        '{"tipo": "red_social", "plataforma": "Facebook", "cuenta": "grupo pescadores caleta X", "via": "scraping", "en_lista_blanca": false}'::jsonb,
        '{"tipo": "red_social", "plataforma": "X", "cuenta": "@gremio_ejemplo", "via": "api_oficial", "en_lista_blanca": true}'::jsonb,
        '{"ok": false, "fix": {"rechazar": "fuente"}, "msg": "fuente fuera de la lista blanca o sin API oficial", "code": "G22_FUENTE_NO_PERMITIDA"}'::jsonb,
        '{"ok": true, "msg": null, "code": null}'::jsonb,
        'block'
    ),
    -- G23 — Nivel Alto antes que dato (v10 §16.1.quinquies).
    -- Sin base legal ni consentimiento, el DNI no se escribe. Con base legal
    -- registrada (Ley N.° 29733) la escritura pasa aunque no haya consentimiento.
    (
        'G23',
        '{"campo": "dni", "base_legal": null, "consentimiento": false}'::jsonb,
        '{"campo": "dni", "base_legal": "Ley N.° 29733 art. 5", "consentimiento": false}'::jsonb,
        '{"ok": false, "fix": {"rechazar": "escritura"}, "msg": "dato personal sin base legal ni consentimiento vigente", "code": "G23_SIN_BASE_LEGAL"}'::jsonb,
        '{"ok": true, "msg": null, "code": null}'::jsonb,
        'block'
    ),
    -- G24 — Identidad sintética por defecto (v10 §16.1.quinquies).
    -- Un perfil B recibe el código sintético `ANI-*`; si la proyección trae el
    -- nombre civil desde la tabla de datos personales, falla.
    (
        'G24',
        '{"perfil": "B", "tipo_identificador": "nombre_civil", "identificador": "A. Quispe", "proyecta_pii": true}'::jsonb,
        '{"perfil": "B", "tipo_identificador": "sintetico", "identificador": "ANI-0421", "proyecta_pii": false}'::jsonb,
        '{"ok": false, "fix": {"sustituir": "identificador_sintetico"}, "msg": "salida no analista expone nombre o documento del actor", "code": "G24_REIDENTIFICACION_EN_SALIDA"}'::jsonb,
        '{"ok": true, "msg": null, "code": null}'::jsonb,
        'block'
    ),
    -- G25 — Sin etiqueta penal sin sentencia (v10 §16.1.quinquies).
    -- `bajo_investigacion` no puede aparecer en el portal. Con
    -- `tipo_situacion = 'sentencia_firme'` y `documento_uri` poblado, sí.
    (
        'G25',
        '{"etiqueta": "criminal", "tipo_situacion": "bajo_investigacion", "sentencia_firme": false, "documento_uri": null, "destino": "portal"}'::jsonb,
        '{"etiqueta": "sentencia_firme", "tipo_situacion": "sentencia_firme", "sentencia_firme": true, "documento_uri": "s3://avisa-judicial/RES-2026-0431.pdf", "destino": "portal"}'::jsonb,
        '{"ok": false, "fix": {"quitar": "etiqueta"}, "msg": "etiqueta penal sin sentencia firme con documento", "code": "G25_ETIQUETA_SIN_SENTENCIA"}'::jsonb,
        '{"ok": true, "msg": null, "code": null}'::jsonb,
        'block'
    )
ON CONFLICT (guardrail) DO UPDATE
    SET input_dispara              = EXCLUDED.input_dispara,
        input_no_dispara           = EXCLUDED.input_no_dispara,
        output_esperado_dispara    = EXCLUDED.output_esperado_dispara,
        output_esperado_no_dispara = EXCLUDED.output_esperado_no_dispara,
        severidad                  = EXCLUDED.severidad;

COMMIT;


-- =============================================================================
-- 2. VERIFICACIÓN POSTERIOR
-- =============================================================================

-- 2.1 Total y ausencia de duplicados. Esperado: 25 / 25.
SELECT count(*) AS contratos,
       count(DISTINCT guardrail) AS distintos
FROM config.guardrail_contract;

-- 2.2 Reparto por severidad. Esperado: block 22, warn 3 (total 25).
SELECT severidad, count(*) AS filas
FROM config.guardrail_contract
GROUP BY severidad
ORDER BY severidad;

-- 2.3 Listado ordenado numéricamente. Esperado: G1 … G25, 25 filas, sin huecos.
SELECT guardrail,
       severidad,
       output_esperado_dispara->>'code' AS reason_code
FROM config.guardrail_contract
ORDER BY (substring(guardrail FROM 2))::int;

-- 2.4 Solo G19–G25. Esperado: 7 filas, todas `block`, con estos códigos:
--     G19_REIDENTIFICACION, G20_CITA_NO_LITERAL, G21_SIN_APROBACION,
--     G22_FUENTE_NO_PERMITIDA, G23_SIN_BASE_LEGAL,
--     G24_REIDENTIFICACION_EN_SALIDA, G25_ETIQUETA_SIN_SENTENCIA.
SELECT guardrail,
       severidad,
       output_esperado_dispara->>'code'    AS code_dispara,
       output_esperado_no_dispara->>'ok'   AS ok_no_dispara,
       output_esperado_no_dispara->>'code' AS code_no_dispara
FROM config.guardrail_contract
WHERE guardrail IN ('G19','G20','G21','G22','G23','G24','G25')
ORDER BY (substring(guardrail FROM 2))::int;

-- 2.5 Contrato completo de las 7 filas nuevas, para revisión de contenido.
SELECT guardrail,
       input_dispara,
       input_no_dispara,
       output_esperado_dispara,
       output_esperado_no_dispara
FROM config.guardrail_contract
WHERE guardrail IN ('G19','G20','G21','G22','G23','G24','G25')
ORDER BY (substring(guardrail FROM 2))::int;

-- 2.6 Las 18 filas previas no se alteraron. Esperado: 18 y todas con su código
--     original (G1_PRIV … G18_CITES).
SELECT count(*) AS g1_g18
FROM config.guardrail_contract
WHERE (substring(guardrail FROM 2))::int BETWEEN 1 AND 18;


-- =============================================================================
-- 3. ROLLBACK (ejecutar solo si 2.1–2.4 no cuadran)
-- =============================================================================
--
-- BEGIN;
--   DELETE FROM config.guardrail_contract
--   WHERE guardrail IN ('G19','G20','G21','G22','G23','G24','G25');
-- COMMIT;
--
-- Deja la base como estaba tras el parche 6: 18 filas y el CHECK aún admitiendo
-- G25 (el CHECK no lo revierte este parche; para eso, ver PARCHE_6 §5).


-- =============================================================================
-- 4. LO QUE ESTE PARCHE DEJA PENDIENTE (a propósito)
-- =============================================================================
--
-- a) El contrato es una ESPECIFICACIÓN ejecutable, no la implementación. Los
--    triggers y validaciones que hacen cumplir G19–G25 en tiempo de ejecución
--    (trigger de visibilidad de G21, vista que no proyecta PII de G24,
--    verificación de offsets de G20) no existen todavía en el esquema.
-- b) G21 supone una tabla de alertas con `visibilidad`, `aprobada_por` y
--    `aprobada_en`. `core.alertas_tempranas` no las tiene hoy: el guardrail fija
--    el contrato antes que la columna, a propósito (v10 §16.1.quater).
-- c) `core.situacion_judicial_restricta` (G25) está definida en v10 §13.6.bis.v10
--    y §2.3.bis, pero no se crea en este parche.
-- d) La lista blanca de fuentes (G22) vive en `config.parametro` y la siembra
--    otro parche; aquí solo se fija el comportamiento esperado.
