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

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { etiquetaHito as etiquetaHitoDe } from '../../shared/hito-texto';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import {
  aMesaDetalle,
  avanceCompromisos,
  claseEstadoHito,
  claseVigencia,
  fechaTexto,
  type MesaDetalle,
  type MesaIntegrante,
} from './mesa.mapeo';

type Pestana = 'resumen' | 'integrantes' | 'compromisos';

/** Grupo de integrantes que comparten rol, para listar por rol. */
type GrupoRol = { rol: string; personas: MesaIntegrante[] };

/**
 * Tono de `.commit-status` para el estado de un compromiso de la mesa.
 *
 * «Por iniciar» y «En proceso» comparten el azul de trabajo en curso.
 */
function claseEstadoCompromiso(estado: string): string {
  switch (estado) {
    case 'Cumplido':
      return 'commit-cumplido';
    case 'Redefinido':
      return 'commit-por-vencer';
    case 'Desestimado':
      return 'commit-vencido';
    default:
      return 'commit-en-curso';
  }
}

/**
 * Panel lateral con la ficha de una mesa de diálogo: resumen, integrantes y
 * compromisos con sus hitos en una sola línea.
 *
 * No reutiliza `app-compromiso-panel` para no apilar dos `.drawer`; comparte el
 * lenguaje visual (`drawer-scrim`, `drawer`, `detail-section`) y las utilidades
 * de `mesa.mapeo`, de modo que la ausencia del caso espejo (migración 81) se
 * declara en vez de simularse.
 */
@Component({
  selector: 'app-mesa-panel',
  imports: [RouterLink, IconoComponent],
  templateUrl: './mesa-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cerrar()',
  },
  styles: `
    :host {
      display: contents;
    }
    .mesa-tabs {
      align-self: flex-start;
    }
    .mesa-codigo-grande {
      margin: 0;
      color: var(--ink);
      font: 700 18px var(--font-display, inherit);
      letter-spacing: -0.4px;
    }
    .mesa-titulo-grande {
      margin: 2px 0 0;
      color: var(--ink-2);
      font-size: 13px;
      line-height: 1.5;
    }
    .mesa-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .mesa-datos {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 16px;
      margin: 12px 0 0;
    }
    .mesa-datos > div {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .mesa-datos dt {
      color: var(--muted);
      font-size: 12px;
    }
    .mesa-datos dd {
      margin: 0;
      color: var(--ink-2);
      font-size: 12.5px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .mesa-integrantes,
    .mesa-personas,
    .mesa-compromisos {
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
    }
    .mesa-integrantes {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .mesa-personas {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .mesa-rol {
      display: block;
      margin-bottom: 4px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }
    .mesa-persona {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px;
    }
    .mesa-persona strong {
      color: var(--ink);
      font-size: 12.5px;
    }
    .mesa-persona span,
    .mesa-persona a {
      color: var(--muted);
      font-size: 12px;
    }
    .mesa-compromisos {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .mesa-compromiso {
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--paper);
    }
    .mesa-compromiso-cabecera {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .mesa-compromiso-cabecera strong {
      color: var(--ink);
      font-size: 12.5px;
    }
    .mesa-compromiso-texto {
      margin: 5px 0 0;
      color: var(--ink-2);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .mesa-hitos-linea {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding-bottom: 2px;
      overflow-x: auto;
    }
    .mesa-hitos-linea > .commit-status {
      flex: none;
      white-space: nowrap;
    }
    .mesa-hito-fecha {
      flex: none;
      color: var(--muted);
      font-size: 11.5px;
    }
    .mesa-caso {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }
    .mesa-caso-titulo {
      flex-basis: 100%;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .mesa-acciones {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 12px;
    }
    .mesa-skeleton {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 6px;
    }
    .mesa-skeleton span {
      display: block;
      height: 12px;
      border-radius: 6px;
      background: linear-gradient(90deg, var(--line) 25%, var(--paper) 37%, var(--line) 63%);
      background-size: 400% 100%;
      animation: mesa-shimmer 1.4s ease-in-out infinite;
    }
    .mesa-skeleton span:nth-child(1) {
      width: 55%;
      height: 18px;
    }
    .mesa-skeleton span:nth-child(2) {
      width: 85%;
    }
    .mesa-skeleton span:nth-child(3) {
      width: 70%;
    }
    @keyframes mesa-shimmer {
      0% {
        background-position: 100% 0;
      }
      100% {
        background-position: 0 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .mesa-skeleton span {
        animation: none;
      }
    }
  `,
})
export class MesaPanelComponent {
  readonly codigo = input.required<string>();
  readonly cerrado = output<void>();

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  private readonly recurso = consulta<MesaDetalle | null>({
    fuente: () => urlApi(`/v1/mesas/${encodeURIComponent(this.codigo())}`),
    esquema: aMesaDetalle,
  });

  readonly detalle = this.recurso.valor;
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;

  readonly pestana = signal<Pestana>('resumen');

  readonly mesa = computed(() => this.detalle()?.mesa ?? null);

  readonly etiquetaHito = etiquetaHitoDe;

  readonly avanceCompromisos = avanceCompromisos;
  readonly claseVigencia = claseVigencia;
  readonly claseEstadoHito = claseEstadoHito;
  readonly fechaTexto = fechaTexto;

  readonly cargando = computed(() => {
    const estado = this.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  /** La API responde 404 cuando la mesa no existe. */
  readonly noEncontrada = computed(() => this.error()?.estado === 404);

  readonly integrantesPorRol = computed<GrupoRol[]>(() => {
    const grupos = new Map<string, MesaIntegrante[]>();
    for (const persona of this.detalle()?.integrantes ?? []) {
      const lista = grupos.get(persona.rol) ?? [];
      lista.push(persona);
      grupos.set(persona.rol, lista);
    }
    return [...grupos].map(([rol, personas]) => ({ rol, personas }));
  });

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus({ preventScroll: true }));
    this.destruccion.onDestroy(() => this.focoPrevio?.focus?.());
  }

  verPestana(pestana: Pestana): void {
    this.pestana.set(pestana);
  }

  claseEstadoCompromiso(estado: string): string {
    return claseEstadoCompromiso(estado);
  }

  recargar(): void {
    this.recurso.recargar();
  }

  esEnlace(valor: string | null): boolean {
    return valor ? /^https?:\/\//i.test(valor) : false;
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar();
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

  cerrar(): void {
    // Se espera la animación de salida mientras los datos siguen intactos.
    salirModal(this.panel()?.nativeElement, () => this.cerrado.emit());
  }
}
