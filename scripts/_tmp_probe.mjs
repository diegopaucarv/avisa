// TEMPORAL - solo SELECT de lectura. Se borra al terminar.
import fs from 'node:fs';
import pg from 'pg';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const m = env.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
const out = [];
const say = (t) => out.push(t);
const c = new pg.Client({ connectionString: m[1].trim(), statement_timeout: 20000 });
await c.connect();
async function q(label, sql) {
  try {
    const r = await c.query(sql);
    say(`\n### ${label}\n${r.rows.map((x) => JSON.stringify(x)).join('\n') || '(0 filas)'}`);
  } catch (e) { say(`\n### ${label}\nERROR: ${e.message}`); }
}

await q('acuerdo_ospa_sni', `select count(*) from core.acuerdo_ospa_sni`);
await q('acuerdo_ospa_sni cols', `select column_name from information_schema.columns where table_schema='core' and table_name='acuerdo_ospa_sni' order by ordinal_position`);
await q('lugares cols', `select column_name, data_type from information_schema.columns where table_schema='territorio' and table_name='lugares' order by ordinal_position`);
await q('desembarcadero_detalle cols', `select column_name from information_schema.columns where table_schema='territorio' and table_name='desembarcadero_detalle' order by ordinal_position`);
await q('refs proyecto/etapa/avance/expediente', `select table_schema, table_name, column_name from information_schema.columns
 where table_schema in ('core','territorio','domain','kag') and column_name ~* 'proyecto|etapa|avance|expediente' order by 1,2,3`);
await q('domain tablas', `select table_name from information_schema.tables where table_schema='domain'`);
await q('domain.artefacto cols', `select column_name, data_type from information_schema.columns where table_schema='domain' and table_name='artefacto' order by ordinal_position`);
await q('cat_tipos_lugar cols', `select column_name from information_schema.columns where table_schema='territorio' and table_name='cat_tipos_lugar' order by ordinal_position`);
await q('caleta_detalle cols', `select column_name from information_schema.columns where table_schema='territorio' and table_name='caleta_detalle' order by ordinal_position`);
await q('actores cols', `select column_name, data_type, is_nullable from information_schema.columns where table_schema='core' and table_name='actores' order by ordinal_position`);
await q('caso_regiones', `select count(*) filas, count(distinct caso_id) casos from core.caso_regiones`);
await q('vw_actor_territorio', `select count(*) from core.vw_actor_territorio`);
await q('actores region distribucion', `select region_id, count(*) n from core.actores where region_id is not null group by 1 order by 2 desc limit 12`);
await q('actores con region y vinculo a caso', `select count(*) from core.actores a where a.region_id is not null and exists (select 1 from core.casos_actores ca where ca.actor_id=a.actor_uid)`);
await q('casos_actores', `select count(*) from core.casos_actores`);
await q('demandas_actores', `select count(*) from core.demandas_actores`);
await q('usuario_territorio cols', `select column_name from information_schema.columns where table_schema='core' and table_name='usuario_territorio' order by ordinal_position`);
await q('usuarios y roles', `select u.codigo_legado, r.codigo from core.usuarios u left join core.usuario_roles ur on ur.usuario_id=u.id left join core.roles r on r.id=ur.rol_id order by 1 limit 20`);
await q('migracion/schema tablas', `select table_schema, table_name from information_schema.tables where table_name ilike '%migration%' or table_name ilike '%version%'`);
await q('alerta_especies cols', `select column_name from information_schema.columns where table_schema='core' and table_name='alerta_especies' order by ordinal_position`);
await q('compromiso por region', `select c.id, c.codigo_compromiso, cs.subsector_id, cr.region_id from core.compromisos c
  join core.casos cs on cs.id=c.caso_id
  left join core.caso_regiones cr on cr.caso_id=c.caso_id order by 1`);
await q('subsector de unidades via area legado', `select u.siglas, u.codigo_legado_area, s.nombre from core.cat_unidades_organicas u
  left join core.cat_subsectores s on s.id_area_legado = u.codigo_legado_area
  where u.siglas in ('DM','SG','OAIPCS','DVPA','DVMYPE-I','FONDEPES','DGA','DIGPA') order by 1`);
await q('alertas sin caso por subsector', `select subsector_id, count(*) from core.alertas_tempranas where caso_id is null group by 1`);
await q('especies lista', `select id, nombre_comun from core.cat_especies order by id`);
await q('dim_organizacion ubigeo', `select c03, count(*) from legacy.dim_organizacion group by 1 order by 2 desc limit 10`);
console.log(out.join('\n'));
await c.end();
