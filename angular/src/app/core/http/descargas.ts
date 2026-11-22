import { urlApi } from '../config/entorno';
import { ErrorApi } from './errores';

/** Formatos que entiende `GET /api/v1/export`. */
export type FormatoExportacion = 'json' | 'excel' | 'pdf';

export type OpcionesExportacion = {
  /** Entidad lógica (`documentos`, `casos`, …) o `base`. */
  entidad: string;
  formato: FormatoExportacion;
  /** Exporta sólo el registro con ese uuid. */
  id?: string | null;
  /**
   * Filtros, búsqueda y orden vigentes en la vista. Se anexan a la URL para que
   * la exportación coincida con lo que la pantalla está mostrando.
   */
  consulta?: Record<string, string> | null;
};

const EXTENSIONES: Record<FormatoExportacion, string> = {
  json: 'json',
  excel: 'xlsx',
  pdf: 'pdf',
};

const ACEPTADOS: Record<FormatoExportacion, string> = {
  json: 'application/json',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

function fechaDeHoy(): string {
  return new Date().toISOString().slice(0, 10);
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
 * Descarga autenticada.
 *
 * La sesión vive en una cookie `HttpOnly`, así que no se puede usar un `<a>`
 * directo: se pide el archivo con `fetch` (enviando la cookie) y se dispara la
 * descarga con un `Blob` temporal. Los errores de la API se traducen a
 * `ErrorApi`, igual que el resto de las llamadas de la SPA.
 */
export async function descargarExportacion(opciones: OpcionesExportacion): Promise<void> {
  const parametros = new URLSearchParams({
    formato: opciones.formato,
    entidad: opciones.entidad,
  });
  if (opciones.id) parametros.set('id', opciones.id);
  for (const [clave, valor] of Object.entries(opciones.consulta ?? {})) {
    if (!valor) continue;
    parametros.set(clave, valor);
  }

  const url = `${urlApi('/v1/export')}?${parametros.toString()}`;

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      credentials: 'include',
      headers: { Accept: ACEPTADOS[opciones.formato] },
    });
  } catch {
    throw new ErrorApi('No hay conexión con el servidor.', 0, 'CLIENT_ERROR');
  }

  if (!respuesta.ok) {
    let detalle = 'No se pudo generar la exportación.';
    let codigo = 'HTTP_ERROR';

    try {
      const cuerpo = (await respuesta.json()) as {
        detail?: unknown;
        code?: unknown;
      };
      if (typeof cuerpo.detail === 'string' && cuerpo.detail) {
        detalle = cuerpo.detail;
      }
      if (typeof cuerpo.code === 'string' && cuerpo.code) {
        codigo = cuerpo.code;
      }
    } catch {
      // El cuerpo del error no era JSON (o venía vacío).
    }

    throw new ErrorApi(detalle, respuesta.status, codigo);
  }

  const archivo = await respuesta.blob();
  const nombre =
    nombreDesdeCabecera(respuesta.headers.get('content-disposition')) ??
    `avisa_${opciones.entidad}_${fechaDeHoy()}.${EXTENSIONES[opciones.formato]}`;

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
