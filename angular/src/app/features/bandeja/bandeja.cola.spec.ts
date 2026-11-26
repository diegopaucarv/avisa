import { describe, expect, it } from 'vitest';

import {
  claseVencimiento,
  filtrarColaPorTipo,
  normalizarFiltroTipo,
  ordenarCola,
  type ItemCola,
} from './bandeja.cola';

/** 23/11/2026, fecha fija para no depender del reloj de la máquina. */
const HOY = new Date(2026, 10, 23);

function item(parcial: Partial<ItemCola> & Pick<ItemCola, 'tipo' | 'codigo'>): ItemCola {
  return {
    id: parcial.codigo,
    titulo: parcial.codigo,
    caso: null,
    territorio: null,
    fecha: null,
    plazo: 'Sin fecha',
    riesgo: '—',
    pesoRiesgo: 0,
    revisionPendiente: false,
    ruta: '/bandeja',
    ...parcial,
  };
}

describe('orden de la cola de la bandeja', () => {
  it('coloca primero lo vencido, luego el plazo ascendente y al final lo sin fecha', () => {
    const sinFecha = item({ tipo: 'demanda', codigo: 'D-0' });
    const futuroLejano = item({ tipo: 'compromiso', codigo: 'C-30', fecha: '2026-12-30' });
    const vencido = item({ tipo: 'compromiso', codigo: 'C-V', fecha: '2026-11-20' });
    const futuroProximo = item({ tipo: 'alerta', codigo: 'A-3', fecha: '2026-11-25' });

    const orden = ordenarCola([sinFecha, futuroLejano, vencido, futuroProximo], HOY);

    expect(orden.map((fila) => fila.codigo)).toEqual(['C-V', 'A-3', 'C-30', 'D-0']);
  });

  it('ordena dos vencidos por fecha ascendente y no por el orden de entrada', () => {
    const reciente = item({ tipo: 'alerta', codigo: 'A-2', fecha: '2026-11-22' });
    const antiguo = item({ tipo: 'alerta', codigo: 'A-1', fecha: '2026-11-10' });

    const orden = ordenarCola([reciente, antiguo], HOY);

    expect(orden.map((fila) => fila.codigo)).toEqual(['A-1', 'A-2']);
  });

  it('desempata por riesgo/prioridad cuando la fecha coincide', () => {
    const seguimiento = item({
      tipo: 'alerta',
      codigo: 'A-BAJA',
      fecha: '2026-11-25',
      riesgo: 'Seguimiento',
      pesoRiesgo: 1,
    });
    const critica = item({
      tipo: 'alerta',
      codigo: 'A-ALTA',
      fecha: '2026-11-25',
      riesgo: 'Crítica inmediata',
      pesoRiesgo: 4,
    });

    const orden = ordenarCola([seguimiento, critica], HOY);

    expect(orden.map((fila) => fila.codigo)).toEqual(['A-ALTA', 'A-BAJA']);
  });

  it('desempata por revisión pendiente cuando el riesgo coincide', () => {
    const sinRevision = item({ tipo: 'compromiso', codigo: 'C-1', fecha: '2026-11-25' });
    const conRevision = item({
      tipo: 'compromiso',
      codigo: 'C-2',
      fecha: '2026-11-25',
      revisionPendiente: true,
    });

    const orden = ordenarCola([sinRevision, conRevision], HOY);

    expect(orden.map((fila) => fila.codigo)).toEqual(['C-2', 'C-1']);
  });
});

describe('filtro por tipo de la cola', () => {
  const cola = [
    item({ tipo: 'alerta', codigo: 'A-1' }),
    item({ tipo: 'compromiso', codigo: 'C-1' }),
    item({ tipo: 'demanda', codigo: 'D-1' }),
    item({ tipo: 'alerta', codigo: 'A-2' }),
  ];

  it('recorta por cada tipo visible', () => {
    expect(filtrarColaPorTipo(cola, 'alertas').map((fila) => fila.codigo)).toEqual(['A-1', 'A-2']);
    expect(filtrarColaPorTipo(cola, 'compromisos').map((fila) => fila.codigo)).toEqual(['C-1']);
    expect(filtrarColaPorTipo(cola, 'demandas').map((fila) => fila.codigo)).toEqual(['D-1']);
  });

  it('no recorta con `todos` y devuelve una copia', () => {
    const todas = filtrarColaPorTipo(cola, 'todos');

    expect(todas).toEqual(cola);
    expect(todas).not.toBe(cola);
  });

  it('normaliza el parámetro de URL y cae en `todos` si no se reconoce', () => {
    expect(normalizarFiltroTipo('alertas')).toBe('alertas');
    expect(normalizarFiltroTipo('compromisos')).toBe('compromisos');
    expect(normalizarFiltroTipo('demandas')).toBe('demandas');
    expect(normalizarFiltroTipo('todos')).toBe('todos');
    expect(normalizarFiltroTipo(null)).toBe('todos');
    expect(normalizarFiltroTipo('otra-cosa')).toBe('todos');
  });
});

describe('etiqueta de plazo (clases due-*)', () => {
  it('distingue vencido, por vencer, en plazo y sin fecha', () => {
    expect(claseVencimiento(item({ tipo: 'demanda', codigo: 'D-1', fecha: '2026-11-20' }), HOY)).toBe(
      'due-vencido',
    );
    expect(claseVencimiento(item({ tipo: 'demanda', codigo: 'D-2', fecha: '2026-12-10' }), HOY)).toBe(
      'due-por-vencer',
    );
    expect(claseVencimiento(item({ tipo: 'demanda', codigo: 'D-3', fecha: '2027-03-01' }), HOY)).toBe(
      'due-en-plazo',
    );
    expect(claseVencimiento(item({ tipo: 'demanda', codigo: 'D-4' }), HOY)).toBe('due-sin-fecha');
  });
});
