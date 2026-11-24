#!/usr/bin/env node
/**
 * Carga los bytes de las fotografías del directorio en Neon
 * (`core.medios.contenido`, migración 46).
 *
 * POR QUÉ EXISTE
 * --------------
 * Las 142 fotos viven en `angular/public/medios/`, que **no está versionado**.
 * Un clon limpio o un CI no las tiene y en producción (`public/medios/`, que
 * arma `scripts/copiar-spa.mjs` desde `dist`) saldrían rotas. La migración 46
 * añade una copia servible en la base (excepción aprobada al criterio «no se
 * guardan binarios» de la 41). Este script es quien la rellena.
 *
 * El archivo estático NO se borra ni se mueve: la base es una segunda copia.
 *
 * QUÉ HACE
 * --------
 * 1. Recorre `angular/public/medios/**`.
 * 2. Calcula `sha256`, deduce `content_type` por extensión.
 * 3. Busca la fila de `core.medios` con esta prioridad:
 *      a. `url` exacta (`/medios/<tipo>/<archivo>`), la usual;
 *      b. `id` del medio, si el archivo se llama `<id>.<ext>`;
 *      c. `(entidad_tipo, entidad_id)`, que sobrevive a la reescritura de `url`
 *         (ver más abajo) y prefiere la foto principal.
 * 4. Hace `UPDATE ... SET contenido, content_type, hash, cargado_en = now()`.
 *
 * Idempotente: si el `hash` guardado ya coincide, no reescribe (cuenta como
 * «saltado»). Informa `actualizados / saltados / sin_fila / errores` y termina
 * con código 1 si hubo errores.
 *
 * USO
 * ---
 *   node scripts/cargar-medios-neon.mjs                 # Neon (NEON_OWNER_URL)
 *   node scripts/cargar-medios-neon.mjs --local         # DATABASE_URL
 *   node scripts/cargar-medios-neon.mjs --dry-run       # no escribe nada
 *   node scripts/cargar-medios-neon.mjs --reescribir-url
 *   node scripts/cargar-medios-neon.mjs --reescribir-url --confirmar
 *
 * REESCRITURA DE `url` (opt-in, con riesgo)
 * -----------------------------------------
 * `--reescribir-url` cambia `core.medios.url` de `/medios/...` a
 * `/api/v1/media/<id>/contenido` para las filas **que ya tienen contenido**.
 * El motivo es servir siempre desde la base cuando el estático no exista.
 *
 * Riesgo: `core.medios` **no tiene una columna para guardar la url anterior**.
 * Por eso:
 *   · sin `--confirmar` sólo se imprime la lista de cambios (dry-run);
 *   · con `--confirmar` se escribe además un respaldo en
 *     `scripts/medios_url_backup.json` (id → url y clave polimórfica) antes de
 *     tocar nada;
 *   · `--dry-run` desactiva cualquier escritura, incluida ésta.
 *
 * La carga de `contenido` no depende de esta bandera: se hace siempre (salvo
 * `--dry-run`). `--reescribir-url` sólo decide si además se cambia la `url`,
 * y ese cambio, sin `--confirmar`, queda en simulación.
 *
 * Reversión:
 *   · desde el respaldo: `scripts/medios_url_backup.json`;
 *   · o reconstruyendo la url desde la clave polimórfica y el tipo MIME:
 *
 *       update core.medios m
 *          set url = '/medios/' || m.entidad_tipo || '/' || m.entidad_id || '.'
 *                    || case m.content_type
 *                         when 'image/png'  then 'png'
 *                         when 'image/webp' then 'webp'
 *                         when 'image/gif'  then 'gif'
 *                         when 'image/avif' then 'avif'
 *                         else 'jpg'
 *                       end
 *        where m.url like '/api/v1/media/%/contenido';
 *
 *   Tras reescribir, este script sigue casando las filas por
 *   `(entidad_tipo, entidad_id)`, así que se puede volver a ejecutar sin
 *   duplicar ni perder la relación.
 *
 * El script NO se ejecuta solo: lo lanza el orquestador.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const MEDIOS = path.join(RAIZ, "angular", "public", "medios");
const RESPALDO_URL = path.join(AQUI, "medios_url_backup.json");

const MIME_POR_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
};

const EXTENSION_RE = new RegExp(
  `\\.(${Object.keys(MIME_POR_EXTENSION).join("|")})$`,
  "i",
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const args = new Set(process.argv.slice(2));
const LOCAL = args.has("--local");
const REESCRIBIR_URL = args.has("--reescribir-url");
const CONFIRMAR = args.has("--confirmar");
const SIMULAR = args.has("--dry-run");

function ayuda() {
  console.log(
    [
      "Uso: node scripts/cargar-medios-neon.mjs [opciones]",
      "",
      "  --local           usa DATABASE_URL en vez de NEON_OWNER_URL",
      "  --dry-run         no escribe nada (los conteos dicen qué haría)",
      "  --reescribir-url  propone cambiar url a /api/v1/media/<id>/contenido",
      "  --confirmar       con --reescribir-url, escribe los cambios de url",
      "  --help            muestra esta ayuda",
      "",
      "Sin --confirmar, --reescribir-url sólo imprime la lista de cambios.",
    ].join("\n"),
  );
}

function urlDeConexion() {
  if (LOCAL) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL para --local.");
    return url;
  }
  const url = process.env.NEON_OWNER_URL;
  if (!url) {
    throw new Error(
      "Falta NEON_OWNER_URL. Defínela en .env o usa --local con DATABASE_URL.",
    );
  }
  return url;
}

/**
 * `recursive: true` devuelve rutas relativas (separador del sistema) de todo
 * el árbol. Sólo interesan las imágenes.
 */
