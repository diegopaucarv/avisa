import { describe, expect, it } from 'vitest';

import {
  aLocalDirectorio,
  coordenadasDeLocal,
  coordenadasEnUbicacion,
  territorioDeLocal,
} from './local.mapeo';

describe('coordenadasEnUbicacion', () => {
  it('lee @lat,lng de una URL de Google Maps', () => {
    expect(coordenadasEnUbicacion('https://www.google.com/maps/@-12.05,-77.05,15z')).toEqual({
      lat: -12.05,
      lng: -77.05,
    });
  });

  it('lee el parámetro q=lat,lng', () => {
    expect(coordenadasEnUbicacion('https://www.google.com/maps?q=-12.05,-77.05')).toEqual({
      lat: -12.05,
      lng: -77.05,
    });
  });

  it('devuelve null para un enlace corto que no incluye coordenadas', () => {
    expect(
      coordenadasEnUbicacion('https://maps.app.goo.gl/FG7Rn6SJcVGSVRKSA?g_st=ic'),
    ).toBeNull();
  });

  it('devuelve null para una referencia textual o vacía', () => {
    expect(coordenadasEnUbicacion('Cerca de la Plaza de Armas')).toBeNull();
    expect(coordenadasEnUbicacion(null)).toBeNull();
    expect(coordenadasEnUbicacion('   ')).toBeNull();
  });

  it('rechaza coordenadas fuera del rango terrestre', () => {
    expect(coordenadasEnUbicacion('https://www.google.com/maps?q=120,200')).toBeNull();
  });
});

describe('coordenadasDeLocal', () => {
  it('prefiere las columnas cuando existen', () => {
    expect(
      coordenadasDeLocal({
        latitud: -12,
        longitud: -77,
        ubicacionRef: 'https://www.google.com/maps/@1,2,15z',
      }),
    ).toEqual({ lat: -12, lng: -77 });
  });

  it('cae a ubicacion_ref cuando no hay columnas', () => {
    expect(
      coordenadasDeLocal({
        latitud: null,
        longitud: null,
        ubicacionRef: 'https://www.google.com/maps/@-12.05,-77.05,15z',
      }),
    ).toEqual({ lat: -12.05, lng: -77.05 });
  });

  it('devuelve null sin coordenadas ni URL con coordenadas', () => {
    expect(
      coordenadasDeLocal({
        latitud: null,
        longitud: null,
        ubicacionRef: 'https://maps.app.goo.gl/FG7Rn6SJcVGSVRKSA',
      }),
    ).toBeNull();
  });
});

describe('territorioDeLocal', () => {
  it('une distrito, provincia y región sin la dirección', () => {
    expect(
      territorioDeLocal({ distrito: 'Ica', provincia: 'Ica', region: 'Ica' }),
    ).toBe('Ica, Ica, Ica');
  });

  it('omite los tramos nulos', () => {
    expect(territorioDeLocal({ distrito: null, provincia: null, region: 'Piura' })).toBe('Piura');
  });

  it('devuelve null sin datos territoriales', () => {
    expect(territorioDeLocal({ distrito: null, provincia: null, region: null })).toBeNull();
  });
});

describe('aLocalDirectorio · coordenadas', () => {
  it('lee latitud y longitud si la API las publicara', () => {
    const local = aLocalDirectorio({ id: 'x', nombre: 'Local', latitud: -12, longitud: -77 });

    expect(local.latitud).toBe(-12);
    expect(local.longitud).toBe(-77);
  });

  it('deja las coordenadas en null cuando no vienen en la respuesta', () => {
    const local = aLocalDirectorio({ id: 'x', nombre: 'Local' });

    expect(local.latitud).toBeNull();
    expect(local.longitud).toBeNull();
  });
});
