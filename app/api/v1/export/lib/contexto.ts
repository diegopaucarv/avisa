import { ApiError } from "@/lib/db/errors";
import type { SessionPayload } from "@/lib/db/auth";

import type { ContextoDocumento } from "./documento";

/**
 * Piezas comunes de las rutas de exportación de anexos.
 *
 * Aquí sólo se resuelve lo que rodea al documento: quién lo emite (para el pie
 * «… · usuario»), qué formato se pidió y si las fechas son válidas. El contenido
 * y su presentación viven en `anexos.ts` y `documento.ts`.
 */

/** Formatos que puede devolver esta familia de rutas. */
export type FormatoDocumento = "html" | "pdf" | "xlsx" | "json" | "texto";

/** Contexto del documento a partir de la sesión ya validada por la ruta. */
export function contextoDesdeSesion(
  sesion: SessionPayload,
  generadoEn: Date = new Date(),
): ContextoDocumento {
  return {
    usuario: sesion.nom || sesion.cod || sesion.uid,
    cargo: sesion.cargo || null,
    area: sesion.area || null,
    generadoEn,
  };
}

/**
 * Lee `?formato=`. Sin valor usa `porDefecto`; con un valor no permitido responde
 * 422 para que la galería muestre el motivo en lugar de un archivo vacío.
 */
export function leerFormato(
  params: URLSearchParams,
  permitidos: readonly FormatoDocumento[],
  porDefecto: FormatoDocumento,
): FormatoDocumento {
  const crudo = (params.get("formato") ?? "").trim().toLowerCase();
  if (!crudo) return porDefecto;

  if ((permitidos as readonly string[]).includes(crudo)) {
    return crudo as FormatoDocumento;
  }

  throw new ApiError(
    422,
    `Formato «${crudo}» no soportado. Use: ${permitidos.join(", ")}.`,
    "FORMATO_INVALIDO",
  );
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida una fecha `YYYY-MM-DD` de los parámetros y la devuelve tal cual (o
 * `null` si viene vacía). Un valor mal formado se rechaza con 422.
 */
export function leerFecha(
  params: URLSearchParams,
  clave: string,
): string | null {
  const crudo = (params.get(clave) ?? "").trim();
  if (!crudo) return null;

  if (!FECHA_ISO.test(crudo)) {
    throw new ApiError(
      422,
      `El parámetro «${clave}» debe tener el formato aaaa-mm-dd.`,
      "FECHA_INVALIDA",
    );
  }

  const fecha = new Date(`${crudo}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) {
    throw new ApiError(
      422,
      `El parámetro «${clave}» no es una fecha válida.`,
      "FECHA_INVALIDA",
    );
  }
  return crudo;
}

/** Valida un rango de fechas y responde 422 si el inicio es posterior al fin. */
export function leerRangoFechas(
  params: URLSearchParams,
  desdeClave = "desde",
  hastaClave = "hasta",
): { desde: string | null; hasta: string | null } {
  const desde = leerFecha(params, desdeClave);
  const hasta = leerFecha(params, hastaClave);

  if (desde && hasta && desde > hasta) {
    throw new ApiError(
      422,
      "El rango de fechas está invertido: «desde» es posterior a «hasta».",
      "RANGO_INVALIDO",
    );
  }

  return { desde, hasta };
}
