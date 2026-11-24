import { ApiError, jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  esEstadoNotificacion,
  listNotifications,
  type NotificationEstado,
} from "@/lib/db/repos/notifications";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/notifications?estado=pendiente&pageSize=1`.
 *
 * `estado` acepta los valores del CHECK de `core.notificaciones`
 * (`pendiente` | `enviada` | `leida`); cualquier otro responde 422
 * `FILTRO_INVALIDO` en vez de llegar al SQL. El `total` del sobre cuenta las
 * filas que pasan el filtro, así que la SPA pide el conteo de no leídas con
 * `estado=pendiente&pageSize=1` y lee `total`.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const estadoBruto = params.get("estado")?.trim() ?? "";
    let estado: NotificationEstado | undefined;
    if (estadoBruto) {
      if (!esEstadoNotificacion(estadoBruto)) {
        throw new ApiError(
          422,
          "El filtro «estado» admite pendiente, enviada o leida.",
          "FILTRO_INVALIDO",
        );
      }
      estado = estadoBruto;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) =>
        listNotifications(
          client,
          {
            usuarioId: session.uid,
            rolCodigo: session.rol,
          },
          { page, pageSize, estado },
        ),
    );

    return jsonOk(conAliasDePagina(result));
  } catch (error) {
    return jsonError(error);
  }
}
