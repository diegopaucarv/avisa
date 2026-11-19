\echo '=== SNAPSHOT avisa_mssql ==='
SELECT n.nspname AS esquema, count(*) AS tablas
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg\_%' AND n.nspname<>'information_schema'
 GROUP BY 1 ORDER BY 1;

SELECT count(*) AS columnas_alcance
  FROM information_schema.columns
 WHERE (table_schema, table_name) IN (
   SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname IN ('core','audit','ind','policy','staging','qda','agent','ref','kag'));

SELECT data_type, count(*) FROM information_schema.columns
 WHERE table_schema IN ('core','audit','ind','policy','staging','qda','agent','ref','kag')
 GROUP BY 1 ORDER BY 2 DESC;

SELECT count(*) AS columnas_legacy FROM information_schema.columns WHERE table_schema='legacy';
SELECT count(*) AS fks FROM pg_constraint WHERE contype='f';
SELECT count(*) AS tablas_rls FROM pg_class WHERE relrowsecurity AND relkind='r';
SELECT count(*) AS politicas FROM pg_policies;
SELECT count(*) AS triggers FROM pg_trigger WHERE NOT tgisinternal;
SELECT count(*) AS indices_parciales FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
 WHERE i.indpred IS NOT NULL AND c.relnamespace NOT IN (SELECT oid FROM pg_namespace WHERE nspname LIKE 'pg\_%');
SELECT count(*) AS comentarios FROM pg_description d JOIN pg_class c ON c.oid=d.objoid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\_%';
