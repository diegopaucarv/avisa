import { describe, expect, it } from 'vitest';

import type { ActorDirectorio } from './directorio.mapeo';
import { alternarActorLista, etiquetaItemLista, quitarActorLista } from './lista-temporal';

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
    localesDelActor: [],
  };
}

describe('lista de asistencia de actores', () => {
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

  describe('etiqueta «Cargo · OSPA»', () => {
    it('usa la organización de la primera membresía cuando existe', () => {
      const conCargo: ActorDirectorio = {
        ...actor('a'),
        cargo: 'Presidenta',
        organizacionAncla: 'Ancla vieja',
      };

      expect(etiquetaItemLista(conCargo, 'Organización vigente')).toBe(
        'Presidenta · Organización vigente',
      );
    });

    it('cae al ancla del listado y luego a la abreviatura', () => {
      const conAncla: ActorDirectorio = {
        ...actor('b'),
        cargo: 'Secretario',
        organizacionAncla: 'Federación',
        abreviatura: 'FED',
      };
      const conAbreviatura: ActorDirectorio = {
        ...actor('c'),
        abreviatura: 'OSPA',
      };

      expect(etiquetaItemLista(conAncla, null)).toBe('Secretario · Federación');
      expect(etiquetaItemLista(conAbreviatura, null)).toBe('— · OSPA');
    });

    it('declara el hueco con un guion cuando no hay cargo ni organización', () => {
      expect(etiquetaItemLista(actor('d'))).toBe('— · —');
    });
  });
});
