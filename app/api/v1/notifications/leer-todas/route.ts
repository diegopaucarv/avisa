import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { markAllNotificationsRead } from "@/lib/db/repos/notifications";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/notifications/leer-todas`.
 *
 * Marca como leídos todos los avisos sin leer del alcance de la sesión (los
 * propios o la bandeja completa para `administrador` y `direccion_oaipcs`) y
 * responde `{ actualizadas }`. Es idempotente: sin pendientes devuelve `0`.
 *
 * La ruta estática `leer-todas` gana a `[id]`, así que no hay colisión con
 * `POST /notifications/{id}/leer`.
 */
export async function POST(request: Request) {
  try {
    const session = requireSession(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const result = await withSession(scope, (client) =>
      markAllNotificationsRead(client, scope),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
