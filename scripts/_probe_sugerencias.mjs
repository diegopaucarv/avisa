import { Client } from 'pg';

process.loadEnvFile('.env');
const url = process.env.NEON_OWNER_URL ?? process.env.DATABASE_URL;
const cliente = new Client({ connectionString: url });
await cliente.connect();

async function q(titulo, sql, params = []) {
  try {
    const { rows } = await cliente.query(sql, params);
    console.log(`\n## ${titulo}`);
    for (const fila of rows) console.log(fila.def ?? JSON.stringify(fila));
  } catch (error) {
    console.log(`\n## ${titulo} — ERROR: ${error.message}`);
  }
}

await q(
  'core.set_audit',
  `select pg_get_functiondef(oid) as def from pg_proc
    where proname='set_audit' and pronamespace='core'::regnamespace`,
);

await q(
  'core.clasificacion_max',
  `select pg_get_functiondef(oid) as def from pg_proc
    where proname='clasificacion_max' and pronamespace='core'::regnamespace`,
);

await q(
  'core.puede_crear',
  `select pg_get_functiondef(oid) as def from pg_proc
    where proname='puede_crear' and pronamespace='core'::regnamespace`,
);

await q(
  'core.normalizar_ref',
  `select pg_get_functiondef(oid) as def from pg_proc
    where proname='normalizar_ref' and pronamespace='core'::regnamespace`,
);

await q(
  'core.anular_registro firmas',
  `select oid::regprocedure::text as def from pg_proc
    where proname in ('anular_registro','restaurar_registro') and pronamespace='core'::regnamespace`,
);

await q(
  'columnas audit.cambios',
  `select column_name, data_type, is_nullable from information_schema.columns
    where table_schema='audit' and table_name='cambios' order by ordinal_position`,
);

await q(
  'sequence/codigo de ejemplo casos',
  `select codigo_caso, nombre_caso from core.casos limit 3`,
);

await q(
  'unidades activas',
  `select id, siglas, nombre_completo from core.cat_unidades_organicas order by id limit 15`,
);

await q(
  'regiones',
  `select id, nombre from core.regiones order by id limit 30`,
);

await cliente.end();
