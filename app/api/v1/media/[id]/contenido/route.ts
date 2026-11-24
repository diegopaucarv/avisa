import { createHash } from "node:crypto";

import { ApiError, jsonError } from "@/lib/db/errors";
import { requireSession } from "@/lib/db/http";
import { leerContenidoMedio } from "@/lib/db/repos/media";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/media/<id>/contenido` — sirve los bytes de una fotografía.
 *
 * Es el respaldo servible de las imágenes del directorio: la migración 46
 * guarda una copia en `core.medios.contenido` (excepción aprobada al criterio
 * «no se guardan binarios» de la 41) porque el archivo estático vive en
 * `angular/public/medios/`, que no está versionado.
 *
 * Contrato:
 *   · 200 — bytes con `Content-Type`, `ETag` y caché inmutable de un año.
 *   · 304 — `If-None-Match` coincide con el `ETag`.
 *   · 404 — no hay fila visible (RLS/permisos), está anulada o no tiene bytes.
 *
 * El acceso es el mismo que el del listado: sesión firmada y la RLS de
 * `core.medios` (nivel de clasificación del rol, `anulado_en is null`).
 */

const CACHE_INMUTABLE = "public, max-age=31536000, immutable";
const TIPO_POR_DEFECTO = "application/octet-stream";

/**
 * `ETag` fuerte a partir del `hash` guardado. Si la fila no lo tiene (carga
 * hecha por otro proceso), se calcula sobre los bytes para no perder la
 * validación de caché.
 */
function etagDe(hash: string | null, contenido: Buffer): string {
  const valor = hash ?? createHash("sha256").update(contenido).digest("hex");
  return `"${valor}"`;
}

/**
 * Compara `If-None-Match` con el `ETag` actual. Acepta listas separadas por
 * coma, el comodín `*` y la forma débil (`W/"..."`), aunque el servidor emite
 * un `ETag` fuerte.
 */
function coincideEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const valor = ifNoneMatch.trim();
  if (valor === "*") return true;
  return valor
    .split(",")
    .some((candidato) => candidato.trim().replace(/^W\//, "") === etag);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const medio = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => leerContenidoMedio(client, decoded),
    );

    if (!medio) {
      throw new ApiError(
        404,
        "El medio no tiene contenido almacenado.",
        "NOT_FOUND",
      );
    }

    const etag = etagDe(medio.hash, medio.contenido);
    const cabecerasComunes: Record<string, string> = {
      "Cache-Control": CACHE_INMUTABLE,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    };

    if (coincideEtag(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers: cabecerasComunes });
    }

    // Copia a un `Uint8Array` respaldado por `ArrayBuffer` para que el cuerpo
    // cumpla el tipo de `Response` sin recurrir a `any`; el tamaño es el de una
    // fotografía, así que la copia es despreciable.
    const cuerpo = new Uint8Array(medio.contenido.byteLength);
    cuerpo.set(medio.contenido);

    return new Response(cuerpo, {
      status: 200,
      headers: {
        ...cabecerasComunes,
        "Content-Type": medio.contentType ?? TIPO_POR_DEFECTO,
        "Content-Length": String(medio.contenido.byteLength),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
