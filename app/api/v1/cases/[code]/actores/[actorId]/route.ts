import { jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import { desvincularActorCaso } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Baja lógica del actor en el caso. Exige motivo (`?motivo=` o `{ motivo }`) y
 * nunca borra la relación: conserva el histórico con autor y fecha.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ code: string; actorId: string }> },
) {
  try {
    const session = requireSession(request);
    const { code, actorId } = await context.params;
    const decoded = decodeURIComponent(code);
    const actor = decodeURIComponent(actorId);
    const motivo = await leerMotivo(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const result = await withSession(scope, (client) =>
      desvincularActorCaso(client, scope, decoded, actor, motivo),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
