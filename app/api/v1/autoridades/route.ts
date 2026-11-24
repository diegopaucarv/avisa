import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  listAutoridades,
  type AutoridadListQuery,
} from "@/lib/db/repos/autoridades";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = ["q", "tipo", "institucion", "region"] as const;

/**
 * Directorio · Autoridades y agentes (solo lectura).
 *
 * Devuelve el listado paginado, las facetas de los selectores y el criterio
 * aplicado para separar «autoridad» de «agente». No descifra datos personales:
 * el DNI y el teléfono se piden aparte a `/api/v1/autoridades/:id/pii`.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: AutoridadListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listAutoridades(client, query),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
