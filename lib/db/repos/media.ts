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
  const url = texto(body, "url", 2000, true) as string;
  const mime = texto(body, "mime", 100) ?? "image/jpeg";

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
  const bytes = entero(body, "bytes", 0);
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

  const result = await client.query(
    `insert into core.medios (
        entidad_tipo, entidad_id, rol, titulo, descripcion, url, mime,
        ancho, alto, bytes, orden, es_principal, alt, credito, fuente,
        consentimiento_fecha, base_legal, nivel_clasificacion,
        created_by, updated_by
     ) values (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15,
        $16::date, $17, $18,
        $19, $19
     )
     returning id::text as id`,
    [
      entidadTipo,
      entidadId,
      rol,
      texto(body, "titulo", 160) ?? null,
      texto(body, "descripcion", 4000) ?? null,
      url,
      mime,
      ancho ?? null,
      alto ?? null,
      bytes ?? null,
      orden,
      esPrincipal,
      texto(body, "alt", 240) ?? null,
      texto(body, "credito", 160) ?? null,
      texto(body, "fuente", 20) ?? "MANUAL",
      texto(body, "consentimientoFecha", 10) ?? null,
      texto(body, "baseLegal", 120) ?? null,
      clasificacion,
      scope.usuarioId,
    ],
  );

  const id = result.rows[0]?.id as string | undefined;
  if (!id) throw new ApiError(500, "No se pudo registrar el medio.");

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
