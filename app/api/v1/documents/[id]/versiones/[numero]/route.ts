import { NextResponse } from "next/server";

import { jsonError } from "@/lib/db/errors";
import { requireSession } from "@/lib/db/http";
import { getDocumentVersionArchivo } from "@/lib/db/repos/documents";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/documents/:id/versiones/:numero` → binario de esa versión.
 *
 * Es, junto con la descarga del archivo vigente, el único punto que lee el
 * `bytea` de `core.documento_version`.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; numero: string }> },
) {
  try {
    const session = requireSession(request);
    const { id, numero } = await context.params;
    const version = Number(numero);

    const fila = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) =>
        getDocumentVersionArchivo(
          client,
          decodeURIComponent(id),
          Number.isFinite(version) ? Math.trunc(version) : -1,
        ),
    );

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
