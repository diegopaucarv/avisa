import { describe, expect, it } from 'vitest';

import type { CompromisoCaso } from '../../dominio/mapeo';
import {
  aCompromiso,
  aCompromisosCaso,
  aSugerenciaUsuario,
  etiquetaClasificacionAlcance,
  etiquetaDemandaVinculada,
  etiquetaFormalVerbal,
  etiquetaPuntoFocal,
  formatearFecha,
  resolverVencimiento,
  situacionDe,
  type Compromiso,
} from './compromiso.mapeo';

/** 23/11/2026, fecha fija para no depender del reloj de la máquina. */
const HOY = new Date(2026, 10, 23);

function compromiso(parcial: Partial<Compromiso> = {}): Compromiso {
  return {
    id: 'comp-1',
    codigo: 'CM-1',
    accion: 'Acción de prueba',
    casoId: null,
    casoCodigo: null,
    casoTitulo: null,
    demandaId: null,
    demandaCodigo: null,
    demandaTexto: null,
    tipo: 'Actividad',
    clasificacionAlcance: null,
    formalVerbal: null,
    asumidoMinistro: false,
    nivelGobierno: null,
    estado: 'En proceso',
    estadoCategoria: null,
    terminal: false,
    fechaInicio: null,
    fechaVencimiento: null,
    fechaVencimientoEfectiva: null,
    origenVencimiento: null,
    unidad: null,
    alcance: null,
    tematica: null,
    atiendeGenero: false,
    puntoFocalUsuarioId: null,
    puntoFocalTexto: null,
    puntoFocal: null,
    evidenciaUri: null,
    criteriosSmart: null,
    documentoOrigenId: null,
    origen: null,
    confianza: null,
    validado: false,
    anuladoEn: null,
    motivoAnulacion: null,
    anuladoPor: null,
    anuladoPorNombre: null,
    anulacionId: null,
    clasificacion: 1,
    hitos: [],
    proximoHito: null,
    vencido: false,
    ...parcial,
  };
}

describe('resolverVencimiento', () => {
  it('prefiere la fecha manual y marca su origen', () => {
    const resolucion = resolverVencimiento(
      compromiso({
        fechaVencimiento: '2026-12-01',
        fechaVencimientoEfectiva: '2026-11-25',
        origenVencimiento: 'hito',
      }),
    );

    expect(resolucion).toEqual({ fecha: '2026-12-01', origen: 'manual' });
  });

  it('usa la fecha efectiva del próximo hito cuando no hay manual', () => {
    const resolucion = resolverVencimiento(
      compromiso({
        fechaVencimientoEfectiva: '2026-11-25',
        origenVencimiento: 'hito',
      }),
    );

    expect(resolucion).toEqual({ fecha: '2026-11-25', origen: 'hito' });
  });

  it('asume origen `hito` si la fecha efectiva llega sin origen declarado', () => {
    const resolucion = resolverVencimiento(compromiso({ fechaVencimientoEfectiva: '2026-11-25' }));

    expect(resolucion).toEqual({ fecha: '2026-11-25', origen: 'hito' });
  });

  it('no inventa fecha ni origen cuando faltan ambas', () => {
    expect(resolverVencimiento(compromiso())).toEqual({ fecha: null, origen: null });
  });
});

