import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import {
  anchoBarra as calcularAncho,
  leerIndicadores,
  type ConteoClave,
  type IndicadoresMesas,
} from './mesas-indicadores';

type Tono = 'tono-verde' | 'tono-ambar' | 'tono-rojo' | 'tono-azul' | 'tono-neutro';

type FilaBarra = {
  clave: string;
  total: number;
  tono: Tono;
  /** Texto largo para el tooltip; si falta, se usa `clave`. */
  titulo?: string;
  /** Dato secundario que se anuncia junto al total. */
  nota?: string;
};

/** Orden del catálogo de `core.mesas_dialogo.estado_vigencia`. */
const VIGENCIA_ORDEN = ['Vigente', 'Por vencer', 'Vencido', 'Permanente', 'Sin fecha'] as const;

/** Cuántas barras caben en la tarjeta sin scroll interno. */
const TOPES_DEPARTAMENTOS = 8;

/** El backend agrupa el ámbito no reconocido bajo esta etiqueta. */
const SIN_CLASIFICAR = 'sin clasificar';

function normalizarClave(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function tonoVigencia(clave: string): Tono {
  switch (normalizarClave(clave)) {
    case 'vigente':
      return 'tono-verde';
    case 'por vencer':
      return 'tono-ambar';
    case 'vencido':
      return 'tono-rojo';
    default:
      // Permanente y Sin fecha no tienen urgencia: se pintan neutros.
      return 'tono-neutro';
  }
}

/** Filas presentes en la respuesta, ordenadas por el catálogo de la vista. */
function presentes(
  filas: readonly ConteoClave[],
  orden: readonly string[],
  tono: (clave: string) => Tono,
): FilaBarra[] {
  const posicion = new Map(orden.map((clave, indice) => [normalizarClave(clave), indice] as const));

  return [...filas]
    .sort((a, b) => {
      const ia = posicion.get(normalizarClave(a.clave)) ?? Number.MAX_SAFE_INTEGER;
      const ib = posicion.get(normalizarClave(b.clave)) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib || b.total - a.total || a.clave.localeCompare(b.clave, 'es');
    })
    .map((fila) => ({ clave: fila.clave, total: fila.total, tono: tono(fila.clave) }));
}

/** Las `limite` filas de mayor total, con desempate alfabético estable. */
function topes(
  filas: readonly ConteoClave[],
  limite: number,
  tono: (clave: string) => Tono = () => 'tono-azul',
): FilaBarra[] {
  return [...filas]
    .sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave, 'es'))
    .slice(0, limite)
    .map((fila): FilaBarra => ({ clave: fila.clave, total: fila.total, tono: tono(fila.clave) }));
}

function maximo(filas: readonly FilaBarra[]): number {
  return filas.reduce((alto, fila) => Math.max(alto, fila.total), 0);
}

/**
 * Dos tarjetas de gráficos de barras para el listado de mesas de diálogo.
 *
 * Se colocan justo debajo de la barra de búsqueda de `/mesas`. Todo se dibuja
 * con `div` y `width` porcentual: sin librerías de gráficos, cada valor tiene su
 * texto visible y su resumen en `aria-label`.
 */
