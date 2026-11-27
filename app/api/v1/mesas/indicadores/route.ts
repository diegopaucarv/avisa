import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { indicadoresDeMesas } from "@/lib/db/repos/mesas-indicadores";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Indicadores agregados de las mesas de diálogo.
 *
 * Devuelve totales, reparto por vigencia/naturaleza/departamento y —sólo si la
 * migración 81 está aplicada— los compromisos e hitos vinculados. El bloque
 * `vinculoDisponible` permite al cliente distinguir «0 compromisos» de «sin
 * vínculo todavía».
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);

    const indicadores = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => indicadoresDeMesas(client),
    );

    return jsonOk(indicadores);
  } catch (error) {
    return jsonError(error);
  }
}
