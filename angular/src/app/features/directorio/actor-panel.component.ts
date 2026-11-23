import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { urlApi } from '../../core/config/entorno';
import { urlConParametros } from '../../core/http/coleccion';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  aActorDirectorio,
  aDatosPersonales,
  FUNCIONES_ACTOR,
  NATURALEZAS,
  POSICIONAMIENTOS_ACTOR,
  TIPOS_ACTOR,
  type ActorDirectorio,
  type DatosPersonales,
} from './directorio.mapeo';

/**
 * Motivo que se envía con la solicitud de PII. La base lo registra en
 * `audit.datos_personales_acceso` antes de descifrar (principio de finalidad,
 * Ley 29733); por eso debe ser concreto y no un texto genérico de relleno.
 */
const MOTIVO_PII = 'Consulta de datos personales desde el directorio';

type EstadoPii = 'inactivo' | 'cargando' | 'listo' | 'prohibido' | 'error';
type CampoActorEdicion =
  | 'nombre'
  | 'abreviatura'
  | 'naturaleza'
  | 'tipo'
  | 'funcion'
  | 'posicionamiento'
  | 'cargo'
  | 'nivelGobierno'
  | 'categoria'
  | 'perfilDescripcion';
type ActorEdicion = Record<CampoActorEdicion, string> & { activo: boolean };

/**
 * Ficha lateral de un actor del directorio.
 *
 * Se abre al pulsar una fila; no navega. Toda la caracterización viene del
 * listado (`GET /api/v1/actors`) y se pinta al instante. Los datos personales
 * son la única excepción: se piden sólo al pulsar «Ver DNI y teléfonos», con un
 * motivo explícito, y se descartan al cerrar el panel o cambiar de actor.
 *
 * No usa `consulta` a propósito: esa fachada cachea por URL y conservaría la PII
 * en memoria. Aquí la petición vive en el ciclo de vida del panel.
 */
