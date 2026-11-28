#!/usr/bin/env node
/**
 * Marca `core.casos.priorizado = true` en los cuatro casos más recientes.
 *
 * POR QUÉ EXISTE
 * --------------
 * La vista «Panorama territorial» muestra debajo del mapa la tabla de «Casos
 * priorizados». Para la demostración hace falta que esa tabla no salga vacía,
 * así que se priorizan a mano los cuatro casos abiertos con `fecha_inicio` más
 * reciente (excluyendo la anomalía CS-2022-0001, cuyo inicio está en 2027).
 *
 * Es una operación de DATOS, no una migración: sólo enciende la bandera que creó
 * la migración 76. No toca ninguna otra columna y es idempotente (volver a
 * ejecutarlo deja el mismo estado).
 *
 * USO
 *   node scripts/_priorizar_ultimos_casos_2026-11-29.mjs            # simulación
 *   node scripts/_priorizar_ultimos_casos_2026-11-29.mjs --apply    # escribe
 *
 * Para revertir la demostración:
 *   update core.casos set priorizado = false
 *    where codigo_caso in ('CS-2026-0003','CS-2026-0015','CS-2026-0010','CS-2026-0014');
 */

import { Client } from 'pg';

process.loadEnvFile('.env');

const CODIGOS = ['CS-2026-0003', 'CS-2026-0015', 'CS-2026-0010', 'CS-2026-0014'];

const APLICAR = process.argv.includes('--apply');

function dsn() {
  if (process.env.NEON_OWNER_URL) return process.env.NEON_OWNER_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error('Falta NEON_OWNER_URL o DATABASE_URL en el entorno (.env).');
}

async function main() {
  const client = new Client({ connectionString: dsn(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { rows } = await client.query(
      `select codigo_caso, nombre_caso, priorizado, fecha_inicio::text
         from core.casos
        where codigo_caso = any($1::text[])
        order by codigo_caso`,
      [CODIGOS],
    );

    const encontrados = new Set(rows.map((r) => r.codigo_caso));
    const faltantes = CODIGOS.filter((c) => !encontrados.has(c));
    if (faltantes.length > 0) {
      throw new Error(`No existen en core.casos: ${faltantes.join(', ')}`);
    }

    console.log('Casos objetivo:');
    for (const fila of rows) {
      const estado = fila.priorizado ? 'ya priorizado' : 'se priorizará';
      console.log(`  · ${fila.codigo_caso} (${fila.fecha_inicio}) — ${estado}`);
    }

    if (!APLICAR) {
      console.log('\nSimulación: no se escribió nada. Repetí con --apply.');
      return;
    }

    const update = await client.query(
      `update core.casos
          set priorizado = true
        where codigo_caso = any($1::text[])
          and priorizado is distinct from true`,
      [CODIGOS],
    );

    console.log(`\nFilas actualizadas: ${update.rowCount}`);
    const despues = await client.query(
      `select count(*)::int as total from core.casos where priorizado`,
    );
    console.log(`Casos priorizados en total: ${despues.rows[0].total}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
