import pg from 'pg';

process.loadEnvFile('.env');

const api = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
await api.connect();

await api.query('begin');
await api.query(
  `select set_config('app.rol_codigo',$1,true), set_config('app.usuario_id',$2,true),
          set_config('app.user_id',$2,true), set_config('app.staff_bypass_subject_rls','false',true),
          set_config('app.ver_anulados','off',true)`,
  ['sectorista', '7c62121d-271e-45c6-95ac-273e88bb8446'],
);

const { rows } = await api.query(`
  select c.id as compromiso_id, c.estado_id, c.fecha_inicio, c.anulado_en,
         count(h.id)::int as hitos,
         count(h.id) filter (where h.fecha_real is not null)::int as con_fecha_real
    from core.compromisos c
    left join core.hitos_compromiso h on h.compromiso_id = c.id and h.anulado_en is null
   group by c.id, c.estado_id, c.fecha_inicio, c.anulado_en
   order by c.fecha_inicio`);
console.log(JSON.stringify(rows, null, 1));

const { rows: media } = await api.query(`
  with hitos as (
    select c.id as compromiso_id,
           c.fecha_inicio as inicio,
           max(h.fecha_real) as cumplimiento
      from core.compromisos c
      join core.hitos_compromiso h
        on h.compromiso_id = c.id and h.anulado_en is null and h.fecha_real is not null
     where c.anulado_en is null
     group by c.id, c.fecha_inicio
  )
  select count(*)::int as muestra,
         avg((cumplimiento - inicio))::float8 as media_dias,
         min(cumplimiento - inicio)::int as minimo,
         max(cumplimiento - inicio)::int as maximo
    from hitos`);
console.log(JSON.stringify(media, null, 1));

await api.query('rollback');
await api.end();
