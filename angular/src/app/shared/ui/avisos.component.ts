import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject } from '@angular/core';

import { AvisosService, type Aviso, type TipoAviso } from './avisos.service';
import { IconoComponent } from './icono.component';

/** Cuánto permanece cada aviso en pantalla. */
const DURACION: Record<TipoAviso, number> = {
  exito: 5000,
  info: 6500,
  // Los errores traen un código que conviene leer: duran el doble.
  error: 11000,
};

const ICONO: Record<TipoAviso, string> = {
  exito: 'check',
  info: 'info',
  error: 'alerta',
};

/**
 * Cola de mensajes emergentes.
 *
 * Se monta una sola vez en el shell. El cierre se programa aquí (y no en el
 * servicio) para que el estado siga siendo un valor puro; `DestroyRef` limpia
 * los temporizadores si el shell se desmonta.
 */
@Component({
  selector: 'app-avisos',
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="avisos" aria-live="polite" aria-atomic="false">
      @for (aviso of avisos.avisos(); track aviso.id) {
        <div class="aviso" [class]="'aviso-' + aviso.tipo" [attr.role]="rol(aviso)">
          <app-icono [nombre]="icono(aviso.tipo)" [tamano]="17" />
          <div class="aviso-texto">
            <p class="aviso-titulo">{{ aviso.titulo }}</p>
            @if (aviso.detalle) {
              <p class="aviso-detalle">{{ aviso.detalle }}</p>
            }
            @if (aviso.codigo) {
              <p class="aviso-codigo">{{ aviso.codigo }}</p>
            }
          </div>
          <button
            type="button"
            class="aviso-cerrar"
            aria-label="Cerrar el aviso"
            (click)="avisos.cerrar(aviso.id)"
          >
            <app-icono nombre="cerrar" [tamano]="14" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .avisos {
      position: fixed;
      z-index: 90;
      right: 18px;
      bottom: 18px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: min(390px, calc(100vw - 32px));
      pointer-events: none;
    }

    .aviso {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-left-width: 4px;
      border-radius: 9px;
      background: var(--paper, #fff);
      box-shadow: 0 12px 30px rgb(23 40 58 / 16%);
      pointer-events: auto;
      animation: aviso-entra 140ms ease-out;
    }

    @media (prefers-reduced-motion: reduce) {
      .aviso {
        animation: none;
      }
    }

    @keyframes aviso-entra {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }

    .aviso-exito {
      border-left-color: #2f6f52;
    }
    .aviso-exito > app-icono {
      color: #2f6f52;
    }

    .aviso-error {
      border-left-color: #b3382c;
    }
    .aviso-error > app-icono {
      color: #b3382c;
    }

    .aviso-info {
      border-left-color: #315b91;
    }
    .aviso-info > app-icono {
      color: #315b91;
    }

    app-icono {
      margin-top: 1px;
    }

    .aviso-texto {
      flex: 1;
      min-width: 0;
    }

    .aviso-titulo {
      margin: 0;
      color: #1c2a38;
      font-size: 13.5px;
      font-weight: 700;
      line-height: 1.4;
    }

    .aviso-detalle {
      margin: 3px 0 0;
      color: #5f7180;
      font-size: 12.5px;
      line-height: 1.5;
      white-space: pre-line;
    }

    .aviso-codigo {
      margin: 5px 0 0;
      color: #8a98a5;
      font-family: var(--font-mono, monospace);
      font-size: 11.5px;
      letter-spacing: 0.04em;
    }

    .aviso-cerrar {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      flex: none;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: #8a98a5;
      cursor: pointer;
    }

    .aviso-cerrar:hover {
      background: #f1f4f7;
      color: #33465a;
    }
  `,
})
export class AvisosComponent {
  readonly avisos = inject(AvisosService);
  private readonly destruccion = inject(DestroyRef);
  private readonly temporizadores = new Map<number, ReturnType<typeof setTimeout>>();

  constructor() {
    // Un temporizador por aviso; al cerrarlo a mano el temporizador se cancela
    // solo porque el id deja de existir en la cola.
    effect(() => {
      for (const aviso of this.avisos.avisos()) {
        if (this.temporizadores.has(aviso.id)) continue;
        const temporizador = setTimeout(() => {
          this.temporizadores.delete(aviso.id);
          this.avisos.cerrar(aviso.id);
        }, DURACION[aviso.tipo]);
        this.temporizadores.set(aviso.id, temporizador);
      }

      const vivos = new Set(this.avisos.avisos().map((aviso) => aviso.id));
      for (const [id, temporizador] of this.temporizadores) {
        if (vivos.has(id)) continue;
        clearTimeout(temporizador);
        this.temporizadores.delete(id);
      }
    });

    this.destruccion.onDestroy(() => {
      for (const temporizador of this.temporizadores.values()) clearTimeout(temporizador);
      this.temporizadores.clear();
    });
  }

  icono(tipo: TipoAviso): string {
    return ICONO[tipo];
  }

  /** Los errores se anuncian como alertas; el resto, como estado. */
  rol(aviso: Aviso): 'alert' | 'status' {
    return aviso.tipo === 'error' ? 'alert' : 'status';
  }
}
