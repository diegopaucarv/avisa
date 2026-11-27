import { describe, expect, it } from 'vitest';

import { codigoHitoCorto, etiquetaHito } from './hito-texto';

const NBSP = '\u00A0';

describe('codigoHitoCorto', () => {
  it('extrae el sufijo de los códigos largos del Anexo 14', () => {
    expect(codigoHitoCorto('CS-2026-0001_COMP001_H002')).toBe('H002');
    expect(codigoHitoCorto('  COMP002_H003  ')).toBe('H003');
  });

  it.each([
    ['H-1', 'H001'],
    ['h001', 'H001'],
    ['Hito 3', 'H003'],
    ['H 03', 'H003'],
    ['3', 'H003'],
    ['  H001  ', 'H001'],
  ])('normaliza %s a %s', (entrada, esperado) => {
    expect(codigoHitoCorto(entrada)).toBe(esperado);
  });

  it('no recorta números de más de tres dígitos', () => {
    expect(codigoHitoCorto('H1234')).toBe('H1234');
  });

  it('devuelve null cuando no hay número', () => {
    expect(codigoHitoCorto(null)).toBeNull();
    expect(codigoHitoCorto(undefined)).toBeNull();
    expect(codigoHitoCorto('')).toBeNull();
    expect(codigoHitoCorto('   ')).toBeNull();
    expect(codigoHitoCorto('COMP001')).toBeNull();
  });
});

describe('etiquetaHito', () => {
  it('une código y descripción con punto medio y espacios duros', () => {
    expect(etiquetaHito('H001', 'Texto')).toBe(`H001${NBSP}·${NBSP}Texto`);
  });

  it('normaliza el código antes de unirlo', () => {
    expect(etiquetaHito('H-1', 'Texto')).toBe(`H001${NBSP}·${NBSP}Texto`);
  });

  it('recorta la descripción', () => {
    expect(etiquetaHito('H001', '  Texto largo  ')).toBe(`H001${NBSP}·${NBSP}Texto largo`);
  });

  it('usa la descripción cuando no hay código', () => {
    expect(etiquetaHito(null, 'Texto')).toBe('Texto');
    expect(etiquetaHito('sin-numero', 'Texto')).toBe('Texto');
  });

  it('usa el código cuando no hay descripción', () => {
    expect(etiquetaHito('H001', null)).toBe('H001');
    expect(etiquetaHito('H001', '   ')).toBe('H001');
  });

  it('cae en el texto por defecto cuando no hay nada', () => {
    expect(etiquetaHito(null, null)).toBe('Hito sin descripción');
    expect(etiquetaHito('', '')).toBe('Hito sin descripción');
  });

  it('no duplica el código que ya trae la descripción', () => {
    expect(etiquetaHito('H001', 'H001 – Texto')).toBe(`H001${NBSP}·${NBSP}Texto`);
    expect(etiquetaHito('H003', 'Hito 3 - Texto')).toBe(`H003${NBSP}·${NBSP}Texto`);
    expect(etiquetaHito('h001', 'h-1: Texto')).toBe(`H001${NBSP}·${NBSP}Texto`);
    expect(etiquetaHito('H001', 'H001')).toBe('H001');
  });

  it('no quita un código distinto del hito', () => {
    expect(etiquetaHito('H001', 'H002 – Texto')).toBe(`H001${NBSP}·${NBSP}H002 – Texto`);
  });
});
