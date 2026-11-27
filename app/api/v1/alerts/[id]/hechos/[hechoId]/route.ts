import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import {
  deleteHecho,
  updateHecho,
  type HechoScope,
} from "@/lib/db/repos/alerts-hechos";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string; hechoId: string }> };

async function leerCuerpo(request: Request): Promise<Record<string, unknown>> {
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

/** Edición de un hecho: sólo `fecha` y `descripcion`. */
export async function PATCH(request: Request, context: Contexto) {
  try {
    const session = requireSession(request);
    const { id, hechoId } = await context.params;
    const decodedAlerta = decodeURIComponent(id);
    const decodedHecho = decodeURIComponent(hechoId);
    const body = await leerCuerpo(request);
    const scope: HechoScope = {
      usuarioId: session.uid,
      rolCodigo: session.rol,
    };

    const hecho = await withSession(scope, (client) =>
      updateHecho(client, scope, decodedAlerta, decodedHecho, body),
    );

    return jsonOk(hecho);
  } catch (error) {
    return jsonError(error);
  }
}

/** Baja lógica con motivo obligatorio (`?motivo=` o `{ motivo }`). */
export async function DELETE(request: Request, context: Contexto) {
  try {
    const session = requireSession(request);
    const { id, hechoId } = await context.params;
    const decodedAlerta = decodeURIComponent(id);
    const decodedHecho = decodeURIComponent(hechoId);
    const scope: HechoScope = {
      usuarioId: session.uid,
      rolCodigo: session.rol,
    };
    const motivo = await leerMotivo(request);

    await withSession(scope, (client) =>
      deleteHecho(client, scope, decodedAlerta, decodedHecho, motivo),
    );

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
