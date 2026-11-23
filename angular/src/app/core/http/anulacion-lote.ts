import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { urlApi } from '../config/entorno';

/** Entidades que admiten anulación en lote (las de `POST /v1/anular-lote`). */
export type EntidadAnulableLote =
  | 'alertas'
  | 'casos'
  | 'compromisos'
  | 'documentos'
  | 'demandas';

export type ResultadoAnulacionLote = { anulados: number };

/**
 * Anulación lógica de varios registros en una sola transacción.
 *
 * Para `casos` los identificadores son **códigos**, no uuids: es lo que acepta
 * el endpoint de casos (`codigo_caso`).
 */
@Injectable({ providedIn: 'root' })
export class AnulacionLoteService {
  private readonly http = inject(HttpClient);

  anular(
    entidad: EntidadAnulableLote,
    ids: readonly string[],
    motivo: string,
  ): Observable<ResultadoAnulacionLote> {
    return this.http.post<ResultadoAnulacionLote>(urlApi('/v1/anular-lote'), {
      entidad,
      ids,
      motivo,
    });
  }
}
