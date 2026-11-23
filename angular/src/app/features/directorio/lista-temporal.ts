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
