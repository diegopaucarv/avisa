/**
 * Directorio · Locales: notas estructuradas de la ficha del local.
 *
 * La base no tiene columnas para los riesgos del local (accesibilidad,
 * ventilación): se custodian dentro del texto libre `recomendacion` con una
 * plantilla markdown estable (ver `docs/plantilla-local.md`). Este módulo la
 * interpreta de forma tolerante para no romper con el texto legado, que llega
 * sin estructura y se muestra tal cual.
 *
 * El parser es puro y total: nunca lanza, descarta líneas vacías y recorta los
 * espacios de cada viñeta.
 */

export type NotasLocal = {
  /** Texto libre de evaluación (lo que va antes del primer encabezado). */
  evaluacion: string | null;
  /** Viñetas de «Accesibilidad»; vacío si la sección no existe. */
  accesibilidad: string[];
  /** Viñetas de «Ventilación»; vacío si la sección no existe. */
  ventilacion: string[];
  /** Viñetas de «Otras observaciones»; vacío si la sección no existe. */
  otras: string[];
  /** Texto sin encabezados reconocibles (legado): se muestra tal cual. */
  textoLibre: string | null;
};

/** Plantilla que la UI ofrece para escribir las notas del local. */
export const PLANTILLA_LOCAL = `## Evaluación
(texto libre de evaluación)

## Accesibilidad
- (barreras de acceso, escaleras, rampas, transporte)

## Ventilación
- (ventilación natural/forzada, aire acondicionado, aforo por ventilación)

## Otras observaciones
- (opcional)`;

type SeccionNota = 'evaluacion' | 'accesibilidad' | 'ventilacion' | 'otras';

/** Encabezado markdown de nivel 1 a 6 (`#`, `##`, `###`…). */
const ENCABEZADO = /^\s{0,3}#{1,6}\s+(.*)$/;

/** Viñeta con guion, asterisco o punto: exige espacio tras `-`/`*`. */
const VINETA = /^\s*(?:[-*]\s+|•\s*)(.*)$/;

/** Minúsculas y sin tildes, para reconocer encabezados sin depender del tecleo. */
function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Encabezado reconocible → sección; `null` si no es de la plantilla. */
function seccionDeTitulo(titulo: string): SeccionNota | null {
  const texto = normalizar(titulo);
  if (!texto) return null;

  if (texto.includes('evaluacion')) return 'evaluacion';
  if (texto.includes('accesibilidad') || texto.includes('acceso')) return 'accesibilidad';
  if (texto.includes('ventilacion')) return 'ventilacion';
  // «Otros riesgos» es una sección propia de la plantilla de riesgos: se
  // reconoce aquí para que sus viñetas no caigan por error en «Ventilación»
  // (un encabezado desconocido se trata como contenido de la sección vigente).
  if (texto.includes('otras') || texto.includes('otros') || texto.includes('observacion')) {
    return 'otras';
  }
  return null;
}