@Component({
  selector: 'app-mesas-graficos',
  styleUrl: './mesas-graficos.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="graficos" [attr.aria-label]="etiquetaRegion">
      <h2 class="chart-heading">
        {{ tituloVista }}
        @if (datos()) {
          <span class="chart-heading-meta">{{ resumenTotales() }}</span>
        }
      </h2>

      @if (estado() === 'error') {
        <div class="chart-card chart-card-ancho" role="alert">
          <h3 class="chart-title">No se pudieron cargar los indicadores</h3>
          <p class="chart-empty">{{ mensajeError() }}</p>
          <button type="button" class="chart-retry" (click)="recargar()">Reintentar</button>
        </div>
      } @else {
        <article class="chart-card">
          <h3 class="chart-title">Mesas por estado de vigencia</h3>
          <p class="chart-sub">Reparto de las mesas según la fecha de fin de su vigencia.</p>
          <div class="chart-body">
            @if (cargando()) {
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton corto"></div>
            } @else if (!hayVigencia()) {
              <p class="chart-empty">No hay mesas con estado de vigencia registrado.</p>
            } @else {
              <ul class="chart-barras" role="img" [attr.aria-label]="resumenVigencia()">
                @for (fila of filasVigencia(); track fila.clave) {
                  <li class="barra-fila">
                    <span class="barra-etiqueta" [attr.title]="fila.titulo ?? fila.clave">
                      {{ fila.clave }}
                    </span>
                    <span class="barra-valor" [attr.title]="fila.nota">{{ fila.total }}</span>
                    <span class="barra-pista" aria-hidden="true">
                      <span
                        [class]="'barra-relleno ' + fila.tono"
                        [style.width]="anchoBarra(fila.total, maxVigencia())"
                      ></span>
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        </article>

        <article class="chart-card">
          <h3 class="chart-title">Mesas por departamento</h3>
          <p class="chart-sub">
            Las ocho primeras según su ámbito declarado. Una mesa con varios departamentos suma en
            cada uno; «Sin clasificar» agrupa los textos no reconocidos.
          </p>
          <div class="chart-body">
            @if (cargando()) {
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton corto"></div>
            } @else if (!hayDepartamentos()) {
              <p class="chart-empty">Sin departamentos registrados en las mesas.</p>
            } @else {
              <ul class="chart-barras" role="img" [attr.aria-label]="resumenDepartamentos()">
                @for (fila of filasDepartamentos(); track fila.clave) {
                  <li class="barra-fila">
                    <span class="barra-etiqueta" [attr.title]="fila.titulo ?? fila.clave">
                      {{ fila.clave }}
                    </span>
                    <span class="barra-valor" [attr.title]="fila.nota">{{ fila.total }}</span>
                    <span class="barra-pista" aria-hidden="true">
                      <span
                        [class]="'barra-relleno ' + fila.tono"
                        [style.width]="anchoBarra(fila.total, maxDepartamentos())"
                      ></span>
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        </article>
      }
    </section>
  `,
})
export class MesasGraficosComponent {
  readonly tituloVista = 'Indicadores de mesas de diálogo';
  readonly etiquetaRegion = 'Indicadores de las mesas de diálogo';

  private readonly recurso = consulta<IndicadoresMesas>({
    fuente: () => urlApi('/v1/mesas/indicadores'),
    esquema: leerIndicadores,
  });

  readonly datos = this.recurso.valor;
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;

  readonly cargando = computed(() => {
    const estado = this.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  readonly mensajeError = computed(
    () => this.error()?.message ?? 'No se pudieron cargar los indicadores de mesas.',
  );

  readonly filasVigencia = computed(() =>
    presentes(this.datos()?.vigencia ?? [], VIGENCIA_ORDEN, tonoVigencia),
  );

  // «Sin clasificar» se pinta neutro: no es un departamento, es lo no reconocido.
  readonly filasDepartamentos = computed(() =>
    topes(this.datos()?.departamentos ?? [], TOPES_DEPARTAMENTOS, (clave) =>
      normalizarClave(clave) === SIN_CLASIFICAR ? 'tono-neutro' : 'tono-azul',
    ),
  );

  /** Un catálogo con todos sus totales en 0 no es un dato: es ausencia. */
  readonly hayVigencia = computed(() => this.filasVigencia().some((fila) => fila.total > 0));
  readonly hayDepartamentos = computed(() =>
    this.filasDepartamentos().some((fila) => fila.total > 0),
  );

  readonly maxVigencia = computed(() => maximo(this.filasVigencia()));
  readonly maxDepartamentos = computed(() => maximo(this.filasDepartamentos()));

  /** Se expone como método para la plantilla. */
  readonly anchoBarra = calcularAncho;

  readonly resumenVigencia = computed(
    () => `Mesas por vigencia: ${this.resumen(this.filasVigencia())}.`,
  );
  readonly resumenDepartamentos = computed(
    () => `Mesas por departamento: ${this.resumen(this.filasDepartamentos())}.`,
  );

  readonly resumenTotales = computed(() => {
    const datos = this.datos();
    if (!datos) return '';
    return `${datos.totales.mesas} mesas · ${datos.totales.miembros} miembros`;
  });

  private resumen(filas: readonly FilaBarra[]): string {
    if (filas.length === 0) return 'sin datos';
    return filas
      .map((fila) => `${fila.clave} ${fila.total}${fila.nota ? `, ${fila.nota}` : ''}`)
      .join('; ');
  }

  recargar(): void {
    this.recurso.recargar();
  }
}
