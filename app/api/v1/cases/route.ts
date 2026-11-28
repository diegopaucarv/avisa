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
import { resolveDataScope } from "@/lib/db/scope";
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
 * `region=<nombre|ubigeo>` filtra por región principal y se resuelve contra
 * `core.regiones` (422 si no existe). Acepta el ubigeo INEI —dos dígitos de la
 * región o los seis del distrito, que heredan los dos primeros— y, si el valor
 * no es numérico, el nombre normalizado de siempre. `sinregion=true` es su
 * complemento y alimenta la fila «Sin región» del panorama territorial.
 *
 * Ámbito por defecto: un sectorista con territorios en `core.usuario_territorio`
 * consulta sólo sus regiones. La ruta inyecta esas regiones en el repositorio
 * salvo que la petición pida explícitamente otro recorte (`region`, `sinregion`
 * o `alcance=todos`), de modo que el número de la tabla y el filtro visible
 * coincidan. Dirección, Alta Dirección y Administración conservan el alcance
 * total; `alcance=todos` es además la marca para limpiar el ámbito por defecto.
 *
 * `sectorista=<texto>` filtra por el nombre del usuario sectorista del caso
 * (`ilike`); `sectoristaId=<uuid>` lo filtra por `punto_focal_usuario_id`.
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
  "sectorista",
  "sectoristaId",
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
      if (!value) continue;
      // `alcance=todos` no es un valor del catálogo: es la marca con la que la
      // vista pide no aplicar ningún ámbito. Se interpreta aquí y no se reenvía
      // al repositorio, que la rechazaría como filtro inválido.
      if (key === "alcance" && value === "todos") continue;
      query[key] = value;
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

    // Ámbito territorial por defecto: el sectorista ve sus regiones asignadas.
    // Un filtro territorial explícito del usuario manda sobre el valor por
    // defecto, incluido `alcance=todos`, que pide ver todo.
    const scope = resolveDataScope(session);
    const pidioTerritorio =
      Boolean(params.get("region")) ||
      leerBooleano(params.get("sinregion")) ||
      params.get("alcance") === "todos";
    if (
      scope.mode === "regions" &&
      !pidioTerritorio &&
      scope.regiones.length > 0
    ) {
      query.regiones = scope.regiones;
    }

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
