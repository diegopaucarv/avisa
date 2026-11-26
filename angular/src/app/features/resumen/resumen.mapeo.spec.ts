import { describe, expect, it } from 'vitest';

import {
  ETAPAS_RESUMEN,
  HORIZONTE_POR_VENCER_DIAS,
  aMarcaMasReciente,
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

describe('ETAPAS_RESUMEN', () => {
  it('ordena la pantalla en Prevención · Gestión · Seguimiento', () => {
    expect(ETAPAS_RESUMEN.map((etapa) => etapa.clave)).toEqual([
      'prevencion',
      'gestion',
      'seguimiento',
    ]);
  });

  it('numera las etapas en el mismo orden en que se dibujan', () => {
    expect(ETAPAS_RESUMEN.map((etapa) => etapa.numero)).toEqual([1, 2, 3]);
  });

  it('titula la tercera etapa como Seguimiento, sin apellido', () => {
    expect(ETAPAS_RESUMEN.map((etapa) => etapa.titulo)).toEqual([
      'Prevención',
      'Gestión',
      'Seguimiento',
    ]);
  });
});

describe('aMarcaMasReciente', () => {
  it('toma la marca más reciente del sobre paginado', () => {
    const sobre = {
      items: [
        { id: '1', updatedAt: '2026-11-01T08:00:00.000Z' },
        { id: '2', updatedAt: '2026-11-22T09:07:00.776Z' },
        { id: '3', updatedAt: '2026-11-15T23:59:00.000Z' },
      ],
      total: 3,
    };

    expect(aMarcaMasReciente(sobre)).toBe('2026-11-22T09:07:00.776Z');
  });

  it('compara por instante, no por el orden de las filas', () => {
    const sobre = {
      items: [
        { updatedAt: '2026-11-22T09:07:00.000Z' },
        { updatedAt: '2026-11-22T04:00:00.000-05:00' },
      ],
    };

    // 04:00 en −05:00 es 09:00 UTC: la segunda fila es anterior.
    expect(aMarcaMasReciente(sobre)).toBe('2026-11-22T09:07:00.000Z');
  });

  it('usa createdAt cuando la fila no trae updatedAt', () => {
    const sobre = {
      items: [{ createdAt: '2026-11-10T10:00:00.000Z' }, { id: 'sin-marca' }],
    };

    expect(aMarcaMasReciente(sobre)).toBe('2026-11-10T10:00:00.000Z');
  });

  it('lee las grafías en snake_case del contrato SQL', () => {
    const sobre = {
      items: [
        { updated_at: '2026-11-05T12:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z' },
        { created_at: '2026-11-20T12:00:00.000Z' },
      ],
    };

    expect(aMarcaMasReciente(sobre)).toBe('2026-11-20T12:00:00.000Z');
  });

  it('lee ultimaModificacion, la marca de fila del listado de alertas', () => {
    const sobre = {
      items: [
        { id: '1', ultimaModificacion: '2026-11-10T08:00:00.000Z', fechaReporte: '2026-11-22' },
        { id: '2', ultimaModificacion: '2026-11-21T17:45:00.000Z', fechaReporte: '2026-11-01' },
      ],
      total: 2,
    };

    // La fecha de reporte no se lee: manda la marca de modificación.
    expect(aMarcaMasReciente(sobre)).toBe('2026-11-21T17:45:00.000Z');
  });

  it('prefiere la marca de fila sobre una fecha de evento', () => {
    const sobre = {
      items: [{ fecha_reporte: '2026-11-22', updatedAt: '2026-11-10T10:00:00.000Z' }],
    };

    expect(aMarcaMasReciente(sobre)).toBe('2026-11-10T10:00:00.000Z');
  });

  it('devuelve null cuando la fuente sólo trae fechas de evento', () => {
    const sobre = {
      items: [{ fecha_reporte: '2026-11-22' }, { fecha_validacion: '2026-11-21' }],
    };

    expect(aMarcaMasReciente(sobre)).toBeNull();
  });

  it('ignora cadenas que no son instantes válidos', () => {
    const sobre = { items: [{ updatedAt: 'no-es-fecha' }, { updatedAt: '' }] };

    expect(aMarcaMasReciente(sobre)).toBeNull();
  });

  it('devuelve null cuando no hay filas o el cuerpo no es una colección', () => {
    expect(aMarcaMasReciente({ items: [], total: 0 })).toBeNull();
    expect(aMarcaMasReciente(null)).toBeNull();
    expect(aMarcaMasReciente('no-es-colección')).toBeNull();
  });

  it('acepta una lista suelta', () => {
    expect(
      aMarcaMasReciente([
        { createdAt: '2026-11-01T00:00:00.000Z' },
        { createdAt: '2026-11-02T00:00:00.000Z' },
      ]),
    ).toBe('2026-11-02T00:00:00.000Z');
  });
});
