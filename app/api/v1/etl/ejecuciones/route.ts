import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  listarMigraciones,
  type EjecucionesResultado,
} from "@/lib/db/repos/etl";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Historial de migraciones aplicadas (`core.migracion_log`), paginado.
 *
 * Contrato (`GET /api/v1/etl/ejecuciones?pagina=1&tamano=25`):
 *
 * ```json
 * {
 *   "items": [{ "clave": "58_etl_conteos_2026_11_24", "aplicadaEn": "2026-11-24T20:32:46.804Z" }],
 *   "total": 18,
 *   "page": 1,
 *   "pageSize": 25,
 *   "generatedAt": "2026-11-24T20:40:00.000Z",
 *   "pagina": 1,
 *   "tamanoPagina": 25
 * }
 * ```
 *
 * `core.migracion_log` sólo guarda `clave` y `aplicada_en`: no hay autor,
 * duración ni resultado. No es el historial de corridas de extracción —esa
 * tabla no existe—, y la interfaz lo declara así.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const { page, pageSize } = leerPagina(queryParams(request));

    const resultado: EjecucionesResultado = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listarMigraciones(client, { page, pageSize }),
    );

    return jsonOk(conAliasDePagina(resultado));
  } catch (error) {
    return jsonError(error);
  }
}
