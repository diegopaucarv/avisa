import { jsonError } from "@/lib/db/errors";
import { queryParams, requireSession } from "@/lib/db/http";
import {
  cargarAnalitica,
  verificarEsquemaAnalitica,
  type AnaliticaQuery,
  type AnaliticaPayload,
} from "@/lib/db/repos/analitica";
import { withSession } from "@/lib/db/tenant";

import { BOM, fechaDdMmAaaa, generarCsv, lineaMetadata } from "../csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTROS = [
  "desde",
  "hasta",
  "granularidad",
  "region",
  "subsector",
] as const;

const CABECERA_RESUMEN = [
  "Entidad",
  "Registros con fecha",
  "Registros sin fecha",
  "Primera fecha",
  "Última fecha",
  "Usuarios con carga",
] as const;

const CABECERA_VOLUMEN = [
  "Periodo desde",
  "Periodo hasta",
  "Casos",
  "Demandas",
  "Alertas",
  "Compromisos",
  "Documentos",
  "Reuniones",
  "Manifiesto",
  "Latente",
  "Sin nivel",
] as const;

/**
 * Exporta el resumen del periodo y la serie de volumen como CSV con BOM UTF-8.
 *
 * Se reutiliza la misma carga que alimenta la pantalla para que el archivo y la
 * vista no puedan divergir. Los filtros son los mismos y las fechas salen en
 * `dd/mm/aaaa`; una celda sin dato queda vacía, nunca con un cero inventado.
 */
export async function GET(request: Request) {
  try {
    const session = requireSession(request);
    const params = queryParams(request);

    const query: AnaliticaQuery = {};
    for (const key of FILTROS) {
      const valor = params.get(key);
      if (valor) query[key] = valor;
    }

    const datos = await withSession(
      { usuarioId: session.uid, rolCodigo: session.rol },
      async (client) => {
        await verificarEsquemaAnalitica(client);
        return cargarAnalitica(client, query);
      },
    );

    const contenido = BOM + construirCsv(datos);
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = `avisa_dashboard_analitico_${fecha}.csv`;

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

function construirCsv(datos: AnaliticaPayload): string {
  const filtros: string[] = [];
  if (datos.filtros.region) filtros.push(`Región: ${datos.filtros.region}`);
  if (datos.filtros.subsector) {
    filtros.push(`Subsector: ${datos.filtros.subsector}`);
  }
  const ventana =
    datos.corte.ventanaDesde && datos.corte.ventanaHasta
      ? `${fechaDdMmAaaa(datos.corte.ventanaDesde)} – ${fechaDdMmAaaa(
          datos.corte.ventanaHasta,
        )}`
      : "sin fecha";

  const metadatos =
    lineaMetadata(
      "Filtros",
      filtros.length ? filtros.join(" · ") : "sin filtros territoriales",
    ) +
    lineaMetadata("Ventana", ventana) +
    lineaMetadata("Granularidad", datos.filtros.granularidad) +
    lineaMetadata("Zona horaria", datos.zonaHoraria) +
    lineaMetadata(
      "Corte de datos",
      datos.corte.datosDesde && datos.corte.datosHasta
        ? `${fechaDdMmAaaa(datos.corte.datosDesde)} – ${fechaDdMmAaaa(
            datos.corte.datosHasta,
          )}`
        : "sin dato",
    ) +
    lineaMetadata(
      "Actividad por created_at",
      datos.actividad.confiable
        ? "confiable"
        : datos.actividad.motivo ?? "no confiable",
    ) +
    lineaMetadata("Generado en", datos.generadoEn);

  const resumen = generarCsv(
    CABECERA_RESUMEN,
    datos.resumen.filas.map((fila) => [
      fila.etiqueta,
      fila.conFecha,
      fila.sinFecha,
      fechaDdMmAaaa(fila.primera),
      fechaDdMmAaaa(fila.ultima),
      fila.usuarios,
    ]),
  );

  const volumen = generarCsv(
    CABECERA_VOLUMEN,
    datos.volumen.periodos.map((periodo) => [
      fechaDdMmAaaa(periodo.inicio),
      fechaDdMmAaaa(periodo.fin),
      periodo.casos,
      periodo.demandas,
      periodo.alertas,
      periodo.compromisos,
      periodo.documentos,
      periodo.reuniones,
      periodo.manifiesto,
      periodo.latente,
      periodo.sinNivel,
    ]),
  );

  return (
    metadatos +
    "\r\n" +
    "Resumen del periodo\r\n" +
    resumen +
    "\r\n" +
    "Volumen por periodo\r\n" +
    volumen
  );
}
