#!/usr/bin/env node
/**
 * Siembra participantes en reuniones de diálogo y, si no hay ninguna futura,
 * crea dos de ejemplo.
 *
 * `core.reuniones_dialogo` ya tiene 34 filas, pero
 * `core.reunion_participantes` estaba vacía: sin participantes no se puede
 * probar «Avisar a todos» ni «Añadir participantes». Este script:
 *
 *   1. Elige cinco reuniones ya existentes (preferentemente RD-2026-034/033/
 *      032/030/025 y, si faltan, las más recientes) y les añade tres personas
 *      cada una. Sólo INSERTA en `reunion_participantes`; no toca las 34 filas.
 *   2. Si no hay NINGUNA reunión con fecha futura (respecto de hoy en Lima),
 *      crea RD-2026-035 y RD-2026-036 para poder ver el contraste de tipografía
 *      entre reuniones pasadas y futuras.
 *
 * Idempotente: los participantes usan `on conflict do nothing` y las reuniones
 * nuevas se buscan por `codigo_reunion` antes de crearse. Volver a ejecutar
 * `--apply` no duplica nada.
 *
 * RLS: las tablas de reuniones tienen `FORCE ROW LEVEL SECURITY` y sus políticas
 * leen `core.rol_actual()` (el parámetro `app.rol_codigo`). La conexión de
 * `NEON_OWNER_URL` fija ese parámetro a un rol de escritura antes de operar; sin
 * él, `clasificacion_max()` vale 0 y no se vería ni se podría insertar nada.
 *
 * Uso:
 *   node scripts/_sembrar_reuniones_participantes_2026-11-28.mjs            # simulación (por defecto)
 *   node scripts/_sembrar_reuniones_participantes_2026-11-28.mjs --apply
 *   node scripts/_sembrar_reuniones_participantes_2026-11-28.mjs --rollback
 *
 * El respaldo con lo insertado queda en backups/ y es lo que consume
 * `--rollback`. NO hay DDL: sólo datos.
 */
import fs from "node:fs";
import path from "node:path";

process.loadEnvFile(".env");
const { default: pg } = await import("pg");

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const HOY = "2026-11-28";
const RESPALDO = path.join("backups", `_respaldo_reuniones_participantes_${HOY}.json`);

/** Rol de sesión con el que se opera bajo RLS. Se verifica contra `core.roles`. */
const ROL_SEMILLA = "administrador";
/** Cuántas reuniones existentes reciben participantes y cuántos cada una. */
const REUNIONES_OBJETIVO = 5;
const PARTICIPANTES_POR_REUNION = 3;
/** Códigos preferidos para sembrar (si existen), en este orden. */
const CODIGOS_PREFERIDOS = [
  "RD-2026-034",
  "RD-2026-033",
  "RD-2026-032",
  "RD-2026-030",
  "RD-2026-025",
];
/** Reuniones futuras de ejemplo para el contraste de tipografía. */
const REUNIONES_NUEVAS = [
  {
    codigo: "RD-2026-035",
    titulo: "Mesa de diálogo: seguimiento de acuerdos — Lima",
    lugar: "Sala de Diálogo OAIPCS, Lima",
    region: "Lima",
    // Tercer día a las 10:00, hora de Lima.
    desplazamiento: "3 days 10 hours",
  },
  {
    codigo: "RD-2026-036",
    titulo: "Mesa de diálogo: conflictividad agraria — Áncash",
    lugar: "Auditorio de la Dirección Regional, Huaraz",
    region: "Ancash",
    // Décimo día a las 15:00, hora de Lima.
    desplazamiento: "10 days 15 hours",
  },
];

const cliente = new pg.Client({
  connectionString: process.env.NEON_OWNER_URL,
  ssl: { rejectUnauthorized: false },
});
await cliente.connect();

/** Fija el rol de la sesión para que las políticas RLS dejen operar. */
await cliente.query(`select set_config('app.rol_codigo', $1, false)`, [ROL_SEMILLA]);

const rol = await cliente.query(
  `select codigo, max_clasificacion, puede_crear, puede_editar, puede_eliminar
     from core.roles where codigo = $1`,
  [ROL_SEMILLA],
);
const filaRol = rol.rows[0];
if (!filaRol) {
  throw new Error(`El rol «${ROL_SEMILLA}» no existe en core.roles.`);
}
const maxClasificacion = Number(filaRol.max_clasificacion) || 0;
const requerido = ROLLBACK ? 3 : 2;
const permiso = ROLLBACK ? filaRol.puede_eliminar : filaRol.puede_crear;
if (maxClasificacion < requerido || !permiso) {
  throw new Error(
    `El rol «${ROL_SEMILLA}» no sirve para ${ROLLBACK ? "rollback" : "sembrar"}: ` +
      `max_clasificacion=${maxClasificacion} (necesita ≥ ${requerido}), ` +
      `permiso=${permiso ? "sí" : "no"}.`,
  );
}

/* ── Rollback ───────────────────────────────────────────────────────────── */

