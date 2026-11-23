import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import {
  buscarTerritorio,
  type TerritorioQuery,
} from "@/lib/db/repos/territorio";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buscador territorial del alta de caso.
 *
 * `GET /api/v1/territorio?q=matarani&limite=20`
 *
 * Devuelve dos colecciones: `distritos` (catálogo INEI, 1 891) y `lugares`
 * (puertos, caletas, desembarcaderos). Son cosas distintas a propósito:
 * Matarani es puerto del distrito de Islay, no un distrito, y el alta debe
 * guardarlo como lugar. Una sola `q` alimenta a ambas, de modo que quien
 * escribe «Matarani» lo encuentra sin saber de antemano en qué colección está.
 *
 * Sólo lectura: no hay POST/PATCH/DELETE. Los catálogos no tienen RLS, pero se
 * exige sesión para que la interfaz tenga un único contrato y no dependa de
 * datos anónimos.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const query: TerritorioQuery = {};
    const q = params.get("q");
    if (q) query.q = q;
    const limite = Number(params.get("limite"));
    if (Number.isFinite(limite)) query.limite = limite;

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => buscarTerritorio(client, query),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
