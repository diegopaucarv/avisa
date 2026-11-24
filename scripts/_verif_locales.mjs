import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  select count(*)::int as total,
         count(l.distrito_id)::int as con_distrito,
         count(*)::int - count(l.distrito_id)::int as sin_distrito
  from core.locales l`);
console.log(r.rows[0]);
const m = await c.query(`
  select l.nombre, l.distrito_id, d.nombre as distrito
  from core.locales l left join core.distritos d on d.id = l.distrito_id
  order by l.nombre limit 8`);
console.table ? console.table(m.rows) : console.log(m.rows);
await c.end();
