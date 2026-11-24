#!/usr/bin/env node
/**
 * Carga la capa distrital GIS en `territorio.distrito`.
 *
 * Fuente por defecto: `gis/derived/distritos_capa_simple.geojson` (1,7 MB).
 * Con `--completo` usa `gis/derived/distritos_capa.geojson` (39 MB). Ambas traen
 * 1 892 polígonos con `ubigeo` INEI de 6 dígitos y la población en `total`.
 *
 * POBLACIÓN
 *   El total sale de las propiedades del GeoJSON (`total`). Si faltara, se casa
 *   por UBIGEO con `gis/derived/distritos_capa.csv` (`Total`) y, en último
 *   término, con `gis/derived/distritos_maestro.csv` (`poblacion_capa`). El
 *   GeoJSON no trae sexo: hombres/mujeres salen de `distritos_capa.csv`
 *   (`Hombre_T`/`Mujer_T`). Si no hay fila, o si H+M no cuadra con el total, se
 *   dejan NULL y se declara el faltante. No se estima ni se prorratea nada.
 *
 *   La población es SÓLO denominador (tasas por 100 000 hab.); no es peso de
 *   riesgo. La serie usada es la censal de la capa (geogpsperu, rotulada
 *   «Censo 2025»; no es publicación del INEI). `poblacion_inei` del maestro es
 *   otra serie y NO se mezcla: mezclar denominadores rompería las tasas.
 *
 * DESFASE DECLARADO
 *   La capa trae 1 892 distritos y el maestro INEI 1 891. La fila extra es
 *   160405 SANTA ROSA DE LORETO (MARISCAL RAMON CASTILLA, LORETO): se carga con
 *   su ubigeo propio; no se le inventa otro ni se descarta.
 *
 * IDEMPOTENCIA
 *   `insert ... on conflict (ubigeo) do update ... where ...` sólo reescribe si
 *   cambió alguna propiedad o la geometría/centroide (`ST_Equals`). Las filas
 *   sin cambios no se tocan y se informan como «saltadas».
 *
 * USO
 *   node scripts/cargar-gis-neon.mjs                       # dry-run
 *   node scripts/cargar-gis-neon.mjs --completo            # geometría completa
 *   node scripts/cargar-gis-neon.mjs --sin-bd              # dry-run sin base
 *   node scripts/cargar-gis-neon.mjs --apply --confirmar   # escribe
 *
 *   Sin `--apply` Y `--confirmar` el script no escribe: sólo lee y cuenta.
 *   El DSN sale de `--dsn`, luego `NEON_OWNER_URL` y luego `DATABASE_URL`.
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "pg";

try {
  process.loadEnvFile(".env");
} catch {
  // Sin .env se usan las variables ya exportadas; --dsn sigue disponible.
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");

const FUENTE_SIMPLE = path.join(RAIZ, "gis", "derived", "distritos_capa_simple.geojson");
const FUENTE_COMPLETA = path.join(RAIZ, "gis", "derived", "distritos_capa.geojson");
const CSV_CAPA = path.join(RAIZ, "gis", "derived", "distritos_capa.csv");
const CSV_MAESTRO = path.join(RAIZ, "gis", "derived", "distritos_maestro.csv");

const LOTE_MIN = 500;
const LOTE_MAX = 1000;
const LOTE_POR_DEFECTO = 500;

const NUM = {
  format(valor) {
    return String(valor).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  },
};

function uso() {
  console.log(`Uso: node scripts/cargar-gis-neon.mjs [opciones]

Opciones:
  --completo          Usa gis/derived/distritos_capa.geojson (39 MB).
  --fuente=RUTA       GeoJSON alternativo.
  --lote=N            Filas por lote (${LOTE_MIN}–${LOTE_MAX}; por defecto ${LOTE_POR_DEFECTO}).
  --apply             Escribe. Exige --confirmar.
  --confirmar         Confirma la escritura. Sin esta bandera no se escribe nada.
  --sin-bd            Dry-run sin consultar la base (sólo lee y cuenta).
  --dsn=URL           DSN explícito; si no, NEON_OWNER_URL y luego DATABASE_URL.
  --dry-run           Explícito: es el modo por defecto.
  -h, --help          Esta ayuda.

Sin --apply --confirmar el script nunca escribe: compara y cuenta.`);
}

function leerOpciones() {
  const opciones = {
    completo: false,
    aplicar: false,
    confirmar: false,
    sinBd: false,
    lote: LOTE_POR_DEFECTO,
    fuente: null,
    dsn: null,
    ayuda: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--completo") {
      opciones.completo = true;
    } else if (arg === "--apply") {
      opciones.aplicar = true;
    } else if (arg === "--dry-run") {
      opciones.aplicar = false;
    } else if (arg === "--confirmar") {
      opciones.confirmar = true;
    } else if (arg === "--sin-bd") {
      opciones.sinBd = true;
    } else if (arg === "--help" || arg === "-h") {
      opciones.ayuda = true;
    } else if (arg.startsWith("--lote=")) {
      const valor = Number(arg.slice("--lote=".length));
      if (!Number.isInteger(valor) || valor < LOTE_MIN || valor > LOTE_MAX) {
        throw new Error(`--lote debe ser un entero entre ${LOTE_MIN} y ${LOTE_MAX}.`);
      }
      opciones.lote = valor;
    } else if (arg.startsWith("--fuente=")) {
      opciones.fuente = arg.slice("--fuente=".length).trim();
      if (!opciones.fuente) throw new Error("--fuente= necesita una ruta.");
    } else if (arg.startsWith("--dsn=")) {
      opciones.dsn = arg.slice("--dsn=".length).trim();
      if (!opciones.dsn) throw new Error("--dsn= necesita un DSN.");
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }

  return opciones;
}

function validarOpciones(opciones) {
  if (opciones.confirmar && !opciones.aplicar) {
    throw new Error("--confirmar sólo tiene sentido con --apply.");
  }
  if (opciones.aplicar && !opciones.confirmar) {
    throw new Error(
      "--apply exige --confirmar. Sin ambas banderas no se escribe nada.",
    );
  }
  if (opciones.aplicar && opciones.sinBd) {
    throw new Error("--apply no puede combinarse con --sin-bd.");
  }
}

async function leerTexto(ruta) {
  const partes = [];
  for await (const trozo of createReadStream(ruta, { encoding: "utf8" })) {
    partes.push(trozo);
  }
  return partes.join("");
}

/** Parser CSV mínimo (RFC 4180) suficiente para estos derivados. */
function parseCsv(texto) {
  const filas = [];
  let campo = "";
  let fila = [];
  let entreComillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.length && f.some((v) => v !== ""));
}

