#!/usr/bin/env node
/**
 * B5 · Anclas de actor y relleno de membresías.
 *
 * POR QUÉ EXISTE
 * --------------
 * `core.actores.organizacion_ancla_uid` y `core.actores.caso_ancla_id` están
 * vacíos por completo, y `core.actor_membresia.cargo` no se cargó nunca. Todo lo
 * que se rellena aquí es derivable con evidencia existente; nada se estima.
 *
 *   · organizacion_ancla_uid (sólo personas): la organización de su membresía
 *     vigente. Si hubiera varias, la de `valid_from` más reciente. `valid_to`
 *     es exclusivo (ver docs/06_operacion/migraciones-neon-estado.md §5.1).
 *   · caso_ancla_id (cualquier actor): el caso con más vínculos vigentes en
 *     `core.casos_actores`; en empate, el caso más reciente por `fecha_inicio`.
 *   · cargo (miembros): `core.actores.cargo_actual`, con respaldo en
 *     `legacy.dim_actores.c06`. Ambos coinciden en las 292 membresías; se usa el
 *     core como fuente primaria y el legado sólo si el core viene vacío.
 *   · valid_to: NO se toca. Ni el legado ni ninguna otra tabla traen una fecha
 *     de cese (legacy no tiene columnas de fecha en `dim_actores`), así que
 *     inventarla sería falsear el dato.
 *
 * USO
 *   node scripts/_b5_anclas_membresias_2026-11-28.mjs            # simulación
 *   node scripts/_b5_anclas_membresias_2026-11-28.mjs --apply    # escribe
 *   node scripts/_b5_anclas_membresias_2026-11-28.mjs --rollback [--file backups/...json]
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

process.loadEnvFile('.env');

const APLICAR = process.argv.includes('--apply');
const REVERTIR = process.argv.includes('--rollback');

const DIR_BACKUPS = 'backups';

function dsn() {
  if (process.env.NEON_OWNER_URL) return process.env.NEON_OWNER_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error('Falta NEON_OWNER_URL o DATABASE_URL en el entorno (.env).');
}

function argumento(nombre) {
  const prefijo = `${nombre}=`;
  const conIgual = process.argv.find((a) => a.startsWith(prefijo));
  if (conIgual) return conIgual.slice(prefijo.length);
  const indice = process.argv.indexOf(nombre);
  if (indice >= 0 && process.argv[indice + 1]) return process.argv[indice + 1];
  return null;
}

function nuevoRespaldo() {
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  return join(DIR_BACKUPS, `b5_anclas_membresias_${marca}.json`);
}

function ultimoRespaldo() {
  const archivos = readdirSync(DIR_BACKUPS)
    .filter((n) => n.startsWith('b5_anclas_membresias_') && n.endsWith('.json'))
    .sort();
  if (archivos.length === 0) throw new Error('No hay respaldos b5_* en backups/.');
  return join(DIR_BACKUPS, archivos[archivos.length - 1]);
}

/** Personas con membresía vigente, eligiendo la más reciente por persona. */
async function candidatosOrgAncla(client) {
  const { rows } = await client.query(`
    with vigente as (
      select m.persona_uid, m.organizacion_uid, m.valid_from, m.id,
             row_number() over (
               partition by m.persona_uid
               order by m.valid_from desc nulls last, m.id
             ) as rn
        from core.actor_membresia m
        join core.actores p
          on p.actor_uid = m.persona_uid and p.naturaleza = 'persona'
        join core.actores o
          on o.actor_uid = m.organizacion_uid and o.naturaleza = 'organizacion'
       where (m.valid_from is null or m.valid_from <= current_date)
         and (m.valid_to is null or m.valid_to > current_date)
    )
    select v.persona_uid, v.organizacion_uid, v.valid_from::text as valid_from,
           p.nombre_actual as persona, o.nombre_actual as organizacion,
           p.organizacion_ancla_uid as antes
      from vigente v
      join core.actores p on p.actor_uid = v.persona_uid
      join core.actores o on o.actor_uid = v.organizacion_uid
     where v.rn = 1
       and p.organizacion_ancla_uid is null
     order by p.nombre_actual
  `);
  return rows;
}

/** Actores con más vínculos vigentes en un caso; empate → caso más reciente. */
async function candidatosCasoAncla(client) {
  const { rows } = await client.query(`
    with vinculos as (
      select ca.actor_id, ca.caso_id, count(*)::int as n
        from core.casos_actores ca
        join core.casos c on c.id = ca.caso_id and c.anulado_en is null
       where ca.anulado_en is null
       group by ca.actor_id, ca.caso_id
    ),
    ranking as (
      select v.actor_id, v.caso_id, v.n,
             row_number() over (
               partition by v.actor_id
               order by v.n desc,
                        c.fecha_inicio desc nulls last,
                        c.fecha_ultima_actualizacion desc nulls last,
                        c.created_at desc nulls last,
                        v.caso_id
             ) as rn
        from vinculos v
        join core.casos c on c.id = v.caso_id
    )
    select r.actor_id, a.nombre_actual, a.naturaleza,
           r.caso_id, c.codigo_caso, r.n as vinculos,
           a.caso_ancla_id as antes
      from ranking r
      join core.actores a on a.actor_uid = r.actor_id
      join core.casos c on c.id = r.caso_id
     where r.rn = 1
       and a.caso_ancla_id is null
     order by a.nombre_actual
  `);
  return rows;
}

