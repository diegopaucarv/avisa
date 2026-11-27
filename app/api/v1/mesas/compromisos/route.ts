import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import {
  listCompromisosDeMesas,
  type CompromisosMesasQuery,
} from "@/lib/db/repos/mesas";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS = ["q", "mesa", "estado"] as const;

/**
 * Compromisos de las mesas de diálogo.
 *
 * `GET /api/v1/mesas/compromisos?q=&mesa=&estado=&pagina=&tamano=`
 *
 * `mesa` es el **código** de la mesa (`OAIPCS-001`), no su id. El listado no
 * incluye el array de hitos (sólo `hitosTotal`, `hitosCumplidos` y
 * `proximoHito`) para no inflar cada página.
 *
 * Mientras la migración 81 no exista, no hay compromisos ligados a mesas y la
 * respuesta es una página vacía con `total` = 0.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const filtros: CompromisosMesasQuery = { page, pageSize };
    for (const clave of FILTROS) {
      const valor = params.get(clave);
      if (valor) filtros[clave] = valor;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listCompromisosDeMesas(client, filtros),
    );

    return jsonOk(
      conAliasDePagina({
        ...result,
        generatedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
