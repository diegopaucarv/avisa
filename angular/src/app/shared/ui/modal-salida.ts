/**
 * Salida animada de modales.
 *
 * Los modales se montan con `@if` desde su contenedor, así que al cerrar
 * desaparecen en el acto (no hay animación de salida posible sin retrasar el
 * desmontaje). El retraso no puede vivir en el padre: al cerrar suele limpiar los
 * datos que pasa por `input`, y el panel seguiría montado con datos nulos.
 *
 * Por eso el retraso vive en el propio panel: `salirModal()` marca el scrim y el
 * panel con `is-cerrando` (la animación la define `global.css`), espera lo que
 * dura y sólo entonces ejecuta la acción de cierre real (emitir `cerrar`).
 *
 * Durante la espera los datos siguen intactos porque el padre aún cree que el
 * modal está abierto.
 */

/** Contenedores con velo. Debe coincidir con las familias de `global.css`. */
const SELECTOR_SCRIM =
  '.drawer-scrim, .modal-scrim, .casos-drawer-scrim, .la-scrim, .fusion-scrim, .alta-scrim';

/** Duración de la salida; debe coincidir con `--modal-salida` de `global.css`. */
const DURACION_SALIDA_MS = 140;

/** Margen para que la animación llegue a su último fotograma. */
const MARGEN_MS = 40;

export function prefiereSinMovimiento(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Ejecuta `alTerminar` cuando la salida ha terminado.
 *
 * `panel` puede ser el propio panel (`.drawer`, `.modal`, …) o el scrim; si se
 * pasa el panel se busca su scrim hacia arriba. Sin `panel`, o con movimiento
 * reducido, se cierra sin esperar.
 */
export function salirModal(panel: Element | null | undefined, alTerminar: () => void): void {
  if (!panel || prefiereSinMovimiento()) {
    alTerminar();
    return;
  }

  const scrim = panel.closest(SELECTOR_SCRIM);
  const objetivos: Element[] = scrim && scrim !== panel ? [panel, scrim] : [panel];

  // Un segundo cierre (Escape repetido, doble clic) no debe programar otro
  // temporizador ni emitir dos veces.
  if (panel.classList.contains('is-cerrando')) return;

  for (const objetivo of objetivos) objetivo.classList.add('is-cerrando');

  window.setTimeout(() => {
    for (const objetivo of objetivos) objetivo.classList.remove('is-cerrando');
    alTerminar();
  }, DURACION_SALIDA_MS + MARGEN_MS);
}

/**
 * `true` cuando `panel` pertenece al diálogo abierto más alto de la pila.
 *
 * Los paneles se apilan: una ficha puede abrir su envío por WhatsApp, su
 * triaje o su anulación encima. Como todos escuchan Escape en `document`, sin
 * esta comprobación una sola pulsación cerraría la pila entera. Gana el último
 * scrim del documento, que es el que queda encima y tiene el foco.
 */
export function esDialogoSuperior(panel: Element | null | undefined): boolean {
  if (!panel) return false;
  const scrim = panel.closest(SELECTOR_SCRIM);
  if (!scrim) return true;
  const abiertos = document.querySelectorAll(SELECTOR_SCRIM);
  return abiertos.length === 0 || abiertos[abiertos.length - 1] === scrim;
}
