-- =====================================================================
--  AVISA · Paso 3 · Normalización de tipos para SSMA
-- =====================================================================
--  PARA QUÉ
--  SSMA (SQL Server Migration Assistant) no traduce tres cosas importantes
--  de este esquema:
--
--    · DEFAULT gen_random_uuid() sobre columnas uuid  → aborta el DDL o lo
--      descarta en silencio, y el INSERT posterior sin id falla.
--    · columnas ARRAY                                  → las deja como
--      «unssupported type» y la tabla no se crea.
--    · timestamptz → el asistente ofrece datetime2 y PIERDE el huso.
--
--  Este script deja la base en el estado que el asistente sí entiende:
--
--    · retira el DEFAULT de las columnas uuid (sin tocar los datos);
--    · convierte a texto JSON cualquier columna array, sólo si la hay;
--    · deja jsonb intacto y documenta su mapeo a nvarchar(max);
--    · NO toca los timestamptz: recomienda datetimeoffset(7). La conversión
--      a timestamp sin zona existe, pero está separada y DESACTIVADA.
--
--  DÓNDE SE EJECUTA
--  Sólo en avisa_mssql. Contra cualquier otra base aborta (bloque 0).
--
--      cd C:\Users\Julia\Downloads\avisa
--      cat migration/mssql/02_normalizar_tipos.sql \
--        | docker compose exec -T db psql -U avisa -d avisa_mssql
--
--  IDEMPOTENTE
--  Se puede ejecutar dos veces. La segunda pasada no encuentra nada que
--  cambiar y lo dice: no toca una sola fila ni un solo objeto.
--
--  EFECTO COLATERAL IMPORTANTE
--  Al retirar el DEFAULT de las columnas uuid que lo tenían, cualquier INSERT que omita
--  esas columnas fallará en PostgreSQL con "null value in column ... violates
--  not-null constraint". Es intencionado: la base de staging es de sólo
--  lectura para el asistente. Para volver atrás, la sección 5 deja la lista
--  exacta y el ALTER que la repone.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'AVISA · Paso 3 · normalización de tipos para SSMA'

-- ---------------------------------------------------------------------
-- 0 · Guardia: sólo en la base de staging
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF current_database() <> 'avisa_mssql' THEN
        RAISE EXCEPTION
            'Este script sólo se ejecuta en avisa_mssql (base actual: %). '
            'La base de trabajo no se toca.', current_database();
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1 · uuid: retirar DEFAULT, dejar constancia del mapeo
-- ---------------------------------------------------------------------
--  Estado antes de ejecutar, medido en esta corrida (el script lo cuenta):
--
--    columnas uuid en el alcance ....... 114
--    de ellas, con DEFAULT ............  25
--    DEFAULT observado ................ gen_random_uuid()  (todas)
--    DEFAULT uuid_generate_v4() .......   0  (la extensión uuid-ossp
--                                             no está instalada)
--
--  Esas columnas generan su propio identificador. La mayoría son PRIMARY
--  KEY de una sola columna; agent.run_log.id forma parte de la PK compuesta
--  (id, ts), heredada de la tabla particionada que el paso 1 aplanó. En SQL
--  Server el DEFAULT recomendado es NEWSEQUENTIALID(): genera valores
--  monótonos y evita la fragmentación del índice clustered que provoca
--  NEWID().
--
--  Las demás columnas uuid del alcance NUNCA tuvieron DEFAULT: o las rellena
--  la aplicación, o heredan la clave de otra tabla (por ejemplo
--  core.actor_datos_personales.actor_uid). A esas no hay que ponerles DEFAULT
--  en SQL Server o se rompería la herencia de identificadores.
--
--  El DEFAULT en PostgreSQL es sólo metadato: retirarlo no reescribe datos
--  ni bloquea las tablas de forma apreciable.
DO $$
DECLARE
    r       record;
    v_n     int := 0;
    v_lista text := '';
