import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, map, switchMap } from 'rxjs';

import { urlApi } from '../config/entorno';
import { ErrorApi } from './errores';

export type EntidadAdjunto =
  | 'alerta'
  | 'compromiso'
  | 'hito'
  | 'documento'
  | 'reunion'
  | 'caso'
  | 'demanda';

export type Adjunto = {
  id: string;
  entidadTipo: EntidadAdjunto;
  entidadId: string;
  nombre: string;
  mime: string | null;
  tamanoBytes: number | null;
  hashSha256: string | null;
  descripcion: string | null;
  subidoPor: string | null;
  createdAt: string;
};

/** Mismo máximo que aplica la API (`core.adjunto`). */
export const MAX_ADJUNTO_BYTES = 20 * 1024 * 1024;

/**
 * Adjuntos de cualquier entidad.
 *
 * La API guarda el binario en `core.adjunto` y lo devuelve con la sesión de la
 * cookie, así que la descarga no puede ser un `<a href>` directo: se pide con
 * `fetch` y se dispara con un `Blob` temporal, igual que las exportaciones.
 */
@Injectable({ providedIn: 'root' })
export class AdjuntosService {
  private readonly http = inject(HttpClient);

  listar(entidadTipo: EntidadAdjunto, entidadId: string): Observable<Adjunto[]> {
    const params = new HttpParams()
      .set('entidadTipo', entidadTipo)
      .set('entidadId', entidadId);
    return this.http
      .get<{ items?: Adjunto[] }>(urlApi('/v1/adjuntos'), { params })
      .pipe(map((respuesta) => respuesta?.items ?? []));
  }

  subir(
    entidadTipo: EntidadAdjunto,
    entidadId: string,
    archivo: File,
    descripcion: string | null = null,
  ): Observable<Adjunto> {
    return from(leerBase64(archivo)).pipe(
      switchMap((contenidoBase64) =>
        this.http.post<Adjunto>(urlApi('/v1/adjuntos'), {
          entidadTipo,
          entidadId,
          nombre: archivo.name,
          mime: archivo.type || null,
          descripcion,
          contenidoBase64,
        }),
      ),
    );
  }

  eliminar(id: string, motivo: string): Observable<void> {
    return this.http
      .delete<void>(urlApi(`/v1/adjuntos/${id}`), { body: { motivo } })
      .pipe(map(() => undefined));
  }

  /** Descarga autenticada con el nombre original del archivo. */
  async descargar(adjunto: Adjunto): Promise<void> {
    let respuesta: Response;
    try {
      respuesta = await fetch(urlApi(`/v1/adjuntos/${adjunto.id}`), {
        credentials: 'include',
      });
    } catch {
      throw new ErrorApi('No hay conexión con el servidor.', 0, 'CLIENT_ERROR');
    }

    if (!respuesta.ok) {
      let detalle = 'No se pudo descargar el adjunto.';
      let codigo = 'HTTP_ERROR';
      try {
        const cuerpo = (await respuesta.json()) as { detail?: unknown; code?: unknown };
        if (typeof cuerpo.detail === 'string' && cuerpo.detail) detalle = cuerpo.detail;
        if (typeof cuerpo.code === 'string' && cuerpo.code) codigo = cuerpo.code;
      } catch {
        // El error no era JSON.
      }
      throw new ErrorApi(detalle, respuesta.status, codigo);
    }

    const archivo = await respuesta.blob();
    const enlace = document.createElement('a');
    const objeto = URL.createObjectURL(archivo);
    enlace.href = objeto;
    enlace.download = adjunto.nombre;
    enlace.rel = 'noopener';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(objeto), 0);
  }
}

function leerBase64(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onerror = () => rechazar(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const resultado = lector.result;
      if (typeof resultado !== 'string') {
        rechazar(new Error('No se pudo leer el archivo.'));
        return;
      }
      const coma = resultado.indexOf(',');
      resolver(coma >= 0 ? resultado.slice(coma + 1) : resultado);
    };
    lector.readAsDataURL(archivo);
  });
}
