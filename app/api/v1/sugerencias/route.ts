import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  createSugerencia,
  listSugerencias,
  type SugerenciaListQuery,
} from "@/lib/db/repos/sugerencias";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Filtros que acepta el listado (también los reenvía la exportación). */
const FILTROS_SUGERENCIAS = [
  "q",
  "caso",
  "entidad",
  "region",
  "territorio",
  "estado",
  "prioridad",
  "tipo",
  "sort",
] as const;

/**
 * Matriz de sugerencias de intervención.
 *
 * `GET` devuelve el sobre paginado de siempre (`items`, `total`, `page`,
 * `pageSize`, más `pagina`/`tamanoPagina`) y acepta los filtros por caso,
 * entidad (caso/territorio), región, territorio, estado, prioridad y tipo,
 * además del orden (`sort=campo` o `sort=-campo`).
 *
 * `POST` da de alta una sugerencia. El título es obligatorio; si la entidad es
 * un caso, el caso debe existir; si es un territorio, debe declarar al menos
 * una región, provincia, distrito o un texto de territorio. El código
 * correlativo (`SUG-AAAA-0001`) lo genera el servidor.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: SugerenciaListQuery = { page, pageSize };
    for (const key of FILTROS_SUGERENCIAS) {
      const value = params.get(key)?.trim();
      if (value) query[key] = value;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listSugerencias(client, query),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const detail = await withSession(ctx, (client) =>
      createSugerencia(client, ctx, body),
    );

    return jsonOk(detail, 201);
  } catch (error) {
    return jsonError(error);
  }
}
