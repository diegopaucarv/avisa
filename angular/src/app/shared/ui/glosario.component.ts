import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { GLOSARIO, type EntradaGlosario } from './glosario.contenido';
import { IconoComponent } from './icono.component';

/** Caja del popover referida al viewport (`position: fixed`). */
type PosicionPopover = {
  top: number;
  left: number;
  /** Verdadero cuando no cabe debajo del botón y se abre hacia arriba. */
  arriba: boolean;
};

/**
 * Botón ⓘ con la definición corta de un término y un enlace a la ayuda.
 *
 * El texto sale de `GLOSARIO` (`glosario.contenido.ts`): la misma fuente que
 * nutre «Ayuda y criterios», de modo que ambos no se contradicen. Si la clave
 * no existe, no se pinta nada: un error de tipeo no rompe la vista.
 *
 * Es un popover consultivo, no modal: `role="note"`, sin `aria-modal` ni
 * trampa de foco. Cierra al pulsar fuera del host y con Escape, que devuelve
 * el foco al botón.
 *
 * El popover se posiciona con `position: fixed` a partir de la caja del botón.
 * Es deliberado: los ⓘ viven dentro de `.table-wrap` (con `overflow`) y de
 * cuerpos de drawer con scroll, donde un popover absoluto quedaría recortado.
 * Al no caber debajo se abre hacia arriba; si el usuario desplaza o redimensiona
 * la ventana, se cierra en lugar de quedar desanclado.
 */
@Component({
  selector: 'app-glosario',
  imports: [IconoComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:pointerdown)': 'alPulsarFuera($event)',
    '(document:keydown.escape)': 'cerrar()',
    '(window:scroll)': 'cerrarSinFoco()',
    '(window:resize)': 'cerrarSinFoco()',
  },
  template: `
    @if (entrada(); as e) {
      <span class="glossary-term">
        <button
          #boton
          type="button"
          class="badge-help"
          [attr.aria-label]="'Qué significa: ' + e.termino"
          [attr.aria-expanded]="abierto()"
          (click)="alternar()"
        >
          <app-icono nombre="info" [tamano]="12" />
        </button>

        @if (abierto()) {
          <span
            class="glossary-popover"
            role="note"
            [style.position]="'fixed'"
            [style.zIndex]="90"
            [style.top.px]="posicion()?.top ?? 0"
            [style.left.px]="posicion()?.left ?? 0"
            [style.transform]="posicion()?.arriba ? 'translateY(-100%)' : null"
          >
            <strong>{{ e.termino }}</strong>
            <span class="glossary-definition">{{ e.definicion }}</span>
            <span class="glossary-source">{{ e.fuente }}</span>
            <a class="link-button" [routerLink]="['/ayuda']" [fragment]="e.ayudaId">
              Ampliar en la ayuda
            </a>
          </span>
        }
      </span>
    }
  `,
})
export class GlosarioComponent {
  /** Clave del término en `GLOSARIO`. */
  readonly termino = input.required<string>();
  /**
   * Alineación preferida: `inicio` ancla el borde izquierdo al botón y `fin` el
   * derecho. El recorte contra el viewport manda si no cabe.
   */
  readonly alineacion = input<'inicio' | 'fin'>('inicio');

  readonly abierto = signal(false);
  readonly posicion = signal<PosicionPopover | null>(null);

  readonly entrada = computed<EntradaGlosario | null>(() => GLOSARIO[this.termino()] ?? null);

  /** `.glossary-popover` mide 262 px y su contenido supera los 140 px. */
  private static readonly ANCHO = 262;
  private static readonly ALTO = 150;
  private static readonly MARGEN = 8;

  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly boton = viewChild<ElementRef<HTMLButtonElement>>('boton');

  alternar(): void {
    if (this.abierto()) {
      this.cerrarSinFoco();
      return;
    }
    this.abrir();
  }

  /** Abre midiendo el botón: el popover no depende del flujo del documento. */
  private abrir(): void {
    const boton = this.boton()?.nativeElement;
    if (!boton) {
      this.abierto.set(true);
      return;
    }

    const caja = boton.getBoundingClientRect();
    const ancho = GlosarioComponent.ANCHO;
    const margen = GlosarioComponent.MARGEN;

    const preferida = this.alineacion() === 'fin' ? caja.right - ancho : caja.left - margen / 2;
    const limite = Math.max(margen, window.innerWidth - ancho - margen);
    const izquierda = Math.min(Math.max(margen, preferida), limite);

    const cabeAbajo = caja.bottom + margen + GlosarioComponent.ALTO <= window.innerHeight;

    this.posicion.set({
      top: cabeAbajo ? caja.bottom + margen : caja.top - margen,
      left: izquierda,
      arriba: !cabeAbajo,
    });
    this.abierto.set(true);
  }

  /** El botón alterna, el clic fuera solo cierra: no devuelve el foco. */
  alPulsarFuera(evento: Event): void {
    const destino = evento.target as Node | null;
    if (!this.abierto() || !destino || this.elemento.nativeElement.contains(destino)) return;
    this.cerrarSinFoco();
  }

  cerrarSinFoco(): void {
    if (!this.abierto()) return;
    this.abierto.set(false);
  }

  cerrar(): void {
    if (!this.abierto()) return;
    this.abierto.set(false);
    this.boton()?.nativeElement.focus();
  }
}