async function leerCsv(ruta) {
  const texto = (await readFile(ruta, "utf8")).replace(/^\uFEFF/, "");
  const filas = parseCsv(texto);
  const cabecera = filas.shift();
  if (!cabecera) return [];
  const columnas = cabecera.map((c) => c.trim());
  return filas.map((f) => {
    const registro = {};
    columnas.forEach((nombre, i) => {
      registro[nombre] = (f[i] ?? "").trim();
    });
    return registro;
  });
}

async function leerCsvSiExiste(ruta) {
  try {
    return await leerCsv(ruta);
  } catch {
    return null;
  }
}

function numeroEntero(valor) {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).trim();
  if (!limpio) return null;
  const numero = Number(limpio);
  if (!Number.isSafeInteger(numero) || numero < 0) return null;
  return numero;
}

function ubigeoValido(valor) {
  const limpio = String(valor ?? "").trim();
  return /^\d{6}$/.test(limpio) ? limpio : null;
}

function texto(valor) {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).trim();
  return limpio || null;
}

function propsNormalizadas(props) {
  const salida = {};
  if (props && typeof props === "object") {
    for (const [clave, valor] of Object.entries(props)) {
      salida[String(clave).trim().toLowerCase()] = valor;
    }
  }
  return salida;
}

function anillosValidos(anillos) {
  if (!Array.isArray(anillos) || anillos.length === 0) return false;
  return anillos.every((anillo) => {
    if (!Array.isArray(anillo) || anillo.length < 4) return false;
    return anillo.every(
      (posicion) =>
        Array.isArray(posicion) &&
        posicion.length >= 2 &&
        Number.isFinite(posicion[0]) &&
        Number.isFinite(posicion[1]) &&
        posicion[0] >= -180 &&
        posicion[0] <= 180 &&
        posicion[1] >= -90 &&
        posicion[1] <= 90,
    );
  });
}

