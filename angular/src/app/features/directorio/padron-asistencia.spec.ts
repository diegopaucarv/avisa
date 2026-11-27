import { describe, expect, it } from 'vitest';

import type { ActorDirectorio } from './directorio.mapeo';
import {
  MIME_XLSX,
  crearXlsxPadron,
  filaPadronDeActor,
  formatearFechaPadron,
  type FilaPadronAsistencia,
} from './padron-asistencia';

type ModuloExcel = typeof import('exceljs') & { default?: typeof import('exceljs') };

/**
 * `exceljs` se resuelve igual que en el exportador: en Node la API llega como
 * `default` del módulo CJS, en el bundle como export directo.
 */
async function abrirLibro(blob: Blob) {
  const modulo = (await import('exceljs')) as ModuloExcel;
  const ExcelJS = modulo.default ?? modulo;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await blob.arrayBuffer());
  return libro;
}

function filaComoArray(hoja: import('exceljs').Worksheet, numero: number): unknown[] {
  const fila = hoja.getRow(numero);
  const valores: unknown[] = [];
  for (let columna = 1; columna <= 10; columna++) {
    valores.push(fila.getCell(columna).value);
  }
  return valores;
}

const ENCABEZADOS = [
  'N°',
  'APELLIDOS Y NOMBRES',
  'CARGO',
  'DNI',
  'CELULAR',
  'PROVINCIA',
  'DISTRITO',
  'PUERTO/CALETA / COMUNIDAD',
  'NOMBRE DE LA OSPA',
  'FIRMA',
];

const actor: ActorDirectorio = {
  id: 'actor-1',
  nombre: '=HYPERLINK("https://example.com")',
  abreviatura: null,
  naturaleza: 'Persona',
  tipo: null,
  funcion: 'Representante',
  posicionamiento: null,
  cargo: null,
  nivelGobierno: null,
  categoria: null,
  region: 'Piura',
  distrito: 'Castilla',
  organizacionAncla: 'Asociación local',
  validado: false,
  activo: true,
  clasificacion: 2,
  perfil: null,
  localesDelActor: [],
};

const fila: FilaPadronAsistencia = filaPadronDeActor(actor, 'OSPA de la membresía', {
  dni: '01234567',
  telefono: '999 888 777',
});

describe('padrón de asistencia en Excel', () => {
  it('arma las filas de metadatos, los encabezados exactos y los datos desde la fila 5', async () => {
    const blob = await crearXlsxPadron({
      titulo: 'Mesa técnica',
      lugar: 'Auditorio regional',
      fecha: '2026-11-05',
      filas: [fila],
    });

    expect(blob.type).toBe(MIME_XLSX);

    const libro = await abrirLibro(blob);
    const hoja = libro.worksheets[0];
    expect(hoja).toBeDefined();

    // Fila 1: título fusionado a lo ancho de la tabla.
    expect(hoja.getCell('A1').value).toBe('LISTA DE ASISTENCIA — Mesa técnica');
    expect(hoja.getCell('J1').isMerged).toBe(true);

    expect(hoja.getCell('A2').value).toBe('Lugar: Auditorio regional');
    expect(hoja.getCell('A3').value).toBe('Fecha: 05 nov 2026');

    // Fila 4: encabezados del formato de firmas.
    expect(filaComoArray(hoja, 4)).toEqual(ENCABEZADOS);
    const cabecera = hoja.getRow(4).getCell(1);
    expect(cabecera.font?.bold).toBe(true);
    expect(cabecera.alignment?.wrapText).toBe(true);
    expect(cabecera.fill).toMatchObject({ type: 'pattern', pattern: 'solid' });

    // Fila 5: el asistente; el nombre empieza con «=» pero es texto, no fórmula.
    expect(filaComoArray(hoja, 5)).toEqual([
      1,
      '=HYPERLINK("https://example.com")',
      'Representante',
      '01234567',
      '999 888 777',
      '',
      'Castilla',
      '',
      'OSPA de la membresía',
      '',
    ]);
    expect(hoja.getRow(5).height).toBe(30);
    expect(hoja.getCell('A5').border?.top?.style).toBe('thin');
    expect(hoja.getCell('J5').border?.right?.style).toBe('thin');

    // Anchos en caracteres de Excel.
    expect(hoja.getColumn(1).width).toBeCloseTo(7, 2);
    expect(hoja.getColumn(2).width).toBeCloseTo(26.86, 2);
    expect(hoja.getColumn(8).width).toBeCloseTo(27, 2);

    // Cuatro filas de cabecera más una por asistente.
    expect(hoja.actualRowCount).toBe(5);
  });

  it('omite el título, el DNI y el celular cuando no hay datos', async () => {
    const sinDatos = filaPadronDeActor(actor);

    const blob = await crearXlsxPadron({
      titulo: '   ',
      lugar: 'Sala 1',
      fecha: '2026-11-23',
      filas: [sinDatos],
    });

    const libro = await abrirLibro(blob);
    const hoja = libro.worksheets[0];

    expect(hoja.getCell('A1').value).toBe('LISTA DE ASISTENCIA');
    expect(hoja.getCell('A3').value).toBe('Fecha: 23 nov 2026');

    const datos = filaComoArray(hoja, 5);
    expect(datos[3]).toBe('');
    expect(datos[4]).toBe('');
    // Sin membresía se cae al ancla del listado.
    expect(datos[8]).toBe('Asociación local');
  });

  it('formatea la fecha como dd mmm aaaa sin corrimientos de zona horaria', () => {
    expect(formatearFechaPadron('2026-11-05')).toBe('05 nov 2026');
    expect(formatearFechaPadron('2026-01-09')).toBe('09 ene 2026');
    expect(formatearFechaPadron('')).toBe('');
    expect(formatearFechaPadron('sin fecha')).toBe('sin fecha');
  });
});
