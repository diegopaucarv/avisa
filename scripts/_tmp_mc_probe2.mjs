import pg from 'pg';

process.loadEnvFile('.env');

function conectar(url) {
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
}

const owner = conectar(process.env.NEON_OWNER_URL);
await owner.connect();

const def = await owner.query(
  "select pg_get_viewdef('analytics.vw_anexo_15_matriz_conflictividad'::regclass, true) as def",
);
console.log('## view def\n' + def.rows[0].def);

const pol = await owner.query(
  "select policyname, cmd, qual, with_check from pg_policies where schemaname='core' and tablename='casos' order by policyname",
);
console.log('\n## policies core.casos');
for (const p of pol.rows) console.log('-', p.policyname, '|', p.cmd, '|', p.qual);

const roles = await owner.query(
  "select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('avisa_app','avisa_owner')",
);
console.log('\n## roles');
console.table(roles.rows);

const rel = await owner.query(
  "select reloptions from pg_class where oid = 'analytics.vw_anexo_15_matriz_conflictividad'::regclass",
);
console.log('\n## reloptions');
console.table(rel.rows);

await owner.end();

const app = conectar(process.env.APP_DATABASE_URL);
await app.connect();
await app.query('begin');
await app.query(
  "select set_config('app.rol_codigo','administrador',true), set_config('app.usuario_id','00000000-0000-0000-0000-000000000001',true)",
);
const r1 = await app.query(
  "select c.codigo_caso, c.anulado_en, c.id is null as sin_join from analytics.vw_anexo_15_matriz_conflictividad v left join core.casos c on c.codigo_caso = v.codigo_caso where v.codigo_caso='CS-MI-ITE-2026-02'",
);
console.log('\n## app anulada row');
console.table(r1.rows);
const r2 = await app.query('select current_user as usuario, count(*)::int n from core.casos');
console.log('\n## app count core.casos');
console.table(r2.rows);
await app.query('rollback');
await app.end();
