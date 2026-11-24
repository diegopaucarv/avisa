import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const esq = await c.query(`select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1`);
console.log('esquemas:', esq.rows.map(r => r.nspname).join(', '));

console.log('\n--- core.medios ---');
const medios = await c.query(`
  select column_name, data_type from information_schema.columns
  where table_schema='core' and table_name='medios' order by ordinal_position`);
console.log(medios.rows.map(r => `${r.column_name}:${r.data_type}`).join('\n'));
const mCount = await c.query('select count(*)::int as n from core.medios');
console.log('filas medios:', mCount.rows[0].n);

console.log('\n--- tablas con poblacion ---');
const pobl = await c.query(`
  select table_schema, table_name, column_name, data_type
  from information_schema.columns
  where column_name ilike '%poblacion%' or column_name ilike '%habitant%'
  order by 1,2,3`);
for (const r of pobl.rows) console.log(`${r.table_schema}.${r.table_name}.${r.column_name} (${r.data_type})`);

console.log('\n--- geometrías ---');
const geo = await c.query(`
  select table_schema, table_name, column_name, udt_name
  from information_schema.columns
  where udt_name in ('geometry','geography')
  order by 1,2,3`);
for (const r of geo.rows) console.log(`${r.table_schema}.${r.table_name}.${r.column_name} (${r.udt_name})`);

await c.end();
