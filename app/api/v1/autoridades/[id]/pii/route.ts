import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { getAutoridad } from "@/lib/db/repos/autoridades";
import { DEFAULT_PII_MOTIVO, getActorPii } from "@/lib/db/repos/pii";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descifrado de DNI, correo y teléfono de una autoridad o agente, con motivo
 * auditado (`core.actor_datos_personales_descifrar`).
 *
 * Resultados que la UI pinta distinto:
 * - 200 con `tieneFicha: true`: hay fila de datos personales.
 * - 200 con `tieneFicha: false`: la ficha existe pero no registró PII.
 * - 403: el rol de la sesión no autoriza PII.
 * - 404: el id no pertenece al universo de la pantalla.
 * - 503: falta la clave de cifrado en el servidor.
 *
 * Se comprueba primero que el id sea del universo (Actor público) para no
 * ampliar el alcance del descifrado más allá de esta pantalla.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireSession(request);
    const { id } = await context.params;
    const ref = decodeURIComponent(id);

    const motivo = queryParams(request).get("motivo") ?? DEFAULT_PII_MOTIVO;

    const pii = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        const detalle = await getAutoridad(client, ref);
        if (!detalle) return null;
        return getActorPii(client, ref, motivo, session.roles);
      },
    );

    if (!pii) {
      throw new ApiError(
        404,
        "La autoridad no existe en el directorio.",
        "NOT_FOUND",
      );
    }

    return jsonOk({
      pii: { dni: pii.dni, email: pii.email, telefono: pii.telefono },
      tieneFicha: pii.tieneFicha,
      autorizado: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    // 42501 y 22023 los traduce jsonError a 403/422.
    return jsonError(error);
  }
}
