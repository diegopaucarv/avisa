import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { listarActoresCaso, vincularActorCaso } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Actores vinculados al caso, con su vínculo vigente y su baja lógica.
 *
 * Acepta `sort`: `contacto` ordena por teléfono y luego correo; cualquier otra
 * cosa —o su ausencia— conserva el orden por nombre.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const session = requireSession(request);
    const { code } = await context.params;
    const decoded = decodeURIComponent(code);
    const sort = queryParams(request).get("sort") ?? undefined;

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listarActoresCaso(client, decoded, sort),
    );

    return jsonOk(result);
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

/**
 * Alta de actor en el caso. `posicion` y `nivelInfluencia` son obligatorios
 * mientras la base los declare NOT NULL: nunca se asume «Neutral» ni 50.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const session = requireSession(request);
    const { code } = await context.params;
    const decoded = decodeURIComponent(code);
    const body = await readBody(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const result = await withSession(scope, (client) =>
      vincularActorCaso(client, scope, decoded, body),
    );

    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}
