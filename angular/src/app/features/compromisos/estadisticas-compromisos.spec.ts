import { describe, expect, it } from 'vitest';

import {
  BOM,
  CABECERA_ESTADISTICAS,
  aEstadisticasCompromisos,
  generarCsvEstadisticas,
  nombreArchivoEstadisticas,
  ordenarPorArea,
  porcentajeCumplimiento,
  type EstadisticaArea,
  type EstadisticasCompromisos,
} from './estadisticas-compromisos';

/** Sobre con claves en camelCase, tal como lo sirve la API. */
function sobreCamelCase() {
  return {
    total: 10,
    vigentes: 5,
    cumplidos: 3,
    noCumplidos: 2,
    enProceso: 2,
    pendientes: 3,
    porEstado: [
      { estado: 'Cumplido', categoria: 'Cerrado', total: 3 },
      { estado: 'En proceso', categoria: 'Abierto', total: 2 },
    ],
    // Desordenado a propósito: el mapeo debe dejar el ranking por total desc.
    porArea: [
      { area: 'B', nombre: 'Dirección B', total: 2, cumplidos: 0, noCumplidos: 1 },
      { area: 'A', nombre: 'Dirección A', total: 5, cumplidos: 1, noCumplidos: 0 },
      { area: 'C', nombre: 'Dirección C', total: 2, cumplidos: 2, noCumplidos: 0 },
    ],
    porPlazo: { vencidos: 1, alDia: 5, sinPlazo: 4 },
    porEstadoHito: [{ estado: 'Cumplido', total: 8 }],
    generatedAt: '2026-11-27T00:00:00.000Z',
  };
}

function area(parcial: Partial<EstadisticaArea>): EstadisticaArea {
  return {
    area: 'X',
    nombre: 'Área X',
    total: 0,
    cumplidos: 0,
    noCumplidos: 0,
    porcentajeCumplimiento: 0,
    ...parcial,
  };
}

describe('aEstadisticasCompromisos', () => {
  it('mapea el sobre camelCase y ordena el ranking por total desc', () => {
    const estadisticas = aEstadisticasCompromisos(sobreCamelCase());

    expect(estadisticas.total).toBe(10);
    expect(estadisticas.vigentes).toBe(5);
    expect(estadisticas.noCumplidos).toBe(2);
    expect(estadisticas.enProceso).toBe(2);
    expect(estadisticas.pendientes).toBe(3);
    expect(estadisticas.porEstado).toHaveLength(2);
    expect(estadisticas.porEstadoHito).toEqual([{ estado: 'Cumplido', total: 8 }]);
    expect(estadisticas.porArea.map((fila) => fila.area)).toEqual(['A', 'B', 'C']);
  });

  it('deriva el porcentaje de cumplimiento cuando la API no lo manda', () => {
    const estadisticas = aEstadisticasCompromisos(sobreCamelCase());

    expect(estadisticas.porArea[0].porcentajeCumplimiento).toBe(20);
    expect(estadisticas.porArea[1].porcentajeCumplimiento).toBe(0);
    expect(estadisticas.porArea[2].porcentajeCumplimiento).toBe(100);
  });

  it('acepta la grafía snake_case, números como texto y el porcentaje declarado', () => {
    const estadisticas = aEstadisticasCompromisos({
      total: '4',
      no_cumplidos: '2',
      en_proceso: '1',
      por_area: [
        {
          area: 'X',
          nombre: 'Área X',
          total: '3',
          cumplidos: '1',
          no_cumplidos: '1',
          porcentaje_cumplimiento: 33.333,
        },
      ],
      por_plazo: { al_dia: '2', sin_plazo: '1' },
      por_estado_hito: [{ estado: 'Registrado', total: '2' }],
    });

    expect(estadisticas.total).toBe(4);
    expect(estadisticas.noCumplidos).toBe(2);
    expect(estadisticas.enProceso).toBe(1);
    expect(estadisticas.porArea[0].porcentajeCumplimiento).toBe(33.3);
    expect(estadisticas.porPlazo).toEqual({ vencidos: 0, alDia: 2, sinPlazo: 1 });
    expect(estadisticas.porEstadoHito).toEqual([{ estado: 'Registrado', total: 2 }]);
  });

  it('desenvuelve un sobre { data: … } sin cambiar el resultado', () => {
    expect(aEstadisticasCompromisos({ data: { total: 7 } }).total).toBe(7);
  });

  it('no inventa filas con una respuesta vacía o inválida', () => {
    const estadisticas = aEstadisticasCompromisos(null);

    expect(estadisticas.total).toBe(0);
    expect(estadisticas.porArea).toEqual([]);
    expect(estadisticas.porEstado).toEqual([]);
    expect(estadisticas.porEstadoHito).toEqual([]);
    expect(estadisticas.porPlazo).toEqual({ vencidos: 0, alDia: 0, sinPlazo: 0 });
    expect(estadisticas.generatedAt).toBe('');
  });
});

