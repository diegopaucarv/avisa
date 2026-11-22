import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { listNotifications } from "@/lib/db/repos/notifications";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = requireSession(request);

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) =>
        listNotifications(client, {
          usuarioId: session.uid,
          rolCodigo: session.rol,
        }),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
