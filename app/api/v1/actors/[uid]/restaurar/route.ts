import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { restaurarActor, type ActorScope } from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Restauración de un actor dado de baja lógica: `core.actores.activo = true`.
 *
 * No requiere cuerpo; el motivo del alta queda fijo en la auditoría. La acción
 * es el inverso de `/baja` y la RLS exige sólo `puede_editar`.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const session = requireSession(request);
    const { uid } = await context.params;
    const actorRef = decodeURIComponent(uid);

    const scope: ActorScope = {
      usuarioId: session.uid,
      rolCodigo: session.rol,
      roles: session.roles,
    };

    const actor = await withSession(scope, (client) =>
      restaurarActor(client, scope, actorRef),
    );

    return jsonOk(actor);
  } catch (error) {
    return jsonError(error);
  }
}