describe('situacionDe', () => {
  it('deja sin fecha un compromiso que no tiene vencimiento', () => {
    expect(situacionDe(compromiso(), HOY)).toEqual({
      etiqueta: 'Sin fecha',
      clase: 'due-sin-fecha',
    });
  });

  it('respeta la marca `vencido` de la API por encima de la fecha', () => {
    expect(situacionDe(compromiso({ fechaVencimiento: '2027-03-01', vencido: true }), HOY)).toEqual(
      { etiqueta: 'Vencido', clase: 'due-vencido' },
    );
  });

  it('no etiqueta como vencido lo que no tiene fecha aunque la API lo marque', () => {
    expect(situacionDe(compromiso({ vencido: true }), HOY)).toEqual({
      etiqueta: 'Sin fecha',
      clase: 'due-sin-fecha',
    });
  });

  it('incluye hoy y el día 30 en «Por vencer»', () => {
    expect(situacionDe(compromiso({ fechaVencimiento: '2026-11-23' }), HOY).clase).toBe(
      'due-por-vencer',
    );
    expect(situacionDe(compromiso({ fechaVencimiento: '2026-12-23' }), HOY).clase).toBe(
      'due-por-vencer',
    );
  });

  it('deja en plazo el día 31 y las fechas futuras lejanas', () => {
    expect(situacionDe(compromiso({ fechaVencimiento: '2026-12-24' }), HOY).clase).toBe(
      'due-en-plazo',
    );
    expect(situacionDe(compromiso({ fechaVencimiento: '2027-03-01' }), HOY).clase).toBe(
      'due-en-plazo',
    );
  });

  it('depende de la marca de la API para una fecha ya pasada', () => {
    expect(situacionDe(compromiso({ fechaVencimiento: '2026-11-22' }), HOY)).toEqual({
      etiqueta: 'En plazo',
      clase: 'due-en-plazo',
    });
  });

  it('usa la fecha efectiva cuando no hay manual', () => {
    const situacion = situacionDe(
      compromiso({ fechaVencimientoEfectiva: '2026-11-25', origenVencimiento: 'hito' }),
      HOY,
    );

    expect(situacion).toEqual({ etiqueta: 'Por vencer', clase: 'due-por-vencer' });
  });

  it('admite una fecha ISO con hora', () => {
    const situacion = situacionDe(
      compromiso({ fechaVencimiento: '2026-11-25T10:30:00.000Z' }),
      HOY,
    );

    expect(situacion.clase).toBe('due-por-vencer');
  });
});

describe('formatearFecha', () => {
  it('presenta las fechas del backend en formato corto', () => {
    expect(formatearFecha('2026-11-23')).toBe('23NOV2026');
    expect(formatearFecha('2026-11-23T00:00:00.000Z')).toBe('23NOV2026');
  });

  it('normaliza el formato legado DD/MM/YYYY', () => {
    expect(formatearFecha('23/11/2026')).toBe('23NOV2026');
    expect(formatearFecha('3/1/2026')).toBe('03ENE2026');
  });

  it('devuelve un guion cuando no hay fecha', () => {
    expect(formatearFecha(null)).toBe('—');
    expect(formatearFecha(undefined)).toBe('—');
    expect(formatearFecha('')).toBe('—');
  });

  it('devuelve un guion cuando no reconoce el valor', () => {
    expect(formatearFecha('sin fecha')).toBe('—');
  });
});

