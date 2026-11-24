import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const def = await c.query("select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core' and p.proname='actor_datos_personales_descifrar'");
console.log(def.rows[0]?.def ?? 'sin definicion');
const uid = '776dff36-7a02-45bb-a71c-e70abbe3321a';
try {
  const r = await c.query('select dni, email, telefono from core.actor_datos_personales_descifrar($1::uuid, $2)', [uid, 'Prueba de sonda']);
  console.log('\n## llamada OK'); console.table(r.rows);
} catch (e) {
  console.log('\n## llamada ERROR ' + e.code + ': ' + e.message);
}
const cfg = await c.query("select name, setting from pg_settings where name ilike '%clave%' or name ilike '%encrypt%' or name ilike '%key%'");
console.table(cfg.rows);
await c.end();
