import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n## ' + label); console.table(r.rows); }
  catch (e) { console.log('\n## ' + label + ' -> ERROR: ' + e.message); }
};
await q('niveles conflicto', 'select * from core.cat_niveles_conflicto order by id');
await q('casos por nivel conflicto', 'select nivel_conflicto_id, count(*)::int from core.casos group by 1 order by 1');
await q('nudos columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='caso_nudo_critico' order by ordinal_position");
await q('demandas columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='demandas' order by ordinal_position");
await q('reportes tabla', "select column_name from information_schema.columns where table_schema='core' and table_name='reportes' order by ordinal_position");
await q('reportes conteo', 'select count(*)::int from core.reportes');
await q('tablas analytics', "select table_name from information_schema.tables where table_schema='analytics' order by 1");
await q('tablas core total', "select count(*)::int as tablas from information_schema.tables where table_schema='core'");
await q('tablas no previstas', "select table_name from information_schema.tables where table_schema='core' and (table_name ilike '%prefer%' or table_name ilike '%vista%' or table_name ilike '%tablero%' or table_name ilike '%tarea%' or table_name ilike '%asign%' or table_name ilike '%adjunt%' or table_name ilike '%archivo%')");
await q('notificaciones columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='notificaciones' order by ordinal_position");
await q('usuarios columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='usuarios' order by ordinal_position");
await q('vistas core', "select table_name from information_schema.views where table_schema='core' order by 1");
await q('locales columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='locales' order by ordinal_position");
await q('distritos columnas', "select column_name from information_schema.columns where table_schema='territorio' and table_name='distrito' order by ordinal_position");
await q('tematica caso anulable', "select column_name from information_schema.columns where table_schema='core' and table_name='casos' and column_name like '%tem%'");
await c.end();
