import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { aErrorApi, type ErrorApi } from '../../core/http/errores';
import { esRegistro, leer, numero, texto } from '../../dominio/mapeo';

/** Casos vigentes de un subsector, con el nivel de riesgo intermedio. */
export type FilaSubsector = {
  subsector: string;
  total: number;
  alto: number;
  /** Nivel intermedio del catálogo (hoy «Medio»; «Moderado» sin la migración 53). */
  medio: number;
  bajo: number;
};

export type EstadoDesgloseSubsectores = 'cargando' | 'listo' | 'error';

/**
 * Desglose de casos vigentes por subsector para «Resumen de Dirección».
 *
 * Consume `GET /api/v1/search/subsectores` (item 52). El agregado se calcula en
 * el servidor porque `GET /api/v1/cases` no acepta filtro por subsector: no se
 * puede reconstruir pidiendo un total por subsector como se hace con región.
 *
 * El rótulo de la columna intermedia no se fija aquí: el endpoint devuelve
 * `codigoMedio`, el código real del catálogo. Si falta, la vista usa «Medio»,
 * que es el valor de `RIESGOS` en `dominio/mapeo.ts`.
 *
 * Si la consulta falla no se muestra un desglose parcial: una cifra recortada
 * se leería como institucional.
 */
@Injectable()
export class DesgloseSubsectoresService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private turno = 0;

  private readonly _grupos = signal<FilaSubsector[]>([]);
  private readonly _codigoMedio = signal<string | null>(null);
  private readonly _totalCasos = signal(0);
  private readonly _estado = signal<EstadoDesgloseSubsectores>('cargando');
  private readonly _error = signal<ErrorApi | null>(null);

  readonly grupos = this._grupos.asReadonly();
  readonly codigoMedio = this._codigoMedio.asReadonly();
  readonly totalCasos = this._totalCasos.asReadonly();
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
      const bruto = await firstValueFrom(
        this.http.get<unknown>(urlApi('/v1/search/subsectores')),
      );

      if (turno !== this.turno) return;

      const registro = esRegistro(bruto) ? bruto : {};
      const lista = leer(registro, ['subsectores']);

      const grupos: FilaSubsector[] = [];
      let codigoMedio: string | null = null;

      if (Array.isArray(lista)) {
        for (const item of lista) {
          if (!esRegistro(item)) continue;
          const nombre = texto(item, ['subsector']);
          if (!nombre) continue;

          codigoMedio = codigoMedio ?? texto(item, ['codigoMedio', 'codigo_medio']);

          grupos.push({
            subsector: nombre,
            total: numero(item, ['total']) ?? 0,
            alto: numero(item, ['alto']) ?? 0,
            medio: numero(item, ['medio']) ?? 0,
            bajo: numero(item, ['bajo']) ?? 0,
          });
        }
      }

      this._grupos.set(grupos);
      this._codigoMedio.set(codigoMedio);
      this._totalCasos.set(
        numero(registro, ['totalCasos', 'total_casos']) ??
          grupos.reduce((suma, fila) => suma + fila.total, 0),
      );
      this._estado.set('listo');
    } catch (fallo) {
      if (turno !== this.turno) return;

      this._error.set(aErrorApi(fallo));
      this._estado.set('error');
    }
  }
}
