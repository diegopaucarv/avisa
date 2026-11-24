import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import type { CambiosTarjeta, ResultadoActualizacion } from './bandeja.mapeo';

/**
 * Escritura del tablero de la bandeja.
 *
 * La lectura se hace con `consulta` (sólo GET, ligada a la URL con filtros).
 * Aquí vive la única escritura: mover, asignar, fechar o posponer una tarjeta.
 * La API hace upsert, así que el mismo `PATCH` crea la tarjeta de un registro
 * del catálogo la primera vez.
 */
@Injectable({ providedIn: 'root' })
export class BandejaService {
  private readonly http = inject(HttpClient);

  actualizar(
    entidadTipo: string,
    entidadId: string,
    cambios: CambiosTarjeta,
  ): Observable<ResultadoActualizacion> {
    const url = urlApi(
      `/v1/bandeja/${encodeURIComponent(entidadTipo)}/${encodeURIComponent(entidadId)}`,
    );
    return this.http.patch<ResultadoActualizacion>(url, cambios);
  }
}
