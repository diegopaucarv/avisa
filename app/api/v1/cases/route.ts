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
  createCase,
  listCases,
  type CaseListQuery,
} from "@/lib/db/repos/cases";
import { puedeAnularRegistros, withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Filtros de listado que llegan por query string. Todos se aplican en SQL
 * dentro de `withSession` (la RLS sigue vigente) y los que apuntan a un
 * `estado`, `riesgo`, `prioridad`, `alcance`, `tematica`, `unidad`)
 * se validan contra la tabla real: un valor fuera de catálogo responde 422
 * `FILTRO_INVALIDO` en vez de llegar al SQL.
 *
 * `anulados=true` lista la **papelera** (casos anulados). Sólo se sirve a un rol
 * con capacidad de anulación; si no la tiene, responde 403. La consulta se
 * ejecuta con `verAnulados: true` para que la RLS de `core.casos` deje pasar las
 * filas anuladas.
 *
 * `abiertos=true` se queda con los estados que el catálogo marca como abiertos
 * (`es_activo`): tras la migración 33 sólo `Abierto`. No se filtra por etiqueta
 * para que el indicador no dependa de la grafía del catálogo.
 *
 * `naturaleza=<código>` filtra por la naturaleza declarada del caso; el literal
 * «Sin declarar» aísla los casos con `naturaleza_id` nulo.
 *
 * `region=<nombre>` filtra por región principal y se resuelve contra
 * `core.regiones` (422 si no existe); `sinregion=true` es su complemento y
 * alimenta la fila «Sin región» del panorama territorial.
 *
 * `conteos=true` no es un filtro: pide que la respuesta incluya los conteos de
 * los chips de estado (`todos`, `abiertos`, `resueltos`, `archivados`), que se
 * calculan con los filtros vigentes pero ignorando el propio estado.
 */
const FILTERS = [
  "q",
  "estado",
  "riesgo",
  "prioridad",
  "nivel",
  "alcance",
  "tematica",
  "naturaleza",
  "unidad",
  "region",
  "sort",
] as const;

export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: CaseListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const anulados = leerBooleano(params.get("anulados"));
    if (anulados) {
      if (!puedeAnularRegistros(session.roles)) {
        throw new ApiError(
          403,
          "Sin permiso para consultar registros anulados.",
        );
      }
      query.anulados = true;
    }

    if (leerBooleano(params.get("abiertos"))) query.abiertos = true;

    // `sinregion=true` es el complemento de `region`: casos sin región principal.
    if (leerBooleano(params.get("sinregion"))) query.sinRegion = true;

    // `conteos=true` añade al sobre el bloque `conteos` de la barra de estados.
    // No cambia el listado ni el `total`; sin el parámetro la respuesta es la
    // misma de siempre.
    if (leerBooleano(params.get("conteos"))) query.conteos = true;

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listCases(client, query),
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
      createCase(client, scope, body),
    );

    return jsonOk(detail, 201);
  } catch (error) {
    return jsonError(error);
  }
}
