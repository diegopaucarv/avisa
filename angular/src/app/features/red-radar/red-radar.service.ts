import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import type { TriajeCambios } from './red-radar.mapeo';

/**
 * Escritura de la bandeja RED-RADAR.
 *
 * La lectura de la cola y del detalle se hace con `consulta` (sólo GET, ligada
 * a la URL con filtros). Aquí vive la única escritura: registrar el triaje de
 * una alerta en `core.alerta_triaje`. La API hace upsert, así que el mismo
 * `PATCH` fija el estado la primera vez y lo rehace después.
 */
@Injectable({ providedIn: 'root' })
export class RedRadarService {
  private readonly http = inject(HttpClient);

  registrarTriaje(idOCodigo: string, cambios: TriajeCambios): Observable<unknown> {
    const url = urlApi(`/v1/red-radar/${encodeURIComponent(idOCodigo)}/triaje`);
    return this.http.patch<unknown>(url, cambios);
  }
}
