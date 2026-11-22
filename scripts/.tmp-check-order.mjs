// Temporary check (deleted after use): order of /v1/cases with sort=recent.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Za-z_]+)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const payload = {
  uid: '00000000-0000-0000-0000-000000000000',
  rol: 'administrador',
  roles: ['administrador'],
  nom: 'Verificación',
  cod: '1',
  dn: '11111111',
  area: 'OAIPCS',
  cargo: '',
  regs: [],
  exp: Date.now() + 3600_000,
};

const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
const mac = createHmac('sha256', env.APP_SESSION_SECRET).update(body).digest('base64url');
const token = `${body}.${mac}`;

const url =
  'http://localhost:3000/api/v1/cases?sort=recent&abiertos=true&pageSize=40&page=1';
const res = await fetch(url, { headers: { cookie: `avisa_session=${token}` } });
console.log('status', res.status);
const data = await res.json();
if (!data.items) {
  console.log(JSON.stringify(data).slice(0, 500));
} else {
  console.log('total', data.total);
  data.items.forEach((c, i) => console.log(String(i + 1).padStart(2, '0'), c.code, c.fechaInicio ?? '—'));
}
