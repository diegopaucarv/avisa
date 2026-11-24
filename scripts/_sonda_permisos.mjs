import pg from 'pg';
process.loadEnvFile('.env');
const app = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const owner = process.env.NEON_OWNER_URL;
const parseUser = (u) => { try { return decodeURIComponent(new URL(u).username); } catch { return '?'; } };
console.log('APP user:', parseUser(app));
const ca = new pg.Client({ connectionString: app, ssl: { rejectUnauthorized: false } });
await ca.connect();
console.log('APP current_user:', (await ca.query('select current_user')).rows[0]);
for (const t of ['core.adjunto','core.documento_version','core.usuario_preferencia','core.tablero_tarjeta','core.compromiso_evento','core.actor_fusion','core.caso_duplicado_descartado']) {
  try { await ca.query(`select 1 from ${t} limit 1`); console.log(t, 'OK'); }
  catch (e) { console.log(t, 'ERROR', e.code, e.message); }
}
await ca.end();
const co = new pg.Client({ connectionString: owner, ssl: { rejectUnauthorized: false } });
await co.connect();
const acl = await co.query("select c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='core' and c.relname in ('casos','medios','documentos','adjunto','notificaciones','compromisos') order by 1");
console.table(acl.rows);
const pol = await co.query("select tablename, policyname, roles, cmd from pg_policies where schemaname='core' and tablename in ('casos','medios','documentos','notificaciones') order by 1,2");
console.table(pol.rows);
const grants = await co.query("select grantee, privilege_type from information_schema.role_table_grants where table_schema='core' and table_name='casos' order by 1,2");
console.table(grants.rows);
await co.end();
