import { describe, expect, it } from 'vitest';

import { detectarDelimitador, esExcelBinario, leerTabla } from './importacion.csv';
import { tipoImportacion } from './importacion.tipos';
import { normalizarFecha, validarImportacion } from './importacion.validar';

describe('lectura de hojas', () => {
  it('detecta tabuladores del pegado de Excel antes que comas o puntos y coma', () => {
    expect(detectarDelimitador('Título\tRegión\tTemática\nA\tB\tC')).toBe('\t');
    expect(detectarDelimitador('Titulo;Region\nA;B')).toBe(';');
    expect(detectarDelimitador('titulo,region\nA,B')).toBe(',');
  });

  it('no cuenta los separadores que viven dentro de comillas', () => {
    expect(detectarDelimitador('"a;b;c";d\n1;2')).toBe(';');
  });

  it('respeta saltos de línea dentro de una celda entrecomillada', () => {
    const tabla = leerTabla('titulo;resumen\n"Caso A";"linea 1\nlinea 2"');
    expect(tabla.filas).toHaveLength(1);
    expect(tabla.filas[0][1]).toBe('linea 1\nlinea 2');
  });

  it('descarta el BOM y las filas vacías del final', () => {
    const tabla = leerTabla('\uFEFFtitulo;region\nA;B\n;\n');
    expect(tabla.cabecera).toEqual(['titulo', 'region']);
    expect(tabla.filas).toEqual([['A', 'B']]);
  });

  it('reconoce un xlsx por extensión o por la firma del ZIP', () => {
    expect(esExcelBinario('matriz.xlsx')).toBe(true);
    expect(esExcelBinario('datos.csv', 'PK\u0003\u0004')).toBe(true);
    expect(esExcelBinario('datos.csv', 'titl')).toBe(false);
  });
});

describe('validación de importaciones', () => {
  const casos = tipoImportacion('casos');

  it('convierte dd/mm/aaaa y rechaza fechas imposibles', () => {
    expect(normalizarFecha('05/11/2026')).toBe('2026-11-05');
    expect(normalizarFecha('2026-11-05')).toBe('2026-11-05');
    expect(normalizarFecha('31/02/2026')).toBeNull();
  });

  it('exige las columnas obligatorias antes de mirar las filas', () => {
    const validacion = validarImportacion(casos, leerTabla('tematica;riesgo\nMinero;Alto'));
    expect(validacion.faltantes).toContain('Título del caso');
    expect(validacion.faltantes).toContain('Región');
    expect(validacion.validas).toHaveLength(0);
  });

  it('acepta sinónimos de cabecera y arma el payload del alta', () => {
    const validacion = validarImportacion(
      casos,
      leerTabla(
        'Nombre del caso\tRegión\tNivel de conflictividad\tFecha de inicio\n' +
          'Mesa de diálogo\tPiura\tAlto\t05/11/2026',
      ),
    );

    expect(validacion.rechazos).toHaveLength(0);
    expect(validacion.validas[0].payload).toMatchObject({
      titulo: 'Mesa de diálogo',
      regiones: ['Piura'],
      nivelConflicto: 'Alto',
      fechaInicio: '2026-11-05',
    });
  });

  it('separa varias regiones y rechaza duplicados del propio archivo', () => {
    const validacion = validarImportacion(
      casos,
      leerTabla(
        'titulo;region\nCaso A;Piura; Tumbes\nCaso A;Piura',
      ),
    );

    expect(validacion.validas).toHaveLength(1);
    expect(validacion.rechazos[0]).toMatchObject({ fila: 3, codigo: 'DUPLICADO_EN_ARCHIVO' });
  });

  it('rechaza una fila sin título con su número de fila real', () => {
    const validacion = validarImportacion(casos, leerTabla('titulo;region\n;Cajamarca'));
    expect(validacion.rechazos[0]).toMatchObject({ fila: 2, codigo: 'CAMPO_OBLIGATORIO' });
  });

  it('exige demandas en el tipo «casos con demandas» y las conserva', () => {
    const conDemandas = tipoImportacion('casos-demandas');
    const validacion = validarImportacion(
      conDemandas,
      leerTabla(
        'titulo;region;tematica;demandas\n' +
          'Caso A;Piura;Minero;Agua potable | Reubicación laboral',
      ),
    );

    expect(validacion.validas[0].demandas).toEqual(['Agua potable', 'Reubicación laboral']);
  });

  it('valida el DNI de las personas y el RUC de las organizaciones', () => {
    const personas = tipoImportacion('actores-personas');
    const invalido = validarImportacion(
      personas,
      leerTabla('nombre;dni\nJuan Pérez;123'),
    );
    expect(invalido.rechazos[0].codigo).toBe('DNI_INVALIDO');

    const organizaciones = tipoImportacion('actores-organizaciones');
    const valido = validarImportacion(
      organizaciones,
      leerTabla('razon social;ruc\nRonda Campesina;20123456789'),
    );
    expect(valido.validas[0].payload).toMatchObject({
      naturaleza: 'organizacion',
      ruc: '20123456789',
    });
  });

  it('marca como institución pública y exige nivel de gobierno', () => {
    const instituciones = tipoImportacion('actores-instituciones');
    const sinNivel = validarImportacion(
      instituciones,
      leerTabla('nombre;region\nMunicipalidad de Piura;Piura'),
    );
    expect(sinNivel.faltantes).toContain('Nivel de gobierno');

    const conNivel = validarImportacion(
      instituciones,
      leerTabla('nombre;nivel de gobierno\nMunicipalidad de Piura;Local'),
    );
    expect(conNivel.validas[0].payload).toMatchObject({
      tipo: 'Actor público',
      nivelGobierno: 'Local',
    });
  });

  it('corta el archivo en el tope de filas por tanda', () => {
    const filas = Array.from({ length: 405 }, (_, indice) => `Caso ${indice};Piura`);
    const validacion = validarImportacion(casos, leerTabla(`titulo;region\n${filas.join('\n')}`));

    expect(validacion.validas).toHaveLength(400);
    expect(validacion.truncada).toBe(true);
    expect(validacion.rechazos.every((rechazo) => rechazo.codigo === 'LIMITE_FILAS')).toBe(true);
  });
});
