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

import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';
import { esDialogoSuperior, salirModal } from '../../shared/ui/modal-salida';
import {
  formatearFecha as formatearFechaDocumento,
  type Documento,
} from '../documentos/documento.mapeo';
import {
  PASO_APROBACION_DEFINITIVA,
  accionesDeFlujo,
  claseEstadoProducto,
  etapaDeFlujo,
  etapaDeProducto,
  etapasProducto,
  pasoDeProducto,
  type AccionFlujo,
  type EtapaProducto,
} from './producto.mapeo';

/**
 * Ficha lateral de un producto del diálogo.
 *
 * Reproduce la estructura de `alerta-panel`: cabecera con identificación y
 * etapa, cuerpo por secciones y pie con las acciones del flujo. La ficha no
 * edita contenido: sólo propone la transición y la confirma antes de emitirla,
 * para que el contenedor haga el `PATCH` y refresque el listado.
 *
 * El panel no se cierra al pulsar el velo y Escape sólo sale cuando no hay una
 * confirmación abierta ni un guardado en curso.
 */
@Component({
  selector: 'app-producto-panel',
  imports: [IconoComponent],
  templateUrl: './producto-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .producto-drawer {
      width: min(560px, 100%);
    }

    .producto-cabecera {
      min-width: 0;
    }

    .producto-codigo {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .producto-titulo {
      margin: 4px 0 0;
      color: var(--ink);
      font-size: 18px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .producto-insignias {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 7px;
      color: var(--muted);
      font-size: 13px;
    }

    .producto-tipo {
      color: var(--ink-2);
      font-weight: 600;
    }

    .producto-seccion {
      padding: 13px;
      border: 1px solid var(--line);
      border-radius: 10px;
    }

    .producto-seccion h3 {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .producto-seccion-cabecera {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .producto-seccion-cabecera h3 {
      margin: 0;
    }

    .flujo-seccion {
      background: var(--canvas);
    }

    .flujo-pasos {
      display: grid;
      gap: 7px;
      margin: 12px 0 0;
      padding: 0;
      list-style: none;
    }

    .flujo-paso {
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--muted);
    }

    .flujo-paso-marca {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: var(--paper);
      font-size: 11px;
      font-weight: 700;
    }

    .flujo-paso--hecho .flujo-paso-marca {
      border-color: #cfe4d8;
      background: #edf6f0;
      color: #52806a;
    }

    .flujo-paso--actual {
      color: var(--ink);
    }

    .flujo-paso--actual .flujo-paso-marca {
      border-color: var(--blue);
      background: var(--blue);
      color: #fff;
    }

    .flujo-paso-texto {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .flujo-paso-texto strong {
      font-size: 13px;
    }

    .flujo-paso-texto small {
      color: var(--muted);
      font-size: 11.5px;
    }

    .flujo-actual {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 12.5px;
    }

    .flujo-confirmacion {
      padding: 12px 13px;
      border: 1px solid #f0d9b5;
      border-radius: 10px;
      background: #fff8ee;
    }

    .flujo-confirmacion p {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      color: var(--ink-2);
      font-size: 13px;
      line-height: 1.45;
    }

    .flujo-confirmacion p + p {
      margin-top: 7px;
      color: var(--muted);
    }

    .producto-datos {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 16px;
      margin: 0;
    }

    .producto-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .producto-datos dt {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .producto-datos dd {
      margin: 0;
      color: var(--ink);
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .producto-texto {
      margin: 0;
      color: var(--ink-2);
      font-size: 13.5px;
      line-height: 1.55;
      white-space: pre-wrap;
    }

    .producto-vacio {
      margin: 0;
      color: var(--muted);
      font-style: italic;
    }

    @media (max-width: 760px) {
      .producto-datos {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ProductoPanelComponent {
  private readonly capacidades = inject(CapacidadesService);
  private readonly destruccion = inject(DestroyRef);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  readonly producto = input<Documento | null>(null);
  readonly cargando = input(false);
  readonly errorCarga = input<string | null>(null);
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);
  readonly aviso = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly reintentar = output<void>();
  readonly accion = output<AccionFlujo>();

  /** Acción elegida a la espera de confirmación explícita. */
  readonly accionPendiente = signal<AccionFlujo | null>(null);

  readonly etapas = etapasProducto;

  readonly paso = computed(() => {
    const producto = this.producto();
    return producto ? pasoDeProducto(producto) : 1;
  });

  readonly etapa = computed<EtapaProducto | null>(() => {
    const producto = this.producto();
    return producto ? etapaDeProducto(producto) : null;
  });

  readonly puedeModificar = computed(() =>
    this.capacidades.puedeModificar(this.producto()?.clasificacion ?? 1),
  );

  readonly esDireccion = this.capacidades.esDireccion;

  /**
   * Acciones visibles: sólo las que el rol puede ejecutar. Aprobar (paso 3)
   * es potestad de la Dirección, igual que en alertas; el resto exige escritura
   * sobre la clasificación del documento.
   */
  readonly acciones = computed<readonly AccionFlujo[]>(() => {
    if (!this.puedeModificar()) return [];
    return accionesDeFlujo(this.paso()).filter(
      (accion) => accion.paso !== PASO_APROBACION_DEFINITIVA || this.esDireccion(),
    );
  });

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus({ preventScroll: true }));

    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      if (!esDialogoSuperior(this.panel()?.nativeElement)) return;
      evento.preventDefault();
      if (this.guardando()) return;
      if (this.accionPendiente()) {
        this.cancelarAccion();
        return;
      }
      this.cerrarConSalida();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', alEscape);
      this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
    }
  }

  /** Una acción de avance es primaria; las devoluciones quedan secundarias. */
  esAvance(accion: AccionFlujo): boolean {
    return accion.paso > this.paso();
  }

  pedirAccion(accion: AccionFlujo): void {
    if (!this.puedeModificar() || this.guardando()) return;
    this.accionPendiente.set(accion);
  }

  cancelarAccion(): void {
    if (this.guardando()) return;
    this.accionPendiente.set(null);
  }

  confirmarAccion(): void {
    const accion = this.accionPendiente();
    if (!accion || this.guardando()) return;
    this.accion.emit(accion);
    // El contenedor ya recibió la orden; se oculta la confirmación para que el
    // pie vuelva a mostrar las acciones (deshabilitadas mientras guarda).
    this.accionPendiente.set(null);
  }

  claseEstado(estado: string | null | undefined): string {
    return claseEstadoProducto(estado);
  }

  /** Delegado con alias para que el nombre del método no parezca recursivo. */
  formatearFecha(valor: string | null | undefined): string {
    return formatearFechaDocumento(valor);
  }

  nombreDePaso(paso: number): string {
    return etapaDeFlujo(paso)?.nombre ?? `Paso ${paso}`;
  }

  cerrarConSalida(): void {
    salirModal(this.panel()?.nativeElement, () => this.cerrar.emit());
  }

  /** El clic fuera cierra; arrastrar dentro del contenido no. */
  alFondo(evento: MouseEvent): void {
    if (evento.target !== evento.currentTarget) return;
    // Una confirmación de flujo abierta se descarta antes de cerrar la ficha.
    if (this.accionPendiente()) {
      this.cancelarAccion();
      return;
    }
    this.cerrarConSalida();
  }
}
