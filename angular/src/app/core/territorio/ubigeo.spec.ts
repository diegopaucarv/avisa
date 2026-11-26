import { describe, expect, it } from 'vitest';

import {
  claveTerritorio,
  codigoRegion,
  codigoRegionDeUbigeo,
  especificidad,
  nombreRegion,
  normalizarNombreTerritorio,
  normalizarUbigeo,
  resolverUbigeo,
} from './ubigeo';

/**
 * El contrato observable es doble: normalizar igual lo que el Estado escribe
 * distinto y **nunca** deducir un ubigeo que no venga declarado.
 */

describe('normalizarNombreTerritorio', () => {
  it('quita tildes y pasa a mayúsculas', () => {
    expect(normalizarNombreTerritorio('Áncash')).toBe('ANCASH');
    expect(normalizarNombreTerritorio('  san martín ')).toBe('SAN MARTIN');
  });

  it('expande abreviaturas administrativas', () => {
    expect(normalizarNombreTerritorio('PROV. CONST. DEL CALLAO')).toBe(
      'PROVINCIA CONSTITUCIONAL DEL CALLAO',
    );
    expect(normalizarNombreTerritorio('DPTO. DE LIMA')).toBe('DEPARTAMENTO DE LIMA');
  });

  it('colapsa espacios y descarta signos', () => {
    expect(normalizarNombreTerritorio('LIMA   METROPOLITANA')).toBe('LIMA METROPOLITANA');
    expect(normalizarNombreTerritorio('(LIMA)')).toBe('LIMA');
  });
});

describe('codigoRegion', () => {
  it('reconoce las 25 regiones por nombre', () => {
    expect(codigoRegion('Áncash')).toBe('02');
    expect(codigoRegion('Cusco')).toBe('08');
    expect(codigoRegion('San Martín')).toBe('22');
  });

  it('acepta los alias del Estado', () => {
    expect(codigoRegion('PROV. CONST. DEL CALLAO')).toBe('07');
    expect(codigoRegion('LIMA METROPOLITANA')).toBe('15');
  });

  it('devuelve null si no es una región', () => {
    expect(codigoRegion('Santa Rosa')).toBeNull();
    expect(codigoRegion(null)).toBeNull();
  });
});

describe('nombreRegion', () => {
  it('traduce el código a su nombre canónico', () => {
    expect(nombreRegion('08')).toBe('Cusco');
    expect(nombreRegion(' 15 ')).toBe('Lima');
  });

  it('devuelve null para códigos inexistentes', () => {
    expect(nombreRegion('99')).toBeNull();
  });
});

describe('normalizarUbigeo', () => {
  it('acepta exactamente seis dígitos', () => {
    expect(normalizarUbigeo('150101')).toBe('150101');
    expect(normalizarUbigeo(' 150101 ')).toBe('150101');
  });

  it('declara ausente cualquier otra longitud', () => {
    expect(normalizarUbigeo('15010')).toBeNull();
    expect(normalizarUbigeo('1501011')).toBeNull();
    expect(normalizarUbigeo(null)).toBeNull();
  });
});

describe('codigoRegionDeUbigeo', () => {
  it('lee el prefijo de dos dígitos', () => {
    expect(codigoRegionDeUbigeo('150101')).toBe('15');
    expect(codigoRegionDeUbigeo('040101')).toBe('04');
  });

  it('no inventa una región con prefijo desconocido', () => {
    expect(codigoRegionDeUbigeo('991010')).toBeNull();
  });
});

describe('resolverUbigeo', () => {
  it('conserva el ubigeo declarado y lo usa como nivel distrito', () => {
    const resuelto = resolverUbigeo({
      region: 'Lima',
      provincia: 'Lima',
      distrito: 'Miraflores',
      ubigeo: '150122',
    });

    expect(resuelto.ubigeo).toBe('150122');
    expect(resuelto.region).toBe('15');
    expect(resuelto.nivel).toBe('distrito');
    expect(resuelto.clave).toBe('15|LIMA|MIRAFLORES');
  });

  it('nunca deduce un ubigeo por nombre', () => {
    const resuelto = resolverUbigeo({
      region: 'Áncash',
      provincia: 'Huaraz',
      distrito: 'Huaraz',
    });

    expect(resuelto.ubigeo).toBeNull();
    expect(resuelto.nivel).toBe('distrito');
  });

  it('interpreta un nombre suelto que no es región como distrito', () => {
    const resuelto = resolverUbigeo('SANTA ROSA');

    expect(resuelto.region).toBeNull();
    expect(resuelto.nombres.distrito).toBe('SANTA ROSA');
    expect(resuelto.nivel).toBe('distrito');
    expect(resuelto.ubigeo).toBeNull();
  });

  it('acepta el trío posicional', () => {
    const resuelto = resolverUbigeo('Lima', 'Lima', 'Miraflores');

    expect(resuelto.region).toBe('15');
    expect(resuelto.nombres.provincia).toBe('LIMA');
    expect(resuelto.nombres.distrito).toBe('MIRAFLORES');
  });

  it('declara vacío lo que no puede resolver', () => {
    const resuelto = resolverUbigeo(null);

    expect(resuelto.nivel).toBeNull();
    expect(resuelto.region).toBeNull();
    expect(resuelto.ubigeo).toBeNull();
    expect(resuelto.clave).toBe('||');
  });
});

describe('claveTerritorio', () => {
  it('compara sin depender de mayúsculas ni tildes', () => {
    expect(claveTerritorio('Lima', 'Lima', 'Miraflores')).toBe(
      claveTerritorio('LIMA', 'lima', 'MIRAFLORES'),
    );
  });

  it('normaliza la región a su código', () => {
    expect(claveTerritorio('Áncash')).toBe('02||');
  });
});

describe('especificidad', () => {
  it('ordena distrito > provincia > región > vacío', () => {
    expect(especificidad(resolverUbigeo({ distrito: 'Islay' }))).toBe(3);
    expect(especificidad(resolverUbigeo({ provincia: 'Islay' }))).toBe(2);
    expect(especificidad(resolverUbigeo('Arequipa'))).toBe(1);
    expect(especificidad(resolverUbigeo(null))).toBe(0);
  });
});
