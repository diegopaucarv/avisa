import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { restoreAlert } from "@/lib/db/repos/alerts";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 entrega los parámetros de ruta como Promise.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    await withSession(scope, (client) => restoreAlert(client, decoded));

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
