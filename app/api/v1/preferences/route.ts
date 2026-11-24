import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import {
  guardarPreferencias,
  listarPreferencias,
} from "@/lib/db/repos/preferencias";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/preferences`
 * `PATCH /api/v1/preferences`
 *
 * Preferencias del usuario de la sesión. Nunca se recibe el `usuario_id`: sale
 * de la cookie firmada y la RLS de `core.usuario_preferencia` (migración 62)
 * exige que coincida con `current_setting('app.usuario_id')`.
 *
 * `GET` devuelve:
 *
 * ```json
 * {
 *   "preferencias": {
 *     "tamanoPagina": 25,
 *     "tema": "claro",
 *     "densidad": "comoda",
 *     "zonaHoraria": "America/Lima",
 *     "columnasCasos": ["codigo", "titulo", "riesgo"]
 *   },
 *   "actualizadoEn": "2026-11-24T18:04:00.000Z"
 * }
 * ```
 *
 * `actualizadoEn` es `null` cuando el usuario todavía no guardó nada.
 *
 * `PATCH` acepta el mismo cuerpo anidado (`{ preferencias: { … } }`) o las
 * claves en la raíz (`{ "tamanoPagina": 50 }`). Devuelve el estado completo
 * para que el cliente reconcilie su caché sin un `GET` extra.
 *
 * Un valor `null` borra la fila: la preferencia vuelve al defecto.
 */

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

async function leerCuerpo(request: Request): Promise<Record<string, unknown>> {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }

  if (!esRegistro(cuerpo)) {
    throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
  }

  const anidado = cuerpo["preferencias"];
  return esRegistro(anidado) ? anidado : cuerpo;
}

export async function GET(request: Request) {
  try {
    const session = requireSession(request);

    const resultado = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listarPreferencias(client, session.uid),
    );

    return jsonOk(resultado);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = requireSession(request);
    const cambios = await leerCuerpo(request);

    const resultado = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => guardarPreferencias(client, session.uid, cambios),
    );

    return jsonOk(resultado);
  } catch (error) {
    return jsonError(error);
  }
}
