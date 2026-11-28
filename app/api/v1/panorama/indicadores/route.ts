import { jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { listarIndicadoresPanorama } from "@/lib/db/repos/panorama";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Indicadores del Panorama territorial.
 *
 * `GET /api/v1/panorama/indicadores`
 *
 *   {
 *     regiones: [ { ubigeo, region, casos, manifiestos, riesgoAlto,
 *                   alertas90d, alertasRiesgoAlto } ],
 *     sectoristas: [ { id, nombre, regiones: [ "Lima", … ], casos, manifiestos,
 *                      riesgoAlto, alertas90d, alertasRiesgoAlto } ],
 *     totales: { casos, manifiestos, riesgoAlto, alertas90d, alertasRiesgoAlto },
 *     generadoEn: "ISO"
 *   }
 *
 * Sólo lectura y con sesión obligatoria, aunque las tablas no tengan RLS. Se
 * calcula bajo la RLS de la sesión (`withSession`), así que los conteos reflejan
 * lo que el rol puede ver.
 *
 * Las definiciones de cada cifra —caso abierto, manifiesto, riesgo alto, ventana
 * de 90 días, región de la alerta y atribución al sectorista— viven en
 * `lib/db/repos/panorama.ts`, con los ids reales de los catálogos. Resumen:
 * `regiones` desglosa por región y excluye lo que no tiene región; `totales` no
 * se recorta por región (por eso puede superar la suma del desglose); y
 * `sectoristas` incluye a todo usuario con rol sectorista vigente, con sus
 * regiones asignadas y sus conteos sin desglosar.
 *
 * Si falta una tabla del contrato, `jsonError` responde 503 («La capa de datos no
 * está inicializada»), nunca datos de relleno.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const scope = { usuarioId: session.uid, rolCodigo: session.rol };

    const result = await withSession(scope, (client) =>
      listarIndicadoresPanorama(client),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
