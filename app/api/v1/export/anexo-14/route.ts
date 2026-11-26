import { ApiError, jsonError } from "@/lib/db/errors";
import {
  jsonOk,
  leerBooleano,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { withSession } from "@/lib/db/tenant";
import {
  obtenerAnexo14,
  type Anexo14Query,
} from "@/lib/db/repos/export-anexos";
import type { SessionPayload } from "@/lib/db/auth";

import { construirAnexo14, describirFiltros } from "../lib/anexos";
import {
  documentoHtml,
  documentoPdf,
  documentoXlsx,
  fechaArchivo,
  fechaDdMmAaaa,
  respuestaHtml,
  respuestaPdf,
  respuestaXlsx,
  tablaAExcel,
  type TablaDocumento,
} from "../lib/documento";
import {
  contextoDesdeSesion,
  leerFormato,
  leerRangoFechas,
  type FormatoDocumento,
} from "../lib/contexto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATOS = [
  "html",
  "pdf",
  "xlsx",
  "json",
] as const satisfies readonly FormatoDocumento[];

const ETIQUETAS_FILTRO: Readonly<Record<string, string>> = {
  caso: "Caso",
  estado: "Estado del hito",
  desde: "Desde",
  hasta: "Hasta",
};

function leerFiltros(params: URLSearchParams): Anexo14Query {
  const query: Anexo14Query = {};
  const caso = (params.get("caso") ?? "").trim();
  if (caso) query.caso = caso;
  const estado = (params.get("estado") ?? "").trim();
  if (estado) query.estado = estado;

  const { desde, hasta } = leerRangoFechas(params);
  if (desde) query.desde = desde;
  if (hasta) query.hasta = hasta;

  return query;
}

function describir(params: URLSearchParams, query: Anexo14Query): string[] {
  return describirFiltros(ETIQUETAS_FILTRO, {
    caso: query.caso,
    estado: query.estado,
    desde: query.desde ? fechaDdMmAaaa(query.desde) : null,
    hasta: query.hasta ? fechaDdMmAaaa(query.hasta) : null,
  });
}

function decidirDescarga(
  params: URLSearchParams,
  formato: FormatoDocumento,
): boolean {
  return params.has("descarga")
    ? leerBooleano(params.get("descarga"))
    : formato !== "html";
}

/**
 * Anexo 14 — Matriz de Seguimiento de Compromisos en HTML, PDF, XLSX o JSON.
 *
 * Una fila por hito del compromiso, con las catorce columnas del formato oficial
 * de la Guía §8.3. Lee `analytics.vw_anexo_14_seguimiento_compromisos` (reaplica
 * RLS con `core.compromisos`) y, si la vista no existe, cae al listado de
 * compromisos paginado. En XLSX la celda sin dato queda vacía, no «—».
 */
export async function GET(request: Request) {
  try {
    const sesion: SessionPayload = requireSession(request);
    const params = queryParams(request);
    const formato = leerFormato(params, FORMATOS, "html");
    const query = leerFiltros(params);

    const datos = await withSession(
      { usuarioId: sesion.uid, rolCodigo: sesion.rol },
      (client) => obtenerAnexo14(client, query),
    );

    const generadoEn = new Date();
    const contexto = contextoDesdeSesion(sesion, generadoEn);
    const documento = construirAnexo14(datos, describir(params, query));
    const base = `avisa_anexo_14_${fechaArchivo(generadoEn)}`;
    const descarga = decidirDescarga(params, formato);

    if (formato === "json") {
      return jsonOk({
        numero: "14",
        referencia: documento.referencia,
        titulo: documento.titulo,
        generadoEn: generadoEn.toISOString(),
        desdeVista: datos.desdeVista,
        filtros: describir(params, query),
        faltantes: datos.faltantes,
        filas: datos.filas,
      });
    }

    if (formato === "xlsx") {
      const bloque = documento.bloques.find((item) => item.tipo === "tabla");
      const tabla: TablaDocumento | null =
        bloque && bloque.tipo === "tabla" ? bloque.tabla : null;

      if (!tabla) {
        throw new ApiError(
          422,
          "La matriz no tiene columnas para exportar. Acote los filtros.",
          "ANEXO_SIN_DATOS",
        );
      }

      const hoja = tablaAExcel(
        {
          columnas: tabla.columnas,
          filas: tabla.filas.map((fila) =>
            fila.map((valor) => (valor === "—" ? "" : valor)),
          ),
        },
        "Anexo 14",
      );

      return respuestaXlsx(
        documentoXlsx([hoja]),
        `${base}.xlsx`,
        params.has("descarga") ? descarga : true,
      );
    }

    if (formato === "pdf") {
      return respuestaPdf(
        documentoPdf(documento, contexto),
        `${base}.pdf`,
        descarga,
      );
    }

    return respuestaHtml(
      documentoHtml(documento, contexto),
      `${base}.html`,
      descarga,
    );
  } catch (error) {
    return jsonError(error);
  }
}
