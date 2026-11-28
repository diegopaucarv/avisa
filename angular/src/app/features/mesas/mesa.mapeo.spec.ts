import { describe, expect, it } from 'vitest';

import {
  aCompromisoMesa,
  aHito,
  aMesa,
  aMesaDetalle,
  avanceHitos,
  claseEstadoHito,
  claseVigencia,
  leerResumen,
  naturalezaDe,
  vigenciaDe,
} from './mesa.mapeo';

describe('vigenciaDe', () => {
  it('reconoce el catálogo sin importar mayúsculas ni diacríticos', () => {
    expect(vigenciaDe('Vigente')).toBe('Vigente');
    expect(vigenciaDe('  por vencer  ')).toBe('Por vencer');
    expect(vigenciaDe('VENCIDO')).toBe('Vencido');
    expect(vigenciaDe('Permanente')).toBe('Permanente');
  });

  it('cae en «Sin fecha» ante un valor desconocido o vacío', () => {
    expect(vigenciaDe(null)).toBe('Sin fecha');
    expect(vigenciaDe('')).toBe('Sin fecha');
    expect(vigenciaDe('en revisión')).toBe('Sin fecha');
  });
});

describe('naturalezaDe', () => {
  it('reconoce Temporal y Permanente', () => {
    expect(naturalezaDe('temporal')).toBe('Temporal');
    expect(naturalezaDe('Permanente')).toBe('Permanente');
  });

  it('usa «No definida» cuando no hay dato', () => {
    expect(naturalezaDe(null)).toBe('No definida');
    expect(naturalezaDe('mixta')).toBe('No definida');
  });
});

describe('aMesa', () => {
  it('lee snake_case, recorta textos y convierte números enviados como texto', () => {
    const mesa = aMesa({
      id: 'm-1',
      codigo: '  OAIPCS-001 ',
      titulo: ' Mesa de prueba ',
      tipo_instrumento: 'Acta',
      naturaleza: 'Temporal',
      estado_vigencia: 'Por vencer',
      ambito_departamento: 'Loreto, Ucayali',
      fecha_instalacion: '2025-03-01',
      fecha_fin_vigencia: '2026-12-31',
      miembros: '4',
      compromisos: '0',
      compromisos_cumplidos: '0',
      caso_codigo: 'MD-2026-0001',
    });

    expect(mesa.codigo).toBe('OAIPCS-001');
    expect(mesa.titulo).toBe('Mesa de prueba');
    expect(mesa.tipoInstrumento).toBe('Acta');
    expect(mesa.estadoVigencia).toBe('Por vencer');
    expect(mesa.ambito).toBe('Loreto, Ucayali');
    expect(mesa.esNacional).toBe(false);
    expect(mesa.miembros).toBe(4);
    expect(mesa.casoCodigo).toBe('MD-2026-0001');
  });

  it('rellena código, título y contadores cuando faltan', () => {
    const mesa = aMesa({});

    expect(mesa.codigo).toBe('Sin código');
    expect(mesa.titulo).toBe('Mesa sin título');
    expect(mesa.naturaleza).toBe('No definida');
    expect(mesa.estadoVigencia).toBe('Sin fecha');
    expect(mesa.miembros).toBe(0);
    expect(mesa.compromisos).toBe(0);
    expect(mesa.compromisosCumplidos).toBe(0);
    expect(mesa.casoCodigo).toBeNull();
    expect(mesa.esNacional).toBe(false);
  });

  it('tolera un bruto que no es registro', () => {
    expect(aMesa(null).codigo).toBe('Sin código');
    expect(aMesa([1, 2]).codigo).toBe('Sin código');
  });

  it('muestra «Nacional» y conserva el ámbito detallado de una mesa nacional', () => {
    const mesa = aMesa({
      codigo: 'OAIPCS-013',
      ambito: 'Nacional',
      ambitoDetalle: 'Junín, Pasco, Huánuco, Cusco, Ayacucho',
      esNacional: true,
    });

    expect(mesa.ambito).toBe('Nacional');
    expect(mesa.ambitoDetalle).toBe('Junín, Pasco, Huánuco, Cusco, Ayacucho');
    expect(mesa.esNacional).toBe(true);
  });
});

