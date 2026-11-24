import pg from 'pg';
process.loadEnvFile('.env');
const url = process.env.NEON_OWNER_URL || process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const q = async (label, sql) => {
  try {
    const r = await c.query(sql);
    console.log('\n## ' + label);
    console.table(r.rows);
  } catch (e) {
    console.log('\n## ' + label + '  -> ERROR: ' + e.message);
  }
};

await q('migraciones', 'select clave from core.migracion_log order by clave');
await q('locales sin distrito', "select count(*)::int as total, count(distrito_id)::int as con_distrito from core.locales");
await q('reuniones columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='reuniones_dialogo' order by ordinal_position");
await q('reuniones sin caso', "select count(*)::int as total, count(caso_id)::int as con_caso from core.reuniones_dialogo");
await q('alertas columnas caso', "select column_name, is_nullable from information_schema.columns where table_schema='core' and table_name='alertas_tempranas' and column_name in ('caso_id','demanda_id','codigo_alerta','anulado_en')");
await q('alertas sin caso', "select count(*)::int as total, count(caso_id)::int as con_caso from core.alertas_tempranas");
await q('demandas sin caso', "select count(*)::int as total, count(caso_id)::int as con_caso from core.demandas");
await q('casos por nivel', "select nc.nombre as nivel, count(*)::int as casos from core.casos c left join core.cat_niveles_riesgo nc on nc.id=c.nivel_riesgo_id group by 1 order by 2 desc");
await q('casos por estado', "select estado, count(*)::int from core.casos group by 1 order by 2 desc");
await q('nudos', "select count(*)::int as total, count(distinct caso_id)::int as casos, min(semana_desde) as desde, max(semana_desde) as hasta from core.caso_nudo_critico");
await q('documentos columnas', "select column_name from information_schema.columns where table_schema='core' and table_name='documentos' order by ordinal_position");
await q('tablas adjuntos/versiones', "select table_name from information_schema.tables where table_schema='core' and (table_name ilike '%adjunt%' or table_name ilike '%version%' or table_name ilike '%ocr%')");
await q('tablas directorio', "select table_name from information_schema.tables where table_schema='core' and table_name ilike '%actor%' or table_schema='core' and table_name ilike '%organizacion%' order by 1");
await q('actor columnas PII', "select column_name from information_schema.columns where table_schema='core' and table_name='actores' order by ordinal_position");
await q('compromisos adjuntos', "select table_name from information_schema.tables where table_schema='core' and table_name ilike '%compromiso%' order by 1");
await q('notificaciones', "select count(*)::int as total from core.notificaciones");
await q('preferencias usuario', "select table_name from information_schema.tables where table_schema='core' and (table_name ilike '%prefer%' or table_name ilike '%usuario%')");
await q('views anexo', "select table_name from information_schema.views where table_schema in ('analytics','core') and table_name ilike '%anexo%' order by 1");
await q('infraestructuras', "select count(*)::int as total from gis.infraestructuras_puntos");
await q('auditorios con distrito (vista)', "select count(*)::int as total, count(l.distrito_id)::int as con_distrito from core.locales l");

await c.end();
