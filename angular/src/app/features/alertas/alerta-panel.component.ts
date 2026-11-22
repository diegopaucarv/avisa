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

import type { ErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  PRIORIDADES_ALERTA,
  NIVELES_ALERTA,
  OPCIONES_NIVEL,
  type AccionFlujo,
  type Alerta,
  type DemandaAlerta,
  type PatchAlerta,
  accionesDeFlujo,
  aJsonLineas,
  clavePrioridad as clavePrioridadDe,
  claseEstado as claseEstadoDe,
  etapaDeFlujo,
  formatearPlazo as formatearPlazoDe,
} from './alerta.mapeo';

type BorradorAlerta = {
  titulo: string;
  prioridad: string;
  nivel: string;
  situacionActual: string;
  hechosRecientes: string;
  descripcionRiesgo: string;
  accionesOaipcs: string;
  accionesSugeridas: string;
  casoCode: string;
};

type CampoBorrador = keyof BorradorAlerta;

/** `undefined` = no cambió; `null` = se vació a propósito. */
function diferenciaTexto(valor: string, original: string | null): string | null | undefined {
  const limpio = valor.trim();
  if (limpio === (original ?? '').trim()) return undefined;
  return limpio ? limpio : null;
}

/**
 * Panel lateral derecho de una alerta.
 *
 * Reemplaza la navegación a otra vista: el listado queda detrás y el recorrido
 * de cinco pasos y la edición ocurren aquí. Es un diálogo modal (`role="dialog"`,
 * `aria-modal`), se cierra con Escape o con el fondo y encierra el foco con Tab.
 *
 * No conoce HTTP: emite el cuerpo parcial ya diffado y el paso de destino.
 */
