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

import { IconoComponent } from './icono.component';

/** `anular` escribe el borrado lógico; `restaurar` lo revierte. */
export type ModoAnulacion = 'anular' | 'restaurar';

/** Resultado que el panel entrega al contenedor para que ejecute la petición. */
export type ResultadoAnulacion = {
  modo: ModoAnulacion;
  /** `null` al restaurar: el backend no exige motivo para restaurar. */
  motivo: string | null;
};

/**
 * Panel lateral de anulación y restauración de un registro.
 *
 * Mismo patrón que `EventoPanelComponent` y `AlertaPanelComponent`: diálogo
 * modal (`role="dialog"`, `aria-modal`), cierre con Escape o con el fondo, foco
 * encerrado con Tab y devuelto al disparador al cerrar.
 *
 * No conoce HTTP: valida el motivo y emite `hecho`; el contenedor decide la
 * petición (`POST …/anular`, `DELETE …` o `POST …/restaurar`) y le devuelve
 * `enviando` y `errorEnvio` para que el estado se vea aquí.
 */
@Component({
  selector: 'app-anular-panel',
  imports: [IconoComponent],
  templateUrl: './anular-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .anular-panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .anular-panel-codigo {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .anular-panel-sub {
      margin: 4px 0 0;
      color: #647487;
      font-size: 13px;
      line-height: 1.5;
    }

    .anular-formulario {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .anular-formulario-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }

    .anular-contador {
      display: block;
      text-align: right;
    }

    .anular-confirmacion {
      margin: 0;
      color: #465a6c;
      font-size: 13.5px;
      line-height: 1.6;
    }

    .anular-confirmacion strong {
      color: #1c2a38;
    }

    .anular-aviso,
    .anular-bloqueo {
      margin: 0;
      padding: 9px 11px;
      border-radius: 6px;
      font-size: 13px;
      line-height: 1.55;
    }

    .anular-aviso {
      border: 1px solid #e6e0cf;
      background: #fdfaf1;
      color: #7d6a35;
    }

    .anular-bloqueo {
      border: 1px solid #f0d9d5;
      background: #fdf6f5;
      color: #a3402f;
    }
  `,
})
export class AnularPanelComponent {
  readonly modo = input<ModoAnulacion>('anular');
  /** Sustantivo que se muestra: «caso», «alerta», «compromiso», «documento». */
  readonly entidad = input('registro');
  readonly codigo = input<string | null>(null);
  /** Muestra el aviso de cascada (un caso arrastra sus dependencias). */
  readonly cascada = input(false);
  readonly detalleCascada = input('sus registros dependientes');
  readonly motivoMinimo = input(10);
  readonly enviando = input(false);
  readonly errorEnvio = input<string | null>(null);
  readonly puedeConfirmar = input(true);
  /** Motivo por el que la operación no procede; `null` cuando no hay bloqueo. */
  readonly bloqueo = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly hecho = output<ResultadoAnulacion>();

  readonly esAnular = computed(() => this.modo() === 'anular');
  readonly motivo = signal('');

  private readonly intentado = signal(false);

  readonly longitud = computed(() => this.motivo().trim().length);

  /** Error del campo; no se muestra hasta que se escribe o se intenta enviar. */
  readonly errorMotivo = computed(() => {
    if (!this.esAnular()) return null;
    const minimo = Math.max(1, this.motivoMinimo());
    const longitud = this.longitud();
    if (longitud >= minimo) return null;
    if (longitud === 0) {
      return this.intentado() ? 'El motivo de la anulación es obligatorio.' : null;
    }
    return `El motivo debe tener al menos ${minimo} caracteres (faltan ${minimo - longitud}).`;
  });

  /** `aria-describedby` del textarea: contador y, si hay fallo, su mensaje. */
  readonly descritoPor = computed(() =>
    this.errorMotivo() ? 'anular-motivo-contador anular-motivo-error' : 'anular-motivo-contador',
  );

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    // El panel sólo se cierra con Cancelar o Confirmar: Escape no lo descarta.
    this.destruccion.onDestroy(() => this.focoPrevio?.focus?.());
  }

  alEscribir(evento: Event): void {
    const objetivo = evento.target as HTMLTextAreaElement;
    this.motivo.set(objetivo.value);
  }

  alEnviarFormulario(evento: Event): void {
    evento.preventDefault();
    this.confirmar();
  }

  confirmar(): void {
    if (this.enviando() || !this.puedeConfirmar() || this.bloqueo()) return;

    if (this.esAnular()) {
      this.intentado.set(true);
      if (this.errorMotivo()) return;
      this.hecho.emit({ modo: 'anular', motivo: this.motivo().trim() });
      return;
    }

    // El backend restaura sin cuerpo ni motivo: basta la confirmación.
    this.hecho.emit({ modo: 'restaurar', motivo: null });
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /** El panel es modal: Tab y Shift+Tab ciclan dentro de él. */
  private atraparFoco(evento: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const enfocables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;

    const activo = document.activeElement;

    if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
      return;
    }

    if (evento.shiftKey && (activo === primero || !panel.contains(activo))) {
      evento.preventDefault();
      ultimo.focus();
    }
  }
}
