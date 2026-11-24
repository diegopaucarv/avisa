import pg from 'pg';

process.loadEnvFile('.env');

const api = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
await api.connect();

for (const rol of ['sectorista', 'administrador', 'alta_direccion']) {
  await api.query('begin');
  await api.query(
    `select set_config('app.rol_codigo',$1,true), set_config('app.usuario_id',$2,true),
            set_config('app.user_id',$2,true), set_config('app.staff_bypass_subject_rls','false',true),
            set_config('app.ver_anulados','off',true)`,
    [rol, '7c62121d-271e-45c6-95ac-273e88bb8446'],
  );
  const { rows } = await api.query(`
    select count(*)::int as hitos,
           count(*) filter (where fecha_real is not null)::int as con_fecha,
           count(*) filter (where estado_id = 3)::int as cumplidos
      from core.hitos_compromiso`);
  const { rows: comp } = await api.query(`
    select count(*)::int as compromisos,
           count(*) filter (where c.estado_id = 3)::int as cumplidos
      from core.compromisos c`);
  console.log(`\n== ${rol}`);
  console.log(`   hitos: ${JSON.stringify(rows[0])} · compromisos: ${JSON.stringify(comp[0])}`);
  await api.query('rollback');
}

await api.end();
