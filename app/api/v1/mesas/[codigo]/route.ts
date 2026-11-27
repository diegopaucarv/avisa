import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { getMesaDetalle } from "@/lib/db/repos/mesas";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ficha de una mesa de diálogo por su código (`OAIPCS-001`).
 *
 * Devuelve `{ mesa, caso, integrantes, compromisos }`. `caso` es `null` mientras
 * la migración 81 no haya vinculado la mesa con su caso espejo, y en ese caso
 * `compromisos` viene vacío: la ficha declara la ausencia en vez de inventarla.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ codigo: string }> },
) {
  try {
    const session = requireSession(request);
    // Next 16 entrega los parámetros de ruta como Promise.
    const { codigo } = await context.params;
    const decoded = decodeURIComponent(codigo);

    const detalle = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getMesaDetalle(client, decoded),
    );

    if (!detalle) {
      throw new ApiError(404, "La mesa no existe.", "NOT_FOUND");
    }

    return jsonOk(detalle);
  } catch (error) {
    return jsonError(error);
  }
}
