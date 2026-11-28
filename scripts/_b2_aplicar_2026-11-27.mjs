// B2 · Aplicación de vinculaciones documento->caso de ALTA confianza (verificadas a mano).
// - Respalda el estado previo en scripts/_respaldo_b2_2026-11-27.json
// - Aplica solo donde caso_id IS NULL (idempotente, nunca sobrescribe)
// - Deja propuestas y cola de revisión en JSON/CSV
import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
process.loadEnvFile(".env");

const data = JSON.parse(readFileSync("scripts/_mapa_datos.json", "utf8"));
const v3 = JSON.parse(readFileSync("scripts/_b2_propuestas_v3.json", "utf8"));
const docsByCodigo = Object.fromEntries(data.documentos.map((d) => [d.codigo, d]));
const casosByCodigo = Object.fromEntries(data.casos.map((k) => [k.codigo_caso, k]));
const tipoNombre = Object.fromEntries(data.tipos.map((t) => [t.id, t.nombre]));

// Decisiones verificadas leyendo título+resumen del documento y el caso.
const APLICAR = {
  "AT-2026-37_pdf": ["CS-2026-0010", "Pariahuanca/Junín/truchas/Yuracyacu: idéntico al caso."],
  "AT-2026-40_pdf": ["CS-2026-0010", "Misma mortandad de truchas y río Yuracyacu."],
  "AT-2026-62_pdf": ["CS-2026-0011", "Controversia Marcona-Lomas (Tres Hermanas/Yanyarina) y erizo rojo."],
  "AT-2026-70_pdf": ["CS-2026-0011", "COPMAR pide veda/erizo en Marcona; conflicto del caso."],
  "AT-2026-72_pdf": ["CS-2022-0002", "Damificados por derrame de petróleo en Ventanilla."],
  "AT-2026-76_pdf": ["CS-2024-0002", "Disputa por muelle de Chorrillos administrado por OSPA José Olaya Balandra."],
  "AT-2026-90_pdf": ["MD-2026-0011", "Mesa de diálogo de la cuenca del río Coralaque (Omate)."],
  "RED-2026-025": ["CS-2026-0003", "Reunión con representantes del AH 15 de Enero, Chilca."],
  "RED-2026-030": ["CS-2026-0011", "Oficio COPMAR sobre erizo rojo y alga palo (Marcona-Lomas)."],
  "AT-2026-67_pdf": ["CS-2024-0005", "FIUPAP rechaza RM de cuota de jurel y caballa: conflicto del caso."],
};

const REVISAR = {
  "AT-2026-52_pdf": "Tentativa CS-2026-0014. El doc cubre tiburón azul y perico; el caso es de aletas de tiburón. Verificar alcance.",
  "AT-2026-16_pdf": "DESCARTADO (falso positivo): 'Chimbote' aparece por convocatoria sobre bonito; el caso es infraestructura del DPA Chimbote.",
  "AT-2026-71_pdf": "Ambiguo: Ilo/Moquegua, PTAR y cámaras frigoríficas. No hay caso específico claro.",
  "RED-2026-012": "Menciona bonito (Pisco): posible CS-2026-0013, pero sin resumen no es concluyente.",
  "RED-2026-010-2": "Menciona bonito: posible CS-2026-0013, sin resumen. Revisar.",
};

