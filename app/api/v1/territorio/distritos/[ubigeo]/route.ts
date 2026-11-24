import { ApiError, jsonError } from "@/lib/db/errors";
import { jsonOk, requireSession } from "@/lib/db/http";
import { obtenerDistrito } from "@/lib/db/repos/territorio";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ficha GeoJSON de un distrito de la capa GIS.
 *
 * `GET /api/v1/territorio/distritos/010101`
 *
 * Devuelve un `Feature` de GeoJSON (WGS84, sin `crs`): la geometría en
 * `geometry` y los metadatos en `properties`. La geometría dice dónde está el
 * territorio, no cuánto pesa: `poblacion` es el denominador de las tasas
 * (por 100 000 hab.), no un peso de riesgo.
 *
 * 400 si el ubigeo no tiene 6 dígitos; 404 si no está en la tabla; 503 si la
 * migración 47 todavía no se aplicó; 403 si el rol de la aplicación no tiene
 * SELECT (migración 47 se lo concede a `avisa_app`). Nunca se devuelve una
 * geometría de relleno.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ ubigeo: string }> },
) {
  try {
    const session = requireSession(request);
    const { ubigeo: crudo } = await context.params;

    let ubigeo: string;
    try {
      ubigeo = decodeURIComponent(crudo).trim();
    } catch {
      throw new ApiError(
        400,
        "El ubigeo está mal codificado.",
        "UBIGEO_INVALIDO",
      );
    }
    if (!/^\d{6}$/.test(ubigeo)) {
      throw new ApiError(
        400,
        "El ubigeo debe tener exactamente 6 dígitos.",
        "UBIGEO_INVALIDO",
      );
    }

    const detalle = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => obtenerDistrito(client, ubigeo),
    );

    if (!detalle) {
      throw new ApiError(
        404,
        "El distrito no existe en la capa GIS.",
        "NOT_FOUND",
      );
    }

    return jsonOk({
      type: "Feature",
      id: detalle.ubigeo,
      geometry: detalle.geometria,
      properties: {
        ubigeo: detalle.ubigeo,
        nombre: detalle.nombre,
        provincia: detalle.provincia,
        region: detalle.region,
        poblacion: detalle.poblacion,
        poblacionHombres: detalle.poblacionHombres,
        poblacionMujeres: detalle.poblacionMujeres,
        procedenciaPoblacion: detalle.procedenciaPoblacion,
        centroide: detalle.centroide,
        creadoEn: detalle.creadoEn,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
