// Respaldo de sólo lectura antes de aplicar la migración 83.
// Guarda los hechos y el texto heredado de todas las alertas en un JSON local.
import { writeFile } from 'node:fs/promises';
import { Client } from 'pg';

process.loadEnvFile('.env');
const url = process.env.NEON_OWNER_URL;
if (!url) {
  console.error('Falta NEON_OWNER_URL');
  process.exit(1);
}

const cliente = new Client({ connectionString: url });
await cliente.connect();

const hechos = await cliente.query(
  'select id, alerta_id, fecha, descripcion, orden, created_at, created_by, anulado_en from core.alerta_hechos order by alerta_id, orden',
);
const textos = await cliente.query(
  'select id, codigo_alerta, hechos_recientes from core.alertas_tempranas order by codigo_alerta',
);

await writeFile(
  'scripts/_respaldo_alerta_hechos_2026-11-27.json',
  JSON.stringify({ hechos: hechos.rows, textos: textos.rows }, null, 2),
  'utf8',
);
console.log(`Hechos respaldados: ${hechos.rowCount}`);
console.log(`Alertas con texto respaldadas: ${textos.rowCount}`);

await cliente.end();
