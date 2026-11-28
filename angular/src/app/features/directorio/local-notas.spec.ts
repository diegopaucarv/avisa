import { describe, expect, it } from 'vitest';

import { enlaceMapaLocal } from './local.mapeo';
import {
  leerRiesgosMarkdown,
  parsearNotasLocal,
  PLANTILLA_LOCAL,
  unirRiesgos,
} from './local-notas';

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

  it('no arrastra las viñetas de «Otros riesgos» a la sección de ventilación', () => {
    const notas = parsearNotasLocal(`## Accesibilidad
- Rampa

## Ventilación
- Natural

## Otros riesgos
- Baños clausurados`);

    expect(notas.accesibilidad).toEqual(['Rampa']);
    expect(notas.ventilacion).toEqual(['Natural']);
    expect(notas.otras).toEqual(['Baños clausurados']);
  });
});

describe('leerRiesgosMarkdown', () => {
  it('lee las tres secciones de la plantilla', () => {
    const riesgos = leerRiesgosMarkdown(`## Accesibilidad
- Escaleras en la entrada
* Sin rampa

## Ventilación
- Ventilación natural

## Otros riesgos
- Baños clausurados`);

    expect(riesgos.accesibilidad).toEqual(['Escaleras en la entrada', 'Sin rampa']);
    expect(riesgos.ventilacion).toEqual(['Ventilación natural']);
    expect(riesgos.otros).toEqual(['Baños clausurados']);
  });

  it('tolera mayúsculas, tildes omitidas y saltos de línea de Windows', () => {
    const riesgos = leerRiesgosMarkdown(
      '# ACCESIBILIDAD\r\n* Rampa\r\n\r\n# VENTILACION\r\n- Cruzada\r\n\r\n# OTROS RIESGOS\r\n- Ruido',
    );

    expect(riesgos.accesibilidad).toEqual(['Rampa']);
    expect(riesgos.ventilacion).toEqual(['Cruzada']);
    expect(riesgos.otros).toEqual(['Ruido']);
  });

  it('devuelve listas vacías para las secciones ausentes', () => {
    const riesgos = leerRiesgosMarkdown('## Accesibilidad\n- Rampa');

    expect(riesgos.accesibilidad).toEqual(['Rampa']);
    expect(riesgos.ventilacion).toEqual([]);
    expect(riesgos.otros).toEqual([]);
  });

  it('ignora el texto previo al primer encabezado de riesgo', () => {
    const riesgos = leerRiesgosMarkdown(
      'Evaluación libre sin riesgos.\n\n## Ventilación\n- Natural',
    );

    expect(riesgos.accesibilidad).toEqual([]);
    expect(riesgos.ventilacion).toEqual(['Natural']);
    expect(riesgos.otros).toEqual([]);
  });

  it('devuelve listas vacías para null, undefined o texto en blanco', () => {
    const vacio = { accesibilidad: [], ventilacion: [], otros: [] };

    expect(leerRiesgosMarkdown(null)).toEqual(vacio);
    expect(leerRiesgosMarkdown(undefined)).toEqual(vacio);
    expect(leerRiesgosMarkdown('   \n  ')).toEqual(vacio);
  });
});

describe('unirRiesgos', () => {
  it('deduplica por texto normalizado y conserva el orden', () => {
    expect(unirRiesgos(['Rampa'], ['rámpa', 'Escaleras'], ['  ESCALERAS '])).toEqual([
      'Rampa',
      'Escaleras',
    ]);
  });

  it('descarta elementos vacíos', () => {
    expect(unirRiesgos(['', '   '], ['Rampa'])).toEqual(['Rampa']);
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
