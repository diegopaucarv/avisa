import { Injectable, signal } from '@angular/core';

/** Tono del aviso: define el color y si se anuncia como alerta. */
export type TipoAviso = 'exito' | 'error' | 'info';

export type Aviso = {
  /** Identificador incremental; sólo sirve para cerrar el aviso correcto. */
  readonly id: number;
  readonly tipo: TipoAviso;
  readonly titulo: string;
  readonly detalle?: string;
  /** Código del fallo (`HTTP_ERROR`, `CAMPO_OBLIGATORIO`…), si lo hay. */
  readonly codigo?: string;
};

/**
 * Cola de mensajes emergentes de la aplicación.
 *
 * La usan las operaciones que ocurren fuera de una vista concreta —hoy, la
 * importación— para informar del resultado sin que el usuario tenga que
 * buscarlo. Los errores duran más que los éxitos porque casi siempre incluyen
 * un código que conviene leer antes de que desaparezca.
 *
 * No hay `setTimeout` en el servicio para que la lógica sea comprobable: el
 * componente que pinta la cola es quien programa el cierre.
 */
@Injectable({ providedIn: 'root' })
export class AvisosService {
  private secuencia = 0;
  private readonly cola = signal<readonly Aviso[]>([]);

  /** Avisos vivos, del más antiguo al más reciente. */
  readonly avisos = this.cola.asReadonly();

  exito(titulo: string, detalle?: string): number {
    return this.agregar({ tipo: 'exito', titulo, detalle });
  }

  info(titulo: string, detalle?: string): number {
    return this.agregar({ tipo: 'info', titulo, detalle });
  }

  error(titulo: string, detalle?: string, codigo?: string): number {
    return this.agregar({ tipo: 'error', titulo, detalle, codigo });
  }

  cerrar(id: number): void {
    this.cola.update((avisos) => avisos.filter((aviso) => aviso.id !== id));
  }

  private agregar(datos: Omit<Aviso, 'id'>): number {
    const id = ++this.secuencia;
    this.cola.update((avisos) => [...avisos, { ...datos, id }]);
    return id;
  }
}
