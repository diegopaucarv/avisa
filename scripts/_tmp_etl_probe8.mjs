import pg from 'pg';
process.loadEnvFile('.env');
const c = new pg.Client({ connectionString: process.env.NEON_OWNER_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => {
  try { const r = await c.query(sql); console.log('\n## ' + label); console.log(JSON.stringify(r.rows)); }
  catch (e) { console.log('\n## ' + label + '  -> ERROR: ' + e.message); }
};
await q('kag.documento_fragmento cols', "select column_name from information_schema.columns where table_schema='kag' and table_name='documento_fragmento' order by ordinal_position");
await q('kag.documento_fragmento count', 'select count(*)::int as n from kag.documento_fragmento');
await q('qda.segmento_fragmento count', 'select count(*)::int as n from qda.segmento_fragmento');
await q('documentos origen_dato', 'select origen_dato, count(*)::int as n from core.documentos group by 1 order by 2 desc');
await q('documentos validado', 'select es_validado_humano, count(*)::int as n from core.documentos group by 1');
await q('documentos confidence', 'select count(*)::int as total, count(confidence)::int as con_confianza, min(confidence) as min, max(confidence) as max from core.documentos');
await q('documentos codigo_legado', 'select count(*)::int as total, count(codigo_legado)::int as con_legado from core.documentos');
await q('casos codigo_legado', "select count(*)::int as total, count(codigo_legado)::int as con_legado from core.casos");
await q('actores codigo_legado', "select column_name from information_schema.columns where table_schema='core' and table_name='actores' and column_name ilike '%legado%'");
await q('core.tablas con codigo_legado', "select table_name, column_name from information_schema.columns where table_schema='core' and column_name ilike '%legado%' order by 1");
await q('analisis.punto_ingesta access check', "select count(*)::int as n from analisis.punto_ingesta");
await c.end();
