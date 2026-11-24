import pg from 'pg';
import { writeFile } from 'node:fs/promises';
process.loadEnvFile('.env');
const url = process.env.NEON_OWNER_URL || process.env.DATABASE_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();

const out = [];
const q = async (label, sql) => {
  out.push('\n## ' + label);
  try {
    const r = await c.query(sql);
    out.push(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
};

await q(
  'tablas cat_',
  `select table_name from information_schema.tables
    where table_schema='core' and table_name like 'cat_%' order by 1`,
);
await q(
  'tablas sector/subsector',
  `select table_name from information_schema.tables
    where table_schema='core' and (table_name ilike '%sector%' or table_name ilike '%unidad%')
    order by 1`,
);
await q('conteos', `select 'casos' t, count(*)::int n from core.casos
  union all select 'casos vigentes', count(*)::int from core.casos where anulado_en is null
  union all select 'demandas', count(*)::int from core.demandas
  union all select 'demandas vigentes', count(*)::int from core.demandas where anulado_en is null
  union all select 'alertas', count(*)::int from core.alertas_tempranas
  union all select 'alertas vigentes', count(*)::int from core.alertas_tempranas where anulado_en is null
  union all select 'compromisos', count(*)::int from core.compromisos
  union all select 'compromisos vigentes', count(*)::int from core.compromisos where anulado_en is null
  union all select 'documentos', count(*)::int from core.documentos
  union all select 'documentos vigentes', count(*)::int from core.documentos where anulado_en is null
  union all select 'reuniones', count(*)::int from core.reuniones_dialogo
  union all select 'cronologia', count(*)::int from core.caso_cronologia
  union all select 'resultados', count(*)::int from core.resultados
  union all select 'reportes', count(*)::int from core.reportes`);
await q(
  'casos por anio fecha_inicio',
  `select extract(year from fecha_inicio)::int anio, count(*)::int n
     from core.casos where anulado_en is null group by 1 order by 1`,
);
await q(
  'casos latente/manifiesto',
  `select case when nivel_conflicto_id in (3,4) then 'manifiesto'
               when nivel_conflicto_id in (1,2) then 'latente'
               else 'sin nivel' end grupo, count(*)::int n
     from core.casos where anulado_en is null group by 1 order by 1`,
);
await q(
  'alertas por anio',
  `select extract(year from fecha_reporte)::int anio, count(*)::int n
     from core.alertas_tempranas where anulado_en is null group by 1 order by 1`,
);
await q(
  'documentos por tipo/anio',
  `select t.nombre tipo, extract(year from d.fecha)::int anio, count(*)::int n
     from core.documentos d join core.cat_tipos_documento t on t.id=d.tipo_id
    where d.anulado_en is null group by 1,2 order by 1,2`,
);
await q(
  'casos region_principal',
  `select r.nombre, count(*)::int n from core.casos c
     left join core.regiones r on r.id=c.region_principal_id
    where c.anulado_en is null group by 1 order by 2 desc`,
);
await q(
  'usuarios con nombre',
  `select id, nombre, cargo, activo from core.usuarios order by nombre limit 40`,
);
await q(
  'casos punto focal',
  `select u.nombre, count(*)::int n from core.casos c
     left join core.usuarios u on u.id=c.punto_focal_usuario_id
    where c.anulado_en is null group by 1 order by 2 desc`,
);
await q(
  'demandas fecha_registro rango por anio',
  `select extract(year from fecha_registro)::int anio, count(*)::int n
     from core.demandas where anulado_en is null group by 1 order by 1`,
);
await q(
  'compromisos fecha_inicio rango',
  `select extract(year from fecha_inicio)::int anio, count(*)::int n
     from core.compromisos where anulado_en is null group by 1 order by 1`,
);
await q(
  'documentos fecha rango',
  `select extract(year from fecha)::int anio, count(*)::int n
     from core.documentos where anulado_en is null group by 1 order by 1`,
);

await writeFile('scripts/_sonda_datos2.out.txt', out.join('\n'), 'utf8');
console.log('escrito');
await c.end();
