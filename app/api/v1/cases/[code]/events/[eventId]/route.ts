import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, leerMotivo, requireSession } from "@/lib/db/http";
import { deleteCaseEvent, updateCaseEvent } from "@/lib/db/repos/events";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string; eventId: string }> };

/**
 * Campos que `updateCaseEvent` sabe escribir. Se aceptan las mismas grafías
 * (español, camelCase y columna) que ya reconocen las altas de cronología; todo
 * lo demás se descarta antes de llegar al repositorio.
 */
const CAMPOS_EDITABLES = new Set<string>([
  "descripcion",
  "descripcionHecho",
  "descripcion_hecho",
  "fecha",
  "fechaEvento",
  "tipoHecho",
  "tipo_hecho",
  "tipo",
  "evidencia",
  "linkEvidencia",
  "critico",
  "esCritico",
  "validado",
  "esValidado",
]);

async function readBody(request: Request): Promise<Record<string, unknown>> {
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

function soloCamposEditables(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(body)) {
    if (CAMPOS_EDITABLES.has(clave)) cambios[clave] = valor;
  }
  if (Object.keys(cambios).length === 0) {
    throw new ApiError(400, "No hay cambios que guardar.", "SIN_CAMBIOS");
  }
  return cambios;
}

export async function PATCH(request: Request, context: Context) {
  try {
    const session = requireSession(request);
    const { code, eventId } = await context.params;
    const decoded = decodeURIComponent(code);
    const body = await readBody(request);
    const cambios = soloCamposEditables(body);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const item = await withSession(scope, (client) =>
      updateCaseEvent(
        client,
        scope,
        decoded,
        decodeURIComponent(eventId),
        cambios,
      ),
    );

    return jsonOk(item);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = requireSession(request);
    const { code, eventId } = await context.params;
    const decoded = decodeURIComponent(code);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };
    const motivo = await leerMotivo(request);

    await withSession(scope, (client) =>
      deleteCaseEvent(
        client,
        scope,
        decoded,
        decodeURIComponent(eventId),
        motivo,
      ),
    );

    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
