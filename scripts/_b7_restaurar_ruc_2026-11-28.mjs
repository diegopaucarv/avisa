#!/usr/bin/env node
/**
 * B7 · Restaura el RUC de las organizaciones desde el legado.
 *
 * POR QUÉ EXISTE
 * --------------
 * `core.organizaciones.ruc` sólo tiene 5 valores. El origen de ese dato es
 * `legacy.dim_organizacion.c14` («ruc» en la hoja original), que trae
 * exactamente esos 5 RUC. Lo que el legado sí tiene en 22 filas es `c07`
 * («inscripción en SUNARP»), que ya vive en `core.organizaciones.inscripcion_sunarp`
 * y NO es un RUC: tiene 6 a 8 dígitos. Cargarlo como RUC sería un error de dato.
 *
 * Empareja por nombre normalizado EXACTO (`core.normalizar_ref`), sin fuzzy, y
 * sólo rellena RUC nulos o vacíos. Nunca sobrescribe un RUC existente; si el que
 * hay difiere del legado lo reporta como conflicto.
 *
 * USO
 *   node scripts/_b7_restaurar_ruc_2026-11-28.mjs            # simulación
 *   node scripts/_b7_restaurar_ruc_2026-11-28.mjs --apply    # escribe
 *   node scripts/_b7_restaurar_ruc_2026-11-28.mjs --rollback [--file backups/...json]
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

process.loadEnvFile('.env');

const APLICAR = process.argv.includes('--apply');
const REVERTIR = process.argv.includes('--rollback');

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

const DIR_BACKUPS = 'backups';

function nuevoRespaldo() {
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  return join(DIR_BACKUPS, `b7_ruc_organizaciones_${marca}.json`);
}

function ultimoRespaldo() {
  const archivos = readdirSync(DIR_BACKUPS)
    .filter((n) => n.startsWith('b7_ruc_organizaciones_') && n.endsWith('.json'))
    .sort();
  if (archivos.length === 0) throw new Error('No hay respaldos b7_* en backups/.');
  return join(DIR_BACKUPS, archivos[archivos.length - 1]);
}

async function analizar(client) {
  const { rows } = await client.query(`
    with legado as (
      select fila_n, btrim(c02) as nombre, btrim(c14) as ruc
        from legacy.dim_organizacion
       where nullif(btrim(c14), '') is not null
    )
    select l.fila_n, l.nombre as nombre_legado, l.ruc as ruc_legado,
           (l.ruc ~ '^[0-9]{11}$') as ruc_valido,
           a.actor_uid, a.nombre_actual,
           nullif(btrim(o.ruc), '') as ruc_core
      from legado l
      left join core.actores a
        on a.naturaleza = 'organizacion'
       and core.normalizar_ref(a.nombre_actual) = core.normalizar_ref(l.nombre)
      left join core.organizaciones o on o.actor_uid = a.actor_uid
     order by l.fila_n
  `);

  const invalidos = rows.filter((r) => !r.ruc_valido);
  const validos = rows.filter((r) => r.ruc_valido);

  const sinMatch = validos.filter((r) => !r.actor_uid);

  // Un mismo RUC del legado puede caer en varios actores si el nombre normalizado
  // no es único; eso es ambigüedad, no un dato a escribir a ciegas.
  const porFila = new Map();
  for (const r of validos) {
    if (!r.actor_uid) continue;
    const acc = porFila.get(r.fila_n) ?? { actores: new Set(), ruc: r.ruc_legado };
    acc.actores.add(r.actor_uid);
    porFila.set(r.fila_n, acc);
  }
  const ambiguos = [...porFila.values()].filter((v) => v.actores.size > 1);

  const porActor = new Map();
  for (const r of validos) {
    if (!r.actor_uid) continue;
    const acc = porActor.get(r.actor_uid) ?? {
      actorUid: r.actor_uid,
      nombre: r.nombre_actual,
      rucCore: r.ruc_core,
      rucsLegado: new Set(),
    };
    acc.rucsLegado.add(r.ruc_legado);
    porActor.set(r.actor_uid, acc);
  }

  const candidatos = [];
  const conflictos = [];
  const yaCoincide = [];

  for (const acc of porActor.values()) {
    if (acc.rucsLegado.size > 1) {
      conflictos.push({ ...acc, motivo: 'el legado da RUC distintos para el mismo nombre' });
      continue;
    }
    const ruc = [...acc.rucsLegado][0];
    if (!acc.rucCore) {
      candidatos.push({ actorUid: acc.actorUid, nombre: acc.nombre, ruc });
    } else if (acc.rucCore === ruc) {
      yaCoincide.push({ ...acc, ruc });
    } else {
      conflictos.push({ ...acc, motivo: `el core tiene ${acc.rucCore} y el legado ${ruc}` });
    }
  }

  return {
    totalLegado: rows.length,
    rucsValidos: validos.length,
    sinMatch,
    invalidos,
    ambiguos,
    candidatos,
    conflictos,
    yaCoincide,
  };
}

async function revertir(client) {
  const archivo = argumento('--file') ?? ultimoRespaldo();
  const respaldo = JSON.parse(readFileSync(archivo, 'utf8'));
  const filas = respaldo.organizaciones ?? [];

  if (filas.length === 0) {
    console.log(`El respaldo ${archivo} no tiene filas que revertir.`);
    return;
  }

  await client.query('begin');
  try {
    const update = await client.query(
      `update core.organizaciones o
          set ruc = v.ruc_antes::char(11)
         from (
           select unnest($1::uuid[]) as actor_uid,
                  unnest($2::text[]) as ruc_antes
         ) v
        where o.actor_uid = v.actor_uid
          and o.ruc is distinct from v.ruc_antes::char(11)`,
      [
        filas.map((f) => f.actor_uid),
        filas.map((f) => f.ruc_antes),
      ],
    );
    await client.query('commit');
    console.log(`Revertidas ${update.rowCount} filas desde ${archivo}.`);
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

    const analisis = await analizar(client);

    console.log('B7 · RUC de organizaciones desde legacy.dim_organizacion.c14');
    console.log(`  filas del legado con RUC: ${analisis.totalLegado}`);
    console.log(`  con formato de RUC (11 dígitos): ${analisis.rucsValidos}`);
    console.log(`  sin organización emparejada por nombre: ${analisis.sinMatch.length}`);
    console.log(`  RUC inválidos descartados: ${analisis.invalidos.length}`);
    console.log(`  nombres ambiguos (varios actores): ${analisis.ambiguos.length}`);
    console.log(`  ya coinciden (no se tocan): ${analisis.yaCoincide.length}`);
    console.log(`  conflictos (RUC existente distinto): ${analisis.conflictos.length}`);
    console.log(`  CANDIDATOS a rellenar: ${analisis.candidatos.length}`);

    for (const c of analisis.candidatos) {
      console.log(`    + ${c.ruc}  ${c.nombre}`);
    }
    for (const c of analisis.conflictos) {
      console.log(`    ! ${c.nombre}: ${c.motivo}`);
    }
    for (const r of analisis.sinMatch) {
      console.log(`    ? sin match: ${r.nombre_legado} (${r.ruc_legado})`);
    }

    if (!APLICAR || analisis.candidatos.length === 0) {
      console.log(
        APLICAR
          ? '\nNada que escribir: no quedan RUC por rellenar.'
          : '\nSimulación: no se escribió nada. Repetí con --apply.',
      );
      return;
    }

    const respaldo = {
      generado: new Date().toISOString(),
      script: 'scripts/_b7_restaurar_ruc_2026-11-28.mjs',
      fuente: 'legacy.dim_organizacion.c14',
      organizaciones: analisis.candidatos.map((c) => ({
        actor_uid: c.actorUid,
        nombre: c.nombre,
        ruc_antes: null,
        ruc_nuevo: c.ruc,
      })),
    };
    mkdirSync(DIR_BACKUPS, { recursive: true });
    const archivo = nuevoRespaldo();
    writeFileSync(archivo, `${JSON.stringify(respaldo, null, 2)}\n`, 'utf8');
    console.log(`\nRespaldo: ${archivo}`);

    await client.query('begin');
    try {
      const update = await client.query(
        `update core.organizaciones o
            set ruc = v.ruc::char(11)
           from (
             select unnest($1::uuid[]) as actor_uid,
                    unnest($2::text[]) as ruc
           ) v
          where o.actor_uid = v.actor_uid
            and nullif(btrim(o.ruc), '') is null`,
        [
          analisis.candidatos.map((c) => c.actorUid),
          analisis.candidatos.map((c) => c.ruc),
        ],
      );
      await client.query('commit');
      console.log(`Filas actualizadas: ${update.rowCount}`);
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
