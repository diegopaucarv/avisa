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

import { type EventoCaso, esRegistro, leer, lista, texto } from '../../dominio/mapeo';
import { IconoComponent } from '../../shared/ui/icono.component';

/** Opción del catálogo `core.cat_tipos_hecho` tal como la expone `/api/v1/catalogs`. */
export type OpcionTipoHecho = {
  valor: string;
  etiqueta: string;
};

/**
 * `GET /api/v1/catalogs` → `catalogs.tiposHecho`.
 *
 * El repositorio de eventos resuelve el tipo por `nombre`, y el catálogo lo
 * devuelve igual en `codigo` y `etiqueta`, así que el valor enviado sirve para
 * ambos. El vocabulario nunca se codifica en el cliente.
 */
export function aTiposHecho(bruto: unknown): readonly OpcionTipoHecho[] {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  const opciones: OpcionTipoHecho[] = [];
  for (const item of lista(catalogo, ['tiposHecho'])) {
    const fila = esRegistro(item) ? item : {};
    const valor = texto(fila, ['etiqueta', 'nombre', 'codigo']);
    if (!valor) continue;
    opciones.push({ valor, etiqueta: texto(fila, ['etiqueta', 'nombre']) ?? valor });
  }
  return opciones;
}

/** Cuerpo parcial listo para `POST /events` (alta) o `PATCH /events/:id` (edición). */
export type CuerpoEvento = {
  fecha?: string | null;
  tipoHecho?: string | null;
  descripcion?: string;
  evidencia?: string | null;
};

/**
 * «Otro» es la salida de escape del catálogo: el ajuste del 22 nov la deja al
 * final de la lista para que no abra el desplegable.
 */
function esTipoOtro(opcion: OpcionTipoHecho): boolean {
  const valor = opcion.valor.trim().toLowerCase();
  const etiqueta = opcion.etiqueta.trim().toLowerCase();
  return valor === 'otro' || etiqueta === 'otro';
}

type BorradorEvento = {
  fecha: string;
  tipo: string;
  descripcion: string;
  evidencia: string;
};

type CampoBorrador = keyof BorradorEvento;

/**
 * Panel lateral de un hecho de la cronología.
 *
 * Mismo patrón que `AlertaPanelComponent`: diálogo modal (`role="dialog"`,
 * `aria-modal`), cierre con Escape o con el fondo, foco encerrado con Tab y
 * devuelto al disparador al cerrar. Sirve para alta (`evento === null`) y para
 * edición. No conoce HTTP: emite el cuerpo ya diffado y el contenedor decide
 * entre `POST` y `PATCH`.
 */
@Component({
  selector: 'app-evento-panel',
  imports: [IconoComponent],
  templateUrl: './evento-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .evento-panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .evento-panel-codigo {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .evento-panel-sub {
      margin: 4px 0 0;
      color: #647487;
      font-size: 13px;
      line-height: 1.5;
    }

    .evento-formulario {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Rótulos del modal en mayúsculas (ajuste del 22 nov). */
    .form-label {
      text-transform: uppercase;
    }

    .evento-formulario-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }
  `,
})
export class EventoPanelComponent {
  readonly evento = input<EventoCaso | null>(null);
  readonly tipos = input<readonly OpcionTipoHecho[]>([]);
  readonly cargandoTipos = input(false);
  readonly codigoCaso = input<string>('');
  readonly puedeModificar = input(true);
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly guardar = output<CuerpoEvento>();

  readonly borrador = signal<BorradorEvento>({
    fecha: '',
    tipo: '',
    descripcion: '',
    evidencia: '',
  });
  readonly mensajeLocal = signal<string | null>(null);

  /**
   * Opciones del `<select>`: el catálogo más el tipo actual si aún no ha llegado
   * la respuesta, con «Otro» siempre al final. Así el valor precargado no se
   * pierde mientras carga.
   */
  readonly opcionesTipo = computed<OpcionTipoHecho[]>(() => {
    const base = this.tipos();
    const actual = this.borrador().tipo.trim();
    const opciones =
      !actual || base.some((opcion) => opcion.valor === actual)
        ? [...base]
        : [{ valor: actual, etiqueta: actual }, ...base];
    // `sort` es estable: el resto del catálogo conserva su orden original.
    return opciones.sort((a, b) => Number(esTipoOtro(a)) - Number(esTipoOtro(b)));
  });

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    // Escape cierra el panel aunque el foco esté dentro de un campo de texto.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar.emit();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => {
      document.removeEventListener('keydown', alEscape);
      this.focoPrevio?.focus?.();
    });

    // El borrador se precarga con el hecho abierto (vacío en el alta) y se
    // reinicia si el contenedor cambia de hecho.
    effect(() => {
      const evento = this.evento();
      this.borrador.set({
        fecha: evento?.fecha ?? '',
        tipo: evento?.tipo ?? '',
        descripcion: evento?.descripcion ?? '',
        evidencia: evento?.evidencia ?? '',
      });
    });
  }

  campo(clave: CampoBorrador, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const valor = objetivo.value;
    this.borrador.update((actual) => ({ ...actual, [clave]: valor }));
  }

  alEnviarFormulario(evento: Event): void {
    evento.preventDefault();
    this.guardarCambios();
  }

  guardarCambios(): void {
    if (!this.puedeModificar() || this.guardando()) return;

    const borrador = this.borrador();
    const descripcion = borrador.descripcion.trim();
    if (!descripcion) {
      this.mensajeLocal.set('La descripción del hecho es obligatoria.');
      return;
    }

    const fecha = borrador.fecha.trim() || null;
    const tipo = borrador.tipo.trim() || null;
    const evidencia = borrador.evidencia.trim() || null;
    const actual = this.evento();

    if (!actual) {
      // Alta: la fecha vacía la completa el servidor con la del día.
      const cambios: CuerpoEvento = { descripcion };
      if (fecha) cambios.fecha = fecha;
      if (tipo) cambios.tipoHecho = tipo;
      if (evidencia) cambios.evidencia = evidencia;
      this.mensajeLocal.set(null);
      this.guardar.emit(cambios);
      return;
    }

    // Edición: sólo los campos que cambian. La fecha no se vacía porque la
    // columna es NOT NULL; dejarla igual no genera cambio.
    const cambios: CuerpoEvento = {};
    if (descripcion !== actual.descripcion.trim()) cambios.descripcion = descripcion;
    if (fecha && fecha !== (actual.fecha || null)) cambios.fecha = fecha;
    if (tipo !== (actual.tipo || null)) cambios.tipoHecho = tipo;
    if (evidencia !== (actual.evidencia || null)) cambios.evidencia = evidencia;

    if (Object.keys(cambios).length === 0) {
      this.mensajeLocal.set('No hay cambios que guardar.');
      return;
    }

    this.mensajeLocal.set(null);
    this.guardar.emit(cambios);
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar.emit();
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
