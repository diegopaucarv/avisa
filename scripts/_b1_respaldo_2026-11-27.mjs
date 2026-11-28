// B1 · Respaldo + plan de desvinculación de CS-2026-0003 (Aceros Americanos).
// Criterio conservador: solo se desvincula lo que NO menciona el caso
// (ni "Aceros Americanos"/"ACERO AMERICANO", ni el código, ni el conflicto).
// Este script NO escribe: genera el respaldo y el plan. Si no hay filas
// clasificables, el plan es de 0 actualizaciones.
import { Client } from "pg";
import { writeFileSync } from "node:fs";
process.loadEnvFile(".env");

const c = new Client({ connectionString: process.env.NEON_OWNER_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const CODIGO = "CS-2026-0003";
const caso = (await c.query(`select * from core.casos where codigo_caso = $1`, [CODIGO])).rows[0];
if (!caso) throw new Error(`No existe el caso ${CODIGO}`);
const casoId = caso.id;

const demandas = (
  await c.query(`select * from core.demandas where caso_id = $1 order by id`, [casoId])
).rows;

const alertas = (
  await c.query(
    `select id, codigo_alerta, codigo_legado, caso_id, titulo, situacion_actual,
            descripcion_riesgo, hechos_recientes, origen_dato, created_at, anulado_en
       from core.alertas_tempranas where caso_id = $1 order by codigo_alerta`,
    [casoId],
  )
).rows;

// Demanda indirecta: documento_origen_id de un documento ya vinculado al caso.
const demandasIndirectas = (
  await c.query(
    `select d.id, d.codigo_legado, d.caso_id, d.documento_origen_id, d.descripcion_demanda
       from core.demandas d
      where d.documento_origen_id in (select id from core.documentos where caso_id = $1)`,
    [casoId],
  )
).rows;

const ACIERTO = /aceros?[\s-]*americanos?|acero[\s-]*americano|\baceros americanos\b/i;
const CODIGO_RE = /CS-2026-0003|CS-MI-ITE-2026-03/i;
const CONFLICTO = /chilca|15 de enero|eia|audiencia|participaci[oó]n ciudadana|horarios?|chatarra|planta de (tratamiento|acero)/i;

const clasificar = (texto) => {
  const t = texto || "";
  const razones = [];
  if (ACIERTO.test(t)) razones.push("menciona 'Aceros Americanos'/'ACERO AMERICANO'");
  if (CODIGO_RE.test(t)) razones.push("cita el código del caso");
  if (CONFLICTO.test(t)) razones.push("describe el conflicto del caso (Chilca/15 de Enero/EIA/participación)");
  return razones;
};

const plan = { desvincular: [], revisar: [], conservar: [] };
for (const a of alertas) {
  const texto = [a.titulo, a.situacion_actual, a.descripcion_riesgo, a.hechos_recientes].join(" ");
  const razones = clasificar(texto);
  (razones.length ? plan.conservar : plan.revisar).push({
    tabla: "core.alertas_tempranas",
    id: a.id,
    codigo: a.codigo_alerta,
    razones,
    titulo: a.titulo,
  });
}
for (const d of demandas) {
  const razones = clasificar(d.descripcion_demanda);
  (razones.length ? plan.conservar : plan.revisar).push({
    tabla: "core.demandas",
    id: d.id,
    codigo: d.codigo_legado,
    razones,
    titulo: (d.descripcion_demanda || "").slice(0, 200),
  });
}

const conteos = {
  demandas_vinculadas_antes: demandas.length,
  alertas_vinculadas_antes: alertas.length,
  demandas_indirectas_por_documento: demandasIndirectas.length,
  a_desvincular: plan.desvincular.length,
  a_revisar: plan.revisar.length,
  a_conservar: plan.conservar.length,
};

const respaldo = {
  generado: new Date().toISOString(),
  tarea: "B1 · desvincular de CS-2026-0003 lo que no cita el caso",
  criterio:
    "Solo se desvincula si el texto NO menciona 'Aceros Americanos'/'ACERO AMERICANO', ni el código CS-2026-0003/CS-MI-ITE-2026-03, ni describe el conflicto (Chilca, AH 15 de Enero, EIA, audiencia, participación ciudadana, horarios, chatarra/planta de acero). Si hay duda, se deja intacto y se marca 'revisar a mano'.",
  nota_deriva:
    "El estado actual NO coincide con la premisa de 16 demandas: hay 0 demandas con caso_id = CS-2026-0003. migration/54_demandas_desvinculo_caso_2026_11_24.sql ya desvinculó esas 16 demandas del entonces CS-MI-ITE-2026-03 (hoy recodificado CS-2026-0003) y el dataset se recargó (132 demandas, no 325). Los códigos DEM-2026-0097..0140 no existen en la base.",
  caso: {
    id: caso.id,
    codigo_caso: caso.codigo_caso,
    codigo_legado: caso.codigo_legado,
    nombre_caso: caso.nombre_caso,
  },
  conteos,
  plan,
  demandas_previas: demandas,
  alertas_previas: alertas,
  demandas_indirectas_por_documento: demandasIndirectas,
};

const destino = "scripts/_respaldo_b1_2026-11-27.json";
writeFileSync(destino, JSON.stringify(respaldo, null, 2));

console.log("== B1 · PLAN (sin escribir) ==");
console.log("caso:", CODIGO, caso.id);
console.log("conteos:", JSON.stringify(conteos, null, 2));
console.log("\nA DESVINCULAR:");
console.log(plan.desvincular.length ? plan.desvincular : "  (ninguna fila)");
console.log("\nCONSERVAR (cita el caso):");
for (const x of plan.conservar) console.log(`  ${x.tabla} ${x.codigo} -> ${x.razones.join("; ")}`);
console.log("\nREVISAR A MANO:");
console.log(plan.revisar.length ? plan.revisar : "  (ninguna fila)");
console.log(`\nrespaldo escrito: ${destino}`);
await c.end();