function geometriaValida(geometria) {
  if (!geometria || typeof geometria !== "object") return false;
  if (geometria.type === "Polygon") return anillosValidos(geometria.coordinates);
  if (geometria.type === "MultiPolygon") {
    if (!Array.isArray(geometria.coordinates)) return false;
    return geometria.coordinates.length > 0 &&
      geometria.coordinates.every((poligono) => anillosValidos(poligono));
  }
  return false;
}

function mapaPoblacionCapa(filas) {
  const mapa = new Map();
  for (const fila of filas ?? []) {
    const ubigeo = ubigeoValido(fila.UBIGEO ?? fila.ubigeo);
    if (!ubigeo) continue;
    mapa.set(ubigeo, {
      total: numeroEntero(fila.Total ?? fila.total),
      hombres: numeroEntero(fila.Hombre_T ?? fila.hombre_t),
      mujeres: numeroEntero(fila.Mujer_T ?? fila.mujer_t),
    });
  }
  return mapa;
}

function mapaMaestro(filas) {
  const mapa = new Map();
  for (const fila of filas ?? []) {
    const ubigeo = ubigeoValido(fila.ubigeo ?? fila.UBIGEO);
    if (!ubigeo) continue;
    mapa.set(ubigeo, {
      nombre: texto(fila.distrito),
      provincia: texto(fila.provincia),
      region: texto(fila.departamento),
      poblacionCapa: numeroEntero(fila.poblacion_capa),
    });
  }
  return mapa;
}

function preparar(coleccion, censo, maestro) {
  const preparados = [];
  const ubigeosFuente = new Set();
  const etiquetas = new Map();
  const vistos = new Set();
  const rechazos = {
    sinUbigeo: 0,
    sinUbigeoDetalle: [],
    duplicados: 0,
    sinGeometria: 0,
    sinGeometriaDetalle: [],
    demasiadoLargo: 0,
  };
  const sinPoblacion = [];
  const sinParidad = [];
  const porFuente = { geojson: 0, capa: 0, maestro: 0, nulo: 0 };
  let sumaPoblacion = 0;

  coleccion.features.forEach((feature, indice) => {
    const props = propsNormalizadas(feature.properties);
    const ubigeo = ubigeoValido(props.ubigeo);
    if (!ubigeo) {
      rechazos.sinUbigeo += 1;
      if (rechazos.sinUbigeoDetalle.length < 10) {
        const nombre = texto(props.distrito ?? props.nombre) ?? "(sin nombre)";
        const crudo = String(props.ubigeo ?? "(vacío)");
        rechazos.sinUbigeoDetalle.push(`#${indice} ${nombre} [ubigeo=${crudo}]`);
      }
      return;
    }
    ubigeosFuente.add(ubigeo);

    const nombre = texto(props.distrito ?? props.nombre);
    const provincia = texto(props.provincia);
    const region = texto(props.departamento ?? props.region);
    etiquetas.set(
      ubigeo,
      `${nombre ?? "(sin nombre)"} · ${provincia ?? "(sin provincia)"} · ${region ?? "(sin región)"}`,
    );

    if (vistos.has(ubigeo)) {
      rechazos.duplicados += 1;
      return;
    }
    vistos.add(ubigeo);

    if (!geometriaValida(feature.geometry)) {
      rechazos.sinGeometria += 1;
      if (rechazos.sinGeometriaDetalle.length < 10) {
        rechazos.sinGeometriaDetalle.push(`${ubigeo} ${nombre ?? "(sin nombre)"}`);
      }
      return;
    }
    if (
      !nombre ||
      nombre.length > 120 ||
      (provincia && provincia.length > 120) ||
      (region && region.length > 120)
    ) {
      rechazos.demasiadoLargo += 1;
      return;
    }

    // Total: GeoJSON → distritos_capa.csv → distritos_maestro.csv. Nada se
    // estima; `poblacion_inei` es otra serie y no se usa.
    let total = numeroEntero(
      props.total ?? props.poblacion ?? props.poblacion_total ?? props.poblaciontotal,
    );
    let fuenteTotal = total === null ? null : "geojson";
    if (total === null) {
      total = censo.get(ubigeo)?.total ?? null;
      if (total !== null) fuenteTotal = "capa";
    }
    if (total === null) {
      total = maestro.get(ubigeo)?.poblacionCapa ?? null;
      if (total !== null) fuenteTotal = "maestro";
    }
    porFuente[fuenteTotal ?? "nulo"] += 1;
    if (total === null) sinPoblacion.push(ubigeo);
    else sumaPoblacion += total;

    // Hombres/mujeres: sólo si la suma cuadra con el total. Si no, NULL.
    const demografia = censo.get(ubigeo);
    let hombres = demografia?.hombres ?? null;
    let mujeres = demografia?.mujeres ?? null;
    let motivoSinParidad = null;
    if (hombres === null || mujeres === null) {
      hombres = null;
      mujeres = null;
      motivoSinParidad = "sin fila en distritos_capa.csv";
    } else if (total === null) {
      hombres = null;
      mujeres = null;
      motivoSinParidad = "sin poblacion_total con la que verificar la suma";
    } else if (hombres + mujeres !== total) {
      hombres = null;
      mujeres = null;
      motivoSinParidad = "Hombre_T+Mujer_T no cuadra con poblacion_total";
      sinParidad.push(ubigeo);
    }

    const etiquetaTotal =
      fuenteTotal === "geojson"
        ? "geojson properties.total"
        : fuenteTotal === "capa"
          ? "distritos_capa.csv Total"
          : fuenteTotal === "maestro"
            ? "distritos_maestro.csv poblacion_capa"
            : "NULL";

    const procedencia =
      total === null
        ? "total: NULL (el insumo no trae población; no se estimó); hombres/mujeres: NULL (no se estimó)"
        : `total: ${etiquetaTotal} (Censo 2025 geogpsperu); hombres/mujeres: ${
            hombres === null
              ? `NULL (${motivoSinParidad}; no se estimó)`
              : "distritos_capa.csv Hombre_T/Mujer_T"
          }`;

    preparados.push({
      ubigeo,
      nombre,
      provincia,
      region,
      poblacionTotal: total,
      poblacionHombres: hombres,
      poblacionMujeres: mujeres,
      procedencia,
      geojson: JSON.stringify(feature.geometry),
    });
  });

  preparados.sort((a, b) => a.ubigeo.localeCompare(b.ubigeo));

  return {
    preparados,
    ubigeosFuente,
    etiquetas,
    rechazos,
    sinPoblacion,
    sinParidad,
    porFuente,
    sumaPoblacion,
  };
}

