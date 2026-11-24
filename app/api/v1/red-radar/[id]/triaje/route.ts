import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { registrarTriaje } from "@/lib/db/repos/red-radar";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Registra (o rehace) el triaje de una alerta de la cola.
 *
 * Cuerpo: `{ estado, motivo?, duplicadaDeCodigo? }`.
 * - `estado` es obligatorio y debe ser uno de los cinco del CHECK de
 *   `core.alerta_triaje`.
 * - `motivo` es obligatorio cuando el estado es `descartada` o `duplicada`.
 * - `duplicadaDeCodigo` es el código legible de la alerta de la que ésta es
 *   duplicada; si se envía y no existe, responde 422.
 *
 * La fila vive en `core.alerta_triaje` (una por alerta) y el cambio se audita
 * en la misma transacción.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const decoded = decodeURIComponent(id);
    const cuerpo = await leerCuerpo(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const triaje = await withSession(scope, (client) =>
      registrarTriaje(client, scope, decoded, cuerpo),
    );

    return jsonOk(triaje);
  } catch (error) {
    return jsonError(error);
  }
}
