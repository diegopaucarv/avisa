import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { InactividadService } from '../../core/auth/inactividad.service';
import { SesionStore } from '../../core/auth/sesion.store';
import { IconoComponent } from './icono.component';

/**
 * Aviso flotante de inactividad.
 *
 * Se monta una sola vez en la raíz (`app.ts`) para que cubra cualquier pantalla
 * del área privada. Sólo pinta algo cuando `InactividadService.avisando()` es
 * cierto, es decir, en el último minuto. Ofrece seguir en sesión o cerrarla, y
 * desaparece al imprimir.
 */
@Component({
  selector: 'app-aviso-inactividad',
  imports: [IconoComponent],
  templateUrl: './aviso-inactividad.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .aviso-inactividad {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 90;
      width: min(440px, calc(100vw - 32px));
      padding: 13px 15px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 12px;
      border: 1px solid var(--line);
      border-left: 3px solid var(--amber);
      border-radius: 9px;
      background: #fff;
      color: var(--amber);
      box-shadow: 0 18px 38px -12px rgba(16, 38, 58, 0.3);
    }

    .aviso-inactividad-texto {
      flex: 1 1 190px;
      margin: 0;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--ink-2);
    }

    .aviso-inactividad-texto strong {
      color: var(--amber);
    }

    .aviso-inactividad-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-left: auto;
    }

    @media print {
      .aviso-inactividad {
        display: none !important;
      }
    }
  `,
})
export class AvisoInactividadComponent {
  private readonly sesion = inject(SesionStore);
  private readonly router = inject(Router);

  readonly inactividad = inject(InactividadService);

  seguir(): void {
    this.inactividad.seguirEnSesion();
  }

  cerrarSesion(): void {
    this.sesion.cerrarSesion();
    void this.router.navigateByUrl('/acceso');
  }
}