if (ROLLBACK) {
  if (!fs.existsSync(RESPALDO)) {
    throw new Error(`No existe el respaldo ${RESPALDO}: no hay nada que revertir.`);
  }
  const respaldo = JSON.parse(fs.readFileSync(RESPALDO, "utf8"));

  await cliente.query("begin");
  try {
    let participantesBorrados = 0;
    for (const p of respaldo.participantesInsertados ?? []) {
      const res = await cliente.query(
        `delete from core.reunion_participantes
          where reunion_id = $1::uuid and actor_uid = $2::uuid`,
        [p.reunionId, p.actorId],
      );
      participantesBorrados += res.rowCount ?? 0;
    }

    let reunionesBorradas = 0;
    for (const r of respaldo.reunionesCreadas ?? []) {
      const res = await cliente.query(
        `delete from core.reuniones_dialogo where id = $1::uuid`,
        [r.id],
      );
      reunionesBorradas += res.rowCount ?? 0;
    }

    await cliente.query("commit");
    console.log(
      `ROLLBACK · participantes borrados: ${participantesBorrados} · ` +
        `reuniones borradas: ${reunionesBorradas}`,
    );
  } catch (error) {
    await cliente.query("rollback");
    throw error;
  }
  await cliente.end();
  process.exit(0);
}

/* ── Planificación ──────────────────────────────────────────────────────── */

const antes = await cliente.query(
  `select
     (select count(*)::int from core.reuniones_dialogo) as reuniones,
     (select count(*)::int from core.reunion_participantes) as participantes`,
);
const conteoAntes = antes.rows[0] ?? { reuniones: 0, participantes: 0 };

// Personas activas, preferentemente con teléfono, con su institución vigente.
const candidatos = await cliente.query(
  `select
       a.actor_uid::text as actor_id,
       a.nombre_actual as nombre,
       left(coalesce(a.cargo_actual, ''), 100) as cargo,
       exists (
         select 1 from core.actor_datos_personales d
          where d.actor_uid = a.actor_uid and d.telefono_cifrado is not null
       ) as tiene_telefono,
       (
         select m.organizacion_uid::text
           from core.actor_membresia m
          where m.persona_uid = a.actor_uid
            and (m.valid_from is null or m.valid_from <= current_date)
            and (m.valid_to is null or m.valid_to > current_date)
          order by m.valid_from desc nulls last
          limit 1
       ) as institucion_id
     from core.actores a
    where a.naturaleza = 'persona'
      and a.activo
      and coalesce(a.nivel_clasificacion, 2) <= $1
    order by tiene_telefono desc, a.actor_uid
    limit 60`,
  [maxClasificacion],
);
const personas = candidatos.rows;
if (personas.length === 0) {
  throw new Error("No hay personas activas para usar como participantes.");
}

// Reuniones pasadas (las 34 existentes), priorizando los códigos preferidos.
const objetivo = await cliente.query(
  `select r.id::text as id,
          r.codigo_reunion as codigo,
          r.titulo,
          to_char((r.fecha at time zone 'America/Lima')::date, 'YYYY-MM-DD') as fecha
     from core.reuniones_dialogo r
    where r.archivado_en is null
      and r.fecha <= now()
    order by (r.codigo_reunion = any($1::text[])) desc, r.fecha desc
    limit ${REUNIONES_OBJETIVO}`,
  [CODIGOS_PREFERIDOS],
);
const reuniones = objetivo.rows;

// Asignación determinista: la reunión i recibe las personas [i*3, i*3+3).
const plan = [];
for (let i = 0; i < reuniones.length; i += 1) {
  const reunion = reuniones[i];
  const inicio = i * PARTICIPANTES_POR_REUNION;
  const elegidas = [];
  for (let j = 0; j < PARTICIPANTES_POR_REUNION; j += 1) {
    const persona = personas[(inicio + j) % personas.length];
    if (!elegidas.some((e) => e.actor_id === persona.actor_id)) elegidas.push(persona);
  }

  const existentes = await cliente.query(
    `select actor_uid::text as actor_id
       from core.reunion_participantes
      where reunion_id = $1::uuid`,
    [reunion.id],
  );
  const yaEstan = new Set(existentes.rows.map((f) => f.actor_id));
  const nuevos = elegidas.filter((p) => !yaEstan.has(p.actor_id));

  plan.push({ reunion, elegidas, nuevos });
}

// ¿Hay ya alguna reunión futura respecto de hoy en Lima?
const futuras = await cliente.query(
  `select count(*)::int as total
     from core.reuniones_dialogo
    where (fecha at time zone 'America/Lima')::date
          > ((now() at time zone 'America/Lima')::date)`,
);
const hayFuturas = (futuras.rows[0]?.total ?? 0) > 0;

const nuevasPorCrear = [];
if (!hayFuturas) {
  for (const nueva of REUNIONES_NUEVAS) {
    const existe = await cliente.query(
      `select 1 from core.reuniones_dialogo where codigo_reunion = $1`,
      [nueva.codigo],
    );
    if (existe.rowCount === 0) nuevasPorCrear.push(nueva);
  }
}

/* ── Informe de simulación ──────────────────────────────────────────────── */

