import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';

const MAXIMO_MOTIVO = 500;
const MINIMO_MOTIVO = 10;

/** `archivar` marca la alerta; `desarchivar` la devuelve a las colas de trabajo. */
export type ModoArchivo = 'archivar' | 'desarchivar';

/**
 * Ventana dedicada «Archivar alerta sin caso».
 *
 * Archivar no es anular: sólo saca la alerta de las colas de trabajo con un
 * motivo y el registro de quién lo hizo. No conoce HTTP: emite el motivo y la
 * pantalla que la contiene hace el POST/DELETE a `/v1/alerts/:id/archivar`.
 */
@Component({
  selector: 'app-alerta-archivo',
  imports: [IconoComponent],
  templateUrl: './alerta-archivo.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .modal-scrim {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal {
      display: flex;
      flex-direction: column;
      width: min(560px, 100%);
      max-height: calc(100vh - 40px);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 24px 60px rgb(16 28 40 / 28%);
      overflow: hidden;
    }

    .modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid #e8edf1;
    }

    .modal-codigo {
      margin: 0 0 4px;
      color: #8b97a1;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .modal-head h2 {
      margin: 0;
      color: #1a2b3e;
      font-size: 16px;
      font-weight: 700;
    }

    .modal-sitio {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #eef3fa;
      color: #4a6b93;
      font-size: 11.5px;
      font-weight: 700;
    }

    .modal-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 20px;
      overflow-y: auto;
    }

    .modal-titulo {
      margin: 0;
      color: #1a2b3e;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .modal-texto {
      margin: 0;
      color: #526577;
      font-size: 13px;
      line-height: 1.55;
    }

    .modal-aviso {
      margin: 0;
      padding: 9px 11px;
      border-left: 3px solid #c9d8ea;
      border-radius: 6px;
      background: #f5f8fc;
      color: #526577;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .contador {
      color: #8b97a1;
      font-size: 11.5px;
      text-align: right;
    }

    .campo-error {
      margin: 0;
      color: #a3402f;
      font-size: 12px;
      line-height: 1.45;
    }

    .modal-foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 20px;
      border-top: 1px solid #e8edf1;
    }
  `,
})
export class AlertaArchivoComponent {
  readonly modo = input<ModoArchivo>('archivar');
  readonly codigo = input('');
  readonly titulo = input('');
  readonly sitio = input('');
  readonly motivoActual = input<string | null>(null);
  readonly enviando = input(false);
  readonly errorEnvio = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly confirmar = output<string | null>();

  readonly maximo = MAXIMO_MOTIVO;
  readonly minimo = MINIMO_MOTIVO;

  private readonly dialogo = viewChild<ElementRef<HTMLElement>>('dialogo');
  private readonly destruccion = inject(DestroyRef);

  readonly esArchivar = computed(() => this.modo() === 'archivar');
  readonly motivo = signal('');
  private readonly intentado = signal(false);

  readonly longitud = computed(() => this.motivo().trim().length);

  readonly errorMotivo = computed(() => {
    if (!this.esArchivar()) return null;
    const longitud = this.longitud();
    if (longitud >= MINIMO_MOTIVO) return null;
    if (longitud === 0) {
      return this.intentado() ? 'El motivo del archivo es obligatorio.' : null;
    }
    return `El motivo debe tener al menos ${MINIMO_MOTIVO} caracteres (faltan ${
      MINIMO_MOTIVO - longitud
    }).`;
  });

  readonly valido = computed(() => !this.esArchivar() || this.longitud() >= MINIMO_MOTIVO);

  constructor() {
    afterNextRender(() => this.dialogo()?.nativeElement.focus({ preventScroll: true }));

    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrarConSalida();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
  }

  campo(evento: Event): void {
    const area = evento.target as HTMLTextAreaElement;
    this.motivo.set(area.value.slice(0, MAXIMO_MOTIVO));
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarConSalida();
  }

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.dialogo()?.nativeElement, () => this.cerrar.emit());
  }

  alConfirmar(): void {
    if (this.enviando()) return;
    if (!this.esArchivar()) {
      this.confirmar.emit(null);
      return;
    }
    this.intentado.set(true);
    if (!this.valido()) return;
    this.confirmar.emit(this.motivo().trim());
  }
}
