import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  getSugerenciaById,
  updateSugerencia,
} from "@/lib/db/repos/sugerencias";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 entrega los parámetros de ruta como Promise.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const detail = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getSugerenciaById(client, decoded),
    );

    if (!detail) {
      throw new ApiError(404, "La sugerencia no existe.", "NOT_FOUND");
    }

    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Edición, cambio de estado y asignación en un único `PATCH`.
 *
 * Reglas de decisión: al pasar a un estado decidido se registra la persona de
 * la sesión y la fecha; al rechazar, el motivo es obligatorio; al volver a un
 * estado sin decisión se borra la traza de decisión. El repositorio nunca
 * aplica la sugerencia: sólo guarda lo que la persona decidió.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const detail = await withSession(ctx, (client) =>
      updateSugerencia(client, ctx, decoded, body),
    );

    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}
