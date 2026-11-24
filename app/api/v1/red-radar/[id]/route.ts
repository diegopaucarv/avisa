import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { obtenerDetalle } from "@/lib/db/repos/red-radar";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Detalle de una alerta de la cola RED-RADAR (por uuid o código legible).
 *
 * Reutiliza el contrato de la ficha de alertas (`alerta`, `demandas`) y añade el
 * triaje vigente (`triaje`, `null` si la alerta todavía no se trió).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const detalle = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => obtenerDetalle(client, decoded),
    );

    if (!detalle) {
      throw new ApiError(404, "La alerta no existe.", "NOT_FOUND");
    }

    return jsonOk(detalle);
  } catch (error) {
    return jsonError(error);
  }
}
