import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import { copiarAlPortapapeles } from './portapapeles';

/**
 * Ventana dedicada «Enviar alerta por WhatsApp».
 *
 * Muestra el mensaje con la sintaxis de WhatsApp (negritas `*` y emojis) en un
 * área editable, permite regenerarlo desde la alerta, copiarlo y —cuando se
 * activa «editar como plantilla»— guardarlo como plantilla propia de la alerta.
 *
 * No conoce HTTP: emite `guardarPlantilla` con el texto y la pantalla hace el
 * `PATCH`. Copiar al portapapeles es local y no requiere permiso del backend.
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

    .barra-herramientas {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
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
      font: 500 13px/22px ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
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

    .conmutador {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #33475b;
      font-size: 12.5px;
      font-weight: 600;
    }

    .aviso-copia {
      margin: 0;
      color: #2f6f52;
      font-size: 12.5px;
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
  /** Texto inicial: plantilla guardada o la generada desde la alerta. */
  readonly mensaje = input('');

  readonly cerrar = output<void>();
  readonly guardarPlantilla = output<string>();

  private readonly dialogo = viewChild<ElementRef<HTMLElement>>('dialogo');
  private readonly destruccion = inject(DestroyRef);

  readonly texto = signal('');
  readonly editarComoPlantilla = signal(false);
  readonly avisoCopia = signal<string | null>(null);

  readonly caracteres = computed(() => this.texto().length);

  constructor() {
    afterNextRender(() => this.dialogo()?.nativeElement.focus());

    // Sólo se resiembra cuando el mensaje de entrada cambia de verdad: editar a
    // mano no debe ser pisado por cada ciclo de detección.
    let firma: string | null = null;
    effect(() => {
      const entrante = this.mensaje();
      if (entrante === firma) return;
      firma = entrante;
      this.texto.set(entrante);
    });

    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar.emit();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
  }

  campo(evento: Event): void {
    const area = evento.target as HTMLTextAreaElement;
    this.texto.set(area.value);
    this.avisoCopia.set(null);
  }

  alternarPlantilla(): void {
    this.editarComoPlantilla.update((valor) => !valor);
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar.emit();
  }

  async copiar(): Promise<void> {
    const ok = await copiarAlPortapapeles(this.texto());
    this.avisoCopia.set(
      ok ? 'Mensaje copiado al portapapeles.' : 'No se pudo copiar. Seleccione el texto y use Ctrl + C.',
    );
  }

  guardar(): void {
    this.guardarPlantilla.emit(this.texto());
  }
}
