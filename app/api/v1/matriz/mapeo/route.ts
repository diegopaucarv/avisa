import { jsonError } from "@/lib/db/errors";
import { jsonOk, queryParams, requireSession } from "@/lib/db/http";
import { listarMapaMatriz, verificarEsquemaMapeo } from "@/lib/db/repos/matriz";
import { withSession } from "@/lib/db/tenant";

import { BOM, CABECERA_MAPEO, generarCsv } from "../csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tabla de equivalencias Excel → caso (`core.mapa_matriz_excel`).
 *
 * Sin `formato=csv` responde JSON con la lista y el total. Con `formato=csv`
 * descarga el mismo contenido en CSV para revisarlo en Excel. Es el mapa que
 * decide la unión, no la igualdad de códigos: hay colisiones documentadas entre
 * el código del Excel y `core.casos.codigo_caso`.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const formato = queryParams(request).get("formato");

    const items = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        await verificarEsquemaMapeo(client);
        return listarMapaMatriz(client);
      },
    );

    if (formato === "csv") {
      const contenido =
        BOM +
        generarCsv(
          CABECERA_MAPEO,
          items.map((item) => [
            item.codigoExcel ?? "",
            item.codigoCaso ?? "",
            item.confianza ?? "",
            item.nota ?? "",
            String(item.bloqueFila),
            item.fuente,
          ]),
        );

      return new Response(contenido, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="avisa_matriz_mapeo.csv"',
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }

    return jsonOk({
      items,
      total: items.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonError(error);
  }
}
