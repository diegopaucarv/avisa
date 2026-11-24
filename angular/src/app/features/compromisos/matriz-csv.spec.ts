import { describe, expect, it } from 'vitest';

import {
  BOM,
  CABECERA_MATRIZ,
  aMatrizFila,
  construirFilas,
  escaparCelda,
  generarCsv,
  leerCabecera,
  normalizarCabecera,
  parsearCsv,
  resolverFilas,
  type FilaMatrizCruda,
} from './matriz-csv';

/** Fila mínima; cada prueba cambia sólo lo que le interesa. */
function cruda(parcial: Partial<FilaMatrizCruda> = {}): FilaMatrizCruda {
  return {
    fila: 2,
    codigoCaso: null,
    codigoExcel: null,
    nombreCaso: null,
    accion: 'Acción de prueba',
    hito: null,
    descripcionHito: null,
    estado: null,
    ...parcial,
  };
}

describe('escaparCelda', () => {
  it('entrecomilla las celdas con coma', () => {
    expect(escaparCelda('Lima, Callao')).toBe('"Lima, Callao"');
  });

  it('duplica las comillas y entrecomilla la celda', () => {
    expect(escaparCelda('dice "no"')).toBe('"dice ""no"""');
  });

  it('entrecomilla las celdas con salto de línea', () => {
    expect(escaparCelda('uno\ndos')).toBe('"uno\ndos"');
  });

  it('deja intacto el texto simple', () => {
    expect(escaparCelda('Pesca y Acuicultura')).toBe('Pesca y Acuicultura');
  });

  it('distingue vacío de cero', () => {
    expect(escaparCelda(null)).toBe('');
    expect(escaparCelda(undefined)).toBe('');
    expect(escaparCelda(0)).toBe('0');
  });
});

