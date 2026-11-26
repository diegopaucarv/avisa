import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  listarMatriz,
  verificarEsquemaMatriz,
  type MatrizListQuery,
} from "@/lib/db/repos/matriz";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Filtros que acepta la matriz; se leen tal cual de la query. */
const FILTROS = ["region", "caso", "estado", "q"] as const;

/**
 * Matriz de conflictos del equipo (Anexo 15 × Anexo 14) en el formato A..W.
 *
 * Una fila por compromiso × hito. Si falta la migración 45 (o la 41), el
 * repositorio corta con 503 `ESQUEMA_PENDIENTE` antes de devolver nada: no se
 * inventan filas de relleno.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: MatrizListQuery = { page, pageSize };
    for (const key of FILTROS) {
      const valor = params.get(key);
      if (valor) query[key] = valor;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        await verificarEsquemaMatriz(client);
        return listarMatriz(client, query);
      },
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
