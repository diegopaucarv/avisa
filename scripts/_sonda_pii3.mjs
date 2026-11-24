import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql, params) => {
  try { const r = await c.query(sql, params); console.log('\n## ' + label); console.table(r.rows); }
  catch (e) { console.log('\n## ' + label + ' -> ERROR ' + e.code + ': ' + e.message); }
};
await q('def clasificacion_max', "select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='core' and p.proname='clasificacion_max'");
await q('roles', "select codigo, nivel_clasificacion from core.cat_roles where nivel_clasificacion is not null order by 1").catch?.(()=>{});
await q('roles columnas', "select column_name from information_schema.columns where table_schema='core' and table_name ilike '%rol%' order by table_name, ordinal_position");
await q('usuario roles', 'select * from core.usuario_roles limit 5');
const uid = '776dff36-7a02-45bb-a71c-e70abbe3321a';
for (const rol of ['administrador','direccion','especialista_oaipcs','sectorista']) {
  try {
    await c.query('begin');
    await c.query("select set_config('app.rol_codigo',$1,true), set_config('app.usuario_id',$2,true), set_config('app.user_id',$2,true), set_config('app.crypto_key',$3,true), set_config('app.p9_origen','sonda',true)", [rol, uid, process.env.APP_CRYPTO_KEY ?? '']);
    const nivel = await c.query('select core.clasificacion_max() as nivel');
    const r = await c.query('select dni, email, telefono from core.actor_datos_personales_descifrar($1::uuid,$2)', [uid, 'Sonda de diagnostico']);
    console.log('\n## rol ' + rol + ' nivel=' + nivel.rows[0].nivel);
    console.table(r.rows);
    await c.query('rollback');
  } catch (e) {
    await c.query('rollback');
    console.log('\n## rol ' + rol + ' -> ERROR ' + e.code + ': ' + e.message);
  }
}
await c.end();
