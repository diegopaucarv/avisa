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

import { formatearFechaCorta } from '../../dominio/mapeo';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';

import {
  etiquetaCriterioAlerta,
  type CandidatoDuplicadoAlerta,
  type CriterioDuplicadoAlerta,
} from './alerta-duplicados.mapeo';

const MINIMO_MOTIVO = 5;
const MAXIMO_MOTIVO = 500;

/** `descartar` cierra la alerta como ruido; `duplicada` la vincula a su original. */
export type ModoTriaje = 'descartar' | 'duplicada';

/** Lo que el modal devuelve al contenedor para armar el PATCH de triaje. */
export type ResultadoTriaje = {
  motivo: string;
  /** Sólo en modo `duplicada`: código legible de la alerta original. */
  duplicadaDeCodigo?: string;
};

/**
 * Ventana de triaje de una alerta: «Descartar alerta» y «Marcar como duplicada».
 *
 * No conoce HTTP: el contenedor pide los candidatos y ejecuta el PATCH contra
 * `/v1/red-radar/{id}/triaje`. El modal sólo valida el motivo (mínimo 5
 * caracteres, que exige la API) y, en modo duplicada, el código de la original.
 *
 * Regla G3 del proyecto, revisada: el modal se cierra con Escape, con el clic
 * fuera o con la ✕, haya o no texto escrito. Cerrar es seguro porque la salida
 * es animada y el contenedor conserva los datos hasta que termina.
 */
@Component({
  selector: 'app-alerta-triaje',
  imports: [IconoComponent],
  templateUrl: './alerta-triaje.component.html',
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

    .modal-texto {
      margin: 0;
      color: #526577;
      font-size: 13px;
      line-height: 1.55;
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

    /* Candidatos de duplicado: informan, no deciden. */
    .candidatos-cabecera {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }

    .candidatos-cabecera .form-label {
      margin: 0;
    }

    .candidatos {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .candidato {
      display: flex;
      flex-direction: column;
      gap: 3px;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #e6e0cd;
      border-radius: 7px;
      background: #fdf8ec;
      text-align: left;
      cursor: pointer;
    }

    .candidato:hover,
    .candidato:focus-visible {
      border-color: #d9b25a;
      outline: none;
    }

    .candidato[aria-pressed='true'] {
      border-color: #2f6f4f;
      background: #eef7f1;
    }

    .candidato-codigo {
      color: #7a5a16;
      font: 700 12.5px var(--font-body, inherit);
    }

    .candidato-titulo {
      color: #22303f;
      font-size: 13px;
      line-height: 1.35;
    }

    .candidato-meta {
      color: #647487;
      font-size: 12px;
    }

    .candidato-criterios {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 2px;
    }

    .candidato-chip {
      padding: 1px 7px;
      border: 1px solid #e8d3a3;
      border-radius: 10px;
      background: #fff;
      color: #7a5a16;
      font-size: 11.5px;
      font-weight: 600;
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
export class AlertaTriajeComponent {
  readonly modo = input<ModoTriaje>('descartar');
  /** Código o título de la alerta que se está triando; sólo para la cabecera. */
  readonly codigo = input('');
  readonly titulo = input('');
  readonly enviando = input(false);
  readonly errorEnvio = input<string | null>(null);

  /** Posibles originales cuando se marca como duplicada. */
  readonly candidatos = input<readonly CandidatoDuplicadoAlerta[]>([]);
  readonly verificando = input(false);
  readonly errorCandidatos = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly confirmar = output<ResultadoTriaje>();
  /** Pide al contenedor volver a consultar los candidatos. */
  readonly buscar = output<void>();

  readonly maximo = MAXIMO_MOTIVO;
  readonly minimo = MINIMO_MOTIVO;

  private readonly dialogo = viewChild<ElementRef<HTMLElement>>('dialogo');
  private readonly destruccion = inject(DestroyRef);

  readonly esDuplicada = computed(() => this.modo() === 'duplicada');
  readonly motivo = signal('');
  readonly codigoOriginal = signal('');
  private readonly intentado = signal(false);

  /** Código de la propia alerta: una alerta no puede ser duplicada de sí misma. */
  private readonly codigoPropio = computed(() => this.codigo().trim().toLowerCase());

  readonly longitud = computed(() => this.motivo().trim().length);

  readonly errorMotivo = computed(() => {
    const longitud = this.longitud();
    if (longitud >= MINIMO_MOTIVO) return null;
    if (longitud === 0) {
      return this.intentado() ? 'El motivo es obligatorio.' : null;
    }
    return `El motivo debe tener al menos ${MINIMO_MOTIVO} caracteres (faltan ${
      MINIMO_MOTIVO - longitud
    }).`;
  });

  readonly errorCodigo = computed(() => {
    if (!this.esDuplicada()) return null;
    const codigo = this.codigoOriginal().trim();
    if (codigo && codigo.toLowerCase() === this.codigoPropio()) {
      return 'Una alerta no puede ser duplicada de sí misma.';
    }
    if (!codigo && this.intentado()) {
      return 'El código de la alerta original es obligatorio.';
    }
    return null;
  });

  readonly valido = computed(
    () =>
      this.longitud() >= MINIMO_MOTIVO &&
      !this.errorCodigo() &&
      (!this.esDuplicada() || !!this.codigoOriginal().trim()),
  );

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

  campoMotivo(evento: Event): void {
    const area = evento.target as HTMLTextAreaElement;
    this.motivo.set(area.value.slice(0, MAXIMO_MOTIVO));
  }

  campoCodigo(evento: Event): void {
    this.codigoOriginal.set((evento.target as HTMLInputElement).value);
  }

  seleccionarCandidato(candidato: CandidatoDuplicadoAlerta): void {
    this.codigoOriginal.set(candidato.codigo);
  }

  estaElegido(candidato: CandidatoDuplicadoAlerta): boolean {
    return this.codigoOriginal().trim().toLowerCase() === candidato.codigo.trim().toLowerCase();
  }

  etiquetaCriterio(criterio: CriterioDuplicadoAlerta): string {
    return etiquetaCriterioAlerta(criterio);
  }

  fecha(valor: string | null): string {
    return formatearFechaCorta(valor);
  }

  alBuscar(): void {
    if (this.verificando()) return;
    this.buscar.emit();
  }

  /** El clic fuera cierra; arrastrar dentro del contenido no. */
  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarConSalida();
  }

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.dialogo()?.nativeElement, () => this.cerrar.emit());
  }

  alConfirmar(): void {
    if (this.enviando()) return;
    this.intentado.set(true);
    if (!this.valido()) return;

    const motivo = this.motivo().trim();
    if (!this.esDuplicada()) {
      this.confirmar.emit({ motivo });
      return;
    }
    this.confirmar.emit({ motivo, duplicadaDeCodigo: this.codigoOriginal().trim() });
  }
}
