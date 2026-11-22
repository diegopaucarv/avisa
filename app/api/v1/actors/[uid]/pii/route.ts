import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { DEFAULT_PII_MOTIVO, getActorPii } from "@/lib/db/repos/pii";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16 entrega los parámetros de ruta como Promise.
export async function GET(
  request: Request,
  context: { params: Promise<{ uid: string }> },
) {
  try {
    const session = requireSession(request);
    const { uid } = await context.params;
    const actorRef = decodeURIComponent(uid);

    // El motivo lo audita la base; si llega vacío se usa el valor por defecto.
    const motivo = queryParams(request).get("motivo") ?? DEFAULT_PII_MOTIVO;

    const pii = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getActorPii(client, actorRef, motivo),
    );

    if (!pii) {
      throw new ApiError(404, "El actor no existe.", "NOT_FOUND");
    }

    return jsonOk({ pii, generatedAt: new Date().toISOString() });
  } catch (error) {
    // 42501 y 22023 los traduce jsonError a 403/422.
    return jsonError(error);
  }
}