/** Membresías sin cargo cuyo titular sí tiene cargo conocido. */
async function candidatosCargo(client) {
  const { rows } = await client.query(`
    select m.id, m.persona_uid, a.nombre_actual,
           coalesce(nullif(btrim(a.cargo_actual), ''), nullif(btrim(l.c06), '')) as cargo,
           m.cargo as antes
      from core.actor_membresia m
      join core.actores a on a.actor_uid = m.persona_uid
      left join legacy.dim_actores l on l.c01 = a.codigo_legado
     where nullif(btrim(m.cargo), '') is null
       and coalesce(nullif(btrim(a.cargo_actual), ''), nullif(btrim(l.c06), '')) is not null
     order by a.nombre_actual
  `);
  return rows;
}

async function diagnosticos(client) {
  const { rows } = await client.query(`
    select
      (select count(*)::int from core.actor_membresia) as membresias,
      (select count(*)::int from core.actor_membresia where nullif(btrim(cargo), '') is not null) as con_cargo,
      (select count(*)::int from core.actor_membresia where valid_to is not null) as con_valid_to,
      (select count(*)::int from core.actores where naturaleza = 'persona') as personas,
      (select count(*)::int from core.actores where organizacion_ancla_uid is not null) as con_org_ancla,
      (select count(*)::int from core.actores where caso_ancla_id is not null) as con_caso_ancla,
      (select count(*)::int from (
         select persona_uid from core.actor_membresia
          group by persona_uid having count(*) > 1
       ) x) as personas_con_varias_membresias,
      (select count(*)::int
         from core.actor_membresia m
         left join core.organizaciones o on o.actor_uid = m.organizacion_uid
        where o.actor_uid is null) as membresias_sin_ficha_org
  `);
  return rows[0];
}

