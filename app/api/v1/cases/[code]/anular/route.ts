import { jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import { anularCase } from "@/lib/db/repos/cases";
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
    const motivo = await leerMotivo(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const result = await withSession(scope, (client) =>
      anularCase(client, scope, decoded, motivo),
    );

    return jsonOk({ ok: true, anulacionId: result.anulacionId });
  } catch (error) {
    return jsonError(error);
  }
}
