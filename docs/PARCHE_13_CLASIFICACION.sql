-- =============================================================================
-- PARCHE 13 - NIVEL DE CLASIFICACION: UNA SOLA FORMA DE ESCRIBIRLO
-- AVISA / SIPRECS - OAIPCS, Ministerio de la Produccion del Peru
-- =============================================================================
--
-- QUE HACE
--
-- Cierra el ultimo hueco del modelo en el campo `nivel_clasificacion`. El campo
-- ya era numerico con clave ajena al catalogo en 58 de las 59 columnas que lo
-- usan; sobraba una excepcion y sobraba una redaccion distinta en cinco
-- comentarios.
--
--   1. consultation.procesos.nivel_clasificacion pasa de varchar(20) a smallint
--      y gana la clave ajena a core.cat_clasificacion, como las otras 58.
--   2. Los cinco comentarios que decian "público / interno / sensible" pasan a
--      decir "público / reservado / confidencial", que es el vocabulario del
--      catalogo y el de los otros 47 comentarios.
--   3. core.cat_clasificacion deja de escribir "Publico" sin tilde.
--
-- POR QUE
--
-- Un campo de tres valores no puede tener dos vocabularios. "Interno" y
-- "sensible" no existen en core.cat_clasificacion: quien leyera el diccionario
-- habria supuesto dos niveles que la base no tiene. Y una columna de texto
-- obliga a comparar cadenas donde las otras 58 comparan enteros con clave ajena.
--
-- LO QUE NO SE HACE, Y POR QUE
--
-- No se añade un CHECK (nivel_clasificacion BETWEEN 1 AND 3) a las 53 tablas.
-- La clave ajena ya limita el valor a los tres que existen en el catalogo, y
-- ese catalogo no admite borrados mientras haya filas que lo referencien. Un
-- CHECK repetido 53 veces no añadiria ninguna garantia: añadiria 53 objetos al
-- esquema y engordaria el inventario sin cambiar el comportamiento. La regla
-- queda escrita en el comentario de cada columna.
--
--   Regla canonica: nivel_clasificacion es smallint NOT NULL con clave ajena a
--   core.cat_clasificacion; 1 = publico, 2 = reservado, 3 = confidencial.
--
-- HECHOS VERIFICADOS ANTES DE ESCRIBIR EL PARCHE
--
-- a) 59 columnas se llaman nivel_clasificacion: 53 tablas logicas y 6
--    particiones de agent.llm_call. Las 59 son NOT NULL.
-- b) 58 son smallint con clave ajena `*_nivel_clasificacion_fkey`. La unica de
--    texto es consultation.procesos, varchar(20) NOT NULL DEFAULT 'Reservado'.
-- c) consultation.procesos tiene 0 filas. Por eso el cambio de tipo no necesita
--    mapear datos: se conserva el valor por defecto, traducido a 2.
-- d) Los valores almacenados son solo 1, 2 y 3 (1 -> 10 filas, 2 -> 2 184,
--    3 -> 1 996). No hay ningun valor fuera del catalogo.
-- e) La redaccion "interno/sensible" aparece en 5 comentarios y "etiqueta" en 1.
--    Vive en la curaduria, no en este archivo: se corrige en
--    migration/curacion_v10_columnas.py y el parche 12 la reescribe.
-- f) Nada en el codigo compara contra la cadena 'Publico': la clave ajena es
--    por numero. La tilde del catalogo es solo el nombre visible.
--
-- EJECUCION
--
--   docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
--       -f /tmp/PARCHE_13_CLASIFICACION.sql
--
-- Es idempotente: si la columna ya es smallint, no hace nada; si la clave ajena
-- ya existe, no la duplica. Se puede repetir sin efecto.
-- =============================================================================


\set ON_ERROR_STOP on

BEGIN;


-- =============================================================================
-- 1. VERIFICACION PREVIA
--    Aborta antes de tocar nada si el estado no es el esperado. Es preferible
--    fallar aqui que dejar media migracion aplicada.
-- =============================================================================

DO $$
DECLARE
    v_tipo  text;
    v_filas bigint;
