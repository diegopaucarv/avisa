import { describe, expect, it } from 'vitest';

import {
  PASO_APROBACION_DEFINITIVA,
  accionesDeFlujo,
  claseEstado,
  etapaDeFlujo,
} from './alerta.mapeo';

describe('transiciones del flujo de alertas', () => {
  it('declara los destinos legales desde cada paso', () => {
    expect(accionesDeFlujo(1).map((accion) => accion.paso)).toEqual([2]);
    expect(accionesDeFlujo(2).map((accion) => accion.paso)).toEqual([3, 1]);
    expect(accionesDeFlujo(3).map((accion) => accion.paso)).toEqual([4, 2, 1]);
    expect(accionesDeFlujo(4).map((accion) => accion.paso)).toEqual([5]);
  });

  it('cierra el flujo en el paso 5 sin acciones', () => {
    expect(accionesDeFlujo(5)).toEqual([]);
  });

  it('no ofrece acciones para pasos fuera del flujo', () => {
    expect(accionesDeFlujo(0)).toEqual([]);
    expect(accionesDeFlujo(6)).toEqual([]);
    expect(accionesDeFlujo(99)).toEqual([]);
  });

  it('coloca la aprobación definitiva en el paso 3', () => {
    expect(PASO_APROBACION_DEFINITIVA).toBe(3);
    expect(accionesDeFlujo(2)).toContainEqual(
      expect.objectContaining({ paso: PASO_APROBACION_DEFINITIVA }),
    );
  });

  it('acompaña cada acción con etiqueta, detalle y responsable', () => {
    for (const paso of [1, 2, 3, 4]) {
      for (const accion of accionesDeFlujo(paso)) {
        expect(accion.etiqueta.trim()).not.toBe('');
        expect(accion.detalle.trim()).not.toBe('');
        expect(accion.responsable.trim()).not.toBe('');
        expect(accion.paso).not.toBe(paso);
      }
    }
  });

  it('describe la acción de envío a aprobación definitiva', () => {
    expect(accionesDeFlujo(2)[0]).toMatchObject({
      paso: 3,
      etiqueta: 'Enviar a aprobación definitiva',
      responsable: 'Dirección OAIPCS',
    });
  });
});

describe('etapaDeFlujo', () => {
  it('devuelve la etapa declarada para cada paso', () => {
    expect(etapaDeFlujo(1)).toMatchObject({ nombre: 'Elaboración', estado: 'Registrado' });
    expect(etapaDeFlujo(5)).toMatchObject({ nombre: 'Archivo', estado: 'Archivado' });
  });

  it('describe la aprobación definitiva con su responsable', () => {
    expect(etapaDeFlujo(PASO_APROBACION_DEFINITIVA)).toEqual({
      paso: 3,
      nombre: 'Aprobación definitiva',
      estado: 'Aprobado',
      responsable: 'Dirección OAIPCS',
    });
  });

  it('devuelve null para pasos que no existen en el flujo', () => {
    expect(etapaDeFlujo(0)).toBeNull();
    expect(etapaDeFlujo(6)).toBeNull();
  });
});

describe('claseEstado', () => {
  it.each([
    ['Aprobada', 'state-approved'],
    ['Atendida', 'state-dismissed'],
    ['Registrado', 'state-pending'],
    ['Validado', 'state-pending'],
    ['Remitido', 'state-pending'],
    ['Archivado', 'state-pending'],
    ['', 'state-pending'],
  ] as const)('%s usa la clase %s', (estado: string, clase: string) => {
    expect(claseEstado(estado)).toBe(clase);
  });
});
