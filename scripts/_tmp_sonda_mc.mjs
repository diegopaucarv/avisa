import pg from 'pg';
process.loadEnvFile('.env');
const url = process.env.NEON_OWNER_URL || process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log('\n## ' + label);
    console.table(r.rows);
  } catch (e) {
    console.log('\n## ' + label + ' -> ERROR: ' + e.message);
  }
};
await q('compromisos columnas', "select column_name, data_type from information_schema.columns where table_schema='core' and table_name='compromisos' order by ordinal_position");
await q('catalogos compromiso', "select table_name from information_schema.tables where table_schema='core' and table_name ilike '%compromiso%' order by 1");
await q('cat_clasificacion_compromiso', "select * from core.cat_tipos_compromiso order by id");
await q('cat_clasificacion_compromiso2', "select table_name from information_schema.tables where table_schema='core' and (table_name ilike '%tipo%compromiso%' or table_name ilike '%clasific%') order by 1");
await q('muestra compromisos', "select * from core.compromisos limit 3");
await q('conteo compromisos', "select count(*)::int total, count(caso_id)::int con_caso from core.compromisos where anulado_en is null");
await q('unidades organicas', "select column_name from information_schema.columns where table_schema='core' and table_name='cat_unidades_organicas' order by ordinal_position");
await q('muestra unidades', "select * from core.cat_unidades_organicas limit 5");
await q('vw_geo_distrito cols', "select column_name, data_type from information_schema.columns where table_schema='analytics' and table_name='vw_geo_distrito' order by ordinal_position");
await q('ultimo hecho', "select count(*)::int casos_con_cronologia from (select caso_id from core.caso_cronologia where anulado_en is null group by caso_id) t");
await c.end();