function muestra(valores, limite = 10) {
  if (valores.length === 0) return "ninguno";
  const cabeza = valores.slice(0, limite).join(", ");
  const resto = valores.length - limite;
  return resto > 0 ? `${cabeza} … (+${resto})` : cabeza;
}

function reportarFuentes({ coleccion, tamanoBytes, rutaFuente, datos, hayCapa, hayMaestro }) {
  console.log("\n=== Fuentes ===");
  console.log(`GeoJSON : ${path.relative(RAIZ, rutaFuente)}`);
  console.log(
    `Tamaño  : ${(tamanoBytes / 1024 / 1024).toFixed(1)} MB · ${NUM.format(coleccion.features.length)} features`,
  );
  console.log(`CSV capa: ${hayCapa ? "leído" : "AUSENTE (sin fallback de Total ni sexo)"}`);
  console.log(`CSV INEI: ${hayMaestro ? "leído" : "AUSENTE (no se puede medir el desfase)"}`);
  console.log(`Preparadas: ${NUM.format(datos.preparados.length)}`);
  console.log(`Sin ubigeo válido: ${NUM.format(datos.rechazos.sinUbigeo)}`);
  for (const detalle of datos.rechazos.sinUbigeoDetalle) {
    console.log(`  · ${detalle}`);
  }
  console.log(`Ubigeo duplicado: ${NUM.format(datos.rechazos.duplicados)}`);
  console.log(`Sin geometría válida: ${NUM.format(datos.rechazos.sinGeometria)}`);
  for (const detalle of datos.rechazos.sinGeometriaDetalle) {
    console.log(`  · ${detalle}`);
  }
  console.log(`Descartadas por longitud: ${NUM.format(datos.rechazos.demasiadoLargo)}`);
  console.log(
    `Población por fuente: geojson ${NUM.format(datos.porFuente.geojson)} · ` +
      `capa ${NUM.format(datos.porFuente.capa)} · ` +
      `maestro ${NUM.format(datos.porFuente.maestro)} · ` +
      `NULL ${NUM.format(datos.porFuente.nulo)}`,
  );
  if (datos.sinPoblacion.length > 0) {
    const detalle = datos.sinPoblacion.map(
      (ubigeo) => `${ubigeo} ${datos.etiquetas.get(ubigeo) ?? ""}`.trim(),
    );
    console.log(
      `Sin población: ${NUM.format(datos.sinPoblacion.length)} (${muestra(detalle)})`,
    );
  } else {
    console.log("Sin población: ninguno");
  }
  if (datos.sinParidad.length > 0) {
    const detalle = datos.sinParidad.map(
      (ubigeo) => `${ubigeo} ${datos.etiquetas.get(ubigeo) ?? ""}`.trim(),
    );
    console.log(
      `H+M no cuadra (se dejan NULL): ${NUM.format(datos.sinParidad.length)} (${muestra(detalle)})`,
    );
  } else {
    console.log("H+M no cuadra: ninguno");
  }
  console.log(`Suma poblacional preparada: ${NUM.format(datos.sumaPoblacion)}`);
}

