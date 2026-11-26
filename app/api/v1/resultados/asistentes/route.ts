import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  vincularAsistentes,
  type AsistenteEntrada,
} from "@/lib/db/repos/resultados";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/resultados/asistentes`
 *
 * Cuerpo:
 * ```json
 * {
 *   "reunionId": "uuid",
 *   "asistentes": [
 *     { "nombre": "Quispe Ramos, Juan Carlos", "cargo": "Presidente", "actorId": "uuid" },
 *     { "nombre": "Sin coincidencia", "omitido": true }
 *   ]
 * }
 * ```
 *
 * Vincula en una sola transacción cada `actorId` a `core.reunion_participantes`
 * (UPSERT: la reunión no duplica a un actor) y devuelve el detalle por fila con
 * estado `vinculado` / `omitido` / `error`. No crea actores: el alta rápida la
 * hace la SPA contra `POST /api/v1/actors`, que ya valida la sesión y la PII.
 */
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

    const registro = body as Record<string, unknown>;
    const reunionId =
      typeof registro["reunionId"] === "string"
        ? registro["reunionId"].trim()
        : "";
    const asistentesBrutos = registro["asistentes"];

    if (!reunionId) {
      throw new ApiError(
        422,
        "Falta la reunión a la que se vincula la lista.",
        "REUNION_REQUERIDA",
      );
    }
    if (!Array.isArray(asistentesBrutos)) {
      throw new ApiError(
        422,
        "La lista de asistentes no tiene el formato esperado.",
        "ASISTENTES_INVALIDO",
      );
    }

    const asistentes: AsistenteEntrada[] = asistentesBrutos.map((fila) => {
      const item = (fila && typeof fila === "object" ? fila : {}) as Record<
        string,
        unknown
      >;
      return {
        nombre: typeof item["nombre"] === "string" ? item["nombre"] : null,
        cargo: typeof item["cargo"] === "string" ? item["cargo"] : null,
        actorId: typeof item["actorId"] === "string" ? item["actorId"] : null,
        omitido: item["omitido"] === true,
      };
    });

    const resultado = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) =>
        vincularAsistentes(
          client,
          { usuarioId: session.uid, rolCodigo: session.rol },
          reunionId,
          asistentes,
        ),
    );

    return jsonOk(resultado);
  } catch (error) {
    return jsonError(error);
  }
}
