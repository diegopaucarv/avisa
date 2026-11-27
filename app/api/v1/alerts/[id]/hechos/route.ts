import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  createHecho,
  listHechos,
  type HechoScope,
} from "@/lib/db/repos/alerts-hechos";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next entrega los parámetros de ruta como Promise.
type Contexto = { params: Promise<{ id: string }> };

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

/**
 * Hechos recientes de una alerta (`core.alerta_hechos`).
 *
 * La lista se sirve con el mismo sobre `{ items, total }` que los adjuntos, más
 * `inicializada` para que la SPA distinga «nunca tuvo hechos» (usa el texto
 * heredado como respaldo) de «se quitaron todos» (no debe mostrarse nada).
 */
export async function GET(request: Request, context: Contexto) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listHechos(client, decoded),
    );

    return jsonOk({
      items: result.items,
      total: result.items.length,
      inicializada: result.inicializada,
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** Alta de un hecho. La validación de fecha y descripción vive en el repositorio. */
export async function POST(request: Request, context: Contexto) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);
    const body = await leerCuerpo(request);
    const scope: HechoScope = {
      usuarioId: session.uid,
      rolCodigo: session.rol,
    };

    const hecho = await withSession(scope, (client) =>
      createHecho(client, scope, decoded, body),
    );

    return jsonOk(hecho, 201);
  } catch (error) {
    return jsonError(error);
  }
}
