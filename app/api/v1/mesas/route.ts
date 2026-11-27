import { jsonError } from "@/lib/db/errors";
import {
  conAliasDePagina,
  jsonOk,
  leerPagina,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { listMesas, type MesaListQuery } from "@/lib/db/repos/mesas";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS = ["q", "vigencia", "naturaleza"] as const;

/**
 * Listado de mesas de diálogo.
 *
 * `GET /api/v1/mesas?q=&vigencia=&naturaleza=&pagina=&tamano=`
 *
 * Devuelve el sobre paginado habitual (`items`, `total`, `page`, `pageSize` más
 * los alias `pagina`/`tamanoPagina`) y un `resumen` **global** que no depende de
 * los filtros: es la franja de indicadores del encabezado.
 *
 * La RLS de `core.mesas_dialogo` y `core.compromisos` se aplica dentro de
 * `withSession`, así que el listado sólo ve las filas que permite el rol.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const { page, pageSize } = leerPagina(params);

    const filtros: MesaListQuery = { page, pageSize };
    for (const clave of FILTROS) {
      const valor = params.get(clave);
      if (valor) filtros[clave] = valor;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listMesas(client, filtros),
    );

    return jsonOk({
      ...conAliasDePagina(result),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
