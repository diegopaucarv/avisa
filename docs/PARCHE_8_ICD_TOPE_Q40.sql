-- =============================================================================
-- PARCHE 8 — ICD: TOPE DE ±10 PUNTOS DEL AJUSTE AUTOMÁTICO (Q40)
-- AVISA / OAIPCS · PRODUCE
--
-- Qué hace. Hace efectiva la decisión Q40, que hasta hoy solo existía en prosa:
--   1. Siembra en `config.parametro` el tope del ajuste automático del ICD, bajo
--      el código `ICD.ajuste_tope_puntos` (valor 10, unidad «puntos»).
--   2. Crea `core.icd_aplicar_ajuste(p_base, p_ajuste)`, que devuelve en una sola
--      fila el ICD del analista, el ajuste propuesto, el ajuste aplicado, si hubo
--      recorte y el ICD final, SIN mezclar ambos números.
--
-- Qué NO hace.
--   - No persiste ningún ICD: no existe (ni se crea aquí) tabla de ICD. El
--     cálculo del ICD del analista sigue siendo `(suma ÷ 24) × 100` sobre las
--     seis condiciones con evidencia (mvp.md K5).
--   - No calcula el ajuste automático: solo lo acota y lo deja explícito.
--   - No toca `config.guardrail_contract` (parche 7, otro frente) ni tablas de
--     actores.
--
-- Evidencia.
--   - `mvp.md` §4.1 K5: ICD 0–100, seis condiciones con evidencia, «más un ajuste
--     automático acotado a ±10 puntos y mostrado aparte, rotulado PROXY».
--   - `AVISA_PRODUCE_v10.md` §8.4.ter (decisión v10 sobre K5) y §18.ter, Q40:
--     el ajuste queda acotado a ±10 y se muestra como línea aparte («ICD del
--     analista» y «ajuste automático»), nunca mezclado.
--
-- Competencia del parámetro. El tope NO se codifica en la función: se lee de
-- `config.parametro` en cada llamada. Si la Dirección OAIPCS confirma otro valor
-- (Q40 sigue abierta en `docs/INDICE.md` §5), basta con sustituir la fila del
-- parámetro; la función no se reescribe.
--
-- Idempotencia. El INSERT usa `ON CONFLICT (codigo) WHERE valid_to IS NULL`
-- contra el índice único parcial `ux_parametro_vigente`; la función usa
-- `CREATE OR REPLACE`. Se puede re-ejecutar sin efectos acumulativos.
--
-- Ejecución prevista:
--   docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--     -f - < docs/PARCHE_8_ICD_TOPE_Q40.sql
--
-- Antes de ejecutar: leer el bloque 0. Cada verificación indica el resultado
-- esperado; si alguno no coincide, DETENERSE.
-- =============================================================================


-- =============================================================================
-- 0. VERIFICACIÓN PREVIA (solo lectura)
-- =============================================================================

-- 0.1 Estado del parámetro antes de sembrarlo. En una base limpia: 0 filas.
--     Si el parche ya se aplicó: 1 fila vigente con valor 10 (es normal).
SELECT id, codigo, valor, tipo, unidad, valid_from, valid_to
FROM config.parametro
WHERE codigo = 'ICD.ajuste_tope_puntos';

-- 0.2 Estado de la función antes de crearla. En una base limpia: 0 filas.
--     Si el parche ya se aplicó: 1 fila (es normal; se reemplaza más abajo).
SELECT n.nspname AS esquema,
       p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core'
  AND p.proname = 'icd_aplicar_ajuste';

-- 0.3 Parámetros vigentes hoy: 16 antes del parche, 17 después. Ninguno con
--     código ICD antes de aplicarlo.
SELECT codigo, valor, tipo, unidad
FROM config.parametro
WHERE valid_to IS NULL
ORDER BY codigo;


BEGIN;

-- =============================================================================
-- 1. PARÁMETRO DEL TOPE (Q40)
--    `valor` es jsonb: se guarda como número JSON (10), no como texto "10".
--    Si ya existe una fila vigente, `ON CONFLICT` no la duplica ni la sobrescribe.
-- =============================================================================

INSERT INTO config.parametro (codigo, valor, tipo, unidad, descripcion)
VALUES (
    'ICD.ajuste_tope_puntos',
    '10'::jsonb,
    'numero',
    'puntos',
    'Q40: tope absoluto del ajuste automático del ICD; se muestra aparte y rotulado PROXY'
)
ON CONFLICT (codigo) WHERE valid_to IS NULL DO NOTHING;

-- 1.1 Control de divergencia. Si alguien ya había sembrado el parámetro con otro
--     valor, el parche no lo pisa en silencio: avisa. La función tomará el valor
--     vivo de la tabla, que es el que manda.
DO $$
DECLARE
    v_valor numeric;
