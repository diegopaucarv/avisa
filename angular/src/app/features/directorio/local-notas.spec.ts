import { describe, expect, it } from 'vitest';

import { enlaceMapaLocal } from './local.mapeo';
import { parsearNotasLocal, PLANTILLA_LOCAL } from './local-notas';

const SIN_NOTAS = {
  evaluacion: null,
  accesibilidad: [],
  ventilacion: [],
  otras: [],
  textoLibre: null,
};

describe('parsearNotasLocal', () => {
  it('interpreta la plantilla completa con las tres secciones y la evaluación', () => {
    const notas = parsearNotasLocal(`## Evaluación
Local amplio y céntrico, con buena iluminación.

## Accesibilidad
- Escaleras en la entrada
- Sin rampa
- Transporte público cercano

## Ventilación
- Ventilación natural
- Aire acondicionado

## Otras observaciones
- Baños en buen estado`);

    expect(notas.evaluacion).toBe('Local amplio y céntrico, con buena iluminación.');
    expect(notas.accesibilidad).toEqual([
      'Escaleras en la entrada',
      'Sin rampa',
      'Transporte público cercano',
    ]);
    expect(notas.ventilacion).toEqual(['Ventilación natural', 'Aire acondicionado']);
    expect(notas.otras).toEqual(['Baños en buen estado']);
    expect(notas.textoLibre).toBeNull();
  });

  it('conserva el texto legado sin encabezados en textoLibre', () => {
    const notas = parsearNotasLocal(
      'Local con buena iluminación. Coordinar el acceso con el presidente vecinal.',
    );

    expect(notas).toEqual({
      ...SIN_NOTAS,
      textoLibre: 'Local con buena iluminación. Coordinar el acceso con el presidente vecinal.',
    });
  });

  it('reconoce encabezados con un solo # y en mayúsculas', () => {
    const notas = parsearNotasLocal(`# EVALUACION
Texto libre de la evaluación.

# ACCESIBILIDAD
* Rampa de acceso

# VENTILACIÓN
* Ventilación cruzada

# OTRAS OBSERVACIONES
• Estacionamiento propio`);

    expect(notas.evaluacion).toBe('Texto libre de la evaluación.');
    expect(notas.accesibilidad).toEqual(['Rampa de acceso']);
    expect(notas.ventilacion).toEqual(['Ventilación cruzada']);
    expect(notas.otras).toEqual(['Estacionamiento propio']);
    expect(notas.textoLibre).toBeNull();
  });

  it('acepta viñetas mezcladas y líneas sueltas, y descarta las vacías', () => {
    const notas = parsearNotasLocal(`## Accesibilidad
- Rampa
* Escaleras
• Puerta angosta
Ascensor


## Ventilación`);

    expect(notas.accesibilidad).toEqual(['Rampa', 'Escaleras', 'Puerta angosta', 'Ascensor']);
    expect(notas.ventilacion).toEqual([]);
  });

  it('toma el texto anterior al primer encabezado como evaluación', () => {
    const notas = parsearNotasLocal(`Evaluación escrita antes de las secciones.

## Accesibilidad
- Rampa`);

    expect(notas.evaluacion).toBe('Evaluación escrita antes de las secciones.');
    expect(notas.accesibilidad).toEqual(['Rampa']);
    expect(notas.textoLibre).toBeNull();
  });

  it('devuelve notas vacías para null, undefined o texto en blanco', () => {
    expect(parsearNotasLocal(null)).toEqual(SIN_NOTAS);
    expect(parsearNotasLocal(undefined)).toEqual(SIN_NOTAS);
    expect(parsearNotasLocal('   \n  ')).toEqual(SIN_NOTAS);
  });

  it('la plantilla ofrecida en la UI es interpretable por el parser', () => {
    const notas = parsearNotasLocal(PLANTILLA_LOCAL);

    expect(notas.textoLibre).toBeNull();
    expect(notas.evaluacion).toContain('texto libre de evaluación');
    expect(notas.accesibilidad[0]).toContain('barreras de acceso');
    expect(notas.ventilacion[0]).toContain('ventilación natural');
    expect(notas.otras[0]).toContain('opcional');
  });
});

describe('enlaceMapaLocal', () => {
  it('devuelve la URL de referencia cuando es http(s)', () => {
    const local = {
      ubicacionRef: 'https://maps.app.goo.gl/abc123',
      direccion: 'Av. Los Andes 123, Lima',
    };

    expect(enlaceMapaLocal(local)).toBe('https://maps.app.goo.gl/abc123');
  });

  it('busca por la dirección codificada cuando no hay URL', () => {
    const direccion = 'Av. Los Andes 123, Lima';

    expect(enlaceMapaLocal({ ubicacionRef: null, direccion })).toBe(
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(direccion),
    );
  });

  it('devuelve null sin URL ni dirección', () => {
    expect(enlaceMapaLocal({ ubicacionRef: null, direccion: null })).toBeNull();
    expect(enlaceMapaLocal({ ubicacionRef: '   ', direccion: '  ' })).toBeNull();
  });
});
