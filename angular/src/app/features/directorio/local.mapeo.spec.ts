import { describe, expect, it } from 'vitest';

import {
  aLocalDirectorio,
  consultaMapa,
  coordenadasDeLocal,
  coordenadasEnUbicacion,
  enlaceGoogleMaps,
  enlaceMapaIncorporado,
  etiquetaMapa,
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
    expect(coordenadasEnUbicacion('https://maps.app.goo.gl/FG7Rn6SJcVGSVRKSA?g_st=ic')).toBeNull();
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
    expect(territorioDeLocal({ distrito: 'Ica', provincia: 'Ica', region: 'Ica' })).toBe(
      'Ica, Ica, Ica',
    );
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

describe('consultaMapa', () => {
  it('usa la dirección completa cuando existe', () => {
    expect(
      consultaMapa({
        direccion: 'Av. Los Andes 123, Paita',
        distrito: 'Paita',
        provincia: 'Paita',
        region: 'Piura',
      }),
    ).toBe('Av. Los Andes 123, Paita');
  });

  it('cae al distrito cuando no hay dirección', () => {
    expect(consultaMapa({ direccion: null, distrito: 'Ica', provincia: null, region: null })).toBe(
      'Ica',
    );
  });

  it('une el territorio disponible sin separadores sueltos', () => {
    expect(consultaMapa({ direccion: '  ', distrito: null, provincia: 'Ica', region: 'Ica' })).toBe(
      'Ica, Ica',
    );
  });

  it('devuelve null sin dirección ni territorio', () => {
    expect(
      consultaMapa({ direccion: null, distrito: null, provincia: null, region: null }),
    ).toBeNull();
    expect(
      consultaMapa({ direccion: '   ', distrito: '', provincia: ' ', region: null }),
    ).toBeNull();
  });
});

describe('enlaceGoogleMaps', () => {
  it('codifica la consulta y no deja espacios sin codificar', () => {
    const enlace = enlaceGoogleMaps({
      direccion: 'Av. Los Andes 123, Paita',
      distrito: null,
      provincia: null,
      region: null,
    });

    expect(enlace).toBe(
      'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent('Av. Los Andes 123, Paita'),
    );
    expect(enlace).not.toBeNull();
    expect(enlace).not.toContain(' ');
  });

  it('devuelve null cuando no hay consulta', () => {
    expect(
      enlaceGoogleMaps({ direccion: null, distrito: null, provincia: null, region: null }),
    ).toBeNull();
  });
});

describe('enlaceMapaIncorporado', () => {
  it('arma la vista incorporada sin API key a nivel de calle', () => {
    const enlace = enlaceMapaIncorporado({
      direccion: 'Calle Real 45, Ica',
      distrito: null,
      provincia: null,
      region: null,
    });

    expect(enlace).toBe(
      'https://maps.google.com/maps?q=' +
        encodeURIComponent('Calle Real 45, Ica') +
        '&z=17&hl=es&output=embed',
    );
    expect(enlace).not.toContain(' ');
  });

  it('devuelve null cuando no hay consulta', () => {
    expect(
      enlaceMapaIncorporado({ direccion: null, distrito: null, provincia: null, region: null }),
    ).toBeNull();
  });
});

describe('etiquetaMapa', () => {
  it('nombra el local y la búsqueda', () => {
    expect(
      etiquetaMapa({
        nombre: 'Local Central',
        direccion: null,
        distrito: 'Ica',
        provincia: null,
        region: null,
      }),
    ).toBe('Mapa de Local Central en Ica');
  });

  it('sólo nombra el local cuando no hay datos de ubicación', () => {
    expect(
      etiquetaMapa({
        nombre: 'Local Central',
        direccion: null,
        distrito: null,
        provincia: null,
        region: null,
      }),
    ).toBe('Mapa de Local Central');
  });
});
