import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { getCommitmentsSummary } from "@/lib/db/repos/commitments";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resumen operativo de compromisos (Guía §8.3.2).
 *
 * `GET` devuelve un sobre de conteos, no filas: cuántos compromisos e hitos
 * vigentes hay, cuántos hitos tienen fecha y cuántos están cumplidos. La vista
 * lo usa para pintar los indicadores sin traer el listado completo.
 *
 * El plazo se mide por hitos porque `core.compromisos` no guarda una fecha de
 * vencimiento propia: un compromiso "con plazo" es el que tiene al menos un
 * hito vigente con `fecha_vencimiento`. Los agregados se calculan dentro de
 * `withSession`, así que la RLS de compromisos e hitos se aplica igual que en
 * el listado.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);

    const summary = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getCommitmentsSummary(client),
    );

    return jsonOk(summary);
  } catch (error) {
    return jsonError(error);
  }
}
