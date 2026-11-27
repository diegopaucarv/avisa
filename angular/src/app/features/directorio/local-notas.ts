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
  if (texto.includes('otras') || texto.includes('observacion')) return 'otras';
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
  const sinEncabezado = ENCABEZADO.test(linea)
    ? linea.replace(/^\s{0,3}#{1,6}\s+/, '')
    : linea;

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
