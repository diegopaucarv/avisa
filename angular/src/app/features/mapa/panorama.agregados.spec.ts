import { describe, expect, it } from 'vitest';

import { aCaso } from '../../dominio/mapeo';
import type { Caso, NivelConflicto } from '../../dominio/modelos';
import { conteosPorSituacion, filasPorRegion, situacionDe } from './panorama.agregados';

function caso(overrides: Partial<Caso> = {}): Caso {
  return {
    id: 'caso-1',
    codigo: 'CS-PA-INF-2026-01',
    titulo: 'Caso de prueba',
    resumen: null,
    avance: null,
    actualizado: null,
    inicio: '2026-01-01',
    region: 'Piura',
    estado: 'Abierto',
    riesgo: 'Moderado',
    prioridad: 'Moderado',
    alcance: 'Norte',
    nivelConflicto: 'Controversia',
    naturaleza: null,
    etapa: 'Prevención estratégica',
    tematica: null,
    subsector: null,
    unidadResponsable: null,
    origen: 'Manual',
    clasificacion: 1,
    anulado: false,
    anuladoEn: null,
    motivoAnulacion: null,
    anuladoPor: null,
    anuladoPorNombre: null,
    anulacionId: null,
    ...overrides,
  };
}

describe('situacionDe', () => {
  it.each([
    ['Diferencia', 'latente'],
    ['Controversia', 'latente'],
    ['Conflicto social', 'manifiesto'],
    ['Crisis social', 'manifiesto'],
  ] as const)('agrupa %s como %s', (nivel, esperado) => {
    expect(situacionDe(nivel)).toBe(esperado);
  });

  it('no etiqueta un caso sin nivel declarado', () => {
    expect(situacionDe(null)).toBeNull();
    expect(situacionDe(undefined)).toBeNull();
    expect(situacionDe('Otro' as NivelConflicto)).toBeNull();
  });
});

describe('conteosPorSituacion', () => {
  it('separa latentes, manifiestos y sin nivel declarado', () => {
    const conteo = conteosPorSituacion([
      caso({ nivelConflicto: 'Diferencia' }),
      caso({ nivelConflicto: 'Controversia' }),
      caso({ nivelConflicto: 'Conflicto social' }),
      caso({ nivelConflicto: 'Crisis social' }),
      caso({ nivelConflicto: null }),
    ]);

    expect(conteo).toEqual({ latente: 2, manifiesto: 2, sinNivel: 1 });
  });
});

describe('filasPorRegion', () => {
  it('desglosa cada región en latentes, manifiestos y sin nivel', () => {
    const [fila] = filasPorRegion([
      caso({ nivelConflicto: 'Diferencia' }),
      caso({ nivelConflicto: 'Crisis social' }),
      caso({ nivelConflicto: null }),
    ]);

    expect(fila).toMatchObject({
      region: 'Piura',
      total: 3,
      latente: 1,
      manifiesto: 1,
      sinNivel: 1,
    });
  });
});

describe('aCaso', () => {
  it('conserva el nivel de conflictividad declarado', () => {
    expect(aCaso({ nivelConflicto: 'Conflicto social' }).nivelConflicto).toBe(
      'Conflicto social',
    );
  });

  it('deja el nivel sin declarar en null en vez de suponer Diferencia', () => {
    expect(aCaso({}).nivelConflicto).toBeNull();
    expect(aCaso({ nivelConflicto: null }).nivelConflicto).toBeNull();
  });
});
