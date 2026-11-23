import { describe, expect, it } from 'vitest';

import { aActorDirectorio } from './directorio.mapeo';

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
