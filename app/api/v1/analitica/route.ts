import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import {
  cargarAnalitica,
  verificarEsquemaAnalitica,
  type AnaliticaQuery,
} from "@/lib/db/repos/analitica";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Filtros que acepta el dashboard; se leen tal cual de la query. */
const FILTROS = [
  "desde",
  "hasta",
  "granularidad",
  "region",
  "subsector",
] as const;

/**
 * Dashboard analítico (item 57): series temporales de actividad.
 *
 * Todo el cálculo vive en `lib/db/repos/analitica.ts`, dentro de la transacción
 * de la sesión, para que la RLS se aplique a cada tabla. Si falta una pieza del
 * esquema el repositorio corta con 503 `ESQUEMA_PENDIENTE` antes de devolver
 * ceros que parecerían datos reales.
 *
 * La respuesta separa dos ejes que no deben mezclarse: la fecha de negocio
 * (volumen y mezcla) y la marca de carga `created_at` (actividad por día y por
 * usuario), que llega con un veredicto de confiabilidad explícito.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const query: AnaliticaQuery = {};
    for (const key of FILTROS) {
      const valor = params.get(key);
      if (valor) query[key] = valor;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        await verificarEsquemaAnalitica(client);
        return cargarAnalitica(client, query);
      },
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
