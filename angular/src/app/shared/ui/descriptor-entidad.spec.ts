import { describe, expect, it } from 'vitest';

import { describir, esTipoEntidad, tiposEntidad } from './descriptor-entidad';

/**
 * El descriptor es una tabla de presentación compartida: se prueba que los 12
 * tipos existan y que `describir()` tolere lo que no conoce sin lanzar.
 */

describe('tiposEntidad', () => {
  it('declara los doce tipos del dominio', () => {
    const tipos = tiposEntidad();

    expect(tipos).toHaveLength(12);
    expect(tipos).toContain('caso');
    expect(tipos).toContain('auditorio');
    expect(tipos).toContain('escenario');
  });

  it('no repite tipos', () => {
    expect(new Set(tiposEntidad()).size).toBe(tiposEntidad().length);
  });
});

describe('describir', () => {
  it('devuelve el descriptor canónico', () => {
    const caso = describir('caso');

    expect(caso.tipo).toBe('caso');
    expect(caso.plural).toBe('casos');
    expect(caso.articulo).toBe('el');
    expect(caso.icono).toBe('casos');
    expect(caso.rutaBase).toBe('/casos');
    expect(caso.colorToken).toBe('--blue');
  });

  it('usa el vocabulario del brief para auditorios y organizaciones', () => {
    expect(describir('auditorio').plural).toBe('auditorios');
    expect(describir('organizacion').singular).toBe('organización');
    expect(describir('organizacion').articulo).toBe('la');
  });

  it('acepta plural, mayúsculas, tildes y separadores', () => {
    expect(describir('ORGANIZACIONES').tipo).toBe('organizacion');
    expect(describir('reunión').tipo).toBe('reunion');
    expect(describir('demandas-sin-caso').tipo).toBe('demanda');
    expect(describir('locales').tipo).toBe('auditorio');
  });

  it('no inventa ruta para entidades sin pantalla', () => {
    expect(describir('sugerencia').rutaBase).toBeNull();
    expect(describir('escenario').rutaBase).toBeNull();
  });

  it('tolera un tipo desconocido con un descriptor genérico', () => {
    const nave = describir('nave');

    expect('conocido' in nave).toBe(true);
    if ('conocido' in nave) expect(nave.conocido).toBe(false);
    expect(nave.tipo).toBe('nave');
    expect(nave.plural).toBe('naves');
    expect(nave.icono).toBe('punto');
    expect(nave.rutaBase).toBeNull();
    expect(nave.colorToken).toBe('--muted');
  });

  it('tolera un valor vacío o nulo', () => {
    const vacio = describir(null);

    expect('conocido' in vacio).toBe(true);
    if ('conocido' in vacio) expect(vacio.conocido).toBe(false);
    expect(vacio.singular).toBe('elemento');
    expect(vacio.plural).toBe('elementos');
  });

  it('sólo declara rutas absolutas o ningún destino', () => {
    for (const tipo of tiposEntidad()) {
      const ruta = describir(tipo).rutaBase;
      expect(ruta === null || ruta.startsWith('/')).toBe(true);
    }
  });
});

describe('esTipoEntidad', () => {
  it('reconoce singular, plural y alias', () => {
    expect(esTipoEntidad('caso')).toBe(true);
    expect(esTipoEntidad('actores')).toBe(true);
    expect(esTipoEntidad('instituciones')).toBe(true);
  });

  it('rechaza lo que no está declarado', () => {
    expect(esTipoEntidad('nave')).toBe(false);
    expect(esTipoEntidad(null)).toBe(false);
  });
});
