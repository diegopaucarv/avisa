import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n## ' + label); console.table(r.rows); }
  catch (e) { console.log('\n## ' + label + ' -> ERROR: ' + e.message); }
};
await q('funciones pii', "select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core' and p.proname ilike '%datos_personales%'");
await q('columnas pii', "select column_name, data_type from information_schema.columns where table_schema='core' and table_name='actor_datos_personales' order by ordinal_position");
await q('filas pii', 'select count(*)::int as filas from core.actor_datos_personales');
await q('muestra actores', "select actor_uid, nombre_actual, codigo_legado, activo from core.actores order by created_at limit 5");
await q('pii de muestra', "select a.nombre_actual, d.* from core.actor_datos_personales d join core.actores a on a.actor_uid=d.actor_uid limit 3");
await q('funcion descifrar def', "select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core' and p.proname='actor_datos_personales_descifrar'");
await c.end();
