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
import { RouterLink } from '@angular/router';

import { IconoComponent } from '../../shared/ui/icono.component';
import type { ResultadoEnlazado } from './busqueda.mapeo';

/**
 * Ficha de un resultado de la búsqueda global (cambio 30).
 *
 * Mismo patrón que `ArchivoPanelComponent` y `DocumentoPanelComponent`: drawer
 * lateral modal (`role="dialog"`, `aria-modal`), se cierra con Escape o con el
 * fondo y devuelve el foco al disparador; Tab y Shift+Tab ciclan dentro.
 *
 * Muestra el territorio que publica `GET /api/v1/search` —región, provincia,
 * distrito y ubigeo— cuando existe, y el destino del registro: la ficha de la
 * entidad si la ruta existe o su listado ya filtrado. Los datos faltantes se
 * pintan «—»; no se completan con suposiciones.
 *
 * No consulta HTTP: recibe la fila ya normalizada y enriquecida por la página.
 */
@Component({
  selector: 'app-busqueda-ficha',
  imports: [RouterLink, IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="drawer-scrim" (click)="alFondo($event)" (keydown)="alTecla($event)">
      <aside
        #panel
        class="drawer drawer-ficha"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="busqueda-ficha-titulo"
      >
        <header class="drawer-head">
          <div class="panel-cabecera">
            <p class="panel-codigo">{{ fila().codigo ?? 'Sin código' }}</p>
            <h2 id="busqueda-ficha-titulo">{{ fila().titulo }}</h2>
            @if (fila().subtitulo) {
              <p>{{ fila().subtitulo }}</p>
            }
            <div class="panel-badges">
              <span class="status-badge panel-entidad">{{ fila().etiquetaTipo }}</span>
              <span class="status-badge" [class.panel-ficha]="fila().abreFicha">
                {{ fila().abreFicha ? 'Ficha disponible' : 'Sin ficha propia' }}
              </span>
            </div>
          </div>

          <button
            type="button"
            class="icon-button"
            aria-label="Cerrar la ficha del resultado"
            (click)="cerrar.emit()"
          >
            <app-icono nombre="cerrar" [tamano]="18" />
          </button>
        </header>

        <div class="drawer-body">
          <section class="detail-section" aria-labelledby="busqueda-ficha-territorio">
            <h3 id="busqueda-ficha-territorio">Territorio</h3>
            @if (tieneTerritorio()) {
              <dl class="panel-datos">
                <div>
                  <dt>Región</dt>
                  <dd>{{ fila().region ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Provincia</dt>
                  <dd>{{ fila().provincia ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Distrito</dt>
                  <dd>{{ fila().distrito ?? '—' }}</dd>
                </div>
                <div>
                  <dt>Ubigeo</dt>
                  <dd class="panel-lote">{{ fila().ubigeo ?? '—' }}</dd>
                </div>
              </dl>
            } @else {
              <p class="panel-vacio">
                El registro no tiene territorio asociado en la búsqueda: no declara distrito propio
                ni pertenece a un caso con distrito principal.
              </p>
            }
          </section>

          <section class="detail-section" aria-labelledby="busqueda-ficha-registro">
            <h3 id="busqueda-ficha-registro">Registro</h3>
            <dl class="panel-datos">
              <div>
                <dt>Tipo</dt>
                <dd>{{ fila().etiquetaTipo }}</dd>
              </div>
              <div>
                <dt>Código</dt>
                <dd>{{ fila().codigo ?? '—' }}</dd>
              </div>
            </dl>
          </section>

          <div class="panel-acciones">
            <a
              class="button-primary"
              [routerLink]="fila().ruta"
              [queryParams]="fila().parametros"
              [attr.aria-label]="
                (fila().abreFicha ? 'Abrir la ficha de ' : 'Ver en el listado de ') +
                fila().etiquetaTipo.toLowerCase() +
                ': ' +
                fila().titulo
              "
            >
              {{ fila().abreFicha ? 'Abrir ficha' : 'Ver en el listado' }}
            </a>
            <button type="button" class="button-secondary" (click)="cerrar.emit()">Cerrar</button>
          </div>
        </div>
      </aside>
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }

    .drawer-ficha {
      width: min(520px, 100%);
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

    .panel-entidad {
      background: #f0f3f5;
      color: #657684;
    }

    .panel-ficha {
      background: #eaf3ea;
      color: #3f6b52;
    }

    .drawer-body .detail-section {
      padding: 14px 0;
      border-top: 1px solid #eef2f6;
    }

    .drawer-body .detail-section:first-of-type {
      padding-top: 0;
      border-top: 0;
    }

    .drawer-body .detail-section h3 {
      text-transform: uppercase;
    }

    .panel-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
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

    .panel-vacio {
      margin: 8px 0 0;
      color: #a0aab3;
      font-size: 13px;
      font-style: italic;
      line-height: 1.55;
    }

    .panel-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid #eef2f6;
    }

    .panel-acciones a {
      text-decoration: none;
      text-align: center;
    }
  `,
})
export class BusquedaFichaComponent {
  private readonly destruccion = inject(DestroyRef);

  readonly fila = input.required<ResultadoEnlazado>();
  readonly cerrar = output<void>();

  readonly tieneTerritorio = computed(() => {
    const fila = this.fila();
    return Boolean(fila.region || fila.provincia || fila.distrito || fila.ubigeo);
  });

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
        this.cerrar.emit();
      };
      document.addEventListener('keydown', alEscape);
      this.destruccion.onDestroy(() => {
        document.removeEventListener('keydown', alEscape);
        this.focoPrevio?.focus?.();
      });
    }
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