function reportarDesfase({ datos, maestro, hayMaestro }) {
  console.log("\n=== Desfase INEI ===");
  if (!hayMaestro) {
    console.log("Maestro ausente: no se puede medir el desfase 1 892 / 1 891.");
    return;
  }

  const faltanEnMaestro = [...datos.ubigeosFuente]
    .filter((ubigeo) => !maestro.has(ubigeo))
    .sort();
  const faltanEnCapa = [...maestro.keys()]
    .filter((ubigeo) => !datos.ubigeosFuente.has(ubigeo))
    .sort();

  console.log(
    `Capa: ${NUM.format(datos.ubigeosFuente.size)} · Maestro INEI: ${NUM.format(maestro.size)}`,
  );
  if (faltanEnMaestro.length === 0) {
    console.log("En la capa y no en el maestro: ninguno");
  } else {
    console.log(`En la capa y no en el maestro: ${NUM.format(faltanEnMaestro.length)}`);
    for (const ubigeo of faltanEnMaestro) {
      console.log(`  · ${ubigeo} ${datos.etiquetas.get(ubigeo) ?? ""}`);
    }
    console.log("  Se cargan con su ubigeo propio; no se les inventa otro ni se descartan.");
  }
  if (faltanEnCapa.length === 0) {
    console.log("En el maestro y no en la capa: ninguno");
  } else {
    console.log(`En el maestro y no en la capa: ${NUM.format(faltanEnCapa.length)}`);
    for (const ubigeo of faltanEnCapa) {
      console.log(`  · ${ubigeo} ${maestro.get(ubigeo)?.nombre ?? ""}`);
    }
    console.log("  No se inventa geometría: quedan fuera de territorio.distrito.");
  }
}

function reportarCore(datos, core) {
  if (!core) return;
  const faltanEnCore = [...datos.ubigeosFuente]
    .filter((ubigeo) => !core.has(ubigeo))
    .sort();
  console.log(`\ncore.distritos: ${NUM.format(core.size)} ubigeos`);
  if (faltanEnCore.length === 0) {
    console.log("En la capa y no en core.distritos: ninguno");
  } else {
    console.log(`En la capa y no en core.distritos: ${NUM.format(faltanEnCore.length)}`);
    for (const ubigeo of faltanEnCore) {
      console.log(`  · ${ubigeo} ${datos.etiquetas.get(ubigeo) ?? ""}`);
    }
  }
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
    const puerto = url.port || "5432";
    return `${dsn.origen} · ${url.hostname}:${puerto} · db=${url.pathname.replace(/^\//, "")}`;
  } catch {
    return `${dsn.origen} · (DSN no es URL; no se muestra)`;
  }
}

async function abrirDestino(dsn) {
  const cliente = new Client({
    connectionString: dsn.url,
    application_name: "avisa-carga-gis-distritos",
    statement_timeout: 10 * 60 * 1000,
  });
  await cliente.connect();
  return cliente;
}

const COLUMNAS_REQUERIDAS = [
  "ubigeo",
  "nombre",
  "provincia",
  "region",
  "poblacion_total",
  "poblacion_hombres",
  "poblacion_mujeres",
  "procedencia_poblacion",
  "geom",
  "centroide",
];

