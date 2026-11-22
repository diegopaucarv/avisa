import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  createCase,
  listCases,
  type CaseListQuery,
} from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = [
  "q",
  "estado",
  "riesgo",
  "prioridad",
  "alcance",
  "tematica",
  "unidad",
  "region",
  "sort",
] as const;

export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: CaseListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listCases(client, query),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }
  return parsed as Record<string, unknown>;
}

export async function POST(request: Request) {
  try {
    const session = requireSession(request);
    const body = await readBody(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const detail = await withSession(scope, (client) =>
      createCase(client, scope, body),
    );

    return jsonOk(detail, 201);
  } catch (error) {
    return jsonError(error);
  }
}
