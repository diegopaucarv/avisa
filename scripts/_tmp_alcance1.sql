\pset pager off
\echo == 1. catalogos de alcance/ambito ==
select table_name from information_schema.tables
where table_schema = 'core' and (table_name like '%alcance%' or table_name like '%ambito%' or table_name like '%escala%');

\echo == 2. columnas de alcance en core.casos / core.regiones ==
select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema in ('core','analytics')
  and (column_name like '%alcance%' or column_name like '%ambito%')
order by 1,2,3;

\echo == 3. contenido de los catalogos encontrados (via to_jsonb) ==
select 'cat_alcances' as t, to_jsonb(c) from core.cat_alcances c order by 1;

\echo == 4. definicion de core.alcance_caso ==
select pg_get_functiondef('core.alcance_caso(uuid)'::regprocedure) as def;