async function verificarTabla(cliente) {
  const { rows } = await cliente.query(
    "select to_regclass('territorio.distrito') as tabla",
  );
  if (!rows[0]?.tabla) return false;

  const { rows: columnas } = await cliente.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'territorio' and table_name = 'distrito'`,
  );
  const presentes = new Set(columnas.map((c) => c.column_name));
  const faltan = COLUMNAS_REQUERIDAS.filter((c) => !presentes.has(c));
  if (faltan.length) {
    throw new Error(
      `territorio.distrito existe pero le faltan columnas: ${faltan.join(", ")}. ` +
        "Revisá migration/47_gis_distritos.sql.",
    );
  }
  return true;
}

async function leerCoreDistritos(cliente) {
  try {
    const { rows } = await cliente.query(
      "select ubigeo::text as ubigeo from core.distritos",
    );
    return new Set(rows.map((r) => r.ubigeo));
  } catch {
    return null;
  }
}

export function sqlUpsert(nFilas) {
  const filas = [];
  let p = 0;
  for (let i = 0; i < nFilas; i += 1) {
    filas.push(
      `($${++p}::char(6), $${++p}::varchar(120), $${++p}::varchar(120), ` +
        `$${++p}::varchar(120), $${++p}::bigint, $${++p}::bigint, ` +
        `$${++p}::bigint, $${++p}::text, ` +
        `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${++p}), 4326)))`,
    );
  }

  return `
with datos (ubigeo, nombre, provincia, region, poblacion_total,
             poblacion_hombres, poblacion_mujeres, procedencia_poblacion, geom) as (
  values ${filas.join(",\n         ")}
)
insert into territorio.distrito (
    ubigeo, nombre, provincia, region, poblacion_total,
    poblacion_hombres, poblacion_mujeres, procedencia_poblacion,
    geom, centroide
)
select ubigeo, nombre, provincia, region, poblacion_total,
       poblacion_hombres, poblacion_mujeres, procedencia_poblacion,
       geom, ST_PointOnSurface(geom)
  from datos
on conflict (ubigeo) do update
   set nombre                = excluded.nombre,
       provincia             = excluded.provincia,
       region                = excluded.region,
       poblacion_total       = excluded.poblacion_total,
       poblacion_hombres     = excluded.poblacion_hombres,
       poblacion_mujeres     = excluded.poblacion_mujeres,
       procedencia_poblacion = excluded.procedencia_poblacion,
       geom                  = excluded.geom,
       centroide             = excluded.centroide
 where territorio.distrito.nombre                is distinct from excluded.nombre
    or territorio.distrito.provincia             is distinct from excluded.provincia
    or territorio.distrito.region                is distinct from excluded.region
    or territorio.distrito.poblacion_total       is distinct from excluded.poblacion_total
    or territorio.distrito.poblacion_hombres     is distinct from excluded.poblacion_hombres
    or territorio.distrito.poblacion_mujeres     is distinct from excluded.poblacion_mujeres
    or territorio.distrito.procedencia_poblacion is distinct from excluded.procedencia_poblacion
    or coalesce(not ST_Equals(territorio.distrito.geom, excluded.geom), true)
    or coalesce(not ST_Equals(territorio.distrito.centroide, excluded.centroide), true)
returning (xmax = 0) as insertado`;
}

export function sqlPlan(nFilas) {
  const filas = [];
  let p = 0;
  for (let i = 0; i < nFilas; i += 1) {
    filas.push(
      `($${++p}::char(6), ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${++p}), 4326)), ${i})`,
    );
  }

  return `
