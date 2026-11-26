import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { listCaseNudos } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Historial completo de nudos críticos del expediente, agrupado por el periodo
 * real de cada semana y en orden descendente (más reciente primero).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const session = requireSession(request);
    const { code } = await context.params;
    const decoded = decodeURIComponent(code);

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listCaseNudos(client, decoded),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