describe('columnas nuevas del compromiso', () => {
  it('lee clasificación, carácter y bandera del Ministro en camelCase', () => {
    const leido = aCompromiso({
      id: 'comp-9',
      clasificacionAlcance: 'entendimiento_operativo',
      formalVerbal: 'verbal',
      asumidoMinistro: true,
    });

    expect(leido.clasificacionAlcance).toBe('entendimiento_operativo');
    expect(leido.formalVerbal).toBe('verbal');
    expect(leido.asumidoMinistro).toBe(true);
    expect(etiquetaClasificacionAlcance(leido.clasificacionAlcance)).toBe(
      'Entendimiento operativo',
    );
    expect(etiquetaFormalVerbal(leido.formalVerbal)).toBe('Verbal');
  });

  it('lee las grafías snake_case de la misma fila', () => {
    const leido = aCompromiso({
      id: 'comp-10',
      clasificacion_alcance: 'progresivo_parcial',
      formal_verbal: 'formal',
      asumido_ministro: true,
    });

    expect(leido.clasificacionAlcance).toBe('progresivo_parcial');
    expect(leido.formalVerbal).toBe('formal');
    expect(leido.asumidoMinistro).toBe(true);
    expect(etiquetaClasificacionAlcance(leido.clasificacionAlcance)).toBe('Progresivo y parcial');
    expect(etiquetaFormalVerbal(leido.formalVerbal)).toBe('Formal');
  });

  it('deja null y false una fila sin datos y la UI muestra «Sin declarar»', () => {
    const leido = aCompromiso({ id: 'comp-11' });

    expect(leido.clasificacionAlcance).toBeNull();
    expect(leido.formalVerbal).toBeNull();
    expect(leido.asumidoMinistro).toBe(false);
    expect(etiquetaClasificacionAlcance(leido.clasificacionAlcance)).toBe('Sin declarar');
    expect(etiquetaFormalVerbal(leido.formalVerbal)).toBe('Sin declarar');
  });

  it('no inventa valores fuera de las tres clasificaciones ni de formal/verbal', () => {
    const leido = aCompromiso({
      clasificacion_alcance: 'otro_valor',
      formal_verbal: 'mixto',
    });

    expect(leido.clasificacionAlcance).toBeNull();
    expect(leido.formalVerbal).toBeNull();
  });

  it('lee las columnas nuevas de los hitos en ambas grafías', () => {
    const leido = aCompromiso({
      id: 'comp-12',
      hitos: [
        {
          id: 'hito-1',
          responsableTexto: 'IMARPE',
          fechaTexto: 'Julio 2026',
          fechaRealTexto: 'No aplica',
        },
        {
          id: 'hito-2',
          responsable_texto: 'FONDEPES',
          fecha_texto: '02.01.2026',
          fecha_real_texto: '03.01.2026',
        },
      ],
    });

    expect(leido.hitos[0].responsableTexto).toBe('IMARPE');
    expect(leido.hitos[0].fechaTexto).toBe('Julio 2026');
    expect(leido.hitos[0].fechaRealTexto).toBe('No aplica');
    expect(leido.hitos[1].responsableTexto).toBe('FONDEPES');
    expect(leido.hitos[1].fechaTexto).toBe('02.01.2026');
    expect(leido.hitos[1].fechaRealTexto).toBe('03.01.2026');
  });
});

describe('demanda y punto focal del compromiso', () => {
  it('lee la demanda y el punto focal en camelCase', () => {
    const leido = aCompromiso({
      id: 'comp-20',
      demandaId: 'demanda-1',
      demandaCodigo: 'DEM-001',
      demandaTexto: 'Acceso al agua para el centro poblado',
      puntoFocalUsuarioId: 'usuario-7',
      puntoFocalTexto: null,
      puntoFocal: 'Ana Quispe',
    });

    expect(leido.demandaId).toBe('demanda-1');
    expect(leido.demandaCodigo).toBe('DEM-001');
    expect(leido.demandaTexto).toBe('Acceso al agua para el centro poblado');
    expect(leido.puntoFocalUsuarioId).toBe('usuario-7');
    expect(leido.puntoFocal).toBe('Ana Quispe');
  });

  it('lee las grafas snake_case de la misma fila', () => {
    const leido = aCompromiso({
      id: 'comp-21',
      demanda_id: 'demanda-2',
      demanda_codigo: 'DEM-002',
      demanda_texto: 'Mejora del servicio de saneamiento',
      punto_focal_usuario_id: 'usuario-9',
      punto_focal_texto: 'Equipo técnico del GORE',
      punto_focal: 'Luis Ramos',
    });

    expect(leido.demandaId).toBe('demanda-2');
    expect(leido.demandaCodigo).toBe('DEM-002');
    expect(leido.demandaTexto).toBe('Mejora del servicio de saneamiento');
    expect(leido.puntoFocalUsuarioId).toBe('usuario-9');
    expect(leido.puntoFocalTexto).toBe('Equipo técnico del GORE');
    expect(leido.puntoFocal).toBe('Luis Ramos');
  });

  it('deja null los campos nuevos cuando la fila no los trae', () => {
    const leido = aCompromiso({ id: 'comp-22' });

    expect(leido.demandaId).toBeNull();
    expect(leido.demandaCodigo).toBeNull();
    expect(leido.demandaTexto).toBeNull();
    expect(leido.puntoFocalUsuarioId).toBeNull();
    expect(leido.puntoFocalTexto).toBeNull();
    expect(leido.puntoFocal).toBeNull();
    expect(etiquetaDemandaVinculada(leido)).toBe('Sin demanda');
    expect(etiquetaPuntoFocal(leido)).toBe('Sin punto focal');
  });

  it('compone código y texto de la demanda, y acepta sólo una de las dos partes', () => {
    expect(
      etiquetaDemandaVinculada({ demandaCodigo: 'DEM-003', demandaTexto: 'Título de la demanda' }),
    ).toBe('DEM-003 · Título de la demanda');
    expect(etiquetaDemandaVinculada({ demandaCodigo: 'DEM-004', demandaTexto: null })).toBe(
      'DEM-004',
    );
    expect(etiquetaDemandaVinculada({ demandaCodigo: null, demandaTexto: 'Sólo texto' })).toBe(
      'Sólo texto',
    );
  });

  it('prefiere el nombre resuelto del punto focal sobre el texto libre', () => {
    expect(etiquetaPuntoFocal({ puntoFocal: 'Ana Quispe', puntoFocalTexto: 'Ana' })).toBe(
      'Ana Quispe',
    );
    expect(etiquetaPuntoFocal({ puntoFocal: null, puntoFocalTexto: 'Equipo técnico' })).toBe(
      'Equipo técnico',
    );
  });
});

