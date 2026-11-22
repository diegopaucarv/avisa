import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { restoreCase } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 entrega los parámetros de ruta como Promise.
export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const session = requireSession(request);
    const { code } = await context.params;
    const decoded = decodeURIComponent(code);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    // La papelera se abre sólo para que el prefetch encuentre el caso anulado;
    // la escritura sigue por core.restaurar_caso (SECURITY DEFINER).
    await withSession(scope, (client) => restoreCase(client, decoded), {
      verAnulados: true,
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