describe('porcentajeCumplimiento', () => {
  it('redondea a un decimal', () => {
    expect(porcentajeCumplimiento(1, 3)).toBe(33.3);
    expect(porcentajeCumplimiento(2, 3)).toBe(66.7);
  });

  it('no divide por cero', () => {
    expect(porcentajeCumplimiento(0, 0)).toBe(0);
  });
});

describe('ordenarPorArea', () => {
  it('ordena por total descendente y desempata por el nombre del área', () => {
    const filas = [
      area({ area: 'C', total: 2 }),
      area({ area: 'A', total: 5 }),
      area({ area: 'B', total: 2 }),
    ];

    expect(ordenarPorArea(filas).map((fila) => fila.area)).toEqual(['A', 'B', 'C']);
  });

  it('no muta el arreglo original', () => {
    const filas = [area({ area: 'B', total: 1 }), area({ area: 'A', total: 2 })];
    ordenarPorArea(filas);
    expect(filas.map((fila) => fila.area)).toEqual(['B', 'A']);
  });
});

describe('generarCsvEstadisticas', () => {
  function csvDeEjemplo(): { datos: EstadisticasCompromisos; contenido: string } {
    const datos = aEstadisticasCompromisos(sobreCamelCase());
    return { datos, contenido: generarCsvEstadisticas(datos) };
  }

  it('empieza con BOM UTF-8 y usa la coma como separador', () => {
    const { contenido } = csvDeEjemplo();

    expect(contenido.startsWith(BOM)).toBe(true);
    expect(contenido).not.toContain(';');
    const lineas = contenido.slice(BOM.length).split('\r\n');
    expect(lineas[0]).toBe(CABECERA_ESTADISTICAS.join(','));
    expect(contenido.endsWith('\r\n')).toBe(true);
  });

  it('incluye indicadores, ranking, plazos y estados con su bloque', () => {
    const { contenido } = csvDeEjemplo();

    expect(contenido).toContain('indicador,total,Compromisos,10,,,');
    expect(contenido).toContain('plazo,vencidos,Hito vencido sin cumplir,1,,,');
    expect(contenido).toContain('area,A,Dirección A,5,1,0,20');
    expect(contenido).toContain('estado,Cumplido,Cerrado,3,,,');
    expect(contenido).toContain('estado_hito,Cumplido,,8,,,');
  });

  it('escapa comas y comillas según RFC 4180', () => {
    const datos = aEstadisticasCompromisos({
      por_area: [
        {
          area: 'DGA',
          nombre: 'Dirección de "Asuntos", Sociales',
          total: 2,
          cumplidos: 1,
          no_cumplidos: 0,
        },
      ],
    });

    const contenido = generarCsvEstadisticas(datos);
    expect(contenido).toContain('"Dirección de ""Asuntos"", Sociales"');
  });
});

describe('nombreArchivoEstadisticas', () => {
  it('incluye la fecha del día en formato ISO', () => {
    expect(nombreArchivoEstadisticas(new Date('2026-11-27T12:00:00Z'))).toBe(
      'avisa_estadisticas_compromisos_2026-11-27.csv',
    );
  });
});
