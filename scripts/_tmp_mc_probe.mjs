import pg from 'pg';

process.loadEnvFile('.env');

const SQL = `
with base as (
  select v.codigo_caso,
         v.nombre_caso,
         v.region,
         v.alcance,
         v.subsector,
         v.nivel_conflicto,
         v.nivel_riesgo,
         v.prioridad_atencion,
         v.responsable,
         v.punto_focal,
         c.id as caso_id,
         c.fecha_inicio,
         replace(ec.codigo, '_', ' ') as estado,
         c.anulado_en as caso_anulado_en
    from analytics.vw_anexo_15_matriz_conflictividad v
    join core.casos c
           on c.codigo_caso = v.codigo_caso
    left join core.cat_estados_caso ec
           on ec.id = c.estado_id
)
select b.codigo_caso,
       b.nombre_caso,
       b.region,
       b.alcance,
       b.subsector,
       b.nivel_conflicto,
       b.nivel_riesgo,
       b.prioridad_atencion,
       b.estado,
       b.responsable,
       b.punto_focal,
       to_char(b.fecha_inicio, 'YYYY-MM-DD') as fecha_inicio,
       (select to_char(max(k.fecha_evento), 'YYYY-MM-DD')
          from core.caso_cronologia k
         where k.caso_id = b.caso_id
           and k.anulado_en is null) as ultimo_hecho,
       (select count(*)::int
          from core.compromisos co
         where co.caso_id = b.caso_id
           and co.anulado_en is null) as compromisos,
       (select string_agg(t.tipo, ', ')
          from (select distinct co.tipo_compromiso as tipo
                  from core.compromisos co
                 where co.caso_id = b.caso_id
                   and co.anulado_en is null
                   and co.tipo_compromiso is not null
                 order by 1) t) as tipo_compromiso,
       (select count(*)::int
          from core.documentos d
         where d.caso_id = b.caso_id
           and d.anulado_en is null) as documentos,
       count(*) over()::int as total,
       count(*) filter (where btrim(coalesce(b.nivel_conflicto, '')) in ('Conflicto social', 'Crisis social')) over()::int as manifiestos,
       count(*) filter (where btrim(coalesce(b.nivel_conflicto, '')) not in ('Conflicto social', 'Crisis social')) over()::int as latentes,
       count(*) filter (where btrim(coalesce(b.nivel_conflicto, '')) = '') over()::int as sin_nivel
  from base b
 where b.caso_anulado_en is null
 order by b.fecha_inicio desc nulls last, b.codigo_caso
`;

const SQL_REGION = SQL.replace(
  'where b.caso_anulado_en is null',
  'where b.caso_anulado_en is null and core.normalizar_ref(b.region) = core.normalizar_ref($1)',
);

function conectar(url) {
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
}

const owner = conectar(process.env.NEON_OWNER_URL);
await owner.connect();

async function q(label, sql, params = []) {
  try {
    const r = await owner.query(sql, params);
    console.log('\n## ' + label);
    console.table(r.rows);
    return r.rows;
  } catch (e) {
    console.log('\n## ' + label + ' -> ERROR: ' + e.message);
    return [];
  }
}

await q(
  'columnas vista',
  "select column_name, data_type from information_schema.columns where table_schema='analytics' and table_name='vw_anexo_15_matriz_conflictividad' order by ordinal_position",
);
await q('estados', 'select * from core.cat_estados_caso order by id');
await q('roles', 'select codigo from core.roles order by 1');
await q(
  'duplicados codigo_caso',
  'select codigo_caso, count(*)::int n from core.casos group by 1 having count(*) > 1',
);
await q(
  'compromisos con caso',
  'select count(*)::int total, count(caso_id)::int con_caso from core.compromisos where anulado_en is null',
);
await q(
  'documentos con caso',
  'select count(*)::int total, count(caso_id)::int con_caso from core.documentos where anulado_en is null',
);
await q(
  'cronologia columnas',
  "select column_name, data_type from information_schema.columns where table_schema='core' and table_name='caso_cronologia' order by ordinal_position",
);
await q(
  'distinct regiones',
  'select distinct region from analytics.vw_anexo_15_matriz_conflictividad order by 1',
);
await q(
  'politicas casos',
  "select polname, cmd, qual from pg_policies where schemaname='core' and tablename='casos' order by polname",
);
await q(
  'distinct catalogos',
  'select distinct subsector, prioridad_atencion, nivel_conflicto, nivel_riesgo, alcance from analytics.vw_anexo_15_matriz_conflictividad order by 1,2,3',
);

const filas = await owner.query(SQL);
console.log('\n## filas owner:', filas.rows.length);
console.table(
  filas.rows.slice(0, 8).map((f) => ({
    codigo: f.codigo_caso,
    region: f.region,
    nivel: f.nivel_conflicto,
    riesgo: f.nivel_riesgo,
    estado: f.estado,
    inicio: f.fecha_inicio,
    ultimo: f.ultimo_hecho,
    comp: f.compromisos,
    tipo: f.tipo_compromiso,
    docs: f.documentos,
  })),
);
if (filas.rows[0]) {
  console.log('resumen', {
    total: filas.rows[0].total,
    manifiestos: filas.rows[0].manifiestos,
    latentes: filas.rows[0].latentes,
    sin_nivel: filas.rows[0].sin_nivel,
  });
}

const lima = await owner.query(SQL_REGION, ['Lima']);
console.log('## filas Lima:', lima.rows.length);

await owner.end();

if (process.env.APP_DATABASE_URL) {
  const app = conectar(process.env.APP_DATABASE_URL);
  await app.connect();
  await app.query('begin');
  await app.query(
    "select set_config('app.rol_codigo', 'administrador', true), set_config('app.usuario_id', '00000000-0000-0000-0000-000000000001', true)",
  );
  const ra = await app.query(SQL);
  console.log('\n## filas app (administrador):', ra.rows.length);
  if (ra.rows[0]) {
    console.log('resumen app', {
      total: ra.rows[0].total,
      manifiestos: ra.rows[0].manifiestos,
      latentes: ra.rows[0].latentes,
      sin_nivel: ra.rows[0].sin_nivel,
    });
  }
  await app.query('rollback');
  await app.end();
}
