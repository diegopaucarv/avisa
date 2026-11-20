-- =============================================================================
--  10 · Aplicación del esquema v9 + parches de preparación
--
--  Orden obligatorio (docs/04_migracion/DECISIONES_CARGA_LEGADO_V9.md §11 y README de
--  migration/):
--
--    1. DDL v9 .................... dos pasadas
--    2. PREPARACION_V9_CARGA_LEGADO.sql     (parche 1: catálogos + columnas)
--    3. PREPARACION_V9_CARGA_LEGADO_2.sql   (parche 2: huecos columna a columna)
--    4. PREPARACION_V9_CARGA_LEGADO_3.sql   (parche 3: cierre D43–D49)
--    5. PREPARACION_V9_CARGA_LEGADO_4.sql   (parche 4: membresías sin fecha, D50)
--    6. PREPARACION_V9_CARGA_LEGADO_5.sql   (parche 5: seeds de cierre)
--
--  POR QUÉ DOS PASADAS DEL DDL
--  La DDL v9 no es ejecutable en una sola pasada: core.cambio_normativo declara
--  una FK a core.usuarios antes de que esa tabla exista (L137 vs L297). La
--  primera pasada crea todo lo que puede y la segunda resuelve lo que dependía
--  de objetos posteriores. También hay un seed de cat_variables que viola su
--  propia FK: ese error es esperado y no impide el resto.
--
--  POR QUÉ ON_ERROR_STOP ESTÁ DESACTIVADO SÓLO EN EL DDL
--  Los dos defectos anteriores son conocidos y tolerables. Los parches, en
--  cambio, corren con ON_ERROR_STOP activo: si uno falla, la inicialización
--  aborta y el contenedor no arranca. Es preferible fallar ruidosamente a
--  quedar con un esquema a medias que parezca correcto.
--
--  Rutas: /opt/avisa/sql/* son bind mounts definidos en compose.yaml, de modo
--  que estos scripts son siempre los del repositorio (sin copias divergentes).
-- =============================================================================

\set ON_ERROR_STOP off

\echo '10_apply_v9: DDL v9 · pasada 1/2'
\i /opt/avisa/sql/90_ddl_v9.sql

\echo '10_apply_v9: DDL v9 · pasada 2/2 (resuelve dependencias adelantadas)'
\i /opt/avisa/sql/90_ddl_v9.sql

\set ON_ERROR_STOP on

\echo '10_apply_v9: parche 1 · catálogos y columnas de legado'
\i /opt/avisa/sql/91_patch_01.sql

\echo '10_apply_v9: parche 2 · huecos detectados columna a columna'
\i /opt/avisa/sql/92_patch_02.sql

\echo '10_apply_v9: parche 3 · cierre de bloqueos D43–D49'
\i /opt/avisa/sql/93_patch_03.sql

\echo '10_apply_v9: parche 4 · membresías sin fecha (D50)'
\i /opt/avisa/sql/94_patch_04.sql

\echo '10_apply_v9: parche 5 · seeds de cierre (etapas PIP, schemas, plantillas ind)'
\i /opt/avisa/sql/95_patch_05.sql

\echo '10_apply_v9: esquema aplicado'
