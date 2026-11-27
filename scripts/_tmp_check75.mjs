import process from "node:process";
import { Client } from "pg";

process.loadEnvFile(".env");

const client = new Client({ connectionString: process.env.NEON_OWNER_URL });
await client.connect();

const res = await client.query(`
  select codigo_alerta as codigo, fecha_reporte, hechos_recientes
    from core.alertas_tempranas
   where hechos_recientes is not null and btrim(hechos_recientes) <> ''
   order by codigo
   limit 6
`);

for (const fila of res.rows) {
  console.log("=== ", fila.codigo, "reporte:", fila.fecha_reporte);
  console.log(fila.hechos_recientes.split(/\r?\n/).map((l) => `  |${l}`).join("\n"));
}

const soloFecha = await client.query(`
  select count(*)::int as n
    from core.alerta_hechos
   where fecha is not null and btrim(descripcion) = ''
`);
console.log("hechos sin descripcion:", soloFecha.rows[0].n);

await client.end();