with datos (ubigeo, geom, orden) as (
  values ${filas.join(",\n         ")}
)
select datos.orden,
       datos.ubigeo,
       (d.ubigeo is not null) as existe,
       d.nombre,
       d.provincia,
       d.region,
       d.poblacion_total,
       d.poblacion_hombres,
       d.poblacion_mujeres,
       d.procedencia_poblacion,
       ST_Equals(d.geom, datos.geom) as geom_igual,
       ST_Equals(d.centroide, ST_PointOnSurface(datos.geom)) as centroide_igual
  from datos
  left join territorio.distrito d on d.ubigeo = datos.ubigeo
 order by datos.orden`;
}

function mismoValor(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return String(a) === String(b);
}

function clasificar(fila, item) {
  if (!fila.existe) return "insertar";
  const igual =
    mismoValor(fila.nombre, item.nombre) &&
    mismoValor(fila.provincia, item.provincia) &&
    mismoValor(fila.region, item.region) &&
    mismoValor(fila.poblacion_total, item.poblacionTotal) &&
    mismoValor(fila.poblacion_hombres, item.poblacionHombres) &&
    mismoValor(fila.poblacion_mujeres, item.poblacionMujeres) &&
    mismoValor(fila.procedencia_poblacion, item.procedencia) &&
    fila.geom_igual === true &&
    fila.centroide_igual === true;
  return igual ? "saltar" : "actualizar";
}

async function planificar(cliente, items, tamanoLote) {
  const plan = { insertar: 0, actualizar: 0, saltar: 0 };
  for (let inicio = 0; inicio < items.length; inicio += tamanoLote) {
    const lote = items.slice(inicio, inicio + tamanoLote);
    const params = [];
    for (const item of lote) params.push(item.ubigeo, item.geojson);
    const { rows } = await cliente.query(sqlPlan(lote.length), params);
    rows.forEach((fila) => {
      plan[clasificar(fila, lote[fila.orden])] += 1;
    });
  }
  return plan;
}

async function escribirLote(cliente, lote) {
  const params = [];
  for (const item of lote) {
    params.push(
      item.ubigeo,
      item.nombre,
      item.provincia,
      item.region,
      item.poblacionTotal,
      item.poblacionHombres,
      item.poblacionMujeres,
      item.procedencia,
      item.geojson,
    );
  }

  const { rows } = await cliente.query(sqlUpsert(lote.length), params);
  let insertados = 0;
  let actualizados = 0;
  for (const fila of rows) {
    if (fila.insertado) insertados += 1;
    else actualizados += 1;
  }
  return {
    insertados,
    actualizados,
    saltados: lote.length - rows.length,
  };
}

async function escribirTodo(cliente, items, tamanoLote) {
  const total = { insertados: 0, actualizados: 0, saltados: 0 };
  await cliente.query("begin");
  try {
    let numeroLote = 0;
    for (let inicio = 0; inicio < items.length; inicio += tamanoLote) {
      numeroLote += 1;
      const lote = items.slice(inicio, inicio + tamanoLote);
      const resultado = await escribirLote(cliente, lote);
      total.insertados += resultado.insertados;
      total.actualizados += resultado.actualizados;
      total.saltados += resultado.saltados;
      if (numeroLote % 2 === 0 || inicio + tamanoLote >= items.length) {
        console.log(
          `  lote ${numeroLote}: +${resultado.insertados} ` +
            `~${resultado.actualizados} =${resultado.saltados}`,
        );
      }
    }
    await cliente.query("analyze territorio.distrito");
    await cliente.query("commit");
    return total;
  } catch (error) {
    await cliente.query("rollback").catch(() => {});
    throw error;
  }
}

async function cargar(opciones) {
  const rutaFuente =
    opciones.fuente ??
    (opciones.completo ? FUENTE_COMPLETA : FUENTE_SIMPLE);
  const escribir = opciones.aplicar && opciones.confirmar;

  // Cinturón y tirantes: ninguna ruta escribe sin las dos banderas.
  if (escribir && !(opciones.aplicar && opciones.confirmar)) {
    throw new Error("Ruta de escritura sin --apply --confirmar: se aborta.");
  }

  const modo = escribir ? "apply --confirmar" : "dry-run";
  console.log("AVISA · carga de la capa distrital GIS");
  console.log(`Modo   : ${modo}`);
  console.log(`Lote   : ${NUM.format(opciones.lote)} filas`);

  const texto = await leerTexto(rutaFuente);
  const tamanoBytes = Buffer.byteLength(texto, "utf8");

  let coleccion;
  try {
    coleccion = JSON.parse(texto);
  } catch (error) {
    throw new Error(`GeoJSON inválido (${path.relative(RAIZ, rutaFuente)}): ${error.message}`);
  }
  if (
    !coleccion ||
    coleccion.type !== "FeatureCollection" ||
    !Array.isArray(coleccion.features)
  ) {
    throw new Error("El insumo no es una FeatureCollection de GeoJSON.");
  }

  const filasCapa = await leerCsvSiExiste(CSV_CAPA);
  const filasMaestro = await leerCsvSiExiste(CSV_MAESTRO);
  const censo = mapaPoblacionCapa(filasCapa);
  const maestro = mapaMaestro(filasMaestro);

  const datos = preparar(coleccion, censo, maestro);
  reportarFuentes({
    coleccion,
    tamanoBytes,
    rutaFuente,
    datos,
    hayCapa: filasCapa !== null,
    hayMaestro: filasMaestro !== null,
  });
  reportarDesfase({ datos, maestro, hayMaestro: filasMaestro !== null });

  let cliente = null;
  let tablaExiste = false;
  let plan = null;

  try {
    if (!opciones.sinBd) {
      const destino = resolverDsn(opciones);
      if (destino) {
        console.log(`\nDestino: ${describirDestino(destino)}`);
        cliente = await abrirDestino(destino);
        tablaExiste = await verificarTabla(cliente);
        if (!tablaExiste) {
          console.log("Tabla territorio.distrito: AUSENTE");
          console.log("  Aplicá antes migration/47_gis_distritos.sql.");
        } else {
          console.log("Tabla territorio.distrito: presente");
          const core = await leerCoreDistritos(cliente);
          reportarCore(datos, core);
          if (escribir) {
            console.log(
              "\nPlan: se informa al final con los contadores de la transacción.",
            );
          } else {
            plan = await planificar(cliente, datos.preparados, opciones.lote);
            console.log(
              `\nPlan: insertar ${NUM.format(plan.insertar)} · ` +
                `actualizar ${NUM.format(plan.actualizar)} · ` +
                `saltar ${NUM.format(plan.saltar)}`,
            );
          }
        }
      } else {
        console.log(
          "\nBase: sin DSN (--dsn, NEON_OWNER_URL o DATABASE_URL). " +
            "Dry-run sólo sobre las fuentes.",
        );
      }
    } else {
      console.log("\nBase: no consultada (--sin-bd).");
      plan = {
        insertar: datos.preparados.length,
        actualizar: 0,
        saltar: 0,
      };
      console.log(
        `Plan: insertar ${NUM.format(plan.insertar)} · actualizar 0 · saltar 0 ` +
          "(sin comparar con la base)",
      );
    }

    if (escribir) {
      if (!cliente) {
        throw new Error("--apply necesita un DSN (--dsn, NEON_OWNER_URL o DATABASE_URL).");
      }
      if (!tablaExiste) {
        throw new Error(
          "No existe territorio.distrito. Aplicá migration/47_gis_distritos.sql antes de --apply.",
        );
      }
      const resultado = await escribirTodo(cliente, datos.preparados, opciones.lote);
      console.log(
        `\nResultado: insertados ${NUM.format(resultado.insertados)} · ` +
          `actualizados ${NUM.format(resultado.actualizados)} · ` +
          `saltados ${NUM.format(resultado.saltados)}`,
      );
      console.log("Transacción confirmada.");
    } else {
      console.log("\nNada se escribió (dry-run).");
      if (cliente && !tablaExiste) {
        console.log("AVISO: falta crear territorio.distrito (migration/47_gis_distritos.sql).");
        process.exitCode = 1;
      }
    }

    const descartadas =
      datos.rechazos.sinUbigeo +
      datos.rechazos.duplicados +
      datos.rechazos.sinGeometria +
      datos.rechazos.demasiadoLargo;
    if (descartadas > 0) {
      console.log(`AVISO: ${NUM.format(descartadas)} features no se cargaron (ver arriba).`);
      process.exitCode = 1;
    }
    if (datos.sinPoblacion.length > 0) {
      console.log(
        `FALTANTE DECLARADO: ${NUM.format(datos.sinPoblacion.length)} distritos sin población; ` +
          "no se estimó.",
      );
    }

  } finally {
    if (cliente) await cliente.end().catch(() => {});
  }
}

async function main() {
  let opciones;
  try {
    opciones = leerOpciones();
  } catch (error) {
    console.error(error.message);
    uso();
    process.exitCode = 1;
    return;
  }

  if (opciones.ayuda) {
    uso();
    return;
  }

  try {
    validarOpciones(opciones);
    await cargar(opciones);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
