import pg from 'pg';

process.loadEnvFile('.env');

const api = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
await api.connect();

const ROL = 'sectorista';
const USUARIO = '7c62121d-271e-45c6-95ac-273e88bb8446';

const SQL_BASE = `
create temp table analitica_base on commit drop as
select 'casos'::text as clave,
       c.id as registro_id,
       c.fecha_inicio as fecha,
       c.created_at as creado_en,
       c.created_by as creado_por,
       c.origen_dato::text as origen,
       (case when c.nivel_conflicto_id in (3, 4) then 'manifiesto'
             when c.nivel_conflicto_id in (1, 2) then 'latente'
             else 'sin_nivel' end) as grupo,
       null::smallint as estado,
       null::date as vencimiento
  from core.casos c
 where c.anulado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1
                     from core.caso_regiones cr
                    where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)

union all
select 'demandas'::text, d.id, d.fecha_registro, d.created_at, d.created_by, d.origen_dato::text,
       null::text, null::smallint, null::date
  from core.demandas d
  left join core.casos c on c.id = d.caso_id and c.anulado_en is null
 where d.anulado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1 from core.caso_regiones cr where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)

union all
select 'alertas'::text, a.id, a.fecha_reporte, a.created_at, a.created_by, a.origen_dato::text,
       null::text, null::smallint, null::date
  from core.alertas_tempranas a
 where a.anulado_en is null
   and ($1::int is null or a.region_id = $1)
   and ($2::int is null or a.subsector_id = $2)

union all
select 'compromisos'::text, cm.id, cm.fecha_inicio, cm.created_at, cm.created_by, cm.origen_dato::text,
       null::text, cm.estado_id, cm.fecha_vencimiento
  from core.compromisos cm
  left join core.casos c on c.id = cm.caso_id and c.anulado_en is null
 where cm.anulado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1 from core.caso_regiones cr where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)

union all
select 'documentos'::text, doc.id, doc.fecha, doc.created_at, doc.created_by, doc.origen_dato::text,
       null::text, null::smallint, null::date
  from core.documentos doc
  left join core.casos c on c.id = doc.caso_id and c.anulado_en is null
 where doc.anulado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1 from core.caso_regiones cr where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)

union all
select 'reuniones'::text, r.id, (r.fecha at time zone 'America/Lima')::date, r.created_at, r.created_by, r.origen_dato::text,
       null::text, null::smallint, null::date
  from core.reuniones_dialogo r
  left join core.casos c on c.id = r.caso_id and c.anulado_en is null
 where r.archivado_en is null
   and ($1::int is null
        or c.region_principal_id = $1
        or exists (select 1 from core.caso_regiones cr where cr.caso_id = c.id and cr.region_id = $1))
   and ($2::int is null or c.subsector_id = $2)
`;

const q = async (label, sql, params = [], verboso = true) => {
  try {
    const r = await api.query(sql, params);
    console.log(`\n## ${label}`);
    if (verboso) console.log(JSON.stringify(r.rows, null, 1));
    return r.rows;
  } catch (e) {
    console.log(`\n## ${label}\nERROR: ${e.message}`);
    return [];
  }
};

