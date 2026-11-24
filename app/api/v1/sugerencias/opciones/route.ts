import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { getSugerenciaOpciones } from "@/lib/db/repos/sugerencias";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vocabulario propio de la pantalla.
 *
 * Devuelve los estados y tipos de sugerencia de sus catálogos (no duplica los
 * catálogos generales de `/v1/catalogs`) y la lista de responsables activos
 * para el desplegable de asignación. Regiones, unidades y prioridades se
 * siguen tomando de `/v1/catalogs`.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);

    const opciones = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getSugerenciaOpciones(client),
    );

    return jsonOk(opciones);
  } catch (error) {
    return jsonError(error);
  }
}
