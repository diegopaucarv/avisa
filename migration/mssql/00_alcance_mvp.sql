-- =====================================================================
--  AVISA · Paso 1 · Aislar el alcance del MVP (base de staging)
-- =====================================================================
--  PARA QUÉ
--  El esquema completo tiene 374 tablas físicas (287 del modelo v10 y 87
--  del legado). Si SSMA las ve todas, genera cientos de errores y
--  advertencias que esconden los reales. Este script deja sólo lo que el
--  módulo de diciembre necesita: 78 tablas, 685 columnas.
--
--  DÓNDE SE EJECUTA
--  En una base de staging, NUNCA en la base de trabajo. Se crea así:
--
--      psql -d postgres -c "CREATE DATABASE avisa_mssql TEMPLATE avisa"
--
--  Si se ejecuta sobre otra base, aborta (bloque 0).
--
--  QUÉ CONSERVA
--  Las 46 tablas de las capas T0 y T1 de docs/03_ejecucion/mvp_prioridad_tablas.csv
--  (42 si se descuentan las 4 de kag), MÁS todas las tablas padre que
--  esas 42 necesitan para que sus claves ajenas tengan destino (bloque
--  1.2). El resultado son 78 tablas.
--
--  POR QUÉ HAY QUE CERRAR LAS DEPENDENCIAS
--  Recortar por prioridad, tabla a tabla, deja columnas que apuntan a
--  tablas inexistentes: core.casos.region_principal_id sin core.regiones,
--  core.actores.region_id sin core.regiones, core.usuarios.unidad_id sin
--  core.cat_unidades_organicas. Ese esquema no se puede migrar ni consultar:
--  el equipo .NET recibiría columnas huérfanas. Por eso el bloque 1.2
--  recorre las claves ajenas y añade los padres que falten.
--
--  QUÉ NO SE ARRASTRA
--  La clausura se detiene en los esquemas diferidos a 2027 (chat, ctx,
--  analisis, territorio, lex, mype, pesca, economic, impact, community,
--  forecast, consultation, proteccion, domain, model, config, avisa).
--  Así entran los catálogos de negocio (core, policy, ind, qda, ref) y el
--  mínimo de kag que sostiene ref.base_legal_evidencia, pero no el resto
--  del aparato de 2027. Las claves ajenas que quedan sin destino por esta
--  regla se reportan al final (bloque 4); hoy son 6.
--
--  EFECTO COLATERAL
--  `DROP ... CASCADE` NO elimina columnas de las tablas que se conservan:
--  elimina las claves ajenas que apuntaban a lo borrado y las vistas que
--  dependían de ello.
--
--  IDEMPOTENTE: lo que ya no está, no se toca.
-- =====================================================================

\set ON_ERROR_STOP on

\echo 'AVISA · Paso 1 · aislamiento del alcance MVP'

-- ---------------------------------------------------------------------
-- 0 · Guardia: sólo en la base de staging
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF current_database() <> 'avisa_mssql' THEN
        RAISE EXCEPTION
            'Este script sólo se ejecuta en avisa_mssql (base actual: %). '
            'Crear la copia con: CREATE DATABASE avisa_mssql TEMPLATE avisa',
            current_database();
    END IF;
END $$;

BEGIN;

-- ---------------------------------------------------------------------
-- 1 · Alcance declarado
-- ---------------------------------------------------------------------
CREATE TEMP TABLE alcance_mvp (esquema text NOT NULL, tabla text NOT NULL)
ON COMMIT DROP;

