import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type {
  FilaDistribucion,
  MetricaDistribucion,
  VariableDistribucion,
} from './panorama.agregados';

type OpcionMetrica = { clave: MetricaDistribucion; etiqueta: string };

/**
 * Distribución territorial del panorama: una barra por sectorista (o por región
 * cuando sólo hay casos locales) con los chips de sus territorios.
 *
 * Reutiliza el lenguaje visual de «Casos abiertos» (barra + chips de región) y
 * deja los conmutadores a la vista para que el mapa y el gráfico midan siempre
 * la misma variable. El componente es puramente presentacional: recibe las
 * filas ya agregadas y emite la selección; no pide datos ni calcula cifras.
 */
@Component({
  selector: 'app-panorama-distribucion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="surface distribucion" aria-labelledby="titulo-distribucion">
      <div class="surface-heading">
        <div>
          <h3 id="titulo-distribucion">{{ titulo() }}</h3>
          @if (subtitulo(); as sub) {
            <p>{{ sub }}</p>
          }
        </div>
      </div>

      <div class="distribucion-controles">
        <div class="segmented" role="group" aria-label="Variable de la distribución">
          <button
            type="button"
            [attr.aria-pressed]="variable() === 'casos'"
            (click)="elegirVariable('casos')"
          >
            Casos
          </button>
          <button
            type="button"
            [attr.aria-pressed]="variable() === 'alertas'"
            [disabled]="!alertasDisponibles()"
            [attr.title]="
              alertasDisponibles() ? null : 'Los indicadores de alertas no están disponibles'
            "
            (click)="elegirVariable('alertas')"
          >
            Alertas · {{ ventanaDias() }} d
          </button>
        </div>

        <div class="segmented" role="group" aria-label="Medida de la distribución">
          @for (opcion of metricas(); track opcion.clave) {
            <button
              type="button"
              [attr.aria-pressed]="metrica() === opcion.clave"
              (click)="elegirMetrica(opcion.clave)"
            >
              {{ opcion.etiqueta }}
            </button>
          }
        </div>
      </div>

      @if (aviso(); as textoAviso) {
        <p class="distribucion-aviso" role="status">{{ textoAviso }}</p>
      }

      @if (cargando()) {
        <p class="distribucion-aviso" role="status">Cargando los indicadores por sectorista…</p>
      } @else if (filas().length === 0) {
        <p class="distribucion-vacio">No hay medidas disponibles para esta selección.</p>
      } @else {
        <div class="distribucion-lista">
          @for (fila of filas(); track fila.clave) {
            <article class="distribucion-fila">
              <header class="distribucion-cabeza">
                <span class="distribucion-nombre">{{ fila.titulo }}</span>
                <span class="distribucion-total">
                  {{ fila.valor }} {{ unidad(fila.valor) }} · {{ fila.proporcion }} %
                </span>
              </header>
              <div class="distribucion-barra" aria-hidden="true">
                <span [style.width.%]="fila.proporcion"></span>
              </div>
              <div class="distribucion-regiones">
                @for (region of fila.regiones; track region.region) {
                  <span class="region-chip">
                    {{ region.region }} <strong>{{ region.valor }}</strong>
                  </span>
                } @empty {
                  <span class="region-chip region-chip-vacia">Sin regiones con dato</span>
                }
              </div>
            </article>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }

    /* En una sola columna, el panel hereda la altura fija del mapa para que
       ambos se lean con la misma escala. */
    @media (max-width: 980px) {
      :host {
        height: min(62vh, 520px);
      }
    }

    .distribucion {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      padding: 17px;
      box-sizing: border-box;
    }

    .distribucion-controles {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0 4px;
    }

    .segmented > button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .distribucion-lista {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
      margin-top: 8px;
      padding-right: 4px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .distribucion-fila {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }

    .distribucion-cabeza {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .distribucion-nombre {
      color: var(--ink);
      font: 700 14px/1.3 var(--font-display);
    }

    .distribucion-total {
      color: var(--muted);
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
    }

    .distribucion-barra {
      height: 5px;
      border-radius: 999px;
      background: var(--canvas);
      overflow: hidden;
    }

    .distribucion-barra > span {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: var(--blue);
    }

    .distribucion-regiones {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .region-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--canvas);
      color: var(--ink-2);
      font-size: 12px;
      white-space: nowrap;
    }

    .region-chip strong {
      color: var(--ink);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .region-chip-vacia {
      border-style: dashed;
      color: var(--muted);
    }

    .distribucion-aviso,
    .distribucion-vacio {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.5;
    }
  `,
})
export class PanoramaDistribucionComponent {
  readonly filas = input.required<readonly FilaDistribucion[]>();
  readonly variable = input.required<VariableDistribucion>();
  readonly metrica = input.required<MetricaDistribucion>();
  readonly ventanaDias = input<number>(90);
  readonly alertasDisponibles = input<boolean>(true);
  readonly cargando = input<boolean>(false);
  readonly aviso = input<string | null>(null);
  readonly titulo = input<string>('Distribución por sectorista');
  readonly subtitulo = input<string | null>(null);

  readonly variableCambia = output<VariableDistribucion>();
  readonly metricaCambia = output<MetricaDistribucion>();

  /** Medidas del eje elegido: cada variable tiene su propio catálogo de %/. */
  readonly metricas = computed<OpcionMetrica[]>(() =>
    this.variable() === 'alertas'
      ? [
          { clave: 'total', etiqueta: '% alertas' },
          { clave: 'riesgoAlto', etiqueta: '% alertas con riesgo alto' },
        ]
      : [
          { clave: 'total', etiqueta: '% total' },
          { clave: 'manifiestos', etiqueta: '% manifiestos' },
          { clave: 'riesgoAlto', etiqueta: '% casos con riesgo alto' },
        ],
  );

  elegirVariable(variable: VariableDistribucion): void {
    if (variable === 'alertas' && !this.alertasDisponibles()) return;
    this.variableCambia.emit(variable);
  }

  elegirMetrica(metrica: MetricaDistribucion): void {
    this.metricaCambia.emit(metrica);
  }

  /** Unidad del valor de la barra, para no rotular alertas como casos. */
  unidad(valor: number): string {
    if (this.variable() === 'alertas') return valor === 1 ? 'alerta' : 'alertas';
    return valor === 1 ? 'caso' : 'casos';
  }
}
