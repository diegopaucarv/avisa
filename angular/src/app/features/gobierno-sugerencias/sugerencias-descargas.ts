import { parametrosConValor } from '../../core/http/coleccion';
import { urlApi } from '../../core/config/entorno';
import { hoyIso } from '../../core/fecha/zona-horaria';
import { ErrorApi } from '../../core/http/errores';

export type FormatoSugerencias = 'csv' | 'pdf';

/**
 * Descarga de la matriz de sugerencias.
 *
 * La sesión vive en una cookie `HttpOnly`, así que la exportación no puede ser
 * un `<a href>` directo: se pide con `fetch` (enviando la cookie) y se dispara
 * la descarga con un `Blob` temporal. Se usa una copia local de las utilidades
 * porque el endpoint es propio (`/v1/sugerencias/export`) y no pasa por
 * `/v1/export`; es el mismo patrón de `MatrizConflictividadService`.
 */
export async function descargarSugerencias(
  formato: FormatoSugerencias,
  filtros: Record<string, string | number | null | undefined>,
): Promise<void> {
  const parametros = parametrosConValor({ ...filtros, formato });
  const url = `${urlApi('/v1/sugerencias/export')}?${new URLSearchParams(parametros).toString()}`;

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      credentials: 'include',
      headers: { Accept: formato === 'csv' ? 'text/csv' : 'application/pdf' },
    });
  } catch {
    throw new ErrorApi('No hay conexión con el servidor.', 0, 'CLIENT_ERROR');
  }

  if (!respuesta.ok) {
    let detalle = 'No se pudo generar la descarga.';
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
    `avisa_sugerencias_${fechaDeHoy()}.${formato}`;

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

/**
 * Nombre propuesto por el servidor en `Content-Disposition`. Se prefiere la
 * forma `filename*=UTF-8''…` (RFC 5987) porque admite acentos.
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

function fechaDeHoy(): string {
  return hoyIso();
}