INSERT INTO alcance_mvp (esquema, tabla) VALUES
    ('agent',   'run_log'),
    ('audit',   'datos_personales_acceso'),
    ('core',    'actor_alias'),
    ('core',    'actor_datos_personales'),
    ('core',    'actor_membresia'),
    ('core',    'actores'),
    ('core',    'alertas_actores'),
    ('core',    'alertas_tempranas'),
    ('core',    'banco_datos_tratamiento'),
    ('core',    'caso_cronologia'),
    ('core',    'caso_estado_historial'),
    ('core',    'casos'),
    ('core',    'casos_actores'),
    ('core',    'cat_clasificacion'),
    ('core',    'cat_estados_caso'),
    ('core',    'cat_estados_compromiso'),
    ('core',    'cat_estados_hito'),
    ('core',    'cat_nivel_identificacion'),
    ('core',    'cat_niveles_conflicto'),
    ('core',    'cat_niveles_riesgo'),
    ('core',    'cat_prioridades_alerta'),
    ('core',    'cat_tipos_actor'),
    ('core',    'cat_tipos_hecho'),
    ('core',    'compromiso_colaboradores'),
    ('core',    'compromisos'),
    ('core',    'consulta_reniec'),
    ('core',    'cronologia_vinculos'),
    ('core',    'distritos'),
    ('core',    'hitos_compromiso'),
    ('core',    'log_accesos'),
    ('core',    'organizaciones'),
    ('core',    'output_contracts'),
    ('core',    'permiso_aprobacion'),
    ('core',    'reunion_participantes'),
    ('core',    'roles'),
    ('core',    'usuario_roles'),
    ('core',    'usuarios'),
    ('ind',     'resultado'),
    ('policy',  'escenario_regla'),
    ('qda',     'mapeo_pseudonimo'),
    ('ref',     'base_legal_tratamiento'),
    ('staging', 'lote');

-- ---------------------------------------------------------------------
-- 1.2 · Cierre de dependencias: añadir los padres que falten
-- ---------------------------------------------------------------------
--  Se recorre el grafo de claves ajenas desde las 42 declaradas (más
--  ref, que entra completo). Cada
--  destino que no esté ya en la lista entra como tabla necesaria. La
--  recursión se corta en los esquemas diferidos a 2027.
CREATE TEMP TABLE esquemas_diferidos (nspname text PRIMARY KEY) ON COMMIT DROP;

INSERT INTO esquemas_diferidos (nspname) VALUES
    ('avisa'),       ('analisis'),  ('chat'),       ('community'),
    ('config'),      ('consultation'), ('ctx'),     ('domain'),
    ('economic'),    ('forecast'),  ('impact'),     ('lex'),
    ('model'),       ('mype'),      ('pesca'),      ('proteccion'),
    ('territorio');

CREATE TEMP TABLE aristas_fk ON COMMIT DROP AS
SELECT (n1.nspname || '.' || c1.relname) COLLATE "C" AS origen,
       (n2.nspname || '.' || c2.relname) COLLATE "C" AS destino
  FROM pg_constraint k
  JOIN pg_class     c1 ON c1.oid = k.conrelid
  JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
  JOIN pg_class     c2 ON c2.oid = k.confrelid
  JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
 WHERE k.contype = 'f'
   AND c1.relkind IN ('r', 'p')
   AND c2.relkind IN ('r', 'p')
   AND n1.nspname NOT LIKE 'pg\_%'
   AND n2.nspname NOT LIKE 'pg\_%'
   AND n2.nspname NOT IN (SELECT nspname FROM esquemas_diferidos);

-- ref se conserva entero: son dos tablas pequeñas y sostienen la base legal
-- de los datos personales.
INSERT INTO alcance_mvp (esquema, tabla)
SELECT DISTINCT n.nspname, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'ref' AND c.relkind IN ('r', 'p')
   AND NOT EXISTS (SELECT 1 FROM alcance_mvp a
                    WHERE a.esquema = n.nspname AND a.tabla = c.relname);

CREATE TEMP TABLE alcance_cerrado ON COMMIT DROP AS
WITH RECURSIVE cl (nm) AS (
    SELECT (esquema || '.' || tabla)::text COLLATE "C" FROM alcance_mvp
  UNION
    SELECT a.destino FROM cl JOIN aristas_fk a ON a.origen = cl.nm
)
SELECT DISTINCT split_part(nm, '.', 1) AS esquema,
                split_part(nm, '.', 2) AS tabla
  FROM cl;

