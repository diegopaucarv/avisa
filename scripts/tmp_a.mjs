import fs from "node:fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const vars = {};
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  vars[m[1]] = v;
}

const client = new pg.Client({ connectionString: vars.DATABASE_URL });
await client.connect();
const salida = [];
const q = async (titulo, sql) => {
  try {
    const r = await client.query(sql);
    salida.push(`## ${titulo}`);
    for (const row of r.rows) salida.push(JSON.stringify(row));
  } catch (e) {
    salida.push(`## ${titulo}\nERROR: ${e.message}`);
  }
};

await q("actores por naturaleza y region", `select naturaleza, count(*)::int as total, count(region_id)::int as con_region, count(distrito_id)::int as con_distrito from core.actores group by 1`);
await q("org con region", `select count(*)::int as total, count(a.region_id)::int as con_region from core.organizaciones o join core.actores a on a.actor_uid=o.actor_uid`);
await q("tablas legacy", `select table_name from information_schema.tables where table_schema='legacy' order by 1 limit 40`);
await q("regiones", `select count(*)::int as n from core.regiones`);

await client.end();
console.log(salida.join("\n"));
