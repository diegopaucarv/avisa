import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  createDocument,
  listDocuments,
  type DocumentListQuery,
} from "@/lib/db/repos/documents";
import { puedeAnularRegistros, withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = ["q", "caso", "tipo", "estado", "sort"] as const;

/**
 * Booleano tolerante para la query: acepta `true/1/si/sí/on` y
 * `false/0/no/off`; cualquier otro valor (o su ausencia) cuenta como `false`.
 */
function leerBooleano(value: string | null): boolean {
  if (!value) return false;
  return ["true", "1", "si", "sí", "on"].includes(value.trim().toLowerCase());
}

/**
 * Documentos (Anexo 16).
 *
 * `GET` devuelve el sobre paginado (`items`, `total`, `page`, `pageSize`, más
 * los alias `pagina`/`tamanoPagina`) y acepta los filtros `q`, `caso`, `tipo`,
 * `estado` y `sort`.
 *
 * `anulados=true` lista la **papelera** (documentos anulados). Sólo se sirve a
 * un rol con capacidad de anulación; si no la tiene, responde 403. La consulta
 * se ejecuta con `verAnulados: true` para que la RLS de `core.documentos`
 * deje pasar las filas anuladas. El parámetro acepta un booleano tolerante
 * (`true/1/si/sí/on`); la ausencia o cualquier otro valor equivale a `false`.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: DocumentListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const anulados = leerBooleano(params.get("anulados"));
    if (anulados) {
      if (!puedeAnularRegistros(session.roles)) {
        throw new ApiError(
          403,
          "Sin permiso para consultar registros anulados.",
        );
      }
      query.incluirAnulados = true;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listDocuments(client, query),
      { verAnulados: anulados },
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
      createDocument(client, ctx, body),
    );

    return jsonOk(detail, 201);
  } catch (error) {
    return jsonError(error);
  }
}
