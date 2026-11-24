import { Client } from 'pg';

process.loadEnvFile('.env');

const url = process.env.NEON_OWNER_URL;
if (!url) {
  console.error('Falta NEON_OWNER_URL');
  process.exit(1);
}

const cliente = new Client({ connectionString: url });
await cliente.connect();

const tablas = ['core.usuarios', 'core.hitos_compromiso', 'core.cat_subsectores', 'core.regiones'];
for (const tabla of tablas) {
  const [esquema, nombre] = tabla.split('.');
  const { rows } = await cliente.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position`,
    [esquema, nombre],
  );
  console.log(`\n== ${tabla}`);
  for (const r of rows) console.log(`   ${r.column_name} · ${r.data_type} · null=${r.is_nullable}`);
}

const { rows: conteos } = await cliente.query(`
  select 'usuarios' as t, count(*)::int as n from core.usuarios
  union all select 'hitos_compromiso', count(*)::int from core.hitos_compromiso
  union all select 'compromisos', count(*)::int from core.compromisos
  union all select 'compromisos_estado3', count(*)::int from core.compromisos where estado_id = 3
  union all select 'compromisos_vencimiento', count(*)::int from core.compromisos where fecha_vencimiento is not null
  union all select 'hitos_con_fecha_real', count(*)::int from core.hitos_compromiso where fecha_real is not null
`);
console.log('\n== conteos');
for (const r of conteos) console.log(`   ${r.t}: ${r.n}`);

await cliente.end();
