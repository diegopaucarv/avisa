\pset pager off
\echo == 1. cat_alcances_geograficos ==
select * from core.cat_alcances_geograficos order by id;

\echo == 2. columnas del catalogo ==
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='core' and table_name='cat_alcances_geograficos'
order by ordinal_position;

\echo == 3. regiones por alcance ==
select a.id, a.nombre, count(r.id) as regiones
from core.cat_alcances_geograficos a
left join core.regiones r on r.alcance_id = a.id
group by 1,2 order by 1;

\echo == 4. casos: cobertura territorial ==
select
  count(*) as casos,
  count(*) filter (where distrito_principal_id is not null) as con_distrito,
  count(*) filter (where distrito_principal_id is null and region_principal_id is not null) as solo_region,
  count(*) filter (where distrito_principal_id is null and region_principal_id is null
                     and provincia_principal_id is null) as sin_territorio
from core.casos where anulado_en is null;

\echo == 5. los casos sin territorio, con sus vinculos ==
\x on
select c.codigo_caso, left(c.nombre_caso, 80) as nombre,
       c.subsector_id, s.nombre as subsector,
       c.tematica_id, t.nombre as tematica,
       c.estado_id,
       (select count(*) from core.caso_regiones cr where cr.caso_id = c.id) as n_regiones,
       (select count(*) from core.alertas_tempranas a where a.caso_id = c.id and a.anulado_en is null) as alertas,
       c.origen_dato
from core.casos c
left join core.cat_subsectores s on s.id = c.subsector_id
left join core.cat_tematicas t on t.id = c.tematica_id
where c.anulado_en is null
  and c.distrito_principal_id is null
  and c.region_principal_id is null
  and c.provincia_principal_id is null
order by c.codigo_caso;
\x off

\echo == 6. sus demandas y compromisos (masa real) ==
select c.codigo_caso,
       (select count(*) from core.demandas d where d.caso_id = c.id) as demandas,
       (select count(*) from core.compromisos k where k.caso_id = c.id) as compromisos
from core.casos c
where c.anulado_en is null
  and c.distrito_principal_id is null
  and c.region_principal_id is null
  and c.provincia_principal_id is null
order by 1;

\echo == 7. casos con region pero sin distrito ==
\x on
select c.codigo_caso, left(c.nombre_caso, 70) as nombre, r.nombre as region
from core.casos c join core.regiones r on r.id = c.region_principal_id
where c.anulado_en is null and c.distrito_principal_id is null
order by 1;
\x off
