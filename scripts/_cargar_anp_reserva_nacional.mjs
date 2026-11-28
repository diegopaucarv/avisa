#!/usr/bin/env node
/**
 * Carga `territorio.anp_reserva_nacional` desde
 * `gis/derived/anp_reserva_nacional.geojson`.
 *
 * POR QUÉ EXISTE
 *   La migración 92 sólo crea la tabla, porque meter 48 geometrías WKT dentro de
 *   un archivo de migración lo haría ilegible e inmanejable. Este script separa
 *   la carga de datos del DDL y la deja reproducible e idempotente.
 *
 * FUENTE
 *   El GeoJSON lo genera `scripts/anp_reservas_nacionales.py` desde el shapefile
 *   del SERNANP y trae SÓLO las 48 features de categoría «Reserva Nacional» (de
 *   103 del archivo).
 *
 * 48 FEATURES → 42 RESERVAS (disolución por `codigo`)
 *   El insumo trae 48 features pero sólo 42 códigos distintos: RN05 («del
 *   Titicaca») y RN18 («Mar Tropical de Grau») vienen partidas en varias
 *   secciones. La tabla tiene `codigo unique`, así que una fila por feature
 *   repetiría el código. Aquí se agrupa por código y se DISUELVEN las secciones
 *   con `ST_Union`, dejando una geometría MultiPolygon por reserva. No se pierde
 *   área ni se inventa ningún código.
 *
 * MODO
 *   Por defecto SIMULACIÓN: imprime qué insertaría y qué actualizaría, y NO
 *   escribe. Con `--apply` hace el upsert en una transacción.
 *
 * USO
 *   node scripts/_cargar_anp_reserva_nacional.mjs            # simulación
 *   node scripts/_cargar_anp_reserva_nacional.mjs --apply    # escribe
 *   node scripts/_cargar_anp_reserva_nacional.mjs --ruta=RUTA.geojson
 *   node scripts/_cargar_anp_reserva_nacional.mjs --dsn=URL
 *
 *   El DSN sale de `--dsn`, luego `NEON_OWNER_URL` y luego `DATABASE_URL`. La
 *   escritura exige el rol dueño (la tabla vive en el esquema `territorio`).
 *
 * IDEMPOTENTE
 *   Upsert por `codigo`: re-ejecutar deja el mismo estado (la geometría se
 *   reemplaza por la del insumo, ya disuelta).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

try {
  process.loadEnvFile(".env");
} catch {
  // Sin .env se usan las variables ya exportadas; --dsn sigue disponible.
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const RUTA_POR_DEFECTO = path.join(
  RAIZ,
  "gis",
  "derived",
  "anp_reserva_nacional.geojson",
);

/** Las 48 features de «Reserva Nacional» del shapefile del SERNANP. */
const FEATURES_ESPERADAS = 48;
/** Códigos `anp_codi` distintos (RN05 y RN18 vienen en varias secciones). */
const RESERVAS_ESPERADAS = 42;

/** Upsert de una reserva: une las secciones y normaliza a MultiPolygon 4326. */
const SQL_UPSERT = `
insert into territorio.anp_reserva_nacional
       (codigo, nombre, categoria, geom)
select $1::text,
       $2::text,
       $3::text,
       ST_SetSRID(
           ST_Multi(ST_CollectionExtract(ST_Union(
               ST_MakeValid(ST_GeomFromGeoJSON(parte))), 3)),
           4326)
  from unnest($4::text[]) as parte
on conflict (codigo) do update
   set nombre    = excluded.nombre,
       categoria = excluded.categoria,
       geom      = excluded.geom
returning (xmax = 0) as insertado`;

function uso() {
  console.log(`Uso: node scripts/_cargar_anp_reserva_nacional.mjs [opciones]

Opciones:
  --apply             Escribe en la base. Sin esta bandera es simulación.
  --ruta=RUTA         GeoJSON alternativo.
  --dsn=URL           DSN explícito; si no, NEON_OWNER_URL y luego DATABASE_URL.
  -h, --help          Esta ayuda.

Lee ${FEATURES_ESPERADAS} features y deja ${RESERVAS_ESPERADAS} reservas (disuelve
por codigo las secciones de RN05 y RN18).`);
}

