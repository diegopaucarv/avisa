import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import {
  getCompletitud,
  TIPOS_ENTIDAD_TABLERO,
  type TipoEntidadTablero,
} from "@/lib/db/repos/bandeja";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Completitud del tablero, por columna y en total.
 *
 * `GET` cuenta, en SQL, cuántas tarjetas declaran responsable (usuario o texto
 * libre), fecha límite y asignación, y cuántas quedan incompletas. Se calcula
 * con `group by rollup` para que el total no se derive en el cliente. Acepta el
 * mismo `?tipo=` que el tablero.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);
    const bruto = params.get("tipo")?.trim().toLowerCase() ?? "";

    const tipo =
      bruto && (TIPOS_ENTIDAD_TABLERO as readonly string[]).includes(bruto)
        ? (bruto as TipoEntidadTablero)
        : undefined;

    const completitud = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => getCompletitud(client, { tipo }),
    );

    return jsonOk(completitud);
  } catch (error) {
    return jsonError(error);
  }
}
