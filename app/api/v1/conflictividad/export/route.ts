import { jsonError } from "@/lib/db/errors";
import { queryParams, requireSession } from "@/lib/db/http";
import {
  listarConflictividad,
  verificarEsquemaConflictividad,
  type ConflictividadListQuery,
} from "@/lib/db/repos/conflictividad";
import { withSession } from "@/lib/db/tenant";

import { BOM, CABECERA_ANEXO_15, filaACsv, generarCsv } from "../csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS = [
  "region",
  "alcance",
  "subsector",
  "estado",
  "nivel",
  "prioridad",
  "desde",
  "hasta",
  "q",
  "orden",
] as const;

/**
 * Descarga de la matriz de conflictividad (Anexo 15) como CSV con BOM UTF-8 y
 * escapado RFC 4180. Se exportan todas las filas filtradas (sin paginar); si el
 * conjunto supera el tope del repositorio, la API responde 413 y pide acotar.
 *
 * Las fechas salen en `dd/mm/aaaa`, igual que en la pantalla y en la hoja
 * imprimible. Una celda sin dato queda vacía: nunca «—» ni un cero inventado.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const filtros: ConflictividadListQuery = { todas: true };
    for (const key of FILTROS) {
      const valor = params.get(key);
      if (valor) filtros[key] = valor;
    }

    const filas = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        await verificarEsquemaConflictividad(client);
        const result = await listarConflictividad(client, filtros);
        return result.items;
      },
    );

    const contenido =
      BOM +
      generarCsv(
        CABECERA_ANEXO_15,
        filas.map((fila, indice) => filaACsv(fila, indice + 1)),
      );
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = `avisa_anexo_15_matriz_conflictividad_${fecha}.csv`;

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
