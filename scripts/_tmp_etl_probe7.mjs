import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n## ' + label); console.log(JSON.stringify(r.rows)); }
  catch (e) { console.log('\n## ' + label + '  -> ERROR: ' + e.message); }
};
await q('privilegios tablas', `select
  has_table_privilege('avisa_api','analisis.punto_ingesta','SELECT') as pi_sel,
  has_table_privilege('avisa_api','core.cat_tipos_documento','SELECT') as td_sel,
  has_table_privilege('avisa_api','core.migracion_log','SELECT') as ml_sel,
  has_table_privilege('avisa_api','core.integraciones','SELECT') as int_sel,
  has_table_privilege('avisa_api','core.documento_lista_blanca','SELECT') as lb_sel,
  has_table_privilege('avisa_api','core.documentos','SELECT') as doc_sel,
  has_table_privilege('avisa_api','core.caso_cronologia','SELECT') as cc_sel,
  has_table_privilege('avisa_api','staging.lote','SELECT') as lote_sel,
  has_table_privilege('avisa_api','legacy.dim_redaccion','SELECT') as red_sel`);
await q('funcion existe?', "select proname from pg_proc where proname='etl_conteos'");
await q('set role avisa_api count core.casos', 'set role avisa_api');
await q('count as avisa_api core.casos', 'select count(*)::int as n from core.casos');
await q('count as avisa_api legacy', 'select count(*)::int as n from legacy.dim_redaccion');
await q('reset role', 'reset role');
await q('owner de core.migracion_log', "select tableowner from pg_tables where schemaname='core' and tablename='migracion_log'");
await c.end();
