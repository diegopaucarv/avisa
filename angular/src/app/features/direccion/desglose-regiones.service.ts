import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { aErrorApi, type ErrorApi } from '../../core/http/errores';
import { esRegistro, leer, texto } from '../../dominio/mapeo';

/** Total de casos de un grupo del desglose. */
export type GrupoRegion = { etiqueta: string; total: number };

export type EstadoDesglose = 'cargando' | 'listo' | 'error';

/** Fila que agrupa los casos sin región principal (no es una región del catálogo). */
export const SIN_REGION = 'Sin región';

/**
 * Desglose de casos por región para «Resumen de Dirección».
 *
 * La API no publica un catálogo de regiones con conteos, así que el conjunto de
 * regiones se lee de `GET /api/v1/catalogs` y después se pide **sólo el `total`**
 * de cada una con `pagina=1&tamano=1&region=<nombre>`. No se traen filas: es el
 * mismo contrato que el resto del resumen, que se construye con los `total` de
 * los sobres paginados. La fila «Sin región» usa `sinregion=true`, el
 * complemento que añadió el filtro de regiones.
 *
 * Si una consulta falla, no se devuelve un desglose parcial: un total recortado
 * se leería como una cifra institucional cuando no lo es.
 */
@Injectable()
export class DesgloseRegionesService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private turno = 0;

  private readonly _grupos = signal<GrupoRegion[]>([]);
  private readonly _estado = signal<EstadoDesglose>('cargando');
  private readonly _error = signal<ErrorApi | null>(null);

  readonly grupos = this._grupos.asReadonly();
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
      const regiones = await this.leerRegiones();

      // En paralelo: una petición por región, todas de una sola fila.
      const [totales, sinRegion] = await Promise.all([
        Promise.all(regiones.map((region) => this.contarCasos({ region }))),
        this.contarCasos({ sinregion: 'true' }),
      ]);

      if (turno !== this.turno) return;

      const grupos = regiones
        .map((etiqueta, indice) => ({ etiqueta, total: totales[indice] }))
        // Sólo las regiones con casos: una región en cero no aporta a la lectura
        // ejecutiva y alargaría la lista sin informar.
        .filter((grupo) => grupo.total > 0)
        .sort((a, b) => b.total - a.total || a.etiqueta.localeCompare(b.etiqueta, 'es'));

      if (sinRegion > 0) grupos.push({ etiqueta: SIN_REGION, total: sinRegion });

      this._grupos.set(grupos);
      this._estado.set('listo');
    } catch (fallo) {
      if (turno !== this.turno) return;

      this._error.set(aErrorApi(fallo));
      this._estado.set('error');
    }
  }

  /** Nombres canónicos de `core.regiones`, en el orden que publica el catálogo. */
  private async leerRegiones(): Promise<string[]> {
    const bruto = await firstValueFrom(this.http.get<unknown>(urlApi('/v1/catalogs')));

    const registro = esRegistro(bruto) ? bruto : {};
    const crudo = leer(registro, ['catalogs', 'catalogos']);
    const catalogo = esRegistro(crudo) ? crudo : {};
    const lista = leer(catalogo, ['regiones']);

    if (!Array.isArray(lista)) return [];

    const nombres: string[] = [];
    for (const item of lista) {
      const fila = esRegistro(item) ? item : {};
      const nombre = texto(fila, ['nombre', 'codigo', 'etiqueta']);
      if (nombre) nombres.push(nombre);
    }
    return nombres;
  }

  private async contarCasos(filtros: Record<string, string>): Promise<number> {
    const bruto = await firstValueFrom(
      this.http.get<unknown>(
        urlConParametros(urlApi('/v1/cases'), {
          ...paramsDePagina({ pagina: 1, tamano: 1 }),
          ...filtros,
        }),
      ),
    );

    return normalizarColeccion<unknown>(bruto).total;
  }
}