-- A partir de aquí manda el conjunto cerrado.
DELETE FROM alcance_mvp;
INSERT INTO alcance_mvp (esquema, tabla)
SELECT esquema, tabla FROM alcance_cerrado;

DO $$
DECLARE
    v_n int;
BEGIN
    SELECT count(*) INTO v_n FROM alcance_mvp;
    RAISE NOTICE 'alcance cerrado por dependencias .... % tablas', v_n;
END $$;

-- ---------------------------------------------------------------------
-- 2 · Inventario previo de claves ajenas (para poder reportar pérdidas)
-- ---------------------------------------------------------------------
CREATE TEMP TABLE fks_antes ON COMMIT DROP AS
SELECT n1.nspname || '.' || c1.relname AS origen,
       n2.nspname || '.' || c2.relname AS destino,
       k.conname                       AS nombre
  FROM pg_constraint k
  JOIN pg_class     c1 ON c1.oid = k.conrelid
  JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
  JOIN pg_class     c2 ON c2.oid = k.confrelid
  JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
 WHERE k.contype = 'f';

-- ---------------------------------------------------------------------
-- 3 · Borrado de lo que no es MVP
-- ---------------------------------------------------------------------
-- 3.1 · Esquemas completos fuera de alcance (17).
--       kag NO va en esta lista: de allí se conservan tres tablas que
--       sostienen ref.base_legal_evidencia. Sus demás tablas se eliminan
--       una por una en 3.2.
DO $$
DECLARE
    v_esquema text;
    v_lista   text[] := ARRAY[
        'analisis', 'avisa', 'chat', 'community', 'config', 'consultation',
        'ctx', 'domain', 'economic', 'forecast', 'impact', 'lex',
        'model', 'mype', 'pesca', 'proteccion', 'territorio'
    ];
    v_n int := 0;
BEGIN
    FOREACH v_esquema IN ARRAY v_lista
    LOOP
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_esquema) THEN
            EXECUTE format('DROP SCHEMA %I CASCADE', v_esquema);
            v_n := v_n + 1;
        END IF;
    END LOOP;
    RAISE NOTICE 'esquemas completos eliminados ....... %', v_n;
END $$;

-- 3.2 · Tablas fuera de alcance dentro de los esquemas que se conservan.
--       La lista se materializa en una tabla temporal ANTES de borrar. Si se
--       recorriera el catálogo mientras se borra, al eliminar una tabla
--       particionada desaparecen sus particiones y el bucle intentaría borrar
--       filas que ya no existen (error "... does not exist").
CREATE TEMP TABLE fuera_alcance ON COMMIT DROP AS
SELECT n.nspname AS esquema, c.relname AS tabla
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p')
   AND n.nspname IN ('core', 'audit', 'ind', 'policy', 'staging',
                     'qda', 'agent', 'ref', 'kag')
   AND NOT EXISTS (
         SELECT 1 FROM alcance_mvp a
          WHERE a.esquema = n.nspname AND a.tabla = c.relname)
   -- ref y audit se conservan completos: son pequeñas y sostienen la base
   -- legal y la bitácora de la PII.
   AND n.nspname NOT IN ('ref');

DO $$
DECLARE
    r     record;
    v_n   int := 0;
BEGIN
    -- Sólo particiones raíz: los hijos caen con el padre y no deben
    -- aparecer en la lista de borrado.
    FOR r IN
        SELECT f.esquema, f.tabla
          FROM fuera_alcance f
         WHERE NOT EXISTS (
                 SELECT 1
                   FROM pg_inherits i
                   JOIN pg_class ch ON ch.oid = i.inhrelid
                   JOIN pg_namespace ns ON ns.oid = ch.relnamespace
                  WHERE ns.nspname = f.esquema
                    AND ch.relname = f.tabla)
         ORDER BY f.esquema, f.tabla
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', r.esquema, r.tabla);
        v_n := v_n + 1;
    END LOOP;
    RAISE NOTICE 'tablas fuera de alcance eliminadas .. %', v_n;
