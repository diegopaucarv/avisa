// Chequeo final: idempotencia (dentro de una transacción con rollback), estado B1/B2
// y consistencia documento AT vs alerta.
import { Client } from "pg";
process.loadEnvFile(".env");
const c = new Client({ connectionString: process.env.NEON_OWNER_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const APLICADAS = {
  "AT-2026-37_pdf": "CS-2026-0010",
  "AT-2026-40_pdf": "CS-2026-0010",
  "AT-2026-62_pdf": "CS-2026-0011",
  "AT-2026-70_pdf": "CS-2026-0011",
  "AT-2026-72_pdf": "CS-2022-0002",
  "AT-2026-76_pdf": "CS-2024-0002",
  "AT-2026-90_pdf": "MD-2026-0011",
  "RED-2026-025": "CS-2026-0003",
  "RED-2026-030": "CS-2026-0011",
  "AT-2026-67_pdf": "CS-2024-0005",
};

// 1) Idempotencia: repetir el UPDATE dentro de una tx y hacer rollback.
await c.query("begin");
await c.query(`select set_config('app.rol_codigo','administrador', true)`);
await c.query(`select set_config('app.user_id','00000000-0000-0000-0000-000000000001', true)`);
let filasReintento = 0;
for (const [codigo, casoCodigo] of Object.entries(APLICADAS)) {
  const r = await c.query(
    `update core.documentos d set caso_id = c.id
       from core.casos c
      where d.codigo = $1 and c.codigo_caso = $2 and d.caso_id is null`,
    [codigo, casoCodigo],
  );
  filasReintento += r.rowCount;
}
await c.query("rollback");
console.log(`Idempotencia: filas afectadas al reintentar = ${filasReintento} (esperado 0)`);

// 2) Estado B1
const b1 = await c.query(`
  select
    (select count(*) from core.demandas d join core.casos c on c.id=d.caso_id where c.codigo_caso='CS-2026-0003')::int demandas,
    (select count(*) from core.alertas_tempranas a join core.casos c on c.id=a.caso_id where c.codigo_caso='CS-2026-0003')::int alertas`);
console.log("B1 estado:", JSON.stringify(b1.rows[0]));

// 3) Estado B2
const b2 = await c.query(`
  select count(*)::int total,
         count(*) filter (where caso_id is not null)::int con_caso,
         count(*) filter (where caso_id is null)::int sin_caso
    from core.documentos`);
console.log("B2 estado:", JSON.stringify(b2.rows[0]));

// 4) Consistencia: alertas de los documentos AT aplicados
const ats = await c.query(`
  select a.codigo_alerta, a.caso_id is not null as alerta_tiene_caso,
         c.codigo_caso
    from core.alertas_tempranas a
    left join core.casos c on c.id=a.caso_id
   where a.codigo_alerta = any($1::text[])
   order by 1`,
  [["AT-2026-37", "AT-2026-40", "AT-2026-62", "AT-2026-70", "AT-2026-72", "AT-2026-76", "AT-2026-90", "AT-2026-67"]],
);
console.log("\nConsistencia alertas (AT):");
for (const r of ats.rows) console.log(`  ${r.codigo_alerta}: alerta.caso = ${r.alerta_tiene_caso ? r.codigo_caso : "NULL"}`);

// 5) Distribución final de documentos por caso (top)
const dist = await c.query(`
  select c.codigo_caso, count(*)::int docs
    from core.documentos d join core.casos c on c.id=d.caso_id
   group by 1 order by 2 desc limit 10`);
console.log("\nDocumentos por caso (top 10):");
for (const r of dist.rows) console.log(`  ${r.codigo_caso}: ${r.docs}`);

await c.end();
