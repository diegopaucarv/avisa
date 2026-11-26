import type { ActorDirectorio } from './directorio.mapeo';

export function alternarActorLista(
  actual: ActorDirectorio[],
  actor: ActorDirectorio,
): ActorDirectorio[] {
  return actual.some((seleccionado) => seleccionado.id === actor.id)
    ? actual.filter((seleccionado) => seleccionado.id !== actor.id)
    : [...actual, actor];
}

export function quitarActorLista(actual: ActorDirectorio[], id: string): ActorDirectorio[] {
  return actual.filter((actor) => actor.id !== id);
}

/**
 * Quita la entrada de una posición concreta. La lista puede contener al mismo
 * actor más de una vez, así que el índice —y no el id— es la clave de borrado.
 */
export function quitarActorListaPorIndice(
  actual: ActorDirectorio[],
  indice: number,
): ActorDirectorio[] {
  return actual.filter((_, posicion) => posicion !== indice);
}