describe('leerResumen', () => {
  it('lee las cifras del sobre, incluidas las claves snake_case', () => {
    expect(
      leerResumen({
        resumen: {
          mesas: 21,
          vigentes: 2,
          por_vencer: 2,
          vencidas: 9,
          miembros: 62,
          compromisos: 0,
        },
      }),
    ).toEqual({
      mesas: 21,
      vigentes: 2,
      porVencer: 2,
      vencidas: 9,
      miembros: 62,
      compromisos: 0,
    });
  });

  it('devuelve ceros cuando el resumen viene incompleto', () => {
    expect(leerResumen({ resumen: { mesas: 21 } })).toEqual({
      mesas: 21,
      vigentes: 0,
      porVencer: 0,
      vencidas: 0,
      miembros: 0,
      compromisos: 0,
    });
  });

  it('devuelve null cuando no hay sobre de resumen', () => {
    expect(leerResumen(null)).toBeNull();
    expect(leerResumen({})).toBeNull();
    expect(leerResumen({ resumen: [] })).toBeNull();
  });
});

describe('aHito', () => {
  it('normaliza el estado por defecto a «Registrado»', () => {
    const hito = aHito({ codigo: 'H001', descripcion: 'Instalar la mesa' });

    expect(hito).toEqual({
      codigo: 'H001',
      descripcion: 'Instalar la mesa',
      estado: 'Registrado',
      fecha: null,
    });
  });

  it('acepta el catálogo de estados tal cual llega', () => {
    expect(aHito({ estado: 'En ejecución', fecha: '2026-01-10' }).estado).toBe('En ejecución');
  });
});

describe('aCompromisoMesa', () => {
  it('cuenta los hitos del arreglo cuando el sobre no trae totales', () => {
    const compromiso = aCompromisoMesa({
      codigo: 'CS-2026-0001_COMP001',
      titulo: 'Revisar el acta',
      estado: 'En proceso',
      hitos: [
        { codigo: 'H001', estado: 'Cumplido' },
        { codigo: 'H002', estado: 'En ejecución' },
        { codigo: 'H003', estado: 'cumplido' },
      ],
    });

    expect(compromiso.hitosTotal).toBe(3);
    expect(compromiso.hitosCumplidos).toBe(2);
  });

  it('respeta los totales del servidor cuando llegan', () => {
    const compromiso = aCompromisoMesa({
      hitos_total: '5',
      hitos_cumplidos: '2',
      hitos: [{ codigo: 'H001', estado: 'Cumplido' }],
    });

    expect(compromiso.hitosTotal).toBe(5);
    expect(compromiso.hitosCumplidos).toBe(2);
  });

  it('mapea el próximo hito y deja el resto en el arreglo', () => {
    const compromiso = aCompromisoMesa({
      proximo_hito: { codigo: 'H002', descripcion: 'Siguiente', fecha: '2026-06-01' },
      hitos: [{ codigo: 'H001', estado: 'Cumplido' }],
    });

    expect(compromiso.proximoHito).toEqual({
      codigo: 'H002',
      descripcion: 'Siguiente',
      estado: 'Registrado',
      fecha: '2026-06-01',
    });
    expect(compromiso.hitos).toHaveLength(1);
  });

  it('normaliza el estado y los campos de la mesa', () => {
    const compromiso = aCompromisoMesa({
      estado: 'cumplido',
      area: 'OAIPCS',
      fecha_limite: '2026-07-01',
      mesa_codigo: 'OAIPCS-001',
      mesa_titulo: 'Mesa Loreto',
    });

    expect(compromiso.estado).toBe('Cumplido');
    expect(compromiso.area).toBe('OAIPCS');
    expect(compromiso.fechaLimite).toBe('2026-07-01');
    expect(compromiso.mesaCodigo).toBe('OAIPCS-001');
    expect(compromiso.mesaTitulo).toBe('Mesa Loreto');
    expect(compromiso.proximoHito).toBeNull();
  });

  it('marca el compromiso sin datos como «Por iniciar» y sin hitos', () => {
    const compromiso = aCompromisoMesa({});

    expect(compromiso.estado).toBe('Por iniciar');
    expect(compromiso.hitosTotal).toBe(0);
    expect(compromiso.hitosCumplidos).toBe(0);
    expect(compromiso.hitos).toEqual([]);
  });
});