BEGIN
    FOR r IN
        SELECT n.nspname                       AS esq,
               c.relname                       AS rel,
               a.attname                       AS col,
               pg_get_expr(d.adbin, d.adrelid) AS expr
          FROM pg_attribute a
          JOIN pg_class     c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attrdef   d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attnum > 0
           AND NOT a.attisdropped
           AND c.relkind IN ('r', 'p')
           AND a.atttypid = 'uuid'::regtype
           AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
           AND n.nspname NOT LIKE 'pg\_%'
         ORDER BY 1, 2, 3
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
                       r.esq, r.rel, r.col);
        v_n := v_n + 1;
        v_lista := v_lista || format('%s.%s.%s ', r.esq, r.rel, r.col);
        RAISE NOTICE '  default retirado: %.%.%  (era %)  → SQL Server: NEWSEQUENTIALID()',
                     r.esq, r.rel, r.col, r.expr;
    END LOOP;

    IF v_n = 0 THEN
        RAISE NOTICE 'sin cambios: ninguna columna uuid conserva DEFAULT';
    ELSE
        RAISE NOTICE 'defaults uuid retirados en esta pasada: %', v_n;
        RAISE NOTICE 'columnas afectadas: %', trim(v_lista);
        RAISE NOTICE 'recrear en SQL Server con DEFAULT NEWSEQUENTIALID() '
                     '(13 son PK de una columna; run_log.id va en PK compuesta)';
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2 · arrays: convertir a texto JSON, sólo si existen
-- ---------------------------------------------------------------------
--  Medido: CERO columnas de tipo array en toda la base de staging (37 tablas
--  del MVP, ref, legacy). El bloque se conserva porque el alcance puede
--  crecer; si no encuentra arrays, no hace nada y lo dice.
--
--  Por qué se convierten: SSMA no reconoce int[] / text[] y genera una tabla
--  incompleta. array_to_json() produce un JSON válido que SQL Server puede
--  guardar en nvarchar(max) sin pérdida de estructura.
DO $$
DECLARE
    r   record;
    v_n int := 0;
BEGIN
    FOR r IN
        SELECT n.nspname AS esq,
               c.relname AS rel,
               a.attname AS col,
               format_type(a.atttypid, a.atttypmod) AS tipo
          FROM pg_attribute a
          JOIN pg_class     c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_type      t ON t.oid = a.atttypid
         WHERE a.attnum > 0
           AND NOT a.attisdropped
           AND c.relkind IN ('r', 'p')
           AND t.typelem <> 0
           AND t.typlen = -1          -- array verdadero, no un tipo con subíndice fijo
           AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
           AND n.nspname NOT LIKE 'pg\_%'
         ORDER BY 1, 2, 3
    LOOP
        EXECUTE format(
            'ALTER TABLE %I.%I ALTER COLUMN %I TYPE text USING array_to_json(%I)::text',
            r.esq, r.rel, r.col, r.col);
        v_n := v_n + 1;
        RAISE NOTICE '  array convertida a texto JSON: %.%.%  (era %)',
                     r.esq, r.rel, r.col, r.tipo;
    END LOOP;

    IF v_n = 0 THEN
        RAISE NOTICE 'sin cambios: no hay columnas de tipo array en el alcance';
    ELSE
        RAISE NOTICE 'arrays convertidos en esta pasada: %', v_n;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3 · jsonb: se deja intacto (decisión, no olvido)
-- ---------------------------------------------------------------------
--  Medido en el alcance actual: 12 columnas jsonb, 0 columnas json.
--
--  Mapeo en SSMA:  jsonb  →  nvarchar(max)
--
--  Por qué no se convierte en origen: jsonb conserva orden de claves y
--  duplicados normalizados, y PostgreSQL lo compara y lo indexa (GIN) sin
--  ayuda. Pasarlo a text aquí sólo perdería esa capacidad para el equipo que
--  todavía consulta la base de staging. La conversión se hace al otro lado,
--  en el DDL de SQL Server, y allí sí conviene:
--
--    · nvarchar(max) guarda el texto tal cual (SSMA ya lo hace así);
--    · no hay tipo JSON nativo, así que las consultas pasan por JSON_VALUE,
--      OPENJSON o columnas calculadas persistidas + índices;
--    · ISJSON() permite replicar el CHECK de forma barata;
--    · en EF Core hace falta HasConversion<string>() o un ValueConverter.
--
--  Las 12 columnas jsonb del alcance:
--
--    agent.run_log.detalle
--    audit.datos_personales_acceso.contexto
--    core.alertas_tempranas.acciones_sugeridas_json
--    core.alertas_tempranas.riesgos_json
--    core.cat_tipos_documento.esquema_json
--    core.compromisos.criterios_smart
--    core.documentos.contenido_json
--    core.output_contracts.response_json
--    ind.variante.especificacion
--    policy.cat_tipos_regla.esquema_json
--    policy.regla.parametros
--    staging.lote.validacion
DO $$
DECLARE
    v_n int;
