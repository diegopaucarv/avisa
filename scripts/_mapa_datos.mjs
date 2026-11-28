import { Client } from "pg";
import { writeFileSync } from "node:fs";
process.loadEnvFile(".env");
const c = new Client({ connectionString: process.env.NEON_OWNER_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const casos = (await c.query(`
  select id, codigo_caso, codigo_legado, nombre_caso, resumen_ejecutivo,
         region_principal_id, provincia_principal_id, distrito_principal_id,
         fecha_inicio, anulado_en, origen_dato
    from core.casos order by codigo_caso`)).rows;

const demandas = (await c.query(`
  select id, codigo_legado, caso_id, alerta_id, documento_origen_id,
         descripcion_demanda, origen_dato, anulado_en
    from core.demandas order by codigo_legado nulls last, id`)).rows;

const alertas = (await c.query(`
  select id, codigo_alerta, codigo_legado, caso_id, titulo, situacion_actual,
         descripcion_riesgo, hechos_recientes, origen_dato, anulado_en
    from core.alertas_tempranas order by codigo_alerta`)).rows;

const documentos = (await c.query(`
  select id, codigo, codigo_legado, caso_id, tipo_id, titulo, fecha,
         resumen_ejecutivo, url_pdf, origen_dato, anulado_en, distrito_id
    from core.documentos order by fecha nulls last, codigo`)).rows;

const tipos = (await c.query(`select id, nombre from core.cat_tipos_documento order by id`)).rows;

writeFileSync('scripts/_mapa_datos.json', JSON.stringify({ generado: new Date().toISOString(), casos, demandas, alertas, documentos, tipos }, null, 2));

console.log('casos', casos.length, '| demandas', demandas.length, '| alertas', alertas.length, '| documentos', documentos.length);
console.log('\n== casos ==');
for (const k of casos) console.log(k.codigo_caso, '|', k.codigo_legado, '|', (k.nombre_caso||'').slice(0,70), '| region', k.region_principal_id);

console.log('\n== demandas por caso ==');
const byCaso = {};
for (const d of demandas) { const k = d.caso_id || 'SIN_CASO'; byCaso[k] = (byCaso[k]||0)+1; }
const codById = Object.fromEntries(casos.map(k=>[k.id,k.codigo_caso]));
for (const [k,v] of Object.entries(byCaso).sort((a,b)=>b[1]-a[1])) console.log((codById[k]||k), v);

console.log('\n== documentos por tipo ==');
const tById = Object.fromEntries(tipos.map(t=>[t.id,t.nombre]));
const byTipo = {};
for (const d of documentos) { const k = tById[d.tipo_id]||d.tipo_id; byTipo[k]=(byTipo[k]||0)+1; }
for (const [k,v] of Object.entries(byTipo)) console.log(k, v);
console.log('documentos con caso:', documentos.filter(d=>d.caso_id).length, '| sin caso:', documentos.filter(d=>!d.caso_id).length);

await c.end();
