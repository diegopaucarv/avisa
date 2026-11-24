import { ApiError, jsonError } from "@/lib/db/errors";
import { queryParams, requireSession } from "@/lib/db/http";
import {
  listarMatriz,
  verificarEsquemaMatriz,
  type MatrizFila,
  type MatrizListQuery,
} from "@/lib/db/repos/matriz";
import { withSession } from "@/lib/db/tenant";

import { BOM, CABECERA_MATRIZ, filaAMatriz, generarCsv } from "../csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS = ["region", "caso", "estado", "q"] as const;

/** Tope de filas por exportación; una matriz más grande se acota con filtros. */
const MAX_FILAS = 20000;

/** Tamaño de lote del recorrido paginado del servidor. */
const TAMANO_LOTE = 100;

/** Tope de páginas como red de seguridad. */
const MAX_PAGINAS = 500;

/**
 * Descarga de la matriz como CSV con las 24 columnas del formato del equipo
 * (A..X, en su orden), BOM UTF-8 para Excel y escapado RFC 4180.
 *
 * La identidad (código AVISA y código Excel) no viaja como columna extra para
 * que el archivo siga siendo el mismo formato del equipo; se consulta en el
 * JSON de `/api/v1/matriz` y en el CSV de `/api/v1/matriz/mapeo`.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const filtros: MatrizListQuery = {};
    for (const key of FILTROS) {
      const valor = params.get(key);
      if (valor) filtros[key] = valor;
    }

    const filas = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        await verificarEsquemaMatriz(client);

        const acumulado: MatrizFila[] = [];
        let pagina = 1;
        let total = 0;

        while (pagina <= MAX_PAGINAS) {
          const lote = await listarMatriz(client, {
            ...filtros,
            page: pagina,
            pageSize: TAMANO_LOTE,
          });
          total = lote.total;

          if (total > MAX_FILAS) {
            throw new ApiError(
              413,
              `La exportación suma ${total} filas y el límite es ${MAX_FILAS}. Acote los filtros (región, caso o estado del hito) antes de descargar.`,
              "EXPORTACION_DEMASIADO_GRANDE",
            );
          }

          acumulado.push(...lote.items);
          if (lote.items.length === 0 || acumulado.length >= total) break;
          pagina += 1;
        }

        return acumulado;
      },
    );

    const contenido =
      BOM + generarCsv(CABECERA_MATRIZ, filas.map((fila) => filaAMatriz(fila)));
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = `avisa_matriz_equipo_${fecha}.csv`;

    return new Response(contenido, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
