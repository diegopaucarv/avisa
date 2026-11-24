import type { PoolClient } from "pg";

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
  obtenerAlertaFuente,
  obtenerDocumentoFuente,
  obtenerReunionFuente,
} from "@/lib/db/repos/export-anexos";
import { listReportes } from "@/lib/db/repos/reportes";
import type { SessionPayload } from "@/lib/db/auth";

import {
  CATALOGO_ANEXOS,
  construirAnexo03,
  construirAnexo16,
  construirAnexo17,
  construirAnexoDocumento,
  definicionAnexo,
  normalizarNumero,
  type DefinicionAnexo,
} from "../../lib/anexos";
import {
  documentoHtml,
  documentoPdf,
  fechaArchivo,
  respuestaHtml,
  respuestaPdf,
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
  "html",
  "pdf",
  "json",
] as const satisfies readonly FormatoDocumento[];

/** Rutas propias de los anexos que no pasan por el generador genérico. */
const RUTAS_PROPIAS: Readonly<Record<string, string>> = {
  "14": "/api/v1/export/anexo-14",
  "15": "/api/v1/export/anexo-15",
};

function decidirDescarga(
  params: URLSearchParams,
  formato: FormatoDocumento,
): boolean {
  return params.has("descarga")
    ? leerBooleano(params.get("descarga"))
    : formato !== "html";
}

/** Arma el documento del anexo según su fuente, o `null` si no hay registro. */
async function construir(
  client: PoolClient,
  definicion: DefinicionAnexo,
  numero: string,
  codigo: string | null,
): Promise<DocumentoAnexo | null> {
  switch (definicion.fuente) {
    case "alerta": {
      const alerta = await obtenerAlertaFuente(client, codigo);
      return alerta ? construirAnexo03(alerta) : null;
    }
    case "documento": {
      const tipo = definicion.tipoDocumento;
      if (!tipo) return null;
      const documento = await obtenerDocumentoFuente(client, tipo, codigo);
      return documento ? construirAnexoDocumento(numero, documento) : null;
    }
    case "reunion": {
      const reunion = await obtenerReunionFuente(client, codigo);
      return reunion ? construirAnexo16(reunion) : null;
    }
    case "reporte": {
      const reportes = await listReportes(client, {
        q: codigo ?? undefined,
        page: 1,
        pageSize: 1,
      });
      const reporte = reportes.items[0];
      return reporte ? construirAnexo17(reporte) : null;
    }
    default:
      return null;
  }
}

/**
 * Generador de anexos (ítems 75 y 86): `GET /api/v1/export/anexos/:numero`.
 *
 * Emite cualquiera de los anexos documentales con datos disponibles (03, 04,
 * 05, 06, 10, 12, 13, 16 y 17). El 14 y el 15 tienen su propio endpoint y aquí
 * se responde con la ruta correcta. `?codigo=` elige el documento, la alerta, la
 * reunión o el reporte; sin código se toma el más reciente que la RLS permita.
 *
 * Si la fuente no tiene registros, responde 422 `ANEXO_SIN_DATOS` con la lista
 * de campos faltantes: nunca devuelve un anexo vacío como si estuviera completo.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ numero: string }> },
) {
  try {
    const sesion: SessionPayload = requireSession(request);
    const params = queryParams(request);
    const { numero: crudo } = await context.params;

    const numero = normalizarNumero(crudo);
    if (!numero) {
      throw new ApiError(404, "Anexo desconocido.", "ANEXO_DESCONOCIDO");
    }

    const rutaPropia = RUTAS_PROPIAS[numero];
    if (rutaPropia) {
      throw new ApiError(
        422,
        `El Anexo N° ${numero} se genera en su propio endpoint: ${rutaPropia}.`,
        "ANEXO_RUTA_PROPIA",
      );
    }

    const definicion = definicionAnexo(numero);
    if (!definicion) {
      const disponibles = CATALOGO_ANEXOS.map((anexo) => anexo.numero).join(
        ", ",
      );
      throw new ApiError(
        404,
        `Anexo N° ${numero} desconocido. El generador cubre: ${disponibles}.`,
        "ANEXO_DESCONOCIDO",
      );
    }

    const formato = leerFormato(params, FORMATOS, "html");
    const codigo =
      (params.get("codigo") ?? params.get("caso") ?? "").trim() || null;
    const generadoEn = new Date();
    const contexto = contextoDesdeSesion(sesion, generadoEn);

    const { documento, faltantes, registros } = await withSession(
      { usuarioId: sesion.uid, rolCodigo: sesion.rol },
      async (client) => {
        const armado = await construir(client, definicion, numero, codigo);
        if (armado) {
          return {
            documento: armado,
            faltantes: armado.faltantes ?? [],
            registros: 1,
          };
        }

        const disponibilidad = await listarAnexosDisponibles(client);
        const info = disponibilidad.find((anexo) => anexo.numero === numero);
        return {
          documento: null,
          faltantes: info?.faltantes ?? [
            "No hay registros de origen para este anexo con los filtros aplicados.",
          ],
          registros: info?.registros ?? 0,
        };
      },
    );

    if (!documento) {
      throw new ApiError(
        422,
        `El Anexo N° ${numero} no se puede generar con los datos actuales. Faltantes: ${faltantes.join(
          " ",
        )}`,
        "ANEXO_SIN_DATOS",
      );
    }

    const base = `avisa_anexo_${numero}_${fechaArchivo(generadoEn)}`;

    if (formato === "json") {
      return jsonOk({
        numero,
        referencia: documento.referencia,
        titulo: documento.titulo,
        disponible: true,
        registros,
        faltantes,
        generadoEn: generadoEn.toISOString(),
        documento,
      });
    }

    const descarga = decidirDescarga(params, formato);

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
