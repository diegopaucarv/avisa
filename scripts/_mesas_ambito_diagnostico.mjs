// Diagnóstico SÓLO LECTURA del ámbito de las mesas de diálogo.
// Uso: node scripts/_mesas_ambito_diagnostico.mjs
// No escribe, no migra y no imprime credenciales.
import { Client } from "pg";

process.loadEnvFile(".env");

const url = process.env.NEON_OWNER_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Falta NEON_OWNER_URL o DATABASE_URL");
  process.exit(1);
}

const cliente = new Client({ connectionString: url });
await cliente.connect();
console.log(`Destino: ${new URL(url).hostname}`);

const fn = await cliente.query(
  `select pg_get_functiondef(p.oid) as def
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'core' and p.proname = 'alcance_caso'`,
);
console.log("\n## core.alcance_caso");
for (const f of fn.rows) console.log(f.def);

const tablas = await cliente.query(`
  select table_name
    from information_schema.tables
   where table_schema = 'core' and table_name like '%region%'
   order by table_name
`);
console.log("\n## tablas core.*region*");
console.table(tablas.rows);

const regiones = await cliente.query(`
  select column_name, data_type
    from information_schema.columns
   where table_schema = 'core' and table_name = 'regiones'
   order by ordinal_position
`);
console.log("\n## core.regiones");
console.table(regiones.rows);

const alcances = await cliente.query(
  `select id, codigo from core.cat_alcances_geograficos order by id`,
);
console.log("\n## cat_alcances_geograficos");
console.table(alcances.rows);

const casoRegiones = await cliente.query(`
  select column_name, data_type
    from information_schema.columns
   where table_schema = 'core' and table_name = 'caso_regiones'
   order by ordinal_position
`);
console.log("\n## core.caso_regiones");
console.table(casoRegiones.rows);

const mesas = await cliente.query(`
  select m.codigo,
         m.ambito_departamento,
         c.codigo_caso,
         c.region_principal_id,
         core.alcance_caso(c.id) as alcance_id,
         (select count(*)::int from core.caso_regiones cr where cr.caso_id = c.id)
           as n_regiones,
         (select string_agg(r.nombre, ', ' order by r.nombre)
            from core.caso_regiones cr
            join core.regiones r on r.id = cr.region_id
           where cr.caso_id = c.id) as regiones,
         c.nombre_caso
    from core.mesas_dialogo m
    left join core.casos c on c.id = m.caso_id
   order by m.codigo
`);
console.log("\n## mesas");
for (const m of mesas.rows) {
  console.log(
    [
      m.codigo,
      m.codigo_caso ?? "—",
      `alc=${m.alcance_id ?? "—"}`,
      `n=${m.n_regiones ?? "—"}`,
      `[${m.regiones ?? "—"}]`,
      `ambito="${m.ambito_departamento ?? "—"}"`,
    ].join(" | "),
  );
}

await cliente.end();