const c = new Client({ connectionString: process.env.NEON_OWNER_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const countBy = async () => {
  const r = await c.query(
    `select count(*)::int total,
            count(*) filter (where caso_id is not null)::int con_caso,
            count(*) filter (where caso_id is null)::int sin_caso
       from core.documentos`,
  );
  return r.rows[0];
};

const antes = await countBy();
console.log("== ANTES ==", JSON.stringify(antes));

// --- Construir plan y validar ---
const plan = [];
for (const [codigo, [casoCodigo, motivo]] of Object.entries(APLICAR)) {
  const doc = docsByCodigo[codigo];
  const caso = casosByCodigo[casoCodigo];
  if (!doc) throw new Error(`documento no encontrado: ${codigo}`);
  if (!caso) throw new Error(`caso no encontrado: ${casoCodigo}`);
  plan.push({
    doc_codigo: codigo,
    doc_id: doc.id,
    tipo: tipoNombre[doc.tipo_id],
    titulo: doc.titulo,
    caso_codigo: casoCodigo,
    caso_id: caso.id,
    caso_nombre: caso.nombre_caso,
    motivo,
    caso_id_actual: doc.caso_id,
  });
}

console.log("\n== PLAN: vinculaciones a aplicar ==");
for (const p of plan) {
  console.log(
    `${p.doc_codigo} -> ${p.caso_codigo} (caso_id actual: ${p.caso_id_actual ?? "NULL"})\n   "${(p.titulo || "").slice(0, 90)}"`,
  );
}
const yaVinculados = plan.filter((p) => p.caso_id_actual !== null);
if (yaVinculados.length) {
  console.log("\n!! ATENCIÓN: documentos ya vinculados (NO se sobrescriben):", yaVinculados.map((p) => p.doc_codigo));
}
const ejecutables = plan.filter((p) => p.caso_id_actual === null && !p.caso_id_actual);
console.log(`\nActualizaciones efectivas previstas: ${ejecutables.length}`);

// --- Respaldo del estado previo ---
const ids = ejecutables.map((p) => p.doc_id);
const previos = await c.query(
  `select id, codigo, caso_id, tipo_id, titulo, fecha, updated_at, updated_by
     from core.documentos where id = any($1::uuid[]) order by codigo`,
  [ids],
);
const respaldo = {
  generado: new Date().toISOString(),
  tarea: "B2 · vincular documentos a casos con evidencia de entidad (verificación manual)",
  criterio_aplicado:
    "Solo documentos con entidad/conflicto único y verificable en título+resumen; sin sobrescribir caso_id existente. Código explícito CS-AAAA-NNNN: 0 casos.",
  antes,
  actualizaciones_previstas: plan,
  estado_previo_documentos: previos.rows,
};
writeFileSync("scripts/_respaldo_b2_2026-11-27.json", JSON.stringify(respaldo, null, 2));
console.log(`\nrespaldo escrito: scripts/_respaldo_b2_2026-11-27.json (${previos.rows.length} filas)`);

// --- Aplicar en transacción ---
await c.query("begin");
await c.query(`select set_config('app.rol_codigo','administrador', true)`);
await c.query(`select set_config('app.user_id','00000000-0000-0000-0000-000000000001', true)`);

const tocados = [];
for (const p of ejecutables) {
  const r = await c.query(
    `update core.documentos
        set caso_id = $1
      where id = $2 and caso_id is null`,
    [p.caso_id, p.doc_id],
  );
  tocados.push({ ...p, filas: r.rowCount });
  console.log(`update ${p.doc_codigo} -> ${p.caso_codigo}: ${r.rowCount} fila(s)`);
}
await c.query("commit");

const despues = await countBy();
console.log("\n== DESPUÉS ==", JSON.stringify(despues));
console.log("delta con_caso:", despues.con_caso - antes.con_caso, "| delta sin_caso:", despues.sin_caso - antes.sin_caso);

// --- Propuestas y cola de revisión (todos los docs sin caso) ---
const propuestas = [];
for (const p of v3.propuestas) {
  let decision = "revision_manual";
  let nota = "";
  if (APLICAR[p.doc]) {
    decision = "aplicada";
    nota = APLICAR[p.doc][1];
  } else if (REVISAR[p.doc]) {
    decision = p.doc === "AT-2026-16_pdf" ? "descartada_falso_positivo" : "revision_manual";
    nota = REVISAR[p.doc];
  } else if (p.tier === "sin") {
    decision = "sin_match";
    nota = "Sin entidad compartida con ningún caso.";
  } else if (p.tier === "estricta") {
    decision = "revision_alta";
    nota = "Firma de nombre compartida; no aplicada por ambigüedad con otro caso.";
  }
  propuestas.push({
    doc: p.doc,
    tipo: p.tipo,
    fecha: p.fecha,
    titulo: p.titulo,
    resumen: p.resumen,
    sugerido: p.caso_propuesto,
    nombre_caso: p.nombre_caso,
    tier: p.tier,
    score: p.score,
    margin: p.margin,
    sign: p.sign,
    rareName: p.rareName,
    alternativas: p.alternativas,
    decision,
    nota,
  });
}
writeFileSync(
  "scripts/b2_propuestas_2026-11-27.json",
  JSON.stringify(
    {
      generado: new Date().toISOString(),
      calibracion: v3.calibracion,
      antes,
      despues,
      tocados,
      propuestas,
    },
    null,
    2,
  ),
);

const esc = (v) => `"${String(v ?? "").replace(/"/g, '""').replace(/\s+/g, " ").trim()}"`;
const cabecera = ["doc", "tipo", "fecha", "sugerido", "tier", "score", "margin", "sign", "decision", "titulo", "nota"];
const lineas = [cabecera.join(",")];
for (const p of propuestas)
  lineas.push([p.doc, p.tipo, p.fecha, p.sugerido, p.tier, p.score, p.margin, (p.sign || []).join(" "), p.decision, p.titulo, p.nota].map(esc).join(","));
writeFileSync("scripts/b2_cola_revision_2026-11-27.csv", lineas.join("\n"));

const resumen = propuestas.reduce((m, p) => ((m[p.decision] = (m[p.decision] || 0) + 1), m), {});
console.log("\n== resumen de propuestas ==", JSON.stringify(resumen));
console.log("escrito: scripts/b2_propuestas_2026-11-27.json, scripts/b2_cola_revision_2026-11-27.csv");
await c.end();