async function listarFotos(dir) {
  let entradas;
  try {
    entradas = await readdir(dir, { recursive: true });
  } catch (error) {
    throw new Error(
      `No se pudo leer ${dir}: ${error.message}. ` +
        "¿Existe angular/public/medios/?",
    );
  }

  return entradas
    .map((entrada) => String(entrada))
    .filter((relativa) => EXTENSION_RE.test(relativa))
    .sort();
}

/**
 * Descompone la ruta relativa en la url que guarda la semilla
 * (`/medios/<tipo>/<archivo>`) y en la clave polimórfica (`tipo`, `entidadId`).
 */
function describir(relativa) {
  const posix = relativa.split(path.sep).join("/");
  const partes = posix.split("/");
  const archivo = partes[partes.length - 1];
  const tipo = partes.length > 1 ? partes[0] : "";
  const punto = archivo.lastIndexOf(".");
  const tieneExtension = punto > 0;
  const entidadId = tieneExtension ? archivo.slice(0, punto) : archivo;
  const extension = tieneExtension
    ? archivo.slice(punto + 1).toLowerCase()
    : "";

  return {
    absoluta: path.join(MEDIOS, relativa),
    posix,
    tipo,
    entidadId,
    extension,
    url: `/medios/${posix}`,
  };
}

async function comprobarMigracion(client) {
  const { rows } = await client.query(
    `select 1
       from information_schema.columns
      where table_schema = 'core'
        and table_name = 'medios'
        and column_name = 'contenido'
      limit 1`,
  );
  if (rows.length === 0) {
    throw new Error(
      "Falta aplicar migration/46_medios_bytea.sql: core.medios no tiene la " +
        "columna contenido.",
    );
  }
}

/**
 * Ejecuta `fn` en una transacción con `app.rol_codigo = 'administrador'`
 * (`SET LOCAL`).
 *
 * Es necesario porque `core.medios` tiene RLS forzada: incluso el propietario
 * queda sujeto a las políticas salvo que tenga BYPASSRLS. Fijar el rol por
 * transacción también sobrevive a un endpoint de Neon en modo *transaction
 * pooling*, donde los ajustes de sesión no se conservan entre sentencias.
 */
