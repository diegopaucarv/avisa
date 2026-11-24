import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n## ' + label); console.log(JSON.stringify(r.rows)); }
  catch (e) { console.log('\n## ' + label + '  -> ERROR: ' + e.message); }
};
await q('roles', 'select * from core.roles order by 1');
await q('clasificacion func', "select pg_get_functiondef(oid) as def from pg_proc where proname='clasificacion_max' limit 1");
await q('avisa_api grants legacy', "select has_schema_privilege('avisa_api','legacy','USAGE') as legacy_usage, has_schema_privilege('avisa_api','analisis','USAGE') as analisis_usage, has_schema_privilege('avisa_api','staging','USAGE') as staging_usage, has_schema_privilege('avisa_api','core','USAGE') as core_usage");
await q('tablas con RLS core', "select count(*)::int as total from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='core' and c.relrowsecurity");
await q('policies core casos', "select polname, pg_get_expr(polqual, polrelid) as using from pg_policy where polrelid='core.casos'::regclass");
await c.end();
