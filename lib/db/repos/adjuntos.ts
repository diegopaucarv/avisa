import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { ApiError } from "../errors";
import type { DbSession } from "../tenant";

/**
 * Adjuntos genéricos (tabla `core.adjunto`, migración 49).
 *
 * El binario se guarda en `bytea`, igual que `core.medios`. La lista blanca de
 * tipos vive en `core.documento_lista_blanca`: no se acepta un archivo que la
 * base no declare permitido. El tamaño máximo es 20 MB, que es el mismo límite
 * que aplica el cargador de medios y evita reventar el cuerpo de Next.
 */

export const ENTIDADES_ADJUNTO = [
  "alerta",
  "compromiso",
  "hito",
  "documento",
  "reunion",
  "caso",
  "demanda",
] as const;

export type EntidadAdjunto = (typeof ENTIDADES_ADJUNTO)[number];

export type Adjunto = {
  id: string;
  entidadTipo: EntidadAdjunto;
  entidadId: string;
  nombre: string;
  mime: string | null;
  tamanoBytes: number | null;
  hashSha256: string | null;
  descripcion: string | null;
  subidoPor: string | null;
  createdAt: string;
};

export type AdjuntoContenido = {
  id: string;
  nombre: string;
  mime: string | null;
  contenido: Buffer;
  tamanoBytes: number | null;
};

export type NuevoAdjunto = {
  entidadTipo: string;
  entidadId: string;
  nombre: string;
  mime?: string | null;
  descripcion?: string | null;
  /** Base64 puro o data URL (`data:application/pdf;base64,...`). */
  contenidoBase64: string;
};

const MAX_BYTES = 20 * 1024 * 1024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roles con `core.roles.puede_editar = true`; la UI usa el mismo criterio. */
const ROLES_ESCRITURA = new Set([
  "administrador",
  "sectorista",
  "direccion_oaipcs",
  "servicio_agente",
  "auditor",
  "analista_cualitativo",
  "curador_politica",
]);

export function puedeEditarAdjuntos(rolCodigo: string): boolean {
  return ROLES_ESCRITURA.has(rolCodigo);
}

type FilaAdjunto = {
  id: string;
  entidad_tipo: EntidadAdjunto;
  entidad_id: string;
  nombre: string;
  mime: string | null;
  tamano_bytes: string | number | null;
  hash_sha256: string | null;
  descripcion: string | null;
  subido_por: string | null;
  created_at: Date | string;
};

function aAdjunto(fila: FilaAdjunto): Adjunto {
  return {
    id: fila.id,
    entidadTipo: fila.entidad_tipo,
    entidadId: fila.entidad_id,
    nombre: fila.nombre,
    mime: fila.mime,
    tamanoBytes:
      fila.tamano_bytes === null ? null : Number(fila.tamano_bytes),
    hashSha256: fila.hash_sha256,
    descripcion: fila.descripcion,
    subidoPor: fila.subido_por,
    createdAt:
      fila.created_at instanceof Date
        ? fila.created_at.toISOString()
        : String(fila.created_at),
  };
}

function validarEntidad(entidadTipo: string, entidadId: string): EntidadAdjunto {
  if (!(ENTIDADES_ADJUNTO as readonly string[]).includes(entidadTipo)) {
    throw new ApiError(
      400,
      "El tipo de entidad del adjunto no es válido.",
      "ENTIDAD_INVALIDA",
    );
  }
  if (!UUID_RE.test(entidadId)) {
    throw new ApiError(
      400,
      "El identificador de la entidad no es válido.",
      "ID_INVALIDO",
    );
  }
  return entidadTipo as EntidadAdjunto;
}

function extensionDe(nombre: string): string | null {
  const punto = nombre.lastIndexOf(".");
  if (punto < 1 || punto === nombre.length - 1) return null;
  return nombre.slice(punto + 1).toLowerCase();
}

/**
 * Devuelve el MIME declarado o lo deduce de la extensión. Siempre se contrasta
 * contra la lista blanca activa de la base: la extensión sola no autoriza.
 */
async function mimePermitido(
  client: PoolClient,
  nombre: string,
  mime: string | null | undefined,
): Promise<string> {
  const extension = extensionDe(nombre);
  let candidato = (mime ?? "").trim().toLowerCase();

  if (!candidato && extension) {
    const porExtension = await client.query<{ mime: string }>(
      `select mime
         from core.documento_lista_blanca
        where lower(extension) = $1 and activo
        order by mime
        limit 1`,
      [extension],
    );
    candidato = porExtension.rows[0]?.mime ?? "";
  }

  if (!candidato) {
    throw new ApiError(
      422,
      "No se pudo determinar el tipo del archivo. Use una extensión permitida.",
      "MIME_DESCONOCIDO",
    );
  }

  const permitido = await client.query(
    `select 1 from core.documento_lista_blanca where mime = $1 and activo`,
    [candidato],
  );
  if (permitido.rowCount === 0) {
    throw new ApiError(
      422,
      `El tipo «${candidato}» no está en la lista blanca de documentos.`,
      "MIME_NO_PERMITIDO",
    );
  }

  return candidato;
}