async function revertir(client) {
  const archivo = argumento('--file') ?? ultimoRespaldo();
  const respaldo = JSON.parse(readFileSync(archivo, 'utf8'));

  await client.query('begin');
  try {
    let orgAncla = 0;
    let casoAncla = 0;
    let cargo = 0;

    if (respaldo.actores_org_ancla?.length) {
      const r = await client.query(
        `update core.actores a
            set organizacion_ancla_uid = v.antes::uuid
           from (
             select unnest($1::uuid[]) as actor_uid,
                    unnest($2::uuid[]) as antes
           ) v
          where a.actor_uid = v.actor_uid
            and a.organizacion_ancla_uid is distinct from v.antes::uuid`,
        [
          respaldo.actores_org_ancla.map((f) => f.actor_uid),
          respaldo.actores_org_ancla.map((f) => f.antes),
        ],
      );
      orgAncla = r.rowCount;
    }

    if (respaldo.actores_caso_ancla?.length) {
      const r = await client.query(
        `update core.actores a
            set caso_ancla_id = v.antes::uuid
           from (
             select unnest($1::uuid[]) as actor_uid,
                    unnest($2::uuid[]) as antes
           ) v
          where a.actor_uid = v.actor_uid
            and a.caso_ancla_id is distinct from v.antes::uuid`,
        [
          respaldo.actores_caso_ancla.map((f) => f.actor_uid),
          respaldo.actores_caso_ancla.map((f) => f.antes),
        ],
      );
      casoAncla = r.rowCount;
    }

    if (respaldo.membresias_cargo?.length) {
      const r = await client.query(
        `update core.actor_membresia m
            set cargo = v.antes
           from (
             select unnest($1::uuid[]) as id,
                    unnest($2::text[]) as antes
           ) v
          where m.id = v.id
            and m.cargo is distinct from v.antes`,
        [
          respaldo.membresias_cargo.map((f) => f.id),
          respaldo.membresias_cargo.map((f) => f.antes),
        ],
      );
      cargo = r.rowCount;
    }

    await client.query('commit');
    console.log(
      `Revertido desde ${archivo}: org_ancla=${orgAncla}, caso_ancla=${casoAncla}, cargo=${cargo}.`,
    );
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const client = new Client({
    connectionString: dsn(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    if (REVERTIR) {
      await revertir(client);
      return;
    }

    const diag = await diagnosticos(client);
    const orgAncla = await candidatosOrgAncla(client);
    const casoAncla = await candidatosCasoAncla(client);
    const cargo = await candidatosCargo(client);

    const casosPorNaturaleza = casoAncla.reduce((acc, r) => {
      acc[r.naturaleza] = (acc[r.naturaleza] ?? 0) + 1;
      return acc;
    }, {});

    console.log('B5 · diagnóstico previo');
    console.log(`  membresías: ${diag.membresias} (con cargo: ${diag.con_cargo}, con valid_to: ${diag.con_valid_to})`);
    console.log(`  personas: ${diag.personas} (con org_ancla: ${diag.con_org_ancla})`);
    console.log(`  actores con caso_ancla: ${diag.con_caso_ancla}`);
    console.log(`  personas con más de una membresía: ${diag.personas_con_varias_membresias}`);
    console.log(`  membresías cuya organización no tiene ficha: ${diag.membresias_sin_ficha_org}`);

    console.log('\nB5 · filas que ganarían cada campo');
    console.log(`  organizacion_ancla_uid: ${orgAncla.length}`);
    console.log(`  caso_ancla_id: ${casoAncla.length} ${JSON.stringify(casosPorNaturaleza)}`);
    console.log('  cargo: ' + cargo.length);
    console.log('  valid_to: 0 (sin fuente de fecha de cese; se deja NULL)');

    for (const r of orgAncla) {
      console.log(`    + org  ${r.persona} → ${r.organizacion}`);
    }
    for (const r of casoAncla) {
      console.log(`    + caso ${r.nombre_actual} → ${r.codigo_caso} (${r.vinculos} vínculo/s)`);
    }
    for (const r of cargo) {
      console.log(`    + cargo ${r.nombre_actual} → ${r.cargo}`);
    }

    const total = orgAncla.length + casoAncla.length + cargo.length;
    if (!APLICAR || total === 0) {
      console.log(
        APLICAR
          ? '\nNada que escribir: no quedan campos por rellenar.'
          : '\nSimulación: no se escribió nada. Repetí con --apply.',
      );
      return;
    }

    const respaldo = {
      generado: new Date().toISOString(),
      script: 'scripts/_b5_anclas_membresias_2026-11-28.mjs',
      actores_org_ancla: orgAncla.map((r) => ({
        actor_uid: r.persona_uid,
        nombre: r.persona,
        antes: null,
        nuevo: r.organizacion_uid,
      })),
      actores_caso_ancla: casoAncla.map((r) => ({
        actor_uid: r.actor_id,
        nombre: r.nombre_actual,
        antes: null,
        nuevo: r.caso_id,
      })),
      membresias_cargo: cargo.map((r) => ({
        id: r.id,
        persona_uid: r.persona_uid,
        nombre: r.nombre_actual,
        antes: null,
        nuevo: r.cargo,
      })),
    };
    mkdirSync(DIR_BACKUPS, { recursive: true });
    const archivo = nuevoRespaldo();
    writeFileSync(archivo, `${JSON.stringify(respaldo, null, 2)}\n`, 'utf8');
    console.log(`\nRespaldo: ${archivo}`);

    await client.query('begin');
    try {
      let filasOrg = 0;
      let filasCaso = 0;
      let filasCargo = 0;

      if (orgAncla.length) {
        const r = await client.query(
          `update core.actores a
              set organizacion_ancla_uid = v.nuevo::uuid
             from (
               select unnest($1::uuid[]) as actor_uid,
                      unnest($2::uuid[]) as nuevo
             ) v
            where a.actor_uid = v.actor_uid
              and a.organizacion_ancla_uid is null`,
          [orgAncla.map((r) => r.persona_uid), orgAncla.map((r) => r.organizacion_uid)],
        );
        filasOrg = r.rowCount;
      }

      if (casoAncla.length) {
        const r = await client.query(
          `update core.actores a
              set caso_ancla_id = v.nuevo::uuid
             from (
               select unnest($1::uuid[]) as actor_uid,
                      unnest($2::uuid[]) as nuevo
             ) v
            where a.actor_uid = v.actor_uid
              and a.caso_ancla_id is null`,
          [casoAncla.map((r) => r.actor_id), casoAncla.map((r) => r.caso_id)],
        );
        filasCaso = r.rowCount;
      }

      if (cargo.length) {
        const r = await client.query(
          `update core.actor_membresia m
              set cargo = v.nuevo
             from (
               select unnest($1::uuid[]) as id,
                      unnest($2::text[]) as nuevo
             ) v
            where m.id = v.id
              and nullif(btrim(m.cargo), '') is null`,
          [cargo.map((r) => r.id), cargo.map((r) => r.cargo)],
        );
        filasCargo = r.rowCount;
      }

      await client.query('commit');
      console.log(
        `\nFilas actualizadas: org_ancla=${filasOrg}, caso_ancla=${filasCaso}, cargo=${filasCargo}.`,
      );
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
