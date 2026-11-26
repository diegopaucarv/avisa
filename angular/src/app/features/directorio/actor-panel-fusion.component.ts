import { HttpClient } from '@angular/common/http';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, urlConParametros } from '../../core/http/coleccion';
import { aErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import {
  aActorDirectorio,
  MASCARA_CORREO,
  nivelIdentificacionDe,
  SIN_DATO,
  type ActorDirectorio,
} from './directorio.mapeo';

const MOTIVO_MINIMO = 10;

/** Resultado que el contenedor recibe para recargar el listado y cerrar. */
export type ResultadoFusion = {
  origenId: string;
  destinoId: string;
};

/**
 * Fusión de actores duplicados.
 *
 * El origen es el actor abierto; se elige el destino y se exige confirmación
 * explícita y un motivo (mínimo 10 caracteres). El origen **no se borra**: queda
 * inactivo y con su traza. La comparación lado a lado copia
 * `directorio-crud.html` → `openFusion()`; el correo se muestra enmascarado
 * porque la fusión no descifra PII.
 *
 * La API revalida la autoridad (RLS: crear + editar + eliminar y nivel 3): sólo
 * `sectorista` y `administrador` pueden fusionar.
 */
@Component({
  selector: 'app-actor-panel-fusion',
  imports: [IconoComponent],
  templateUrl: './actor-panel-fusion.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    .fusion-scrim {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      box-sizing: border-box;
    }

    .fusion-modal {
      display: flex;
      flex-direction: column;
      width: min(820px, 100%);
      max-height: min(92vh, 900px);
      overflow: hidden;
      border: 1px solid #e1e7ec;
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 24px 60px rgba(15, 35, 55, 0.28);
    }

    .fusion-cabecera {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 22px 12px;
      border-bottom: 1px solid #eef2f6;
    }

    .fusion-cabecera h2 {
      margin: 0;
      color: #1c2a38;
      font: 700 19px/1.3 var(--font-display);
    }

    .fusion-cabecera p {
      margin: 3px 0 0;
      color: #647487;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .fusion-cuerpo {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 16px 22px;
    }

    .fusion-aviso {
      margin: 0 0 14px;
      padding: 10px 12px;
      border: 1px solid #e6e0cf;
      border-radius: 8px;
      background: #fdfaf1;
      color: #7d6a35;
      font-size: 12.5px;
      line-height: 1.55;
    }

    .fusion-aviso strong {
      color: #5c4c22;
    }

    .fusion-campo {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 14px;
      color: #33475b;
      font-size: 12.5px;
      font-weight: 600;
    }

    .fusion-campo input {
      height: 36px;
      padding: 0 10px;
      border: 1px solid #dbe3ea;
      border-radius: 8px;
      background: #f7f9fb;
      font: 400 13.5px/1 var(--font-body, inherit);
      box-sizing: border-box;
    }

    .fusion-resultados {
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
      border: 1px solid #e6ebf0;
      border-radius: 8px;
      overflow: hidden;
    }

    .fusion-resultados li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-bottom: 1px solid #f0f4f7;
      color: #33475b;
      font-size: 12.5px;
    }

    .fusion-resultados li:last-child {
      border-bottom: 0;
    }

    .fusion-destino {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 14px;
      padding: 9px 11px;
      border-radius: 8px;
      background: #eaf1fb;
      color: #2455a2;
      font-size: 13px;
      font-weight: 600;
    }

    .fusion-origen {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 14px;
      padding: 9px 11px;
      border-radius: 8px;
      background: #eef2f6;
      color: #465a6c;
      font-size: 13px;
      font-weight: 600;
    }

    table.fusion-comparar {
      width: 100%;
      border-collapse: collapse;
      margin: 4px 0 16px;
      font-size: 12.5px;
    }

    table.fusion-comparar th,
    table.fusion-comparar td {
      padding: 8px 10px;
      border: 1px solid #e6ebf0;
      text-align: left;
      vertical-align: top;
      color: #33475b;
    }

    table.fusion-comparar th {
      color: #4c7099;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      background: #f7f9fb;
    }

    table.fusion-comparar td.campo {
      font-weight: 600;
      white-space: nowrap;
    }

    .fusion-vacio {
      color: #97a1aa;
    }

    .fusion-enmascarado {
      color: #97a1aa;
      letter-spacing: 0.08em;
    }

    .fusion-confirmar {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 4px 0 0;
      color: #465a6c;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .fusion-motivo {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 14px;
      color: #33475b;
      font-size: 12.5px;
      font-weight: 600;
    }

    .fusion-motivo textarea {
      min-height: 76px;
      padding: 9px 10px;
      border: 1px solid #dbe3ea;
      border-radius: 8px;
      font: 400 13px/1.5 var(--font-body, inherit);
      resize: vertical;
      box-sizing: border-box;
    }

    .fusion-error {
      margin: 12px 0 0;
      padding: 9px 11px;
      border: 1px solid #f0d9d5;
      border-radius: 7px;
      background: #fdf6f5;
      color: #a3402f;
      font-size: 13px;
      line-height: 1.5;
    }

    .fusion-pie {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 22px;
      border-top: 1px solid #eef2f6;
      background: #fbfcfd;
    }
  `,
})
export class ActorPanelFusionComponent {
  readonly origen = input.required<ActorDirectorio>();

  readonly cerrar = output<void>();

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.modal()?.nativeElement, () => this.cerrar.emit());
  }
  readonly fusionado = output<ResultadoFusion>();

  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);

  readonly busqueda = signal('');
  readonly resultados = signal<ActorDirectorio[]>([]);
  readonly buscando = signal(false);
  readonly destino = signal<ActorDirectorio | null>(null);
  readonly motivo = signal('');
  readonly confirmado = signal(false);
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  readonly sinDato = SIN_DATO;
  readonly mascaraCorreo = MASCARA_CORREO;

  readonly motivoLongitud = computed(() => this.motivo().trim().length);
  readonly puedeFusionar = computed(
    () =>
      !!this.destino() &&
      this.confirmado() &&
      this.motivoLongitud() >= MOTIVO_MINIMO &&
      !this.enviando(),
  );

  readonly nivelOrigen = computed(() => nivelIdentificacionDe(this.origen().nivelIdentificacion));

  /** Etiqueta de identificación (o «sin dato»); nunca expone el número de documento. */
  nivelDe(actor: ActorDirectorio | null): string {
    return nivelIdentificacionDe(actor?.nivelIdentificacion) ?? SIN_DATO;
  }

  /** Texto de una celda comparativa; el vacío se declara «sin dato», no como error. */
  textoDe(valor: string | null | undefined): string {
    return (valor ?? '').trim() || SIN_DATO;
  }

  /** Código visible del actor: abreviatura o los primeros caracteres del uid. */
  codigoDe(actor: ActorDirectorio | null): string {
    if (!actor) return SIN_DATO;
    return actor.abreviatura?.trim() || actor.id.slice(0, 8);
  }

  private readonly modal = viewChild<ElementRef<HTMLElement>>('modal');

  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  constructor() {
    afterNextRender(() => this.modal()?.nativeElement.focus({ preventScroll: true }));

    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrarConSalida();
    };
    document.addEventListener('keydown', alEscape);

    this.destruccion.onDestroy(() => {
      document.removeEventListener('keydown', alEscape);
      clearTimeout(this.temporizadorBusqueda);
      this.focoPrevio?.focus?.();
    });
  }

  alBuscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.busqueda.set(valor);
    clearTimeout(this.temporizadorBusqueda);

    const q = valor.trim();
    if (q.length < 2) {
      this.resultados.set([]);
      this.buscando.set(false);
      return;
    }

    this.buscando.set(true);
    this.temporizadorBusqueda = setTimeout(() => {
      const url = urlConParametros(urlApi('/v1/actors'), {
        q,
        naturaleza: this.origen().naturaleza === 'Organización' ? 'organizacion' : 'persona',
        tamano: '6',
        pagina: '1',
      });
      this.http
        .get<unknown>(url)
        .pipe(takeUntilDestroyed(this.destruccion))
        .subscribe({
          next: (bruto) => {
            const origenId = this.origen().id;
            this.resultados.set(
              normalizarColeccion<unknown>(bruto)
                .elementos.map(aActorDirectorio)
                .filter((actor) => actor.id !== origenId),
            );
            this.buscando.set(false);
          },
          error: () => {
            this.resultados.set([]);
            this.buscando.set(false);
          },
        });
    }, 350);
  }

  elegirDestino(actor: ActorDirectorio): void {
    this.destino.set(actor);
    this.resultados.set([]);
    this.busqueda.set(actor.nombre);
    this.error.set(null);
  }

  alEscribirMotivo(evento: Event): void {
    this.motivo.set((evento.target as HTMLTextAreaElement).value);
  }

  alConfirmar(evento: Event): void {
    this.confirmado.set((evento.target as HTMLInputElement).checked);
  }

  fusionar(): void {
    const destino = this.destino();
    const origen = this.origen();
    if (!destino || this.enviando()) return;
    if (!this.confirmado()) {
      this.error.set('Debe confirmar explícitamente la fusión.');
      return;
    }
    if (this.motivoLongitud() < MOTIVO_MINIMO) {
      this.error.set(`El motivo de la fusión debe tener al menos ${MOTIVO_MINIMO} caracteres.`);
      return;
    }

    this.enviando.set(true);
    this.error.set(null);

    this.http
      .post<unknown>(urlApi(`/v1/actors/${encodeURIComponent(origen.id)}/fusion`), {
        destinoId: destino.id,
        motivo: this.motivo().trim(),
      })
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.fusionado.emit({ origenId: origen.id, destinoId: destino.id });
        },
        error: (fallo: unknown) => {
          this.enviando.set(false);
          this.error.set(aErrorApi(fallo).message);
        },
      });
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarConSalida();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  private atraparFoco(evento: KeyboardEvent): void {
    const modal = this.modal()?.nativeElement;
    if (!modal) return;

    const enfocables = Array.from(
      modal.querySelectorAll<HTMLElement>(
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
    if (evento.shiftKey && (activo === primero || !modal.contains(activo))) {
      evento.preventDefault();
      ultimo.focus();
    }
  }
}
