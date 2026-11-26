/**
 * Búsqueda libre por palabras («full text» ligero, sin índices adicionales).
 *
 * `core.normalizar_ref` quita tildes, mayúsculas **y todos los separadores**
 * (espacios, `_`, `-`). Sirve para comparar referencias de catálogo
 * (`En_ejecucion` = `En ejecución`), pero como patrón de `like` para texto libre
 * convierte `%agua rio%` en `%aguario%`: sólo encuentra las palabras contiguas y
 * en ese orden. Por eso el término se parte en palabras y se exige que **todas**
 * aparezcan (`and` de `like`s), cada una contra cualquiera de las columnas.
 *
 * Se mantiene `core.normalizar_ref` en ambos lados para conservar la tolerancia
 * a tildes y mayúsculas, pero ahora cada `like` recibe una sola palabra, que ya
 * no contiene separadores que normalizar.
 *
 * Límite de palabras: evita que un `q` enorme genere decenas de `$n` y dispare
 * el coste del `or` por columna. Con seis palabras se cubre cualquier título.
 */
const MAX_PALABRAS = 6;

/** Palabras efectivas de `termino` (recortadas, sin vacíos y acotadas). */
export function palabrasDe(termino: string | null | undefined): string[] {
  return (termino ?? "")
    .trim()
    .split(/\s+/)
    .filter((palabra) => palabra.length > 0)
    .slice(0, MAX_PALABRAS);
}

/**
 * Condiciones `and` para `where`, una por palabra del término.
 *
 * `columnas` son expresiones SQL (no marcadores). `bind` acumula el parámetro y
 * devuelve su `$n`. Devuelve `[]` si no hay término, de modo que el llamador
 * sólo tenga que hacer `where.push(...condiciones)`.
 */
export function condicionesTexto(
  columnas: readonly string[],
  termino: string | null | undefined,
  bind: (valor: unknown) => string,
): string[] {
  return palabrasDe(termino).map((palabra) => {
    const patron = bind(`%${palabra}%`);
    const porColumna = columnas
      .map(
        (columna) =>
          `core.normalizar_ref(${columna}) like core.normalizar_ref(${patron})`,
      )
      .join(" or ");
    return `(${porColumna})`;
  });
}

/**
 * Envuelve en un único `and` las condiciones de `condicionesTexto`. Devuelve
 * `null` cuando no hay término para no añadir un `where` vacío.
 */
export function filtroTexto(
  columnas: readonly string[],
  termino: string | null | undefined,
  bind: (valor: unknown) => string,
): string | null {
  const condiciones = condicionesTexto(columnas, termino, bind);
  return condiciones.length ? `(${condiciones.join(" and ")})` : null;
}
