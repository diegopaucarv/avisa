import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import {
  deleteCommitment,
  getCommitmentById,
  updateCommitment,
} from "@/lib/db/repos/commitments";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 entrega los parámetros de ruta como Promise.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const detail = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getCommitmentById(client, decoded),
    );

    if (!detail) {
      throw new ApiError(404, "El compromiso no existe.", "NOT_FOUND");
    }

    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
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
      updateCommitment(client, ctx, decoded, body),
    );

    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const motivo = await leerMotivo(request);
    await withSession(ctx, (client) =>
      deleteCommitment(client, ctx, decoded, motivo),
    );

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
