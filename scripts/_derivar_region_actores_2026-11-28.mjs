/**
 * Deriva `core.actores.region_id` desde cuatro fuentes, sin sobrescribir jamás
 * un valor ya declarado.
 *
 *   1) Legado: `legacy.dim_actores.c13` (código DEP) cruzado con
 *      `legacy.dim_departamentos`, emparejado por `codigo_legado`.
 *   2) Membresía: la región de la organización de la que la persona es miembro.
 *   3) Casos: la región principal del caso donde participa (sólo actores
 *      sociales; las instituciones públicas no heredan territorio del caso).
 *   4) Matriz de conflictos: la región del caso emparejada por nombre exacto
 *      normalizado (nunca fuzzy), otra vez sólo para actores sociales.
 *
 * Uso:
 *   node scripts/_derivar_region_actores_2026-11-28.mjs            # dry-run
 *   node scripts/_derivar_region_actores_2026-11-28.mjs --apply
 *   node scripts/_derivar_region_actores_2026-11-28.mjs --rollback [--apply]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';

process.loadEnvFile('.env');

const APLICAR = process.argv.includes('--apply');
const REVERTIR = process.argv.includes('--rollback');
const RESPALDO = 'backups/b1_region_actores_2026-11-28.json';
const MATRIZ = 'scripts/matriz/salida/matriz_2026.json';

/** Clave de comparación: sin tildes, sin mayúsculas, sin espacios de más. */
const norm = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Nombres del legado que no coinciden con `core.regiones`: el esquema nuevo no
 * separa Lima Metropolitana de Lima Provincias, y «Más de Uno» es un comodín
 * nacional, no una región.
 */
const ALIAS = new Map([
  ['lima provincias', 'lima'],
  ['lima metropolitana', 'lima'],
  ['lima metropolitana y provincias', 'lima'],
  ['provincia de lima', 'lima'],
]);
const SIN_REGION = new Set(['mas de uno', 'nacional', '']);

/** `region_principal_id` de `core.casos` es la única fuente de territorio del caso. */
const ROL_SOCIAL = 2;

async function principal() {
  const cliente = new Client({
    connectionString: process.env.NEON_OWNER_URL,
    ssl: { rejectUnauthorized: false },
  });
  await cliente.connect();

  try {
    if (REVERTIR) {
      await revertir(cliente);
      return;
    }
    await derivar(cliente);
  } finally {
    await cliente.end();
  }
}

