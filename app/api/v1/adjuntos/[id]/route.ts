import { NextResponse } from "next/server";

import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import { deleteAdjunto, getAdjuntoContenido } from "@/lib/db/repos/adjuntos";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/adjuntos/:id` devuelve el binario.
 * `DELETE /api/v1/adjuntos/:id` exige motivo (borrado lógico).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;

    const fila = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getAdjuntoContenido(client, decodeURIComponent(id)),
    );

    if (!fila) {
      throw new ApiError(404, "El adjunto no existe.", "NOT_FOUND");
    }

    return new NextResponse(fila.contenido as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": fila.mime ?? "application/octet-stream",
        "Content-Length": String(fila.contenido.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fila.nombre)}`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
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
    const motivo = await leerMotivo(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    await withSession(scope, (client) =>
      deleteAdjunto(client, scope, decodeURIComponent(id), motivo),
    );

    return jsonOk({ id: decodeURIComponent(id), anulado: true });
  } catch (error) {
    return jsonError(error);
  }
}
