/**
 * Clima social · Plantilla de reporte y su lectura.
 *
 * El reporte mensual de clima social se redacta primero como texto (un informe
 * de pocas secciones) y luego se carga en AVISA. Este módulo ofrece la plantilla
 * para escribirlo y un lector tolerante que reparte el texto pegado en las mismas
 * cinco secciones que muestra la vista de clima social
 * (`clima-social.mapeo.ts` → `SECCIONES`): resumen ejecutivo, actores, clima
 * social y hechos recientes, demandas locales y foco PRODUCE.
 *
 * Aún no existe un formulario de creación de reporte; el módulo queda listo para
 * cuando se añada (ver `docs/plantilla-clima-social.md`). El lector es **puro y
 * total**: nunca lanza, tolera markdown, tildes, mayúsculas y emojis, y devuelve
 * `null` cuando no reconoce ninguna sección (no inventa contenido).
 */

import { normalizar } from '../../shared/plantilla-texto';

/** Claves de sección, las mismas que usa la vista de clima social. */
export type ClaveSeccionClima = 'resumen' | 'actores' | 'clima' | 'demandas' | 'foco';

type DefinicionSeccion = {
  readonly clave: ClaveSeccionClima;
  /** Rótulo con el que se escribe en la plantilla. */
  readonly titulo: string;
  /** Variantes aceptadas al leer (se normalizan y se comparan por prefijo). */
  readonly alias: readonly string[];
};

/**
 * Secciones en el orden en que se redactan. Los alias replican los que reconoce
 * `PATRON_SECCION` en `clima-social.mapeo.ts` para que un texto pegado aquí y un
 * documento del legado se lean igual.
 */
const SECCIONES: readonly DefinicionSeccion[] = [
  {
    clave: 'resumen',
    titulo: 'Resumen ejecutivo',
    alias: ['resumen ejecutivo', 'resumen', 'contexto rapido', 'alerta clave'],
  },
  { clave: 'actores', titulo: 'Actores', alias: ['actores', 'actores clave'] },
  {
    clave: 'clima',
    titulo: 'Clima social y hechos recientes',
    alias: [
      'clima social y hechos recientes',
      'clima social',
      'clima',
      'hechos recientes',
      'hechos',
      'focos de tension',
    ],
  },
  {
    clave: 'demandas',
    titulo: 'Demandas locales',
    alias: ['demandas locales', 'demandas'],
  },
  {
    clave: 'foco',
    titulo: 'Foco PRODUCE',
    alias: ['foco produce', 'foco', 'oportunidades', 'acciones previstas'],
  },
];

/** Contenido leído, una lista de líneas por sección. */
export type DatosPlantillaClimaSocial = {
  resumen: string[];
  actores: string[];
  clima: string[];
  demandas: string[];
  foco: string[];
};

/**
 * Plantilla para redactar el reporte. Se documenta en
 * `docs/plantilla-clima-social.md` y se ofrece en la interfaz para copiar.
 */
export const PLANTILLA_CLIMA_SOCIAL = `## Resumen ejecutivo
(párrafo de 3 a 5 líneas con la situación del mes y la alerta clave)

## Actores
- Nombre — Cargo / Organización (rol activo en el período)

## Clima social y hechos recientes
- DD.MMM.AAAA — Hecho concreto del período.

## Demandas locales
- Exigencia explícita de los actores.

## Foco PRODUCE
- Oportunidad de intervención o acción prevista.`;

/** Quita el énfasis de markdown, el marcador de cita y los emojis iniciales. */
function sinMarkdown(texto: string): string {
  return texto
    .replace(/^\s*>\s?/, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

/** Rótulo comparable: sin markdown, tildes ni caracteres iniciales no letra. */
function rotulo(linea: string): string {
  return normalizar(sinMarkdown(linea)).replace(/^[^a-z]+/, '').trim();
}

/** Sección cuyo alias empieza el rótulo, o `null`. */
function seccionDe(rot: string): ClaveSeccionClima | null {
  for (const seccion of SECCIONES) {
    for (const alias of seccion.alias) {
      if (rot.startsWith(alias)) return seccion.clave;
    }
  }
  return null;
}

/** Quita una viñeta inicial (`-`, `*`, `•`) si la hay. */
function contenidoDeLinea(linea: string): string {
  const vineta = /^\s*(?:[-*]\s+|•\s*)(.*)$/.exec(linea);
  return sinMarkdown(vineta ? vineta[1] : linea);
}

/**
 * Reporte de clima social (texto) → líneas por sección.
 *
 * Reconoce las secciones por su encabezado (`## Título`) o por una línea sin
 * viñeta que empiece con el rótulo o un alias. Todo lo anterior a la primera
 * sección reconocida se descarta. Devuelve `null` si no reconoce ninguna sección.
 */
export function parsearPlantillaClimaSocial(
  texto: string | null | undefined,
): DatosPlantillaClimaSocial | null {
  const normalizado = typeof texto === 'string' ? texto.replace(/\r\n?/g, '\n') : '';
  if (normalizado.trim() === '') return null;

  const datos: DatosPlantillaClimaSocial = {
    resumen: [],
    actores: [],
    clima: [],
    demandas: [],
    foco: [],
  };

  let actual: ClaveSeccionClima | null = null;
  let reconocidas = 0;

  for (const linea of normalizado.split('\n')) {
    const limpio = contenidoDeLinea(linea);
    if (!limpio) continue;

    const vineta = /^\s*(?:[-*]\s+|•\s*)/.test(linea);
    if (!vineta) {
      const seccion = seccionDe(rotulo(linea));
      if (seccion) {
        actual = seccion;
        reconocidas += 1;
        continue;
      }
    }

    if (actual) datos[actual].push(limpio);
  }

  if (reconocidas === 0) return null;
  return datos;
}