async function derivar(cliente) {
  const { rows: regiones } = await cliente.query(
    'select id, nombre from core.regiones order by id',
  );
  const idDeRegion = new Map(regiones.map((r) => [norm(r.nombre), r.id]));

  /** Resuelve un nombre de región del legado o de la matriz a `core.regiones`. */
  const regionPorNombre = (texto) => {
    const clave = norm(texto);
    if (SIN_REGION.has(clave)) return null;
    const alias = ALIAS.get(clave);
    return idDeRegion.get(alias ?? clave) ?? null;
  };

  const { rows: actores } = await cliente.query(
    'select actor_uid::text as id, nombre_actual as nombre, codigo_legado, region_id, tipo_actor_id from core.actores',
  );
  const porId = new Map(actores.map((a) => [a.id, a]));
  const porCodigo = new Map(
    actores.filter((a) => a.codigo_legado).map((a) => [a.codigo_legado, a]),
  );

  /** actor_id → { regionId, motivo }, aplicado en cuanto se conoce. */
  const asignado = new Map();
  const asignar = (actor, regionId, motivo) => {
    if (!actor || actor.region_id !== null || asignado.has(actor.id)) return false;
    if (regionId === null) return false;
    asignado.set(actor.id, { regionId, motivo, nombre: actor.nombre });
    return true;
  };

  // 1) Legado: el código DEP del departamento donde se registró al actor.
  const { rows: deps } = await cliente.query(
    'select c01 as codigo, c02 as nombre from legacy.dim_departamentos',
  );
  const depANombre = new Map(deps.map((d) => [d.codigo, d.nombre]));
  const { rows: legado } = await cliente.query(
    'select c01 as codigo, c02 as nombre, c13 as dep from legacy.dim_actores where c13 is not null',
  );
  // El legado y la tabla nueva no siempre comparten código (214 actores llegaron
  // sin `codigo_legado`), así que el nombre exacto es el segundo intento.
  const porNombreLegado = new Map();
  for (const actor of actores) {
    if (actor.region_id !== null) continue;
    const clave = norm(actor.nombre);
    const lista = porNombreLegado.get(clave) ?? [];
    lista.push(actor);
    porNombreLegado.set(clave, lista);
  }
  let paso1 = 0;
  let paso1SinRegion = 0;
  for (const fila of legado) {
    let actor = porCodigo.get(fila.codigo);
    if (!actor) {
      const candidatos = porNombreLegado.get(norm(fila.nombre)) ?? [];
      actor = candidatos.length === 1 ? candidatos[0] : null;
    }
    if (!actor || actor.region_id !== null) continue;
    const regionId = regionPorNombre(depANombre.get(fila.dep));
    if (regionId === null) {
      paso1SinRegion += 1;
      continue;
    }
    if (asignar(actor, regionId, 'legado:departamento')) paso1 += 1;
  }

  // 2) Membresía: la región de la organización. Si pertenece a organizaciones de
  // regiones distintas no se elige por ella: se deja para el paso de casos.
  const { rows: membresias } = await cliente.query(
    `select m.persona_uid::text as persona, m.organizacion_uid::text as organizacion
       from core.actor_membresia m
      order by m.valid_from desc nulls last`,
  );
  const regionesPorPersona = new Map();
  for (const m of membresias) {
    const org = porId.get(m.organizacion);
    if (!org || org.region_id === null) continue;
    const lista = regionesPorPersona.get(m.persona) ?? new Set();
    lista.add(org.region_id);
    regionesPorPersona.set(m.persona, lista);
  }
  let paso2 = 0;
  let paso2Ambiguo = 0;
  for (const [personaId, regionesOrg] of regionesPorPersona) {
    const persona = porId.get(personaId);
    if (!persona || persona.region_id !== null) continue;
    if (regionesOrg.size !== 1) {
      paso2Ambiguo += 1;
      continue;
    }
    if (asignar(persona, [...regionesOrg][0], 'membresia:organizacion')) paso2 += 1;
  }

  // 3) Casos internos: la región donde más casos tiene. Empate → el más reciente.
  const { rows: vinculos } = await cliente.query(
    `select ca.actor_id::text as actor, c.region_principal_id as region,
            coalesce(c.fecha_ultima_actualizacion, c.fecha_inicio, c.created_at) as fecha
       from core.casos_actores ca
       join core.casos c on c.id = ca.caso_id
      where ca.anulado_en is null and c.region_principal_id is not null`,
  );
  const regionesPorActor = new Map();
  for (const v of vinculos) {
    if (!v.actor) continue;
    const mapa = regionesPorActor.get(v.actor) ?? new Map();
    const actual = mapa.get(v.region) ?? { cuenta: 0, fecha: null };
    mapa.set(v.region, {
      cuenta: actual.cuenta + 1,
      fecha: fechaMayor(actual.fecha, v.fecha),
    });
    regionesPorActor.set(v.actor, mapa);
  }
  let paso3 = 0;
  let paso3NoSocial = 0;
  for (const [actorId, mapa] of regionesPorActor) {
    const actor = porId.get(actorId);
    if (!actor || actor.region_id !== null) continue;
    if (actor.tipo_actor_id !== ROL_SOCIAL) {
      paso3NoSocial += 1;
      continue;
    }
    const elegida = [...mapa.entries()].sort(
      ([ra, a], [rb, b]) =>
        b.cuenta - a.cuenta || String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')),
    )[0];
    if (elegida && asignar(actor, elegida[0], 'casos:region_principal')) paso3 += 1;
  }

  // 4) Matriz: nombre del actor ↔ región del caso, emparejamiento exacto. Un caso
  // con varias regiones no aporta territorio: no se elige una al azar.
  let matriz = { casos: [] };
  try {
    matriz = JSON.parse(await readFile(MATRIZ, 'utf8'));
  } catch {
    console.warn(`[aviso] no se pudo leer ${MATRIZ}; se omite el paso 4.`);
  }
  const porNombre = new Map();
  for (const actor of actores) {
    if (actor.region_id !== null || actor.tipo_actor_id !== ROL_SOCIAL) continue;
    const clave = norm(actor.nombre);
    const lista = porNombre.get(clave) ?? [];
    lista.push(actor);
    porNombre.set(clave, lista);
  }
  const regionesMatriz = new Map();
  for (const caso of matriz.casos ?? []) {
    const regionId = regionDeCaso(caso.region, regionPorNombre);
    if (regionId === null) continue;
    for (const entrada of caso.actores ?? []) {
      const clave = norm(entrada.nombre);
      if (!clave) continue;
      const regiones = regionesMatriz.get(clave) ?? new Set();
      regiones.add(regionId);
      regionesMatriz.set(clave, regiones);
    }
  }
  let paso4 = 0;
  let paso4Ambiguo = 0;
  for (const [clave, regionesCaso] of regionesMatriz) {
    const candidatos = porNombre.get(clave) ?? [];
    if (candidatos.length === 0) continue;
    // Dos personas con el mismo nombre, o dos casos con regiones distintas: se
    // prefiere no asignar antes que adivinar.
    if (candidatos.length > 1 || regionesCaso.size > 1) {
      paso4Ambiguo += 1;
      continue;
    }
    if (asignar(candidatos[0], [...regionesCaso][0], 'matriz:region_caso')) paso4 += 1;
  }

  const cambios = [...asignado.entries()].map(([id, valor]) => ({
    id,
    nombre: valor.nombre,
    regionId: valor.regionId,
    motivo: valor.motivo,
  }));

  const conRegion = actores.filter((a) => a.region_id !== null).length;
  const resumen = {
    paso1Legado: paso1,
    paso1SinRegion,
    paso2Membresia: paso2,
    paso2Ambiguo,
    paso3Casos: paso3,
    paso3NoSocial,
    paso4Matriz: paso4,
    paso4Ambiguo,
    conRegionAntes: conRegion,
    conRegionDespues: conRegion + cambios.length,
    totalActores: actores.length,
  };

  console.log(JSON.stringify(resumen, null, 2));
  console.log(
    `cobertura ${((resumen.conRegionDespues / resumen.totalActores) * 100).toFixed(1)} % ` +
      `(${resumen.conRegionDespues}/${resumen.totalActores})`,
  );

  if (!APLICAR) {
    console.log('\n[dry-run] no se escribió nada. Usa --apply para aplicar.');
    return;
  }
  if (cambios.length === 0) {
    console.log('\nNada que aplicar.');
    return;
  }

  await mkdir('backups', { recursive: true });
  await writeFile(
    RESPALDO,
    JSON.stringify({ generadoEn: new Date().toISOString(), resumen, cambios }, null, 1),
    'utf8',
  );

  await cliente.query('begin');
  try {
    await cliente.query(
      `update core.actores a
          set region_id = d.region
         from unnest($1::uuid[], $2::int[]) as d(actor_uid, region)
        where a.actor_uid = d.actor_uid and a.region_id is null`,
      [cambios.map((c) => c.id), cambios.map((c) => c.regionId)],
    );
    await cliente.query('commit');
  } catch (error) {
    await cliente.query('rollback');
    throw error;
  }

  console.log(`\nAplicado: ${cambios.length} actores. Respaldo en ${RESPALDO}`);
}

