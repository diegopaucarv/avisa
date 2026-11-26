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
  viewChild,
} from '@angular/core';

import { formatearFechaHora } from '../../shared/formato-fecha';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import type { FilaArchivo } from './archivo.tipos';

/**
 * Panel lateral derecho del archivo.
 *
 * Sigue el patrón de `DocumentoPanelComponent`: es un diálogo modal
 * (`role="dialog"`, `aria-modal`), se cierra con Escape y devuelve el foco al
 * elemento que lo abrió; Tab y Shift+Tab ciclan dentro del panel.
 *
 * No consulta nada: muestra la fila anulada que ya trae el listado (motivo,
 * fecha, autor y lote). La restauración la ejecuta la página con el POST del
 * endpoint correspondiente; aquí sólo se emite la intención.
 */
@Component({
  selector: 'app-archivo-panel',
  imports: [IconoComponent],
  templateUrl: './archivo-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    /* El drawer global mide 600 px; la ficha de una fila anulada es más breve. */
    .drawer {
      width: min(540px, 100%);
    }

    .panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .panel-codigo {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .panel-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }

    .panel-anulado {
      background: #fbeeec;
      color: #a34c45;
    }

    .panel-entidad {
      background: #f0f3f5;
      color: #657684;
    }

    .panel-aviso-warn {
      margin: 0;
      padding: 9px 11px;
      border: 1px solid #f3ddb6;
      border-radius: 6px;
      background: #fdf7ea;
      color: #8a6521;
      font-size: 13px;
      line-height: 1.55;
    }

    .drawer-body .detail-section {
      padding: 14px 0;
      border-top: 1px solid #eef2f6;
    }

    .drawer-body .detail-section:first-of-type {
      padding-top: 0;
      border-top: 0;
    }

    /* Los títulos de subsección del panel modal van en mayúsculas. */
    .drawer-body .detail-section h3 {
      text-transform: uppercase;
    }

    .panel-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 16px;
      margin: 10px 0 0;
    }

    .panel-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .panel-datos dt {
      color: #97a1aa;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .panel-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .panel-lote {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }

    .panel-texto {
      margin: 8px 0 0;
      color: #52677a;
      font-size: 13px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .panel-vacio {
      margin: 8px 0 0;
      color: #a0aab3;
      font-size: 13px;
      font-style: italic;
    }

    .panel-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid #eef2f6;
    }
  `,
})
export class ArchivoPanelComponent {
  private readonly destruccion = inject(DestroyRef);

  readonly fila = input.required<FilaArchivo>();
  /** Etiqueta singular de la entidad («Caso», «Alerta», …). */
  readonly entidad = input.required<string>();
  /** Aviso propio de la pestaña (el caso devuelve todo su lote). */
  readonly advertencia = input<string | null>(null);
  readonly enviando = input(false);
  readonly error = input<string | null>(null);

  readonly cerrado = output<void>();
  readonly restaurar = output<void>();

  readonly referencia = computed(() => {
    const fila = this.fila();
    return fila.codigo || fila.titulo || fila.id.slice(0, 8) || 'Registro';
  });

  readonly autor = computed(() => {
    const fila = this.fila();
    return fila.anuladoPorNombre || fila.anuladoPor || '—';
  });

  readonly lote = computed(() => this.fila().anulacionId || '—');

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    if (typeof document !== 'undefined') {
      // Escape cierra el panel aunque el foco se haya ido a un bloque de texto.
      const alEscape = (evento: KeyboardEvent): void => {
        if (evento.key !== 'Escape') return;
        evento.preventDefault();
        this.cerrarConSalida();
      };
      document.addEventListener('keydown', alEscape);
      this.destruccion.onDestroy(() => {
        document.removeEventListener('keydown', alEscape);
        this.focoPrevio?.focus?.();
      });
    }
  }

  formatearFechaHora(valor: string | null | undefined): string {
    return formatearFechaHora(valor);
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarConSalida();
  }

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.panel()?.nativeElement, () => this.cerrado.emit());
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
