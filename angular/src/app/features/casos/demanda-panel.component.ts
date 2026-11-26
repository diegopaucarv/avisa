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
  untracked,
  viewChild,
} from '@angular/core';

import type { DemandaCaso } from '../../dominio/mapeo';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import { ESTADOS_DEMANDA } from './demanda-sin-caso.mapeo';

/** Opción del catálogo de temáticas. El `id` es lo que viaja como `tematicaId`. */
export type OpcionTematicaDemanda = {
  id: number;
  nombre: string;
};

/** Demanda con su temática ya resuelta por la API (`A4`). */
export type DemandaConTematica = DemandaCaso & {
  tematica: string | null;
  tematicaId: number | null;
};

/**
 * Cuerpo parcial de `POST /api/v1/demandas` (alta) y
 * `PATCH /api/v1/demandas/:id` (edición). Las demandas se registran como un
 * único texto (`descripcion`) desde el ajuste del 22 nov: las 3P se retiraron
 * de la interfaz y ya no viajan en el cuerpo.
 *
 * `tematicaId` es obligatorio en el contrato nuevo (la API responde 422 sin
 * temática). `tematica` viaja con el nombre porque el repositorio anterior
 * resolvía la temática por id o por nombre; enviar ambos mantiene la escritura
 * correcta durante el despliegue en paralelo de la API.
 */
export type CuerpoDemanda = {
  casoCode?: string;
  descripcion?: string | null;
  estado?: string;
  tematicaId?: number | null;
  tematica?: string | null;
};

/** Compara nombres de temática sin tildes ni mayúsculas. */
function normalizarTematica(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

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
  readonly demanda = input<DemandaConTematica | null>(null);
  readonly codigoCaso = input<string>('');
  readonly organizaciones = input<readonly string[]>([]);
  /** Catálogo de temáticas (`id` + nombre) que resuelve el contenedor. */
  readonly tematicas = input<readonly OpcionTematicaDemanda[]>([]);
  readonly cargandoTematicas = input(false);
  readonly puedeModificar = input(true);
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);

  readonly cerrar = output<void>();

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.panel()?.nativeElement, () => this.cerrar.emit());
  }
  readonly guardar = output<CuerpoDemanda>();

  readonly borrador = signal<BorradorDemanda>({
    demanda: '',
    estado: 'Pendiente',
  });
  readonly mensajeLocal = signal<string | null>(null);

  /** Temática elegida; `null` hasta que el usuario o la carga inicial la fijen. */
  readonly tematicaId = signal<number | null>(null);

  /** Nombre de la temática elegida; acompaña al id en el cuerpo. */
  private readonly tematicaNombre = computed(() => {
    const id = this.tematicaId();
    if (id === null) return null;
    return this.tematicas().find((opcion) => opcion.id === id)?.nombre ?? null;
  });

  /**
   * Temática con la que abre la edición. Prefiere el `tematicaId` que ya trae
   * la demanda y, si el contrato sólo trae el nombre, lo resuelve contra el
   * catálogo en cuanto termina de cargar.
   */
  private readonly tematicaInicial = computed<number | null>(() => {
    const demanda = this.demanda();
    if (!demanda) return null;
    if (typeof demanda.tematicaId === 'number') return demanda.tematicaId;
    return this.idDeTematica(demanda.tematica);
  });

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

    // El panel sólo se cierra con Cancelar o Registrar: Escape no lo descarta.
    this.destruccion.onDestroy(() => this.focoPrevio?.focus?.());

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

    // La temática inicial se resuelve con el catálogo ya cargado, sin pisar una
    // elección explícita del usuario (si `tematicaId` ya tiene valor, no se toca).
    effect(() => {
      const inicial = this.tematicaInicial();
      if (untracked(() => this.tematicaId()) !== null) return;
      if (inicial !== null) this.tematicaId.set(inicial);
    });
  }

  /** Id del catálogo que corresponde a un nombre de temática; `null` si no hay. */
  private idDeTematica(nombre: string | null | undefined): number | null {
    const buscado = normalizarTematica(nombre ?? '');
    if (!buscado) return null;
    const opcion = this.tematicas().find(
      (candidata) => normalizarTematica(candidata.nombre) === buscado,
    );
    return opcion?.id ?? null;
  }

  elegirTematica(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    this.tematicaId.set(valor ? Number(valor) : null);
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

    // La temática es obligatoria en el contrato nuevo: se comprueba antes de
    // enviar para no depender del 422 de la API.
    const tematicaId = this.tematicaId();
    if (tematicaId === null) {
      this.mensajeLocal.set('La temática es obligatoria.');
      return;
    }
    const tematica = this.tematicaNombre();

    if (!actual) {
      const casoCode = this.codigoCaso().trim();
      if (!casoCode) {
        this.mensajeLocal.set('No se pudo identificar el caso de la demanda.');
        return;
      }

      // Alta: `POST /api/v1/demandas` exige `descripcion` no vacía y temática.
      const cambios: CuerpoDemanda = {
        casoCode,
        descripcion: texto,
        estado: estado || 'Pendiente',
        tematicaId,
        ...(tematica ? { tematica } : {}),
      };

      this.mensajeLocal.set(null);
      this.guardar.emit(cambios);
      return;
    }

    // Edición: sólo los campos que cambian, salvo la temática, que viaja
    // siempre porque el contrato nuevo la exige también al editar. La
    // descripción no se vacía: el cuerpo del `PATCH` la exige.
    const anterior = (actual.descripcion ?? actual.problema ?? '').trim();
    const cambiaDemanda = texto !== anterior;
    const cambiaEstado = Boolean(estado) && estado !== (actual.estado ?? '');
    const cambiaTematica = tematicaId !== this.tematicaInicial();

    if (!cambiaDemanda && !cambiaEstado && !cambiaTematica) {
      this.mensajeLocal.set('No hay cambios que guardar.');
      return;
    }

    const cambios: CuerpoDemanda = {
      tematicaId,
      ...(tematica ? { tematica } : {}),
    };
    if (cambiaDemanda) cambios.descripcion = texto;
    if (cambiaEstado) cambios.estado = estado;

    this.mensajeLocal.set(null);
    this.guardar.emit(cambios);
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
