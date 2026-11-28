import { describe, expect, it } from 'vitest';

import { resolverUrlMedia } from '../../core/http/url-media';
import {
  aActorDirectorio,
  aCasosDeActor,
  aMembresiaActor,
  aPiiLote,
  regionesDerivadasDeCasos,
} from './directorio.mapeo';

describe('aActorDirectorio', () => {
  it('preserva la clasificación que controla la acción de edición', () => {
    const actor = aActorDirectorio({
      id: 'actor-1',
      nombre: 'Rosa Quispe',
      naturaleza: 'persona',
      clasificacion: 3,
      activo: true,
    });

    expect(actor.clasificacion).toBe(3);
    expect(actor.naturaleza).toBe('Persona');
  });

  it('usa acceso reservado por defecto cuando la clasificación falta', () => {
    const actor = aActorDirectorio({ id: 'actor-2', nombre: 'Organización' });

    expect(actor.clasificacion).toBe(1);
  });

  it('mapea la provincia derivada del distrito', () => {
    const actor = aActorDirectorio({
      id: 'actor-3',
      nombre: 'Rosa Quispe',
      distrito: 'Castilla',
      provincia: 'Piura',
    });

    expect(actor.distrito).toBe('Castilla');
    expect(actor.provincia).toBe('Piura');
  });
});

describe('resolverUrlMedia', () => {
  const base = 'https://api.example.com';

  it('resuelve una ruta relativa contra una base absoluta', () => {
    expect(resolverUrlMedia('/api/v1/media/abc/contenido', base)).toBe(
      'https://api.example.com/api/v1/media/abc/contenido',
    );
  });

  it('deja intactas las URL absolutas y de datos', () => {
    expect(resolverUrlMedia('https://cdn.example.com/foto.png', base)).toBe(
      'https://cdn.example.com/foto.png',
    );
    expect(resolverUrlMedia('data:image/png;base64,AAAA', base)).toBe('data:image/png;base64,AAAA');
    expect(resolverUrlMedia('blob:https://app.example.com/123', base)).toBe(
      'blob:https://app.example.com/123',
    );
  });

  it('conserva la ruta cuando la base es relativa', () => {
    expect(resolverUrlMedia('/api/v1/media/abc/contenido', '/api')).toBe(
      '/api/v1/media/abc/contenido',
    );
  });

  it('devuelve cadena vacía para una URL ausente', () => {
    expect(resolverUrlMedia(null, base)).toBe('');
    expect(resolverUrlMedia('   ', base)).toBe('');
  });
});

describe('aMembresiaActor', () => {
  it('mapea la pertenencia vigente con su cargo y vigencia', () => {
    const membresia = aMembresiaActor({
      actorId: 'persona-1',
      organizacionId: 'org-1',
      nombre: 'Asociación de Pescadores',
      cargo: 'Presidente',
      desde: '2024-03-01',
      hasta: null,
    });

    expect(membresia).toEqual({
      actorId: 'persona-1',
      organizacionId: 'org-1',
      nombre: 'Asociación de Pescadores',
      cargo: 'Presidente',
      desde: '2024-03-01',
      hasta: null,
    });
  });

  it('descarta una membresía sin actor u organización', () => {
    expect(aMembresiaActor({ nombre: 'Organización sin dueño' })).toBeNull();
    expect(aMembresiaActor(null)).toBeNull();
  });
});

describe('aPiiLote', () => {
  it('mapea los datos y los errores por id', () => {
    const lote = aPiiLote({
      datos: {
        'actor-1': { dni: '01234567', telefono: '999888777' },
        'actor-2': { dni: 87654321, telefono: null },
      },
      errores: { 'actor-3': 'El actor no existe.' },
    });

    expect(lote.datos.get('actor-1')).toEqual({ dni: '01234567', telefono: '999888777' });
    // El driver puede devolver números: se normalizan a texto como el endpoint individual.
    expect(lote.datos.get('actor-2')).toEqual({ dni: '87654321', telefono: null });
    expect(lote.errores.get('actor-3')).toBe('El actor no existe.');
  });

  it('trata un lote sin claves como vacío, no como fallo', () => {
    const lote = aPiiLote(null);
    expect(lote.datos.size).toBe(0);
    expect(lote.errores.size).toBe(0);
  });

  it('descarta motivos vacíos y tolera que falte `errores`', () => {
    const lote = aPiiLote({ datos: {}, errores: { 'actor-1': '   ' } });
    expect(lote.errores.size).toBe(0);
    expect(aPiiLote({ datos: { 'actor-1': { dni: '12345678' } } }).datos.get('actor-1')).toEqual({
      dni: '12345678',
      telefono: null,
    });
  });
});

describe('aCasosDeActor', () => {
  it('lee el sobre `{ casos }` del endpoint de casos del actor', () => {
    const casos = aCasosDeActor({
      casos: [
        { codigo: 'C-001', nombre: 'Pesca informal', region: 'Piura' },
        { codigo: 'C-002', nombre: 'Río contaminado', region: null },
      ],
      total: 2,
    });

    expect(casos).toEqual([
      { codigo: 'C-001', nombre: 'Pesca informal', region: 'Piura' },
      { codigo: 'C-002', nombre: 'Río contaminado', region: null },
    ]);
  });

  it('acepta un array directo y el sobre `{ items }` de los listados', () => {
    const directo = aCasosDeActor([{ codigo: 'C-100', nombre: 'Caso' }]);
    expect(directo).toEqual([{ codigo: 'C-100', nombre: 'Caso', region: null }]);

    const conItems = aCasosDeActor({ items: [{ code: 'C-200', title: 'Otro caso' }] });
    expect(conItems).toEqual([{ codigo: 'C-200', nombre: 'Otro caso', region: null }]);
  });

  it('descarta filas sin código y tolera una respuesta vacía o nula', () => {
    expect(
      aCasosDeActor({ casos: [{ nombre: 'Sin código' }, { codigo: 'C-001', nombre: 'Válido' }] }),
    ).toEqual([{ codigo: 'C-001', nombre: 'Válido', region: null }]);
    expect(aCasosDeActor(null)).toEqual([]);
    expect(aCasosDeActor({})).toEqual([]);
  });
});

describe('regionesDerivadasDeCasos', () => {
  it('devuelve las regiones de los casos sin repetir y en orden', () => {
    const regiones = regionesDerivadasDeCasos([
      { codigo: 'C-001', nombre: 'Uno', region: 'Piura' },
      { codigo: 'C-002', nombre: 'Dos', region: 'Lambayeque' },
      { codigo: 'C-003', nombre: 'Tres', region: 'Piura' },
      { codigo: 'C-004', nombre: 'Cuatro', region: null },
    ]);

    expect(regiones).toEqual(['Piura', 'Lambayeque']);
  });

  it('queda vacío cuando ningún caso resuelve región', () => {
    expect(regionesDerivadasDeCasos([{ codigo: 'C-001', nombre: 'Uno', region: null }])).toEqual(
      [],
    );
    expect(regionesDerivadasDeCasos([])).toEqual([]);
  });
});
