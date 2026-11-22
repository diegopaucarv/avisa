import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import { deleteHito, updateHito } from "@/lib/db/repos/commitments";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; hitoId: string }> };

// Next 16 entrega los parámetros de ruta como Promise.
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = requireSession(request);
    const { id, hitoId } = await context.params;
    const decodedId = decodeURIComponent(id);
    const decodedHitoId = decodeURIComponent(hitoId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const hito = await withSession(ctx, (client) =>
      updateHito(client, ctx, decodedId, decodedHitoId, body),
    );

    return jsonOk(hito);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = requireSession(request);
    const { id, hitoId } = await context.params;
    const decodedId = decodeURIComponent(id);
    const decodedHitoId = decodeURIComponent(hitoId);

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const motivo = await leerMotivo(request);
    await withSession(ctx, (client) =>
      deleteHito(client, ctx, decodedId, decodedHitoId, motivo),
    );

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
