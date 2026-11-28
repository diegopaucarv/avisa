import { registrarDescarga } from "@/lib/db/auditoria-descargas";
import { jsonError } from "@/lib/db/errors";
import {
  jsonOk,
  leerBooleano,
  queryParams,
  requireSession,
} from "@/lib/db/http";
import { withSession } from "@/lib/db/tenant";
import {
  listarConflictividad,
  verificarEsquemaConflictividad,
  type ConflictividadListQuery,
} from "@/lib/db/repos/conflictividad";

import { construirAnexo15, describirFiltros } from "../lib/anexos";
import {
  fechaArchivo,
  fechaDdMmAaaa,
  fechaHoraLima,
  documentoHtml,
  documentoPdf,
  respuestaHtml,
  respuestaPdf,
} from "../lib/documento";
import {
  contextoDesdeSesion,
  leerFormato,
  type FormatoDocumento,
} from "../lib/contexto";
import type { SessionPayload } from "@/lib/db/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATOS = [
  "html",
  "pdf",
  "json",
] as const satisfies readonly FormatoDocumento[];

const ETIQUETAS_FILTRO: Readonly<Record<string, string>> = {
  region: "Región",
  alcance: "Alcance",
  subsector: "Subsector",
  estado: "Estado",
  nivel: "Nivel",
  prioridad: "Prioridad",
  desde: "Desde",
  hasta: "Hasta",
  q: "Búsqueda",
  orden: "Orden",
};

const FILTROS = Object.keys(ETIQUETAS_FILTRO) as readonly string[];

/** Filtros de la matriz de conflictividad, con los mismos nombres que `/conflictividad`. */
function leerFiltros(params: URLSearchParams): ConflictividadListQuery {
  const filtros: ConflictividadListQuery = { todas: true };
  const get = (clave: string): string => (params.get(clave) ?? "").trim();

  const region = get("region");
  if (region) filtros.region = region;
  const alcance = get("alcance");
  if (alcance) filtros.alcance = alcance;
  const subsector = get("subsector");
  if (subsector) filtros.subsector = subsector;
  const estado = get("estado");
  if (estado) filtros.estado = estado;
  const nivel = get("nivel");
  if (nivel) filtros.nivel = nivel;
  const prioridad = get("prioridad");
  if (prioridad) filtros.prioridad = prioridad;
  const desde = get("desde");
  if (desde) filtros.desde = desde;
  const hasta = get("hasta");
  if (hasta) filtros.hasta = hasta;
  const q = get("q");
  if (q) filtros.q = q;
  const orden = get("orden");
  if (orden) filtros.orden = orden;

  return filtros;
}

/** Rótulos legibles de los filtros aplicados (fechas en `dd/mm/aaaa`). */
function describir(params: URLSearchParams): string[] {
  const valores: Record<string, string | null> = {};
  for (const clave of FILTROS) {
    const crudo = (params.get(clave) ?? "").trim();
    if (!crudo) continue;
    valores[clave] =
      clave === "desde" || clave === "hasta"
        ? fechaDdMmAaaa(crudo) || crudo
        : crudo;
  }
  return describirFiltros(ETIQUETAS_FILTRO, valores);
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
 * Anexo 15 — Matriz de Conflictividad, en vista imprimible (HTML autocontenido,
 * A4 horizontal con membrete OAIPCS) o PDF.
 *
 * Consume `analytics.vw_anexo_15_matriz_conflictividad` a través del repositorio
 * de conflictividad: no reimplementa la consulta ni la regla de negocio. La
 * exportación CSV sigue viviendo en `/v1/conflictividad/export`. Sin paginar; si
 * el conjunto supera el tope del repositorio, se propaga el 413.
 *
 * En HTML una celda sin dato dice «—»; en PDF queda como «-». Nunca se estima.
 */
export async function GET(request: Request) {
  try {
    const sesion: SessionPayload = requireSession(request);
    const params = queryParams(request);
    const formato = leerFormato(params, FORMATOS, "html");
    const filtros = leerFiltros(params);

    const resultado = await withSession(
      { usuarioId: sesion.uid, rolCodigo: sesion.rol },
      async (client) => {
        await verificarEsquemaConflictividad(client);
        return listarConflictividad(client, filtros);
      },
    );

    const generadoEn = new Date();
    const contexto = contextoDesdeSesion(sesion, generadoEn);
    const documento = construirAnexo15(
      resultado.items,
      resultado.resumen,
      describir(params),
      fechaHoraLima(generadoEn),
    );
    const base = `avisa_anexo_15_${fechaArchivo(generadoEn)}`;
    const descarga = decidirDescarga(params, formato);

    const auditar = () =>
      registrarDescarga(request, sesion, {
        entidad: "anexo-15",
        formato,
        filtros: { ...filtros },
        filas: resultado.items.length,
      });

    if (formato === "json") {
      await auditar();
      return jsonOk({
        numero: "15",
        referencia: documento.referencia,
        titulo: documento.titulo,
        generadoEn: generadoEn.toISOString(),
        resumen: resultado.resumen,
        total: resultado.total,
        filtros: describir(params),
        faltantes: documento.faltantes ?? [],
        filas: resultado.items,
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
