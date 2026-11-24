import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  getActorById,
  updateActor,
  type ActorScope,
} from "@/lib/db/repos/actors";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 entrega los parámetros de ruta como Promise.
async function readActorUpdateBody(
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

export async function GET(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const session = requireSession(request);
    const { uid } = await context.params;
    const decoded = decodeURIComponent(uid);

    const actor = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getActorById(client, decoded, session.roles),
    );

    if (!actor) {
      throw new ApiError(404, "El actor no existe.", "NOT_FOUND");
    }

    return jsonOk(actor);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const session = requireSession(request);
    const { uid } = await context.params;
    const decoded = decodeURIComponent(uid);
    const body = await readActorUpdateBody(request);
    const scope: ActorScope = {
      usuarioId: session.uid,
      rolCodigo: session.rol,
      roles: session.roles,
    };

    const actor = await withSession(scope, (client) =>
      updateActor(client, scope, decoded, body),
    );

    return jsonOk(actor);
  } catch (error) {
    return jsonError(error);
  }
}
