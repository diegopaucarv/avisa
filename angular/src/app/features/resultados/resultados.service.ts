import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { urlConParametros } from '../../core/http/coleccion';
import { aDetalleDocumento, type Documento } from '../documentos/documento.mapeo';
import {
  aActores,
  aActorCreado,
  aExtraccion,
  aReuniones,
  aVinculacion,
  type ActorOpcion,
  type Extraccion,
  type ReunionResumen,
  type Vinculacion,
} from './resultados.mapeo';

/** Asistente tal como lo envía la pantalla a `POST /v1/resultados/asistentes`. */
export type AsistenteEnvio = {
  nombre: string;
  cargo?: string | null;
  actorId?: string | null;
  omitido?: boolean;
};

/** Naturaleza para el alta rápida; es lo único obligatorio junto al nombre. */
export type NaturalezaActor = 'persona' | 'organizacion';

/**
 * HTTP de la pantalla de resultados de reunión.
 *
 * Lo propio (`/v1/resultados/**`) vive aquí. El alta y la búsqueda de actores
 * usan `/v1/actors`, la misma API del directorio: la pantalla no reimplementa
 * reglas de actor, sólo consume el contrato.
 */
@Injectable({ providedIn: 'root' })
export class ResultadosService {
  private readonly http = inject(HttpClient);

  listarReuniones(q: string, limite = 20): Observable<ReunionResumen[]> {
    const url = urlConParametros(urlApi('/v1/resultados/reuniones'), {
      q: q.trim() || undefined,
      tamano: limite,
      pageSize: limite,
    });
    return this.http.get<unknown>(url).pipe(map((bruto) => aReuniones(bruto)));
  }

  extraer(reunionId: string, adjuntoId: string): Observable<Extraccion> {
    return this.http
      .post<unknown>(urlApi('/v1/resultados/extraccion'), { reunionId, adjuntoId })
      .pipe(map((bruto) => aExtraccion(bruto)));
  }

  vincular(reunionId: string, asistentes: readonly AsistenteEnvio[]): Observable<Vinculacion> {
    return this.http
      .post<unknown>(urlApi('/v1/resultados/asistentes'), { reunionId, asistentes })
      .pipe(map((bruto) => aVinculacion(bruto)));
  }

  buscarActores(q: string, limite = 20): Observable<ActorOpcion[]> {
    const url = urlConParametros(urlApi('/v1/actors'), {
      q: q.trim(),
      pageSize: limite,
    });
    return this.http.get<unknown>(url).pipe(map((bruto) => aActores(bruto)));
  }

  /**
   * Cambia el paso del flujo de un producto del diálogo.
   *
   * Se reutiliza `PATCH /v1/documents/:id` con `estado`, el mismo contrato que
   * ya usa la ficha de documentos para Validar/Rechazar. No se inventa una
   * ruta ni se reescriben campos: el repositorio valida el literal.
   */
  actualizarEstado(id: string, estado: string): Observable<Documento> {
    return this.http
      .patch<unknown>(urlApi(`/v1/documents/${encodeURIComponent(id)}`), { estado })
      .pipe(map((bruto) => aDetalleDocumento(bruto).documento));
  }

  crearActor(nombre: string, naturaleza: NaturalezaActor): Observable<ActorOpcion> {
    return this.http
      .post<unknown>(urlApi('/v1/actors'), { nombre: nombre.trim(), naturaleza })
      .pipe(
        map((bruto) => {
          const actor = aActorCreado(bruto);
          if (!actor) {
            throw new Error('La API no devolvió el actor creado.');
          }
          return actor;
        }),
      );
  }
}
