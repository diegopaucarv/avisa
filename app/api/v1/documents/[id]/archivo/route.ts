import { NextResponse } from "next/server";

import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  getDocumentArchivo,
  saveDocumentArchivo,
} from "@/lib/db/repos/documents";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET  /api/v1/documents/:id/archivo` → binario del documento vigente.
 * `POST /api/v1/documents/:id/archivo` → sube o reemplaza el binario.
 *
 * El `GET` es el único punto (junto con la descarga de versiones) que lee
 * `core.documentos.contenido`; los listados nunca lo seleccionan. El `POST`
 * acepta `{ nombre, mime?, nota?, contenidoBase64 }`, valida contra
 * `core.documento_lista_blanca`, calcula el SHA-256 y versiona el archivo
 * anterior antes de sobrescribirlo.
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
      (client) => getDocumentArchivo(client, decodeURIComponent(id)),
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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const detail = await withSession(ctx, (client) =>
      saveDocumentArchivo(client, ctx, decodeURIComponent(id), body),
    );

    return jsonOk(detail);
  } catch (error) {
    return jsonError(error);
  }
}
