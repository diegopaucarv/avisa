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

// Distribución de origen_dato y marcas de tiempo por tabla
const tablas = [
  ['casos', 'created_at', 'fecha_inicio'],
  ['demandas', 'created_at', 'fecha_registro'],
  ['alertas_tempranas', 'created_at', 'fecha_reporte'],
  ['compromisos', 'created_at', 'fecha_inicio'],
  ['documentos', 'created_at', 'fecha'],
  ['reuniones_dialogo', 'created_at', 'fecha'],
];

for (const [tabla, ts, fecha] of tablas) {
  await q(
    `${tabla}: origen_dato`,
    `select origen_dato, count(*)::int as n from core.${tabla} group by 1 order by 2 desc`,
  );
  await q(
    `${tabla}: rango ${ts} y dias distintos`,
    `select count(*)::int total,
            count(distinct date_trunc('day', ${ts} at time zone 'America/Lima'))::int dias,
            min(${ts}) min_ts, max(${ts}) max_ts,
            min(${fecha}) min_fecha, max(${fecha}) max_fecha,
            count(${fecha})::int con_fecha
       from core.${tabla}`,
  );
  await q(
    `${tabla}: created_by`,
    `select count(*)::int total, count(created_by)::int con_usuario,
            count(distinct created_by)::int usuarios
       from core.${tabla}`,
  );
}

await q('compromisos: estados', 'select * from core.cat_estados_compromiso order by id');
await q(
  'compromisos: estado y vencimiento',
  `select estado_id, count(*)::int n, count(fecha_vencimiento)::int con_venc
     from core.compromisos group by 1 order by 1`,
);
await q(
  'compromiso_evento columnas',
  `select column_name, data_type from information_schema.columns
    where table_schema='core' and table_name='compromiso_evento' order by ordinal_position`,
);
await q('compromiso_evento muestra', 'select * from core.compromiso_evento limit 5');
await q('compromiso_evento total', 'select count(*)::int n from core.compromiso_evento');

await q('cat estados caso', 'select * from core.cat_estados_caso order by id');
await q('cat niveles conflicto', 'select * from core.cat_niveles_conflicto order by id');
await q('cat niveles riesgo', 'select * from core.cat_niveles_riesgo order by id');
await q('cat prioridad', 'select id, nombre from core.cat_prioridades order by id');
await q('subsectores', 'select * from core.subsectores order by id');
await q(
  'usuarios activos',
  `select count(*)::int total, count(*) filter (where activo)::int activos from core.usuarios`,
);
await q('regiones', 'select id, nombre from core.regiones order by id');
await q('migracion_log', 'select clave from core.migracion_log order by clave');

await writeFile('scripts/_sonda_datos.out.txt', out.join('\n'), 'utf8');
console.log('escrito scripts/_sonda_datos.out.txt');
await c.end();