@Component({
  selector: 'app-alerta-panel',
  imports: [IconoComponent],
  templateUrl: './alerta-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    /* El drawer global mide 600 px; la ficha necesita algo más de aire. */
    .drawer {
      width: min(640px, 100%);
    }

    .alerta-panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .alerta-panel-codigo {
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
    }

    .alerta-panel-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }

    .alerta-prioridad--critica {
      background: #f9ecea;
      color: #a84f49;
    }
    .alerta-prioridad--urgente {
      background: #fff3e5;
      color: #a6732d;
    }
    .alerta-prioridad--temprana {
      background: #eef3fa;
      color: #4a6b93;
    }
    .alerta-prioridad--seguimiento {
      background: #f0f3f5;
      color: #657684;
    }
    .alerta-prioridad--sin-prioridad {
      background: #f6f7f8;
      color: #8b97a1;
    }

    .alerta-plazo {
      background: #f0f3f5;
      color: #657684;
    }
    .alerta-plazo--sin {
      background: #f6f7f8;
      color: #8b97a1;
    }

    .alerta-nivel {
      background: #eef3fa;
      color: #4a6b93;
    }

    .alerta-grave {
      background: #f9ecea;
      color: #a84f49;
      font-weight: 700;
    }

    .alerta-panel-cuerpo {
      gap: 16px;
    }

    .alerta-seccion {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .alerta-seccion h3 {
      margin: 0;
      color: #33475b;
      font: 700 11px var(--font-display);
    }

    .alerta-texto {
      margin: 0;
      color: #52677a;
      font-size: 11px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .alerta-nota {
      margin: 0;
      color: #8d99a6;
      font-size: 10px;
      line-height: 1.5;
    }

    .alerta-vacio {
      margin: 0;
      color: #a0aab3;
      font-size: 10.5px;
      font-style: italic;
    }

    .alerta-aviso {
      margin: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #edf6f0;
      color: #52806a;
      font-size: 10.5px;
    }

    .alerta-error {
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
    .alerta-error p {
      margin: 0;
    }

    .alerta-etapa {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0;
      color: #465a6c;
      font-size: 11px;
    }

    .alerta-etapa-estado {
      padding: 2px 7px;
      border-radius: 10px;
      background: #eef3fa;
      color: #4a6b93;
      font-size: 9px;
      font-weight: 600;
    }

    .alerta-acciones {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 2px;
    }

    .alerta-accion {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      height: auto;
      padding: 8px 10px;
      text-align: left;
      white-space: normal;
    }

    .alerta-accion small {
      color: #8d99a6;
      font-size: 9.5px;
      font-weight: 400;
      line-height: 1.4;
    }

    .alerta-formulario {
      display: flex;
      flex-direction: column;
      gap: 11px;
      padding-top: 12px;
      border-top: 1px solid #eef2f6;
    }

    .alerta-formulario .form-textarea {
      min-height: 68px;
    }

    .alerta-formulario-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .alerta-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 16px;
      margin: 0;
    }

    .alerta-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .alerta-datos dt {
      color: #97a1aa;
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .alerta-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 10.5px;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .alerta-lista {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding-left: 16px;
      color: #52677a;
      font-size: 10.5px;
      line-height: 1.5;
    }

    .alerta-demandas {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .alerta-demandas li {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding-left: 10px;
      border-left: 2px solid #dbe7f4;
    }

    .alerta-demandas strong {
      color: #465a6c;
      font-size: 10.5px;
    }

    .alerta-demandas p {
      margin: 0;
      color: #52677a;
      font-size: 10.5px;
      line-height: 1.5;
    }

    .alerta-demandas small {
      color: #97a1aa;
      font-size: 9px;
    }
  `,
})
export class AlertaPanelComponent {
  readonly alerta = input<Alerta | null>(null);
  readonly demandas = input<readonly DemandaAlerta[]>([]);
  readonly cargando = input(false);
  readonly errorCarga = input<ErrorApi | null>(null);
  readonly puedeModificar = input(false);
  readonly guardando = input(false);
  readonly errorGuardado = input<string | null>(null);
  readonly aviso = input<string | null>(null);

  readonly cerrar = output<void>();
  readonly reintentar = output<void>();
  readonly guardar = output<PatchAlerta>();
  readonly accion = output<number>();

  readonly prioridades = PRIORIDADES_ALERTA;
  readonly niveles = NIVELES_ALERTA;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  readonly editando = signal(false);
  readonly borrador = signal<BorradorAlerta | null>(null);
  readonly mensajeLocal = signal<string | null>(null);

  readonly formulario = computed(() => (this.editando() ? this.borrador() : null));

  readonly etapa = computed(() => {
    const alerta = this.alerta();
    return alerta ? etapaDeFlujo(alerta.pasoActual) : null;
  });

  readonly acciones = computed<readonly AccionFlujo[]>(() => {
    const alerta = this.alerta();
    return alerta ? accionesDeFlujo(alerta.pasoActual) : [];
  });

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

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
    });

    // Tras un guardado correcto el contenedor publica un aviso: el formulario se
    // cierra para mostrar lo ya persistido en lugar del borrador.
    effect(() => {
      if (this.aviso()) {
        this.editando.set(false);
        this.borrador.set(null);
      }
    });
  }

  formatearPlazo(horas: number | null): string {
    return formatearPlazoDe(horas);
  }

  clavePrioridad(prioridad: Alerta['prioridad']): string {
    return clavePrioridadDe(prioridad);
  }

  claseEstado(estado: string): string {
    return claseEstadoDe(estado);
  }

  porcentaje(valor: number | null): string {
    return valor === null ? '—' : `${Math.round(valor * 100)} %`;
  }

  iniciarEdicion(): void {
    const alerta = this.alerta();
    if (!alerta) return;

    this.borrador.set({
      titulo: alerta.titulo ?? '',
      prioridad: alerta.prioridad ?? '',
      nivel: alerta.nivel ?? '',
      situacionActual: alerta.situacionActual ?? '',
      hechosRecientes: alerta.hechosRecientes ?? '',
      descripcionRiesgo: alerta.descripcionRiesgo ?? '',
      accionesOaipcs: alerta.accionesOaipcs ?? '',
      accionesSugeridas: alerta.accionesSugeridas.join('\n'),
      casoCode: alerta.casoCodigo ?? '',
    });
    this.mensajeLocal.set(null);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
    this.borrador.set(null);
    this.mensajeLocal.set(null);
  }

  campo(clave: CampoBorrador, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const valor = objetivo.value;
    this.borrador.update((actual) => (actual ? { ...actual, [clave]: valor } : actual));
  }

  alEnviarFormulario(evento: Event): void {
    evento.preventDefault();
    this.guardarCambios();
  }

  guardarCambios(): void {
    const alerta = this.alerta();
    const borrador = this.borrador();
    if (!alerta || !borrador) return;

    const cambios: PatchAlerta = {};

    const titulo = borrador.titulo.trim();
    if (titulo && titulo !== (alerta.titulo ?? '')) cambios.titulo = titulo;

    if (borrador.prioridad !== (alerta.prioridad ?? '')) {
      cambios.prioridad = borrador.prioridad || null;
    }

    // El repositorio resuelve el nivel por `codigo_legado` o por `nombre`; se
    // envía el código heredado porque no depende del rename de la migración 14.
    const nivelActual =
      alerta.nivelCodigo ??
      OPCIONES_NIVEL.find((opcion) => opcion.etiqueta === alerta.nivel)?.valor ??
      '';
    const nivelElegido =
      OPCIONES_NIVEL.find((opcion) => opcion.etiqueta === borrador.nivel)?.valor ?? '';
    if (nivelElegido !== nivelActual) cambios.nivel = nivelElegido || null;

    const situacion = diferenciaTexto(borrador.situacionActual, alerta.situacionActual);
    if (situacion !== undefined) cambios.situacionActual = situacion;

    const hechos = diferenciaTexto(borrador.hechosRecientes, alerta.hechosRecientes);
    if (hechos !== undefined) cambios.hechosRecientes = hechos;

    const descripcion = diferenciaTexto(borrador.descripcionRiesgo, alerta.descripcionRiesgo);
    if (descripcion !== undefined) cambios.descripcionRiesgo = descripcion;

    const acciones = diferenciaTexto(borrador.accionesOaipcs, alerta.accionesOaipcs);
    if (acciones !== undefined) cambios.accionesOaipcs = acciones;

    const sugeridas = aJsonLineas(borrador.accionesSugeridas.split('\n'));
    const sugeridasPrevias = alerta.accionesSugeridas.length ? alerta.accionesSugeridas : null;
    if ((sugeridas ?? []).join('\n') !== (sugeridasPrevias ?? []).join('\n')) {
      cambios.accionesSugeridas = sugeridas;
    }

    const caso = borrador.casoCode.trim();
    if (caso !== (alerta.casoCodigo ?? '')) cambios.casoCode = caso || null;

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