function leerOpciones() {
  const opciones = { aplicar: false, ruta: null, dsn: null, ayuda: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") {
      opciones.aplicar = true;
    } else if (arg === "--help" || arg === "-h") {
      opciones.ayuda = true;
    } else if (arg.startsWith("--ruta=")) {
      opciones.ruta = arg.slice("--ruta=".length).trim();
      if (!opciones.ruta) throw new Error("--ruta= necesita una ruta.");
    } else if (arg.startsWith("--dsn=")) {
      opciones.dsn = arg.slice("--dsn=".length).trim();
      if (!opciones.dsn) throw new Error("--dsn= necesita un DSN.");
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return opciones;
}

function resolverDsn(opciones) {
  if (opciones.dsn) return { url: opciones.dsn, origen: "--dsn" };
  if (process.env.NEON_OWNER_URL) {
    return { url: process.env.NEON_OWNER_URL, origen: "NEON_OWNER_URL" };
  }
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL, origen: "DATABASE_URL" };
  }
  return null;
}

function describirDestino(dsn) {
  try {
    const url = new URL(dsn.url);
    return `${dsn.origen} · ${url.hostname}:${url.port || "5432"} · db=${url.pathname.replace(/^\//, "")}`;
  } catch {
    return `${dsn.origen} · (DSN no es URL; no se muestra)`;
  }
}

/**
 * Agrupa las features por `codigo` y guarda cada geometría como texto GeoJSON.
 * El agrupamiento es la razón de ser del script: sin él, las secciones de un
 * mismo código chocarían contra el `unique (codigo)`.
 */
