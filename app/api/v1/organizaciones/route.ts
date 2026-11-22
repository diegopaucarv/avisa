import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  listOrganizaciones,
  type OrganizacionListQuery,
} from "@/lib/db/repos/organizaciones";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = ["q", "tipo", "activo", "vigente", "sort"] as const;

// Sólo lectura: este directorio no expone POST/PATCH/DELETE.

export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: OrganizacionListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listOrganizaciones(client, query),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
