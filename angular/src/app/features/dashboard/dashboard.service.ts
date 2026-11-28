import { Injectable } from '@angular/core';

import { urlConParametros } from '../../core/http/coleccion';
import { ErrorApi } from '../../core/http/errores';
import { urlApi } from '../../core/config/entorno';
import { hoyIso } from '../../core/fecha/zona-horaria';

/**
 * Descarga del dashboard analítico en CSV.
 *
 * La sesión vive en una cookie `HttpOnly`: la exportación no puede ser un
 * `<a href>`. Se pide con `fetch` (enviando la cookie) y se dispara la descarga
 * con un `Blob` temporal. Es una copia local de `MatrizConflictividadService`
 * porque el endpoint es propio (`/v1/analitica/export`); no se importa desde
 * otra pantalla para no acoplar dos módulos distintos.
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  /** Descarga el CSV de resumen y volumen con los filtros vigentes. */
  async descargarCsv(filtros: Record<string, string | number | null | undefined>): Promise<void> {
    const url = urlConParametros(urlApi('/v1/analitica/export'), filtros);

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
      `avisa_dashboard_analitico_${fechaDeHoy()}.csv`;

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
  return hoyIso();
}
