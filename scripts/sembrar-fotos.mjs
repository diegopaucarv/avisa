#!/usr/bin/env node
/**
 * Siembra las fotografías del directorio.
 *
 * Lee el inventario exportado desde la base
 * (`scripts/fotos_export.csv`, columnas `entidad_tipo,entidad_id,url,alt`),
 * descarga cada imagen a `angular/public/medios/<tipo>/<id>.<ext>` y deja un
 * SQL idempotente en `migration/44_semilla_fotos_medios.sql` que registra la
 * foto principal en `core.medios` con `url` relativa.
 *
 * Fuente: la propia base (`foto_url` histórica de actores, organizaciones y
 * locales). No se inventan imágenes ni se estiman datos: cada archivo
 * corresponde a una URL que ya estaba cargada.
 *
 * Uso:
 *   node scripts/sembrar-fotos.mjs [ruta-al-csv]
 */

import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const CSV = process.argv[2] ?? path.join(AQUI, "fotos_export.csv");
const DESTINO = path.join(RAIZ, "angular", "public", "medios");
const SQL = path.join(RAIZ, "migration", "44_semilla_fotos_medios.sql");

const MIME_A_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Parser CSV mínimo (RFC 4180) suficiente para este inventario. */
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

async function leerTexto(ruta) {
  const partes = [];
  for await (const trozo of createReadStream(ruta, { encoding: "utf8" })) {
    partes.push(trozo);
  }
  return partes.join("");
}

function escaparSql(valor) {
  return `'${valor.replace(/'/g, "''")}'`;
}

async function descargar(url, intentos = 3) {
  let ultimoError;
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      const respuesta = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; AVISA/1.0; +https://avisa.local)",
          accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
        },
        redirect: "follow",
      });
      if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
      }
      const tipo = (respuesta.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const ext = MIME_A_EXT[tipo] ?? "jpg";
      const bytes = Buffer.from(await respuesta.arrayBuffer());
      if (bytes.length === 0) throw new Error("respuesta vacía");
      return { bytes, mime: tipo || "image/jpeg", ext };
    } catch (error) {
      ultimoError = error;
      if (intento < intentos) {
        await new Promise((r) => setTimeout(r, 400 * intento));
      }
    }
  }
  throw ultimoError;
}

async function main() {
  const texto = await leerTexto(CSV);
  const filas = parseCsv(texto);
  const cabecera = filas.shift();
  const columnas = Object.fromEntries(cabecera.map((c, i) => [c.trim(), i]));

  const registros = filas.map((f) => ({
    tipo: f[columnas.entidad_tipo].trim(),
    id: f[columnas.entidad_id].trim(),
    url: f[columnas.url].trim(),
    alt: (f[columnas.alt] ?? "").trim(),
  }));

  console.log(`Inventario: ${registros.length} fotografías.`);

  const sentencias = [];
  let descargadas = 0;
  let fallidas = 0;

  const CONCURRENCIA = 6;
  let cursor = 0;

  async function trabajador() {
    while (cursor < registros.length) {
      const indice = cursor;
      cursor += 1;
      const registro = registros[indice];
      const etiqueta = `[${indice + 1}/${registros.length}] ${registro.tipo} ${registro.id}`;
      try {
        const { bytes, mime, ext } = await descargar(registro.url);
        const carpeta = path.join(DESTINO, registro.tipo);
        await mkdir(carpeta, { recursive: true });
        const relativa = `/medios/${registro.tipo}/${registro.id}.${ext}`;
        await writeFile(path.join(DESTINO, registro.tipo, `${registro.id}.${ext}`), bytes);

        const alt = registro.alt || registro.tipo;
        sentencias.push(
          `insert into core.medios (` +
            `entidad_tipo, entidad_id, rol, url, mime, bytes, orden, es_principal, alt, fuente, nivel_clasificacion` +
            `) values (` +
            `${escaparSql(registro.tipo)}, ${escaparSql(registro.id)}, 'principal', ` +
            `${escaparSql(relativa)}, ${escaparSql(mime)}, ${bytes.length}, 0, true, ` +
            `${escaparSql(alt)}, 'AVISA_HISTORICO', 2` +
            `) on conflict do nothing;`,
        );
        descargadas += 1;
        console.log(`${etiqueta} → ${relativa} (${Math.round(bytes.length / 1024)} KB)`);
      } catch (error) {
        fallidas += 1;
        console.error(`${etiqueta} FALLÓ: ${error.message}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCIA }, () => trabajador()),
  );

  const encabezado = `-- =============================================================================
--  44 · Semilla de fotografías del directorio
--
--  Generado por \`scripts/sembrar-fotos.mjs\` a partir de \`scripts/fotos_export.csv\`,
--  que se exporta de la propia base (\`core.actores.foto_url\`,
--  \`core.organizaciones.foto_url\`, \`core.locales.foto_url\`).
--
--  No se inventan imágenes: cada registro corresponde a una URL que ya estaba
--  cargada. Los archivos se copian a \`angular/public/medios/<tipo>/<id>.<ext>\`
--  (servidos como \`/medios/...\`).
--
--  Idempotente: \`on conflict do nothing\` respeta el índice único de foto
--  principal vigente (\`medios_principal_unico\`).
--
--  Descargadas: ${descargadas} · Fallidas: ${fallidas}
-- =============================================================================

begin;

`;

  const cierre = `
insert into core.migracion_log (clave) values ('44_semilla_fotos_medios')
on conflict (clave) do nothing;

commit;
`;

  await writeFile(SQL, encabezado + sentencias.join("\n") + "\n" + cierre, "utf8");

  console.log(`\nDescargadas: ${descargadas} · Fallidas: ${fallidas}`);
  console.log(`SQL: ${path.relative(RAIZ, SQL)}`);
  if (fallidas > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
