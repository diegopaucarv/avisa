import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { listarParticipantesReunion } from "@/lib/db/repos/resultados";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/reuniones/{id}/participantes`
 *
 * Devuelve `{ items: [{ actorId, nombre, cargo, organizacion, asistencia,
 * tieneTelefono }], reunion: {...} }`. `tieneTelefono` es METADATO
 * (`telefono_cifrado is not null`); el número nunca sale de aquí. La SPA pide
 * los teléfonos con `POST /api/v1/actors/pii` y el motivo «Enviar mensaje».
 *
 * `reunion.programada` acompaña a la lista porque el listado general
 * (`/v1/resultados/reuniones`) no expone esa columna y la vista necesita saber
 * si ofrecer «Iniciar la reunión ahora».
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const resultado = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listarParticipantesReunion(client, decoded),
    );

    return jsonOk(resultado);
  } catch (error) {
    return jsonError(error);
  }
}
