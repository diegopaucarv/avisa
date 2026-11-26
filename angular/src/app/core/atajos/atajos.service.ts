import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Atajos de teclado globales del shell.
 *
 * Un único listener en `document` permite capturar las teclas sin importar
 * dónde esté el foco, incluido un campo de texto. `ShellComponent` lo instala
 * al arrancar y lo retira con su `DestroyRef`; un `@HostListener` en el shell no
 * serviría porque el foco puede estar en cualquier parte del documento.
 */
@Injectable({ providedIn: 'root' })
export class AtajosService {
  private readonly router = inject(Router);

  private limpiar: (() => void) | null = null;

  /** Instala el listener una sola vez y devuelve la función de limpieza. */
  instalar(): () => void {
    if (this.limpiar) return this.limpiar;

    const alPulsar = (evento: KeyboardEvent) => this.alPulsarTecla(evento);
    const limpiar = () => {
      document.removeEventListener('keydown', alPulsar);
      this.limpiar = null;
    };
    document.addEventListener('keydown', alPulsar);
    this.limpiar = limpiar;
    return limpiar;
  }

  private alPulsarTecla(evento: KeyboardEvent): void {
    if (evento.defaultPrevented) return;
    // Los paneles laterales son modales: sus propios atajos mandan.
    if (this.hayPanelAbierto()) return;

    const conMeta = evento.ctrlKey || evento.metaKey;
    if (conMeta && !evento.altKey && evento.key.toLowerCase() === 'k') {
      evento.preventDefault();
      void this.abrirBusquedaGlobal();
      return;
    }

    // «/» con modificadores es parte de otra combinación, no el atajo.
    if (evento.key !== '/' || conMeta || evento.altKey) return;
    // Nunca secuestra la escritura en un campo ni un evento ya consumido.
    if (this.esCampoDeTexto(evento.target)) return;

    const buscador = this.buscadorDeLaLista();
    if (!buscador) return;

    evento.preventDefault();
    buscador.focus();
    buscador.select();
  }

  /**
   * Los paneles laterales (`role="dialog"`) ya gestionan Escape y el foco:
   * mientras uno esté abierto el shell no navega por debajo.
   */
  private hayPanelAbierto(): boolean {
    return document.querySelector('[role="dialog"]') !== null;
  }

  private esCampoDeTexto(destino: EventTarget | null): boolean {
    const elemento = destino instanceof HTMLElement ? destino : document.activeElement;
    if (!(elemento instanceof HTMLElement)) return false;
    return (
      elemento.tagName === 'INPUT' ||
      elemento.tagName === 'TEXTAREA' ||
      elemento.tagName === 'SELECT' ||
      elemento.isContentEditable
    );
  }

  /** Primer `input[type="search"]` visible o, en su defecto, la barra global. */
  private buscadorDeLaLista(): HTMLInputElement | null {
    return (
      this.primerVisible('input[type="search"]') ??
      this.primerVisible('.search-field input') ??
      // Buscador de territorio: es un `combobox` de texto, no `type="search"`.
      this.primerVisible('input[role="combobox"]')
    );
  }

  private primerVisible(selector: string): HTMLInputElement | null {
    const campos = document.querySelectorAll<HTMLInputElement>(selector);
    for (const campo of Array.from(campos)) {
      if (campo.getClientRects().length > 0) return campo;
    }
    return null;
  }

  private async abrirBusquedaGlobal(): Promise<void> {
    if (!this.router.url.startsWith('/busqueda')) {
      await this.router.navigateByUrl('/busqueda');
    }
    // El componente es lazy: un único `setTimeout` fijo fallaba si el chunk
    // tardaba más en cargar. Se reintenta durante ~1 s hasta encontrarlo.
    for (let intento = 0; intento < 20; intento += 1) {
      const campo = this.primerVisible('input[type="search"]');
      if (campo) {
        campo.focus();
        campo.select();
        return;
      }
      await new Promise((listo) => setTimeout(listo, 50));
    }
  }
}
