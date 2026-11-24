import pg from 'pg';
process.loadEnvFile('.env');
const owner = process.env.NEON_OWNER_URL;
const c = new pg.Client({ connectionString: owner, ssl: { rejectUnauthorized: false } });
await c.connect();

const tablas = [
  'core.adjunto',
  'core.documento_version',
  'core.documento_extraccion',
  'core.documento_lista_blanca',
  'core.usuario_preferencia',
  'core.configuracion',
  'core.tablero_tarjeta',
  'core.tablero_tarjeta_evento',
  'core.compromiso_evento',
  'core.actor_fusion',
  'core.caso_duplicado_descartado',
  'core.caso_nudo_critico',
  'core.notificaciones',
  'core.casos_actores',
  'core.documentos',
];
for (const t of tablas) {
  const r = await c.query('select to_regclass($1) as oid', [t]);
  console.log(t, r.rows[0].oid ? 'EXISTE' : 'FALTA');
}

const cols = await c.query(`
  select table_name, column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema='core'
    and table_name in ('casos_actores','documentos','notificaciones','compromiso_evento','documento_version','tablero_tarjeta')
  order by table_name, ordinal_position`);
console.log('\n--- Columnas ---');
for (const r of cols.rows) {
  console.log(`${r.table_name}.${r.column_name} : ${r.data_type} ${r.is_nullable === 'NO' ? 'NOT NULL' : 'null'}`);
}

const mig = await c.query('select numero, descripcion, aplicada_en from core.migracion_log order by numero desc limit 12');
console.log('\n--- migracion_log ---');
console.table(mig.rows);

await c.end();