for (const [etiqueta, gran, unidad, paso, desde, hasta, region] of [
  ['mes · sin filtros', 'mes', 'month', '1 month', null, null, null],
  ['semana · sin filtros', 'semana', 'week', '7 days', null, null, null],
  ['mes · Lima 2024-2026', 'mes', 'month', '1 month', '2024-01-01', '2026-12-31', 'Lima'],
  ['mes · filtro sin datos', 'mes', 'month', '1 month', null, null, 'Tumbes'],
]) {
  await api.query('begin');
  await api.query(
    `select set_config('app.rol_codigo',$1,true), set_config('app.usuario_id',$2,true),
            set_config('app.user_id',$2,true), set_config('app.staff_bypass_subject_rls','false',true),
            set_config('app.ver_anulados','off',true)`,
    [ROL, USUARIO],
  );

  let regionId = null;
  if (region) {
    const r = await api.query('select id from core.regiones where nombre = $1', [region]);
    regionId = r.rows[0]?.id ?? null;
  }

  await api.query(SQL_BASE, [regionId, null]);
  const base = await q(`[${etiqueta}] base`, `
    select clave, count(*)::int as n,
           count(*) filter (where fecha is null)::int as sin_fecha,
           to_char(min(fecha),'YYYY-MM-DD') as desde,
           to_char(max(fecha),'YYYY-MM-DD') as hasta
      from analitica_base group by clave order by clave`);

  if (base.length > 0) {
    const periodos = await q(`[${etiqueta}] periodos`, `
      with limites as (
        select coalesce($1::date, min(fecha)) as desde,
               coalesce($2::date, max(fecha)) as hasta
          from analitica_base
      ),
      periodos as (
        select gs::date as inicio,
               ((gs + interval '${paso}')::date - 1) as fin
          from limites l,
               generate_series(
                 date_trunc('${unidad}', l.desde::timestamp),
                 date_trunc('${unidad}', coalesce(l.hasta, l.desde)::timestamp),
                 interval '${paso}'
               ) as gs
         where l.desde is not null
      )
      select to_char(p.inicio, 'YYYY-MM-DD') as inicio,
             to_char(p.fin, 'YYYY-MM-DD') as fin,
             count(*) filter (where b.clave = 'casos')::int as casos,
             count(*) filter (where b.clave = 'demandas')::int as demandas,
             count(*) filter (where b.clave = 'alertas')::int as alertas,
             count(*) filter (where b.clave = 'compromisos')::int as compromisos,
             count(*) filter (where b.clave = 'documentos')::int as documentos,
             count(*) filter (where b.clave = 'reuniones')::int as reuniones,
             count(*) filter (where b.grupo = 'manifiesto')::int as manifiesto,
             count(*) filter (where b.grupo = 'latente')::int as latente,
             count(*) filter (where b.grupo = 'sin_nivel')::int as sin_nivel
        from periodos p
        left join analitica_base b
          on b.fecha between greatest(p.inicio, coalesce($1::date, p.inicio))
                        and least(p.fin, coalesce($2::date, p.fin))
       group by p.inicio, p.fin
       order by p.inicio`, [desde, hasta], false);
    console.log(`   periodos: ${periodos.length} filas; primeros: ${JSON.stringify(periodos.slice(0, 3))}; últimos: ${JSON.stringify(periodos.slice(-2))}`);
    const conDatos = periodos.filter((p) => Number(p.casos) + Number(p.demandas) + Number(p.alertas) + Number(p.compromisos) + Number(p.documentos) + Number(p.reuniones) > 0);
    console.log(`   periodos con algún dato: ${conDatos.length}`);
  }

  await q(`[${etiqueta}] resumen`, `
    select clave,
           count(*) filter (
             where fecha is not null
               and ($1::date is null or fecha >= $1::date)
               and ($2::date is null or fecha <= $2::date)
           )::int as con_fecha,
           count(*) filter (where fecha is null)::int as sin_fecha,
           to_char(min(fecha) filter (
             where fecha is not null
               and ($1::date is null or fecha >= $1::date)
               and ($2::date is null or fecha <= $2::date)
           ), 'YYYY-MM-DD') as primera,
           to_char(max(fecha) filter (
             where fecha is not null
               and ($1::date is null or fecha >= $1::date)
               and ($2::date is null or fecha <= $2::date)
           ), 'YYYY-MM-DD') as ultima,
           count(distinct creado_por)::int as usuarios
      from analitica_base
     group by clave`, [desde, hasta]);

  await q(`[${etiqueta}] actividad por día`, `
    select to_char((creado_en at time zone 'America/Lima')::date, 'YYYY-MM-DD') as fecha,
           count(*)::int as registros,
           count(distinct creado_por)::int as usuarios,
           count(*) filter (where origen = 'AVISA_HISTORICO')::int as legado,
           count(*) filter (where creado_por is null)::int as sin_usuario
      from analitica_base
     where creado_en is not null
     group by 1
     order by 1`);

  await q(`[${etiqueta}] actividad por usuario`, `
    select b.creado_por::text as usuario_id,
           u.nombre as usuario,
           count(*)::int as registros,
           count(*) filter (where b.origen = 'AVISA_HISTORICO')::int as legado,
           to_char(min((b.creado_en at time zone 'America/Lima')::date), 'YYYY-MM-DD') as primera,
           to_char(max((b.creado_en at time zone 'America/Lima')::date), 'YYYY-MM-DD') as ultima
      from analitica_base b
      left join core.usuarios u on u.id = b.creado_por
     where b.creado_en is not null
     group by b.creado_por, u.nombre
     order by registros desc, u.nombre nulls last`);

  await q(`[${etiqueta}] compromisos`, `
    select count(*)::int as total,
           count(*) filter (where estado = 3)::int as terminales,
           count(*) filter (where vencimiento is not null)::int as con_vencimiento
      from analitica_base
     where clave = 'compromisos'
       and ($1::date is null or fecha is null or fecha >= $1::date)
       and ($2::date is null or fecha is null or fecha <= $2::date)`, [desde, hasta]);

  await q(`[${etiqueta}] media resolución`, `
    with cumplidos as (
      select b.registro_id,
             b.fecha as inicio,
             max(h.fecha_real) as cumplimiento
        from analitica_base b
        join core.hitos_compromiso h
          on h.compromiso_id = b.registro_id
         and h.anulado_en is null
         and h.fecha_real is not null
       where b.clave = 'compromisos'
         and b.estado = 3
       group by b.registro_id, b.fecha
    )
    select count(*)::int as muestra,
           avg((cumplimiento - inicio))::float8 as media_dias
      from cumplidos`);

  await q(`[${etiqueta}] hitos proxy`, `
    with hitos as (
      select b.registro_id,
             b.fecha as inicio,
             max(h.fecha_real) as cumplimiento
        from analitica_base b
        join core.hitos_compromiso h
          on h.compromiso_id = b.registro_id
         and h.anulado_en is null
         and h.fecha_real is not null
       where b.clave = 'compromisos'
         and ($1::date is null or b.fecha is null or b.fecha >= $1::date)
         and ($2::date is null or b.fecha is null or b.fecha <= $2::date)
       group by b.registro_id, b.fecha
    )
    select count(*)::int as muestra,
           avg((cumplimiento - inicio))::float8 as media_dias
      from hitos`, [desde, hasta]);

  await api.query('rollback');
}

await api.end();
