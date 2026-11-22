import { ALCANCES } from '../../dominio/mapeo';
import type { Alcance, Caso } from '../../dominio/modelos';

/**
 * Agregados del panorama territorial.
 *
 * Todo se calcula sobre las filas reales de `GET /api/v1/cases`. La API no
 * publica un catálogo de regiones con conteos ni un endpoint agregado, así que
 * la dimensión territorial se resuelve aquí, sin estimar ni completar huecos.
 */

export type ConteoAlcance = {
  alcance: Alcance;
  total: number;
};

export type BandaAmbito = {
  alcance: Alcance;
  total: number;
  /** Porcentaje sobre el ámbito con más casos (0–100), sólo para la barra. */
  proporcion: number;
  regiones: { region: string; total: number }[];
  /** Casos del ámbito sin región principal: no se suman a ninguna región. */
  sinRegion: number;
};

export type FilaRegion = {
  region: string;
  total: number;
  riesgoAlto: number;
  /** Ámbitos presentes en los casos de la región, en orden de catálogo. */
  ambitos: Alcance[];
};

const ORDEN_ALCANCE = new Map<Alcance, number>(
  ALCANCES.map((alcance, indice) => [alcance, indice] as const),
);

/** Clave de comparación de nombres de región: sin acentos ni mayúsculas. */
export function normalizarRegion(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Región principal del caso, o `null` cuando la fila no trae una. */
export function regionDe(caso: Caso): string | null {
  const region = caso.region?.trim() ?? '';
  return region ? region : null;
}

function ordenarAlcances(valores: Iterable<Alcance>): Alcance[] {
  return [...new Set(valores)].sort(
    (a, b) => (ORDEN_ALCANCE.get(a) ?? 99) - (ORDEN_ALCANCE.get(b) ?? 99),
  );
}

function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ámbitos presentes en el conjunto, en el orden del catálogo. */
export function conteosPorAlcance(casos: readonly Caso[]): ConteoAlcance[] {
  const conteo = new Map<Alcance, number>();
  for (const caso of casos) {
    conteo.set(caso.alcance, (conteo.get(caso.alcance) ?? 0) + 1);
  }

  return ordenarAlcances(conteo.keys()).map((alcance) => ({
    alcance,
    total: conteo.get(alcance) ?? 0,
  }));
}

/**
 * Bandas del esquema territorial. Se ordenan por conteo, no por geografía, y la
 * barra es proporcional al ámbito con más casos. Las regiones sin casos no
 * aparecen: no se inventan territorios.
 */
export function bandasPorAlcance(casos: readonly Caso[]): BandaAmbito[] {
  const bandas = new Map<
    Alcance,
    { total: number; regiones: Map<string, { region: string; total: number }>; sinRegion: number }
  >();

  for (const caso of casos) {
    let banda = bandas.get(caso.alcance);
    if (!banda) {
      banda = { total: 0, regiones: new Map(), sinRegion: 0 };
      bandas.set(caso.alcance, banda);
    }

    banda.total += 1;

    const region = regionDe(caso);
    if (!region) {
      banda.sinRegion += 1;
      continue;
    }

    const clave = normalizarRegion(region);
    const previa = banda.regiones.get(clave);
    if (previa) previa.total += 1;
    else banda.regiones.set(clave, { region, total: 1 });
  }

  const maximo = Math.max(0, ...[...bandas.values()].map((banda) => banda.total));

  return [...bandas.entries()]
    .map(([alcance, banda]) => ({
      alcance,
      total: banda.total,
      proporcion: maximo > 0 ? Math.round((banda.total / maximo) * 100) : 0,
      regiones: [...banda.regiones.values()].sort(
        (a, b) => b.total - a.total || compararTexto(a.region, b.region),
      ),
      sinRegion: banda.sinRegion,
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        (ORDEN_ALCANCE.get(a.alcance) ?? 99) - (ORDEN_ALCANCE.get(b.alcance) ?? 99),
    );
}

/** Filas de la tabla: una por región con casos, sin incluir «Sin región». */
export function filasPorRegion(casos: readonly Caso[]): FilaRegion[] {
  const filas = new Map<
    string,
    { region: string; total: number; riesgoAlto: number; ambitos: Set<Alcance> }
  >();

  for (const caso of casos) {
    const region = regionDe(caso);
    if (!region) continue;

    const clave = normalizarRegion(region);
    let fila = filas.get(clave);
    if (!fila) {
      fila = { region, total: 0, riesgoAlto: 0, ambitos: new Set() };
      filas.set(clave, fila);
    }

    fila.total += 1;
    if (caso.riesgo === 'Alto') fila.riesgoAlto += 1;
    fila.ambitos.add(caso.alcance);
  }

  return [...filas.values()]
    .map((fila) => ({
      region: fila.region,
      total: fila.total,
      riesgoAlto: fila.riesgoAlto,
      ambitos: ordenarAlcances(fila.ambitos),
    }))
    .sort((a, b) => b.total - a.total || compararTexto(a.region, b.region));
}

/** Ámbitos de los casos sin región, para la columna «Ámbito» de esa fila. */
export function ambitosSinRegion(casos: readonly Caso[]): Alcance[] {
  const ambitos = new Set<Alcance>();
  for (const caso of casos) {
    if (!regionDe(caso)) ambitos.add(caso.alcance);
  }
  return ordenarAlcances(ambitos);
}

export function contarRegiones(casos: readonly Caso[]): number {
  const regiones = new Set<string>();
  for (const caso of casos) {
    const region = regionDe(caso);
    if (region) regiones.add(normalizarRegion(region));
  }
  return regiones.size;
}

export function contarSinRegion(casos: readonly Caso[]): number {
  return casos.filter((caso) => regionDe(caso) === null).length;
}

export function contarRiesgoAltoSinRegion(casos: readonly Caso[]): number {
  return casos.filter((caso) => regionDe(caso) === null && caso.riesgo === 'Alto').length;
}

export function contarRiesgoAlto(casos: readonly Caso[]): number {
  return casos.filter((caso) => caso.riesgo === 'Alto').length;
}
