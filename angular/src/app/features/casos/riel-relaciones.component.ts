import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IconoComponent } from '../../shared/ui/icono.component';

/** Contador y ancla de una sección de la ficha. */
export type EnlaceRiel = {
  etiqueta: string;
  /** Id del encabezado de la sección a la que salta el enlace. */
  ancla: string;
  contador: number;
  icono: string;
};

/**
 * Riel de relaciones del caso (item 67).
 *
 * No es un sistema de pestañas: enlaza con `fragment` a los `id` de las
 * secciones que ya están en la ficha. En pantallas anchas se ubica en una
 * columna lateral; en estrechas, el contenedor lo coloca arriba y aquí se
 * convierte en una fila de contadores.
 */
@Component({
  selector: 'app-riel-relaciones',
  imports: [RouterLink, IconoComponent],
  templateUrl: './riel-relaciones.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .riel {
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }

    .riel-titulo {
      margin: 0 0 8px;
      color: var(--muted);
      font: 700 9px var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .riel-lista {
      display: flex;
      flex-direction: column;
      gap: 2px;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .riel-enlace {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 4px;
      border-radius: 6px;
      color: var(--ink-2);
      font-size: 10.5px;
      text-decoration: none;
    }

    .riel-enlace:hover,
    .riel-enlace:focus-visible {
      background: var(--blue-pale);
      color: var(--blue-dark);
    }

    .riel-etiqueta {
      flex: 1;
    }

    .riel-contador {
      min-width: 22px;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--canvas);
      color: var(--muted);
      font-size: 9px;
      font-weight: 700;
      text-align: center;
    }

    @media (max-width: 1120px) {
      .riel-titulo {
        margin-bottom: 6px;
      }

      .riel-lista {
        flex-direction: row;
        flex-wrap: wrap;
        gap: 6px;
      }

      .riel-enlace {
        padding: 4px 8px;
        border: 1px solid var(--line);
      }
    }
  `,
})
export class RielRelacionesComponent {
  readonly enlaces = input.required<readonly EnlaceRiel[]>();
}
