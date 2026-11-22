import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  listReportes,
  type ReporteListQuery,
} from "@/lib/db/repos/reportes";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = ["q", "tipo", "region", "desde", "hasta"] as const;

/**
 * Registro de reportes (Anexo N° 17). Sólo lectura: lista la vista
 * `analytics.vw_anexo_17_registro_reportes` con paginación de servidor.
 *
 * El contexto de seguridad va en `withSession`, igual que en el resto de
 * repos; tras la migración 23 la vista es `security_invoker` y respeta la RLS
 * de las tablas base.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: ReporteListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listReportes(client, query),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
