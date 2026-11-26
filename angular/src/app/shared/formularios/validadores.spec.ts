import { describe, expect, it } from 'vitest';

import {
  esValido,
  validarCorreo,
  validarDni,
  validarFechaDdMmAaaa,
  validarRuc,
  validarTelefonoPe,
  validarTextoObligatorio,
  validarUbigeo,
  validarUrlHttp,
} from './validadores';

/**
 * Los validadores se prueban por su contrato observable: mensaje (string) con
 * el error, `null` cuando el valor es válido. No hace falta TestBed ni DOM.
 */

describe('validarDni', () => {
  it('acepta ocho dígitos', () => {
    expect(validarDni('12345678')).toBeNull();
    expect(validarDni('12345678')).toBeNull();
  });

  it('ignora los espacios de los extremos', () => {
    expect(validarDni('  12345678  ')).toBeNull();
  });

  it('rechaza menos de ocho dígitos', () => {
    expect(validarDni('1234567')).toMatch(/8 dígitos/);
    expect(validarDni('123456')).toMatch(/8 dígitos/);
  });

  it('rechaza nueve dígitos', () => {
    expect(validarDni('123456789')).toMatch(/8 dígitos/);
  });

  it('rechaza letras y separadores', () => {
    expect(validarDni('1234567a')).toMatch(/8 dígitos/);
    expect(validarDni('12.345.678')).toMatch(/8 dígitos/);
    expect(validarDni('12 345 678')).toMatch(/8 dígitos/);
  });

  it('rechaza el valor vacío', () => {
    expect(validarDni('')).toMatch(/Ingrese el DNI/);
    expect(validarDni(null)).toMatch(/Ingrese el DNI/);
    expect(validarDni(undefined)).toMatch(/Ingrese el DNI/);
  });
});

describe('validarRuc', () => {
  it('acepta RUC con dígito verificador correcto', () => {
    expect(validarRuc('20131312955')).toBeNull();
    expect(validarRuc('20100070970')).toBeNull();
  });

  it('rechaza un dígito verificador que no coincide', () => {
    expect(validarRuc('20131312954')).toMatch(/dígito verificador/);
    expect(validarRuc('20100070971')).toMatch(/dígito verificador/);
  });

  it('rechaza longitudes distintas de once', () => {
    expect(validarRuc('2013131295')).toMatch(/11 dígitos/);
    expect(validarRuc('201313129555')).toMatch(/11 dígitos/);
  });

  it('rechaza caracteres que no son dígitos', () => {
    expect(validarRuc('2013131295a')).toMatch(/11 dígitos/);
  });

  it('rechaza el valor vacío', () => {
    expect(validarRuc('')).toMatch(/Ingrese el RUC/);
  });
});

describe('validarCorreo', () => {
  it('acepta correos razonables', () => {
    expect(validarCorreo('nombre@entidad.gob.pe')).toBeNull();
    expect(validarCorreo('a.b+c@producción.gob.pe')).toBeNull();
    expect(validarCorreo('  usuario@dominio.com  ')).toBeNull();
  });

  it('rechaza correos sin dominio o con espacios', () => {
    expect(validarCorreo('a@b')).toMatch(/correo electrónico válido/);
    expect(validarCorreo('a b@c.com')).toMatch(/correo electrónico válido/);
    expect(validarCorreo('@dominio.com')).toMatch(/correo electrónico válido/);
    expect(validarCorreo('usuario@')).toMatch(/correo electrónico válido/);
  });

  it('rechaza el valor vacío', () => {
    expect(validarCorreo('')).toMatch(/Ingrese el correo/);
  });
});

describe('validarTelefonoPe', () => {
  it('acepta celulares de nueve dígitos', () => {
    expect(validarTelefonoPe('987654321')).toBeNull();
    expect(validarTelefonoPe('987 654 321')).toBeNull();
    expect(validarTelefonoPe('987-654-321')).toBeNull();
  });

  it('acepta el prefijo del país', () => {
    expect(validarTelefonoPe('+51 987 654 321')).toBeNull();
    expect(validarTelefonoPe('51987654321')).toBeNull();
  });

  it('acepta fijos que empiezan con 0', () => {
    expect(validarTelefonoPe('(01) 456-7890')).toBeNull();
  });

  it('rechaza una longitud incorrecta', () => {
    expect(validarTelefonoPe('987654')).toMatch(/9 dígitos/);
    expect(validarTelefonoPe('9876543210')).toMatch(/9 dígitos/);
  });

  it('rechaza inicios que no son 9 ni 0', () => {
    expect(validarTelefonoPe('123456789')).toMatch(/empezar con 9/);
  });

  it('rechaza letras y el valor vacío', () => {
    expect(validarTelefonoPe('987ABC321')).toMatch(/sólo puede contener números/);
    expect(validarTelefonoPe('')).toMatch(/Ingrese el teléfono/);
  });
});