BEGIN
    SELECT count(*) INTO v_n
      FROM pg_attribute a
      JOIN pg_class     c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE a.attnum > 0
       AND NOT a.attisdropped
       AND c.relkind IN ('r', 'p')
       AND a.atttypid = 'jsonb'::regtype
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
       AND n.nspname NOT LIKE 'pg\_%';
    RAISE NOTICE 'jsonb: % columnas intactas; en SSMA mapear a nvarchar(max)', v_n;
END $$;

-- ---------------------------------------------------------------------
-- 4 · timestamptz: NO se convierte (recomendación: datetimeoffset(7))
-- ---------------------------------------------------------------------
--  Medido: 44 columnas timestamptz en el alcance (45 contando legacy) y
--  Medido: 44 columnas timestamptz en el alcance (45 contando legacy)
--  y CERO columnas timestamp without time zone. Es decir: todo el esquema
--  guarda instantes con huso, y 35 de esas columnas tienen DEFAULT now().
--
--  Qué hace SSMA por defecto: propone datetime2. datetime2 NO guarda el
--  desplazamiento. Con datos de Lima (UTC-5) eso significa que un hecho
--  ocurrido a las 09:00 hora local (14:00 UTC) aparece como 14:00 y el
--  reporte lo muestra como si hubiera ocurrido a las 14:00 de Lima: cinco
--  horas de desfase en cada fecha del sistema.
--
--  Mapeo recomendado en SSMA:
--
--      timestamp with time zone  →  datetimeoffset(7)
--
--  datetimeoffset guarda el instante con su offset y ordena correctamente.
--  En .NET se lee como System.DateTimeOffset sin conversiones manuales.
--
--  El bloque 4.1 está DESACTIVADO. Sólo se ejecuta si la sesión activa a
--  propósito la variable avisa.convertir_timestamptz, por ejemplo:
--
--      (echo "SET avisa.convertir_timestamptz = 'on';"; \
--       cat migration/mssql/02_normalizar_tipos.sql) \
--        | docker compose exec -T db psql -U avisa -d avisa_mssql
--
--  Qué haría si se activa: pasar cada timestamptz a timestamp sin zona
--  conservando la hora LOCAL de Lima (AT TIME ZONE 'America/Lima', no el
--  huso de la sesión). Se pierde el offset: un instante guardado en verano
--  peruano y otro en invierno quedan indistinguibles. Úsese sólo si el
--  destino no admite datetimeoffset.
DO $$
DECLARE
    r    record;
    v_on text := current_setting('avisa.convertir_timestamptz', true);
    v_n  int := 0;
BEGIN
    IF coalesce(v_on, 'off') <> 'on' THEN
        RAISE NOTICE 'timestamptz: se conserva el tipo (conversión desactivada)';
        RETURN;
    END IF;

    FOR r IN
        SELECT n.nspname                       AS esq,
               c.relname                       AS rel,
               a.attname                       AS col,
               pg_get_expr(d.adbin, d.adrelid) AS expr
          FROM pg_attribute a
          JOIN pg_class     c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attnum > 0
           AND NOT a.attisdropped
           AND c.relkind IN ('r', 'p')
           AND a.atttypid = 'timestamptz'::regtype
           AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
           AND n.nspname NOT LIKE 'pg\_%'
         ORDER BY 1, 2, 3
    LOOP
        -- now() es timestamptz: hay que retirar el DEFAULT antes del cambio.
        IF r.expr IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
                           r.esq, r.rel, r.col);
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.%I ALTER COLUMN %I TYPE timestamp without time zone '
            'USING %I AT TIME ZONE %L',
            r.esq, r.rel, r.col, r.col, 'America/Lima');

        -- Se repone el DEFAULT en su forma sin zona, para no dejarlo perdido.
        IF r.expr LIKE '%now()%' THEN
            EXECUTE format(
                'ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT (now() AT TIME ZONE %L)',
                r.esq, r.rel, r.col, 'America/Lima');
        END IF;

        v_n := v_n + 1;
        RAISE NOTICE '  timestamptz → timestamp (hora local Lima): %.%.%',
                     r.esq, r.rel, r.col;
    END LOOP;

    IF v_n = 0 THEN
        RAISE NOTICE 'timestamptz: no quedan columnas por convertir';
    ELSE
        RAISE NOTICE 'AVISO: % columnas perdieron el huso. Revísese el desfase '
                     'de 5 horas con Lima antes de comparar datos.', v_n;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5 · Verificación del estado resultante
