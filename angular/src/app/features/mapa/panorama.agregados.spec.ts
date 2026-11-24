import { describe, expect, it } from 'vitest';

import { aCaso } from '../../dominio/mapeo';
import type { Caso, NivelConflicto } from '../../dominio/modelos';
import {
  bandasPorAlcance,
  casosDeRegion,
  casosPorDistritoUbigeo,
  casosSinDistrito,
  claseCoropleta,
  claseManifiesto,
  conteosPorAlcance,
  conteosPorSituacion,
  ESCALA_MANIFIESTO,
  filasPorRegion,
  indicePoblacionPorRegion,
  poblacionDeRegion,
  proporcionLatenteDe,
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

  // OVERRIDE 2026-11-24: el caso sin nivel declarado es latente, no una
  // tercera situación. Así latente + manifiesto siempre suma el total.
  it('cuenta el caso sin nivel declarado como latente', () => {
    expect(situacionDe(null)).toBe('latente');
    expect(situacionDe(undefined)).toBe('latente');
    expect(situacionDe('Otro' as NivelConflicto)).toBe('latente');
  });
});

describe('proporcionLatenteDe', () => {
  it('divide latentes entre el total', () => {
    expect(proporcionLatenteDe(3, 4)).toBe(0.75);
    expect(proporcionLatenteDe(0, 4)).toBe(0);
    expect(proporcionLatenteDe(4, 4)).toBe(1);
  });

  it('devuelve 0 con total 0 en vez de inventar una proporción', () => {
    expect(proporcionLatenteDe(0, 0)).toBe(0);
    expect(proporcionLatenteDe(2, 0)).toBe(0);
  });
});

describe('claseManifiesto', () => {
  it('va de verde (todo latente) a rojo (todo manifiesto)', () => {
    expect(claseManifiesto(1)).toBe(0);
    expect(claseManifiesto(0.9)).toBe(0);
    expect(claseManifiesto(0.7)).toBe(1);
    expect(claseManifiesto(0.5)).toBe(2);
    expect(claseManifiesto(0.3)).toBe(3);
    expect(claseManifiesto(0)).toBe(ESCALA_MANIFIESTO.length - 1);
  });
});

describe('conteosPorSituacion', () => {
  it('cuenta latentes y manifiestos sin dejar casos fuera', () => {
    const conteo = conteosPorSituacion([
      caso({ nivelConflicto: 'Diferencia' }),
      caso({ nivelConflicto: 'Controversia' }),
      caso({ nivelConflicto: 'Conflicto social' }),
      caso({ nivelConflicto: 'Crisis social' }),
      caso({ nivelConflicto: null }),
    ]);

    expect(conteo).toMatchObject({
      latentes: 3,
      manifiestos: 2,
      total: 5,
      proporcionLatente: 0.6,
      sinNivel: 1,
    });
  });

  it('declara la proporción 0 cuando no hay casos', () => {
    expect(conteosPorSituacion([])).toMatchObject({
      latentes: 0,
      manifiestos: 0,
      total: 0,
      proporcionLatente: 0,
    });
  });
});

describe('conteosPorAlcance', () => {
  it('expone latentes, manifiestos, total y proporción por ámbito', () => {
    const [norte] = conteosPorAlcance([
      caso({ alcance: 'Norte', nivelConflicto: 'Diferencia' }),
      caso({ alcance: 'Norte', nivelConflicto: null }),
      caso({ alcance: 'Norte', nivelConflicto: 'Crisis social' }),
    ]);

    expect(norte).toMatchObject({
      alcance: 'Norte',
      latentes: 2,
      manifiestos: 1,
      total: 3,
    });
    expect(norte?.proporcionLatente).toBeCloseTo(2 / 3, 6);
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
      latentes: 2,
      manifiestos: 1,
      sinNivel: 1,
    });
    expect(fila?.proporcionLatente).toBeCloseTo(2 / 3, 6);
  });

  it('marca proporción 1 cuando todos los casos de la región son latentes', () => {
    const [fila] = filasPorRegion([caso({ nivelConflicto: null })]);
    expect(fila?.proporcionLatente).toBe(1);
  });
});

describe('bandasPorAlcance', () => {
  it('expone la situación en la banda y en cada región', () => {
    const [banda] = bandasPorAlcance([
      caso({ alcance: 'Norte', region: 'Piura', nivelConflicto: 'Diferencia' }),
      caso({ alcance: 'Norte', region: 'Piura', nivelConflicto: 'Crisis social' }),
      caso({ alcance: 'Norte', region: null, nivelConflicto: null }),
    ]);

    expect(banda).toMatchObject({
      alcance: 'Norte',
      latentes: 2,
      manifiestos: 1,
      total: 3,
      sinRegion: 1,
    });
    expect(banda?.regiones[0]).toMatchObject({
      region: 'Piura',
      latentes: 1,
      manifiestos: 1,
      total: 2,
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
  it('cuenta por ubigeo y no por nombre, con su situación', () => {
    const conteo = casosPorDistritoUbigeo([
      caso({ id: 'a', distrito: 'Santa Rosa', distritoUbigeo: '150101' }),
      caso({
        id: 'b',
        distrito: 'Santa Rosa',
        distritoUbigeo: '060101',
        nivelConflicto: 'Crisis social',
      }),
      caso({ id: 'c', distrito: 'Santa Rosa', distritoUbigeo: '150101', nivelConflicto: null }),
    ]);

    expect(conteo.get('150101')).toMatchObject({
      latentes: 2,
      manifiestos: 0,
      total: 2,
      proporcionLatente: 1,
    });
    expect(conteo.get('060101')).toMatchObject({
      latentes: 0,
      manifiestos: 1,
      total: 1,
      proporcionLatente: 0,
    });
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
