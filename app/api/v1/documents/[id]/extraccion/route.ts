import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  listDocumentExtracciones,
  runDocumentExtraccion,
} from "@/lib/db/repos/documents";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET  /api/v1/documents/:id/extraccion` → última extracción de cada tipo.
 * `POST /api/v1/documents/:id/extraccion` con `{ tipo: "ocr" | "temas" }`.
 *
 * Sin motor de OCR configurado (`AVISA_OCR_ENDPOINT`), `ocr` se registra con
 * estado `no_disponible` y un mensaje honesto: no se inventa texto. `temas`
 * calcula frecuencias locales sobre el texto OCR o sobre `resumen_ejecutivo` y
 * declara el método (`origen` / `modelo`).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;

    const items = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listDocumentExtracciones(client, decodeURIComponent(id)),
    );

    return jsonOk({ items, total: items.length });
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }
    const tipo = (body as Record<string, unknown>).tipo;
    if (typeof tipo !== "string") {
      throw new ApiError(
        422,
        "El tipo de extracción debe ser «ocr» o «temas».",
        "TIPO_INVALIDO",
      );
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const item = await withSession(ctx, (client) =>
      runDocumentExtraccion(client, ctx, decodeURIComponent(id), tipo),
    );

    return jsonOk(item);
  } catch (error) {
    return jsonError(error);
  }
}
