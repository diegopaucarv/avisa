import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { getAutoridad } from "@/lib/db/repos/autoridades";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ficha de una autoridad o agente con sus casos vinculados.
 *
 * No descifra PII: abrir la ficha no registra un acceso a datos personales que
 * nadie pidió. El DNI y el teléfono salen por
 * `GET /api/v1/autoridades/:id/pii`, con motivo auditado.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const ref = decodeURIComponent(id);

    const detalle = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getAutoridad(client, ref),
    );

    if (!detalle) {
      throw new ApiError(
        404,
        "La autoridad no existe en el directorio.",
        "NOT_FOUND",
      );
    }

    return jsonOk(detalle);
  } catch (error) {
    return jsonError(error);
  }
}
