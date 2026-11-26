import { ErrorApi } from '../../core/http/errores';

/**
 * Utilidades de la galería de anexos.
 *
 * La sesión vive en una cookie `HttpOnly`, así que ni el `iframe` ni un `<a>`
 * pueden apuntar directo a la API: se pide el documento con `fetch` (enviando la
 * cookie) y se trabaja con un `Blob` temporal, igual que en
 * `core/http/descargas.ts`. Aquí se usa una copia local porque estas rutas
 * (`/v1/export/anexo-14`, `/v1/export/anexos/:numero`, …) no pasan por
 * `/v1/export`.
 */

/** Formatos que admite el motor de anexos. */
export type FormatoAnexo = 'html' | 'pdf' | 'xlsx' | 'json' | 'texto';

export type AnexoDisponible = {
  numero: string;
  titulo: string;
  referencia: string;
  disponible: boolean;
  registros: number;
  total: number;
  formatos: string[];
  faltantes: string[];
  ruta: string;
  endpoint: string;
};

export type RespuestaAnexos = {
  generadoEn: string;
  anexos: AnexoDisponible[];
};

export type RespuestaAnexo = {
  blob: Blob;
  nombre: string;
  tipo: string;
};

const ACEPTADOS: Record<FormatoAnexo, string> = {
  html: 'text/html',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json',
  texto: 'text/plain',
};

const EXTENSIONES: Record<FormatoAnexo, string> = {
  html: 'html',
  pdf: 'pdf',
  xlsx: 'xlsx',
  json: 'json',
  texto: 'txt',
};

export function extensionDe(formato: FormatoAnexo): string {
  return EXTENSIONES[formato];
}

export function esFormatoAnexo(valor: string): valor is FormatoAnexo {
  return valor in ACEPTADOS;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function listaDeTexto(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((item): item is string => typeof item === 'string');
}

/** Normaliza la respuesta de `GET /v1/export/anexos` sin confiar en su forma. */
export function aRespuestaAnexos(bruto: unknown): RespuestaAnexos {
  const registro = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  const lista = Array.isArray(registro['anexos']) ? registro['anexos'] : [];

  const anexos = lista
    .map((item): AnexoDisponible => {
      const fila = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        numero: texto(fila['numero']),
        titulo: texto(fila['titulo']),
        referencia: texto(fila['referencia']),
        disponible: fila['disponible'] === true,
        registros: Number(fila['registros'] ?? 0) || 0,
        total: Number(fila['total'] ?? 0) || 0,
        formatos: listaDeTexto(fila['formatos']),
        faltantes: listaDeTexto(fila['faltantes']),
        ruta: texto(fila['ruta']),
        endpoint: texto(fila['endpoint']),
      };
    })
    .filter((anexo) => anexo.numero !== '');

  return { generadoEn: texto(registro['generadoEn']), anexos };
}

/** Nombre propuesto por el servidor en `Content-Disposition` (RFC 5987 primero). */
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
 * Pide un documento al motor de anexos. Traduce los errores de la API a
 * `ErrorApi` (con el `detail` que explica qué falta) para que la página lo
 * muestre en lugar de descargar un archivo vacío.
 */
export async function pedirAnexo(
  url: string,
  formato: FormatoAnexo,
  nombreSugerido: string,
): Promise<RespuestaAnexo> {
  const aceptar = ACEPTADOS[formato];

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      credentials: 'include',
      headers: { Accept: aceptar },
    });
  } catch {
    throw new ErrorApi('No hay conexión con el servidor.', 0, 'CLIENT_ERROR');
  }

  if (!respuesta.ok) {
    let detalle = 'No se pudo generar el anexo.';
    let codigo = 'HTTP_ERROR';

    try {
      const cuerpo = (await respuesta.json()) as { detail?: unknown; code?: unknown };
      if (typeof cuerpo.detail === 'string' && cuerpo.detail) detalle = cuerpo.detail;
      if (typeof cuerpo.code === 'string' && cuerpo.code) codigo = cuerpo.code;
    } catch {
      // El cuerpo del error no era JSON.
    }

    throw new ErrorApi(detalle, respuesta.status, codigo);
  }

  const blob = await respuesta.blob();
  const nombre =
    nombreDesdeCabecera(respuesta.headers.get('content-disposition')) ?? nombreSugerido;

  return { blob, nombre, tipo: respuesta.headers.get('content-type') ?? aceptar };
}

/** Dispara la descarga de un `Blob` ya obtenido. */
export function descargarBlob(blob: Blob, nombre: string): void {
  const objeto = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = objeto;
  enlace.download = nombre;
  enlace.rel = 'noopener';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();

  // Se libera en el siguiente turno para no cortar la descarga en Safari.
  setTimeout(() => URL.revokeObjectURL(objeto), 0);
}
