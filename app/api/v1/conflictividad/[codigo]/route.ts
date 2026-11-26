import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  obtenerConflictividadPorCodigo,
  verificarEsquemaConflictividad,
} from "@/lib/db/repos/conflictividad";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 entrega los parámetros de ruta como Promise.
export async function GET(
  request: Request,
  context: { params: Promise<{ codigo: string }> },
) {
  try {
    const session = requireSession(request);
    const { codigo } = await context.params;
    const decoded = decodeURIComponent(codigo);

    const detalle = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        await verificarEsquemaConflictividad(client);
        return obtenerConflictividadPorCodigo(client, decoded);
      },
    );

    if (!detalle) {
      throw new ApiError(
        404,
        "El caso no existe o no está disponible para su rol.",
        "NOT_FOUND",
      );
    }

    return jsonOk(detalle);
  } catch (error) {
    return jsonError(error);
  }
}
