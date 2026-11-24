import { describe, expect, it } from 'vitest';

import {
  aColeccionDemandas,
  claseEstadoDemanda,
  formatearFecha,
  type EstadoDemanda,
} from './demanda-sin-caso.mapeo';

function fila(id: string, estado: string) {
  return { id, descripcion: `Demanda ${id}`, estado };
}

describe('aColeccionDemandas', () => {
  it('mapea el sobre paginado y conserva los totales propios', () => {
    const coleccion = aColeccionDemandas({
      items: [fila('d-1', 'En proceso')],
      total: 10,
      page: 2,
      pageSize: 5,
      sinCasoTotal: 7,
      vinculadasTotal: 3,
    });

    expect(coleccion.elementos).toHaveLength(1);
    expect(coleccion.elementos[0]).toMatchObject({
      id: 'd-1',
      descripcion: 'Demanda d-1',
      estado: 'En proceso',
    });
    expect(coleccion).toMatchObject({
      total: 10,
      pagina: 2,
      tamanoPagina: 5,
      sinCasoTotal: 7,
      vinculadasTotal: 3,
    });
  });

  it('acepta una lista suelta y usa su longitud como total', () => {
    const coleccion = aColeccionDemandas([fila('d-1', 'Pendiente'), fila('d-2', 'Atendida')]);

    expect(coleccion.total).toBe(2);
    expect(coleccion.sinCasoTotal).toBe(2);
    expect(coleccion.vinculadasTotal).toBe(0);
    expect(coleccion.pagina).toBe(1);
    expect(coleccion.tamanoPagina).toBe(2);
  });

  it('devuelve una colección vacía para una lista vacía', () => {
    const coleccion = aColeccionDemandas([]);

    expect(coleccion.elementos).toEqual([]);
    expect(coleccion.total).toBe(0);
    expect(coleccion.sinCasoTotal).toBe(0);
    expect(coleccion.vinculadasTotal).toBe(0);
  });

  it('usa `total` si falta `sinCasoTotal` y 0 si falta `vinculadasTotal`', () => {
    const coleccion = aColeccionDemandas({ items: [], total: 5 });

    expect(coleccion.sinCasoTotal).toBe(5);
    expect(coleccion.vinculadasTotal).toBe(0);
  });

  it('ignora totales que no son números finitos', () => {
    const coleccion = aColeccionDemandas({
      items: [],
      total: 5,
      sinCasoTotal: '9',
      vinculadasTotal: Number.NaN,
    });

    expect(coleccion.sinCasoTotal).toBe(5);
    expect(coleccion.vinculadasTotal).toBe(0);
  });

  it('normaliza los estados con acentos y separadores', () => {
    const coleccion = aColeccionDemandas({
      items: [fila('d-1', 'en_proceso'), fila('d-2', 'ATENDIDA')],
    });

    expect(coleccion.elementos.map((demanda) => demanda.estado)).toEqual([
      'En proceso',
      'Atendida',
    ]);
  });
});

describe('claseEstadoDemanda', () => {
  it.each([
    ['Atendida', 'state-approved'],
    ['Desestimada', 'state-dismissed'],
    ['Pendiente', 'state-pending'],
    ['En proceso', 'state-pending'],
  ] as const)('%s usa la clase %s', (estado: EstadoDemanda, clase: string) => {
    expect(claseEstadoDemanda(estado)).toBe(clase);
  });
});

describe('formatearFecha', () => {
  it('presenta las fechas del backend como DD/MM/YYYY', () => {
    expect(formatearFecha('2026-01-05')).toBe('05/01/2026');
    expect(formatearFecha('2026-01-05T00:00:00.000Z')).toBe('05/01/2026');
  });

  it('normaliza el formato legado DD/MM/YYYY', () => {
    expect(formatearFecha('5/1/2026')).toBe('05/01/2026');
  });

  it('devuelve un guion cuando no hay fecha', () => {
    expect(formatearFecha(null)).toBe('—');
    expect(formatearFecha(undefined)).toBe('—');
  });
});
