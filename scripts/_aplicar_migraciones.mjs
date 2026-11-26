// Aplica un lote de migraciones a una base, en orden, con respaldo previo de
// las definiciones de las vistas que se recrean.
// Uso: node scripts/_aplicar_migraciones.mjs neon|local archivo1.sql archivo2.sql ...
// No imprime credenciales. Aborta en el primer error y hace ROLLBACK.
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';

process.loadEnvFile('.env');

const [destino, ...archivos] = process.argv.slice(2);
if (!destino || archivos.length === 0) {
  console.error('Uso: node scripts/_aplicar_migraciones.mjs neon|local <archivo.sql> [...]');
  process.exit(1);
}

const url = destino === 'local' ? process.env.DATABASE_URL : process.env.NEON_OWNER_URL;
if (!url) {
  console.error(`Falta ${destino === 'local' ? 'DATABASE_URL' : 'NEON_OWNER_URL'}`);
  process.exit(1);
}

const cliente = new Client({ connectionString: url });
await cliente.connect();
const host = new URL(url).hostname;
console.log(`Destino: ${destino} · ${host}`);

// Respaldo de las definiciones de las vistas antes de recrearlas.
const vistas = [
  'analytics.vw_anexo_14_seguimiento_compromisos',
  'analytics.vw_anexo_15_matriz_conflictividad',
];
const respaldo = {};
for (const vista of vistas) {
  const { rows } = await cliente.query('select pg_get_viewdef($1::regclass, true) as def', [vista]);
  respaldo[vista] = rows[0]?.def ?? null;
}
const rutaRespaldo = `scripts/_respaldo_vistas_${destino}.json`;
await writeFile(rutaRespaldo, JSON.stringify(respaldo, null, 2), 'utf8');
console.log(`Respaldo de definiciones: ${rutaRespaldo}`);

for (const archivo of archivos) {
  const sql = await readFile(archivo, 'utf8');
  process.stdout.write(`\n→ ${archivo} ... `);
  try {
    await cliente.query(sql);
    console.log('OK');
  } catch (error) {
    console.log(`FALLÓ\n   ${error.message}`);
    if (error.position) {
      const linea = sql.slice(0, Number(error.position)).split('\n').length;
      console.log(`   cerca de la línea ${linea} del archivo`);
    }
    try {
      await cliente.query('rollback');
    } catch {
      /* la conexión pudo quedar inutilizable */
    }
    await cliente.end();
    process.exit(1);
  }
}

const { rows } = await cliente.query('select clave, aplicada_en from core.migracion_log order by aplicada_en');
console.log('\n## migracion_log');
for (const fila of rows) console.log(`${fila.clave}  ${fila.aplicada_en.toISOString()}`);

await cliente.end();
