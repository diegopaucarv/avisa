import { describe, expect, it } from 'vitest';

import {
  ACCIONES_HITO,
  ESTADOS_HITO_FICHA,
  aDetalleCasoConCompromisos,
  claseEstadoHito,
  codigoHitoVisible,
  esEstadoHitoFicha,
  fechaHoyIso,
  hechoEnVentana,
  integrantesTexto,
  referenciaHito,
  textoFechaHito,
  textoFechaRealHito,
  textoTipologias,
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
    expect(textoFechaHito('2026-04-04', null)).toBe('04ABR2026');
    expect(textoFechaHito(null, 'Julio 2026')).toBe('Julio 2026');
    expect(textoFechaHito('', '  Julio 2026 ')).toBe('Julio 2026');
    expect(textoFechaHito(null, null)).toBe('—');
  });

  it('formatea la fecha real y declara su ausencia sin estimar', () => {
    expect(textoFechaRealHito('2026-12-02', null)).toBe('02DIC2026');
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

describe('mesa del caso: bloque condicional', () => {
  it('un caso común no trae mesa', () => {
    const detalle = aDetalleCasoConCompromisos(CASO_BRUTO);

    expect(detalle.mesa).toBeNull();
  });

  it('mapea la mesa que entrega la API en camelCase', () => {
    const detalle = aDetalleCasoConCompromisos({
      ...CASO_BRUTO,
      mesa: {
        id: 'mesa-1',
        codigo: 'OAIPCS-007',
        titulo: 'Mesa de diálogo por la educación',
        naturaleza: 'Temporal',
        estadoVigencia: 'Por vencer',
        fechaInstalacion: '2025-03-14',
        fechaFinVigencia: '2026-12-31',
        tipoInstrumento: 'Resolución',
        baseLegal: 'R.M. 123-2025',
        ambitoDepartamento: 'Lima',
        objetivo: 'Articular la respuesta institucional.',
        miembros: 4,
      },
    });

    expect(detalle.mesa).toEqual({
      codigo: 'OAIPCS-007',
      titulo: 'Mesa de diálogo por la educación',
      naturaleza: 'Temporal',
      estadoVigencia: 'Por vencer',
      fechaInstalacion: '2025-03-14',
      fechaFinVigencia: '2026-12-31',
      tipoInstrumento: 'Resolución',
      baseLegal: 'R.M. 123-2025',
      ambitoDepartamento: 'Lima',
      objetivo: 'Articular la respuesta institucional.',
      miembros: 4,
    });
  });

  it('lee también las claves snake_case y no inventa los datos ausentes', () => {
    const detalle = aDetalleCasoConCompromisos({
      ...CASO_BRUTO,
      mesa: {
        codigo: 'OAIPCS-008',
        titulo: 'Mesa sin ficha completa',
        estado_vigencia: 'Vigente',
        ambito_departamento: 'Cusco',
      },
    });

    expect(detalle.mesa?.estadoVigencia).toBe('Vigente');
    expect(detalle.mesa?.ambitoDepartamento).toBe('Cusco');
    expect(detalle.mesa?.tipoInstrumento).toBeNull();
    expect(detalle.mesa?.baseLegal).toBeNull();
    expect(detalle.mesa?.fechaInstalacion).toBeNull();
    expect(detalle.mesa?.objetivo).toBeNull();
    expect(detalle.mesa?.naturaleza).toBeNull();
    expect(detalle.mesa?.miembros).toBeNull();
  });

  it('sin estado de vigencia declara «Sin fecha», no un estado inventado', () => {
    const detalle = aDetalleCasoConCompromisos({
      ...CASO_BRUTO,
      mesa: { codigo: 'OAIPCS-009', titulo: 'Mesa sin vigencia' },
    });

    expect(detalle.mesa?.estadoVigencia).toBe('Sin fecha');
  });
});

describe('integrantes de la mesa', () => {
  it('declara el cero en vez de pintarlo como cifra', () => {
    expect(integrantesTexto(0)).toBe('sin integrantes registrados');
    expect(integrantesTexto(null)).toBe('sin integrantes registrados');
  });

  it('concuerda en singular y plural', () => {
    expect(integrantesTexto(1)).toBe('1 integrante registrado');
    expect(integrantesTexto(12)).toBe('12 integrantes registrados');
  });
});

/** Fecha local en `YYYY-MM-DD`: se arma con el constructor local a propósito. */
describe('cronología del expediente: fecha de hoy', () => {
  it('devuelve la fecha local sin desplazarla por zona horaria', () => {
    expect(fechaHoyIso(new Date(2026, 10, 27))).toBe('2026-11-27');
    expect(fechaHoyIso(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

describe('cronología del expediente: sólo el último hecho reciente', () => {
  const hoy = '2026-11-27';

  it('elige el hecho más reciente aunque el arreglo llegue desordenado', () => {
    const eventos = [
      { id: 'viejo', fecha: '2026-06-10' },
      { id: 'nuevo', fecha: '2026-11-20' },
      { id: 'medio', fecha: '2026-09-01' },
    ];

    expect(hechoEnVentana(eventos, hoy)?.id).toBe('nuevo');
  });

  it('devuelve null si el último hecho tiene más de seis meses', () => {
    const eventos = [
      { id: 'a', fecha: '2026-05-26' },
      { id: 'b', fecha: '2026-03-01' },
    ];

    expect(hechoEnVentana(eventos, hoy)).toBeNull();
  });

  it('incluye el borde de la ventana (seis meses exactos)', () => {
    expect(hechoEnVentana([{ id: 'borde', fecha: '2026-05-27' }], hoy)?.id).toBe('borde');
  });

  it('devuelve null sin hechos o con fechas inválidas', () => {
    expect(hechoEnVentana([], hoy)).toBeNull();
    expect(hechoEnVentana([{ id: 'x', fecha: '' }], hoy)).toBeNull();
    expect(hechoEnVentana([{ id: 'y', fecha: 'sin-fecha' }], hoy)).toBeNull();
  });
});

describe('tipologías del actor en la tabla', () => {
  it('une tipo, función y posicionamiento separados por coma', () => {
    expect(
      textoTipologias({
        tipo: 'Actor social',
        funcion: 'Principal',
        posicionamiento: 'Dialogante',
      }),
    ).toBe('Actor social, Principal, Dialogante');
  });

  it('omite el posicionamiento cuando falta', () => {
    expect(
      textoTipologias({ tipo: 'Actor social', funcion: 'Principal', posicionamiento: null }),
    ).toBe('Actor social, Principal');
  });

  it('recorta, deduplica y omite los vacíos', () => {
    expect(
      textoTipologias({ tipo: '  Actor público  ', funcion: null, posicionamiento: null }),
    ).toBe('Actor público');
    expect(
      textoTipologias({ tipo: 'Principal', funcion: 'Principal', posicionamiento: 'Principal' }),
    ).toBe('Principal');
    expect(textoTipologias({ tipo: '', funcion: '   ', posicionamiento: '' })).toBe('');
    expect(textoTipologias({ tipo: null, funcion: null, posicionamiento: null })).toBe('');
  });
});