describe('aSugerenciaUsuario', () => {
  it('lee id y nombre de una fila del directorio', () => {
    expect(aSugerenciaUsuario({ id: 'usuario-1', nombre: 'Ana Quispe' })).toEqual({
      id: 'usuario-1',
      nombre: 'Ana Quispe',
    });
    expect(aSugerenciaUsuario({ usuario_id: 'usuario-2', name: 'Luis Ramos' })).toEqual({
      id: 'usuario-2',
      nombre: 'Luis Ramos',
    });
  });

  it('descarta una fila sin id o sin nombre', () => {
    expect(aSugerenciaUsuario({ nombre: 'Sin id' })).toBeNull();
    expect(aSugerenciaUsuario({ id: 'usuario-3' })).toBeNull();
    expect(aSugerenciaUsuario(null)).toBeNull();
  });
});

describe('compromisos del detalle del caso', () => {
  const base: CompromisoCaso = {
    id: 'comp-1',
    codigo: 'COMP001',
    accion: 'Acción de prueba',
    estado: 'En proceso',
    nivelGobierno: null,
    unidad: null,
    vencimiento: null,
    origenVencimiento: null,
    hitos: [{ id: 'hito-1', descripcion: 'Hito', fecha: null, estado: 'Registrado' }],
  };

  it('recupera del bruto las columnas que el mapeo genérico descarta', () => {
    const [compromiso] = aCompromisosCaso(
      {
        compromisos: [
          {
            id: 'comp-1',
            clasificacion_alcance: 'condicionado',
            formal_verbal: 'formal',
            asumido_ministro: true,
            hitos: [{ id: 'hito-1', responsable_texto: 'MEF', fecha_texto: 'Depende de obra' }],
          },
        ],
      },
      [base],
    );

    expect(compromiso.clasificacionAlcance).toBe('condicionado');
    expect(compromiso.formalVerbal).toBe('formal');
    expect(compromiso.asumidoMinistro).toBe(true);
    expect(compromiso.hitos[0].responsableTexto).toBe('MEF');
    expect(compromiso.hitos[0].fechaTexto).toBe('Depende de obra');
    expect(compromiso.codigo).toBe('COMP001');
  });

  it('deja las columnas nuevas vacías cuando el detalle no las trae', () => {
    const [compromiso] = aCompromisosCaso({ compromisos: [{ id: 'comp-1' }, { id: 'comp-2' }] }, [
      base,
    ]);

    expect(compromiso.clasificacionAlcance).toBeNull();
    expect(compromiso.formalVerbal).toBeNull();
    expect(compromiso.asumidoMinistro).toBe(false);
    expect(compromiso.hitos[0].responsableTexto).toBeNull();
  });
});