describe('parsearCsv', () => {
  it('lee comas y comillas escapadas', () => {
    expect(parsearCsv('a,b\r\n"Lima, Callao","dice ""no"""\r\n')).toEqual([
      ['a', 'b'],
      ['Lima, Callao', 'dice "no"'],
    ]);
  });

  it('acepta saltos de línea dentro de un campo entrecomillado', () => {
    expect(parsearCsv('a,"uno\ndos"\r\n')).toEqual([['a', 'uno\ndos']]);
  });

  it('descarta el BOM inicial', () => {
    expect(parsearCsv(`${BOM}codigo_caso,accion\r\nCS-1,Acción\r\n`)).toEqual([
      ['codigo_caso', 'accion'],
      ['CS-1', 'Acción'],
    ]);
  });

  it('acepta LF suelto y descarta filas totalmente vacías', () => {
    expect(parsearCsv('a,b\n,\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('conserva las tildes', () => {
    expect(parsearCsv('Narración,Peña\r\n')).toEqual([['Narración', 'Peña']]);
  });
});

describe('normalizarCabecera', () => {
  it('convierte el rótulo N° en la clave n', () => {
    expect(normalizarCabecera('N°')).toBe('n');
  });

  it('quita tildes y colapsa separadores', () => {
    expect(normalizarCabecera('Narración Cronológica técnica social')).toBe(
      'narracion_cronologica_tecnica_social',
    );
  });

  it('limpia el BOM del primer rótulo', () => {
    expect(normalizarCabecera(`${BOM}Área Responsable de Monitoreo de Acción`)).toBe(
      'area_responsable_de_monitoreo_de_accion',
    );
  });
});

describe('cabecera del formato del equipo', () => {
  it('tiene las 23 columnas A..W en orden', () => {
    expect(CABECERA_MATRIZ).toHaveLength(23);
    expect(CABECERA_MATRIZ[0]).toBe('N°');
    expect(CABECERA_MATRIZ[20]).toBe('Fecha Planificada');
    expect(CABECERA_MATRIZ[21]).toBe('Fecha Real');
    expect(CABECERA_MATRIZ[22]).toBe('Estado Actual');
  });

  it('reconoce las 23 columnas oficiales sin ignorar ninguna', () => {
    const leida = leerCabecera(CABECERA_MATRIZ);
    expect(leida.reconocidas).toBe(23);
    expect(leida.ignoradas).toEqual([]);
    expect(leida.indices.numero).toBe(0);
    expect(leida.indices.accion).toBe(12);
    expect(leida.indices.fechaPlanificada).toBe(20);
    expect(leida.indices.estado).toBe(22);
  });

  it('ignora rótulos desconocidos y avisa', () => {
    const leida = leerCabecera(['Hito', 'Columna rara']);
    expect(leida.reconocidas).toBe(1);
    expect(leida.ignoradas).toEqual(['Columna rara']);
  });
});

describe('generarCsv y parsearCsv', () => {
  it('hace ida y vuelta con comas, comillas y tildes', () => {
    const cabecera = ['Nombre de Caso', 'Acción/Compromisos/Acuerdos'];
    const filas = [['Peña, José "el pescador"', 'Reunión con la comunidad']];
    const csv = generarCsv(cabecera, filas);

    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parsearCsv(csv)).toEqual([cabecera, ...filas]);
  });

  it('genera celdas vacías para nulos', () => {
    expect(generarCsv(['a', 'b'], [[null, 'x']])).toBe('a,b\r\n,x\r\n');
  });
});

describe('construirFilas', () => {
  it('arrastra el código de caso cuando la celda viene vacía', () => {
    const leida = leerCabecera([
      'Código de Caso',
      'Código Excel',
      'Acción/Compromisos/Acuerdos',
      'Hito',
      'Descripción del Hito',
      'Estado Actual',
    ]);
    const filas = construirFilas(
      [
        ['CS-PA-INF-2025-01', 'CS-EXCEL-1', 'Acción A', 'H1', 'Descripción A', 'Cumplido'],
        ['', '', 'Acción B', 'H2', 'Descripción B', ''],
      ],
      leida,
    );

    expect(filas).toHaveLength(2);
    expect(filas[0]?.fila).toBe(2);
    expect(filas[1]?.fila).toBe(3);
    expect(filas[1]?.codigoCaso).toBe('CS-PA-INF-2025-01');
    expect(filas[1]?.codigoExcel).toBe('CS-EXCEL-1');
    expect(filas[1]?.hito).toBe('H2');
  });
});

describe('resolverFilas', () => {
  it('rechaza una fila sin código AVISA ni código Excel', () => {
    const resolucion = resolverFilas([cruda()]);
    expect(resolucion.reconocidas).toBe(0);
    expect(resolucion.rechazadas[0]?.codigo).toBe('SIN_CODIGO');
  });

  it('rechaza una fila cuyo código Excel no tiene equivalencia', () => {
    const resolucion = resolverFilas([cruda({ codigoExcel: 'CS-EXCEL-9' })], {
      mapa: new Map([['cs-excel-1', 'CS-PA-INF-2025-01']]),
    });
    expect(resolucion.reconocidas).toBe(0);
    expect(resolucion.rechazadas[0]?.codigo).toBe('SIN_EQUIVALENCIA');
    expect(resolucion.rechazadas[0]?.codigoExcel).toBe('CS-EXCEL-9');
  });

  it('rechaza una fila mapeada a un caso que no existe en AVISA', () => {
    const resolucion = resolverFilas([cruda({ codigoExcel: 'CS-EXCEL-1' })], {
      mapa: new Map([['cs-excel-1', 'CS-PA-INF-2025-01']]),
      casos: new Set(['cs-pa-inf-2025-02']),
    });
    expect(resolucion.reconocidas).toBe(0);
    expect(resolucion.rechazadas[0]?.codigo).toBe('CASO_INEXISTENTE');
    expect(resolucion.rechazadas[0]?.codigoCaso).toBe('CS-PA-INF-2025-01');
  });

  it('reconoce la fila mapeada cuando el caso existe', () => {
    const resolucion = resolverFilas([cruda({ codigoExcel: 'CS-EXCEL-1' })], {
      mapa: new Map([['cs-excel-1', 'CS-PA-INF-2025-01']]),
      casos: new Set(['cs-pa-inf-2025-01']),
    });
    expect(resolucion.reconocidas).toBe(1);
    expect(resolucion.rechazadas).toEqual([]);
  });

  it('prefiere el código AVISA explícito sobre el mapa de equivalencias', () => {
    const resolucion = resolverFilas(
      [cruda({ codigoCaso: 'CS-LI-ITE-2026-03', codigoExcel: 'CS-EXCEL-1' })],
      {
        mapa: new Map([['cs-excel-1', 'CS-PA-INF-2025-01']]),
        casos: new Set(['cs-li-ite-2026-03']),
      },
    );
    expect(resolucion.reconocidas).toBe(1);
  });

  it('exige la acción/compromiso (columna N)', () => {
    const resolucion = resolverFilas([cruda({ codigoCaso: 'CS-1', accion: '   ' })]);
    expect(resolucion.reconocidas).toBe(0);
    expect(resolucion.rechazadas[0]?.codigo).toBe('CAMPO_OBLIGATORIO');
  });

  it('exige la etiqueta del hito cuando hay descripción', () => {
    const resolucion = resolverFilas([
      cruda({ codigoCaso: 'CS-1', descripcionHito: 'Presentar el informe' }),
    ]);
    expect(resolucion.reconocidas).toBe(0);
    expect(resolucion.rechazadas[0]?.codigo).toBe('CAMPO_OBLIGATORIO');
  });

  it('marca duplicada la fila que repite el bloque de otra', () => {
    const resolucion = resolverFilas([
      cruda({ fila: 2, codigoCaso: 'CS-1', hito: 'H1', descripcionHito: 'Descripción' }),
      cruda({ fila: 3, codigoCaso: 'CS-1', hito: 'H1', descripcionHito: 'Descripción' }),
    ]);
    expect(resolucion.filasFuente).toBe(2);
    expect(resolucion.reconocidas).toBe(1);
    expect(resolucion.rechazadas[0]?.codigo).toBe('DUPLICADO');
    expect(resolucion.rechazadas[0]?.motivo).toContain('fila 2');
  });

  it('cuenta las filas de origen aunque todas se rechacen', () => {
    const resolucion = resolverFilas([cruda({ fila: 2 }), cruda({ fila: 3, codigoExcel: 'CS-X' })]);
    expect(resolucion.filasFuente).toBe(2);
    expect(resolucion.rechazadas).toHaveLength(2);
  });
});

describe('aMatrizFila', () => {
  it('normaliza un registro del JSON y deja nulos los campos ausentes', () => {
    const fila = aMatrizFila({
      nombreCaso: 'Pescadores de Cabo Blanco',
      accion: 'Reunión',
      estado: '   ',
      bloqueFila: 4,
    });

    expect(fila.nombreCaso).toBe('Pescadores de Cabo Blanco');
    expect(fila.accion).toBe('Reunión');
    expect(fila.estado).toBeNull();
    expect(fila.hito).toBeNull();
    expect(fila.bloqueFila).toBe(4);
  });

  it('no convierte en número un bloqueFila que llega como texto', () => {
    expect(aMatrizFila({ bloqueFila: '7' }).bloqueFila).toBeNull();
  });
});