BEGIN
    SELECT data_type INTO v_tipo
    FROM information_schema.columns
    WHERE table_schema = 'consultation'
      AND table_name   = 'procesos'
      AND column_name  = 'nivel_clasificacion';

    IF v_tipo IS NULL THEN
        RAISE EXCEPTION 'no existe consultation.procesos.nivel_clasificacion';
    END IF;

    IF v_tipo NOT IN ('smallint', 'character varying') THEN
        RAISE EXCEPTION 'tipo inesperado en consultation.procesos.nivel_clasificacion: %', v_tipo;
    END IF;

    SELECT count(*) INTO v_filas FROM consultation.procesos;
    IF v_tipo <> 'smallint' AND v_filas > 0 THEN
        RAISE EXCEPTION
            'consultation.procesos tiene % filas con etiquetas de texto: hay que mapearlas antes de migrar',
            v_filas;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM core.cat_clasificacion WHERE nivel = 1)
       OR NOT EXISTS (SELECT 1 FROM core.cat_clasificacion WHERE nivel = 2)
       OR NOT EXISTS (SELECT 1 FROM core.cat_clasificacion WHERE nivel = 3) THEN
        RAISE EXCEPTION 'core.cat_clasificacion no tiene los tres niveles: la clave ajena fallaria';
    END IF;

    RAISE NOTICE 'verificacion previa correcta: tipo=% filas=%', v_tipo, v_filas;
END $$;


-- =============================================================================
-- 2. consultation.procesos: DE TEXTO A NUMERO CON CLAVE AJENA
--    El USING traduce las etiquetas del catalogo por si la tabla tuviera filas
--    en algun entorno anterior a este parche. Hoy tiene cero, pero el mapeo
--    deja el archivo utilizable en una copia con datos.
-- =============================================================================

DO $$
DECLARE
    v_tipo text;
BEGIN
    SELECT data_type INTO v_tipo
    FROM information_schema.columns
    WHERE table_schema = 'consultation'
      AND table_name   = 'procesos'
      AND column_name  = 'nivel_clasificacion';

    IF v_tipo = 'smallint' THEN
        RAISE NOTICE 'consultation.procesos.nivel_clasificacion ya es smallint: nada que convertir';
    ELSE
        -- El valor por defecto era 'Reservado' (nivel 2). Se retira para poder
        -- cambiar el tipo y se vuelve a poner al final, ya como numero.
        ALTER TABLE consultation.procesos
            ALTER COLUMN nivel_clasificacion DROP DEFAULT;

        ALTER TABLE consultation.procesos
            ALTER COLUMN nivel_clasificacion TYPE smallint
            USING (
                CASE upper(trim(nivel_clasificacion))
                    WHEN 'PÚBLICO'     THEN 1
                    WHEN 'PUBLICO'     THEN 1
                    WHEN 'RESERVADO'   THEN 2
                    WHEN 'CONFIDENCIAL' THEN 3
                    ELSE NULL
                END
            );

        ALTER TABLE consultation.procesos
            ALTER COLUMN nivel_clasificacion SET DEFAULT 2;

        RAISE NOTICE 'consultation.procesos.nivel_clasificacion convertida a smallint';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'consultation.procesos'::regclass
          AND conname  = 'procesos_nivel_clasificacion_fkey'
    ) THEN
        ALTER TABLE consultation.procesos
            ADD CONSTRAINT procesos_nivel_clasificacion_fkey
            FOREIGN KEY (nivel_clasificacion)
            REFERENCES core.cat_clasificacion (nivel);
        RAISE NOTICE 'clave ajena procesos_nivel_clasificacion_fkey creada';
    ELSE
        RAISE NOTICE 'la clave ajena ya existia';
    END IF;
END $$;


-- =============================================================================
-- 3. EL CATALOGO, SIN FALTA DE TILDE
--    "Publico" era la unica entrada del catalogo escrita sin tilde. No se
--    compara por nombre en ningun sitio (la clave ajena es por numero), asi que
--    alinearla no rompe nada y evita que el nombre visible salga mal escrito.
-- =============================================================================

UPDATE core.cat_clasificacion
   SET nombre = 'Público'
 WHERE nivel = 1
   AND nombre = 'Publico';


-- =============================================================================
-- 4. VERIFICACION
--    Cada consulta dice lo que se espera. Si algo no cuadra, la seccion 5
--    explica como volver atras.
-- =============================================================================

-- 4.1 Tipo y nulabilidad de la columna migrada. Esperado: smallint | NO | 2.
SELECT data_type,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'consultation'
  AND table_name   = 'procesos'
  AND column_name  = 'nivel_clasificacion';

