import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerBooleano,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  createAlert,
  listAlerts,
  type AlertListQuery,
} from "@/lib/db/repos/alerts";
import { puedeAnularRegistros, withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = [
  "q",
  "caso",
  "sinCaso",
  "prioridad",
  "riesgo",
  "nivel",
  "estado",
  "distritoId",
  "sort",
] as const;

/**
 * Alertas tempranas.
 *
 * `GET` devuelve el sobre paginado y acepta los filtros `q`, `caso`,
 * `sinCaso`, `prioridad`, `riesgo`, `nivel`, `estado`, `distritoId` y `sort`.
 * `riesgo` filtra por el código de `core.cat_niveles_riesgo` (`Bajo` · `Medio` ·
 * `Alto`); `sort=riesgo` ordena de alto a bajo.
 *
 * `anulados=true` lista la **papelera** (alertas anuladas). Sólo se sirve a un
 * rol con capacidad de anulación; si no la tiene, responde 403. La consulta se
 * ejecuta con `verAnulados: true` para que la RLS de `core.alertas_tempranas`
 * deje pasar las filas anuladas.
 *
 * `sinCaso=true|false` acota a las alertas sin caso o con caso vinculado.
 * `archivados=true` lista las alertas archivadas; por omisión el listado de
 * trabajo las oculta. Archivar no es anular.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: AlertListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const anulados = leerBooleano(params.get("anulados"));
    if (anulados) {
      if (!puedeAnularRegistros(session.roles, "alertas")) {
        throw new ApiError(
          403,
          "Sin permiso para consultar registros anulados.",
        );
      }
      query.incluirAnulados = true;
    }

    if (leerBooleano(params.get("archivados"))) {
      query.incluirArchivados = true;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listAlerts(client, query),
      { verAnulados: anulados },
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}

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

export async function POST(request: Request) {
  try {
    const session = requireSession(request);
    const body = await readBody(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const detail = await withSession(scope, (client) =>
      createAlert(client, scope, body),
    );

    return jsonOk(detail, 201);
  } catch (error) {
    return jsonError(error);
  }
}
