import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { archiveAlert, unarchiveAlert } from "@/lib/db/repos/alerts";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Archivo de alertas sin caso.
 *
 * `POST` archiva con `{ motivo }`; `DELETE` quita la marca de archivo. Archivar
 * no es anular: no toca `anulado_en` ni el estado derivado, y la alerta sigue
 * existiendo y consultándose con `GET /v1/alerts?archivados=true`.
 */
async function leerMotivoArchivo(request: Request): Promise<string> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  const motivo = (parsed as Record<string, unknown>).motivo;
  if (typeof motivo !== "string" || !motivo.trim()) {
    throw new ApiError(
      400,
      "El motivo del archivo es obligatorio.",
      "MOTIVO_REQUERIDO",
    );
  }
  return motivo.trim();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);
    const motivo = await leerMotivoArchivo(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const detail = await withSession(scope, (client) =>
      archiveAlert(client, scope, decoded, motivo),
    );

    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const detail = await withSession(scope, (client) =>
      unarchiveAlert(client, scope, decoded),
    );

    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}
