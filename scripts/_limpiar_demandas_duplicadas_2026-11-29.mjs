// Limpieza de demandas duplicadas de la carga histórica AVISA.
//
// Contexto: la alerta `7d879728-27b6-48a2-8b56-f93c6c0ac9ac` tiene siete filas en
// `core.demandas` que en realidad son tres demandas:
//   · una fila con el texto concatenado («1. … 2. … 3. …»), el volcado original;
//   · dos copias de cada una de las tres demandas sueltas.
// Las migraciones de carga partieron el texto sin deduplicar.
//
// Criterio, pensado para no perder datos:
//   1. Agrupa por texto normalizado (`core.normalizar_ref`).
//   2. De cada grupo con más de una fila vigente, conserva la que tenga más
//      dependencias (`compromisos`, `compromiso_demandas`, `demandas_actores`,
//      `demandas_evidencias`); a igualdad, la más antigua y luego el id.
//   3. Anula las demás (baja lógica: `anulado_en`, `anulado_por`,
//      `motivo_anulacion`). Nunca borra.
//   4. Anula también la fila concatenada («1. …») si todas sus partes ya están
//      cubiertas por demandas vigentes y no tiene dependencias.
//   5. Si una fila candidata a anular tuviera dependencias, la salta y avisa.
//
// Uso:
//   node scripts/_limpiar_demandas_duplicadas_2026-11-29.mjs            (dry-run)
//   node scripts/_limpiar_demandas_duplicadas_2026-11-29.mjs --apply    (escribe)
import { Client } from "pg";
import { writeFileSync } from "node:fs";
process.loadEnvFile(".env");

const ALERTA_ID = "7d879728-27b6-48a2-8b56-f93c6c0ac9ac";
const USUARIO_LIMPIEZA = "00000000-0000-0000-0000-000000000001"; // «Carga legado AVISA 2026»
const MOTIVO =
  "Duplicado de la carga histórica AVISA: la misma demanda ya está registrada vigente en esta alerta.";

const aplicar = process.argv.includes("--apply");

