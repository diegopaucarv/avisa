import { describe, expect, it } from 'vitest';

import { fechaLocalIso } from './padron-fecha';

describe('fechaLocalIso', () => {
  it('toma el día del calendario local, no el de UTC', () => {
    // 23:30 del 5 de noviembre en hora local ya es 6 de noviembre en UTC
    // (Lima es UTC−5). El padrón debe quedar fechado el 5, que es el día que
    // el usuario tiene delante. El Date se arma con componentes locales para
    // que la prueba valga en cualquier zona horaria de la máquina.
    const tarde = new Date(2026, 10, 5, 23, 30);
    expect(fechaLocalIso(tarde)).toBe('2026-11-05');
  });

  it('rellena con ceros el mes y el día', () => {
    expect(fechaLocalIso(new Date(2026, 0, 9, 0, 5))).toBe('2026-01-09');
  });
});
