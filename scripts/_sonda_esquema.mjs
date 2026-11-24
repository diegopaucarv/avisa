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
await q('casos columnas', "select column_name, data_type, is_nullable from information_schema.columns where table_schema='core' and table_name='casos' order by ordinal_position");
await q('cat_niveles_riesgo', 'select * from core.cat_niveles_riesgo order by id');
await q('casos por nivel', "select c.nivel_riesgo_id, count(*)::int as casos from core.casos c group by 1 order by 2 desc");
await q('casos por estado', "select estado_id, count(*)::int from core.casos group by 1 order by 2 desc");
await q('cat_estados_caso', 'select * from core.cat_estados_caso order by id');
await q('alertas columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='alertas_tempranas' order by ordinal_position");
await q('compromisos columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='compromisos' order by ordinal_position");
await q('hitos columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='hitos_compromiso' order by ordinal_position");
await q('documento tipos', 'select id, codigo, nombre from core.cat_tipos_documento order by id');
await q('nudos columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='caso_nudo_critico' order by ordinal_position");
await q('demandas columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='demandas' order by ordinal_position");
await q('casos tematica', "select column_name from information_schema.columns where table_schema='core' and table_name='casos' and column_name ilike '%temat%'");
await q('tematicas tablas', "select table_name from information_schema.tables where table_schema='core' and table_name ilike '%temat%'");
await q('usuario columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='usuarios' order by ordinal_position");
await q('notif columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='notificaciones' order by ordinal_position");
await q('tablas analytics', "select table_name from information_schema.tables where table_schema='analytics' order by 1");
await q('reuniones conteo', "select count(*)::int from core.reuniones_dialogo");
await q('reportes', "select count(*)::int from core.reportes");
await q('reporte columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='reportes' order by ordinal_position");
await q('clima tablas', "select table_name from information_schema.tables where table_schema='core' and (table_name ilike '%clima%' or table_name ilike '%reporte%') order by 1");
await c.end();
