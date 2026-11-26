import { describe, expect, it } from 'vitest';

import { aActorDirectorio, aMembresiaActor } from './directorio.mapeo';

describe('aActorDirectorio', () => {
  it('preserva la clasificación que controla la acción de edición', () => {
    const actor = aActorDirectorio({
      id: 'actor-1',
      nombre: 'Rosa Quispe',
      naturaleza: 'persona',
      clasificacion: 3,
      activo: true,
    });

    expect(actor.clasificacion).toBe(3);
    expect(actor.naturaleza).toBe('Persona');
  });

  it('usa acceso reservado por defecto cuando la clasificación falta', () => {
    const actor = aActorDirectorio({ id: 'actor-2', nombre: 'Organización' });

    expect(actor.clasificacion).toBe(1);
  });
});

describe('aMembresiaActor', () => {
  it('mapea la pertenencia vigente con su cargo y vigencia', () => {
    const membresia = aMembresiaActor({
      actorId: 'persona-1',
      organizacionId: 'org-1',
      nombre: 'Asociación de Pescadores',
      cargo: 'Presidente',
      desde: '2024-03-01',
      hasta: null,
    });

    expect(membresia).toEqual({
      actorId: 'persona-1',
      organizacionId: 'org-1',
      nombre: 'Asociación de Pescadores',
      cargo: 'Presidente',
      desde: '2024-03-01',
      hasta: null,
    });
  });

  it('descarta una membresía sin actor u organización', () => {
    expect(aMembresiaActor({ nombre: 'Organización sin dueño' })).toBeNull();
    expect(aMembresiaActor(null)).toBeNull();
  });
});
