import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { deleteDemanda, updateDemanda } from "@/lib/db/repos/demandas";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Next 16 entrega los parámetros de ruta como Promise.
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const detail = await withSession(ctx, (client) =>
      updateDemanda(client, ctx, decoded, body),
    );

    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    await withSession(ctx, (client) =>
      deleteDemanda(client, ctx, decoded),
    );

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
