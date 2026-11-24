import { describe, expect, it } from 'vitest';

import { aCaso } from '../../dominio/mapeo';
import type { Caso, NivelConflicto } from '../../dominio/modelos';
import {
  casosDeRegion,
  casosPorDistritoUbigeo,
  casosSinDistrito,
  claseCoropleta,
  conteosPorSituacion,
  filasPorRegion,
  indicePoblacionPorRegion,
  poblacionDeRegion,
  situacionDe,
  tasaPor100k,
} from './panorama.agregados';

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
    distrito: null,
    distritoUbigeo: null,
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

describe('casosDeRegion', () => {
  it('devuelve el conjunto íntegro cuando no hay región aplicada', () => {
    const casos = [caso({ id: 'a', region: 'Piura' }), caso({ id: 'b', region: null })];

    expect(casosDeRegion(casos, null)).toEqual(casos);
  });

  it('filtra la región sin distinguir acentos ni mayúsculas', () => {
    const casos = [
      caso({ id: 'a', region: 'Piura' }),
      caso({ id: 'b', region: 'Lima' }),
      caso({ id: 'c', region: null }),
    ];

    expect(casosDeRegion(casos, 'PIURA').map((fila) => fila.id)).toEqual(['a']);
  });

  it('no atribuye a una región los casos sin región', () => {
    const casos = [
      caso({ id: 'con-region', region: 'Piura' }),
      caso({ id: 'sin-region', region: null }),
    ];

    expect(casosDeRegion(casos, 'Piura').map((fila) => fila.id)).toEqual(['con-region']);
  });
});

describe('aCaso', () => {
  it('conserva el nivel de conflictividad declarado', () => {
    expect(aCaso({ nivelConflicto: 'Conflicto social' }).nivelConflicto).toBe('Conflicto social');
  });

  it('deja el nivel sin declarar en null en vez de suponer Diferencia', () => {
    expect(aCaso({}).nivelConflicto).toBeNull();
    expect(aCaso({ nivelConflicto: null }).nivelConflicto).toBeNull();
  });

  it('lee el distrito y su ubigeo del bloque geografia', () => {
    const mapeado = aCaso({
      geografia: { distrito: 'Chilca', distritoUbigeo: '150505' },
    });

    expect(mapeado.distrito).toBe('Chilca');
    expect(mapeado.distritoUbigeo).toBe('150505');
  });

  it('no inventa distrito cuando el bloque no viene', () => {
    const mapeado = aCaso({ region: 'Lima' });

    expect(mapeado.distrito).toBeNull();
    expect(mapeado.distritoUbigeo).toBeNull();
  });
});

describe('casosPorDistritoUbigeo', () => {
  it('cuenta por ubigeo y no por nombre', () => {
    const conteo = casosPorDistritoUbigeo([
      caso({ id: 'a', distrito: 'Santa Rosa', distritoUbigeo: '150101' }),
      caso({ id: 'b', distrito: 'Santa Rosa', distritoUbigeo: '060101' }),
      caso({ id: 'c', distrito: 'Santa Rosa', distritoUbigeo: '150101' }),
    ]);

    expect(conteo.get('150101')).toBe(2);
    expect(conteo.get('060101')).toBe(1);
  });

  it('deja fuera los casos sin ubigeo y los declara aparte', () => {
    const casos = [
      caso({ id: 'a', distritoUbigeo: '150101' }),
      caso({ id: 'b', distritoUbigeo: null }),
      caso({ id: 'c', distritoUbigeo: '   ' }),
    ];

    expect([...casosPorDistritoUbigeo(casos).keys()]).toEqual(['150101']);
    expect(casosSinDistrito(casos)).toBe(2);
  });
});

describe('claseCoropleta', () => {
  it.each([
    [0, 0],
    [-3, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 3],
    [5, 4],
    [40, 4],
  ])('clasifica %s casos en el tramo %s', (total, esperado) => {
    expect(claseCoropleta(total)).toBe(esperado);
  });
});

describe('tasaPor100k', () => {
  it('calcula la tasa con una décima', () => {
    expect(tasaPor100k(3, 12000)).toBe(25);
    expect(tasaPor100k(1, 30000)).toBe(3.3);
  });

  it('declara el hueco cuando el denominador falta o es cero', () => {
    expect(tasaPor100k(3, null)).toBeNull();
    expect(tasaPor100k(3, 0)).toBeNull();
    expect(tasaPor100k(3, -10)).toBeNull();
  });

  it('admite cero casos con población', () => {
    expect(tasaPor100k(0, 5000)).toBe(0);
  });
});

describe('indicePoblacionPorRegion', () => {
  const indice = indicePoblacionPorRegion([
    {
      clave: '02',
      nombre: 'ANCASH',
      poblacion: 1_100_000,
      distritos: 166,
      distritosConPoblacion: 166,
    },
    {
      clave: '20',
      nombre: 'PIURA',
      poblacion: null,
      distritos: 64,
      distritosConPoblacion: 0,
    },
  ]);

  it('cruza el nombre de la capa con el nombre con tildes del panorama', () => {
    expect(poblacionDeRegion('Áncash', indice)).toBe(1_100_000);
  });

  it('devuelve null cuando la capa no trae población para la región', () => {
    expect(poblacionDeRegion('Piura', indice)).toBeNull();
    expect(poblacionDeRegion('Loreto', indice)).toBeNull();
  });
});
