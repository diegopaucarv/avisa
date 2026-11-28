import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';

import {
  MensajePanelComponent,
  type DestinatarioMensaje,
} from '../../shared/ui/mensaje-panel.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { EnviarMensajeService } from './enviar-mensaje.service';

/**
 * Botón flotante «Enviar mensaje» del directorio.
 *
 * Sigue el patrón de `ListaAsistenciaComponent`: el botón y el cajón viven aquí,
 * el estado de los destinatarios en un servicio raíz para sobrevivir a la
 * navegación. Al abrir, si el cajón está vacío, usa la selección de la tabla
 * como destinatarios iniciales; el panel permite además buscarlos a mano.
 *
 * `sobreLista` sube el botón cuando convive con el de la lista de asistencia en
 * la misma esquina (actores y organizaciones). En autoridades va solo.
 */
@Component({
  selector: 'app-enviar-mensaje',
  imports: [IconoComponent, MensajePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="enviar-mensaje-fab"
      [class.enviar-mensaje-fab-vacia]="total() === 0"
      [class.enviar-mensaje-fab-alto]="sobreLista()"
      [attr.aria-expanded]="abierto()"
      [attr.aria-label]="'Enviar mensaje (' + total() + ' destinatarios)'"
      (click)="abrir()"
    >
      <app-icono nombre="bandeja" [tamano]="18" />
      <span class="enviar-mensaje-fab-texto">Enviar mensaje</span>
      <span class="enviar-mensaje-contador">{{ total() }}</span>
    </button>

    <app-mensaje-panel
      [abierto]="abierto()"
      [contexto]="contexto()"
      [destinatarios]="destinatarios()"
      [permitirAnadir]="true"
      (cerrar)="cerrar()"
      (destinatariosCambio)="alCambiarDestinatarios($event)"
    />
  `,
  styles: `
    :host {
      display: contents;
    }

    /*
      Botón flotante de mensajes. Mismo z-index que el de la lista de
      asistencia (60) y, cuando comparten vista, se apila encima con
      la clase enviar-mensaje-fab-alto para no taparlo.
    */
    .enviar-mensaje-fab {
      position: fixed;
      right: 28px;
      bottom: calc(28px + env(safe-area-inset-bottom, 0px));
      z-index: 60;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 12px 16px;
      border: 1px solid #cfd9e2;
      border-radius: 999px;
      background: #1f5597;
      color: #fff;
      font: 600 13px/1 var(--font-body, inherit);
      box-shadow: 0 10px 26px rgb(17 32 45 / 22%);
      cursor: pointer;
    }

    .enviar-mensaje-fab-alto {
      bottom: calc(84px + env(safe-area-inset-bottom, 0px));
    }

    .enviar-mensaje-fab:hover {
      background: #1a4a85;
    }

    .enviar-mensaje-fab:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    /* Sin destinatarios el botón sigue accesible, pero no llama la atención. */
    .enviar-mensaje-fab-vacia {
      border-color: #cfd9e2;
      background: #fff;
      color: #465a6c;
      box-shadow: 0 8px 20px rgb(17 32 45 / 12%);
    }

    .enviar-mensaje-fab-vacia:hover {
      background: #f5f7f8;
    }

    .enviar-mensaje-contador {
      min-width: 22px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgb(255 255 255 / 22%);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .enviar-mensaje-fab-vacia .enviar-mensaje-contador {
      background: #eef2f6;
      color: #526577;
    }

    @media (max-width: 720px) {
      .enviar-mensaje-fab {
        right: 16px;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      }

      .enviar-mensaje-fab-alto {
        bottom: calc(72px + env(safe-area-inset-bottom, 0px));
      }

      .enviar-mensaje-fab-texto {
        display: none;
      }
    }
  `,
})
export class EnviarMensajeComponent {
  private readonly lista = inject(EnviarMensajeService);

  /** Destinatarios iniciales propuestos por la página (la selección de la tabla). */
  readonly semilla = input<DestinatarioMensaje[]>([]);
  /** Texto del encabezado del cajón: «Lista de actores», nombre del local, etc. */
  readonly contexto = input<string | null>(null);
  /** Sube el botón cuando la lista de asistencia ocupa la misma esquina. */
  readonly sobreLista = input(false);

  readonly abierto = signal(false);
  readonly total = this.lista.total;
  readonly destinatarios = this.lista.destinatarios;

  abrir(): void {
    this.lista.sembrar(this.semilla());
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  alCambiarDestinatarios(lista: DestinatarioMensaje[]): void {
    this.lista.reemplazar(lista);
  }
}
