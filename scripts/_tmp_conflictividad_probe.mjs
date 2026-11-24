// Sonda temporal: verifica que la vista del Anexo 15 y sus tablas fuente existan,
// y qué migraciones están registradas en core.migracion_log.
import { Client } from 'pg';

process.loadEnvFile('.env');

const url = process.env.NEON_OWNER_URL;
if (!url) {
  console.error('Falta NEON_OWNER_URL');
  process.exit(1);
}

const cliente = new Client({ connectionString: url });
await cliente.connect();
console.log(`Destino: neon · ${new URL(url).hostname}`);

console.log('\n## vistas con «anexo_15» o «conflictividad»');
const vistas = await cliente.query(
  `select schemaname, viewname
     from pg_views
    where schemaname not in ('pg_catalog', 'information_schema')
      and (viewname ilike '%anexo_15%' or viewname ilike '%conflictividad%')
    order by schemaname, viewname`,
);
for (const fila of vistas.rows) console.log(`${fila.schemaname}.${fila.viewname}`);
if (vistas.rows.length === 0) console.log('(ninguna)');

console.log('\n## columnas de analytics.vw_anexo_15_matriz_conflictividad');
const columnas = await cliente.query(
  `select column_name, data_type
     from information_schema.columns
    where table_schema = 'analytics'
      and table_name = 'vw_anexo_15_matriz_conflictividad'
    order by ordinal_position`,
);
for (const fila of columnas.rows) console.log(`${fila.column_name} :: ${fila.data_type}`);
if (columnas.rows.length === 0) console.log('(no existe la vista o no tiene columnas)');

console.log('\n## tablas base consumidas');
const tablas = [
  'core.casos',
  'core.demandas',
  'core.compromisos',
  'core.actores',
  'core.caso_cronologia',
  'core.documentos',
  'core.migracion_log',
];
for (const tabla of tablas) {
  const [esquema, nombre] = tabla.split('.');
  const r = await cliente.query(
    `select 1
       from information_schema.tables
      where table_schema = $1 and table_name = $2
      limit 1`,
    [esquema, nombre],
  );
  console.log(`${tabla}: ${r.rowCount ? 'existe' : 'FALTA'}`);
}

console.log('\n## catálogos core.cat_*');
const catalogos = await cliente.query(
  `select table_name
     from information_schema.tables
    where table_schema = 'core' and table_name like 'cat_%'
    order by table_name`,
);
for (const fila of catalogos.rows) console.log(fila.table_name);

console.log('\n## core.migracion_log');
const log = await cliente.query('select clave, aplicada_en from core.migracion_log order by aplicada_en');
for (const fila of log.rows) console.log(`${fila.clave}  ${fila.aplicada_en.toISOString()}`);
console.log(`(${log.rowCount} filas)`);

console.log('\n## conteo y distribución de la vista (rol owner, bypass RLS)');
try {
  const total = await cliente.query(
    'select count(*)::int as total from analytics.vw_anexo_15_matriz_conflictividad',
  );
  console.log(`filas en la vista: ${total.rows[0].total}`);

  const conCasos = await cliente.query(
    `select count(*)::int as total
       from analytics.vw_anexo_15_matriz_conflictividad v
       join core.casos c on c.codigo_caso = v.codigo_caso and c.anulado_en is null`,
  );
  console.log(`filas tras INNER JOIN core.casos (no anulado): ${conCasos.rows[0].total}`);

  const dist = await cliente.query(
    `select coalesce(v.nivel_conflicto, '(sin nivel)') as nivel, count(*)::int as n
       from analytics.vw_anexo_15_matriz_conflictividad v
       join core.casos c on c.codigo_caso = v.codigo_caso and c.anulado_en is null
      group by 1
      order by 2 desc`,
  );
  console.log('distribución por nivel_conflicto:');
  for (const fila of dist.rows) console.log(`  ${fila.nivel}: ${fila.n}`);
} catch (error) {
  console.log(`No se pudo consultar la vista: ${error.message}`);
}

await cliente.end();