console.log(
  `${APPLY ? "APLICAR" : "SIMULACIÓN"} · rol ${ROL_SEMILLA} ` +
    `(max_clasificacion=${maxClasificacion})`,
);
console.log(
  `Antes: ${conteoAntes.reuniones} reuniones · ${conteoAntes.participantes} participantes.`,
);

let totalNuevos = 0;
for (const { reunion, nuevos } of plan) {
  totalNuevos += nuevos.length;
  console.log(
    `\n${reunion.codigo ?? reunion.id} · ${reunion.fecha} · ${reunion.titulo ?? "sin título"}`,
  );
  if (nuevos.length === 0) {
    console.log("  sin cambios (ya tenía a esas personas)");
    continue;
  }
  for (const persona of nuevos) {
    console.log(
      `  + ${persona.nombre}${persona.tiene_telefono ? " (con teléfono)" : ""}`,
    );
  }
}

if (nuevasPorCrear.length > 0) {
  console.log("\nReuniones futuras de ejemplo:");
  for (const nueva of nuevasPorCrear) {
    console.log(`  + ${nueva.codigo} · ${nueva.titulo} · ${nueva.region}`);
  }
} else {
  console.log("\nYa hay reuniones futuras: no se crea ninguna.");
}

console.log(
  `\nTotal a insertar: ${totalNuevos} participantes · ${nuevasPorCrear.length} reuniones nuevas.`,
);

if (!APPLY) {
  console.log("\nSIMULACIÓN: no se escribió nada. Usa --apply para aplicar.");
  await cliente.end();
  process.exit(0);
}

/* ── Aplicación ─────────────────────────────────────────────────────────── */

const respaldo = {
  generadoEn: new Date().toISOString(),
  modo: "apply",
  rol: ROL_SEMILLA,
  antes: conteoAntes,
  participantesInsertados: [],
  reunionesCreadas: [],
  errores: [],
};

await cliente.query("begin");
try {
  for (const { reunion, nuevos } of plan) {
    for (const persona of nuevos) {
      await cliente.query("savepoint sp_participante");
      try {
        const res = await cliente.query(
          `insert into core.reunion_participantes
              (reunion_id, actor_uid, institucion_uid, cargo, asistio)
           values ($1::uuid, $2::uuid, $3::uuid, $4, true)
           on conflict (reunion_id, actor_uid) do nothing
           returning actor_uid::text as actor_id`,
          [reunion.id, persona.actor_id, persona.institucion_id, persona.cargo || null],
        );
        if ((res.rowCount ?? 0) > 0) {
          respaldo.participantesInsertados.push({
            reunionId: reunion.id,
            codigo: reunion.codigo,
            actorId: persona.actor_id,
            nombre: persona.nombre,
          });
        }
        await cliente.query("release savepoint sp_participante");
      } catch (error) {
        await cliente.query("rollback to savepoint sp_participante");
        respaldo.errores.push({
          reunionId: reunion.id,
          actorId: persona.actor_id,
          nombre: persona.nombre,
          motivo: String(error?.message ?? error),
        });
      }
    }
  }

  for (const nueva of nuevasPorCrear) {
    await cliente.query("savepoint sp_reunion");
    try {
      const res = await cliente.query(
        `insert into core.reuniones_dialogo
            (codigo_reunion, titulo, fecha, lugar, programada, region_texto)
         values (
           $1, $2,
           (date_trunc('day', now() at time zone 'America/Lima')
             + interval '${nueva.desplazamiento}') at time zone 'America/Lima',
           $3, true, $4
         )
         returning id::text as id`,
        [nueva.codigo, nueva.titulo, nueva.lugar, nueva.region],
      );
      const id = res.rows[0]?.id;
      if (id) respaldo.reunionesCreadas.push({ id, codigo: nueva.codigo });
      await cliente.query("release savepoint sp_reunion");
    } catch (error) {
      await cliente.query("rollback to savepoint sp_reunion");
      respaldo.errores.push({ codigo: nueva.codigo, motivo: String(error?.message ?? error) });
    }
  }

  await cliente.query("commit");
} catch (error) {
  await cliente.query("rollback");
  await cliente.end();
  throw error;
}

fs.mkdirSync(path.dirname(RESPALDO), { recursive: true });
fs.writeFileSync(RESPALDO, JSON.stringify(respaldo, null, 2));

const despues = await cliente.query(
  `select
     (select count(*)::int from core.reuniones_dialogo) as reuniones,
     (select count(*)::int from core.reunion_participantes) as participantes`,
);
const conteoDespues = despues.rows[0] ?? { reuniones: 0, participantes: 0 };

console.log(
  `\nAPLICADO · participantes insertados: ${respaldo.participantesInsertados.length} · ` +
    `reuniones creadas: ${respaldo.reunionesCreadas.length}` +
    (respaldo.errores.length ? ` · errores: ${respaldo.errores.length}` : ""),
);
console.log(
  `Después: ${conteoDespues.reuniones} reuniones · ` +
    `${conteoDespues.participantes} participantes.`,
);
console.log(`Respaldo escrito en ${RESPALDO}`);

await cliente.end();
