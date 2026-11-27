import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { auditChange } from "../audit";
import { ApiError } from "../errors";
import { normalizarMotivo } from "./anulacion";

export const MEDIA_ENTITY_TYPES = [
  "actor",
  "organizacion",
  "local",
  "caso",
  "documento",
  "reunion",
] as const;
export type MediaEntityType = (typeof MEDIA_ENTITY_TYPES)[number];
const ENTITY_SET = new Set<string>(MEDIA_ENTITY_TYPES);

export const MEDIA_ROLES = [
  "principal",
  "galeria",
  "adjunto",
  "evidencia",
] as const;
export type MediaRole = (typeof MEDIA_ROLES)[number];
const ROLE_SET = new Set<string>(MEDIA_ROLES);

export type MediaListQuery = {
  entidadTipo?: string;
  entidadId?: string;
  entidadIds?: string[];
  rol?: string;
  incluirAnulados?: boolean;
  page?: number;
  pageSize?: number;
};

export type MediaListItem = {
  id: string;
  entidadTipo: string;
  entidadId: string;
  rol: string;
  titulo: string | null;
  descripcion: string | null;
  url: string;
  mime: string;
  ancho: number | null;
  alto: number | null;
  bytes: number | null;
  orden: number;
  esPrincipal: boolean;
  /**
   * `true` si la fila tiene los bytes cargados en `core.medios.contenido`.
   * La galería lo usa para preferir `/api/v1/media/<id>/contenido` sobre la
   * `url` estática. No implica que el archivo estático haya desaparecido.
   */
  tieneContenido: boolean;
  alt: string | null;
  credito: string | null;
  fuente: string;
  consentimientoFecha: string | null;
  baseLegal: string | null;
  clasificacion: number;
  anuladoEn: string | null;
  anuladoPor: string | null;
  anuladoPorNombre: string | null;
  motivoAnulacion: string | null;
  anulacionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type MediaListResult = {
  items: MediaListItem[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
};

const MEDIA_SELECT = `
  m.id::text as id,
  m.entidad_tipo,
  m.entidad_id,
  m.rol,
  m.titulo,
  m.descripcion,
  m.url,
  m.mime,
  m.ancho,
  m.alto,
  m.bytes,
  m.orden,
  m.es_principal,
  (m.contenido is not null) as tiene_contenido,
  m.alt,
  m.credito,
  m.fuente,
  to_char(m.consentimiento_fecha, 'YYYY-MM-DD') as consentimiento_fecha,
  m.base_legal,
  m.nivel_clasificacion as clasificacion,
  m.anulado_en,
  m.anulado_por::text as anulado_por,
  ua.nombre as anulado_por_nombre,
  m.motivo_anulacion,
  m.anulacion_id::text as anulacion_id,
  m.created_at,
  m.updated_at
`;

const MEDIA_FROM = `
  from core.medios m
  left join core.usuarios ua on ua.id = m.anulado_por
`;

function mapMedia(row: Record<string, unknown>): MediaListItem {
  return {
    id: row.id as string,
    entidadTipo: row.entidad_tipo as string,
    entidadId: row.entidad_id as string,
    rol: row.rol as string,
    titulo: row.titulo as string | null,
    descripcion: row.descripcion as string | null,
    url: row.url as string,
    mime: row.mime as string,
    ancho: row.ancho as number | null,
    alto: row.alto as number | null,
    bytes:
      row.bytes === null || row.bytes === undefined ? null : Number(row.bytes),
    orden: row.orden as number,
    esPrincipal: row.es_principal as boolean,
    tieneContenido: row.tiene_contenido as boolean,
    alt: row.alt as string | null,
    credito: row.credito as string | null,
    fuente: row.fuente as string,
    consentimientoFecha: row.consentimiento_fecha as string | null,
    baseLegal: row.base_legal as string | null,
    clasificacion: row.clasificacion as number,
    anuladoEn: row.anulado_en
      ? new Date(row.anulado_en as string).toISOString()
      : null,
    anuladoPor: row.anulado_por as string | null,
    anuladoPorNombre: row.anulado_por_nombre as string | null,
    motivoAnulacion: row.motivo_anulacion as string | null,
    anulacionId: row.anulacion_id as string | null,
    createdAt: row.created_at
      ? new Date(row.created_at as string).toISOString()
      : null,
    updatedAt: row.updated_at
      ? new Date(row.updated_at as string).toISOString()
      : null,
  };
}

export async function listMedia(
  client: PoolClient,
  query: MediaListQuery,
): Promise<MediaListResult> {
  const params: unknown[] = [];
  const where: string[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.entidadTipo) {
    if (!ENTITY_SET.has(query.entidadTipo)) {
      throw new ApiError(
        422,
        "El tipo de entidad no está en el catálogo.",
        "CATALOG_VALUE_INVALID",
      );
    }
    where.push(`m.entidad_tipo = ${bind(query.entidadTipo)}`);
  }
  if (query.entidadId) where.push(`m.entidad_id = ${bind(query.entidadId)}`);
  if (query.entidadIds?.length) {
    const valores = query.entidadIds.map((id) => bind(id));
    where.push(`m.entidad_id in (${valores.join(", ")})`);
  }
  if (query.rol) {
    if (!ROLE_SET.has(query.rol)) {
      throw new ApiError(
        422,
        "El rol del medio no está en el catálogo.",
        "CATALOG_VALUE_INVALID",
      );
    }
    where.push(`m.rol = ${bind(query.rol)}`);
  }
  where.push(
    query.incluirAnulados ? "m.anulado_en is not null" : "m.anulado_en is null",
  );

  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 25)));

  // Lote por `entidadIds` (tablas del directorio): devuelve **una** fila por
  // entidad —la principal o, si no hay, la primera del orden—. Así la columna
  // «Foto» de una página de hasta 100 entidades nunca se trunca por el límite
  // de `pageSize` aunque cada entidad tenga varias imágenes.
  if (query.entidadIds?.length) {
    const sql = `
      select distinct on (m.entidad_id) ${MEDIA_SELECT}
      ${MEDIA_FROM}
      where ${where.join(" and ")}
      order by m.entidad_id, m.es_principal desc, m.orden asc, m.created_at asc, m.id asc
    `;
    const result = await client.query(sql, params);

    return {
      items: result.rows.map(mapMedia),
      total: result.rows.length,
      page: 1,
      pageSize,
      generatedAt: new Date().toISOString(),
    };
  }

  const sql = `
    select ${MEDIA_SELECT},
           count(*) over()::int as total
    ${MEDIA_FROM}
    where ${where.join(" and ")}
    order by m.es_principal desc, m.orden asc, m.created_at asc, m.id asc
    limit ${bind(pageSize)} offset ${bind((page - 1) * pageSize)}
  `;

  const result = await client.query(sql, params);
  const total = (result.rows[0]?.total as number | undefined) ?? 0;

  return {
    items: result.rows.map(mapMedia),
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  };
}

