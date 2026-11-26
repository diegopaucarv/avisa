import { signal } from '@angular/core';

/**
 * Estado de selección de una tabla paginada.
 *
 * «Seleccionar todo» alcanza a la página visible: las filas que el usuario
 * tiene delante, no el conjunto completo que queda al otro lado del filtro.
 * Cada pantalla crea su propia instancia (`readonly seleccion = new
 * SeleccionTabla()`), así que la selección muere al navegar.
 *
 * Cada cambio publica un `Set` nuevo: un `Set` mutado en sitio no dispara las
 * señales y la cabecera dejaría de reflejar el estado.
 */
export class SeleccionTabla {
  private readonly _ids = signal<ReadonlySet<string>>(new Set());

  readonly ids = this._ids.asReadonly();

  cantidad(): number {
    return this._ids().size;
  }

  lista(): string[] {
    return [...this._ids()];
  }

  esta(id: string | null | undefined): boolean {
    return !!id && this._ids().has(id);
  }

  todas(ids: readonly string[]): boolean {
    const seleccion = this._ids();
    return ids.length > 0 && ids.every((id) => seleccion.has(id));
  }

  /** Estado intermedio de la cabecera: hay algo, pero no todo. */
  algunas(ids: readonly string[]): boolean {
    const seleccion = this._ids();
    return ids.some((id) => seleccion.has(id)) && !this.todas(ids);
  }

  alternar(id: string | null | undefined): void {
    if (!id) return;
    const siguiente = new Set(this._ids());
    if (siguiente.has(id)) {
      siguiente.delete(id);
    } else {
      siguiente.add(id);
    }
    this._ids.set(siguiente);
  }

  alternarPagina(ids: readonly string[], evento: Event): void {
    const marcar = (evento.target as HTMLInputElement).checked;
    const siguiente = new Set(this._ids());
    for (const id of ids) {
      if (marcar) {
        siguiente.add(id);
      } else {
        siguiente.delete(id);
      }
    }
    this._ids.set(siguiente);
  }

  limpiar(): void {
    this._ids.set(new Set());
  }
}
