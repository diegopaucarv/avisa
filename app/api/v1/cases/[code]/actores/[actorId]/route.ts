import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { desvincularActorCaso } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lee el motivo de la baja si viene, pero no lo exige. Acepta `?motivo=`, el
 * cuerpo JSON `{ motivo }` o ninguno. Devuelve `undefined` cuando no llega.
 */
async function leerMotivoOpcional(
  request: Request,
): Promise<string | undefined> {
  const fromQuery = queryParams(request).get("motivo")?.trim();
  if (fromQuery) return fromQuery;

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const value = (parsed as Record<string, unknown>).motivo;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Baja lógica del actor en el caso. El motivo es opcional (`?motivo=` o
 * `{ motivo }`); si no llega, se registra la baja sin texto. Nunca se borra la
 * relación: se conserva el histórico con autor y fecha.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ code: string; actorId: string }> },
) {
  try {
    const session = requireSession(request);
    const { code, actorId } = await context.params;
    const decoded = decodeURIComponent(code);
    const actor = decodeURIComponent(actorId);
    const motivo = await leerMotivoOpcional(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const result = await withSession(scope, (client) =>
      desvincularActorCaso(client, scope, decoded, actor, motivo),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
