import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import {
  getSugerenciasResumen,
  type SugerenciaListQuery,
} from "@/lib/db/repos/sugerencias";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS = [
  "q",
  "caso",
  "entidad",
  "region",
  "territorio",
  "estado",
  "prioridad",
  "tipo",
] as const;

/**
 * Indicadores del período con los mismos filtros del listado.
 *
 * La tasa de aceptación y el tiempo medio hasta la decisión se devuelven en
 * `null` cuando todavía no hay decisiones: la pantalla los muestra como «sin
 * dato» en lugar de inventar un cero.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const query: SugerenciaListQuery = {};
    for (const key of FILTROS) {
      const value = params.get(key)?.trim();
      if (value) query[key] = value;
    }

    const resumen = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getSugerenciasResumen(client, query),
    );

    return jsonOk(resumen);
  } catch (error) {
    return jsonError(error);
  }
}