function decodificarBase64(contenidoBase64: string): Buffer {
  const limpio = contenidoBase64
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s+/g, "");
  if (!limpio || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpio)) {
    throw new ApiError(
      400,
      "El contenido del adjunto no es base64 válido.",
      "BASE64_INVALIDO",
    );
  }
  const buffer = Buffer.from(limpio, "base64");
  if (buffer.length === 0) {
    throw new ApiError(400, "El adjunto está vacío.", "ADJUNTO_VACIO");
  }
  if (buffer.length > MAX_BYTES) {
    throw new ApiError(
      413,
      "El adjunto supera el máximo de 20 MB.",
      "ADJUNTO_DEMASIADO_GRANDE",
    );
  }
  return buffer;
}

export async function listAdjuntos(
  client: PoolClient,
  entidadTipo: string,
  entidadId: string,
): Promise<Adjunto[]> {
  const tipo = validarEntidad(entidadTipo, entidadId);
  const { rows } = await client.query<FilaAdjunto>(
    `select id, entidad_tipo, entidad_id, nombre, mime, tamano_bytes,
            hash_sha256, descripcion, subido_por, created_at
       from core.adjunto
      where entidad_tipo = $1 and entidad_id = $2::uuid and anulado_en is null
      order by created_at desc`,
    [tipo, entidadId],
  );
  return rows.map(aAdjunto);
}

export async function createAdjunto(
  client: PoolClient,
  scope: DbSession,
  input: NuevoAdjunto,
): Promise<Adjunto> {
  if (!puedeEditarAdjuntos(scope.rolCodigo)) {
    throw new ApiError(403, "Sin permiso para adjuntar archivos.", "SIN_PERMISO");
  }

  const tipo = validarEntidad(input.entidadTipo, input.entidadId);
  const nombre = input.nombre.trim();
  if (!nombre || nombre.length > 255) {
    throw new ApiError(
      422,
      "El nombre del adjunto es obligatorio (máximo 255 caracteres).",
      "NOMBRE_INVALIDO",
    );
  }

  const mime = await mimePermitido(client, nombre, input.mime);
  const contenido = decodificarBase64(input.contenidoBase64);
  const hash = createHash("sha256").update(contenido).digest("hex");

  const { rows } = await client.query<FilaAdjunto>(
    `insert into core.adjunto
        (entidad_tipo, entidad_id, nombre, mime, tamano_bytes, contenido,
         hash_sha256, descripcion, subido_por)
     values ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid)
     returning id, entidad_tipo, entidad_id, nombre, mime, tamano_bytes,
               hash_sha256, descripcion, subido_por, created_at`,
    [
      tipo,
      input.entidadId,
      nombre,
      mime,
      contenido.length,
      contenido,
      hash,
      input.descripcion?.trim() || null,
      scope.usuarioId,
    ],
  );

  return aAdjunto(rows[0]);
}

export async function getAdjuntoContenido(
  client: PoolClient,
  id: string,
): Promise<AdjuntoContenido | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await client.query<{
    id: string;
    nombre: string;
    mime: string | null;
    contenido: Buffer | null;
    tamano_bytes: string | number | null;
  }>(
    `select id, nombre, mime, contenido, tamano_bytes
       from core.adjunto
      where id = $1::uuid and anulado_en is null`,
    [id],
  );
  const fila = rows[0];
  if (!fila || !fila.contenido) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    mime: fila.mime,
    contenido: fila.contenido,
    tamanoBytes:
      fila.tamano_bytes === null ? fila.contenido.length : Number(fila.tamano_bytes),
  };
}

export async function deleteAdjunto(
  client: PoolClient,
  scope: DbSession,
  id: string,
  motivo: string,
): Promise<void> {
  if (!puedeEditarAdjuntos(scope.rolCodigo)) {
    throw new ApiError(403, "Sin permiso para eliminar adjuntos.", "SIN_PERMISO");
  }
  if (!UUID_RE.test(id)) {
    throw new ApiError(404, "El adjunto no existe.", "NOT_FOUND");
  }

  const { rowCount } = await client.query(
    `update core.adjunto
        set anulado_en = now(), anulado_por = $2::uuid, motivo_anulacion = $3
      where id = $1::uuid and anulado_en is null`,
    [id, scope.usuarioId, motivo.trim()],
  );
  if (rowCount === 0) {
    throw new ApiError(404, "El adjunto no existe.", "NOT_FOUND");
  }
}
