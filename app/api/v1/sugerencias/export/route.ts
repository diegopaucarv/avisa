import { ApiError, jsonError } from "@/lib/db/errors";
import { queryParams, requireSession } from "@/lib/db/http";
import {
  listSugerencias,
  type SugerenciaListItem,
  type SugerenciaListQuery,
} from "@/lib/db/repos/sugerencias";
import { withSession } from "@/lib/db/tenant";
import { generarPdf, type TablaPdf } from "@/lib/export/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS = [
  "q",
  "caso",
  "entidad",
  "region",
  "territorio",
  "estado",
  "prioridad",
  "tipo",
  "sort",
] as const;

/** Tope de filas por exportación; una matriz mayor se acota con filtros. */
const MAX_FILAS = 20000;
const TAMANO_LOTE = 100;
const MAX_PAGINAS = 500;

/** BOM UTF-8: Excel abre el archivo con tildes correctas sólo si lo lleva. */
const BOM = "\uFEFF";

const CABECERA = [
  "Código",
  "Fecha",
  "Tipo",
  "Entidad afectada",
  "Qué se sugiere",
  "A quién",
  "Prioridad",
  "Estado",
  "Atiende",
  "Sustento",
  "Decisión de",
  "Fecha de decisión",
  "Motivo del rechazo",
] as const;

/** `dd/mm/aaaa` desde ISO `YYYY-MM-DD` o un `timestamptz` ISO. */
function fechaCorta(valor: string | null): string {
  if (!valor) return "—";
  const dia = valor.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "—";
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

function texto(valor: string | null): string {
  const limpio = (valor ?? "").trim();
  return limpio || "—";
}

function filaCsv(sugerencia: SugerenciaListItem): string[] {
  return [
    sugerencia.codigo,
    fechaCorta(sugerencia.fecha),
    sugerencia.tipo,
    sugerencia.entidad,
    sugerencia.titulo,
    texto(sugerencia.destinatario),
    sugerencia.prioridad,
    sugerencia.estado,
    texto(sugerencia.responsable),
    texto(sugerencia.sustento),
    texto(sugerencia.decididoPorNombre),
    fechaCorta(sugerencia.decididoEn),
    texto(sugerencia.motivoRechazo),
  ];
}

/** RFC 4180: comillas dobles, comillas escapadas y comas/saltos dentro de campo. */
function celdaCsv(valor: string): string {
  if (/[",\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

function generarCsv(filas: readonly SugerenciaListItem[]): string {
  const lineas = [
    CABECERA.map(celdaCsv).join(","),
    ...filas.map((fila) => filaCsv(fila).map(celdaCsv).join(",")),
  ];
  return `${lineas.join("\r\n")}\r\n`;
}

function tablaPdf(filas: readonly SugerenciaListItem[]): TablaPdf {
  return {
    titulo: "Sugerencias de intervención",
    columnas: [
      { titulo: "Fecha", ancho: 0.9 },
      { titulo: "Tipo", ancho: 1.4 },
      { titulo: "Entidad afectada", ancho: 1.4 },
      { titulo: "Qué se sugiere", ancho: 3.2 },
      { titulo: "A quién", ancho: 1.4 },
      { titulo: "Prioridad", ancho: 1 },
      { titulo: "Estado", ancho: 1.2 },
      { titulo: "Atiende", ancho: 1.5 },
    ],
    filas: filas.map((fila) => [
      fechaCorta(fila.fecha),
      fila.tipo,
      fila.entidad,
      fila.titulo,
      fila.destinatario ?? "—",
      fila.prioridad,
      fila.estado,
      fila.responsable ?? "—",
    ]),
  };
}

function respuesta(bytes: Uint8Array | string, tipo: string, nombre: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

/**
 * Exportación de la matriz de sugerencias en CSV o PDF, con los mismos filtros
 * del listado. Recorre las páginas del repositorio hasta agotar el total.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const formato = (params.get("formato") ?? "csv").trim().toLowerCase();
    if (formato !== "csv" && formato !== "pdf") {
      throw new ApiError(
        400,
        "Formato no válido. Use csv o pdf.",
        "FORMATO_INVALIDO",
      );
    }

    const filtros: SugerenciaListQuery = {};
    for (const key of FILTROS) {
      const valor = params.get(key)?.trim();
      if (valor) filtros[key] = valor;
    }

    const filas = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        const acumulado: SugerenciaListItem[] = [];
        let pagina = 1;
        let total = 0;

        while (pagina <= MAX_PAGINAS) {
          const lote = await listSugerencias(client, {
            ...filtros,
            page: pagina,
            pageSize: TAMANO_LOTE,
          });
          total = lote.total;

          if (total > MAX_FILAS) {
            throw new ApiError(
              413,
              `La exportación suma ${total} filas y el límite es ${MAX_FILAS}. Acote los filtros antes de descargar.`,
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

    const fecha = new Date().toISOString().slice(0, 10);

    if (formato === "csv") {
      return respuesta(
        BOM + generarCsv(filas),
        "text/csv; charset=utf-8",
        `avisa_sugerencias_${fecha}.csv`,
      );
    }

    const pdf = generarPdf({
      titulo: "AVISA - Sugerencias de intervención",
      subtitulo: `${filas.length} sugerencia${filas.length === 1 ? "" : "s"} con los filtros vigentes`,
      generadoEn: new Date(),
      tablas: [tablaPdf(filas)],
    });

    return respuesta(pdf, "application/pdf", `avisa_sugerencias_${fecha}.pdf`);
  } catch (error) {
    return jsonError(error);
  }
}
