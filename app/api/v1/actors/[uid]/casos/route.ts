import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { listCasosDeActor } from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Casos en los que participa un actor (`GET /api/v1/actors/:uid/casos`).
 *
 * Sólo lectura: expone los vínculos de `core.casos_actores` con la región del
 * caso, que el directorio usa para derivar la región del actor cuando su ficha
 * no la declara. No modifica el detalle (`/v1/actors/:uid`), que sigue siendo
 * la fuente de la ficha.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const session = requireSession(request);
    const { uid } = await context.params;
    const actorRef = decodeURIComponent(uid);

    const casos = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listCasosDeActor(client, actorRef),
    );

    if (!casos) {
      throw new ApiError(404, "El actor no existe.", "NOT_FOUND");
    }

    return jsonOk({
      casos,
      total: casos.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
