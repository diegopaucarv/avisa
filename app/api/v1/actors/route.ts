import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  createActor,
  listActors,
  type ActorListQuery,
  type ActorScope,
} from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = [
  "q",
  "naturaleza",
  "tipo",
  "region",
  "organizacion",
  "sort",
] as const;

export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: ActorListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listActors(client, query),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
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

/**
 * Alta de actor. La validación (naturaleza, nombre, DNI de 8 dígitos, RUC de 11,
 * fechas OSPA) vive en el repositorio; aquí sólo se exige sesión y cuerpo JSON.
 */
export async function POST(request: Request) {
  try {
    const session = requireSession(request);
    const body = await readJsonBody(request);
    const scope: ActorScope = {
      usuarioId: session.uid,
      rolCodigo: session.rol,
      roles: session.roles,
    };

    const actor = await withSession(scope, (client) =>
      createActor(client, scope, body),
    );

    return jsonOk(actor, 201);
  } catch (error) {
    return jsonError(error);
  }
}
