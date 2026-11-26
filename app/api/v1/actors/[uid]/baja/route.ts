import { jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import { bajaActor, type ActorScope } from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Baja lógica de un actor: `core.actores.activo = false`.
 *
 * El registro y sus vínculos se conservan (la ficha sigue consultable y la
 * acción es reversible con `/restaurar`). Exige motivo (mínimo 10 caracteres),
 * aceptado por `?motivo=` o `{ motivo }` en el cuerpo.
 *
 * Es un UPDATE, no un DELETE: la RLS de `core.actores` pide `puede_editar`, de
 * modo que `direccion_oaipcs` también puede darse de baja sin tener
 * `puede_eliminar`.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const session = requireSession(request);
    const { uid } = await context.params;
    const actorRef = decodeURIComponent(uid);
    const motivo = await leerMotivo(request);

    const scope: ActorScope = {
      usuarioId: session.uid,
      rolCodigo: session.rol,
      roles: session.roles,
    };

    const actor = await withSession(scope, (client) =>
      bajaActor(client, scope, actorRef, motivo),
    );

    return jsonOk(actor);
  } catch (error) {
    return jsonError(error);
  }
}
