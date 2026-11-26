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

/**
 * Etiqueta de un ítem de la lista temporal: «Cargo · OSPA».
 *
 * «OSPA» es aquí la organización de la primera membresía vigente del actor
 * (`organizacionDeMembresia`). Si no hay vínculo, se cae al ancla del listado y,
 * por último, a la abreviatura. El guion evita que un hueco se lea como dato:
 * la lista identifica actores, no completa su ficha.
 */
export function etiquetaItemLista(
  actor: ActorDirectorio,
  organizacionDeMembresia?: string | null,
): string {
  const cargo = actor.cargo || '—';
  const ospa = organizacionDeMembresia || actor.organizacionAncla || actor.abreviatura || '—';
  return `${cargo} · ${ospa}`;
}