-- ---------------------------------------------------------------------
\echo ''
\echo '--- 5.1 · Columnas uuid que aún conservan DEFAULT (esperado: 0 filas) ---'
SELECT n.nspname AS esquema, c.relname AS tabla, a.attname AS columna,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attrdef   d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p')
   AND a.atttypid = 'uuid'::regtype
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
   AND n.nspname NOT LIKE 'pg\_%'
 ORDER BY 1, 2, 3;

\echo ''
\echo '--- 5.2 · Columnas uuid que generaban su propio valor (constancia) ---'
--  Estas columnas tenían DEFAULT gen_random_uuid() y se les retiró para que
--  SSMA no tenga que traducirlo. En SQL Server les corresponde
--  DEFAULT NEWSEQUENTIALID(). La lista se calcula del catálogo: son las
--  columnas uuid sin DEFAULT que forman parte de una clave primaria.
SELECT n.nspname || '.' || c.relname AS tabla,
       a.attname                       AS columna,
       'NEWSEQUENTIALID()'             AS default_sugerido_sqlserver
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE a.attnum > 0
   AND NOT a.attisdropped
   AND c.relkind IN ('r', 'p')
   AND a.atttypid = 'uuid'::regtype
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
   AND n.nspname NOT LIKE 'pg\_%'
   AND NOT EXISTS (SELECT 1 FROM pg_attrdef d
                    WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
   AND EXISTS (SELECT 1
                 FROM pg_constraint k
                WHERE k.conrelid = c.oid
                  AND k.contype = 'p'
                  AND a.attnum = ANY (k.conkey))
 ORDER BY 1, 2;

\echo ''
\echo '--- 5.2b · Las columnas uuid siguen siendo uuid (no se perdió ninguna) ---'
SELECT count(*) AS columnas_uuid
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE a.attnum > 0
   AND NOT a.attisdropped
   AND c.relkind IN ('r', 'p')
   AND a.atttypid = 'uuid'::regtype
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
   AND n.nspname NOT LIKE 'pg\_%';

\echo ''
\echo '--- 5.3 · Recuento de tipos por grupo (fin del paso 3) ---'
SELECT CASE WHEN n.nspname = 'legacy' THEN 'legacy (archivo)' ELSE 'alcance MVP+ref' END AS grupo,
       count(*) FILTER (WHERE a.atttypid = 'uuid'::regtype)        AS uuid,
       count(*) FILTER (WHERE a.atttypid = 'jsonb'::regtype)       AS jsonb,
       count(*) FILTER (WHERE a.atttypid = 'json'::regtype)        AS json,
       count(*) FILTER (WHERE a.atttypid = 'timestamptz'::regtype) AS timestamptz,
       count(*) FILTER (WHERE a.atttypid = 'timestamp'::regtype)   AS timestamp_sin_zona,
       count(*) FILTER (WHERE a.atttypid = 'bytea'::regtype)       AS bytea,
       count(*) FILTER (WHERE t.typelem <> 0 AND t.typlen = -1)    AS arrays
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_type      t ON t.oid = a.atttypid
 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
   AND n.nspname NOT LIKE 'pg\_%'
 GROUP BY 1
 ORDER BY 1;

\echo ''
\echo '--- 5.4 · Columnas jsonb (intactas, a mapear como nvarchar(max)) ---'
SELECT n.nspname || '.' || c.relname AS tabla, a.attname AS columna
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p')
   AND a.atttypid = 'jsonb'::regtype
   AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
 ORDER BY 1, 2;

\echo ''
\echo '--- 5.5 · Columnas timestamptz del alcance (se conservan) ---'
SELECT count(*) AS timestamptz_mvp_ref
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p')
   AND a.atttypid = 'timestamptz'::regtype
   AND n.nspname IN ('core', 'audit', 'ind', 'policy', 'qda', 'staging',
                     'agent', 'ref');

\echo ''
\echo '--- 5.6 · Columnas con DEFAULT nextval (restos de serial) ---'
SELECT n.nspname || '.' || c.relname AS tabla, a.attname AS columna,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
  FROM pg_attribute a
  JOIN pg_class     c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attrdef   d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p')
   AND n.nspname IN ('core', 'audit', 'ind', 'policy', 'qda', 'staging',
                     'agent', 'ref')
   AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%'
 ORDER BY 1, 2;

\echo ''
\echo 'Paso 3 aplicado. avisa_mssql queda listo para el asistente:'
\echo '  uuid sin DEFAULT  ·  jsonb intacto  ·  timestamptz intacto'
\echo 'En SSMA: uuid → uniqueidentifier con NEWSEQUENTIALID();'
\echo '         jsonb → nvarchar(max);  timestamptz → datetimeoffset(7).'
\echo ''
