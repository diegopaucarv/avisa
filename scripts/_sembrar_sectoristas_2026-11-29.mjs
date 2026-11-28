#!/usr/bin/env node
/**
 * Siembra el roster definitivo de sectoristas y su territorio.
 *
 * El roster lo fijó la Dirección: seis especialistas y las regiones de cada
 * uno. Las cuentas existentes se reutilizan (Ivan, Peggy, Esteban, Ayli, Karen)
 * y sólo se crea `Daniel`, que no tenía ficha. Los DNI de las cuentas nuevas
 * son **provisionales** y están marcados aquí para reemplazarlos cuando la
 * Dirección entregue los reales; la clave es la misma demo para todos.
 *
 * Qué hace, en orden:
 *   1. Crea o actualiza las seis fichas (nombre, DNI, cargo, activo, clave).
 *   2. Deja una sola fila vigente del rol `sectorista` por persona.
 *   3. Reemplaza el territorio asignado (`core.usuario_territorio`).
 *   4. Cierra el rol `sectorista` de las cuentas que salen del roster. No se
 *      borra ninguna cuenta ni su historial: sólo dejan de ser sectoristas.
 *   5. Con `--focales`, reasigna el punto focal de los casos abiertos al
 *      especialista dueño de la región (Lima se reparte por provincia:
 *      Lima Metropolitana es de Karen y el resto de provincias, de Peggy).
 *
 * Uso:
 *   node scripts/_sembrar_sectoristas_2026-11-29.mjs            # simulación
 *   node scripts/_sembrar_sectoristas_2026-11-29.mjs --apply
 *   node scripts/_sembrar_sectoristas_2026-11-29.mjs --apply --focales
 *
 * Nunca toca la cuenta `AUT-002` (Admin), que conserva todos sus roles.
 */
import fs from "node:fs";
import path from "node:path";

process.loadEnvFile(".env");
const { default: pg } = await import("pg");

const APPLY = process.argv.includes("--apply");
const FOCALES = process.argv.includes("--focales");
const CLAVE_DEMO = "demo2026";
const HOY = "2026-11-29";
const RESPALDO = path.join(
  "scripts",
  `_respaldo_sectoristas_${HOY}.json`,
);

/**
 * DNI provisionales: los de Daniel y Ayli no existen todavía en la base. Se
 * cambian por los reales cuando la Dirección los entregue.
 */
const ROSTER = [
  {
    codigo: "SEC-16",
    nombre: "Daniel",
    dni: "74125608",
    cargo: "Especialista - Sector Centro",
    regiones: ["La Libertad", "Ancash", "Loreto", "Huanuco", "Pasco"],
  },
  {
    codigo: "SEC-03",
    nombre: "Ivan Enrique Ascurra Santillan",
    dni: "72022099",
    cargo: "Especialista - Sector Norte",
    regiones: ["Tumbes", "Piura", "Lambayeque", "Cajamarca", "Amazonas", "San Martín"],
  },
  {
    codigo: "SEC-02",
    nombre: "Peggy Contreras Montes",
    dni: "10654038",
    cargo: "Especialista - Lima Provincias, Callao, Ica y Junín",
    regiones: ["Lima", "Callao", "Ica", "Junin"],
  },
  {
    codigo: "SEC-04",
    nombre: "Esteban Vidal Saldarriaga",
    dni: "72898083",
    cargo: "Especialista - Sector Sur",
    regiones: ["Arequipa", "Moquegua", "Tacna", "Puno", "Cusco", "Madre de Dios"],
  },
  {
    codigo: "SEC-13",
    nombre: "Ayli Medina",
    dni: "46512387",
    cargo: "Especialista - Sector Sur Andino y Ucayali",
    regiones: ["Huancavelica", "Ayacucho", "Apurimac", "Ucayali"],
  },
  {
    codigo: "SEC-10",
    nombre: "Karen Benito",
    dni: "47261150",
    cargo: "Especialista - Lima Metropolitana",
    regiones: ["Lima"],
  },
];

