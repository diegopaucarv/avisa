import type { PoblacionRegion } from '../../core/territorio/territorio.tipos';
import { ALCANCES } from '../../dominio/mapeo';
import type { Alcance, Caso, NivelConflicto } from '../../dominio/modelos';

/**
 * Agregados del panorama territorial.
 *
 * Todo se calcula sobre las filas reales de `GET /api/v1/cases`. La API no
 * publica un catálogo de regiones con conteos ni un endpoint agregado, así que
 * la dimensión territorial se resuelve aquí, sin estimar ni completar huecos.
 */

export type ConteoAlcance = {
  alcance: Alcance;
  latentes: number;
  manifiestos: number;
  total: number;
  /** Casos latentes sobre el total del agregado (0..1). */
  proporcionLatente: number;
};

/** Región dentro de una banda de ámbito: mismo contrato que cualquier agregado. */
export type FilaBandaRegion = {
  region: string;
  latentes: number;
  manifiestos: number;
  total: number;
  proporcionLatente: number;
};

export type BandaAmbito = {
  alcance: Alcance;
  latentes: number;
  manifiestos: number;
  total: number;
  proporcionLatente: number;
  /** Porcentaje sobre el ámbito con más casos (0–100), sólo para la barra. */
  proporcion: number;
  regiones: FilaBandaRegion[];
  /** Casos del ámbito sin región principal: no se suman a ninguna región. */
  sinRegion: number;
};

export type FilaRegion = {
  region: string;
  latentes: number;
  manifiestos: number;
  total: number;
  /** Casos latentes sobre el total de la región (0..1). */
  proporcionLatente: number;
  /** Casos sin nivel declarado dentro de la región: cuentan como latentes. */
  sinNivel: number;
  riesgoAlto: number;
  /** Ámbitos presentes en los casos de la región, en orden de catálogo. */
  ambitos: Alcance[];
};

/**
 * Situación de conflictividad de la Guía §7.5.1. No es un estado del caso ni un
 * grado derivado: agrupa los cuatro niveles de `core.cat_niveles_conflicto`.
 */
export type SituacionConflicto = 'latente' | 'manifiesto';

/**
 * Manifiesto = Conflicto social + Crisis social.
 *
 * OVERRIDE (decisión expresa del usuario, 2026-11-24): **latente es todo lo
 * demás, incluidos los casos sin nivel declarado**. La regla anterior dejaba
 * esos casos fuera de las dos situaciones, de modo que latente + manifiesto no
 * sumaba el total y la proporción no cerraba. Aquí todo caso cae en una de las
 * dos situaciones; el conteo de «sin nivel» se conserva como declaración
 * (`sinNivel`), no como tercera situación.
 */
export function situacionDe(nivel: NivelConflicto | null | undefined): SituacionConflicto {
  switch (nivel) {
    case 'Conflicto social':
    case 'Crisis social':
      return 'manifiesto';
    default:
      return 'latente';
  }
}

/**
 * Proporción latente de un agregado, en 0..1.
 *
 * Con `total` 0 no hay proporción que informar: devuelve 0 y la interfaz lo
 * declara («—») en vez de inventar un 50 % o un 100 %.
 */
export function proporcionLatenteDe(latentes: number, total: number): number {
  if (!Number.isFinite(latentes) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, latentes / total));
}

/**
 * Escala secuencial del color de los círculos del mapa.
 *
 * El color NO es el nivel de conflicto de un caso: representa la composición
 * del agregado, de verde (todo latente) a rojo (todo manifiesto). Los tramos se
 * declaran en la leyenda y se cortan por la proporción manifiesta
 * (`1 - proporcionLatente`).
 */
export const ESCALA_MANIFIESTO: readonly {
  /** Etiqueta del tramo, en % manifiesto. */
  etiqueta: string;
  hasta: number;
  /** Relleno del círculo (tokens del brief: verde → ámbar → rojo). */
  relleno: string;
  /** Borde del círculo, un tono más oscuro que el relleno. */
  borde: string;
}[] = [
  { etiqueta: '0–20 %', hasta: 0.2, relleno: '#34785b', borde: '#245c43' },
  { etiqueta: '20–40 %', hasta: 0.4, relleno: '#6f9464', borde: '#527047' },
  { etiqueta: '40–60 %', hasta: 0.6, relleno: '#b98a2a', borde: '#8a6518' },
  { etiqueta: '60–80 %', hasta: 0.8, relleno: '#c4703f', borde: '#97502b' },
  { etiqueta: '80–100 %', hasta: 1, relleno: '#ad4d46', borde: '#7f342f' },
];

