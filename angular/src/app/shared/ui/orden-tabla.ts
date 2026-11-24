import { signal } from '@angular/core';

export type DireccionOrden = 'asc' | 'desc';

/**
 * Contrato que consume la directiva `th[appThOrden]`.
 *
 * Evita la varianza de los genéricos: la directiva sólo necesita estas tres
 * operaciones, no el tipo de fila.
 */
export interface ControlOrden {
  alternar(columna: string): void;
  ariaSort(columna: string): 'ascending' | 'descending' | 'none';
  indicador(columna: string): 'asc' | 'desc' | '';
}

/**
 * Orden de una tabla paginada: asc → desc → sin orden.
 *
 * Ordena la página visible (las filas ya cargadas). Sin columna activa
 * devuelve una copia con el orden original para no alterar el orden del
 * servidor. Cada pantalla crea su propia instancia.
 */
export class OrdenTabla<T> implements ControlOrden {
  private readonly _columna = signal<string | null>(null);
  private readonly _direccion = signal<DireccionOrden>('asc');

  readonly columna = this._columna.asReadonly();
  readonly direccion = this._direccion.asReadonly();

  alternar(columna: string): void {
    if (this._columna() !== columna) {
      this._columna.set(columna);
      this._direccion.set('asc');
      return;
    }
    if (this._direccion() === 'asc') {
      this._direccion.set('desc');
      return;
    }
    this._columna.set(null);
    this._direccion.set('asc');
  }

  ordenar(filas: readonly T[], accesores: Record<string, (fila: T) => unknown>): T[] {
    const columna = this._columna();
    const acceso = columna ? accesores[columna] : null;
    if (!acceso) return [...filas];

    const factor = this._direccion() === 'asc' ? 1 : -1;
    return [...filas].sort((a, b) => {
      const valorA = acceso(a);
      const valorB = acceso(b);
      // Un hueco no es «lo más alto» ni «lo más bajo»: no se gira con la
      // dirección y se queda al final en ambos sentidos.
      if (esVacio(valorA) || esVacio(valorB)) return comparar(valorA, valorB);
      return factor * comparar(valorA, valorB);
    });
  }

  ariaSort(columna: string): 'ascending' | 'descending' | 'none' {
    if (this._columna() !== columna) return 'none';
    return this._direccion() === 'asc' ? 'ascending' : 'descending';
  }

  indicador(columna: string): 'asc' | 'desc' | '' {
    return this._columna() === columna ? this._direccion() : '';
  }
}

function esVacio(valor: unknown): boolean {
  return valor === null || valor === undefined || valor === '';
}

/**
 * Compara números, booleanos, fechas ISO y texto (español). Nulos al final.
 * Las claves compuestas son arrays: se comparan posición a posición.
 */
export function comparar(a: unknown, b: unknown): number {
  if (esVacio(a) && esVacio(b)) return 0;
  if (esVacio(a)) return 1;
  if (esVacio(b)) return -1;

  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      const orden = comparar(a[i], b[i]);
      if (orden !== 0) return orden;
    }
    return a.length - b.length;
  }

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);

  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
}
