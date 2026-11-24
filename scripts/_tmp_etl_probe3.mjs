import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n## ' + label); console.table(r.rows); }
  catch (e) { console.log('\n## ' + label + '  -> ERROR: ' + e.message); }
};
for (const t of [
  ['staging','lote'], ['staging','registro'],
  ['core','documento_extraccion'], ['core','documento_lista_blanca'], ['core','documento_version'],
  ['core','fuentes_evidencia'], ['core','integraciones'], ['core','outbox_integracion'],
  ['agent','run_log'], ['agent','llm_call'], ['agent','sesion'], ['agent','sesion_paso'],
  ['core','documento_actores'], ['core','otros_documentos'],
]) {
  await q(`${t[0]}.${t[1]} columnas`, `select column_name, data_type, is_nullable from information_schema.columns where table_schema='${t[0]}' and table_name='${t[1]}' order by ordinal_position`);
  await q(`${t[0]}.${t[1]} conteo`, `select count(*)::int as filas from ${t[0]}.${t[1]}`);
}
await q('migracion_conflicto columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='migracion_conflicto' order by ordinal_position");
await q('migracion_conflicto conteo', 'select count(*)::int as filas from core.migracion_conflicto');
await q('legacy todos los conteos (estimado reltuples)', `
  select n.nspname as esquema, c.relname as tabla, c.reltuples::bigint as filas_estimadas
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='legacy' and c.relkind='r'
   order by c.reltuples desc`);
await c.end();