BEGIN
    SELECT (valor #>> '{}')::numeric
      INTO v_valor
      FROM config.parametro
     WHERE codigo = 'ICD.ajuste_tope_puntos'
       AND valid_to IS NULL;

    IF v_valor IS NULL THEN
        RAISE EXCEPTION 'ICD.ajuste_tope_puntos quedó sin fila vigente: revisar config.parametro';
    ELSIF v_valor <> 10 THEN
        RAISE WARNING 'ICD.ajuste_tope_puntos ya existía con valor %; no se sobrescribe. Revisar Q40 antes de operar.', v_valor;
    END IF;
END $$;


-- =============================================================================
-- 2. FUNCIÓN DE ACOTADO
--
--    Contrato:
--      p_base    ICD del analista (0–100, calculado con evidencia). Obligatorio.
--      p_ajuste  ajuste automático propuesto (puede ser NULL).
--
--    Reglas:
--      - p_base NULL          → excepción 22004 (no se inventa un ICD).
--      - falta el parámetro   → excepción P0002 con indicación de ejecutar este
--                               parche.
--      - p_ajuste NULL        → ajuste_aplicado = 0, ajuste_recortado = false.
--      - p_ajuste fuera de ±tope → se recorta y ajuste_recortado = true.
--      - icd_final = greatest(0, least(100, icd_analista + ajuste_aplicado)).
--
--    La fila devuelve los dos números por separado: quien consuma la función
--    puede mostrar «ICD del analista» y «ajuste automático» en líneas distintas,
--    que es exactamente lo que Q40 exige. `icd_final` es solo el total saneado.
-- =============================================================================

CREATE OR REPLACE FUNCTION core.icd_aplicar_ajuste(p_base numeric, p_ajuste numeric)
RETURNS TABLE (
    icd_analista     numeric,
    ajuste_propuesto numeric,
    ajuste_aplicado  numeric,
    ajuste_recortado boolean,
    icd_final        numeric
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_tope numeric;
BEGIN
    IF p_base IS NULL THEN
        RAISE EXCEPTION 'ICD: la base del analista (p_base) es obligatoria; no se sustituye por un valor inventado'
            USING ERRCODE = 'null_value_not_allowed',
                  HINT = 'Calcular el ICD del analista con las seis condiciones y su evidencia (mvp.md K5).';
    END IF;

    SELECT (valor #>> '{}')::numeric
      INTO v_tope
      FROM config.parametro
     WHERE codigo = 'ICD.ajuste_tope_puntos'
       AND valid_to IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ICD: falta el parámetro vigente config.parametro(codigo = ''ICD.ajuste_tope_puntos'')'
            USING ERRCODE = 'no_data_found',
                  HINT = 'Ejecutar docs/PARCHE_8_ICD_TOPE_Q40.sql (Q40: tope de ±10 puntos).';
    END IF;

    IF v_tope IS NULL OR v_tope < 0 THEN
        RAISE EXCEPTION 'ICD: el tope del ajuste debe ser un número mayor o igual que 0 (valor leído: %)', v_tope
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    icd_analista     := p_base;
    ajuste_propuesto := p_ajuste;

    IF p_ajuste IS NULL THEN
        ajuste_aplicado  := 0;
        ajuste_recortado := false;
    ELSE
        ajuste_aplicado  := greatest(-v_tope, least(v_tope, p_ajuste));
        ajuste_recortado := (ajuste_aplicado <> p_ajuste);
    END IF;

    icd_final := greatest(0, least(100, icd_analista + ajuste_aplicado));

    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION core.icd_aplicar_ajuste(numeric, numeric) IS
    'Q40 (AVISA_PRODUCE_v10.md §18.ter; decisión v10 en §8.4.ter y mvp.md K5): '
    'acota el ajuste automático del ICD al tope vigente en config.parametro '
    '(codigo = ''ICD.ajuste_tope_puntos'', hoy 10) y devuelve ICD del analista y '
    'ajuste aplicado en columnas separadas, rotulable como PROXY. Nunca mezcla '
    'la evaluación del analista con la corrección de la máquina.';

COMMIT;


-- =============================================================================
-- 3. VERIFICACIÓN POSTERIOR
-- =============================================================================

-- 3.1 El parámetro quedó sembrado y vigente.
--     Esperado: 1 fila, valor 10, tipo numero, unidad puntos, valid_to NULL.
SELECT codigo, valor, tipo, unidad, valid_to,
       valor = '10'::jsonb AS valor_es_10
FROM config.parametro
WHERE codigo = 'ICD.ajuste_tope_puntos'
  AND valid_to IS NULL;

-- 3.2 Firma y comentario. Esperado: 1 fila con los cinco parámetros de salida
--     y el comentario citando Q40.
SELECT p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos_entrada,
       pg_get_function_result(p.oid) AS resultado,
       obj_description(p.oid, 'pg_proc') AS comentario
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core'
  AND p.proname = 'icd_aplicar_ajuste';

-- 3.3 Tabla de casos (la misma del informe P8_ICD_Q40.md).
--     Esperado, en este orden:
--       +15 sobre 70  → aplicado +10, recortado true,  final 80
--       -3  sobre 70  → aplicado  -3, recortado false, final 67
--       +10 sobre 95  → aplicado +10, recortado false, final 100
--       -10 sobre  5  → aplicado -10, recortado false, final 0
--       NULL sobre 70 → aplicado   0, recortado false, final 70
SELECT v.orden,
       v.caso,
       a.icd_analista,
       a.ajuste_propuesto,
       a.ajuste_aplicado,
       a.ajuste_recortado,
       a.icd_final
FROM (VALUES
    (1, '+15 se recorta a +10',   70::numeric,  15::numeric),
    (2, '-3 queda tal cual',       70::numeric,  -3::numeric),
    (3, '95 + 10 tope superior',   95::numeric,  10::numeric),
    (4, '5 - 10 tope inferior',     5::numeric, -10::numeric),
    (5, 'ajuste NULL cuenta 0',    70::numeric,  NULL::numeric)
) AS v(orden, caso, base, ajuste)
CROSS JOIN LATERAL core.icd_aplicar_ajuste(v.base, v.ajuste) a
ORDER BY v.orden;

-- 3.4 Todos los recortes posibles en una sola llamada. Esperado:
--     +11 → +10, -11 → -10, +10 → +10, -10 → -10, 0 → 0 (recortado solo los dos primeros).
SELECT v.ajuste_propuesto,
       v.caso,
       a.ajuste_aplicado,
       a.ajuste_recortado,
       a.icd_final
FROM (VALUES
    ( 11::numeric, 'excede por arriba'),
    (-11::numeric, 'excede por abajo'),
    ( 10::numeric, 'justo en el borde superior'),
    (-10::numeric, 'justo en el borde inferior'),
    (  0::numeric, 'sin ajuste')
) AS v(ajuste_propuesto, caso)
CROSS JOIN LATERAL core.icd_aplicar_ajuste(60::numeric, v.ajuste_propuesto) a
ORDER BY v.ajuste_propuesto DESC;

-- 3.5 La base NULL no se inventa: debe lanzar excepción 22004.
--     Esperado: NOTICE «OK 3.5 … SQLSTATE 22004 …». Si no aparece el NOTICE y en
--     su lugar se ve «FALLO», la función está devolviendo un valor fabricado.
DO $$
DECLARE
    v_msg text;
    v_sqlstate text;
BEGIN
    PERFORM core.icd_aplicar_ajuste(NULL::numeric, 5::numeric);
    RAISE EXCEPTION 'FALLO 3.5: p_base NULL no lanzó excepción';
EXCEPTION
    WHEN null_value_not_allowed THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
        RAISE NOTICE 'OK 3.5: p_base NULL lanza SQLSTATE % — %', v_sqlstate, v_msg;
END $$;

-- 3.6 La función referencia el parámetro (no lo incrusta). Comprobación estática:
--     el cuerpo cita `ICD.ajuste_tope_puntos`. La prueba de comportamiento es 3.7,
--     que es la que vale: un análisis textual de literales daría falsos positivos
--     (el mensaje de la excepción también contiene «10»).
--     Esperado: lee_parametro true, menciones 2 (una en el SELECT del parámetro
--     y otra en el mensaje de la excepción; ninguna es el valor del tope).
SELECT (pg_get_functiondef(p.oid) LIKE '%ICD.ajuste_tope_puntos%') AS lee_parametro,
       (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'ICD.ajuste_tope_puntos', '')))
         / length('ICD.ajuste_tope_puntos')                       AS menciones
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'core'
  AND p.proname = 'icd_aplicar_ajuste';

-- 3.7 Prueba de que el tope sigue al parámetro: se cambia a 3 dentro de una
--     transacción desechable y +15 debe recortarse a +3. Al hacer ROLLBACK el
--     parámetro vuelve a 10; no queda rastro.
--     Esperado: 3 | t | 73 y, después, valor 10.
BEGIN;
UPDATE config.parametro
   SET valor = '3'::jsonb
 WHERE codigo = 'ICD.ajuste_tope_puntos'
   AND valid_to IS NULL;

SELECT ajuste_propuesto, ajuste_aplicado, ajuste_recortado, icd_final
FROM core.icd_aplicar_ajuste(70::numeric, 15::numeric);

ROLLBACK;

SELECT valor AS valor_tras_rollback
FROM config.parametro
WHERE codigo = 'ICD.ajuste_tope_puntos'
  AND valid_to IS NULL;

-- 3.8 Idempotencia del parámetro: no hay duplicados vigentes.
--     Esperado: 1.
SELECT count(*) AS filas_vigentes
FROM config.parametro
WHERE codigo = 'ICD.ajuste_tope_puntos'
  AND valid_to IS NULL;


-- =============================================================================
-- 4. ROLLBACK (ejecutar solo si 3.1–3.8 no cuadran)
-- =============================================================================
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS core.icd_aplicar_ajuste(numeric, numeric);
--   DELETE FROM config.parametro
--    WHERE codigo = 'ICD.ajuste_tope_puntos'
--      AND descripcion LIKE 'Q40:%';
-- COMMIT;
--
-- El DROP es seguro: la función no está referenciada por triggers ni vistas.
-- El DELETE se acota por descripción para no borrar una fila que ya existiera
-- con otro origen (si el parche solo emitió un WARNING en 0.4).
