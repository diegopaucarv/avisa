import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { listNudosSemana } from "@/lib/db/repos/cases";
import { withSession } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tablero «Nudos de la semana» de `/casos`.
 *
 * `?semana=AAAA-MM-DD` elige el periodo (cualquier día de la semana); sin el
 * parámetro se usa la semana en curso en America/Lima. La respuesta declara
 * `periodoSinRegistro` cuando no hay ninguna celda cargada en el periodo: el
 * indicador muestra «Periodo sin registro», nunca un 0.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const semana = queryParams(request).get("semana") ?? undefined;

    const result = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      (client) => listNudosSemana(client, semana),
    );

    return jsonOk(result);
  } catch (error) {
    return jsonError(error);
  }
}
