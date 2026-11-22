import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { restoreDemanda } from "@/lib/db/repos/demandas";
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

    // La papelera se abre sólo para que el prefetch encuentre la demanda anulada;
    // la escritura sigue por core.restaurar_registro (SECURITY DEFINER).
    await withSession(scope, (client) => restoreDemanda(client, decoded), {
      verAnulados: true,
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
