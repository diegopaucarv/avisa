import { Injectable, computed, signal } from '@angular/core';

import type { ActorDirectorio } from './directorio.mapeo';
import type { EntradaLista, TipoEntrada } from './padron-asistencia';
import { fechaLocalIso } from './padron-fecha';

export type { EntradaLista, TipoEntrada } from './padron-asistencia';

/** Cabecera de la sesión que se imprime en la lista de asistencia. */
export type SesionLista = {
  titulo: string;
  lugar: string;
  /** ISO `YYYY-MM-DD`, la misma forma de `<input type="date">`. */
  fecha: string;
};

/** Una organización se reconoce por su naturaleza en el listado. */
function tipoDeActor(actor: ActorDirectorio): TipoEntrada {
  return actor.naturaleza.toLowerCase().startsWith('organiz') ? 'organizacion' : 'persona';
}

/**
 * Lista de asistencia compartida por el directorio de actores y el de
 * organizaciones.
 *
 * Vive en la raíz (`providedIn: 'root'`) porque la selección es de la sesión:
 * al navegar entre personas y organizaciones la lista no debe perderse. No se
 * persiste en `localStorage`; se reinicia con la aplicación, como el resto del
 * estado de trabajo.
 *
 * `incluidos` es la selección de exportación, independiente de la pertenencia:
 * quitar una entrada de la lista la elimina; desmarcarla en el cajón sólo la
 * deja fuera del Excel. Por defecto toda entrada nueva entra incluida.
 */
@Injectable({ providedIn: 'root' })
export class ListaAsistenciaService {
  private readonly _entradas = signal<EntradaLista[]>([]);
  readonly entradas = this._entradas.asReadonly();

  private readonly _sesion = signal<SesionLista>({
    titulo: '',
    lugar: '',
    fecha: fechaLocalIso(),
  });
  readonly sesion = this._sesion.asReadonly();

  private readonly _incluidos = signal<ReadonlySet<string>>(new Set());
  readonly incluidos = this._incluidos.asReadonly();

  readonly total = computed(() => this._entradas().length);

  /** Entradas incluidas en el libro; ignora ids que ya no existen en la lista. */
  readonly cantidadIncluidos = computed(() => {
    const incluidos = this._incluidos();
    return this._entradas().filter((entrada) => incluidos.has(entrada.actor.id)).length;
  });

  esta(id: string): boolean {
    return !!id && this._entradas().some((entrada) => entrada.actor.id === id);
  }

  estaIncluido(id: string): boolean {
    return this._incluidos().has(id);
  }

  /**
   * Agrega o quita un actor de la lista. El `tipo` sólo se infiere cuando el
   * llamador no lo conoce (por ejemplo, la ficha abierta en el panel).
   */
  alternar(actor: ActorDirectorio, tipo: TipoEntrada = tipoDeActor(actor)): void {
    if (!actor.id) return;

    const existe = this.esta(actor.id);
    this._entradas.update((actual) =>
      existe
        ? actual.filter((entrada) => entrada.actor.id !== actor.id)
        : [...actual, { tipo, actor }],
    );
    this._incluidos.update((actual) => {
      const siguiente = new Set(actual);
      if (existe) siguiente.delete(actor.id);
      else siguiente.add(actor.id);
      return siguiente;
    });
  }

  /** Agrega (o quita) varias entradas de golpe, para «seleccionar toda la página». */
  alternarVarios(actores: readonly ActorDirectorio[], tipo: TipoEntrada, marcar: boolean): void {
    const ids = actores.map((actor) => actor.id).filter((id): id is string => !!id);
    if (ids.length === 0) return;
    const objetivo = new Set(ids);

    this._entradas.update((actual) => {
      if (!marcar) return actual.filter((entrada) => !objetivo.has(entrada.actor.id));

      const existentes = new Set(actual.map((entrada) => entrada.actor.id));
      const nuevas = actores
        .filter((actor) => !!actor.id && !existentes.has(actor.id))
        .map((actor) => ({ tipo, actor }));
      return nuevas.length ? [...actual, ...nuevas] : actual;
    });

    this._incluidos.update((actual) => {
      const siguiente = new Set(actual);
      for (const id of ids) {
        if (marcar) siguiente.add(id);
        else siguiente.delete(id);
      }
      return siguiente;
    });
  }

  quitar(id: string): void {
    this._entradas.update((actual) => actual.filter((entrada) => entrada.actor.id !== id));
    this._incluidos.update((actual) => {
      const siguiente = new Set(actual);
      siguiente.delete(id);
      return siguiente;
    });
  }

  quitarPorIndice(indice: number): void {
    const entrada = this._entradas()[indice];
    if (!entrada) return;
    this._entradas.update((actual) => actual.filter((_, posicion) => posicion !== indice));
    this._incluidos.update((actual) => {
      const siguiente = new Set(actual);
      siguiente.delete(entrada.actor.id);
      return siguiente;
    });
  }

  vaciar(): void {
    this._entradas.set([]);
    this._incluidos.set(new Set());
  }

  /** Refleja los cambios de una ficha ya agregada sin alterar su pertenencia. */
  actualizar(actor: ActorDirectorio): void {
    if (!actor.id || !this.esta(actor.id)) return;
    this._entradas.update((actual) =>
      actual.map((entrada) =>
        entrada.actor.id === actor.id ? { ...entrada, actor } : entrada,
      ),
    );
  }

  cambiarSesion(parcial: Partial<SesionLista>): void {
    this._sesion.update((actual) => ({ ...actual, ...parcial }));
  }

  seleccionarTodos(): void {
    this._incluidos.set(new Set(this._entradas().map((entrada) => entrada.actor.id)));
  }

  quitarSeleccion(): void {
    this._incluidos.set(new Set());
  }

  /** Marca o desmarca una entrada para el Excel; no la quita de la lista. */
  alternarInclusion(id: string): void {
    this._incluidos.update((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  /** Elimina de la lista las entradas que estaban incluidas en el Excel. */
  eliminarSeleccionados(): void {
    const incluidos = this._incluidos();
    this._entradas.update((actual) =>
      actual.filter((entrada) => !incluidos.has(entrada.actor.id)),
    );
    this._incluidos.set(new Set());
  }
}