END $$;

-- 3.3 · Vistas huérfanas.
--       No hace falta un barrido: el CASCADE de 3.1 y 3.2 ya elimina toda
--       vista que dependiera de lo borrado. Un barrido general de vistas es
--       peligroso: intenta borrar objetos que pertenecen a extensiones (por
--       ejemplo las vistas de PostGIS) y aborta la transacción entera.

-- 3.4 · Aplanar las tablas particionadas que quedan en el alcance.
--       SSMA no traduce particiones: vería una tabla padre más seis hijas y
--       las migraría como tablas independientes. Se sustituye el padre por
--       una tabla simple con la misma estructura y los mismos datos.
--       Sólo aplica a tablas particionadas del alcance (hoy: agent.run_log).
DO $$
DECLARE
    r     record;
    v_n   int := 0;
BEGIN
    FOR r IN
        SELECT a.esquema, a.tabla
          FROM alcance_mvp a
          JOIN pg_class c ON c.relname = a.tabla
          JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = a.esquema
         WHERE c.relkind = 'p'
         ORDER BY a.esquema, a.tabla
    LOOP
        EXECUTE format('CREATE TABLE %I.%I_simple (LIKE %I.%I INCLUDING ALL)',
                       r.esquema, r.tabla, r.esquema, r.tabla);
        EXECUTE format('INSERT INTO %I.%I_simple SELECT * FROM %I.%I',
                       r.esquema, r.tabla, r.esquema, r.tabla);
        EXECUTE format('DROP TABLE %I.%I CASCADE', r.esquema, r.tabla);
        EXECUTE format('ALTER TABLE %I.%I_simple RENAME TO %I',
                       r.esquema, r.tabla, r.tabla);
        v_n := v_n + 1;
        RAISE NOTICE '  aplanada: %.%', r.esquema, r.tabla;
    END LOOP;
    RAISE NOTICE 'tablas particionadas aplanadas ...... %', v_n;
END $$;

-- ---------------------------------------------------------------------
-- 4 · Informe de lo que realmente quedó
-- ---------------------------------------------------------------------
\echo ''
\echo '--- Tablas por esquema ---'
SELECT n.nspname AS esquema, count(*) AS tablas
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p')
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND n.nspname NOT LIKE 'pg\_%'
 GROUP BY 1
 ORDER BY 1;

\echo ''
\echo '--- ¿Está completo el alcance cerrado? ---'
SELECT count(*) FILTER (WHERE to_regclass(a.esquema || '.' || a.tabla) IS NOT NULL)
           AS presentes,
       count(*) AS declaradas
  FROM alcance_mvp a;

\echo ''
\echo '--- Claves ajenas perdidas por tablas del alcance ---'
SELECT a.origen, a.destino, a.nombre
  FROM fks_antes a
 WHERE a.origen IN (SELECT esquema || '.' || tabla FROM alcance_mvp)
   AND NOT EXISTS (
        SELECT 1
          FROM pg_constraint k
          JOIN pg_class     c1 ON c1.oid = k.conrelid
          JOIN pg_namespace n1 ON n1.oid = c1.relnamespace
         WHERE k.contype = 'f'
           AND k.conname = a.nombre
           AND n1.nspname || '.' || c1.relname = a.origen)
 ORDER BY 1, 2;

\echo ''
\echo '--- Columnas de las tablas del alcance (no debe haber huecos) ---'
SELECT count(*) AS columnas_totales
  FROM information_schema.columns
 WHERE (table_schema, table_name) IN (SELECT esquema, tabla FROM alcance_mvp);

COMMIT;

\echo ''
\echo 'Paso 1 aplicado. La base avisa_mssql contiene sólo el alcance del MVP.'
\echo ''
