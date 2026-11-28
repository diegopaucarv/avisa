import { registrarDescarga } from "@/lib/db/auditoria-descargas";
import { ApiError, jsonError } from "@/lib/db/errors";
import { leerBooleano, queryParams, requireSession } from "@/lib/db/http";
import {
  listAlerts,
  type AlertItem,
  type AlertListQuery,
} from "@/lib/db/repos/alerts";
import { withSession } from "@/lib/db/tenant";
import { BOM, generarCsv } from "@/lib/export/csv";
import { escribirXlsx } from "@/lib/export/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exportación completa del listado de alertas tempranas.
 *
 * `GET /api/v1/export/alertas?formato=csv|xlsx` reenvía los mismos filtros de
 * `GET /api/v1/alerts` (`q`, `caso`, `sinCaso`, `prioridad`, `riesgo`, `nivel`,
 * `estado`, `distritoId`, `sort` y `archivados`) para que el archivo coincida
 * con lo que muestra la vista. Sin filtros exporta todas las alertas visibles
 * para el rol.
 *
 * Es aditivo: no reemplaza la exportación genérica de `/api/v1/export`, que
 * sigue sirviendo JSON, Excel y PDF por entidad.
 */

const FORMATOS = ["csv", "xlsx"] as const;
type Formato = (typeof FORMATOS)[number];

const EXTENSIONES: Record<Formato, string> = {
  csv: "csv",
  xlsx: "xlsx",
};

const TIPOS: Record<Formato, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Filtros del listado que la exportación reenvía tal cual. */
const FILTROS = [
  "q",
  "caso",
  "sinCaso",
  "prioridad",
  "riesgo",
  "nivel",
  "estado",
  "distritoId",
  "sort",
] as const;

/** Columnas del archivo, en el orden en que se escriben. */
const COLUMNAS = [
  "Código",
  "Título",
  "Fecha de reporte",
  "Nivel de riesgo",
  "Estado",
  "Revisor",
  "Caso vinculado",
  "Título del caso",
  "Región",
  "Provincia",
] as const;

/** Tope de filas por exportación; una lista mayor se acota con filtros. */
const MAX_FILAS = 5000;

/** Tamaño de lote del recorrido paginado (el máximo que acepta el repo). */
const TAMANO_LOTE = 100;

const MAX_PAGINAS = Math.ceil(MAX_FILAS / TAMANO_LOTE);

function leerFormato(valor: string | null): Formato {
  const crudo = (valor ?? "").trim().toLowerCase();
  if (!crudo) return "csv";

  if ((FORMATOS as readonly string[]).includes(crudo)) {
    return crudo as Formato;
  }

  throw new ApiError(
    422,
    `Formato «${crudo}» no soportado. Use: ${FORMATOS.join(", ")}.`,
    "FORMATO_INVALIDO",
  );
}

/** Una fila lista para CSV/XLSX; las columnas sin dato salen vacías. */
function filaExportada(item: AlertItem): Record<string, unknown> {
  return {
    Código: item.codigo,
    Título: item.titulo ?? "",
    "Fecha de reporte": item.fechaReporte ?? "",
    "Nivel de riesgo": item.riesgo ?? "",
    Estado: item.estado,
    Revisor: item.ultimoRevisor ?? "",
    "Caso vinculado": item.casoCode ?? "",
    "Título del caso": item.casoTitulo ?? "",
    Región: item.region ?? "",
    Provincia: item.provincia ?? "",
  };
}

function respuesta(
  cuerpo: string | Uint8Array,
  tipo: string,
  nombre: string,
): Response {
  return new Response(cuerpo, {
    status: 200,
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(request: Request) {
  try {
    const sesion = requireSession(request);
    const params = queryParams(request);
    const formato = leerFormato(params.get("formato"));

    const query: AlertListQuery = {};
    for (const clave of FILTROS) {
      const valor = params.get(clave)?.trim();
      if (valor) query[clave] = valor;
    }
    if (leerBooleano(params.get("archivados"))) {
      query.incluirArchivados = true;
    }

    const filas = await withSession(
      { usuarioId: sesion.uid, rolCodigo: sesion.rol },
      async (client) => {
        const acumulado: AlertItem[] = [];
        let pagina = 1;
        let total = 0;

        while (pagina <= MAX_PAGINAS) {
          const lote = await listAlerts(client, {
            ...query,
            page: pagina,
            pageSize: TAMANO_LOTE,
          });
          total = lote.total;

          if (total > MAX_FILAS) {
            throw new ApiError(
              422,
              `La exportación suma ${total} alertas y el límite es ${MAX_FILAS}. Acote los filtros (búsqueda, riesgo, estado o caso) antes de descargar.`,
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

    const registros = filas.map(filaExportada);
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = `avisa_alertas_${fecha}.${EXTENSIONES[formato]}`;

    const cuerpo =
      formato === "xlsx"
        ? escribirXlsx([
            { nombre: "Alertas", filas: registros, columnas: COLUMNAS },
          ])
        : BOM +
          generarCsv(
            COLUMNAS,
            registros.map((fila) => COLUMNAS.map((columna) => fila[columna])),
          );

    await registrarDescarga(request, sesion, {
      entidad: "alertas",
      formato,
      filtros: { ...query },
      filas: filas.length,
    });

    return respuesta(cuerpo, TIPOS[formato], nombre);
  } catch (error) {
    return jsonError(error);
  }
}
