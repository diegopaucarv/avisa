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
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = ["q", "caso", "tipo", "estado", "sort"] as const;

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

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listDocuments(client, query),
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
