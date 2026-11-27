import { describe, expect, it } from 'vitest';

import {
  PASO_APROBACION_DEFINITIVA,
  accionesDeFlujo,
  claseEstadoProducto,
  estadoDePaso,
  etapaDeFlujo,
  etapaDeProducto,
  etiquetaEstadoProducto,
  pasoDeProducto,
} from './producto.mapeo';

describe('transiciones del flujo de productos del diálogo', () => {
  it('declara los destinos legales desde cada paso', () => {
    expect(accionesDeFlujo(1).map((accion) => accion.paso)).toEqual([2]);
    expect(accionesDeFlujo(2).map((accion) => accion.paso)).toEqual([3, 1]);
    expect(accionesDeFlujo(3).map((accion) => accion.paso)).toEqual([4, 2]);
    expect(accionesDeFlujo(4).map((accion) => accion.paso)).toEqual([]);
  });

  it('no ofrece acciones para pasos fuera del flujo', () => {
    expect(accionesDeFlujo(0)).toEqual([]);
    expect(accionesDeFlujo(5)).toEqual([]);
    expect(accionesDeFlujo(99)).toEqual([]);
  });

  it('coloca la aprobación definitiva en el paso 3', () => {
    expect(PASO_APROBACION_DEFINITIVA).toBe(3);
    expect(accionesDeFlujo(2)).toContainEqual(
      expect.objectContaining({ paso: PASO_APROBACION_DEFINITIVA }),
    );
  });

  it('acompaña cada acción con etiqueta, detalle, responsable y estado destino', () => {
    for (const paso of [1, 2, 3]) {
      for (const accion of accionesDeFlujo(paso)) {
        expect(accion.etiqueta.trim()).not.toBe('');
        expect(accion.detalle.trim()).not.toBe('');
        expect(accion.responsable.trim()).not.toBe('');
        expect(accion.estado.trim()).not.toBe('');
        expect(accion.paso).not.toBe(paso);
      }
    }
  });

  it('describe la acción de envío a aprobación definitiva', () => {
    expect(accionesDeFlujo(2)[0]).toMatchObject({
      paso: 3,
      estado: 'Aprobado',
      etiqueta: 'Enviar a aprobación definitiva',
      responsable: 'Dirección OAIPCS',
    });
  });
});

describe('etapaDeFlujo', () => {
  it('devuelve la etapa declarada para cada paso', () => {
    expect(etapaDeFlujo(1)).toMatchObject({ nombre: 'Elaboración', estado: 'Cargado' });
    expect(etapaDeFlujo(4)).toMatchObject({ nombre: 'Remitido', estado: 'Remitido' });
  });

  it('describe la aprobación con su responsable', () => {
    expect(etapaDeFlujo(PASO_APROBACION_DEFINITIVA)).toEqual({
      paso: 3,
      nombre: 'Aprobación',
      estado: 'Aprobado',
      responsable: 'Dirección OAIPCS',
    });
  });

  it('devuelve null para pasos que no existen en el flujo', () => {
    expect(etapaDeFlujo(0)).toBeNull();
    expect(etapaDeFlujo(5)).toBeNull();
  });
});

describe('pasoDeProducto', () => {
  it.each([
    ['Cargado', false, 1],
    ['En análisis', false, 1],
    ['Extraído', false, 1],
    ['Validado', false, 2],
    ['Aprobado', false, 3],
    ['Remitido', false, 4],
    ['Rechazado', false, 1],
    ['', false, 1],
  ] as const)('«%s» (validado=%s) está en el paso %i', (estado, validado, paso) => {
    expect(pasoDeProducto({ estado, validado })).toBe(paso);
  });

  it('ignora mayúsculas y espacios del estado', () => {
    expect(pasoDeProducto({ estado: '  APROBADO ', validado: false })).toBe(3);
    expect(pasoDeProducto({ estado: 'remitido', validado: false })).toBe(4);
  });

  it('trata el indicador de validación humana como validación', () => {
    expect(pasoDeProducto({ estado: null, validado: true })).toBe(2);
    expect(pasoDeProducto({ estado: 'Cargado', validado: true })).toBe(2);
  });

  it('el estado manda sobre el indicador cuando ya hay un paso posterior', () => {
    expect(pasoDeProducto({ estado: 'Aprobado', validado: true })).toBe(3);
    expect(pasoDeProducto({ estado: 'Remitido', validado: true })).toBe(4);
  });
});

describe('etapaDeProducto', () => {
  it('deriva la etapa del estado registrado', () => {
    expect(etapaDeProducto({ estado: 'Validado', validado: false })).toMatchObject({
      paso: 2,
      nombre: 'Validación',
    });
    expect(etapaDeProducto({ estado: 'Remitido', validado: false })).toMatchObject({
      paso: 4,
      nombre: 'Remitido',
    });
  });
});

describe('estadoDePaso', () => {
  it('devuelve el literal que se escribe en el PATCH', () => {
    expect(estadoDePaso(1)).toBe('Cargado');
    expect(estadoDePaso(2)).toBe('Validado');
    expect(estadoDePaso(3)).toBe('Aprobado');
    expect(estadoDePaso(4)).toBe('Remitido');
  });

  it('devuelve null para un paso inexistente', () => {
    expect(estadoDePaso(0)).toBeNull();
    expect(estadoDePaso(5)).toBeNull();
  });
});

describe('claseEstadoProducto', () => {
  it.each([
    ['Aprobado', 'state-approved'],
    ['Remitido', 'state-approved'],
    ['Rechazado', 'state-dismissed'],
    ['Validado', 'state-pending'],
    ['Cargado', 'state-pending'],
    ['', 'state-pending'],
    [null, 'state-pending'],
  ] as const)('«%s» usa la clase %s', (estado, clase) => {
    expect(claseEstadoProducto(estado)).toBe(clase);
  });
});

describe('etiquetaEstadoProducto', () => {
  it('conserva el literal del estado y rotula el vacío como Cargado', () => {
    expect(etiquetaEstadoProducto('Aprobado')).toBe('Aprobado');
    expect(etiquetaEstadoProducto('  ')).toBe('Cargado');
    expect(etiquetaEstadoProducto(null)).toBe('Cargado');
  });
});