@Component({
  selector: 'app-actor-panel',
  imports: [IconoComponent],
  templateUrl: './actor-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    /* El drawer global mide 600 px; la ficha se lee mejor algo más estrecha. */
    .drawer {
      width: min(560px, 100%);
    }

    .actor-panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .actor-panel-etiqueta {
      margin: 0;
      color: #8a98a5;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .drawer-head h2 {
      margin: 0;
      color: #1c2a38;
      font: 700 16px/1.35 var(--font-display);
      overflow-wrap: anywhere;
    }

    .actor-panel-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }

    .actor-chip {
      background: #f0f3f5;
      color: #657684;
    }

    .actor-validado {
      background: #edf4ef;
      color: #557a64;
    }

    .actor-pendiente {
      background: #fff3e5;
      color: #a6732d;
    }

    .actor-seccion {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .actor-seccion h3 {
      margin: 0;
      color: #33475b;
      font: 700 11px var(--font-display);
    }

    .actor-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px 16px;
      margin: 0;
    }

    .actor-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .actor-datos dt {
      color: #97a1aa;
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .actor-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 10.5px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .actor-perfil {
      margin: 0;
      color: #52677a;
      font-size: 11px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .actor-nota {
      margin: 0;
      color: #8d99a6;
      font-size: 10px;
      line-height: 1.5;
    }

    .actor-vacio {
      margin: 0;
      color: #a0aab3;
      font-size: 10.5px;
      font-style: italic;
    }

    .actor-error {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid #f0d9d5;
      border-radius: 6px;
      background: #fdf6f5;
      color: #a3402f;
      font-size: 10.5px;
    }

    .actor-error p {
      margin: 0;
    }

    .actor-pii {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border: 1px solid #e6ebf0;
      border-radius: 8px;
      background: #fafbfc;
    }

    .actor-pii > button {
      align-self: flex-start;
    }

    .actor-pii-aviso {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin: 0;
      color: #7d8b98;
      font-size: 9.5px;
      line-height: 1.5;
    }

    .actor-pii-aviso app-icono {
      margin-top: 1px;
      color: #96a3af;
    }

    .actor-editar-boton {
      align-self: flex-start;
      margin-bottom: 4px;
    }

    .actor-editor {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .actor-editor h3,
    .actor-editor > p,
    .actor-editor-ancho {
      grid-column: 1 / -1;
    }

    .actor-editor h3 {
      margin: 0;
      color: #33475b;
      font: 700 12px var(--font-display);
    }

    .actor-editor label {
      display: grid;
      gap: 5px;
      color: #596c7e;
      font-size: 10px;
      font-weight: 600;
    }

    .actor-editor input:not([type='checkbox']),
    .actor-editor select,
    .actor-editor textarea {
      width: 100%;
      min-height: 34px;
      padding: 7px 9px;
      border: 1px solid #dce3e8;
      border-radius: 6px;
      background: #fff;
      color: #33475b;
      font: inherit;
      font-weight: 400;
    }

    .actor-editor textarea {
      resize: vertical;
    }

    .actor-editor-estado {
      display: flex !important;
      grid-column: 1 / -1;
      align-items: center;
      gap: 8px !important;
    }

    .actor-editor-acciones {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid #edf0f2;
    }

    @media (max-width: 520px) {
      .actor-editor {
        grid-template-columns: 1fr;
      }

      .actor-editor h3,
      .actor-editor > p,
      .actor-editor-ancho,
      .actor-editor-estado {
        grid-column: 1;
      }
    }
  `,
})
export class ActorPanelComponent {
  readonly actor = input<ActorDirectorio | null>(null);

  readonly cerrar = output<void>();

  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);
  private readonly destruccion = inject(DestroyRef);

  /** El botón de PII sólo existe si el rol tiene el permiso. */
  readonly puedeVerPii = this.capacidades.puedeVerPii;
  readonly puedeEditar = computed(() =>
    this.capacidades.puedeModificar(this.actor()?.clasificacion),
  );
  readonly tiposActor = TIPOS_ACTOR;
  readonly funcionesActor = FUNCIONES_ACTOR;
  readonly posicionamientos = POSICIONAMIENTOS_ACTOR;
  readonly naturalezas = NATURALEZAS;
  readonly actualizado = output<ActorDirectorio>();

  readonly editando = signal(false);
  readonly guardandoEdicion = signal(false);
  readonly errorEdicion = signal<string | null>(null);
  readonly borrador = signal<ActorEdicion>({
    nombre: '',
    abreviatura: '',
    naturaleza: 'persona',
    tipo: '',
    funcion: '',
    posicionamiento: '',
    cargo: '',
    nivelGobierno: '',
    categoria: '',
    perfilDescripcion: '',
    activo: true,
  });

  readonly estadoPii = signal<EstadoPii>('inactivo');
  readonly errorPii = signal<string | null>(null);
  readonly datos = signal<DatosPersonales | null>(null);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  /** Identificador de la ficha cuyos datos personales se están mostrando. */
  private actorVigente: string | null = null;

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    // Al cambiar de fila se descarta cualquier PII del actor anterior: la ficha
    // no debe arrastrar datos de una selección previa.
    effect(() => {
      const id = this.actor()?.id ?? null;
      if (id === this.actorVigente) return;
      this.actorVigente = id;
      this.reiniciarPii();
    });

    // Escape cierra el panel aunque el foco se haya ido a un bloque de texto.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar.emit();
    };
    document.addEventListener('keydown', alEscape);

    this.destruccion.onDestroy(() => {
      document.removeEventListener('keydown', alEscape);
      this.focoPrevio?.focus?.();
      this.reiniciarPii();
    });
  }

  iniciarEdicion(): void {
    const actor = this.actor();
    if (!actor || !this.puedeEditar()) return;
    this.borrador.set({
      nombre: actor.nombre,
      abreviatura: actor.abreviatura ?? '',
      naturaleza: actor.naturaleza === 'Organización' ? 'organizacion' : 'persona',
      tipo: actor.tipo ?? '',
      funcion: actor.funcion ?? '',
      posicionamiento: actor.posicionamiento ?? '',
      cargo: actor.cargo ?? '',
      nivelGobierno: actor.nivelGobierno ?? '',
      categoria: actor.categoria ?? '',
      perfilDescripcion: actor.perfil ?? '',
      activo: actor.activo,
    });
    this.errorEdicion.set(null);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.errorEdicion.set(null);
    this.editando.set(false);
  }

  actualizarTexto(campo: CampoActorEdicion, evento: Event): void {
    const valor = (evento.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    this.borrador.update((actual) => ({ ...actual, [campo]: valor }));
  }

  actualizarActivo(evento: Event): void {
    this.borrador.update((actual) => ({
      ...actual,
      activo: (evento.target as HTMLInputElement).checked,
    }));
  }

  guardarEdicion(evento: Event): void {
    evento.preventDefault();
    const actor = this.actor();
    const draft = this.borrador();
    if (!actor || !this.puedeEditar() || this.guardandoEdicion()) return;
    if (!draft.nombre.trim()) {
      this.errorEdicion.set('El nombre del actor es obligatorio.');
      return;
    }

    this.guardandoEdicion.set(true);
    this.errorEdicion.set(null);
    const payload = {
      ...draft,
      nivelGobierno: draft.nivelGobierno.replace(/ /g, '_') || null,
      abreviatura: draft.abreviatura || null,
      cargo: draft.cargo || null,
      categoria: draft.categoria || null,
      perfilDescripcion: draft.perfilDescripcion || null,
      tipo: draft.tipo || undefined,
      funcion: draft.funcion || undefined,
      posicionamiento: draft.posicionamiento || null,
    };

    this.http
      .patch<unknown>(urlApi(`/v1/actors/${encodeURIComponent(actor.id)}`), payload)
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: (respuesta) => {
          this.actualizado.emit(aActorDirectorio(respuesta));
          this.editando.set(false);
          this.guardandoEdicion.set(false);
        },
        error: (fallo: unknown) => {
          this.errorEdicion.set(aErrorApi(fallo).message);
          this.guardandoEdicion.set(false);
        },
      });
  }

  /**
   * Pide DNI, correo y teléfonos. Nunca se llama al cargar la ficha: sólo desde
   * el botón, y una sola vez por pulsación (el estado `cargando` frena el doble
   * envío para no duplicar el registro de auditoría).
   */
  solicitarPii(): void {
    const ficha = this.actor();
    if (!ficha?.id) return;

    if (!this.puedeVerPii()) {
      this.estadoPii.set('prohibido');
      this.errorPii.set('Su rol no permite ver datos personales.');
      return;
    }

    if (this.estadoPii() === 'cargando') return;

    this.estadoPii.set('cargando');
    this.errorPii.set(null);
    this.datos.set(null);

    const url = urlConParametros(urlApi(`/v1/actors/${encodeURIComponent(ficha.id)}/pii`), {
      motivo: MOTIVO_PII,
    });

    this.http
      .get<unknown>(url)
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: (bruto) => {
          this.datos.set(aDatosPersonales(bruto));
          this.estadoPii.set('listo');
        },
        error: (fallo: unknown) => {
          const error = aErrorApi(fallo);
          this.datos.set(null);

          if (error.esProhibido) {
            // Sin reintento automático: insistir sólo repetiría el 403.
            this.errorPii.set('Su rol no permite ver datos personales.');
            this.estadoPii.set('prohibido');
            return;
          }

          this.errorPii.set(error.message);
          this.estadoPii.set('error');
        },
      });
  }

  /** Descarta lo mostrado sin cerrar el panel; un nuevo acceso vuelve a auditarse. */
  ocultarPii(): void {
    this.reiniciarPii();
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar.emit();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  private reiniciarPii(): void {
    this.datos.set(null);
    this.errorPii.set(null);
    this.estadoPii.set('inactivo');
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
