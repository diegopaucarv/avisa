import { describe, expect, it } from 'vitest';

import {
  HORIZONTE_POR_VENCER_DIAS,
  aTotal,
  rangoPorVencer,
  rangoVencidos,
} from './resumen.mapeo';

/** 23/11/2026, fecha fija para no depender del reloj de la máquina. */
const HOY = new Date(2026, 10, 23);

describe('aTotal', () => {
  it('lee el total del sobre paginado sin construir filas', () => {
    expect(aTotal({ items: [{ id: '1' }, { id: '2' }], total: 42, page: 2, pageSize: 10 })).toBe(
      42,
    );
  });

  it('usa la longitud de una lista suelta', () => {
    expect(aTotal([1, 2, 3])).toBe(3);
  });

  it('cae en el número de elementos si el sobre no trae total', () => {
    expect(aTotal({ items: [{ id: '1' }, { id: '2' }] })).toBe(2);
  });

  it('devuelve 0 cuando la respuesta no es una colección', () => {
    expect(aTotal(null)).toBe(0);
    expect(aTotal('no-es-colección')).toBe(0);
  });
});

describe('rangoVencidos', () => {
  it('cierra el rango en el día anterior a la referencia', () => {
    expect(rangoVencidos(HOY)).toEqual({ hasta: '2026-11-22' });
  });

  it('retrocede al último día del mes anterior cuando la referencia es el día 1', () => {
    expect(rangoVencidos(new Date(2026, 11, 1))).toEqual({ hasta: '2026-11-30' });
  });

  it('retrocede al último día del año anterior cuando la referencia es el 1 de enero', () => {
    expect(rangoVencidos(new Date(2027, 0, 1))).toEqual({ hasta: '2026-12-31' });
  });

  it('respeta el 29 de febrero de un año bisiesto', () => {
    expect(rangoVencidos(new Date(2024, 2, 1))).toEqual({ hasta: '2024-02-29' });
  });
});

describe('rangoPorVencer', () => {
  it('incluye hoy como límite inferior y hoy más el horizonte como superior', () => {
    expect(rangoPorVencer(HOY)).toEqual({ desde: '2026-11-23', hasta: '2026-12-23' });
    expect(HORIZONTE_POR_VENCER_DIAS).toBe(30);
  });

  it('con horizonte 0 el rango se reduce a hoy', () => {
    expect(rangoPorVencer(HOY, 0)).toEqual({ desde: '2026-11-23', hasta: '2026-11-23' });
  });

  it('suma días de calendario y cruza el cambio de año', () => {
    expect(rangoPorVencer(new Date(2026, 11, 20), 30)).toEqual({
      desde: '2026-12-20',
      hasta: '2027-01-19',
    });
  });

  it('acepta un horizonte distinto de 30 días', () => {
    expect(rangoPorVencer(HOY, 7)).toEqual({ desde: '2026-11-23', hasta: '2026-11-30' });
  });
});
