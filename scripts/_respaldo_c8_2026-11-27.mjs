// Respaldo previo a la migración 85 (C8): las filas de alerta_hechos que
// empezamos a tocar y el hechos_recientes de sus alertas, tal como están hoy.
import { Client } from "pg";
import { writeFileSync } from "node:fs";
process.loadEnvFile(".env");

const c = new Client({
  connectionString: process.env.NEON_OWNER_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const afectadas = await c.query(
  `select id from core.alertas_tempranas a
    where exists (
      select 1 from core.alerta_hechos h
       where h.alerta_id = a.id
         and h.anulado_en is null
         and h.descripcion ~ '^\\*\\s*\\d{1,2}[A-Za-z]{3,4}\\d{4}'
    )`,
);

const ids = afectadas.rows.map((r) => r.id);
console.log("alertas afectadas:", ids.length);

const hechos = await c.query(
  `select id, alerta_id, fecha, descripcion, orden, created_at
     from core.alerta_hechos
    where alerta_id = any($1::uuid[])
    order by alerta_id, orden`,
  [ids],
);

const alertas = await c.query(
  `select id, codigo_alerta, hechos_recientes
     from core.alertas_tempranas
    where id = any($1::uuid[])`,
  [ids],
);

const destino = "scripts/_respaldo_c8_2026-11-27.json";
writeFileSync(
  destino,
  JSON.stringify(
    {
      generado: new Date().toISOString(),
      motivo: "respaldo previo a migration/85_c8_hechos_fecha_compacta",
      alertas: alertas.rows,
      hechos: hechos.rows,
    },
    null,
    2,
  ),
);
console.log("escrito", destino, "·", hechos.rows.length, "hechos");
await c.end();
