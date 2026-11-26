import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from, map, switchMap } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { ErrorApi } from '../../core/http/errores';
import {
  aExtraccionDocumento,
  aVersionDocumento,
  type ExtraccionDocumento,
  type VersionDocumento,
} from './documento.mapeo';

/**
 * Mismo tope que los adjuntos genéricos (`core.adjunto`). El servidor lo vuelve
 * a aplicar; esto sólo evita enviar 60 MB por la red para recibir un 413.
 */
export const MAX_DOCUMENTO_BYTES = 20 * 1024 * 1024;

/**
 * Extensiones que hoy declara `core.documento_lista_blanca`. Es sólo la pista
 * del selector; la lista blanca real la impone la API y puede cambiar en la
 * base sin tocar esta pantalla.
 */
export const ACEPTADOS_DOCUMENTO =
  '.pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.docx,.xlsx,.pptx';

/**
 * Archivo, versiones y extracciones de un documento.
 *
 * El binario viaja en base64 para la subida (igual que `AdjuntosService`) y se
 * descarga con `fetch` + `Blob` porque la sesión vive en una cookie `HttpOnly`:
 * un `<a href>` directo no enviaría credenciales.
 */
@Injectable({ providedIn: 'root' })
export class DocumentoArchivoService {
  private readonly http = inject(HttpClient);

  /** Sube o reemplaza el archivo. El servidor versiona el anterior. */
  subir(
    id: string,
    archivo: File,
    nota: string | null = null,
  ): Observable<void> {
    return from(leerBase64(archivo)).pipe(
      switchMap((contenidoBase64) =>
        this.http.post<unknown>(
          urlApi(`/v1/documents/${encodeURIComponent(id)}/archivo`),
          {
            nombre: archivo.name,
            mime: archivo.type || null,
            nota,
            contenidoBase64,
          },
        ),
      ),
      map(() => undefined),
    );
  }

  listarVersiones(id: string): Observable<VersionDocumento[]> {
    return this.http
      .get<{ items?: unknown }>(
        urlApi(`/v1/documents/${encodeURIComponent(id)}/versiones`),
      )
      .pipe(
        map((respuesta) =>
          Array.isArray(respuesta?.items)
            ? respuesta.items.map(aVersionDocumento)
            : [],
        ),
      );
  }

  listarExtracciones(id: string): Observable<ExtraccionDocumento[]> {
    return this.http
      .get<{ items?: unknown }>(
        urlApi(`/v1/documents/${encodeURIComponent(id)}/extraccion`),
      )
      .pipe(
        map((respuesta) =>
          Array.isArray(respuesta?.items)
            ? respuesta.items.map(aExtraccionDocumento)
            : [],
        ),
      );
  }

  extraer(
    id: string,
    tipo: 'ocr' | 'temas',
  ): Observable<ExtraccionDocumento> {
    return this.http
      .post<unknown>(
        urlApi(`/v1/documents/${encodeURIComponent(id)}/extraccion`),
        { tipo },
      )
      .pipe(map(aExtraccionDocumento));
  }

  /** Blob del archivo vigente (para el visor). */
  async blobActual(id: string): Promise<Blob> {
    const respuesta = await this.pedir(
      urlApi(`/v1/documents/${encodeURIComponent(id)}/archivo`),
    );
    return this.blobDe(respuesta, 'No se pudo cargar el archivo del documento.');
  }

  /** Blob de una versión concreta. */
  async blobVersion(id: string, numero: number): Promise<Blob> {
    const respuesta = await this.pedir(
      urlApi(
        `/v1/documents/${encodeURIComponent(id)}/versiones/${numero}`,
      ),
    );
    return this.blobDe(respuesta, 'No se pudo cargar la versión del archivo.');
  }

  async descargarActual(id: string, nombreSugerido: string): Promise<void> {
    const respuesta = await this.pedir(
      urlApi(`/v1/documents/${encodeURIComponent(id)}/archivo`),
    );
    await this.descargarRespuesta(respuesta, nombreSugerido);
  }

  async descargarVersion(
    id: string,
    numero: number,
    nombreSugerido: string,
  ): Promise<void> {
    const respuesta = await this.pedir(
      urlApi(
        `/v1/documents/${encodeURIComponent(id)}/versiones/${numero}`,
      ),
    );
    await this.descargarRespuesta(respuesta, nombreSugerido);
  }

  private async pedir(url: string): Promise<Response> {
    try {
      return await fetch(url, { credentials: 'include' });
    } catch {
      throw new ErrorApi('No hay conexión con el servidor.', 0, 'CLIENT_ERROR');
    }
  }

  private async blobDe(
    respuesta: Response,
    respaldo: string,
  ): Promise<Blob> {
    if (!respuesta.ok) {
      throw await errorDeRespuesta(respuesta, respaldo);
    }
    return respuesta.blob();
  }

  private async descargarRespuesta(
    respuesta: Response,
    nombreSugerido: string,
  ): Promise<void> {
    const archivo = await this.blobDe(
      respuesta,
      'No se pudo descargar el archivo del documento.',
    );
    const nombre =
      nombreDesdeCabecera(respuesta.headers.get('content-disposition')) ??
      nombreSugerido;

    const enlace = document.createElement('a');
    const objeto = URL.createObjectURL(archivo);
    enlace.href = objeto;
    enlace.download = nombre;
    enlace.rel = 'noopener';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(objeto), 0);
  }
}

async function errorDeRespuesta(
  respuesta: Response,
  respaldo: string,
): Promise<ErrorApi> {
  let detalle = respaldo;
  let codigo = 'HTTP_ERROR';
  try {
    const cuerpo = (await respuesta.json()) as {
      detail?: unknown;
      code?: unknown;
    };
    if (typeof cuerpo.detail === 'string' && cuerpo.detail) detalle = cuerpo.detail;
    if (typeof cuerpo.code === 'string' && cuerpo.code) codigo = cuerpo.code;
  } catch {
    // El cuerpo del error no era JSON.
  }
  return new ErrorApi(detalle, respuesta.status, codigo);
}

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
