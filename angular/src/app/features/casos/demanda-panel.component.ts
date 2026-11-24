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

import type { DemandaCaso } from '../../dominio/mapeo';
import { IconoComponent } from '../../shared/ui/icono.component';
import { ESTADOS_DEMANDA } from './demanda-sin-caso.mapeo';

/**
 * Cuerpo parcial de `POST /api/v1/demandas` (alta) y
 * `PATCH /api/v1/demandas/:id` (edición). Las demandas se registran como un
 * único texto (`descripcion`) desde el ajuste del 22 nov: las 3P se retiraron
 * de la interfaz y ya no viajan en el cuerpo.
 */
export type CuerpoDemanda = {
  casoCode?: string;
  descripcion?: string | null;
  estado?: string;
};

type BorradorDemanda = {
  demanda: string;
  estado: string;
};

type CampoBorrador = keyof BorradorDemanda;

/**
 * Panel lateral de una demanda de la ficha.
 *
 * Mismo patrón que `EventoPanelComponent`: diálogo modal, cierre con Escape o
 * con el fondo, foco encerrado con Tab y devuelto al disparador al cerrar.
 * Sirve para alta (`demanda === null`) y para edición. No conoce HTTP: emite el
 * cuerpo ya diffado y el contenedor decide entre `POST` y `PATCH`.
 *
 * La demanda es un único texto: el ajuste del 22 nov retiró la estructura 3P
 * (Problema · Propuesta · Pedido). Las organizaciones solicitantes se muestran
 * como distintivos de solo lectura: el caso ya las relaciona como actores.
 */
@Component({
  selector: 'app-demanda-panel',
  imports: [IconoComponent],
  templateUrl: './demanda-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .demanda-panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .demanda-panel-codigo {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .demanda-panel-sub {
      margin: 4px 0 0;
      color: #647487;
      font-size: 13px;
      line-height: 1.5;
    }

    .demanda-formulario {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Los rótulos de los campos del modal van en mayúsculas por el ajuste
       del 22 nov, aunque el tema global ya los estilice así. */
    .form-label {
      text-transform: uppercase;
    }

    /* Organizaciones solicitantes: distintivos de solo lectura. */
    .demanda-organizaciones {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
    }

    .demanda-organizaciones-titulo {
      margin: 0;
      color: #7b8896;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .demanda-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .demanda-formulario-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }
  `,
})
export class DemandaPanelComponent {
  readonly demanda = input<DemandaCaso | null>(null);
  readonly codigoCaso = input<string>('');
  readonly organizaciones = input<readonly string[]>([]);
  readonly puedeModificar = input(true);
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly guardar = output<CuerpoDemanda>();

  readonly borrador = signal<BorradorDemanda>({
    demanda: '',
    estado: 'Pendiente',
  });
  readonly mensajeLocal = signal<string | null>(null);

  /**
   * Valores admitidos por `ESTADOS_ATENCION` en `lib/db/repos/demandas.ts`
   * (Pendiente · En proceso · Atendida · Desestimada). Si la demanda trae un
   * estado fuera del catálogo se añade para no perder el valor precargado.
   */
  readonly opcionesEstado = computed<readonly string[]>(() => {
    const actual = this.borrador().estado.trim();
    if (!actual || ESTADOS_DEMANDA.includes(actual as (typeof ESTADOS_DEMANDA)[number])) {
      return ESTADOS_DEMANDA;
    }
    return [...ESTADOS_DEMANDA, actual];
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

    // El borrador se precarga con la demanda abierta (vacío en el alta) y se
    // reinicia si el contenedor cambia de demanda. La ficha heredada puede
    // traer el texto en `problema` (3P del legado): se toma como semilla.
    effect(() => {
      const demanda = this.demanda();
      this.borrador.set({
        demanda: (demanda?.descripcion ?? demanda?.problema ?? '').trim(),
        estado: demanda?.estado?.trim() || 'Pendiente',
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
    const texto = borrador.demanda.trim();
    const estado = borrador.estado.trim();
    const actual = this.demanda();

    if (!texto) {
      this.mensajeLocal.set('La demanda es obligatoria.');
      return;
    }

    if (!actual) {
      const casoCode = this.codigoCaso().trim();
      if (!casoCode) {
        this.mensajeLocal.set('No se pudo identificar el caso de la demanda.');
        return;
      }

      // Alta: `POST /api/v1/demandas` exige `descripcion` no vacía.
      const cambios: CuerpoDemanda = {
        casoCode,
        descripcion: texto,
        estado: estado || 'Pendiente',
      };

      this.mensajeLocal.set(null);
      this.guardar.emit(cambios);
      return;
    }

    // Edición: sólo los campos que cambian. La descripción es el texto de la
    // demanda y no se vacía: el cuerpo del `PATCH` la exige.
    const anterior = (actual.descripcion ?? actual.problema ?? '').trim();
    const cambios: CuerpoDemanda = {};
    if (texto !== anterior) cambios.descripcion = texto;
    if (estado && estado !== (actual.estado ?? '')) cambios.estado = estado;

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