async function conSesion(client, fn) {
  await client.query("begin");
  try {
    await client.query(
      "select set_config('app.rol_codigo', 'administrador', true)",
    );
    const resultado = await fn();
    await client.query("commit");
    return resultado;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

/**
 * Busca la fila destino. La url exacta es lo normal; los respaldos permiten
 * convivir con filas ya reescritas y con archivos nombrados por id de medio.
 */
async function buscarFila(client, foto) {
  let resultado = await client.query(
    `select id::text as id, hash
       from core.medios
      where url = $1
        and anulado_en is null
      limit 1`,
    [foto.url],
  );
  if (resultado.rows[0]) return resultado.rows[0];

  if (UUID_RE.test(foto.entidadId)) {
    resultado = await client.query(
      `select id::text as id, hash
         from core.medios
        where id = $1::uuid
          and anulado_en is null
        limit 1`,
      [foto.entidadId],
    );
    if (resultado.rows[0]) return resultado.rows[0];
  }

  // Clave polimórfica: sobrevive a la reescritura de url. Si hubiera varias
  // fotos de la misma entidad, se carga en la principal.
  resultado = await client.query(
    `select id::text as id, hash
       from core.medios
      where entidad_tipo = $1
        and entidad_id = $2
        and anulado_en is null
      order by es_principal desc, orden asc, created_at asc, id asc
      limit 1`,
    [foto.tipo, foto.entidadId],
  );
  return resultado.rows[0] ?? null;
}

async function leerRespaldo() {
  try {
    const texto = await readFile(RESPALDO_URL, "utf8");
    const datos = JSON.parse(texto);
    const filas =
      datos && typeof datos === "object" && typeof datos.filas === "object"
        ? datos.filas
        : {};
    return filas && !Array.isArray(filas) ? filas : {};
  } catch {
    return {};
  }
}

/**
 * Cambia `url` a `/api/v1/media/<id>/contenido` en las filas ya cargadas.
 * Sin `--confirmar` (o con `--dry-run`) sólo imprime la propuesta.
 */
async function reescribirUrls(client) {
  const rows = await conSesion(client, async () => {
    const resultado = await client.query(
      `select id::text as id,
              url,
              entidad_tipo,
              entidad_id,
              content_type
         from core.medios
        where contenido is not null
          and url not like '/api/v1/media/%'
        order by id`,
    );
    return resultado.rows;
  });

  if (rows.length === 0) {
    console.log("\nReescritura de url: no hay filas que cambiar.");
    return;
  }

  console.log(`\nFilas con contenido y url estática: ${rows.length}`);
  for (const fila of rows) {
    console.log(
      `  ${fila.id}  ${fila.url} → /api/v1/media/${fila.id}/contenido`,
    );
  }

  if (SIMULAR || !CONFIRMAR) {
    console.log(
      "Reescritura en simulación: no se escribió la url. " +
        "Repite con --reescribir-url --confirmar para aplicarla.",
    );
    return;
  }

  const respaldo = await leerRespaldo();
  for (const fila of rows) {
    respaldo[fila.id] = {
      url: fila.url,
      entidad_tipo: fila.entidad_tipo,
      entidad_id: fila.entidad_id,
      content_type: fila.content_type,
    };
  }
  await writeFile(
    RESPALDO_URL,
    `${JSON.stringify(
      { generado_en: new Date().toISOString(), filas: respaldo },
      null,
      2,
    )}\n`,
    "utf8",
  );

  let cambiadas = 0;
  await conSesion(client, async () => {
    for (const fila of rows) {
      const nuevo = `/api/v1/media/${fila.id}/contenido`;
      const update = await client.query(
        `update core.medios
            set url = $2
          where id = $1::uuid
            and url = $3`,
        [fila.id, nuevo, fila.url],
      );
      cambiadas += update.rowCount ?? 0;
    }
  });

  console.log(
    `URLs reescritas: ${cambiadas}. Respaldo: ` +
      path.relative(RAIZ, RESPALDO_URL),
  );
}

async function main() {
  if (args.has("--help") || args.has("-h")) {
    ayuda();
    return;
  }

  try {
    // `.env` vive en la raíz del proyecto Next. Si no existe, se usan las
    // variables ya presentes en el entorno.
    process.loadEnvFile(path.join(RAIZ, ".env"));
  } catch (error) {
    console.warn(
      `[medios] No se pudo leer .env (${error.message}); ` +
        "se usan las variables del entorno.",
    );
  }

  if (args.has("--confirmar") && !REESCRIBIR_URL) {
    console.warn(
      "[medios] --confirmar sólo aplica con --reescribir-url; se ignora.",
    );
  }

  const conexion = urlDeConexion();
  const fotos = (await listarFotos(MEDIOS)).map(describir);

  console.log(`Fotografías encontradas: ${fotos.length}`);
  if (SIMULAR) console.log("[medios] Modo simulación: no se escribe nada.");

  const resumen = {
    actualizados: 0,
    saltados: 0,
    sin_fila: 0,
    errores: 0,
  };

  const client = new Client({
    connectionString: conexion,
    application_name: "avisa-carga-medios",
  });
  await client.connect();

  try {
    await comprobarMigracion(client);

    for (const [indice, foto] of fotos.entries()) {
      const etiqueta = `[${indice + 1}/${fotos.length}] ${foto.posix}`;
      try {
        const contenido = await readFile(foto.absoluta);
        const hash = createHash("sha256").update(contenido).digest("hex");
        const contentType =
          MIME_POR_EXTENSION[foto.extension] ?? "application/octet-stream";

        const estado = await conSesion(client, async () => {
          const fila = await buscarFila(client, foto);
          if (!fila) return "sin_fila";
          if (fila.hash === hash) return "saltado";
          if (SIMULAR) return "simulado";

          const update = await client.query(
            `update core.medios
                set contenido = $2,
                    content_type = $3,
                    hash = $4,
                    cargado_en = now()
              where id = $1::uuid`,
            [fila.id, contenido, contentType, hash],
          );

          return (update.rowCount ?? 0) === 0 ? "sin_fila" : "actualizado";
        });

        if (estado === "sin_fila") {
          resumen.sin_fila += 1;
          console.warn(`${etiqueta} → sin fila en core.medios`);
        } else if (estado === "saltado") {
          resumen.saltados += 1;
          console.log(`${etiqueta} → saltado (hash sin cambios)`);
        } else if (estado === "simulado") {
          resumen.actualizados += 1;
          console.log(`${etiqueta} → actualizaría ${contentType}`);
        } else {
          resumen.actualizados += 1;
          console.log(
            `${etiqueta} → ${contentType} (${Math.round(
              contenido.byteLength / 1024,
            )} KB)`,
          );
        }
      } catch (error) {
        resumen.errores += 1;
        console.error(`${etiqueta} FALLÓ: ${error.message}`);
      }
    }

    console.log(
      `\nActualizados: ${resumen.actualizados} · ` +
        `Saltados: ${resumen.saltados} · ` +
        `Sin fila: ${resumen.sin_fila} · ` +
        `Errores: ${resumen.errores}`,
    );
    if (SIMULAR) {
      console.log(
        "[medios] Simulación: los conteos reflejan lo que se habría escrito.",
      );
    }

    if (REESCRIBIR_URL) {
      await reescribirUrls(client);
    }
  } finally {
    await client.end().catch(() => {});
  }

  if (resumen.errores > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[medios] ${error.message}`);
  process.exitCode = 1;
});
