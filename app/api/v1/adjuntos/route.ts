import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { createAdjunto, listAdjuntos } from "@/lib/db/repos/adjuntos";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/adjuntos?entidadTipo=alerta&entidadId=<uuid>`
 * `POST /api/v1/adjuntos` con `{ entidadTipo, entidadId, nombre, mime?, descripcion?, contenidoBase64 }`
 *
 * El binario viaja en base64 porque el cliente ya lee el archivo con
 * `FileReader`; no se abre un segundo formato multipart que la SPA no usa.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const entidadTipo = params.get("entidadTipo")?.trim() ?? "";
    const entidadId = params.get("entidadId")?.trim() ?? "";

    const items = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listAdjuntos(client, entidadTipo, entidadId),
    );

    return jsonOk({ items, total: items.length });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const scope = { usuarioId: session.uid, rolCodigo: session.rol };
    const item = await withSession(scope, (client) =>
      createAdjunto(client, scope, body as Parameters<typeof createAdjunto>[2]),
    );

    return jsonOk(item, 201);
  } catch (error) {
    return jsonError(error);
  }
}
