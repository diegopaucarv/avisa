import pg from 'pg';
process.loadEnvFile('.env');
const url = process.env.NEON_OWNER_URL || process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (label, sql, values) => {
  try {
    const r = await c.query(sql, values);
    console.log('\n## ' + label);
    console.table(r.rows);
  } catch (e) {
    console.log('\n## ' + label + '  -> ERROR: ' + e.message);
  }
};

await q('current user', 'select current_user, current_database()');
await q('schemas', "select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1");
await q('migracion_log columns', "select column_name, data_type from information_schema.columns where table_schema='core' and table_name='migracion_log' order by ordinal_position");
await q('migracion_log rows', 'select * from core.migracion_log order by aplicada_en desc nulls last');
await q('tablas por esquema', `
  select n.nspname as esquema, count(*)::int as tablas
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r','p','v','m') and n.nspname in ('core','legacy','analytics','gis','audit','agent','security','territorio','public')
   group by 1 order by 1`);
await q('tablas legacy', "select table_name from information_schema.tables where table_schema='legacy' order by 1");
await q('cat tipos documento', "select count(*)::int as total from core.cat_tipos_documento");
await q('cat tipos documento cols', "select column_name from information_schema.columns where table_schema='core' and table_name='cat_tipos_documento' order by ordinal_position");
await q('cat tipos documento valores', "select * from core.cat_tipos_documento order by 1 limit 40");
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
await q('tablas con columna codigo', "select table_schema, table_name from information_schema.columns where column_name='codigo' and table_schema in ('core','legacy') order by 1,2");
await q('core tablas nombres', "select table_name from information_schema.tables where table_schema='core' and table_type='BASE TABLE' order by 1");

await c.end();
