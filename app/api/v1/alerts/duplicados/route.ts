import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { buscarDuplicadosAlertas } from "@/lib/db/repos/alerts-duplicados";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aviso de duplicados antes de registrar una alerta temprana.
 *
 * `GET ?titulo=&distritoId=&alerta=` devuelve las alertas parecidas del último
 * trimestre y el criterio que coincidió (título y distrito). `alerta` es el
 * código legible o el uuid de la alerta en edición: se excluye de la respuesta
 * para no proponerla como duplicada de sí misma.
 *
 * Sólo existe `GET`: no se persiste el «no es duplicado» de alertas porque la
 * base no tiene una tabla equivalente a `core.caso_duplicado_descartado` y esta
 * tarea no autoriza DDL. Mientras esa constancia no exista, el aviso se repite
 * en cada consulta.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const distritoRaw = params.get("distritoId") ?? params.get("distrito");
    const distritoId =
      distritoRaw !== null && /^\d+$/.test(distritoRaw.trim())
        ? Number(distritoRaw.trim())
        : undefined;

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) =>
        buscarDuplicadosAlertas(client, {
          titulo: params.get("titulo") ?? "",
          distritoId,
          alerta: params.get("alerta") ?? undefined,
        }),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