/** Tramo de `ESCALA_MANIFIESTO` para una proporción latente (0..1). */
export function claseManifiesto(proporcionLatente: number): number {
  const latente = Number.isFinite(proporcionLatente)
    ? Math.min(1, Math.max(0, proporcionLatente))
    : 0;
  const manifiesto = 1 - latente;
  for (let indice = 0; indice < ESCALA_MANIFIESTO.length; indice += 1) {
    if (manifiesto <= (ESCALA_MANIFIESTO[indice]?.hasta ?? 1)) return indice;
  }
  return ESCALA_MANIFIESTO.length - 1;
}

export type ConteoSituacion = {
  latentes: number;
  manifiestos: number;
  total: number;
  /** Casos latentes sobre el total (0..1); 0 cuando no hay casos. */
  proporcionLatente: number;
  /**
   * Casos sin nivel declarado: subconjunto de `latentes`, no una tercera
   * situación. Se declara para que el hueco de dato siga siendo visible.
   */
  sinNivel: number;
  /**
   * Alias singulares de `latentes`/`manifiestos`. Los consume
   * `features/clima-social`, que queda fuera de este alcance; mismo valor, para
   * no romper su compilación.
   */
  latente: number;
  manifiesto: number;
};

/** Conteo de latentes y manifiestos; todo caso cae en una de las dos. */
export function conteosPorSituacion(casos: readonly Caso[]): ConteoSituacion {
  let latentes = 0;
  let manifiestos = 0;
  let sinNivel = 0;

  for (const caso of casos) {
    if (situacionDe(caso.nivelConflicto) === 'manifiesto') manifiestos += 1;
    else latentes += 1;
    if (!caso.nivelConflicto) sinNivel += 1;
  }

  const total = latentes + manifiestos;

  return {
    latentes,
    manifiestos,
    total,
    proporcionLatente: proporcionLatenteDe(latentes, total),
    sinNivel,
    latente: latentes,
    manifiesto: manifiestos,
  };
}

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
  const conteo = new Map<Alcance, { latentes: number; manifiestos: number; total: number }>();
  for (const caso of casos) {
    const actual = conteo.get(caso.alcance) ?? { latentes: 0, manifiestos: 0, total: 0 };
    if (situacionDe(caso.nivelConflicto) === 'manifiesto') actual.manifiestos += 1;
    else actual.latentes += 1;
    actual.total += 1;
    conteo.set(caso.alcance, actual);
  }

  return ordenarAlcances(conteo.keys()).map((alcance) => {
    const actual = conteo.get(alcance) ?? { latentes: 0, manifiestos: 0, total: 0 };
    return {
      alcance,
      latentes: actual.latentes,
      manifiestos: actual.manifiestos,
      total: actual.total,
      proporcionLatente: proporcionLatenteDe(actual.latentes, actual.total),
    };
  });
}

/**
 * Bandas del esquema territorial. Se ordenan por conteo, no por geografía, y la
 * barra es proporcional al ámbito con más casos. Las regiones sin casos no
 * aparecen: no se inventan territorios.
 */
