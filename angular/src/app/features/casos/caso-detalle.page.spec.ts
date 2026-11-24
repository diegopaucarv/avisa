import { describe, expect, it } from 'vitest';

import {
  ACCIONES_HITO,
  ESTADOS_HITO_FICHA,
  aDetalleCasoConCompromisos,
  claseEstadoHito,
  codigoHitoVisible,
  esEstadoHitoFicha,
  referenciaHito,
  textoFechaHito,
  textoFechaRealHito,
} from './caso-detalle.page';

describe('hitos de la ficha: columnas', () => {
  it('pinta el código del compromiso y del hito, y «—» si falta el del hito', () => {
    expect(codigoHitoVisible('COMP001_H001')).toBe('COMP001_H001');
    expect(codigoHitoVisible('  COMP002_H003  ')).toBe('COMP002_H003');
    expect(codigoHitoVisible(null)).toBe('—');
    expect(codigoHitoVisible('')).toBe('—');
  });

  it('usa el código del hito en las etiquetas accesibles de los controles', () => {
    expect(referenciaHito('COMP001_H001')).toBe('COMP001_H001');
    expect(referenciaHito(null)).toBe('sin código');
  });

  it('formatea la fecha planificada y cae al texto del origen', () => {
    expect(textoFechaHito('2026-04-04', null)).toBe('04/04/2026');
    expect(textoFechaHito(null, 'Julio 2026')).toBe('Julio 2026');
    expect(textoFechaHito('', '  Julio 2026 ')).toBe('Julio 2026');
    expect(textoFechaHito(null, null)).toBe('—');
  });

  it('formatea la fecha real y declara su ausencia sin estimar', () => {
    expect(textoFechaRealHito('2026-12-02', null)).toBe('02/12/2026');
    expect(textoFechaRealHito(null, 'Diciembre 2025')).toBe('Diciembre 2025');
    expect(textoFechaRealHito(null, null)).toBe('Sin fecha real');
    expect(textoFechaRealHito('', '')).toBe('Sin fecha real');
  });
});

describe('hitos de la ficha: insignia de estado', () => {
  it('Cumplido va aprobado', () => {
    expect(claseEstadoHito('Cumplido')).toBe('state-approved');
    expect(claseEstadoHito('  cumplido ')).toBe('state-approved');
  });

  it('Paralizado, Desestimado y No cumplido van desestimados', () => {
    expect(claseEstadoHito('Paralizado')).toBe('state-dismissed');
    expect(claseEstadoHito('Desestimado')).toBe('state-dismissed');
    expect(claseEstadoHito('No cumplido')).toBe('state-dismissed');
  });

  it('el resto queda pendiente, incluido el estado ausente', () => {
    expect(claseEstadoHito('Registrado')).toBe('state-pending');
    expect(claseEstadoHito('En ejecución')).toBe('state-pending');
    expect(claseEstadoHito(null)).toBe('state-pending');
  });
});

describe('hitos de la ficha: acciones', () => {
  it('declara el orden estado → fecha real → responsable', () => {
    expect(ACCIONES_HITO).toEqual(['estado', 'fechaReal', 'responsable']);
  });

  it('ofrece los seis estados del catálogo en su orden', () => {
    expect(ESTADOS_HITO_FICHA).toEqual([
      'Registrado',
      'En ejecución',
      'Paralizado',
      'Cumplido',
      'Desestimado',
      'No cumplido',
    ]);
  });

  it('sólo acepta estados del catálogo en el select', () => {
    expect(esEstadoHitoFicha('Cumplido')).toBe(true);
    expect(esEstadoHitoFicha('No cumplido')).toBe(true);
    expect(esEstadoHitoFicha('Pendiente')).toBe(false);
    expect(esEstadoHitoFicha('')).toBe(false);
  });
});

/**
 * Respuesta mínima de `GET /api/v1/cases/{codigo}` con las claves camelCase que
 * el contrato garantiza por hito. El segundo hito llega sin ellas: es el caso
 * en el que la ficha debe declarar el dato ausente en vez de inventarlo.
 */
const CASO_BRUTO = {
  caso: { codigo: 'CASO-001', titulo: 'Caso de prueba', estado: 'Abierto' },
  compromisos: [
    {
      id: 'cmp-1',
      codigo: 'COMP001',
      accion: 'Aprobación de términos de referencia',
      hitos: [
        {
          id: 'hito-1',
          codigo: 'COMP001_H001',
          descripcion: 'Aprobación de términos de referencia',
          fecha: '2026-04-04',
          fechaTexto: null,
          fechaReal: '2026-12-02',
          fechaRealTexto: null,
          estado: 'Cumplido',
          terminal: true,
          validacion: null,
          descripcionEvidencia: null,
          linkEvidencia: null,
          responsableTexto: 'Ana Quispe',
          responsableUsuarioId: 'usuario-1',
        },
        { id: 'hito-2', descripcion: 'Informe final', estado: 'En ejecución' },
      ],
    },
  ],
};

describe('hitos de la ficha: esquema del detalle', () => {
  it('conserva el código, la fecha real y la bandera de terminal del hito', () => {
    const detalle = aDetalleCasoConCompromisos(CASO_BRUTO);
    const hito = detalle.compromisos[0].hitos[0];

    expect(hito.id).toBe('hito-1');
    expect(hito.codigo).toBe('COMP001_H001');
    expect(hito.fechaReal).toBe('2026-12-02');
    expect(hito.terminal).toBe(true);
    expect(hito.responsableTexto).toBe('Ana Quispe');
    expect(detalle.compromisos[0].id).toBe('cmp-1');
  });

  it('no inventa los datos que el hito no trae', () => {
    const detalle = aDetalleCasoConCompromisos(CASO_BRUTO);
    const hito = detalle.compromisos[0].hitos[1];

    expect(hito.codigo).toBeNull();
    expect(hito.fechaReal).toBeNull();
    expect(hito.terminal).toBe(false);
    expect(codigoHitoVisible(hito.codigo)).toBe('—');
    expect(textoFechaRealHito(hito.fechaReal, hito.fechaRealTexto)).toBe('Sin fecha real');
  });
});
