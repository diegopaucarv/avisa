import { ApiError, jsonError } from "@/lib/db/errors";
import {
  jsonOk,
  leerBooleano,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { withSession } from "@/lib/db/tenant";
import {
  listarAnexosDisponibles,
  obtenerDocumentoFuente,
} from "@/lib/db/repos/export-anexos";
import type { SessionPayload } from "@/lib/db/auth";

import { construirMensajeClimaSocial, mensajeParaPdf } from "../../lib/anexos";
import {
  documentoPdf,
  fechaArchivo,
  fechaDdMmAaaa,
  respuestaPdf,
  respuestaTexto,
  type DocumentoAnexo,
} from "../../lib/documento";
import {
  contextoDesdeSesion,
  leerFormato,
  type FormatoDocumento,
} from "../../lib/contexto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATOS = [
  "texto",
  "pdf",
  "json",
] as const satisfies readonly FormatoDocumento[];

/** `general` alimenta el Anexo 04 (tipo 2); `focalizado`, el Anexo 05 (tipo 3). */
const TIPOS: Readonly<
  Record<string, { tipoId: number; numero: string; etiqueta: string }>
> = {
  general: { tipoId: 2, numero: "04", etiqueta: "Clima social general" },
  focalizado: { tipoId: 3, numero: "05", etiqueta: "Clima social focalizado" },
};

function decidirDescarga(
  params: URLSearchParams,
  formato: FormatoDocumento,
): boolean {
  return params.has("descarga")
    ? leerBooleano(params.get("descarga"))
    : formato === "pdf";
}

/**
 * Clima social listo para mensajería (ítem 78): `GET /api/v1/export/clima-social/mensajeria`.
 *
 * Toma el reporte de clima social (Anexo 04 general o Anexo 05 focalizado) y
 * produce el texto que se pega en WhatsApp: `*negritas*`, secciones numeradas y
 * una foto representativa opcional por URL (sólo `http`/`https`). Se eliminan
 * caracteres de control y de ancho cero que WhatsApp no admite.
 *
 * `formato=texto` (defecto) devuelve `text/plain`; `formato=pdf` la versión
 * imprimible; `formato=json` devuelve el texto junto con los faltantes.
 */
export async function GET(request: Request) {
  try {
    const sesion: SessionPayload = requireSession(request);
    const params = queryParams(request);
    const formato = leerFormato(params, FORMATOS, "texto");

    const tipo = (params.get("tipo") ?? "focalizado").trim().toLowerCase();
    const config = TIPOS[tipo];
    if (!config) {
      throw new ApiError(
        422,
        "El parámetro «tipo» debe ser «general» o «focalizado».",
        "TIPO_INVALIDO",
      );
    }

    const codigo =
      (params.get("codigo") ?? params.get("caso") ?? "").trim() || null;
    const foto = (params.get("foto") ?? "").trim() || null;
    const generadoEn = new Date();
    const contexto = contextoDesdeSesion(sesion, generadoEn);

    const resultado = await withSession(
      { usuarioId: sesion.uid, rolCodigo: sesion.rol },
      async (client) => {
        const documento = await obtenerDocumentoFuente(
          client,
          config.tipoId,
          codigo,
        );
        if (!documento) {
          const disponibilidad = await listarAnexosDisponibles(client);
          const info = disponibilidad.find(
            (anexo) => anexo.numero === config.numero,
          );
          return {
            documento: null,
            mensaje: "",
            faltantes: info?.faltantes ?? [
              "No hay reportes de clima social con resumen ejecutivo para generar el mensaje.",
            ],
          };
        }

        const mensaje = construirMensajeClimaSocial(documento, foto);
        return {
          documento,
          mensaje: mensaje.texto,
          faltantes: mensaje.faltantes,
        };
      },
    );

    if (!resultado.documento) {
      throw new ApiError(
        422,
        `No se puede armar el mensaje de ${config.etiqueta.toLowerCase()}. Faltantes: ${resultado.faltantes.join(
          " ",
        )}`,
        "ANEXO_SIN_DATOS",
      );
    }

    const base = `avisa_clima_social_${tipo}_${fechaArchivo(generadoEn)}`;
    const descarga = decidirDescarga(params, formato);

    if (formato === "json") {
      return jsonOk({
        tipo,
        referencia: `Anexo N° ${config.numero}`,
        disponible: true,
        faltantes: resultado.faltantes,
        generadoEn: generadoEn.toISOString(),
        texto: resultado.mensaje,
      });
    }

    if (formato === "pdf") {
      const docPdf: DocumentoAnexo = {
        titulo: "Clima social para mensajería",
        subtitulo: resultado.documento.titulo,
        referencia: `Anexo N° ${config.numero}`,
        orientacion: "portrait",
        meta: [
          { etiqueta: "Tipo", valor: config.etiqueta },
          { etiqueta: "Documento", valor: resultado.documento.codigo },
          {
            etiqueta: "Fecha",
            valor: fechaDdMmAaaa(resultado.documento.fecha) || "—",
          },
          { etiqueta: "Caso", valor: resultado.documento.casoCodigo },
        ],
        bloques: [
          {
            tipo: "parrafos",
            titulo: "Mensaje listo para WhatsApp",
            // En PDF no aplican las marcas de negrita de WhatsApp.
            texto: mensajeParaPdf(resultado.mensaje).replace(/\*/g, ""),
          },
        ],
        faltantes: resultado.faltantes,
      };

      return respuestaPdf(
        documentoPdf(docPdf, contexto),
        `${base}.pdf`,
        descarga,
      );
    }

    return respuestaTexto(resultado.mensaje, `${base}.txt`, descarga);
  } catch (error) {
    return jsonError(error);
  }
}
