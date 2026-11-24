import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { getResumenEtl, type ResumenEtl } from "@/lib/db/repos/etl";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Estado real de la ingesta para la consola ETL.
 *
 * Contrato (`GET /api/v1/etl/resumen`):
 *
 * ```json
 * {
 *   "generadoEn": "2026-11-24T20:40:00.000Z",
 *   "esquemas": [
 *     {
 *       "esquema": "core",
 *       "totalTablas": 126,
 *       "totalFilas": 9306,
 *       "tablas": [{ "tabla": "actores", "filas": 1160 }]
 *     }
 *   ],
 *   "tablasOmitidas": 4,
 *   "migraciones": {
 *     "aplicadas": 18,
 *     "primera": "2026-11-23T17:30:34.217Z",
 *     "ultima": "2026-11-24T20:32:46.804Z",
 *     "ultimaClave": "58_etl_conteos_2026_11_24"
 *   },
 *   "catalogos": {
 *     "tiposDocumento": [{ "codigo": "acta", "nombre": "Acta de Acuerdo", "anexoNumero": 10 }],
 *     "formatos": [{ "extension": "pdf", "mime": "application/pdf", "nota": "Formato principal de los anexos." }],
 *     "puntosIngesta": [{ "codigo": "PI-01", "descripcion": "Plan de análisis", "destino": "core" }]
 *   },
 *   "fuentesIntegracion": [
 *     {
 *       "sistema": "PRODUCE",
 *       "enlaces": 2,
 *       "tipos": ["push"],
 *       "protocolos": ["oficio_manual"],
 *       "estados": ["pendiente_auth"],
 *       "ultimaSincronizacion": null
 *     }
 *   ]
 * }
 * ```
 *
 * Los conteos de `legacy` y `staging` salen de `core.etl_conteos()`
 * (SECURITY DEFINER): el rol `avisa_api` no tiene USAGE en esos esquemas. Se
 * omiten las tablas `*_backup_*` y se informa cuántas quedaron fuera.
 *
 * No hay motor de extracción ni tabla de corridas: esta ruta no inventa
 * ejecuciones, cola, programación ni reintentos.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);

    const resumen: ResumenEtl = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getResumenEtl(client),
    );

    return jsonOk(resumen);
  } catch (error) {
    return jsonError(error);
  }
}