/** La región del caso de la matriz, sólo si el texto nombra una única región. */
function regionDeCaso(texto, regionPorNombre) {
  const limpio = norm(texto);
  if (SIN_REGION.has(limpio)) return null;
  const partes = limpio.split(/\s*(?:\/|,| y | e |\s-\s)\s*/).filter(Boolean);
  if (partes.length !== 1) return null;
  return regionPorNombre(partes[0]);
}

function fechaMayor(a, b) {
  const fa = a ? new Date(a).getTime() : null;
  const fb = b ? new Date(b).getTime() : null;
  if (fa === null) return b ?? null;
  if (fb === null) return a ?? null;
  return fb > fa ? b : a;
}

async function revertir(cliente) {
  const respaldo = JSON.parse(await readFile(RESPALDO, 'utf8'));
  const cambios = respaldo.cambios ?? [];
  if (cambios.length === 0) {
    console.log('El respaldo no tiene cambios que revertir.');
    return;
  }

  // Sólo se revierte lo que sigue igual: si alguien cambió la región después,
  // esa decisión manda sobre la derivación automática.
  const { rows } = await cliente.query(
    `select count(*)::int as n
       from core.actores a
       join unnest($1::uuid[], $2::int[]) as d(actor_uid, region)
         on a.actor_uid = d.actor_uid and a.region_id = d.region`,
    [cambios.map((c) => c.id), cambios.map((c) => c.regionId)],
  );
  const reversibles = rows[0].n;

  console.log(`Cambios en el respaldo: ${cambios.length} · reversibles ahora: ${reversibles}`);
  if (!APLICAR) {
    console.log('[dry-run] usa --rollback --apply para revertir.');
    return;
  }

  await cliente.query('begin');
  try {
    await cliente.query(
      `update core.actores a
          set region_id = null
         from unnest($1::uuid[], $2::int[]) as d(actor_uid, region)
        where a.actor_uid = d.actor_uid and a.region_id = d.region`,
      [cambios.map((c) => c.id), cambios.map((c) => c.regionId)],
    );
    await cliente.query('commit');
  } catch (error) {
    await cliente.query('rollback');
    throw error;
  }
  console.log(`Revertidos ${reversibles} actores.`);
}

principal().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
