import { Injectable } from '@angular/core';

import { parametrosConValor } from '../../core/http/coleccion';
import { ErrorApi } from '../../core/http/errores';
import { urlApi } from '../../core/config/entorno';

/**
 * Descarga de la matriz de conflictividad (Anexo 15).
 *
 * La sesión vive en una cookie `HttpOnly`, así que la exportación no puede ser
 * un `<a href>` directo: se pide con `fetch` (enviando la cookie) y se dispara
 * la descarga con un `Blob` temporal, igual que en `core/http/descargas.ts`.
 * Aquí se usa una copia local de las utilidades porque el endpoint de la matriz
 * es propio (`/v1/conflictividad/export`) y no pasa por `/v1/export`.
 */
@Injectable({ providedIn: 'root' })
export class MatrizConflictividadService {
  /**
   * Descarga el CSV con los filtros vigentes. El servidor ignora la paginación
   * y devuelve todas las filas que coinciden; si el conjunto excede el tope
   * responde 413 y se propaga como `ErrorApi` para que la página lo muestre.
   */
  async descargarCsv(
    filtros: Record<string, string | number | null | undefined>,
  ): Promise<void> {
    const parametros = parametrosConValor({ ...filtros, todas: '1' });
    const url = `${urlApi('/v1/conflictividad/export')}?${new URLSearchParams(
      parametros,
    ).toString()}`;

    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'text/csv' },
      });
    } catch {
      throw new ErrorApi('No hay conexión con el servidor.', 0, 'CLIENT_ERROR');
    }

    if (!respuesta.ok) {
      let detalle = 'No se pudo generar la descarga.';
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
      this.nombreDesdeCabecera(respuesta.headers.get('content-disposition')) ??
      `avisa_anexo_15_matriz_conflictividad_${fechaDeHoy()}.csv`;

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
  private nombreDesdeCabecera(valor: string | null): string | null {
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
}

function fechaDeHoy(): string {
  return new Date().toISOString().slice(0, 10);
}
