import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import type { Riesgo } from '../../dominio/modelos';
import { IconoComponent } from '../../shared/ui/icono.component';
import { copiarAlPortapapeles } from './portapapeles';

/**
 * Ventana «Enviar alerta por mensajería instantánea».
 *
 * Muestra en sólo lectura el mensaje generado desde la alerta con la sintaxis
 * de WhatsApp (negritas `*` y emojis) y permite copiarlo al portapapeles.
 *
 * No conoce HTTP ni persiste nada: el texto llega ya armado por `mensaje` y
 * copiar es una operación local, sin permiso del backend.
 */
@Component({
  selector: 'app-alerta-whatsapp',
  imports: [IconoComponent],
  templateUrl: './alerta-whatsapp.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .modal-scrim {
      position: fixed;
      inset: 0;
      z-index: 120;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgb(16 28 40 / 45%);
    }

    .modal {
      display: flex;
      flex-direction: column;
      width: min(640px, 100%);
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

    .modal-head h2 {
      margin: 0 0 8px;
      color: #1a2b3e;
      font-size: 16px;
      font-weight: 700;
    }

    .modal-codigo {
      margin: 0 0 4px;
      color: #8b97a1;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .modal-contexto {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px 8px;
      margin: 0;
      color: #4a6b93;
      font-size: 11.5px;
      font-weight: 600;
    }

    .modal-contexto span:not(:first-child)::before {
      content: '·';
      margin-right: 8px;
      color: #b6c2cd;
    }

    .modal-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 20px;
      overflow-y: auto;
    }

    .modal-cabecera-cuerpo {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .modal-titulo {
      margin: 0;
      color: #1a2b3e;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .contador {
      color: #8b97a1;
      font-size: 11.5px;
    }

    .mensaje {
      width: 100%;
      min-height: 320px;
      padding: 12px 14px;
      border: 1px solid #e0e6ec;
      border-radius: 10px;
      background: #f9fbfd;
      color: #1a2b3e;
      font:
        500 13px/22px ui-monospace,
        'SFMono-Regular',
        'Menlo',
        'Consolas',
        monospace;
      white-space: pre-wrap;
      resize: vertical;
    }

    .mensaje[readonly] {
      cursor: default;
    }

    .mensaje:focus {
      outline: 2px solid #c9d8ea;
      outline-offset: 1px;
      background: #fff;
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
export class AlertaWhatsappComponent {
  readonly codigo = input('');
  readonly titulo = input('');
  readonly sitio = input('');
  readonly riesgo = input<Riesgo>('Bajo');
  /** Texto de la alerta ya generado con la sintaxis de WhatsApp. */
  readonly mensaje = input('');

  readonly cerrar = output<void>();

  private readonly dialogo = viewChild<ElementRef<HTMLElement>>('dialogo');

  readonly texto = signal('');
  readonly copiado = signal(false);
  readonly errorCopia = signal<string | null>(null);

  readonly caracteres = computed(() => this.texto().length);
  readonly etiquetaRiesgo = computed(() =>
    this.riesgo() === 'Alto' ? 'alto' : this.riesgo() === 'Medio' ? 'moderado' : 'bajo',
  );

  constructor() {
    afterNextRender(() => this.dialogo()?.nativeElement.focus());

    // Sólo se resiembra cuando el mensaje de entrada cambia de verdad: el
    // cuerpo es de sólo lectura y la confirmación de copia caduca con el texto.
    let firma: string | null = null;
    effect(() => {
      const entrante = this.mensaje();
      if (entrante === firma) return;
      firma = entrante;
      this.texto.set(entrante);
      this.copiado.set(false);
      this.errorCopia.set(null);
    });
  }

  async copiar(): Promise<void> {
    const ok = await copiarAlPortapapeles(this.texto());
    if (ok) {
      this.copiado.set(true);
      this.errorCopia.set(null);
      return;
    }
    this.copiado.set(false);
    this.errorCopia.set('No se pudo copiar. Seleccione el texto y use Ctrl + C.');
  }
}