const cliente = new pg.Client({
  connectionString: process.env.NEON_OWNER_URL,
  ssl: { rejectUnauthorized: false },
});
await cliente.connect();

const respaldo = {
  generadoEn: new Date().toISOString(),
  modo: APPLY ? "apply" : "dry-run",
  usuariosAntes: [],
  focales: [],
};

/**
 * Misma normalización que `core.normalizar_ref`: minúsculas, sin tildes y sin
 * espacios ni guiones. Así «San Martín» casa con «San Martin» aunque la base
 * haya cargado el nombre sin tilde.
 */
function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
}

/** Resuelve nombres de región tal como están en `core.regiones`. */
async function regionesPorNombre(nombres) {
  const res = await cliente.query(`select id, nombre from core.regiones`);
  const encontradas = new Map(
    res.rows.map((fila) => [normalizar(fila.nombre), fila]),
  );
  const regiones = nombres.map((nombre) => {
    const fila = encontradas.get(normalizar(nombre));
    if (!fila) throw new Error(`Región inexistente en core.regiones: ${nombre}`);
    return fila;
  });
  return regiones;
}

const idsRoster = new Set();

for (const persona of ROSTER) {
  const regiones = await regionesPorNombre(persona.regiones);

  const existente = await cliente.query(
    `select id::text, nombre, dni, activo
       from core.usuarios
      where codigo_legado = $1`,
    [persona.codigo],
  );

  let id = existente.rows[0]?.id ?? null;
  if (id) {
    respaldo.usuariosAntes.push({ ...existente.rows[0], codigo: persona.codigo });
  }

  if (!APPLY) {
    console.log(
      `${id ? "actualiza" : "crea"} ${persona.codigo} ${persona.nombre} ` +
        `(${regiones.map((r) => r.nombre).join(", ")})`,
    );
    continue;
  }

  if (!id) {
    const creado = await cliente.query(
      `insert into core.usuarios
         (nombre, dni, email, cargo, activo, clave_hash, codigo_legado, unidad_id)
       values ($1, $2, null, $3, true,
               public.crypt($4, public.gen_salt('bf', 10)), $5, 1)
       returning id::text as id`,
      [persona.nombre, persona.dni, persona.cargo, CLAVE_DEMO, persona.codigo],
    );
    id = creado.rows[0].id;
  } else {
    await cliente.query(
      `update core.usuarios
          set nombre = $2,
              dni = $3,
              cargo = $4,
              activo = true,
              unidad_id = coalesce(unidad_id, 1),
              clave_hash = public.crypt($5, public.gen_salt('bf', 10))
        where id = $1::uuid`,
      [id, persona.nombre, persona.dni, persona.cargo, CLAVE_DEMO],
    );
  }
  idsRoster.add(id);

  // Una sola fila vigente del rol: se cierra la anterior y se abre hoy.
  await cliente.query(
    `update core.usuario_roles
        set hasta = current_date - 1
      where usuario_id = $1::uuid and rol_id = 1 and hasta is null`,
    [id],
  );
  await cliente.query(
    `insert into core.usuario_roles (usuario_id, rol_id, desde, hasta)
     select $1::uuid, 1, current_date, null
      where not exists (
        select 1 from core.usuario_roles
         where usuario_id = $1::uuid and rol_id = 1
           and desde = current_date and hasta is null)`,
    [id],
  );

  await cliente.query(`delete from core.usuario_territorio where usuario_id = $1::uuid`, [id]);
  for (const region of regiones) {
    await cliente.query(
      `insert into core.usuario_territorio (usuario_id, region_id)
       values ($1::uuid, $2) on conflict do nothing`,
      [id, region.id],
    );
  }
}

/** Cierra el rol de sectorista de quien sale del roster (nunca a Admin). */
if (idsRoster.size === 0) {
  // En simulación nadie se creó: se resuelven por código para que el informe
  // de «salen del rol» sea real y no una lista vacía.
  const existentes = await cliente.query(
    `select id::text from core.usuarios where codigo_legado = any($1::text[])`,
    [ROSTER.map((p) => p.codigo)],
  );
  for (const fila of existentes.rows) idsRoster.add(fila.id);
}

