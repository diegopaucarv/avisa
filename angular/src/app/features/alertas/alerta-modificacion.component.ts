import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';

const MAXIMO_MOTIVO = 500;

/**
 * Ventana dedicada «Solicitar modificación de la alerta».
 *
 * La abre la Dirección OAIPCS desde el menú de la fila. No conoce HTTP: emite
 * el motivo escrito y la pantalla que la contiene hace el PATCH.
 */
@Component({
  selector: 'app-alerta-modificacion',
  imports: [IconoComponent],
  templateUrl: './alerta-modificacion.component.html',
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

    .modal-actores {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin: 0;
    }

    .modal-actores div {
      padding: 8px 10px;
      border: 1px solid #e8edf1;
      border-radius: 8px;
      background: #fbfcfd;
    }

    .modal-actores dt {
      color: #8b97a1;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .modal-actores dd {
      margin: 3px 0 0;
      color: #1a2b3e;
      font-size: 13px;
      font-weight: 600;
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

    .modal-foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 20px;
      border-top: 1px solid #e8edf1;
    }
  `,
})
export class AlertaModificacionComponent {
  readonly codigo = input('');
  readonly titulo = input('');
  readonly sitio = input('');
  readonly solicitante = input('Dirección OAIPCS');
  readonly destinatario = input('Sectorista asignado');
  readonly enviando = input(false);
  readonly errorEnvio = input<string | null>(null);

  readonly cerrar = output<void>();

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.dialogo()?.nativeElement, () => this.cerrar.emit());
  }
  readonly enviar = output<string>();

  readonly maximo = MAXIMO_MOTIVO;

  private readonly dialogo = viewChild<ElementRef<HTMLElement>>('dialogo');

  readonly motivo = signal('');
  readonly restantes = computed(() => MAXIMO_MOTIVO - this.motivo().length);
  readonly valido = computed(() => this.motivo().trim().length > 0);

  constructor() {
    afterNextRender(() => this.dialogo()?.nativeElement.focus());
  }

  campo(evento: Event): void {
    const area = evento.target as HTMLTextAreaElement;
    this.motivo.set(area.value.slice(0, MAXIMO_MOTIVO));
  }

  confirmar(): void {
    if (!this.valido() || this.enviando()) return;
    this.enviar.emit(this.motivo().trim());
  }
}
