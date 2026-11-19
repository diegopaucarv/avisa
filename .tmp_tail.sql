;
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
