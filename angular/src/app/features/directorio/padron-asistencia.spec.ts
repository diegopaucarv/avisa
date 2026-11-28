import { describe, expect, it } from 'vitest';

import type { ActorDirectorio } from './directorio.mapeo';
import {
  MIME_XLSX,
  crearXlsxPadron,
  etiquetaGrupoOrganizacion,
  filaPadronDeActor,
  filasPadronDePersonas,
  formatearFechaPadron,
  normalizarSesion,
  personasDeLista,
  type EntradaLista,
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
  provincia: 'Piura',
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

function persona(id: string, nombre = `Persona ${id}`): ActorDirectorio {
  return { ...actor, id, nombre };
}

function organizacion(id: string, numeroIntegrantes: number | null = 2): ActorDirectorio {
  return {
    ...actor,
    id,
    nombre: `Organización ${id}`,
    naturaleza: 'Organización',
    numeroIntegrantes,
  };
}

function entrada(tipo: EntradaLista['tipo'], value: ActorDirectorio): EntradaLista {
  return { tipo, actor: value };
}

describe('padrón de asistencia en Excel', () => {
  // La primera llamada carga `exceljs` en frío dentro del worker (≈25 s en esta
  // máquina); el límite por defecto de 5 s no alcanza y no es un fallo de lógica.
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
      'Piura',
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
  }, 60_000);

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
    // La provincia no depende de la PII: se deriva del distrito en el listado.
    expect(datos[5]).toBe('Piura');
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

describe('expansión de la lista de asistencia', () => {
  it('expande cada organización a sus integrantes respetando el orden de entrada', () => {
    const uno = persona('p1');
    const dos = persona('p2');
    const tres = persona('p3');
    const org = organizacion('o1');

    const entradas = [entrada('persona', uno), entrada('organizacion', org)];
    const miembros = new Map([[org.id, [dos, tres]]]);

    expect(personasDeLista(entradas, miembros).map((item) => item.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('deduplica por id: una persona que ya está en la lista no se repite', () => {
    const uno = persona('p1');
    const dos = persona('p2');
    const org = organizacion('o1');

    const entradas = [entrada('persona', uno), entrada('organizacion', org)];
    // La organización aporta a la misma persona ya agregada; queda una vez.
    const miembros = new Map([[org.id, [uno, dos]]]);

    expect(personasDeLista(entradas, miembros).map((item) => item.id)).toEqual(['p1', 'p2']);
  });

  it('sin integrantes la organización no aporta filas', () => {
    const uno = persona('p1');
    const org = organizacion('o1');

    expect(
      personasDeLista([entrada('persona', uno), entrada('organizacion', org)], new Map()),
    ).toEqual([uno]);
  });
});

describe('filas del padrón a partir de personas expandidas', () => {
  it('vuelca la PII y deja en blanco a quien no la tiene', () => {
    const uno = persona('p1');
    const dos = persona('p2');
    const pii = new Map([['p1', { dni: '01234567', telefono: '999 888 777' }]]);

    const { filas, sinPii } = filasPadronDePersonas([uno, dos], pii);

    expect(filas[0]).toMatchObject({ dni: '01234567', celular: '999 888 777' });
    expect(filas[1]).toMatchObject({ dni: '', celular: '' });
    expect(sinPii).toBe(1);
  });

  it('cuenta como sin PII cuando ambos campos están vacíos', () => {
    const uno = persona('p1');
    const pii = new Map([['p1', { dni: null, telefono: null }]]);

    expect(filasPadronDePersonas([uno], pii)).toMatchObject({ sinPii: 1 });
  });

  it('aplica la OSPA que resuelve el llamador', () => {
    const uno = persona('p1');
    const { filas } = filasPadronDePersonas([uno], new Map(), () => 'OSPA resuelta');

    expect(filas[0]?.ospa).toBe('OSPA resuelta');
  });
});

describe('cabecera de la sesión', () => {
  it('recorta los espacios y exige los tres campos', () => {
    expect(
      normalizarSesion({ titulo: '  Mesa técnica ', lugar: ' Auditorio ', fecha: '2026-11-05' }),
    ).toEqual({ titulo: 'Mesa técnica', lugar: 'Auditorio', fecha: '2026-11-05' });

    expect(normalizarSesion({ titulo: '', lugar: 'Sala', fecha: '2026-11-05' })).toBeNull();
    expect(normalizarSesion({ titulo: 'Mesa', lugar: '  ', fecha: '2026-11-05' })).toBeNull();
    expect(normalizarSesion({ titulo: 'Mesa', lugar: 'Sala', fecha: '' })).toBeNull();
  });
});

describe('etiqueta de grupo de una organización', () => {
  it('concuerda en singular y plural según el conteo declarado', () => {
    expect(etiquetaGrupoOrganizacion(organizacion('o', 1))).toBe('Organización: 1 integrante');
    expect(etiquetaGrupoOrganizacion(organizacion('o', 3))).toBe('Organización: 3 integrantes');
    expect(etiquetaGrupoOrganizacion(organizacion('o', 0))).toBe('Organización: 0 integrantes');
  });

  it('cae a un rótulo neutro cuando no hay conteo', () => {
    expect(etiquetaGrupoOrganizacion(organizacion('o', null))).toBe('Organización');
  });
});
