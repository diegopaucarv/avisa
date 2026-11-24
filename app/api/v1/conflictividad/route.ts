import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerBooleano,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  listarConflictividad,
  verificarEsquemaConflictividad,
  type ConflictividadListQuery,
} from "@/lib/db/repos/conflictividad";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Filtros que acepta la matriz; se leen tal cual de la query. */
const FILTROS = [
  "region",
  "alcance",
  "subsector",
  "estado",
  "nivel",
  "prioridad",
  "desde",
  "hasta",
  "q",
  "orden",
] as const;

/**
 * Matriz de conflictividad (Anexo 15): una fila por caso abierto, con las
 * diecisiete columnas del mockup más el resumen de manifiestos/latentes.
 *
 * La vista de origen no aplica la RLS, así que el repositorio reaplica la
 * seguridad con un `JOIN core.casos` y descarta el caso anulado. Si falta una
 * pieza del esquema, el repositorio corta con 503 `ESQUEMA_PENDIENTE` antes de
 * devolver nada: no se inventan filas de relleno.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: ConflictividadListQuery = {
      page,
      pageSize,
      todas: leerBooleano(params.get("todas")),
    };
    for (const key of FILTROS) {
      const valor = params.get(key);
      if (valor) query[key] = valor;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        await verificarEsquemaConflictividad(client);
        return listarConflictividad(client, query);
      },
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
