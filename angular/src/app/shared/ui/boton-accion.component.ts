import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AccionesPreferenciaService } from './acciones-preferencia.service';
import { IconoComponent } from './icono.component';

/** Tono del botón: `peligro` tiñe de rojo las acciones destructivas. */
export type TonoBotonAccion = 'neutro' | 'peligro';

/**
 * Botón de acción de fila: un solo diseño para «editar», «borrar», «copiar»,
 * «ver»… dentro de tablas y listados.
 *
 * En reposo no tiene borde ni fondo y hereda el texto secundario; el fondo
 * suave aparece sólo en `:hover`/`:focus-visible`. Cuando recibe `etiqueta`
 * puede mostrar el texto en lugar del icono según la preferencia global
 * (`AccionesPreferenciaService`); sin `etiqueta` siempre pinta el icono y usa
 * `aria-label` como nombre accesible.
 *
 * Con `ruta` se pinta un enlace (`<a routerLink>`) en vez de un botón: es el
 * caso de los accesos de una fila que navegan dentro de la aplicación. El
 * diseño es idéntico y la preferencia texto/ícono también se respeta.
 */
@Component({
  selector: 'app-boton-accion',
  imports: [IconoComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (esEnlace()) {
      <a
        class="boton-accion"
        [class.con-texto]="mostrarTexto()"
        [class.peligro]="tono() === 'peligro'"
        [routerLink]="ruta()"
        [fragment]="fragmento() || undefined"
        [attr.aria-label]="nombreAccesible()"
        [attr.title]="pista()"
        (click)="accion.emit($event)"
      >
        @if (mostrarTexto()) {
          <span class="texto">{{ etiqueta() }}</span>
        } @else {
          <app-icono [nombre]="icono()" [tamano]="15" />
        }
      </a>
    } @else {
      <button
        type="button"
        class="boton-accion"
        [class.con-texto]="mostrarTexto()"
        [class.peligro]="tono() === 'peligro'"
        [class.activa]="presionado() === true"
        [disabled]="deshabilitado()"
        [attr.aria-label]="nombreAccesible()"
        [attr.aria-pressed]="presionado()"
        [attr.title]="pista()"
        (click)="accion.emit($event)"
      >
        @if (mostrarTexto()) {
          <span class="texto">{{ etiqueta() }}</span>
        } @else {
          <app-icono [nombre]="icono()" [tamano]="15" />
        }
      </button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .boton-accion {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      text-decoration: none;
      cursor: pointer;
      transition:
        background-color 0.12s ease,
        color 0.12s ease;
    }

    /* Con etiqueta la caja crece a lo ancho para caber el texto. */
    .boton-accion.con-texto {
      padding: 0 9px;
      color: var(--ink-2);
    }

    .boton-accion:hover:not(:disabled),
    .boton-accion:focus-visible {
      background: var(--canvas);
      color: var(--ink);
    }

    .boton-accion:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 1px;
    }

    .boton-accion.peligro {
      color: var(--red);
    }

    .boton-accion.peligro:hover:not(:disabled),
    .boton-accion.peligro:focus-visible {
      background: var(--red-pale);
      color: var(--red);
    }

    /* Estado de alternancia (p. ej. «ya está en la lista temporal»). */
    .boton-accion.activa {
      background: var(--blue-pale);
      color: var(--blue);
    }

    .boton-accion:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .texto {
      white-space: nowrap;
    }
  `,
})
export class BotonAccionComponent {
  readonly icono = input.required<string>();
  /** Texto alternativo; con la preferencia activa sustituye al icono. */
  readonly etiqueta = input<string>('');
  /** Nombre accesible cuando no se ve el texto (icono solo). */
  readonly ariaLabel = input<string>('');
  /** Globo de ayuda; si falta se usa `ariaLabel`/`etiqueta`. */
  readonly titulo = input<string>('');
  readonly tono = input<TonoBotonAccion>('neutro');
  readonly deshabilitado = input(false);
  /** `true`/`false` para acciones de alternancia; `null` si no aplica. */
  readonly presionado = input<boolean | null>(null);
  /** Si se indica, el control es un enlace (`routerLink`) en vez de un botón. */
  readonly ruta = input<string | readonly (string | number)[] | null>(null);
  /** Ancla opcional del enlace (`fragment`). */
  readonly fragmento = input<string>('');

  readonly accion = output<MouseEvent>();

  private readonly preferencia = inject(AccionesPreferenciaService);

  readonly esEnlace = computed(() => this.ruta() !== null);

  readonly mostrarTexto = computed(() => this.etiqueta() !== '' && this.preferencia.conTexto());

  readonly nombreAccesible = computed(
    () => this.ariaLabel() || this.etiqueta() || this.titulo() || null,
  );

  /** En modo texto no se repite el rótulo en el `title`. */
  readonly pista = computed(() => {
    if (this.mostrarTexto()) return null;
    return this.titulo() || this.etiqueta() || this.ariaLabel() || null;
  });
}
