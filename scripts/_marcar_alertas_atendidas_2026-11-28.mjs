#!/usr/bin/env node
/**
 * Marca como «Atendida» toda alerta reportada antes de noviembre de 2026.
 *
 * El estado de la alerta no es una columna: se deriva en SQL con
 * `paso_actual >= 5` (ver `ALERT_STATE` en lib/db/repos/alerts.ts). Por eso la
 * operación consiste en llevar `paso_actual` a 5 en las alertas antiguas; así
 * la interfaz —que ahora filtra Atendidas / Pendientes— muestra como
 * pendientes sólo las del mes en curso.
 *
 * Uso:
 *   node scripts/_marcar_alertas_atendidas_2026-11-28.mjs           # dry-run
 *   node scripts/_marcar_alertas_atendidas_2026-11-28.mjs --apply   # aplica
 *
 * Antes de escribir guarda un respaldo con el `paso_actual` previo de cada
 * fila, para poder revertir con `--rollback <archivo>`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

process.loadEnvFile('.env');

const CORTE = '2026-11-01';
const PASO_ATENDIDA = 5;
const RESPALDO = resolve('backups/alertas_paso_actual_2026-11-28.json');

const argumentos = process.argv.slice(2);
const aplicar = argumentos.includes('--apply');
const indiceRollback = argumentos.indexOf('--rollback');

const { Client } = await import('pg');

const cliente = new Client({
  connectionString: process.env.NEON_OWNER_URL,
  ssl: { rejectUnauthorized: false },
});

/** Alertas activas (ni anuladas ni archivadas) reportadas antes del corte. */
const FILTRO = `
  anulado_en is null
  and archivado_en is null
  and fecha_reporte < $1
  and coalesce(paso_actual, 0) < $2
`;

async function respaldar(filas) {
  await mkdir(dirname(RESPALDO), { recursive: true });
  await writeFile(
    RESPALDO,
    JSON.stringify({ corte: CORTE, pasoAtendida: PASO_ATENDIDA, filas }, null, 2),
    'utf8',
  );
  console.log(`Respaldo escrito en ${RESPALDO} (${filas.length} filas).`);
}

async function revertir(archivo) {
  const { filas, pasoAtendida } = JSON.parse(await readFile(archivo, 'utf8'));
  await cliente.connect();
  // Sólo revierte las filas que siguen en el paso que escribimos: si alguien
  // las movió después, su estado actual manda y no se pisa.
  let revertidas = 0;
  for (const fila of filas) {
    const resultado = await cliente.query(
      `update core.alertas_tempranas
          set paso_actual = $1
        where id = $2 and paso_actual = $3`,
      [fila.paso_actual, fila.id, pasoAtendida],
    );
    revertidas += resultado.rowCount;
  }
  console.log(`Revertidas ${revertidas}/${filas.length} filas.`);
  await cliente.end();
}

if (indiceRollback >= 0) {
  await revertir(argumentos[indiceRollback + 1] ?? RESPALDO);
  process.exit(0);
}

await cliente.connect();

const { rows } = await cliente.query(
  `select id, codigo_alerta, to_char(fecha_reporte, 'YYYY-MM-DD') as fecha, paso_actual
     from core.alertas_tempranas
    where ${FILTRO}
    order by fecha_reporte`,
  [CORTE, PASO_ATENDIDA],
);

const antes = await cliente.query(
  `select count(*) filter (where coalesce(paso_actual, 0) >= 5) as atendidas,
          count(*) as total
     from core.alertas_tempranas
    where anulado_en is null and archivado_en is null`,
);

console.log(
  `Alertas activas: ${antes.rows[0].total} · ya atendidas: ${antes.rows[0].atendidas}`,
);
console.log(`A marcar como atendidas (fecha_reporte < ${CORTE}): ${rows.length}`);

if (!aplicar) {
  if (rows.length > 0) {
    console.table(
      rows.map((fila) => ({
        codigo: fila.codigo_alerta,
        fecha: fila.fecha,
        pasoActual: fila.paso_actual,
      })),
    );
  }
  console.log('\nDry-run: no se escribió nada. Repite con --apply para aplicar.');
  await cliente.end();
  process.exit(0);
}

await respaldar(rows.map((fila) => ({ id: fila.id, paso_actual: fila.paso_actual })));

const actualizacion = await cliente.query(
  `update core.alertas_tempranas
      set paso_actual = $2
    where ${FILTRO}`,
  [CORTE, PASO_ATENDIDA],
);

const despues = await cliente.query(
  `select count(*) filter (where coalesce(paso_actual, 0) >= 5) as atendidas,
          count(*) filter (where coalesce(paso_actual, 0) < 5) as pendientes
     from core.alertas_tempranas
    where anulado_en is null and archivado_en is null`,
);

console.log(`Actualizadas: ${actualizacion.rowCount}`);
console.log(
  `Estado resultante → atendidas: ${despues.rows[0].atendidas} · pendientes: ${despues.rows[0].pendientes}`,
);

await cliente.end();
