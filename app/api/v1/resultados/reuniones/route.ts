import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { listarReuniones } from "@/lib/db/repos/resultados";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/resultados/reuniones?q=&pagina=1&tamano=25`
 *
 * Reuniones de diálogo para elegir a cuál se le carga la lista de asistencia.
 * Es sólo lectura (`core.reuniones_dialogo` + `core.casos`); el alta y la ficha
 * de reunión siguen en `/api/v1/reuniones`, que este módulo no toca.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);
    const q = params.get("q") ?? undefined;

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listarReuniones(client, { q, page, pageSize }),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