describe('validarFechaDdMmAaaa', () => {
  const hoy = '2026-11-24';

  it('acepta una fecha existente en dd/mm/aaaa', () => {
    expect(validarFechaDdMmAaaa('24/11/2026')).toBeNull();
    expect(validarFechaDdMmAaaa('1/2/2026')).toBeNull();
  });

  it('rechaza un formato distinto', () => {
    expect(validarFechaDdMmAaaa('2026-11-24')).toMatch(/formato dd\/mm\/aaaa/);
    expect(validarFechaDdMmAaaa('24-11-2026')).toMatch(/formato dd\/mm\/aaaa/);
    expect(validarFechaDdMmAaaa('24/11/26')).toMatch(/formato dd\/mm\/aaaa/);
  });

  it('rechaza una fecha que no existe en el calendario', () => {
    expect(validarFechaDdMmAaaa('31/02/2026')).toMatch(/no existe/);
    expect(validarFechaDdMmAaaa('00/01/2026')).toMatch(/no existe/);
  });

  it('rechaza fechas futuras cuando se pide', () => {
    expect(validarFechaDdMmAaaa('25/11/2026', { noFutura: true, hoy })).toMatch(/posterior a hoy/);
    expect(validarFechaDdMmAaaa('24/11/2026', { noFutura: true, hoy })).toBeNull();
    expect(validarFechaDdMmAaaa('23/11/2026', { noFutura: true, hoy })).toBeNull();
  });

  it('no limita el futuro si no se pide', () => {
    expect(validarFechaDdMmAaaa('31/12/2099', { hoy })).toBeNull();
  });

  it('rechaza el valor vacío', () => {
    expect(validarFechaDdMmAaaa('')).toMatch(/Ingrese/);
  });
});

describe('validarTextoObligatorio', () => {
  it('acepta texto con la longitud pedida', () => {
    expect(validarTextoObligatorio('abc', { minimo: 3 })).toBeNull();
  });

  it('rechaza vacío y sólo espacios', () => {
    expect(validarTextoObligatorio('', { campo: 'el nombre' })).toMatch(/Complete el nombre/);
    expect(validarTextoObligatorio('   ', { campo: 'el nombre' })).toMatch(/Complete el nombre/);
  });

  it('rechaza textos más cortos que el mínimo', () => {
    expect(validarTextoObligatorio('ab', { minimo: 3 })).toMatch(/Complete/);
  });

  it('rechaza textos más largos que el máximo', () => {
    expect(validarTextoObligatorio('abcdef', { maximo: 5 })).toMatch(/5 caracteres como máximo/);
  });

  it('mide sin contar los espacios de los extremos', () => {
    expect(validarTextoObligatorio('  abc  ', { minimo: 3, maximo: 3 })).toBeNull();
  });
});

describe('validarUrlHttp', () => {
  it('acepta http y https', () => {
    expect(validarUrlHttp('https://www.gob.pe/produce')).toBeNull();
    expect(validarUrlHttp('http://intranet.local')).toBeNull();
  });

  it('rechaza otros protocolos', () => {
    expect(validarUrlHttp('ftp://archivos.local')).toMatch(/http:\/\/ o https:\/\//);
    expect(validarUrlHttp('javascript:alert(1)')).toMatch(/http:\/\/ o https:\/\//);
  });

  it('rechaza un texto que no es una URL absoluta', () => {
    expect(validarUrlHttp('www.gob.pe')).toMatch(/dirección web válida/);
    expect(validarUrlHttp('no es una url')).toMatch(/dirección web válida/);
  });

  it('rechaza el valor vacío', () => {
    expect(validarUrlHttp('')).toMatch(/Ingrese la dirección web/);
  });
});

describe('validarUbigeo', () => {
  it('acepta exactamente seis dígitos', () => {
    expect(validarUbigeo('150101')).toBeNull();
  });

  it('rechaza longitudes distintas de seis', () => {
    expect(validarUbigeo('15010')).toMatch(/6 dígitos/);
    expect(validarUbigeo('1501011')).toMatch(/6 dígitos/);
  });

  it('rechaza caracteres que no son dígitos', () => {
    expect(validarUbigeo('15010A')).toMatch(/6 dígitos/);
  });

  it('rechaza el valor vacío', () => {
    expect(validarUbigeo('')).toMatch(/Ingrese el ubigeo/);
  });
});

describe('esValido', () => {
  it('es verdadero sólo sin mensaje', () => {
    expect(esValido(null)).toBe(true);
    expect(esValido('error')).toBe(false);
  });
});
