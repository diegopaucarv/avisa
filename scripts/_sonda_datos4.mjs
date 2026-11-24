import pg from 'pg';
import { writeFile } from 'node:fs/promises';
process.loadEnvFile('.env');

const out = [];
const q = async (c, label, sql, params = []) => {
  out.push('\n## ' + label);
  try {
    const r = await c.query(sql, params);
    out.push(JSON.stringify(r.rows, null, 1));
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
};

const owner = new pg.Client({ connectionString: process.env.NEON_OWNER_URL });
await owner.connect();
await q(owner, 'core.roles', 'select * from core.roles order by codigo');
await q(owner, 'clasificacion_max definicion',
  `select pg_get_functiondef('core.clasificacion_max()'::regprocedure) as def`);
await owner.end();

const api = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
await api.connect();
const roles = ['direccion','secretaria_general','viceministro_pesca','viceministro_mype','sectorista','especialista_oaipcs','administrador','analista'];
for (const rol of roles) {
  await api.query('begin');
  await api.query(
    `select set_config('app.rol_codigo',$1,true), set_config('app.usuario_id',$2,true),
            set_config('app.user_id',$2,true), set_config('app.staff_bypass_subject_rls','false',true),
            set_config('app.ver_anulados','off',true)`,
    [rol, '7c62121d-271e-45c6-95ac-273e88bb8446'],
  );
  await q(api, `rol=${rol} clasificacion_max`, 'select core.clasificacion_max() as nivel');
  await q(api, `rol=${rol} conteos`,
    `select (select count(*) from core.casos)::int casos,
            (select count(*) from core.alertas_tempranas)::int alertas,
            (select count(*) from core.documentos)::int docs,
            (select count(*) from core.compromisos)::int comp,
            (select count(*) from core.demandas)::int dem,
            (select count(*) from core.usuarios)::int users,
            (select count(*) from core.caso_regiones)::int reg`);
  await api.query('rollback');
}
await api.end();

await writeFile('scripts/_sonda_datos4.out.txt', out.join('\n'), 'utf8');
console.log('escrito');
