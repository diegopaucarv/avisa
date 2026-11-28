import { urlApi } from '../../core/config/entorno';
import { hoyIso } from '../../core/fecha/zona-horaria';
import { ErrorApi } from '../../core/http/errores';

/** Formatos que entiende `GET /api/v1/export/alertas`. */
export type FormatoAlertas = 'csv' | 'xlsx';

const EXTENSIONES: Record<FormatoAlertas, string> = {
  csv: 'csv',
  xlsx: 'xlsx',
};

const ACEPTADOS: Record<FormatoAlertas, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * URL de la exportación de alertas con los filtros vigentes de la vista.
 *
 * Sólo viajan los parámetros con valor; el `formato` va siempre. Se expone
 * aparte de la descarga para poder verificarla sin red.
 */
export function urlExportacionAlertas(
  formato: FormatoAlertas,
  consulta: Record<string, string> | null | undefined,
): string {
  const parametros = new URLSearchParams({ formato });
  for (const [clave, valor] of Object.entries(consulta ?? {})) {
    if (!valor) continue;
    parametros.set(clave, valor);
  }
  return `${urlApi('/v1/export/alertas')}?${parametros.toString()}`;
}

/**
 * Nombre que propone el servidor en `Content-Disposition`. Se prefiere la forma
 * `filename*=UTF-8''…` (RFC 5987) porque admite acentos.
 */
function nombreDesdeCabecera(valor: string | null): string | null {
  if (!valor) return null;

  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(valor);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }

  const simple = /filename="?([^";]+)"?/i.exec(valor);
  return simple?.[1]?.trim() || null;
}

/**
 * Descarga autenticada de la exportación de alertas.
 *
 * La sesión vive en una cookie `HttpOnly`, así que se pide el archivo con
 * `fetch` (enviando la cookie) y se dispara la descarga con un `Blob` temporal.
 * Los errores JSON de la API se traducen a `ErrorApi`, igual que el resto de la
 * SPA; un 422 por exceso de filas llega como mensaje legible.
 */
export async function descargarAlertas(
  formato: FormatoAlertas,
  consulta: Record<string, string> | null | undefined,
): Promise<void> {
  const url = urlExportacionAlertas(formato, consulta);

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      credentials: 'include',
      headers: { Accept: ACEPTADOS[formato] },
    });
  } catch {
    throw new ErrorApi('No hay conexión con el servidor.', 0, 'CLIENT_ERROR');
  }

  if (!respuesta.ok) {
    let detalle = 'No se pudo generar la exportación.';
    let codigo = 'HTTP_ERROR';

    try {
      const cuerpo = (await respuesta.json()) as { detail?: unknown; code?: unknown };
      if (typeof cuerpo.detail === 'string' && cuerpo.detail) detalle = cuerpo.detail;
      if (typeof cuerpo.code === 'string' && cuerpo.code) codigo = cuerpo.code;
    } catch {
      // El cuerpo del error no era JSON (o venía vacío).
    }

    throw new ErrorApi(detalle, respuesta.status, codigo);
  }

  const archivo = await respuesta.blob();
  const nombre =
    nombreDesdeCabecera(respuesta.headers.get('content-disposition')) ??
    `avisa_alertas_${hoyIso()}.${EXTENSIONES[formato]}`;

  const enlace = document.createElement('a');
  const objeto = URL.createObjectURL(archivo);
  enlace.href = objeto;
  enlace.download = nombre;
  enlace.rel = 'noopener';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();

  // Se libera en el siguiente turno para no cortar la descarga en Safari.
  setTimeout(() => URL.revokeObjectURL(objeto), 0);
}
