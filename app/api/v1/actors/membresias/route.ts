import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { listMembresiasDeActores } from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Membresías vigentes de un lote de actores (`?actorIds=a,b,c`).
 *
 * Las tablas del directorio piden la página entera en una sola petición, igual
 * que las fotos con `/v1/media`. Un actor sin vínculo vigente simplemente no
 * aparece: la interfaz declara el dato ausente, no lo inventa.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const actorIds = (params.get("actorIds") ?? params.get("actor_ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const items = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listMembresiasDeActores(client, actorIds),
    );

    return jsonOk({
      items,
      total: items.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
