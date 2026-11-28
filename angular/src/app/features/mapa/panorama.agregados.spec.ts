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
  colorChoropleta,
  conteosPorAlcance,
  conteosPorSituacion,
  distribuirPorRegion,
  distribuirPorSectorista,
  ESCALA_COROPLETA_ALERTAS,
  ESCALA_COROPLETA_MANIFIESTOS,
  ESCALA_MANIFIESTO,
  filasPorRegion,
  indicePoblacionPorRegion,
  intensidadMedida,
  medidasDeCasos,
  poblacionDeRegion,
  proporcionDe,
  proporcionLatenteDe,
  situacionDe,
  tasaPor100k,
  tramoChoropleta,
  valorMedida,
  type MedidaRegion,
  type SectoristaMedidas,
} from './panorama.agregados';

function caso(overrides: Partial<Caso> = {}): Caso {
  return {
    id: 'caso-1',
    codigo: 'CS-PA-INF-2026-01',
    titulo: 'Caso de prueba',
    resumen: null,
    descripcionRiesgo: null,
    demandas: 0,
    avance: null,
    actualizado: null,
    inicio: '2026-01-01',
    region: 'Piura',
    distrito: null,
    distritoUbigeo: null,
    estado: 'Abierto',
    riesgo: 'Medio',
    prioridad: 'Medio',
    alcance: 'Norte',
    nivelConflicto: 'Controversia',
    naturaleza: null,
    etapa: 'Prevención estratégica',
    tematica: null,
    subsector: null,
    unidadResponsable: null,
    origen: 'Manual',
    clasificacion: 1,
    priorizado: false,
    anulado: false,
    anuladoEn: null,
    motivoAnulacion: null,
    anuladoPor: null,
    anuladoPorNombre: null,
    anulacionId: null,
    enlaceAnalisis: null,
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

/* -------------------------------------------------------------------------- */
/* Distribución por sectorista y coropléticos                                  */
/* -------------------------------------------------------------------------- */

function medida(overrides: Partial<MedidaRegion> = {}): MedidaRegion {
  return {
    region: 'Piura',
    ubigeo: '20',
    casos: 4,
    manifiestos: 1,
    riesgoAlto: 2,
    alertas90d: 10,
    alertasRiesgoAlto: 3,
    ...overrides,
  };
}

describe('proporcionDe', () => {
  it('divide parte entre total en 0..1', () => {
    expect(proporcionDe(2, 8)).toBe(0.25);
    expect(proporcionDe(8, 8)).toBe(1);
  });

  it('devuelve 0 con denominador ausente o no finito', () => {
    expect(proporcionDe(3, 0)).toBe(0);
    expect(proporcionDe(3, -1)).toBe(0);
    expect(proporcionDe(Number.NaN, 10)).toBe(0);
  });

  it('recorta valores fuera del rango', () => {
    expect(proporcionDe(12, 10)).toBe(1);
    expect(proporcionDe(-2, 10)).toBe(0);
  });
});

describe('valorMedida', () => {
  it('lee el numerador correspondiente en el eje de casos', () => {
    const fila = medida();
    expect(valorMedida(fila, 'casos', 'total')).toBe(4);
    expect(valorMedida(fila, 'casos', 'manifiestos')).toBe(1);
    expect(valorMedida(fila, 'casos', 'riesgoAlto')).toBe(2);
  });

  it('lee el numerador correspondiente en el eje de alertas', () => {
    const fila = medida();
    expect(valorMedida(fila, 'alertas', 'total')).toBe(10);
    expect(valorMedida(fila, 'alertas', 'riesgoAlto')).toBe(3);
  });
});

describe('intensidadMedida', () => {
  it('usa la proporción interna de la región para manifiestos y riesgo', () => {
    const fila = medida({ casos: 10, manifiestos: 4, riesgoAlto: 3 });
    expect(intensidadMedida(fila, 'casos', 'manifiestos', 0)).toBe(0.4);
    expect(intensidadMedida(fila, 'casos', 'riesgoAlto', 0)).toBe(0.3);
  });

  it('normaliza los volúmenes contra el máximo recibido', () => {
    expect(intensidadMedida(medida({ casos: 5 }), 'casos', 'total', 10)).toBe(0.5);
    expect(intensidadMedida(medida({ alertas90d: 4 }), 'alertas', 'total', 8)).toBe(0.5);
  });

  it('usa la proporción de alertas con riesgo alto sobre las alertas', () => {
    expect(
      intensidadMedida(
        medida({ alertas90d: 10, alertasRiesgoAlto: 2 }),
        'alertas',
        'riesgoAlto',
        0,
      ),
    ).toBe(0.2);
  });

  it('devuelve null cuando el denominador de la región no existe', () => {
    expect(intensidadMedida(medida({ casos: 0 }), 'casos', 'manifiestos', 0)).toBeNull();
    expect(intensidadMedida(medida({ alertas90d: 0 }), 'alertas', 'riesgoAlto', 0)).toBeNull();
    expect(intensidadMedida(medida({ casos: 0 }), 'casos', 'total', 0)).toBeNull();
  });
});

describe('medidasDeCasos', () => {
  it('traslada los conteos de la región y deja las alertas en cero', () => {
    const [fila] = medidasDeCasos([
      {
        region: 'Piura',
        latentes: 2,
        manifiestos: 1,
        total: 3,
        proporcionLatente: 2 / 3,
        sinNivel: 0,
        riesgoAlto: 2,
        ambitos: ['Norte'],
      },
    ]);

    expect(fila).toEqual({
      region: 'Piura',
      ubigeo: null,
      casos: 3,
      manifiestos: 1,
      riesgoAlto: 2,
      alertas90d: 0,
      alertasRiesgoAlto: 0,
    });
  });
});

describe('distribuirPorSectorista', () => {
  const sectoristas: SectoristaMedidas[] = [
    {
      id: 's1',
      nombre: 'Ana',
      regiones: [medida({ region: 'Piura', casos: 6, manifiestos: 3 })],
    },
    {
      id: 's2',
      nombre: 'Beto',
      regiones: [
        medida({ region: 'Lima', casos: 2, manifiestos: 1 }),
        medida({ region: 'Ica', casos: 2, manifiestos: 0 }),
      ],
    },
  ];

  it('comparte el total de la medida y ordena de mayor a menor', () => {
    const filas = distribuirPorSectorista(sectoristas, 'casos', 'total');

    expect(filas.map((fila) => fila.titulo)).toEqual(['Ana', 'Beto']);
    expect(filas.map((fila) => fila.valor)).toEqual([6, 4]);
    expect(filas.map((fila) => fila.proporcion)).toEqual([60, 40]);
  });

  it('respeta la medida elegida y ordena los chips de región', () => {
    const filas = distribuirPorSectorista(sectoristas, 'casos', 'manifiestos');

    expect(filas[0]).toMatchObject({ titulo: 'Ana', valor: 3, proporcion: 75 });
    expect(filas[1]?.regiones).toEqual([
      { region: 'Lima', valor: 1 },
      { region: 'Ica', valor: 0 },
    ]);
  });

  it('declara proporción 0 cuando no hay medida', () => {
    const vacio = distribuirPorSectorista(
      [{ id: 's', nombre: 'Sin datos', regiones: [medida({ alertas90d: 0 })] }],
      'alertas',
      'total',
    );
    expect(vacio[0]?.proporcion).toBe(0);
  });
});

describe('distribuirPorRegion', () => {
  it('agrupa por región cuando sólo hay casos locales', () => {
    const filas = distribuirPorRegion(
      filasPorRegion([caso({ region: 'Piura' }), caso({ region: 'Lima' })]),
      'total',
    );

    expect(filas.map((fila) => fila.titulo)).toEqual(['Lima', 'Piura']);
    expect(filas.map((fila) => fila.proporcion)).toEqual([50, 50]);
    expect(filas[0]?.regiones).toEqual([{ region: 'Lima', valor: 1 }]);
  });
});

describe('tramoChoropleta', () => {
  it('reparte la intensidad en cinco tramos', () => {
    expect(tramoChoropleta(0)).toBe(0);
    expect(tramoChoropleta(0.19)).toBe(0);
    expect(tramoChoropleta(0.2)).toBe(0);
    expect(tramoChoropleta(0.21)).toBe(1);
    expect(tramoChoropleta(0.5)).toBe(2);
    expect(tramoChoropleta(1)).toBe(4);
  });

  it('responde -1 cuando no hay dato', () => {
    expect(tramoChoropleta(null)).toBe(-1);
    expect(tramoChoropleta(Number.NaN)).toBe(-1);
  });
});

describe('colorChoropleta', () => {
  it('toma el color del tramo de la rampa', () => {
    expect(colorChoropleta(0, ESCALA_COROPLETA_MANIFIESTOS)).toBe(ESCALA_COROPLETA_MANIFIESTOS[0]);
    expect(colorChoropleta(1, ESCALA_COROPLETA_ALERTAS)).toBe(
      ESCALA_COROPLETA_ALERTAS[ESCALA_COROPLETA_ALERTAS.length - 1],
    );
  });

  it('deja sin color el polígono sin dato', () => {
    expect(colorChoropleta(null, ESCALA_COROPLETA_ALERTAS)).toBeNull();
  });

  it('declara cinco pasos en cada rampa', () => {
    expect(ESCALA_COROPLETA_ALERTAS).toHaveLength(5);
    expect(ESCALA_COROPLETA_MANIFIESTOS).toHaveLength(5);
  });
});
