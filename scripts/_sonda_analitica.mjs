import pg from 'pg';
import { writeFile } from 'node:fs/promises';
process.loadEnvFile('.env');
const url = process.env.NEON_OWNER_URL || process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();

const out = [];
const q = async (label, sql) => {
  out.push('\n## ' + label);
  try {
    const r = await c.query(sql);
    out.push(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
};

const tablas = [
  ['core', 'compromisos'],
  ['core', 'hitos_compromiso'],
  ['core', 'documentos'],
  ['core', 'reuniones_dialogo'],
  ['core', 'usuarios'],
  ['core', 'caso_regiones'],
  ['core', 'caso_cronologia'],
];
for (const [esquema, tabla] of tablas) {
  await q(
    `${esquema}.${tabla}`,
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema='${esquema}' and table_name='${tabla}'
      order by ordinal_position`,
  );
}

await q(
  'vistas',
  `select table_schema, table_name from information_schema.tables
    where table_schema in ('analytics','core') and table_type='VIEW' order by 1,2`,
);

await q(
  'columnas created_by/at en core',
  `select table_name, column_name, data_type
     from information_schema.columns
    where table_schema='core'
      and column_name in ('created_at','created_by','fecha_inicio','fecha_reunion','fecha_reporte','fecha_registro')
    order by table_name, column_name`,
);

await q('migracion_log', 'select clave, aplicada_en from core.migracion_log order by aplicada_en');
await q('regiones count', 'select count(*)::int n from core.regiones');
await q('distritos count', 'select count(*)::int n from core.distritos');

await writeFile('scripts/_sonda_analitica.out.txt', out.join('\n'), 'utf8');
console.log('escrito scripts/_sonda_analitica.out.txt');
await c.end();
