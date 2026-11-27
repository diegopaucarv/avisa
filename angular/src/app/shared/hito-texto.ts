/**
 * Texto compartido de los hitos: código corto y etiqueta unificada.
 *
 * Vive fuera de Angular para que cualquier vista (compromisos, mesas, fichas)
 * pinte el mismo formato sin repetir reglas. Sin dependencias del framework.
 */

/**
 * Prefijo legible seguido de dígitos: `H001`, `H-1`, `h001`, `Hito 3`, `H 03` o
 * sólo `3`. Se acepta cualquier combinación de separadores entre el prefijo y
 * el número (`-`, `_`, `.`, `#` o espacios).
 */
const SUFIJO_HITO = /^(?:hito|h)?[\s._#-]*(\d+)$/i;

/** Código de hito ya incluido al inicio de la descripción, con su separador. */
const PREFIJO_EN_DESCRIPCION = /^(?:hito|h)?[\s._#-]*(\d+)\s*[–—\-:·.]\s*/i;

/**
 * `CS-2026-0001_COMP001_H001` → `H001`; `H-1` → `H001`; `Hito 3` → `H003`.
 *
 * Igual que el antiguo `codigoHito` del panel, se queda con el sufijo tras el
 * último guion bajo (los códigos completos son largos y rompen la lectura) y lo
 * normaliza a `H` + tres dígitos. Devuelve `null` cuando no hay número.
 */
export function codigoHitoCorto(codigo: string | null | undefined): string | null {
  const limpio = (codigo ?? '').trim();
  if (!limpio) return null;

  const partes = limpio.split('_');
  const sufijo = (partes[partes.length - 1] ?? limpio).trim();
  const coincidencia = SUFIJO_HITO.exec(sufijo);
  if (!coincidencia) return null;

  const cifras = coincidencia[1].replace(/^0+(?=\d)/, '');
  return `H${cifras.padStart(3, '0')}`;
}

/**
 * Quita de la descripción un código que ya la encabeza (`"H001 – Texto"`), pero
 * sólo si coincide con el código del hito: si es otro número es contenido real.
 */
function sinCodigoEnDescripcion(descripcion: string, codigo: string): string {
  if (codigoHitoCorto(descripcion) === codigo) return '';

  const prefijo = PREFIJO_EN_DESCRIPCION.exec(descripcion);
  if (prefijo && codigoHitoCorto(prefijo[1]) === codigo) {
    return descripcion.slice(prefijo[0].length).trim();
  }

  return descripcion;
}

/**
 * Etiqueta de una línea: `H001 · Descripción` (con espacios duros alrededor del
 * punto medio), o sólo el código, o sólo la descripción.
 *
 * El espacio duro (NBSP) mantiene el código pegado al punto medio: el navegador
 * no puede partir `H001 ·` de la descripción en dos líneas distintas.
 */
export function etiquetaHito(
  codigo: string | null | undefined,
  descripcion: string | null | undefined,
): string {
  const corto = codigoHitoCorto(codigo);
  const texto = (descripcion ?? '').trim();

  if (!corto) return texto || 'Hito sin descripción';

  const sinPrefijo = sinCodigoEnDescripcion(texto, corto);
  if (!sinPrefijo) return corto;

  return `${corto}\u00A0·\u00A0${sinPrefijo}`;
}
