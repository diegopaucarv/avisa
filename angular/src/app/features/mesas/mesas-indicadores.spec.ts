import { describe, expect, it } from 'vitest';

import { VACIO, anchoBarra, leerIndicadores } from './mesas-indicadores';

describe('leerIndicadores', () => {
  it('lee el sobre envuelto en data con claves camelCase', () => {
    const indicadores = leerIndicadores({
      data: {
        vinculoDisponible: true,
        totales: { mesas: 21, miembros: 62, compromisos: 0, hitos: 0 },
        vigencia: [{ clave: 'Vigente', total: 2 }],
        naturaleza: [{ clave: 'Temporal', total: 15 }],
        departamentos: [{ clave: 'Loreto', total: 3 }],
        compromisosEstado: [{ clave: 'En proceso', total: 0 }],
        compromisosPorMesa: [{ codigo: 'OAIPCS-001', titulo: 'Mesa', total: 0, cumplidos: 0 }],
        hitosEstado: [{ clave: 'Cumplido', total: 0 }],
      },
    });

    expect(indicadores.vinculoDisponible).toBe(true);
    expect(indicadores.totales).toEqual({ mesas: 21, miembros: 62, compromisos: 0, hitos: 0 });
    expect(indicadores.vigencia).toEqual([{ clave: 'Vigente', total: 2 }]);
    expect(indicadores.naturaleza).toEqual([{ clave: 'Temporal', total: 15 }]);
    expect(indicadores.departamentos).toEqual([{ clave: 'Loreto', total: 3 }]);
    expect(indicadores.compromisosEstado).toEqual([{ clave: 'En proceso', total: 0 }]);
    expect(indicadores.compromisosPorMesa).toEqual([
      { codigo: 'OAIPCS-001', titulo: 'Mesa', total: 0, cumplidos: 0 },
    ]);
    expect(indicadores.hitosEstado).toEqual([{ clave: 'Cumplido', total: 0 }]);
  });

  it('tolera claves snake_case y números enviados como texto', () => {
    const indicadores = leerIndicadores({
      vinculo_disponible: true,
      total_mesas: '21',
      miembros: '62',
      por_vigencia: [{ estado: 'Por vencer', cantidad: '2' }],
      por_departamento: [{ nombre: 'Loreto', conteo: '3' }],
      por_estado_compromiso: [{ clave: 'Cumplido', total: '0' }],
      por_estado_hito: [{ clave: 'Registrado', total: '0' }],
    });

    expect(indicadores.totales.mesas).toBe(21);
    expect(indicadores.totales.miembros).toBe(62);
    expect(indicadores.vigencia).toEqual([{ clave: 'Por vencer', total: 2 }]);
    expect(indicadores.departamentos).toEqual([{ clave: 'Loreto', total: 3 }]);
    expect(indicadores.compromisosEstado).toEqual([{ clave: 'Cumplido', total: 0 }]);
    expect(indicadores.hitosEstado).toEqual([{ clave: 'Registrado', total: 0 }]);
  });

  it('distingue «sin vínculo» de «campo ausente»', () => {
    expect(leerIndicadores({ vinculoDisponible: false }).vinculoDisponible).toBe(false);
    expect(leerIndicadores({ vinculoDisponible: true }).vinculoDisponible).toBe(true);
    expect(leerIndicadores({}).vinculoDisponible).toBeUndefined();
    expect(leerIndicadores({ vinculoDisponible: 'sí' }).vinculoDisponible).toBeUndefined();
  });

  it('no inventa filas: descarta conteos sin clave ni arreglos mal formados', () => {
    const indicadores = leerIndicadores({
      vigencia: [{ total: 3 }, null, 'Vigente', { clave: '  ', total: 1 }],
      departamentos: 'Loreto',
    });

    expect(indicadores.vigencia).toEqual([]);
    expect(indicadores.departamentos).toEqual([]);
  });

  it('devuelve el sobre vacío ante un bruto inservible', () => {
    for (const bruto of [null, undefined, 42, [], 'texto']) {
      expect(leerIndicadores(bruto)).toEqual(VACIO);
    }
  });

  it('usa el sobre raíz como totales cuando no viene el bloque', () => {
    const indicadores = leerIndicadores({ mesas: 21, miembros: 62 });

    expect(indicadores.totales.mesas).toBe(21);
    expect(indicadores.totales.miembros).toBe(62);
    expect(indicadores.totales.compromisos).toBe(0);
  });

  it('usa «Sin código» para una fila de mesa sin código', () => {
    const indicadores = leerIndicadores({ compromisosPorMesa: [{ total: 4 }] });

    expect(indicadores.compromisosPorMesa).toEqual([
      { codigo: 'Sin código', titulo: '', total: 4, cumplidos: 0 },
    ]);
  });
});

describe('anchoBarra', () => {
  it('no dibuja barra para totales no positivos o no finitos', () => {
    expect(anchoBarra(0, 10)).toBe('0%');
    expect(anchoBarra(-3, 10)).toBe('0%');
    expect(anchoBarra(Number.NaN, 10)).toBe('0%');
  });

  it('garantiza un mínimo visible del 2%', () => {
    expect(anchoBarra(1, 100)).toBe('2%');
  });

  it('calcula el porcentaje y lo limita al 100%', () => {
    expect(anchoBarra(50, 100)).toBe('50%');
    expect(anchoBarra(250, 100)).toBe('100%');
  });

  it('redondea a un decimal', () => {
    expect(anchoBarra(1, 3)).toBe('33.3%');
  });

  it('usa el propio total como máximo cuando el máximo no sirve', () => {
    expect(anchoBarra(5, 0)).toBe('100%');
    expect(anchoBarra(5, Number.NaN)).toBe('100%');
  });
});