const salientes = await cliente.query(
  `select u.id::text, u.codigo_legado, u.nombre, u.activo
     from core.usuarios u
     join core.usuario_roles ur on ur.usuario_id = u.id
    where ur.rol_id = 1 and ur.hasta is null
      and coalesce(u.codigo_legado, '') <> 'AUT-002'
      and ($1::int = 0 or not (u.id::text = any($2::text[])))`,
  [idsRoster.size, [...idsRoster]],
);

console.log(
  `\n${APPLY ? "APLICADO" : "SIMULACIÓN"} · roster ${ROSTER.length} · ` +
    `salen del rol: ${salientes.rows.map((f) => f.codigo_legado ?? f.nombre).join(", ") || "—"}`,
);

if (APPLY && salientes.rows.length) {
  respaldo.sectoristasCerrados = salientes.rows;
  await cliente.query(
    `update core.usuario_roles
        set hasta = current_date - 1
      where rol_id = 1 and hasta is null
        and usuario_id = any($1::uuid[])
        and usuario_id not in (select id from core.usuarios where codigo_legado = 'AUT-002')`,
    [salientes.rows.map((f) => f.id)],
  );
}

/* ── Punto focal por región ─────────────────────────────────────────────── */

if (FOCALES) {
  const duenoPorRegion = new Map();
  for (const [indice, persona] of ROSTER.entries()) {
    const regiones = await regionesPorNombre(persona.regiones);
    for (const region of regiones) {
      // Lima tiene dos dueños: se resuelve más abajo por provincia.
      if (!duenoPorRegion.has(region.id)) duenoPorRegion.set(region.id, []);
      duenoPorRegion.get(region.id).push(persona.codigo);
    }
  }

  const codigoAId = new Map();
  const fichas = await cliente.query(
    `select id::text, codigo_legado from core.usuarios where codigo_legado = any($1::text[])`,
    [ROSTER.map((p) => p.codigo)],
  );
  for (const fila of fichas.rows) codigoAId.set(fila.codigo_legado, fila.id);

  const casos = await cliente.query(
    `select c.id::text as id, c.codigo_caso, c.region_principal_id,
            p.ubigeo::text as provincia_ubigeo, c.punto_focal_usuario_id::text as focal
       from core.casos c
       left join core.distritos d on d.id = c.distrito_principal_id
       left join core.provincias p on p.id = d.provincia_id
      where c.anulado_en is null`,
  );

  const cambios = [];
  for (const caso of casos.rows) {
    const duenos = duenoPorRegion.get(caso.region_principal_id);
    if (!duenos?.length) continue;

    let codigo = duenos[0];
    if (duenos.length > 1) {
      // Lima: la provincia de Lima (1501) es metropolitana y va con Karen.
      const metropolitana = caso.provincia_ubigeo?.startsWith("1501");
      codigo = metropolitana
        ? duenos.find((c) => c === "SEC-10") ?? duenos[0]
        : duenos.find((c) => c === "SEC-02") ?? duenos[0];
    }

    const destino = codigoAId.get(codigo);
    if (!destino || destino === caso.focal) continue;
    cambios.push({ ...caso, destinoCodigo: codigo, destino });
  }

  console.log(`Punto focal: ${cambios.length} casos a reasignar.`);
  for (const cambio of cambios.slice(0, 12)) {
    console.log(`  ${cambio.codigo_caso} → ${cambio.destinoCodigo}`);
  }
  if (cambios.length > 12) console.log(`  … y ${cambios.length - 12} más`);
  respaldo.focales = cambios;

  if (APPLY) {
    for (const cambio of cambios) {
      await cliente.query(
        `update core.casos set punto_focal_usuario_id = $2::uuid where id = $1::uuid`,
        [cambio.id, cambio.destino],
      );
    }
  }
}

if (APPLY) {
  fs.writeFileSync(RESPALDO, JSON.stringify(respaldo, null, 2));
  console.log(`Respaldo escrito en ${RESPALDO}`);
}

await cliente.end();
