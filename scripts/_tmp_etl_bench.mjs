import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
for (const esquema of ['core', 'legacy', 'staging', 'analisis', 'analytics', 'agent']) {
  const t = await c.query(`select c.relname as tabla from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relkind in ('r','p') order by 1`, [esquema]);
  const parts = t.rows.map((r) => `select '${esquema}' as esquema, '${r.tabla.replaceAll("'", "''")}' as tabla, count(*)::bigint as filas from ${quote(esquema)}.${quote(r.tabla)}`);
  if (!parts.length) continue;
  const sql = parts.join('\nunion all\n');
  const inicio = Date.now();
  try {
    const r = await c.query(sql);
    console.log(esquema, 'tablas=', t.rows.length, 'filas totales=', r.rows.reduce((a, b) => a + Number(b.filas), 0), 'ms=', Date.now() - inicio);
  } catch (e) {
    console.log(esquema, 'ERROR', e.message, 'ms=', Date.now() - inicio);
  }
}
await c.end();