describe('aMesaDetalle', () => {
  it('devuelve null sin mesa', () => {
    expect(aMesaDetalle({})).toBeNull();
    expect(aMesaDetalle(null)).toBeNull();
  });

  it('compone mesa, caso, integrantes y compromisos', () => {
    const detalle = aMesaDetalle({
      mesa: {
        codigo: 'OAIPCS-001',
        titulo: 'Mesa Loreto',
        objetivo: 'Coordinar',
        base_legal: 'R.M. 123',
      },
      caso: { codigo: 'MD-2026-0001', estado: 'Abierto', titulo: 'Mesa Loreto' },
      integrantes: [
        {
          id: 'i-1',
          rol: 'Preside',
          nombre: 'Ana',
          doc_designacion: 'R.M. 456',
        },
      ],
      compromisos: [{ codigo: 'CS-2026-0001_COMP001', hitos: [] }],
    });

    expect(detalle?.mesa.objetivo).toBe('Coordinar');
    expect(detalle?.mesa.baseLegal).toBe('R.M. 123');
    expect(detalle?.caso).toEqual({
      codigo: 'MD-2026-0001',
      estado: 'Abierto',
      titulo: 'Mesa Loreto',
    });
    expect(detalle?.integrantes).toHaveLength(1);
    expect(detalle?.integrantes[0]?.rol).toBe('Preside');
    expect(detalle?.compromisos).toHaveLength(1);
  });

  it('declara el caso ausente en vez de inventarlo', () => {
    const detalle = aMesaDetalle({ mesa: { codigo: 'OAIPCS-034' } });

    expect(detalle?.caso).toBeNull();
    expect(detalle?.integrantes).toEqual([]);
    expect(detalle?.compromisos).toEqual([]);
  });

  it('usa «Abierto» si el caso no informa estado', () => {
    expect(aMesaDetalle({ mesa: {}, caso: { codigo: 'MD-2026-0002' } })?.caso).toEqual({
      codigo: 'MD-2026-0002',
      estado: 'Abierto',
      titulo: null,
    });
  });
});

describe('avanceHitos', () => {
  it('cuenta los cumplidos sin importar mayúsculas', () => {
    expect(
      avanceHitos([
        { codigo: 'H001', descripcion: null, estado: 'Cumplido', fecha: null },
        { codigo: 'H002', descripcion: null, estado: 'cumplido', fecha: null },
        { codigo: 'H003', descripcion: null, estado: 'En ejecución', fecha: null },
      ]),
    ).toBe('2/3');
  });

  it('devuelve un guion cuando no hay hitos', () => {
    expect(avanceHitos([])).toBe('—');
    expect(avanceHitos(undefined)).toBe('—');
  });
});

describe('claseVigencia', () => {
  it('asigna el tono de cada vigencia', () => {
    expect(claseVigencia('Vigente')).toBe('commit-cumplido');
    expect(claseVigencia('Por vencer')).toBe('commit-por-vencer');
    expect(claseVigencia('Vencido')).toBe('commit-vencido');
    expect(claseVigencia('Permanente')).toBe('commit-en-curso');
    expect(claseVigencia('Sin fecha')).toBe('commit-en-curso');
  });
});

describe('claseEstadoHito', () => {
  it('asigna el tono de cada estado de hito', () => {
    expect(claseEstadoHito('Cumplido')).toBe('commit-cumplido');
    expect(claseEstadoHito('En ejecución')).toBe('commit-en-curso');
    expect(claseEstadoHito('Paralizado')).toBe('commit-paralizado');
    expect(claseEstadoHito('No cumplido')).toBe('commit-vencido');
    expect(claseEstadoHito('Desestimado')).toBe('commit-vencido');
    expect(claseEstadoHito('Registrado')).toBe('');
  });
});
