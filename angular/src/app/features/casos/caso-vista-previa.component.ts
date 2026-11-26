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
import { RouterLink } from '@angular/router';

import { formatearFecha } from '../../shared/formato-fecha';
import type { Caso } from '../../dominio/modelos';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';

/**
 * Vista previa del caso (item 101).
 *
 * No es la ficha: la ficha tiene ocho secciones y nueve tablas. Esta tarjeta
 * expandida muestra lo que un evaluador necesita para reconocer el caso —código,
 * título, conflictividad, riesgo, región, resumen y actualización— y ofrece los
 * accesos directos a las secciones de la ficha (línea de tiempo, actores,
 * demandas, acuerdos y documentos), que se abren por `fragment`. «Caso de
 * análisis (Canva)» se declara no disponible: el campo no existe en `core.casos`
 * y no se simula un enlace que nadie puede abrir.
 *
 * Repite el patrón canónico del panel lateral: fondo clicable, Escape, foco
 * encerrado y devuelto al cerrar.
 */
@Component({
  selector: 'app-caso-vista-previa',
  imports: [RouterLink, IconoComponent],
  templateUrl: './caso-vista-previa.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .previa-codigo {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .previa-sub {
      margin: 4px 0 0;
      color: #647487;
      font-size: 12.5px;
    }

    .previa-cabecera {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 12px;
    }

    .previa-actualizacion {
      color: var(--muted);
      font-size: 12.5px;
    }

    .previa-resumen-titulo {
      margin: 0 0 6px;
      color: var(--ink);
      font-size: 13px;
      font-weight: 700;
    }

    .previa-meta {
      display: grid;
      gap: 10px;
      margin: 0;
    }

    .previa-meta > div {
      display: grid;
      grid-template-columns: 38% 1fr;
      gap: 10px;
      align-items: baseline;
    }

    .previa-meta dt {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .previa-meta dd {
      margin: 0;
      color: var(--ink);
      font-size: 13px;
    }

    .previa-badges {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }

    /*
     * Cada línea envuelve por su cuenta: en móvil la primera puede partirse
     * entre región, riesgo y estado sin arrastrar la conflictividad, que va
     * siempre en su propia fila.
     */
    .previa-badges-linea {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .previa-resumen {
      margin: 0 0 14px;
      color: var(--ink-2);
      font-size: 13px;
      line-height: 1.6;
      text-align: justify;
    }

    .previa-accesos {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 16px 0 0;
      padding: 0;
      list-style: none;
    }

    .previa-acceso {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font: 600 13px var(--font-body);
      text-align: left;
      text-decoration: none;
      cursor: pointer;
    }

    .previa-acceso:hover,
    .previa-acceso:focus-visible {
      border-color: #c9d5e0;
      background: var(--blue-pale);
      color: var(--blue-dark);
    }

    .previa-acceso[aria-disabled='true'] {
      border-style: dashed;
      background: var(--canvas);
      color: var(--muted);
      cursor: not-allowed;
    }

    .previa-acceso small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 400;
    }

    .previa-canva-editor {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      grid-column: 1 / -1;
    }

    .previa-canva-editor input {
      flex: 1 1 220px;
      min-width: 0;
      height: 34px;
      padding: 0 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      font-size: 12.5px;
    }

    .previa-canva-vacio small {
      color: #a1abb4;
    }

    .previa-canva-vacio:disabled {
      cursor: default;
    }

    .previa-canva-mas {
      margin-left: auto;
      color: var(--muted);
      font-size: 15px;
      line-height: 1;
    }

    .previa-nota {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
  `,
})
export class CasoVistaPreviaComponent {
  readonly caso = input.required<Caso>();
  readonly puedeEditar = input(false);
  readonly cerrar = output<void>();

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.panel()?.nativeElement, () => this.cerrar.emit());
  }
  /** URL del tablero de Canva que el contenedor persiste con `PATCH`. */
  readonly guardarEnlace = output<string>();

  /** Un caso archivado ya no tiene riesgo operativo: se muestra «Inactivo». */
  readonly estaArchivado = computed(() => this.caso().estado === 'Archivado');

  readonly riesgoVisible = computed(() => (this.estaArchivado() ? 'Inactivo' : this.caso().riesgo));

  /** Sin color de nivel cuando está archivado: el badge queda neutro. */
  readonly claseRiesgo = computed(() =>
    this.estaArchivado() ? 'status-badge' : 'status-badge risk-' + this.caso().riesgo.toLowerCase(),
  );

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);
  private focoPrevio: HTMLElement | null = null;

  constructor() {
    afterNextRender(() => {
      this.focoPrevio = document.activeElement as HTMLElement | null;
      this.panel()?.nativeElement.focus({ preventScroll: true });
    });

    this.destruccion.onDestroy(() => this.focoPrevio?.focus?.());
  }

  /** Fecha en formato compacto (`02NOV2025`). */
  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor) || '—';
  }

  readonly editandoCanva = signal(false);
  readonly borradorCanva = signal('');

  abrirCanva(): void {
    if (!this.puedeEditar()) return;
    this.borradorCanva.set(this.caso().enlaceAnalisis ?? '');
    this.editandoCanva.set(true);
  }

  cancelarCanva(): void {
    this.editandoCanva.set(false);
    this.borradorCanva.set('');
  }

  alEscribirCanva(evento: Event): void {
    this.borradorCanva.set((evento.target as HTMLInputElement).value);
  }

  guardarCanva(evento: Event): void {
    evento.preventDefault();
    const url = this.borradorCanva().trim();
    if (!url) return;
    this.guardarEnlace.emit(url);
    this.cancelarCanva();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /** Mantiene el tabulador dentro del panel mientras está abierto. */
  private atraparFoco(evento: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const enfocables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((elemento) => elemento.offsetParent !== null);
    if (enfocables.length === 0) return;

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const activo = document.activeElement;

    if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
      return;
    }
    if (evento.shiftKey && activo === primero) {
      evento.preventDefault();
      ultimo.focus();
    }
  }
}
