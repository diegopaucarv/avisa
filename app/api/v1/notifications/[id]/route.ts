import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  esEstadoLectura,
  updateNotificationState,
} from "@/lib/db/repos/notifications";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  return parsed as Record<string, unknown>;
}

/**
 * `PATCH /api/v1/notifications/{id}` con `{ estado: 'leida' }` o
 * `{ estado: 'pendiente' }` (deshacer).
 *
 * Sólo el dueño puede marcar la suya; `administrador` y `direccion_oaipcs`
 * pueden marcar cualquiera. Un UUID mal formado, una fila inexistente o una
 * fila de otro usuario responden 404 `NOT_FOUND`. No hay `POST` ni `DELETE`.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);
    const body = await readBody(request);
    const estado = body.estado;

    if (typeof estado !== "string" || !esEstadoLectura(estado)) {
      throw new ApiError(
        422,
        "El estado sólo admite «leida» o «pendiente».",
        "INVALID_INPUT",
      );
    }

    const scope = { usuarioId: session.uid, rolCodigo: session.rol };
    const item = await withSession(scope, (client) =>
      updateNotificationState(client, scope, decoded, estado),
    );

    return jsonOk(item);
  } catch (error) {
    return jsonError(error);
  }
}