-- 4.2 La clave ajena existe y apunta al catalogo. Esperado: 1 fila.
SELECT con.conname,
       pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
WHERE con.conrelid = 'consultation.procesos'::regclass
  AND con.contype  = 'f';

-- 4.3 Ninguna columna nivel_clasificacion queda en texto. Esperado: 0.
SELECT count(*) AS columnas_de_texto
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'public', 'legacy')
  AND column_name = 'nivel_clasificacion'
  AND data_type <> 'smallint';

-- 4.4 Todas las columnas del campo tienen clave ajena al catalogo.
--     Esperado: 59 columnas y 59 con clave ajena.
SELECT count(*) AS columnas,
       count(*) FILTER (WHERE EXISTS (
           SELECT 1
           FROM pg_constraint con
           WHERE con.conrelid = c.oid
             AND con.contype  = 'f'
             AND pg_get_constraintdef(con.oid) LIKE '%cat_clasificacion%'
       )) AS con_clave_ajena
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public', 'legacy')
  AND a.attname = 'nivel_clasificacion';

-- 4.5 Ningun comentario conserva el vocabulario "interno/sensible".
--     Esperado: 0.
SELECT count(*) AS comentarios_con_vocabulario_viejo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public', 'legacy')
  AND a.attname = 'nivel_clasificacion'
  AND (col_description(c.oid, a.attnum) ILIKE '%interno%'
       OR col_description(c.oid, a.attnum) ILIKE '%sensible%');

-- 4.6 Ningun valor fuera del catalogo. Esperado: 0 en las tres columnas
--     (una consulta por tabla quedaria en 53; se comprueba el agregado con las
--     tres que tienen datos).
SELECT
    (SELECT count(*) FROM core.casos  WHERE nivel_clasificacion NOT BETWEEN 1 AND 3) AS casos,
    (SELECT count(*) FROM core.documentos WHERE nivel_clasificacion NOT BETWEEN 1 AND 3) AS documentos,
    (SELECT count(*) FROM core.actores WHERE nivel_clasificacion NOT BETWEEN 1 AND 3) AS actores;

-- 4.7 El catalogo ya dice "Público". Esperado: 1 | Público.
SELECT nivel, nombre FROM core.cat_clasificacion ORDER BY nivel;


COMMIT;


-- =============================================================================
-- 5. ROLLBACK (ejecutar solo si la seccion 4 no cuadra)
-- =============================================================================
--
-- BEGIN;
--   ALTER TABLE consultation.procesos
--       DROP CONSTRAINT IF EXISTS procesos_nivel_clasificacion_fkey;
--   ALTER TABLE consultation.procesos
--       ALTER COLUMN nivel_clasificacion DROP DEFAULT;
--   ALTER TABLE consultation.procesos
--       ALTER COLUMN nivel_clasificacion TYPE varchar(20)
--       USING (CASE nivel_clasificacion
--                WHEN 1 THEN 'Público'
--                WHEN 2 THEN 'Reservado'
--                WHEN 3 THEN 'Confidencial'
--              END);
--   ALTER TABLE consultation.procesos
--       ALTER COLUMN nivel_clasificacion SET DEFAULT 'Reservado';
--   UPDATE core.cat_clasificacion SET nombre = 'Publico' WHERE nivel = 1;
-- COMMIT;
--
-- Es reversible sin perdida: la tabla estaba vacia antes del parche, y el
-- catalogo solo cambia el nombre visible, nunca el numero que usan las claves
-- ajenas.
-- =============================================================================


-- =============================================================================
-- 6. LO QUE ESTE PARCHE DEJA PENDIENTE (a proposito)
-- =============================================================================
--
-- a) consultation.procesos sigue sin datos y sin tabla de origen en el legado.
--    El parche la alinea con el resto del modelo, pero no la rellena: decidir
--    de donde sale cada consulta es materia de otro analisis.
-- b) Las otras columnas de texto de esa tabla (fase_actual, estado,
--    pueblo_indigena) siguen siendo texto libre. No son niveles cerrados y no
--    hay catalogo al que apuntarlas; forzarlas seria inventar el vocabulario.
-- c) El diseno de docs/AVISA_PRODUCE_v10.md se corrige en el mismo commit: el
--    diagrama de kag.nodos gana created_at y updated_at, y esta tabla deja de
--    figurar con el nivel en texto.
-- =============================================================================
