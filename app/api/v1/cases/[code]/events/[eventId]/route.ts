import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import { deleteCaseEvent, updateCaseEvent } from "@/lib/db/repos/events";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string; eventId: string }> };

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

export async function PATCH(request: Request, context: Context) {
  try {
    const session = requireSession(request);
    const { code, eventId } = await context.params;
    const decoded = decodeURIComponent(code);
    const body = await readBody(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const item = await withSession(scope, (client) =>
      updateCaseEvent(
        client,
        scope,
        decoded,
        decodeURIComponent(eventId),
        body,
      ),
    );

    return jsonOk(item);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = requireSession(request);
    const { code, eventId } = await context.params;
    const decoded = decodeURIComponent(code);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };
    const motivo = await leerMotivo(request);

    await withSession(scope, (client) =>
      deleteCaseEvent(
        client,
        scope,
        decoded,
        decodeURIComponent(eventId),
        motivo,
      ),
    );

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
