import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { aErrorApi, type ErrorApi } from '../../core/http/errores';
import { aCaso } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';

export type EstadoPanorama = 'cargando' | 'listo' | 'error';

/** Tope de `pageSize` que aplica `GET /api/v1/cases`. */
const LOTE = 100;

/**
 * Carga todos los casos abiertos, página a página.
 *
 * La panorámica agrega por región y ámbito sobre las filas, no sobre totales
 * aislados: la API no publica un catálogo de regiones con conteos. `consulta`
 * sirve una única URL paginada, así que este servicio recorre el sobre hasta
 * juntar todas las filas (el tope de `pageSize` es 100). El recorte por rol
 * no se pide al servidor: hoy el alcance de datos de la sesión es «all» y el
 * acotado por regiones es de presentación, tal como documenta `lib/db/scope.ts`.
 */
@Injectable()
export class PanoramaService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private turno = 0;

  private readonly _casos = signal<Caso[]>([]);
  private readonly _corte = signal<string | null>(null);
  private readonly _estado = signal<EstadoPanorama>('cargando');
  private readonly _error = signal<ErrorApi | null>(null);

  readonly casos = this._casos.asReadonly();
  /** `generatedAt` del sobre: fecha de corte real de la consulta. */
  readonly corte = this._corte.asReadonly();
  readonly estado = this._estado.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.turno += 1;
    });
    void this.cargar();
  }

  recargar(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    const turno = ++this.turno;
    this._estado.set('cargando');
    this._error.set(null);

    try {
      const { casos, corte } = await this.leerTodo();
      if (turno !== this.turno) return;

      this._casos.set(casos);
      this._corte.set(corte);
      this._estado.set('listo');
    } catch (fallo) {
      if (turno !== this.turno) return;

      this._error.set(aErrorApi(fallo));
      this._estado.set('error');
    }
  }

  private async leerTodo(): Promise<{ casos: Caso[]; corte: string | null }> {
    const casos: Caso[] = [];
    let corte: string | null = null;
    let pagina = 1;

    while (true) {
      const bruto = await firstValueFrom(
        this.http.get<unknown>(
          urlConParametros(urlApi('/v1/cases'), {
            ...paramsDePagina({ pagina, tamano: LOTE }),
            abiertos: 'true',
          }),
        ),
      );

      const coleccion = normalizarColeccion<unknown>(bruto);
      corte = coleccion.generadoEn ?? corte;
      casos.push(...coleccion.elementos.map(aCaso));

      // Una página vacía corta el ciclo aunque `total` venga desalineado.
      if (!coleccion.elementos.length || casos.length >= coleccion.total) break;
      pagina += 1;
    }

    return { casos, corte };
  }
}