export function bandasPorAlcance(casos: readonly Caso[]): BandaAmbito[] {
  const bandas = new Map<
    Alcance,
    {
      latentes: number;
      manifiestos: number;
      total: number;
      regiones: Map<string, FilaBandaRegion>;
      sinRegion: number;
    }
  >();

  for (const caso of casos) {
    let banda = bandas.get(caso.alcance);
    if (!banda) {
      banda = { latentes: 0, manifiestos: 0, total: 0, regiones: new Map(), sinRegion: 0 };
      bandas.set(caso.alcance, banda);
    }

    banda.total += 1;
    const manifiesto = situacionDe(caso.nivelConflicto) === 'manifiesto';
    if (manifiesto) banda.manifiestos += 1;
    else banda.latentes += 1;

    const region = regionDe(caso);
    if (!region) {
      banda.sinRegion += 1;
      continue;
    }

    const clave = normalizarRegion(region);
    const previa = banda.regiones.get(clave);
    if (previa) {
      previa.total += 1;
      if (manifiesto) previa.manifiestos += 1;
      else previa.latentes += 1;
      previa.proporcionLatente = proporcionLatenteDe(previa.latentes, previa.total);
    } else {
      banda.regiones.set(clave, {
        region,
        latentes: manifiesto ? 0 : 1,
        manifiestos: manifiesto ? 1 : 0,
        total: 1,
        proporcionLatente: proporcionLatenteDe(manifiesto ? 0 : 1, 1),
      });
    }
  }

  const maximo = Math.max(0, ...[...bandas.values()].map((banda) => banda.total));

  return [...bandas.entries()]
    .map(([alcance, banda]) => ({
      alcance,
      latentes: banda.latentes,
      manifiestos: banda.manifiestos,
      total: banda.total,
      proporcionLatente: proporcionLatenteDe(banda.latentes, banda.total),
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
    {
      region: string;
      latentes: number;
      manifiestos: number;
      total: number;
      sinNivel: number;
      riesgoAlto: number;
      ambitos: Set<Alcance>;
    }
  >();

  for (const caso of casos) {
    const region = regionDe(caso);
    if (!region) continue;

    const clave = normalizarRegion(region);
    let fila = filas.get(clave);
    if (!fila) {
      fila = {
        region,
        latentes: 0,
        manifiestos: 0,
        total: 0,
        sinNivel: 0,
        riesgoAlto: 0,
        ambitos: new Set(),
      };
      filas.set(clave, fila);
    }

    fila.total += 1;
    if (situacionDe(caso.nivelConflicto) === 'manifiesto') fila.manifiestos += 1;
    else fila.latentes += 1;
    if (!caso.nivelConflicto) fila.sinNivel += 1;
    if (caso.riesgo === 'Alto') fila.riesgoAlto += 1;
    fila.ambitos.add(caso.alcance);
  }

  return [...filas.values()]
    .map((fila) => ({
      region: fila.region,
      latentes: fila.latentes,
      manifiestos: fila.manifiestos,
      total: fila.total,
      proporcionLatente: proporcionLatenteDe(fila.latentes, fila.total),
      sinNivel: fila.sinNivel,
      riesgoAlto: fila.riesgoAlto,
      ambitos: ordenarAlcances(fila.ambitos),
    }))
    .sort((a, b) => b.total - a.total || compararTexto(a.region, b.region));
}

/**
 * Casos del recorte del cajón «Ver casos».
 *
 * Con una región aplicada se conservan sus casos y se comparan los nombres sin
 * acentos ni mayúsculas; los casos sin región nunca se atribuyen a un nombre de
 * región. Sin región aplicada se devuelve el conjunto visible íntegro, en el
 * mismo orden recibido (el panel ya los ordena por gravedad y prioridad).
 */
export function casosDeRegion(casos: readonly Caso[], region: string | null): Caso[] {
  if (!region) return [...casos];

  const clave = normalizarRegion(region);
  return casos.filter((caso) => {
    const propia = regionDe(caso);
    return propia !== null && normalizarRegion(propia) === clave;
  });
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

/* -------------------------------------------------------------------------- */
/* Capa distrital · items 129 y 131 (2026-11-23)                              */
/* -------------------------------------------------------------------------- */

/**
 * Escala de la coropleta por número de casos abiertos en el distrito.
 *
 * Los cortes son fijos y se declaran en la leyenda porque casi todos los
 * distritos de la capa no tienen casos: una escala por cuantiles pintaría el
 * mapa de un solo tono y escondería la concentración real. El último tramo es
 * abierto (`hasta: null`) y no tiene tope.
 */
export const ESCALA_COROPLETA: readonly {
  etiqueta: string;
  desde: number;
  hasta: number | null;
}[] = [
  { etiqueta: 'Sin casos', desde: 0, hasta: 0 },
  { etiqueta: '1 caso', desde: 1, hasta: 1 },
  { etiqueta: '2 casos', desde: 2, hasta: 2 },
  { etiqueta: '3–4 casos', desde: 3, hasta: 4 },
  { etiqueta: '5 o más', desde: 5, hasta: null },
];

/** Índice del tramo de `ESCALA_COROPLETA`; un negativo cae en «Sin casos». */
export function claseCoropleta(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  for (let indice = ESCALA_COROPLETA.length - 1; indice > 0; indice -= 1) {
    if (total >= ESCALA_COROPLETA[indice]!.desde) return indice;
  }
  return 0;
}

/**
 * Casos del mapa por ubigeo de distrito.
 *
 * La llave es `distritoUbigeo`, nunca el nombre: la capa trae quince «Santa
 * Rosa» y el nombre no distingue provincia. Los casos sin ubigeo no se
 * atribuyen a ningún polígono y se declaran aparte con `casosSinDistrito`.
 * Cada distrito expone latentes, manifiestos, total y `proporcionLatente`
 * (0..1), igual que el resto de agregados.
 */
export type ConteoDistrito = {
  latentes: number;
  manifiestos: number;
  total: number;
  proporcionLatente: number;
};

export function casosPorDistritoUbigeo(casos: readonly Caso[]): Map<string, ConteoDistrito> {
  const conteo = new Map<string, ConteoDistrito>();
  for (const caso of casos) {
    const ubigeo = caso.distritoUbigeo?.trim();
    if (!ubigeo) continue;

    const actual = conteo.get(ubigeo) ?? {
      latentes: 0,
      manifiestos: 0,
      total: 0,
      proporcionLatente: 0,
    };
    if (situacionDe(caso.nivelConflicto) === 'manifiesto') actual.manifiestos += 1;
    else actual.latentes += 1;
    actual.total += 1;
    actual.proporcionLatente = proporcionLatenteDe(actual.latentes, actual.total);
    conteo.set(ubigeo, actual);
  }
  return conteo;
}

/** Casos visibles que no declaran distrito principal: no se pintan en el mapa. */
export function casosSinDistrito(casos: readonly Caso[]): number {
  return casos.filter((caso) => !caso.distritoUbigeo?.trim()).length;
}

/**
 * Tasa por 100 000 habitantes.
 *
 * Devuelve `null` cuando no hay denominador utilizable: la interfaz muestra
 * «—» en vez de una cifra calculada sobre una población ausente o cero. Nunca
 * se usa para el nivel de riesgo ni para la prioridad (Guía §7.5.2).
 * Se redondea a una décima, que es la precisión legible de la tabla.
 */
export function tasaPor100k(casos: number, poblacion: number | null): number | null {
  if (poblacion === null || !Number.isFinite(poblacion) || poblacion <= 0) return null;
  if (!Number.isFinite(casos) || casos < 0) return null;
  return Math.round((casos / poblacion) * 100_000 * 10) / 10;
}

/**
 * Índice de denominadores por nombre de región normalizado.
 *
 * La capa nombra las regiones en mayúsculas y sin tildes (`ANCASH`) mientras
 * las filas del panorama usan el nombre de `core.regiones` (`Áncash`); se
 * cruzan con `normalizarRegion`. Si una región no está en el índice, la tabla
 * declara el hueco en vez de estimar la población.
 */
export function indicePoblacionPorRegion(
  items: readonly PoblacionRegion[],
): Map<string, PoblacionRegion> {
  const indice = new Map<string, PoblacionRegion>();
  for (const item of items) {
    const clave = normalizarRegion(item.nombre);
    if (!indice.has(clave)) indice.set(clave, item);
  }
  return indice;
}

/** Denominador de una región del panorama; `null` si la capa no la trae. */
export function poblacionDeRegion(
  region: string,
  indice: ReadonlyMap<string, PoblacionRegion>,
): number | null {
  return indice.get(normalizarRegion(region))?.poblacion ?? null;
}

/* -------------------------------------------------------------------------- */
/* Panorama · distribución por sectorista y coropléticos (2026-11-28)          */
/* -------------------------------------------------------------------------- */

/**
 * Eje de la distribución: los casos abiertos o las alertas del último trimestre.
 *
 * El gráfico por sectorista y el coroplético del mapa comparten esta decisión,
 * de modo que la barra y el polígono siempre miden lo mismo.
 */
export type VariableDistribucion = 'casos' | 'alertas';

/** Medidas disponibles por sectorista dentro del eje de casos. */
export type MetricaCasos = 'total' | 'manifiestos' | 'riesgoAlto';

/** Medidas disponibles por sectorista dentro del eje de alertas. */
export type MetricaAlertas = 'total' | 'riesgoAlto';

export type MetricaDistribucion = MetricaCasos | MetricaAlertas;

/**
 * Medidas de una región tal como las entrega `GET /api/v1/panorama/indicadores`.
 *
 * `casos`, `manifiestos` y `riesgoAlto` ya son calculables con las filas de
 * `/v1/cases`; `alertas90d` y `alertasRiesgoAlto` sólo llegan del endpoint de
 * indicadores. La vista une ambas fuentes por `ubigeo` (o nombre normalizado)
 * sin inventar el dato que falte.
 */
export type MedidaRegion = {
  region: string;
  ubigeo: string | null;
  casos: number;
  manifiestos: number;
  riesgoAlto: number;
  alertas90d: number;
  alertasRiesgoAlto: number;
};

/** Un sectorista con las medidas de sus regiones asignadas. */
export type SectoristaMedidas = {
  id: string;
  nombre: string;
  regiones: readonly MedidaRegion[];
};

/** Fila del gráfico de distribución: una barra y los chips de sus regiones. */
export type FilaDistribucion = {
  clave: string;
  titulo: string;
  valor: number;
  /** Participación sobre el total de la medida (0–100). */
  proporcion: number;
  /** Regiones del grupo con su valor en la medida elegida. */
  regiones: readonly { region: string; valor: number }[];
};

/** Proporción `parte / total` en 0..1; 0 cuando el denominador no sirve. */
export function proporcionDe(parte: number, total: number): number {
  if (!Number.isFinite(parte) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(1, Math.max(0, parte / total));
}

/** Numerador de la medida elegida sobre una región. */
export function valorMedida(
  medida: MedidaRegion,
  variable: VariableDistribucion,
  metrica: MetricaDistribucion,
): number {
  if (variable === 'alertas') {
    return metrica === 'riesgoAlto' ? medida.alertasRiesgoAlto : medida.alertas90d;
  }
  if (metrica === 'manifiestos') return medida.manifiestos;
  if (metrica === 'riesgoAlto') return medida.riesgoAlto;
  return medida.casos;
}

/**
 * Intensidad 0..1 de una región para el coroplético.
 *
 * Las medidas de proporción (manifiestos, riesgo alto sobre casos, alertas con
 * riesgo alto sobre alertas) se leen dentro de la región; las de volumen
 * (casos y alertas totales) se normalizan contra la región con más valor, que es
 * el `maximo` que calcula el mapa. `null` significa «sin denominador»: el
 * polígono no se rellena en vez de pintarse como cero.
 */
export function intensidadMedida(
  medida: MedidaRegion,
  variable: VariableDistribucion,
  metrica: MetricaDistribucion,
  maximo: number,
): number | null {
  if (variable === 'casos') {
    if (metrica === 'manifiestos') {
      return medida.casos > 0 ? proporcionDe(medida.manifiestos, medida.casos) : null;
    }
    if (metrica === 'riesgoAlto') {
      return medida.casos > 0 ? proporcionDe(medida.riesgoAlto, medida.casos) : null;
    }
    return maximo > 0 ? proporcionDe(medida.casos, maximo) : null;
  }

  if (metrica === 'riesgoAlto') {
    return medida.alertas90d > 0 ? proporcionDe(medida.alertasRiesgoAlto, medida.alertas90d) : null;
  }
  return maximo > 0 ? proporcionDe(medida.alertas90d, maximo) : null;
}

/**
 * Medidas por región derivadas de los casos visibles.
 *
 * El ubigeo se resuelve al cruzar con la capa de regiones (o su centroide); aquí
 * queda nulo porque este módulo es puro y no conoce la geografía. Las alertas no
 * se pueden derivar de los casos: quedan en 0 y la vista no las usa como si
 * fueran reales.
 */
export function medidasDeCasos(filas: readonly FilaRegion[]): MedidaRegion[] {
  return filas.map((fila) => ({
    region: fila.region,
    ubigeo: null,
    casos: fila.total,
    manifiestos: fila.manifiestos,
    riesgoAlto: fila.riesgoAlto,
    alertas90d: 0,
    alertasRiesgoAlto: 0,
  }));
}

function filaDeGrupo(
  clave: string,
  titulo: string,
  medidas: readonly MedidaRegion[],
  variable: VariableDistribucion,
  metrica: MetricaDistribucion,
  totalGlobal: number,
): FilaDistribucion {
  const valor = medidas.reduce(
    (acumulado, medida) => acumulado + valorMedida(medida, variable, metrica),
    0,
  );
  const regiones = medidas
    .map((medida) => ({
      region: medida.region,
      valor: valorMedida(medida, variable, metrica),
    }))
    .sort((a, b) => b.valor - a.valor || compararTexto(a.region, b.region));

  return {
    clave,
    titulo,
    valor,
    proporcion: Math.round(totalGlobal > 0 ? (valor / totalGlobal) * 100 : 0),
    regiones,
  };
}

/**
 * Distribución por sectorista: una barra por responsable con los chips de sus
 * regiones. La barra representa la participación en el total de la medida, así
 * que la suma de todas las barras cierra en 100 % (o en 0 si no hay datos).
 */
export function distribuirPorSectorista(
  sectoristas: readonly SectoristaMedidas[],
  variable: VariableDistribucion,
  metrica: MetricaDistribucion,
): FilaDistribucion[] {
  const totalGlobal = sectoristas.reduce(
    (acumulado, sectorista) =>
      acumulado +
      sectorista.regiones.reduce(
        (suma, medida) => suma + valorMedida(medida, variable, metrica),
        0,
      ),
    0,
  );

  return sectoristas
    .map((sectorista) =>
      filaDeGrupo(
        sectorista.id,
        sectorista.nombre,
        sectorista.regiones,
        variable,
        metrica,
        totalGlobal,
      ),
    )
    .sort((a, b) => b.valor - a.valor || compararTexto(a.titulo, b.titulo));
}

/**
 * Distribución por región: reemplazo del gráfico cuando el endpoint de
 * indicadores no está disponible y sólo se puede medir con los casos locales.
 * Sólo tiene sentido en el eje de casos; las alertas se declaran ausentes.
 */
export function distribuirPorRegion(
  filas: readonly FilaRegion[],
  metrica: MetricaDistribucion,
): FilaDistribucion[] {
  const medidas = medidasDeCasos(filas);
  const totalGlobal = medidas.reduce(
    (acumulado, medida) => acumulado + valorMedida(medida, 'casos', metrica),
    0,
  );

  return medidas
    .map((medida, indice) =>
      filaDeGrupo(
        normalizarRegion(medida.region),
        filas[indice]?.region ?? medida.region,
        [medida],
        'casos',
        metrica,
        totalGlobal,
      ),
    )
    .sort((a, b) => b.valor - a.valor || compararTexto(a.titulo, b.titulo));
}

/** Rampa monocromática roja para el coroplético de alertas (claro → oscuro). */
export const ESCALA_COROPLETA_ALERTAS: readonly string[] = [
  '#f7e4e2',
  '#eab7b2',
  '#d98a83',
  '#c06a62',
  '#ad4d46',
];

/** Rampa monocromática azul para el coroplético de manifiestos (claro → oscuro). */
export const ESCALA_COROPLETA_MANIFIESTOS: readonly string[] = [
  '#eaf1fb',
  '#c3d7ef',
  '#93b6dd',
  '#5f8ec6',
  '#2455a2',
];

/**
 * Tramo de una rampa secuencial (0..tramos-1) para una intensidad 0..1.
 * Devuelve -1 cuando no hay intensidad: el polígono se queda sin relleno.
 */
export function tramoChoropleta(proporcion: number | null, tramos = 5): number {
  if (proporcion === null || !Number.isFinite(proporcion) || tramos <= 0) return -1;
  const valor = Math.min(1, Math.max(0, proporcion));
  if (valor <= 0) return 0;
  return Math.min(tramos - 1, Math.ceil(valor * tramos) - 1);
}

/** Color de la rampa para una intensidad; `null` cuando no hay dato. */
export function colorChoropleta(
  proporcion: number | null,
  escala: readonly string[],
): string | null {
  const tramo = tramoChoropleta(proporcion, escala.length);
  return tramo < 0 ? null : (escala[tramo] ?? null);
}