function agrupar(features) {
  const grupos = new Map();
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const codigo = String(props.codigo ?? "").trim();
    if (!codigo) {
      throw new Error("Hay una feature sin properties.codigo: se aborta.");
    }
    if (!feature.geometry) {
      throw new Error(`La feature ${codigo} no trae geometría: se aborta.`);
    }
    const nombre = String(props.nombre ?? "").trim();
    const categoria = String(props.categoria ?? "").trim();
    const actual = grupos.get(codigo);
    if (actual) {
      actual.geoms.push(JSON.stringify(feature.geometry));
    } else {
      grupos.set(codigo, {
        codigo,
        nombre,
        categoria,
        geoms: [JSON.stringify(feature.geometry)],
      });
    }
  }
  return [...grupos.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

async function existeTabla(cliente) {
  const { rows } = await cliente.query(
    "select to_regclass('territorio.anp_reserva_nacional') as tabla",
  );
  return Boolean(rows[0]?.tabla);
}

async function codigosExistentes(cliente) {
  const { rows } = await cliente.query(
    "select codigo from territorio.anp_reserva_nacional",
  );
  return new Set(rows.map((fila) => fila.codigo));
}

async function cargar(opciones) {
  const ruta = opciones.ruta ?? RUTA_POR_DEFECTO;
  const escribir = opciones.aplicar;

  console.log("AVISA · carga de ANP · Reserva Nacional");
  console.log(`Modo   : ${escribir ? "apply" : "simulación"}`);
  console.log(`Fuente : ${ruta}`);

  const texto = await readFile(ruta, "utf8");
  let coleccion;
  try {
    coleccion = JSON.parse(texto);
  } catch (error) {
    throw new Error(`El GeoJSON no es JSON válido: ${error.message}`);
  }
  if (
    coleccion?.type !== "FeatureCollection" ||
    !Array.isArray(coleccion.features)
  ) {
    throw new Error("El GeoJSON debe ser una FeatureCollection.");
  }

  const features = coleccion.features;
  console.log(`Features: ${features.length}`);
  if (features.length !== FEATURES_ESPERADAS) {
    throw new Error(
      `Se esperaban ${FEATURES_ESPERADAS} features y hay ${features.length}. ` +
        "Regenerá el GeoJSON con scripts/anp_reservas_nacionales.py.",
    );
  }

  const grupos = agrupar(features);
  console.log(`Reservas (por código): ${grupos.length}`);
  if (grupos.length !== RESERVAS_ESPERADAS) {
    throw new Error(
      `Se esperaban ${RESERVAS_ESPERADAS} reservas (códigos distintos) y hay ` +
        `${grupos.length}. Revisá el insumo: RN05 y RN18 deben venir partidas.`,
    );
  }

  const dsn = resolverDsn(opciones);
  if (!dsn) {
    if (escribir) {
      throw new Error(
        "No hay DSN: exportá NEON_OWNER_URL o pasá --dsn para --apply.",
      );
    }
    // Sin DSN no se puede distinguir insert/update, pero la simulación debe
    // seguir sirviendo para inspeccionar el insumo.
    console.log("Sin DSN: no se consulta la base; se asume todo como inserción.");
    for (const grupo of grupos) {
      console.log(`  + insertar ${grupo.codigo} · ${grupo.nombre}`);
    }
    console.log(
      `Plan   : insertar ${grupos.length} · actualizar 0 (sin base)`,
    );
    console.log("Simulación: no se escribió nada.");
    return;
  }
  console.log(`Destino: ${describirDestino(dsn)}`);

  const cliente = new Client({
    connectionString: dsn.url,
    application_name: "avisa-carga-anp-reserva-nacional",
    ssl: { rejectUnauthorized: false },
    statement_timeout: 5 * 60 * 1000,
  });
  await cliente.connect();

  try {
    const hayTabla = await existeTabla(cliente);
    if (!hayTabla) {
      if (escribir) {
        throw new Error(
          "territorio.anp_reserva_nacional no existe: aplicá " +
            "migration/92_capas_mapa_2026_11_29.sql antes de cargar.",
        );
      }
      console.log(
        "La tabla aún no existe: se simula todo como inserción " +
          "(aplicá la migración 92 antes de --apply).",
      );
      for (const grupo of grupos) {
        console.log(`  + insertar ${grupo.codigo} · ${grupo.nombre}`);
      }
      console.log(`Plan   : insertar ${grupos.length} · actualizar 0`);
      console.log("Simulación: no se escribió nada.");
      return;
    }

    const existentes = await codigosExistentes(cliente);
    const aInsertar = grupos.filter((grupo) => !existentes.has(grupo.codigo));
    const aActualizar = grupos.filter((grupo) => existentes.has(grupo.codigo));

    console.log(`Filas actuales en la tabla: ${existentes.size}`);
    console.log(
      `Plan   : insertar ${aInsertar.length} · actualizar ${aActualizar.length}`,
    );
    for (const grupo of aInsertar) {
      console.log(`  + insertar ${grupo.codigo} · ${grupo.nombre}`);
    }
    for (const grupo of aActualizar) {
      console.log(`  ~ actualizar ${grupo.codigo} · ${grupo.nombre}`);
    }

    if (!escribir) {
      console.log(
        "Simulación: no se escribió nada. Repetí con --apply para cargar.",
      );
      return;
    }

    let insertados = 0;
    let actualizados = 0;
    await cliente.query("begin");
    try {
      for (const grupo of grupos) {
        const { rows } = await cliente.query(SQL_UPSERT, [
          grupo.codigo,
          grupo.nombre,
          grupo.categoria,
          grupo.geoms,
        ]);
        if (rows[0]?.insertado) insertados += 1;
        else actualizados += 1;
      }
      await cliente.query("analyze territorio.anp_reserva_nacional");
      await cliente.query("commit");
    } catch (error) {
      await cliente.query("rollback").catch(() => {});
      throw error;
    }

    const { rows: conteo } = await cliente.query(
      `select count(*)::int as filas,
              count(distinct codigo)::int as codigos
         from territorio.anp_reserva_nacional`,
    );
    const filas = conteo[0]?.filas ?? 0;
    const codigos = conteo[0]?.codigos ?? 0;

    console.log(`Insertadas : ${insertados}`);
    console.log(`Actualizadas: ${actualizados}`);
    console.log(`Tabla ahora : ${filas} filas · ${codigos} códigos distintos`);

    if (filas !== RESERVAS_ESPERADAS || codigos !== RESERVAS_ESPERADAS) {
      throw new Error(
        `La tabla debería tener ${RESERVAS_ESPERADAS} filas con ` +
          `${RESERVAS_ESPERADAS} códigos distintos y tiene ${filas}/${codigos}. ` +
          "Puede haber filas de una carga anterior: revisá y limpiá a mano.",
      );
    }
    console.log("OK · 48 features cargadas como 42 reservas disueltas.");
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function main() {
  const opciones = leerOpciones();
  if (opciones.ayuda) {
    uso();
    return;
  }
  await cargar(opciones);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
