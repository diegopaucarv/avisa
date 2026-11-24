import pg from 'pg';
process.loadEnvFile('.env');
const api = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
await api.connect();
const out = [];
const q = async (label, sql, params = []) => {
  out.push('\n## ' + label);
  try {
    const r = await api.query(sql, params);
    out.push(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
};

for (const rol of ['sectorista', 'direccion_oaipcs']) {
  await api.query('begin');
  await api.query(
    `select set_config('app.rol_codigo',$1,true), set_config('app.usuario_id',$2,true),
            set_config('app.user_id',$2,true), set_config('app.staff_bypass_subject_rls','false',true),
            set_config('app.ver_anulados','off',true)`,
    [rol, '7c62121d-271e-45c6-95ac-273e88bb8446'],
  );
  await q(`[${rol}] usuarios visibles`, 'select id, nombre, cargo from core.usuarios order by nombre');
  await q(`[${rol}] created_by distintos en casos`, 'select created_by, count(*)::int from core.casos group by 1');
  await q(`[${rol}] punto focal en casos`,
    `select distinct u.nombre from core.casos c left join core.usuarios u on u.id=c.punto_focal_usuario_id`);
  await q(`[${rol}] regiones visibles`, 'select count(*)::int n from core.regiones');
  await q(`[${rol}] caso_regiones`, 'select count(*)::int n from core.caso_regiones');
  await q(`[${rol}] cat_subsectores`, 'select id, nombre from core.cat_subsectores order by id');
  await q(`[${rol}] reuniones`, 'select count(*)::int n from core.reuniones_dialogo');
  await q(`[${rol}] hitos',`, 'select count(*)::int n from core.hitos_compromiso');
  await api.query('rollback');
}
await api.end();
console.log(out.join('\n'));
