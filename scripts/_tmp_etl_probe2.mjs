import pg from 'pg';
process.loadEnvFile('.env');
const url = process.env.NEON_OWNER_URL || process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n## ' + label); console.table(r.rows); }
  catch (e) { console.log('\n## ' + label + '  -> ERROR: ' + e.message); }
};
await q('conteos inventario', `
  select 'core.caso_cronologia' as tabla, count(*)::int as filas from core.caso_cronologia
  union all select 'core.casos', count(*)::int from core.casos
  union all select 'core.caso_factores', count(*)::int from core.caso_factores
  union all select 'core.documentos', count(*)::int from core.documentos
  union all select 'core.alertas_tempranas', count(*)::int from core.alertas_tempranas
  union all select 'core.reuniones_dialogo', count(*)::int from core.reuniones_dialogo
  union all select 'core.reunion_participantes', count(*)::int from core.reunion_participantes
  union all select 'core.compromisos', count(*)::int from core.compromisos
  union all select 'core.hitos_compromiso', count(*)::int from core.hitos_compromiso
  union all select 'core.actores', count(*)::int from core.actores
  union all select 'legacy.dim_redaccion', count(*)::int from legacy.dim_redaccion
  union all select 'core.cat_tipos_documento', count(*)::int from core.cat_tipos_documento`);
await q('documento_fragmento existe?', "select table_schema, table_name from information_schema.tables where table_name ilike '%fragment%'");
await q('tablas agent', "select table_name from information_schema.tables where table_schema='agent' order by 1");
await q('legacy conteos muestra', `
  select 'legacy.fact_casos' as tabla, count(*)::int as filas from legacy.fact_casos
  union all select 'legacy.dim_actores', count(*)::int from legacy.dim_actores
  union all select 'legacy.fact_hechos_casos', count(*)::int from legacy.fact_hechos_casos
  union all select 'legacy.dim_alertas', count(*)::int from legacy.dim_alertas
  union all select 'legacy.dim_demandas', count(*)::int from legacy.dim_demandas
  union all select 'legacy.dim_redaccion', count(*)::int from legacy.dim_redaccion`);
await q('core tablas resumen', "select table_name from information_schema.tables where table_schema='core' and table_type='BASE TABLE' order by 1");
await q('legacy RLS?', "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='legacy' and c.relrowsecurity limit 5");
await q('funciones utiles', "select routine_schema, routine_name from information_schema.routines where routine_schema in ('core','analytics') and routine_name ilike '%contar%' order by 1");
await q('vistas analytics', "select table_name from information_schema.views where table_schema='analytics' order by 1");
await q('tablas audit', "select table_name from information_schema.tables where table_schema='audit' order by 1");
await q('tablas staging', "select table_name from information_schema.tables where table_schema='staging' order by 1");
await c.end();
