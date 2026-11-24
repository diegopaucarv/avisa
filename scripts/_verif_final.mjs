import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const colsMig = await c.query(`
  select column_name, data_type from information_schema.columns
  where table_schema='core' and table_name='migracion_log' order by ordinal_position`);
console.log('migracion_log:', colsMig.rows.map(r => r.column_name).join(', '));

const aplicadas = await c.query('select * from core.migracion_log order by aplicada_en desc limit 20');
console.log('--- últimas migraciones ---');
for (const r of aplicadas.rows) console.log(JSON.stringify(r));

const objetos = [
  'core.actores',              // columna telefono_contacto
];
const colTel = await c.query(`
  select 1 from information_schema.columns
  where table_schema='core' and table_name='actores' and column_name='telefono_contacto'`);
console.log('actores.telefono_contacto:', colTel.rowCount ? 'EXISTE' : 'FALTA');

const t = await c.query(`
  select to_regclass(x) as oid, x from unnest($1::text[]) as x`, [[
    'core.alerta_triaje','core.sugerencia','core.cat_estados_sugerencia','core.cat_tipos_sugerencia',
    'core.adjunto','core.documento_version','core.documento_extraccion','core.compromiso_evento',
    'core.tablero_tarjeta','core.usuario_preferencia','core.configuracion','core.casos_actores',
  ]]);
for (const r of t.rows) console.log(r.x, r.oid ? 'EXISTE' : 'FALTA');

const f = await c.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='core' and proname='etl_conteos'`);
console.log('core.etl_conteos:', f.rowCount ? 'EXISTE' : 'FALTA');

const v = await c.query(`select table_name from information_schema.views where table_schema='analytics' order by 1`);
console.log('--- vistas analytics ---');
console.log(v.rows.map(r => r.table_name).join('\n'));

await c.end();
