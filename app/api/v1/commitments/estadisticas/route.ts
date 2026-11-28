import { jsonError } from "@/lib/db/errors";
import {
  jsonOk,
  leerBooleano,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { getCommitmentsEstadisticas } from "@/lib/db/repos/commitments";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Estadísticas de compromisos (Guía §8.3.2 / C1).
 *
 * `GET` devuelve un sobre de agregados, no filas: conteos por estado, ranking
 * de áreas responsables con su cumplimiento y la situación de plazo medida con
 * `core.hitos_compromiso.fecha_vencimiento`. La vista «Estadísticas» pinta los
 * indicadores y exporta el mismo contenido a CSV.
 *
 * Se calcula dentro de `withSession`, así que la RLS de compromisos e hitos se
 * aplica igual que en el listado y el resumen; la ruta nunca usa un cliente con
 * rol elevado ni un pool propio.
 *
 * `soloMesas=1` limita los agregados a los compromisos cuyo caso está enlazado
 * a una mesa de diálogo (`core.mesas_dialogo.caso_id`, migración 81). Mismo
 * contrato que en `GET /api/v1/commitments`; sin el parámetro no cambia nada.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);

    const soloMesas = leerBooleano(queryParams(request).get("soloMesas"));

    const estadisticas = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getCommitmentsEstadisticas(client, { soloMesas }),
    );

    return jsonOk(estadisticas);
  } catch (error) {
    return jsonError(error);
  }
}
