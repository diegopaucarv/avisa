import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  createCommitment,
  listCommitments,
  type CommitmentListQuery,
} from "@/lib/db/repos/commitments";
import { puedeAnularRegistros, withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = [
  "q",
  "caso",
  "estado",
  "unidad",
  "tipo",
  "nivelGobierno",
  "atiendeGenero",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Booleano tolerante para la query: acepta `true/1/si/sí/on` y
 * `false/0/no/off`; cualquier otro valor (o su ausencia) cuenta como `false`.
 */
function leerBooleano(value: string | null): boolean {
  if (!value) return false;
  return ["true", "1", "si", "sí", "on"].includes(value.trim().toLowerCase());
}

function esFechaReal(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * Lee un límite de fecha del calendario. A diferencia de otros filtros, un
 * valor mal escrito no se ignora: se devuelve 400 para que el cliente sepa
 * que el rango no se aplicó.
 */
function leerFecha(
  params: URLSearchParams,
  key: "vencimiento_desde" | "vencimiento_hasta",
): string | undefined {
  const value = params.get(key)?.trim();
  if (!value) return undefined;
  if (!ISO_DATE.test(value) || !esFechaReal(value)) {
    throw new ApiError(
      400,
      `El parámetro ${key} debe ser una fecha válida en formato YYYY-MM-DD.`,
      "INVALID_DATE",
    );
  }
  return value;
}

/**
 * Compromisos (Guía §8.3.2 y Anexo 14).
 *
 * `GET` devuelve el sobre paginado de siempre (`items`, `total`, `page`,
 * `pageSize`, más los alias `pagina`/`tamanoPagina`) y acepta los filtros
 * `q`, `caso`, `estado`, `unidad`, `tipo`, `nivelGobierno` y `atiendeGenero`.
 *
 * Para la vista de calendario se añaden `vencimiento_desde` y
 * `vencimiento_hasta` (ISO `YYYY-MM-DD`, ambos inclusivos). El rango se
 * aplica sobre el **vencimiento efectivo** —la fecha manual y, si falta, la
 * del próximo hito no terminal—, que es la misma fecha que muestra la tabla.
 * Un valor mal formado devuelve 400 y no se castea nunca texto libre a
 * `date`. La paginación existente no cambia: la tabla sigue usando
 * `pagina`/`tamano`.
 *
 * `anulados=true` lista la **papelera** (compromisos anulados). Sólo se sirve
 * a un rol con capacidad de anulación; si no la tiene, responde 403. La
 * consulta se ejecuta con `verAnulados: true` para que la RLS de
 * `core.compromisos` deje pasar las filas anuladas.
 *
 * `excluir_terminales=true` omite los compromisos en estado terminal; es lo
 * que permite contar vencidos sin incluir los ya cerrados.
 *
 * Ambos aceptan un booleano tolerante (`true/1/si/sí/on`); la ausencia o
 * cualquier otro valor equivale a `false`.
 *
 * El contexto de seguridad va en `withSession`, así que la RLS de
 * `core.compromisos` y sus tablas relacionadas se aplica también al rango.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const query: CommitmentListQuery = { page, pageSize };
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const vencimientoDesde = leerFecha(params, "vencimiento_desde");
    const vencimientoHasta = leerFecha(params, "vencimiento_hasta");
    if (
      vencimientoDesde &&
      vencimientoHasta &&
      vencimientoDesde > vencimientoHasta
    ) {
      throw new ApiError(
        400,
        "El rango de vencimiento está invertido: `vencimiento_desde` no puede ser posterior a `vencimiento_hasta`.",
        "INVALID_DATE_RANGE",
      );
    }
    if (vencimientoDesde) query.vencimientoDesde = vencimientoDesde;
    if (vencimientoHasta) query.vencimientoHasta = vencimientoHasta;

    const anulados = leerBooleano(params.get("anulados"));
    if (anulados) {
      if (!puedeAnularRegistros(session.roles)) {
        throw new ApiError(
          403,
          "Sin permiso para consultar registros anulados.",
        );
      }
      query.incluirAnulados = true;
    }
    if (leerBooleano(params.get("excluir_terminales"))) {
      query.excluirTerminales = true;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listCommitments(client, query),
      { verAnulados: anulados },
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Solicitud inválida.", "INVALID_BODY");
    }

    const ctx = { usuarioId: session.uid, rolCodigo: session.rol };
    const detail = await withSession(ctx, (client) =>
      createCommitment(client, ctx, body),
    );

    return jsonOk(detail, 201);
  } catch (error) {
    return jsonError(error);
  }
}
