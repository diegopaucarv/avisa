import { describe, expect, it } from 'vitest';

import type { ActorDirectorio } from './directorio.mapeo';
import { alternarActorLista, quitarActorLista } from './lista-temporal';

function actor(id: string): ActorDirectorio {
  return {
    id,
    nombre: `Actor ${id}`,
    abreviatura: null,
    naturaleza: 'Persona',
    tipo: null,
    funcion: null,
    posicionamiento: null,
    cargo: null,
    nivelGobierno: null,
    categoria: null,
    region: null,
    distrito: null,
    organizacionAncla: null,
    validado: false,
    activo: true,
    clasificacion: 2,
    perfil: null,
  };
}

describe('lista temporal de actores', () => {
  it('agrega un actor sin alterar la lista previa', () => {
    const existente = actor('a');
    const nuevo = actor('b');

    const original = [existente];

    expect(alternarActorLista(original, nuevo)).toEqual([existente, nuevo]);
    expect(original).toEqual([existente]);
  });

  it('quita el actor cuando se vuelve a alternar', () => {
    const existente = actor('a');

    expect(alternarActorLista([existente], existente)).toEqual([]);
  });

  it('elimina por id y conserva el resto de la selección', () => {
    const primero = actor('a');
    const segundo = actor('b');

    expect(quitarActorLista([primero, segundo], 'a')).toEqual([segundo]);
  });
});
