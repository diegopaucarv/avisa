import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { matrizDemandasIntervenciones } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Matriz demandas × intervenciones del caso.
 *
 * Cada fila es una demanda; cada columna, una dimensión con vínculo declarado
 * en el esquema (compromisos, hitos, reuniones, nudos, alertas, documentos) o
 * declarada vacía (hechos). Se resuelve en dos sentencias agregadas: no hay
 * consultas por demanda.
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
      (client) => matrizDemandasIntervenciones(client, decoded),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
