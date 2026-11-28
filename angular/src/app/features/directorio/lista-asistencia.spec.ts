import { describe, expect, it } from 'vitest';

import { aPiiLote, desglosarSinPii } from './directorio.mapeo';

describe('aPiiLote · filas no descifradas', () => {
  it('lee el conteo junto con los datos y los errores', () => {
    const lote = aPiiLote({
      datos: {
        'actor-1': { dni: '01234567', telefono: null },
        // Una fila ilegible sí llega en `datos`, con ambos campos en null.
        'actor-2': { dni: null, telefono: null },
      },
      errores: { 'actor-3': 'fallo de descifrado' },
      noDescifrados: 1,
    });

    expect(lote.datos.size).toBe(2);
    expect(lote.errores.size).toBe(1);
    expect(lote.noDescifrados).toBe(1);
  });

  it('vale 0 cuando el campo falta, es negativo o no es numérico', () => {
    expect(aPiiLote({ datos: {} }).noDescifrados).toBe(0);
    expect(aPiiLote({ datos: {}, noDescifrados: null }).noDescifrados).toBe(0);
    expect(aPiiLote({ datos: {}, noDescifrados: -3 }).noDescifrados).toBe(0);
    expect(aPiiLote({ datos: {}, noDescifrados: '   ' }).noDescifrados).toBe(0);
    expect(aPiiLote({ datos: {}, noDescifrados: 'ilegibles' }).noDescifrados).toBe(0);
    expect(aPiiLote({ datos: {}, noDescifrados: Number.POSITIVE_INFINITY }).noDescifrados).toBe(0);
  });

  it('acepta un número en texto y trunca las fracciones', () => {
    expect(aPiiLote({ datos: {}, noDescifrados: '2' }).noDescifrados).toBe(2);
    expect(aPiiLote({ datos: {}, noDescifrados: 2.9 }).noDescifrados).toBe(2);
  });
});

describe('desglose de actores sin PII', () => {
  it('resta los ilegibles para no contarlos dos veces', () => {
    expect(desglosarSinPii(4, 1)).toEqual({ sinDato: 3, ilegibles: 1 });
  });

  it('deja sólo la nota de sin dato cuando no hay ilegibles', () => {
    expect(desglosarSinPii(2, 0)).toEqual({ sinDato: 2, ilegibles: 0 });
  });

  it('deja sólo la nota de ilegibles cuando todos los sin PII lo son', () => {
    expect(desglosarSinPii(2, 2)).toEqual({ sinDato: 0, ilegibles: 2 });
  });

  it('no produce negativos si el servidor informa más ilegibles que filas', () => {
    expect(desglosarSinPii(1, 5)).toEqual({ sinDato: 0, ilegibles: 1 });
  });

  it('queda en cero cuando nadie carece de PII', () => {
    expect(desglosarSinPii(0, 0)).toEqual({ sinDato: 0, ilegibles: 0 });
  });
});
