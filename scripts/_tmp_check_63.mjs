import fs from 'node:fs';
import pg from 'pg';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const url = env.NEON_OWNER_URL || env.DATABASE_URL || env.APP_DATABASE_URL;
const { Client } = pg;
const c = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 20000,
  connectionTimeoutMillis: 15000,
});

try {
  await c.connect();
  console.log('CONNECTED');

  const ext = await c.query(
    `select codigo_legado, nombre_actual, cargo_actual, region_id, email_contacto
       from core.actores
      where codigo_legado like 'PRODUCE-EXT-2026-%'
      order by codigo_legado`,
  );
  console.log('EXT_COUNT', ext.rowCount);
  for (const r of ext.rows) console.log('EXT', JSON.stringify(r));

  const log = await c.query(
    `select clave from core.migracion_log where clave like '63%' or clave like '64%' order by clave`,
  );
  console.log('MIGRACION_LOG', JSON.stringify(log.rows));

  const roles = await c.query(
    `select u.nombre,
            u.email,
            u.cargo,
            u.activo,
            string_agg(r.codigo, ',' order by r.codigo) as roles
       from core.usuarios u
       left join core.usuario_roles ur
         on ur.usuario_id = u.id
        and (ur.hasta is null or ur.hasta >= current_date)
       left join core.roles r on r.id = ur.rol_id
      group by u.id, u.nombre, u.email, u.cargo, u.activo
      order by u.nombre`,
  );
  console.log('USUARIOS_ROLES');
  for (const r of roles.rows) console.log('USER', JSON.stringify(r));

  const reg = await c.query('select id, nombre from core.regiones order by id');
  console.log('REGIONES', JSON.stringify(reg.rows));

  // ¿Algún sectorista ya existe como actor (por nombre)?
  const sect = roles.rows.filter((r) => (r.roles || '').split(',').includes('sectorista'));
  for (const s of sect) {
    const base = (s.nombre || '').split(' ').slice(0, 2).join(' ');
    const hit = await c.query(
      `select nombre_actual, cargo_actual, codigo_legado
         from core.actores
        where nombre_actual ilike '%' || $1 || '%'
        limit 5`,
      [base],
    );
    console.log('SECTORISTA', JSON.stringify({ nombre: s.nombre, roles: s.roles, actores: hit.rows }));
  }
} catch (e) {
  console.log('ERROR', e.code || '', String(e.message || e).slice(0, 400));
} finally {
  try {
    await c.end();
  } catch {}
}
