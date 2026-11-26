import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { listDocumentVersions } from "@/lib/db/repos/documents";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/documents/:id/versiones` → historial de versiones.
 *
 * Devuelve sólo metadatos (número, MIME, tamaño, hash, fecha y autor); el
 * binario de cada versión se pide aparte a
 * `GET /api/v1/documents/:id/versiones/:numero`.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;

    const items = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listDocumentVersions(client, decodeURIComponent(id)),
    );

    return jsonOk({ items, total: items.length });
  } catch (error) {
    return jsonError(error);
  }
}
