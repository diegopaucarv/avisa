import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { markNotificationRead } from "@/lib/db/repos/notifications";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/notifications/{id}/leer`.
 *
 * Atajo del `PATCH /notifications/{id}` con `{ estado: 'leida' }`: marca el
 * aviso como leído y fija `leido_en` (sin reescribirlo si ya estaba leído).
 *
 * Sólo el dueño puede marcar la suya; `administrador` y `direccion_oaipcs`
 * pueden marcar cualquiera. Un UUID mal formado, una fila inexistente o una
 * fila de otro usuario responden 404 `NOT_FOUND`. No lleva cuerpo.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const scope = { usuarioId: session.uid, rolCodigo: session.rol };
    const item = await withSession(scope, (client) =>
      markNotificationRead(client, scope, decoded),
    );

    return jsonOk(item);
  } catch (error) {
    return jsonError(error);
  }
}
