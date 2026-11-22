import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { getActorById } from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 entrega los parámetros de ruta como Promise.
export async function GET(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const session = requireSession(request);
    const { uid } = await context.params;
    const decoded = decodeURIComponent(uid);

    const actor = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getActorById(client, decoded),
    );

    if (!actor) {
      throw new ApiError(404, "El actor no existe.", "NOT_FOUND");
    }

    return jsonOk(actor);
  } catch (error) {
    return jsonError(error);
  }
}