/** Sección a la que pertenece una línea de encabezado, si es reconocible. */
function seccionDeLinea(linea: string): SeccionNota | null {
  const coincidencia = ENCABEZADO.exec(linea);
  if (!coincidencia) return null;

  return seccionDeTitulo(coincidencia[1].replace(/\s*#+\s*$/, ''));
}

/** Quita encabezados no reconocidos y viñetas; recorta la línea. */
function contenidoDeLinea(linea: string, seccion: SeccionNota): string {
  const sinEncabezado = ENCABEZADO.test(linea) ? linea.replace(/^\s{0,3}#{1,6}\s+/, '') : linea;

  if (seccion === 'evaluacion') return sinEncabezado.trim();

  const coincidencia = VINETA.exec(sinEncabezado);
  return (coincidencia ? coincidencia[1] : sinEncabezado).trim();
}

/**
 * Texto de `recomendacion` → notas del local.
 *
 * Reconoce `#`/`##`/`###` con mayúsculas o minúsculas; el texto anterior al
 * primer encabezado es la evaluación. Si no hay ningún encabezado conocido,
 * todo el texto cae en `textoLibre` y el resto queda vacío (legado).
 */
export function parsearNotasLocal(texto: string | null | undefined): NotasLocal {
  const normalizado = typeof texto === 'string' ? texto.replace(/\r\n?/g, '\n') : '';

  const vacia = (): NotasLocal => ({
    evaluacion: null,
    accesibilidad: [],
    ventilacion: [],
    otras: [],
    textoLibre: null,
  });

  if (normalizado.trim() === '') return vacia();

  const lineas = normalizado.split('\n');
  const seccionesPorLinea = lineas.map(seccionDeLinea);

  if (seccionesPorLinea.every((seccion) => seccion === null)) {
    return { ...vacia(), textoLibre: normalizado.trim() };
  }

  const secciones: Record<SeccionNota, string[]> = {
    evaluacion: [],
    accesibilidad: [],
    ventilacion: [],
    otras: [],
  };

  let actual: SeccionNota = 'evaluacion';
  lineas.forEach((linea, indice) => {
    const seccion = seccionesPorLinea[indice];
    if (seccion) {
      actual = seccion;
      return;
    }

    const contenido = contenidoDeLinea(linea, actual);
    if (contenido) secciones[actual].push(contenido);
  });

  const evaluacion = secciones.evaluacion.join('\n').trim();

  return {
    evaluacion: evaluacion || null,
    accesibilidad: secciones.accesibilidad,
    ventilacion: secciones.ventilacion,
    otras: secciones.otras,
    textoLibre: null,
  };
}

/** Listas de riesgo de la ficha del local. */
export type RiesgosLocal = {
  accesibilidad: string[];
  ventilacion: string[];
  otros: string[];
};

type SeccionRiesgo = keyof RiesgosLocal;

/**
 * Encabezado → sección de riesgo. Sólo reconoce las tres secciones de la
 * plantilla de riesgos; cualquier otro encabezado devuelve `null` y cierra la
 * sección vigente, para no arrastrar texto que no sea un riesgo declarado.
 */
function seccionDeRiesgo(titulo: string): SeccionRiesgo | null {
  const texto = normalizar(titulo).replace(/\s+/g, ' ');
  if (!texto) return null;

  if (texto.includes('accesibilidad') || texto.includes('acceso')) return 'accesibilidad';
  if (texto.includes('ventilacion')) return 'ventilacion';
  // «Otros riesgos», «Riesgos» u «Otros riesgos identificados».
  if (texto.includes('riesgo')) return 'otros';
  return null;
}

/**
 * Texto de `recomendacion` → riesgos de accesibilidad, ventilación y otros.
 *
 * Reconoce la plantilla markdown:
 *
 * ```
 * ## Accesibilidad
 * - …
 * ## Ventilación
 * - …
 * ## Otros riesgos
 * - …
 * ```
 *
 * Es puro y total: normaliza los saltos de línea (Windows incluido), acepta
 * `-`, `*` y `•` como viñetas, ignora mayúsculas y tildes en los encabezados y
 * devuelve listas vacías para las secciones ausentes. No infiere riesgos: sólo
 * recoge lo que está escrito bajo cada sección; el texto previo al primer
 * encabezado de riesgo no se considera riesgo.
 */
export function leerRiesgosMarkdown(texto: string | null | undefined): RiesgosLocal {
  const resultado: RiesgosLocal = { accesibilidad: [], ventilacion: [], otros: [] };
  if (typeof texto !== 'string' || texto.trim() === '') return resultado;

  const normalizado = texto.replace(/\r\n?/g, '\n');
  let actual: SeccionRiesgo | null = null;

  for (const linea of normalizado.split('\n')) {
    const encabezado = ENCABEZADO.exec(linea);
    if (encabezado) {
      actual = seccionDeRiesgo(encabezado[1].replace(/\s*#+\s*$/, ''));
      continue;
    }

    if (!actual) continue;

    const vineta = VINETA.exec(linea);
    const contenido = (vineta ? vineta[1] : linea).trim();
    if (contenido) resultado[actual].push(contenido);
  }

  return resultado;
}

/**
 * Une varias listas de riesgos descartando duplicados por texto normalizado
 * (mayúsculas, tildes y espacios repetidos). Conserva el orden y la forma del
 * primero que aparece, para no reescribir lo que ya se muestra.
 */
export function unirRiesgos(...listas: ReadonlyArray<readonly string[]>): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];

  for (const lista of listas) {
    for (const elemento of lista) {
      const texto = elemento.trim();
      const clave = normalizar(texto).replace(/\s+/g, ' ');
      if (!clave || vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push(texto);
    }
  }

  return salida;
}

// `leerRiesgosMarkdown` es independiente de `parsearNotasLocal`: comparten las
// constantes `ENCABEZADO` y `VINETA`, pero mantiene su propio mapeo de secciones
// para no mezclar «Otras observaciones» con «Otros riesgos».
