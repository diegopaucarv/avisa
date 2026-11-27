/**
 * Plantillas de texto estructurado y su lectura tolerante.
 *
 * Varias fichas de AVISA guardan datos que la base no tiene en columnas —o que el
 * equipo escribe primero como un informe— dentro de un campo de texto libre con
 * una plantilla markdown estable: la ficha ampliada del actor
 * (`features/directorio/ficha-plantilla.ts`), las notas del local
 * (`features/directorio/local-notas.ts`), el reporte de alerta temprana
 * (`features/alertas/alerta-plantilla.ts`) y el reporte de clima social
 * (`features/clima-social/clima-social-plantilla.ts`).
 *
 * Este módulo concentra lo que comparten: el reconocimiento de encabezados y
 * viñetas, la normalización de claves (sin tildes, sin markdown, sin paréntesis
 * de pista) y la separación `Clave: valor`. Cada plantilla concreta pone sus
 * alias y su estructura; nadie duplica el reconocimiento.
 *
 * Los lectores son **puros y totales**: nunca lanzan, normalizan saltos de línea
 * y devuelven `null` (o listas vacías) en lo que no aparece. El texto legado sin
 * estructura no produce datos inventados.
 */

/** Encabezado markdown de nivel 1 a 6 (`#`, `##`, `###`…). */
export const ENCABEZADO = /^\s{0,3}#{1,6}\s+(.*)$/;

/** Viñeta con guion, asterisco o punto: exige espacio tras `-`/`*`/`•`. */
export const VINETA = /^\s*(?:[-*]\s+|•\s*)(.*)$/;

/** Minúsculas y sin tildes, para reconocer claves sin depender del tecleo. */
export function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Clave comparable: sin tildes, minúsculas, sin markdown (`*`, `_`, `` ` ``), sin
 * un paréntesis final (`Edad (años)`) y sin dos puntos o guiones de cola.
 */
export function normalizarClave(valor: string): string {
  return normalizar(valor)
    .replace(/[`*_]/g, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/[:\-–—]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Separa `Clave: valor` por el primer `:` (ascii o de ancho completo). */
export function separarClaveValor(
  contenido: string,
): { clave: string; valor: string } | null {
  const ascii = contenido.indexOf(':');
  const ancho = contenido.indexOf('：');

  let indice = -1;
  if (ascii === -1) indice = ancho;
  else if (ancho === -1) indice = ascii;
  else indice = Math.min(ascii, ancho);

  if (indice < 0) return null;

  return {
    clave: contenido.slice(0, indice),
    valor: contenido.slice(indice + 1),
  };
}

/** `Valor: …` se descarta cuando está vacío o cuando sólo es un guion. */
export function valorUtil(valor: string): string | null {
  const limpio = valor.trim();
  if (!limpio || limpio === '—' || limpio === '-') return null;
  return limpio;
}

/** Campo escalar de una plantilla: clave del resultado, rótulo y alias. */
export type CampoEscalarPlantilla = {
  /** Clave del objeto resultante. */
  readonly clave: string;
  /** Rótulo con el que se escribe en la plantilla. */
  readonly rotulo: string;
  /** Variantes aceptadas al leer (se normalizan). */
  readonly alias?: readonly string[];
  /** Pista entre paréntesis que se muestra en la plantilla. */
  readonly ayuda?: string;
};

/** Sección de una plantilla de viñetas `Rotulo: valor`. */
export type SeccionPlantilla = {
  readonly titulo: string;
  readonly campos: readonly CampoEscalarPlantilla[];
};

/**
 * Construye el markdown de la plantilla a partir de sus secciones.
 *
 * Cada campo se escribe como viñeta `- Rótulo: (pista)`; la pista es opcional.
 * El resultado se ofrece al usuario para que pegue y complete, y también se
 * documenta en `docs/`.
 */
export function plantillaMarkdown(secciones: readonly SeccionPlantilla[]): string {
  return secciones
    .map((seccion) => {
      const vinetas = seccion.campos
        .map((campo) =>
          campo.ayuda ? `- ${campo.rotulo}: (${campo.ayuda})` : `- ${campo.rotulo}:`,
        )
        .join('\n');
      return `## ${seccion.titulo}\n\n${vinetas}`;
    })
    .join('\n\n');
}

/**
 * Lee las líneas `- Clave: valor` de un texto y devuelve los escalares
 * reconocidos. Las claves desconocidas y las viñetas sin dos puntos se ignoran.
 *
 * Sirve a las plantillas cuyo contenido es, sobre todo, pares clave-valor. Las
 * que tienen secciones de viñetas libres (alertas, clima social) usan en cambio
 * su propio lector de secciones, pero comparten `normalizar`, `separarClaveValor`
 * y `valorUtil` de aquí.
 */
export function parsearEscalares(
  texto: string | null | undefined,
  secciones: readonly SeccionPlantilla[],
): Record<string, string | null> {
  const resultado: Record<string, string | null> = {};
  for (const seccion of secciones) {
    for (const campo of seccion.campos) resultado[campo.clave] = null;
  }

  const normalizado = typeof texto === 'string' ? texto.replace(/\r\n?/g, '\n') : '';
  if (normalizado.trim() === '') return resultado;

  // Rótulo normalizado → clave, construido una vez por llamada (los catálogos
  // son pequeños y así el lector no depende de un estado compartido mutable).
  const mapa = new Map<string, string>();
  for (const seccion of secciones) {
    for (const campo of seccion.campos) {
      mapa.set(normalizarClave(campo.rotulo), campo.clave);
      for (const alias of campo.alias ?? []) {
        mapa.set(normalizarClave(alias), campo.clave);
      }
    }
  }

  for (const linea of normalizado.split('\n')) {
    if (ENCABEZADO.test(linea)) continue;

    const vineta = VINETA.exec(linea);
    if (!vineta) continue;

    const par = separarClaveValor(vineta[1]);
    if (!par) continue;

    const clave = mapa.get(normalizarClave(par.clave));
    if (!clave) continue;

    const valor = valorUtil(par.valor);
    if (valor) resultado[clave] = valor;
  }

  return resultado;
}
