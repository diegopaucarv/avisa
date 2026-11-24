import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import {
  listDocumentTree,
  type DocumentListQuery,
} from "@/lib/db/repos/documents";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = ["q", "caso", "tipo", "estado", "sort"] as const;

/**
 * Árbol del RAG documental.
 *
 * `GET` devuelve `items` con todas las filas que pasan los filtros, `total`,
 * las ramas `normativas` y `otros` (vigentes) y `generatedAt`, sin paginar: la
 * vista central del RAG necesita todos los tipos documentales y todas sus
 * hojas, no sólo la página visible del listado.
 *
 * Acepta los mismos filtros que `/api/v1/documents` (`q`, `caso`, `tipo`,
 * `estado`, `sort`) salvo `anulados`: el árbol trabaja sobre documentos
 * vigentes, y la papelera sigue teniendo su propia tabla paginada. De esos
 * filtros, sólo `q` se propaga a normativas y otros documentos.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const query: DocumentListQuery = {};
    for (const key of FILTERS) {
      const value = params.get(key);
      if (value) query[key] = value;
    }

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        // `listDocumentTree` encadena las tres consultas sobre este mismo
        // `client`, propagando `query.q` a normativas y otros documentos.
        const tree = await listDocumentTree(client, query);
        return tree;
      },
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
