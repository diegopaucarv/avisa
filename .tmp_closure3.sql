-- Clausura FK desde lo que realmente quedó en avisa_mssql
CREATE TEMP TABLE edges AS
SELECT (sn.nspname||'.'||s.relname) COLLATE "C" AS src,
       (dn.nspname||'.'||d.relname) COLLATE "C" AS dst
FROM pg_constraint c
JOIN pg_class s ON s.oid = c.conrelid
JOIN pg_namespace sn ON sn.oid = s.relnamespace
JOIN pg_class d ON d.oid = c.confrelid
JOIN pg_namespace dn ON dn.oid = d.relnamespace
WHERE c.contype = 'f' AND sn.nspname NOT LIKE 'pg\_%' AND dn.nspname NOT LIKE 'pg\_%';

CREATE TEMP TABLE seed(nm text COLLATE "C");
\copy seed FROM '/tmp/seed_mssql.txt'
SELECT count(*) AS retenidas FROM seed;

WITH RECURSIVE cl(nm) AS (
    SELECT nm FROM seed
  UNION
    SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT count(*) AS clausura_total,
       count(*) FILTER (WHERE nm NOT IN (SELECT nm FROM seed)) AS faltantes
FROM cl;

WITH RECURSIVE cl(nm) AS (
    SELECT nm FROM seed
  UNION
    SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT split_part(nm,'.',1) AS esquema, count(*) AS tablas
FROM cl WHERE nm NOT IN (SELECT nm FROM seed) GROUP BY 1 ORDER BY 2 DESC;

WITH RECURSIVE cl(nm) AS (
    SELECT nm FROM seed
  UNION
    SELECT e.dst FROM cl JOIN edges e ON e.src = cl.nm
)
SELECT nm FROM cl WHERE nm NOT IN (SELECT nm FROM seed) ORDER BY 1;
