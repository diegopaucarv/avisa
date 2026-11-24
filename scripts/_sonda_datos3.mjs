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

// --- rol owner: catálogos y conteos
const owner = new pg.Client({ connectionString: process.env.NEON_OWNER_URL });
await owner.connect();
await q(owner, 'cat_subsectores', 'select * from core.cat_subsectores order by id');
await q(owner, 'cat_prioridades_atencion', 'select * from core.cat_prioridades_atencion order by id');
await q(owner, 'hitos fecha_real', `select estado_id, count(*)::int n, count(fecha_real)::int con_real,
  min(fecha_real) minr, max(fecha_real) maxr from core.hitos_compromiso group by 1 order by 1`);
await q(owner, 'hitos estados', 'select * from core.cat_estados_hito order by id');
await q(owner, 'conteos', `select 'casos' t, count(*)::int n from core.casos
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
  union all select 'reportes', count(*)::int from core.reportes`);
await q(owner, 'casos sin region pero con caso_regiones',
  `select count(*)::int sin_region, count(*) filter (where exists (select 1 from core.caso_regiones cr where cr.caso_id=c.id))::int con_vinculo
     from core.casos c where c.anulado_en is null and c.region_principal_id is null`);
await owner.end();

// --- rol API: verifica qué ve con una sesión concreta
const api = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
await api.connect();
await api.query('begin');
await api.query(
  `select set_config('app.rol_codigo',$1,true), set_config('app.usuario_id',$2,true),
          set_config('app.user_id',$2,true), set_config('app.staff_bypass_subject_rls','false',true),
          set_config('app.ver_anulados','off',true)`,
  ['director', 'fa454b34-b866-4313-9606-b14c8cbd2eaf'],
);
await q(api, 'api_rol', 'select current_user, current_setting($1, true) as rol', ['app.rol_codigo']);
await q(api, 'api casos visible', 'select count(*)::int n from core.casos');
await q(api, 'api alertas visible', 'select count(*)::int n from core.alertas_tempranas');
await q(api, 'api documentos visible', 'select count(*)::int n from core.documentos');
await q(api, 'api compromisos visible', 'select count(*)::int n from core.compromisos');
await q(api, 'api usuarios visible', 'select count(*)::int n from core.usuarios');
await api.query('rollback');
await api.end();

await writeFile('scripts/_sonda_datos3.out.txt', out.join('\n'), 'utf8');
console.log('escrito');