const c = new Client({
  connectionString: process.env.NEON_OWNER_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const TABLAS_DEPENDIENTES = [
  "core.compromisos",
  "core.compromiso_demandas",
  "core.demandas_actores",
  "core.demandas_evidencias",
];

async function dependencias(id) {
  let total = 0;
  for (const t of TABLAS_DEPENDIENTES) {
    const r = await c.query(`select count(*)::int n from ${t} where demanda_id = $1`, [id]);
    total += r.rows[0].n;
  }
  return total;
}

// 1 · Filas de la alerta ------------------------------------------------
const filas = await c.query(
  `select id,
          descripcion_demanda,
          core.normalizar_ref(descripcion_demanda) as clave,
          created_at,
          anulado_en
     from core.demandas
    where alerta_id = $1
    order by created_at, id`,
  [ALERTA_ID],
);

const vigentes = filas.rows.filter((f) => f.anulado_en === null);
console.log(`alertas: ${filas.rows.length} filas · ${vigentes.length} vigentes`);

// 2 · Agrupar por texto normalizado ------------------------------------
const grupos = new Map();
for (const f of vigentes) {
  const k = f.clave || `__vacia__${f.id}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(f);
}

const anular = [];
const conservar = [];
const saltadas = [];

for (const [clave, grupo] of grupos) {
  if (grupo.length === 1) {
    conservar.push({ fila: grupo[0], motivo: "única de su texto" });
    continue;
  }
  // Orden de preferencia: más dependencias, luego más antigua.
  const conPeso = [];
  for (const f of grupo) conPeso.push({ fila: f, deps: await dependencias(f.id) });
  conPeso.sort((a, b) => b.deps - a.deps || a.fila.created_at - b.fila.created_at);
  conservar.push({ fila: conPeso[0].fila, motivo: `conservada (${conPeso[0].deps} dependencias)` });
  for (const resto of conPeso.slice(1)) {
    if (resto.deps > 0) {
      saltadas.push({ fila: resto.fila, motivo: `tiene ${resto.deps} dependencias` });
    } else {
      anular.push({ fila: resto.fila, motivo: "copia exacta de otra vigente" });
    }
  }
}

// 3 · La fila concatenada «1. … 2. …» -----------------------------------
const concatenadas = vigentes.filter((f) => /^\s*1\s*[.)]/.test(f.descripcion_demanda || ""));
for (const conc of concatenadas) {
  const yaCubierta = vigentes.some(
    (o) =>
      o.id !== conc.id &&
      o.descripcion_demanda &&
      !/^\s*1\s*[.)]/.test(o.descripcion_demanda) &&
      (conc.descripcion_demanda || "").includes(o.descripcion_demanda.trim()),
  );
  const deps = await dependencias(conc.id);
  if (yaCubierta && deps === 0) {
    if (!anular.some((a) => a.fila.id === conc.id)) {
      anular.push({ fila: conc, motivo: "texto concatenado ya dividido en demandas vigentes" });
    }
  } else if (!yaCubierta || deps > 0) {
    saltadas.push({
      fila: conc,
      motivo: yaCubierta ? `tiene ${deps} dependencias` : "sus partes no están todas vigentes",
    });
  }
}

// 4 · Informe ------------------------------------------------------------
// La fila concatenada puede haber entrado antes en «conservar»; sale de ahí
// en cuanto se decide anularla.
const idsAnular = new Set(anular.map((x) => x.fila.id));
const conservarFinal = conservar.filter((x) => !idsAnular.has(x.fila.id));

console.log("\nCONSERVAR");
for (const x of conservarFinal) {
  console.log(`  ${x.fila.id.slice(0, 8)} · ${x.motivo} · ${JSON.stringify((x.fila.descripcion_demanda || "").slice(0, 60))}`);
}
console.log("\nANULAR");
for (const x of anular) {
  console.log(`  ${x.fila.id.slice(0, 8)} · ${x.motivo} · ${JSON.stringify((x.fila.descripcion_demanda || "").slice(0, 60))}`);
}
if (saltadas.length) {
  console.log("\nSALTADAS (no se tocan)");
  for (const x of saltadas) {
    console.log(`  ${x.fila.id.slice(0, 8)} · ${x.motivo}`);
  }
}

if (!aplicar) {
  console.log("\n(dry-run) sin cambios. Repite con --apply para escribir.");
  await c.end();
  process.exit(0);
}

// 5 · Respaldo + escritura ----------------------------------------------
const respaldo = "scripts/_respaldo_demandas_duplicadas_2026-11-29.json";
writeFileSync(
  respaldo,
  JSON.stringify(
    {
      generado: new Date().toISOString(),
      motivo: "respaldo previo a anular demandas duplicadas de la alerta 7d879728",
      alertaId: ALERTA_ID,
      filas: filas.rows,
      aAnular: anular.map((x) => x.fila.id),
    },
    null,
    2,
  ),
);
console.log("\nrespaldo escrito:", respaldo);

const ids = anular.map((x) => x.fila.id);
if (!ids.length) {
  console.log("nada que anular.");
  await c.end();
  process.exit(0);
}

const upd = await c.query(
  `update core.demandas
      set anulado_en = now(),
          anulado_por = $2,
          motivo_anulacion = $3,
          updated_at = now()
    where id = any($1::uuid[])
      and anulado_en is null`,
  [ids, USUARIO_LIMPIEZA, MOTIVO],
);
console.log("filas anuladas:", upd.rowCount);

const check = await c.query(
  `select count(*)::int n from core.demandas where alerta_id = $1 and anulado_en is null`,
  [ALERTA_ID],
);
console.log("demandas vigentes de la alerta tras la limpieza:", check.rows[0].n);

await c.end();
