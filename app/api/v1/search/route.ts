import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { searchAll } from "@/lib/db/repos/search";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asLimit(value: string | null): number | undefined {
  if (!value || !/^\d{1,2}$/.test(value)) return undefined;
  return Number(value);
}

export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const term = (params.get("q") ?? "").trim();
    if (term.length < 2) {
      throw new ApiError(
        422,
        "El término de búsqueda es demasiado corto.",
        "INVALID_QUERY",
      );
    }

    const { page, pageSize: aliasSize } = leerPagina(params);

    // `limit`/`limitPerType` siguen funcionando como tamaño de página si no
    // llega una grafía de tamaño; los alias españoles tienen prioridad.
    const legacy = asLimit(params.get("limit") ?? params.get("limitPerType"));
    const explicitSize = params.get("tamano") ?? params.get("pageSize");
    const pageSize =
      explicitSize === null && legacy !== undefined
        ? Math.min(100, Math.max(1, legacy))
        : aliasSize;

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => searchAll(client, term, page, pageSize),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