export type MediaContent = {
  contenido: Buffer;
  /** `content_type` guardado; si falta se deduce de la extensión de `url`. */
  contentType: string | null;
  hash: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME_POR_EXTENSION: Readonly<Record<string, string>> = {
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

/**
 * Tipo MIME deducido de la extensión de una URL o ruta.
 *
 * Se usa sólo cuando la fila no tiene `content_type` (por ejemplo, si los
 * bytes se cargaron con otro proceso). Si la URL no trae extensión —caso de
 * `/api/v1/media/<id>/contenido`— devuelve `null` y el endpoint responde con
 * `application/octet-stream`.
 */
export function mimePorExtension(url: string): string | null {
  const sinQuery = url.split(/[?#]/, 1)[0] ?? "";
  const punto = sinQuery.lastIndexOf(".");
  if (punto < 0 || punto === sinQuery.length - 1) return null;
  return MIME_POR_EXTENSION[sinQuery.slice(punto + 1).toLowerCase()] ?? null;
}

/**
 * Bytes de una fotografía para el endpoint de contenido.
 *
 * Se ejecuta dentro de `withSession`, así que la RLS de `core.medios` manda:
 * una fila anulada o por encima del nivel del rol no se devuelve. Se filtra
 * `anulado_en is null` de forma explícita, igual que `listMedia`, para que la
 * intención no dependa sólo de la política.
 *
 * Un identificador mal formado no es un error de datos: no hay fila, y el
 * endpoint responde 404 en vez de un 422 de PostgreSQL.
 */
export async function leerContenidoMedio(
  client: PoolClient,
  id: string,
): Promise<MediaContent | null> {
  if (!UUID_RE.test(id)) return null;

  const result = await client.query(
    `select m.contenido,
            m.content_type,
            m.hash,
            m.url
       from core.medios m
      where m.id = $1::uuid
        and m.anulado_en is null
        and m.contenido is not null
      limit 1`,
    [id],
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const contenido = row.contenido;
  if (!Buffer.isBuffer(contenido)) return null;

  const guardado = row.content_type as string | null;

  return {
    contenido,
    contentType:
      guardado && guardado.trim()
        ? guardado
        : mimePorExtension((row.url as string | null) ?? ""),
    hash: (row.hash as string | null) ?? null,
  };
}

export type MediaCreateInput = Record<string, unknown>;

function texto(
  input: MediaCreateInput,
  key: string,
  maxLength: number,
  required = false,
): string | null | undefined {
  if (!(key in input)) {
    if (required)
      throw new ApiError(422, `Falta el campo ${key}.`, "FIELD_REQUIRED");
    return undefined;
  }
  const value = input[key];
  if (value === null) {
    if (required)
      throw new ApiError(
        422,
        `El campo ${key} es obligatorio.`,
        "FIELD_REQUIRED",
      );
    return null;
  }
  if (typeof value !== "string") {
    throw new ApiError(422, `El campo ${key} debe ser texto.`, "FIELD_INVALID");
  }
  const trimmed = value.trim();
  if (!trimmed && required) {
    throw new ApiError(
      422,
      `El campo ${key} es obligatorio.`,
      "FIELD_REQUIRED",
    );
  }
  if (trimmed.length > maxLength) {
    throw new ApiError(
      422,
      `El campo ${key} supera el largo permitido.`,
      "FIELD_INVALID",
    );
  }
  return trimmed || null;
}

function entero(
  input: MediaCreateInput,
  key: string,
  min = 0,
): number | null | undefined {
  if (!(key in input)) return undefined;
  const value = input[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new ApiError(
      422,
      `El campo ${key} debe ser un número válido.`,
      "FIELD_INVALID",
    );
  }
  return Math.trunc(value);
}

function booleano(input: MediaCreateInput, key: string): boolean | undefined {
  if (!(key in input)) return undefined;
  const value = input[key];
  if (typeof value !== "boolean") {
    throw new ApiError(
      422,
      `El campo ${key} debe ser booleano.`,
      "FIELD_INVALID",
    );
  }
  return value;
}

/** Tope de una fotografía cargada desde la SPA. */
const MAX_CONTENIDO_BYTES = 2 * 1024 * 1024;

const DATA_URL_RE = /^data:([^;,]+)?(?:;[^,]*)?;base64,/i;

type ContenidoImagen = {
  buffer: Buffer;
  /** MIME validado (empieza por `image/`). */
  mime: string;
  /** sha256 hexadecimal de los bytes decodificados. */
  hash: string;
};

/**
 * Lee `contenido` (base64 puro o data-URL) cuando viene en el cuerpo.
 *
 * Devuelve `null` si el campo no vino, para que el alta por `url` siga
 * comportándose igual que antes del soporte de bytes. El tamaño se mide sobre
 * los bytes decodificados, nunca sobre lo que declare el cliente.
 */
function leerContenidoImagen(
  input: MediaCreateInput,
  mimeDeclarado: string | null,
): ContenidoImagen | null {
  if (!("contenido" in input)) return null;
  const valor = input.contenido;
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== "string") {
    throw new ApiError(
      422,
      "El contenido de la imagen debe ser base64.",
      "CONTENIDO_INVALIDO",
    );
  }

  let limpio = valor.trim();
  let mimePrefijo: string | null = null;
  const dataUrl = DATA_URL_RE.exec(limpio);
  if (dataUrl) {
    mimePrefijo = dataUrl[1]?.toLowerCase() ?? null;
    limpio = limpio.slice(dataUrl[0].length);
  }
  limpio = limpio.replace(/\s+/g, "");
  if (!limpio || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpio)) {
    throw new ApiError(
      422,
      "El contenido de la imagen no es base64 válido.",
      "BASE64_INVALIDO",
    );
  }
  // Base64 ocupa ~4/3 del binario: el doble lo supera con holgura y evita
  // decodificar en memoria una carga desproporcionada.
  if (limpio.length > MAX_CONTENIDO_BYTES * 2) {
    throw new ApiError(
      422,
      "La imagen supera el máximo de 2 MB.",
      "CONTENIDO_DEMASIADO_GRANDE",
    );
  }
  const buffer = Buffer.from(limpio, "base64");
  if (buffer.length === 0) {
    throw new ApiError(422, "La imagen está vacía.", "CONTENIDO_VACIO");
  }
  if (buffer.length > MAX_CONTENIDO_BYTES) {
    throw new ApiError(
      422,
      "La imagen supera el máximo de 2 MB.",
      "CONTENIDO_DEMASIADO_GRANDE",
    );
  }

  // El mime del cuerpo manda; si no viene, se toma el del prefijo data-URL.
  const mime = (mimeDeclarado ?? mimePrefijo ?? "").toLowerCase();
  if (!mime.startsWith("image/")) {
    throw new ApiError(
      422,
      "El contenido debe ser una imagen.",
      "MIME_INVALIDO",
    );
  }

  return {
    buffer,
    mime,
    hash: createHash("sha256").update(buffer).digest("hex"),
  };
}

export async function createMedia(
  client: PoolClient,
  scope: { usuarioId: string; rolCodigo: string },
  input: unknown,
): Promise<MediaListItem> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  const body = input as MediaCreateInput;

  const entidadTipo = texto(body, "entidadTipo", 24, true) as string;
  if (!ENTITY_SET.has(entidadTipo)) {
    throw new ApiError(
      422,
      "El tipo de entidad no está en el catálogo.",
      "CATALOG_VALUE_INVALID",
    );
  }
  const entidadId = texto(body, "entidadId", 120, true) as string;
  // `url` deja de ser obligatoria sólo si llegan bytes: en ese caso la fila se
  // sirve por `/api/v1/media/<id>/contenido` y no necesita un UPDATE posterior.
  const mimeBody = texto(body, "mime", 100);
  const contenido = leerContenidoImagen(body, mimeBody ?? null);
  const id = contenido ? randomUUID() : null;
  const url = contenido
    ? `/api/v1/media/${id}/contenido`
    : (texto(body, "url", 2000, true) as string);
  // Sin bytes, el mime conserva el valor por defecto de antes (`image/jpeg`).
  const mime = contenido ? contenido.mime : (mimeBody ?? "image/jpeg");

  const rol = texto(body, "rol", 12) ?? "galeria";
  if (!ROLE_SET.has(rol)) {
    throw new ApiError(
      422,
      "El rol del medio no está en el catálogo.",
      "CATALOG_VALUE_INVALID",
    );
  }
  const esPrincipal = booleano(body, "esPrincipal") ?? false;
  const orden = entero(body, "orden", 0) ?? 0;
  const ancho = entero(body, "ancho", 1);
  const alto = entero(body, "alto", 1);
  // El tamaño real de los bytes decodificados manda sobre el `bytes` del cliente.
  const bytesDeclarados = entero(body, "bytes", 0);
  const bytes = contenido ? contenido.buffer.length : (bytesDeclarados ?? null);
  const clasificacion = entero(body, "nivelClasificacion", 1) ?? 2;
  if (clasificacion > 3) {
    throw new ApiError(
      422,
      "El nivel de clasificación no es válido.",
      "FIELD_INVALID",
    );
  }

  if (esPrincipal) {
    await client.query(
      `update core.medios
          set es_principal = false, updated_at = now(), updated_by = $3
        where entidad_tipo = $1
          and entidad_id = $2
          and es_principal
          and anulado_en is null`,
      [entidadTipo, entidadId, scope.usuarioId],
    );
  }

  // Se arman columnas y marcadores en paralelo para poder añadir `id` y las
  // columnas de bytes sólo cuando hay contenido, sin renumerar parámetros.
  const params: unknown[] = [];
  const columnas: string[] = [];
  const marcadores: string[] = [];
  const add = (columna: string, valor: unknown, cast = ""): void => {
    params.push(valor);
    columnas.push(columna);
    marcadores.push(`$${params.length}${cast}`);
  };

  if (id) add("id", id, "::uuid");
  add("entidad_tipo", entidadTipo);
  add("entidad_id", entidadId);
  add("rol", rol);
  add("titulo", texto(body, "titulo", 160) ?? null);
  add("descripcion", texto(body, "descripcion", 4000) ?? null);
  add("url", url);
  add("mime", mime);
  add("ancho", ancho ?? null);
  add("alto", alto ?? null);
  add("bytes", bytes);
  add("orden", orden);
  add("es_principal", esPrincipal);
  add("alt", texto(body, "alt", 240) ?? null);
  add("credito", texto(body, "credito", 160) ?? null);
  add("fuente", texto(body, "fuente", 20) ?? "MANUAL");
  add(
    "consentimiento_fecha",
    texto(body, "consentimientoFecha", 10) ?? null,
    "::date",
  );
  add("base_legal", texto(body, "baseLegal", 120) ?? null);
  add("nivel_clasificacion", clasificacion);
  add("created_by", scope.usuarioId);
  add("updated_by", scope.usuarioId);
  if (contenido) {
    add("contenido", contenido.buffer);
    add("content_type", contenido.mime);
    add("hash", contenido.hash);
    columnas.push("cargado_en");
    marcadores.push("now()");
  }

  const result = await client.query(
    `insert into core.medios (${columnas.join(", ")})
     values (${marcadores.join(", ")})
     returning id::text as id`,
    params,
  );

  const insertado = result.rows[0]?.id as string | undefined;
  if (!insertado) throw new ApiError(500, "No se pudo registrar el medio.");

  const detalle = await client.query(
    `select ${MEDIA_SELECT} ${MEDIA_FROM} where m.id = $1::uuid`,
    [insertado],
  );
  const fila = detalle.rows[0] as Record<string, unknown> | undefined;
  if (!fila) throw new ApiError(404, "El medio no existe.", "NOT_FOUND");
  const medio = mapMedia(fila);

  await auditChange(client, {
    tabla: "core.medios",
    registroId: insertado,
    accion: "INSERT",
    usuarioId: scope.usuarioId,
    rolCodigo: scope.rolCodigo,
    despues: {
      entidad_tipo: medio.entidadTipo,
      entidad_id: medio.entidadId,
      rol: medio.rol,
      url: medio.url,
      es_principal: medio.esPrincipal,
    },
  });

  return medio;
}

/** Anulación lógica de un medio. No borra el archivo ni la fila. */
export async function anularMedia(
  client: PoolClient,
  scope: { usuarioId: string; rolCodigo: string },
  id: string,
  motivo: string | undefined,
): Promise<MediaListItem> {
  const razon = normalizarMotivo(motivo);

  const result = await client.query(
    `update core.medios
        set anulado_en = now(),
            motivo_anulacion = $2,
            anulado_por = $3,
            updated_at = now(),
            updated_by = $3
      where id = $1::uuid
        and anulado_en is null
      returning id::text as id`,
    [id, razon, scope.usuarioId],
  );
  if (!result.rows[0]) {
    throw new ApiError(
      404,
      "El medio no existe o ya está anulado.",
      "NOT_FOUND",
    );
  }

  const detalle = await client.query(
    `select ${MEDIA_SELECT} ${MEDIA_FROM} where m.id = $1::uuid`,
    [id],
  );
  const fila = detalle.rows[0] as Record<string, unknown> | undefined;
  if (!fila) throw new ApiError(404, "El medio no existe.", "NOT_FOUND");
  const medio = mapMedia(fila);

  await auditChange(client, {
    tabla: "core.medios",
    registroId: id,
    accion: "UPDATE",
    usuarioId: scope.usuarioId,
    rolCodigo: scope.rolCodigo,
    antes: { anulado_en: null },
    despues: { anulado_en: medio.anuladoEn, motivo_anulacion: razon },
  });

  return medio;
}
