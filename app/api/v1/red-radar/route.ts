import { jsonError } from "@/lib/db/errors";
import { jsonOk, leerPagina, queryParams, requireSession } from "@/lib/db/http";
import { listarCola } from "@/lib/db/repos/red-radar";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cola de la bandeja RED-RADAR.
 *
 * No hay tabla de señales ni conector: la cola se alimenta de
 * `core.alertas_tempranas` vigentes, con su estado de triaje resuelto en
 * `core.alerta_triaje` (`pendiente` si aún no tiene fila).
 *
 * Filtros: `?estado=` (pendiente | en_triage | confirmada | descartada |
 * duplicada), `?region=` (id de `core.regiones`), `?distrito=` (id INEI),
 * `?desde=`/`?hasta=` (`YYYY-MM-DD`, inclusivos), `?q=` (código, título o
 * situación) y paginación `pagina`/`tamano`.
 *
 * `conteos` se calcula sin el filtro de estado para alimentar los chips; el
 * resto de filtros sí se aplica. `fuente.senalesRecibidas` es `null` porque no
 * existe la fuente.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const resultado = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) =>
        listarCola(client, {
          estado: params.get("estado") ?? undefined,
          regionId: params.get("region") ?? undefined,
          distritoId: params.get("distrito") ?? undefined,
          desde: params.get("desde") ?? undefined,
          hasta: params.get("hasta") ?? undefined,
          q: params.get("q") ?? undefined,
          page,
          pageSize,
        }),
    );

    return jsonOk(resultado);
  } catch (error) {
    return jsonError(error);
  }
}
