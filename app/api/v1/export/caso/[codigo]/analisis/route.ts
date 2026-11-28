import { registrarDescarga } from "@/lib/db/auditoria-descargas";
import { ApiError, jsonError } from "@/lib/db/errors";
import {
  jsonOk,
  leerBooleano,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { withSession } from "@/lib/db/tenant";
import { getCaseByCode } from "@/lib/db/repos/cases";
import type { SessionPayload } from "@/lib/db/auth";

import { construirAnalisisCaso } from "../../../lib/anexos";
import {
  documentoHtml,
  documentoPdf,
  fechaArchivo,
  respuestaHtml,
  respuestaPdf,
} from "../../../lib/documento";
import {
  contextoDesdeSesion,
  leerFormato,
  type FormatoDocumento,
} from "../../../lib/contexto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATOS = [
  "html",
  "pdf",
  "json",
] as const satisfies readonly FormatoDocumento[];

function nombreArchivo(codigo: string, generadoEn: Date): string {
  const seguro =
    codigo.replace(/[^0-9A-Za-z_-]+/g, "_").replace(/^_+|_+$/g, "") || "caso";
  return `avisa_analisis_caso_${seguro}_${fechaArchivo(generadoEn)}`;
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
 * Análisis de caso (ítems 79–84): `GET /api/v1/export/caso/:codigo/analisis`.
 *
 * Reúne las ocho secciones del formato 8.2.4 — resumen, contexto y hechos, mapa
 * de actores, posiciones/intereses/necesidades, capacidades, causas, geografía y
 * estado y compromisos, más recomendaciones — a partir de la ficha del caso.
 *
 * Cada sección sin fuente se declara «sin dato» y su nombre se agrega a
 * `faltantes`; la base no registra capacidades ni clasificación de causas, así
 * que esas dos secciones salen vacías a propósito en lugar de inventarse.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ codigo: string }> },
) {
  try {
    const sesion: SessionPayload = requireSession(request);
    const params = queryParams(request);
    const formato = leerFormato(params, FORMATOS, "html");

    const { codigo } = await context.params;
    const codigoCaso = (codigo ?? "").trim();
    if (!codigoCaso) {
      throw new ApiError(400, "Falta el código del caso.", "CODIGO_REQUERIDO");
    }

    const generadoEn = new Date();
    const contexto = contextoDesdeSesion(sesion, generadoEn);

    const detalle = await withSession(
      { usuarioId: sesion.uid, rolCodigo: sesion.rol },
      (client) => getCaseByCode(client, codigoCaso),
    );

    if (!detalle) {
      throw new ApiError(
        404,
        `No se encontró el caso «${codigoCaso}» o no está accesible para su rol.`,
        "CASO_NO_ENCONTRADO",
      );
    }

    const documento = construirAnalisisCaso(detalle);
    const base = nombreArchivo(detalle.case.code, generadoEn);
    const descarga = decidirDescarga(params, formato);

    const auditar = () =>
      registrarDescarga(request, sesion, {
        entidad: "analisis-caso",
        formato,
        // El análisis cierra sobre un único caso.
        filtros: { codigo: codigoCaso },
        filas: 1,
      });

    if (formato === "json") {
      await auditar();
      return jsonOk({
        codigo: detalle.case.code,
        referencia: documento.referencia,
        titulo: documento.titulo,
        disponible: true,
        faltantes: documento.faltantes ?? [],
        generadoEn: generadoEn.toISOString(),
        documento,
      });
    }

    if (formato === "pdf") {
      await auditar();
      return respuestaPdf(
        documentoPdf(documento, contexto),
        `${base}.pdf`,
        descarga,
      );
    }

    await auditar();
    return respuestaHtml(
      documentoHtml(documento, contexto),
      `${base}.html`,
      descarga,
    );
  } catch (error) {
    return jsonError(error);
  }
}
