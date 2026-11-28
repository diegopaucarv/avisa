import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import {
  aEstadisticasCompromisos,
  type EstadisticaArea,
  type EstadisticaEstado,
  type EstadisticasCompromisos,
} from './estadisticas-compromisos';

type Tono = 'tono-verde' | 'tono-ambar' | 'tono-rojo' | 'tono-neutro';

type FilaEstado = {
  clave: string;
  total: number;
  tono: Tono;
};

type FilaArea = {
  clave: string;
  etiqueta: string;
  /** Texto largo para el tooltip; código y nombre del área. */
  titulo: string;
  total: number;
  cumplidos: number;
  porcentaje: number;
};

/**
 * Orden del catálogo de la vista para el estado de cumplimiento. Es el que
 * pide la Guía (§8.3.2): primero lo cumplido, luego lo que está en marcha y al
 * final lo cerrado sin cumplir. Lo que llegue fuera del catálogo se ordena por
 * total y nombre, sin inventar filas.
 */
const ORDEN_ESTADOS = [
  'Cumplido',
  'En proceso',
  'Por iniciar',
  'Redefinido',
  'Desestimado',
] as const;

/** Cuántas áreas caben en la tarjeta sin scroll interno. */
const TOPE_AREAS = 8;

function normalizarClave(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Color por categoría de cumplimiento, no por estado literal: «En proceso» es
 * ámbar (en marcha), lo cerrado sin cumplir es rojo y «Por iniciar» queda
 * neutro porque todavía no hay avance que juzgar.
 */
function tonoEstado(estado: string): Tono {
  switch (normalizarClave(estado)) {
    case 'cumplido':
      return 'tono-verde';
    case 'en proceso':
      return 'tono-ambar';
    case 'redefinido':
    case 'desestimado':
    case 'no cumplido':
      return 'tono-rojo';
    default:
      return 'tono-neutro';
  }
}

/** Filas presentes en la respuesta, ordenadas por el catálogo de la vista. */
function filasEstado(filas: readonly EstadisticaEstado[]): FilaEstado[] {
  const posicion = new Map(
    ORDEN_ESTADOS.map((clave, indice) => [normalizarClave(clave), indice] as const),
  );

  return [...filas]
    .sort((a, b) => {
      const ia = posicion.get(normalizarClave(a.estado)) ?? Number.MAX_SAFE_INTEGER;
      const ib = posicion.get(normalizarClave(b.estado)) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib || b.total - a.total || a.estado.localeCompare(b.estado, 'es');
    })
    .map((fila) => ({
      clave: fila.estado,
      total: fila.total,
      tono: tonoEstado(fila.estado),
    }));
}

/**
 * Las ocho áreas con más compromisos. Una fila con total cero no aporta al
 * ranking y no se pinta; si todas llegan a cero, la tarjeta declara el vacío en
 * lugar de dibujar barras sin base.
 */
function filasArea(filas: readonly EstadisticaArea[]): FilaArea[] {
  return [...filas]
    .filter((fila) => fila.total > 0)
    .sort((a, b) => b.total - a.total || a.area.localeCompare(b.area, 'es'))
    .slice(0, TOPE_AREAS)
    .map((fila) => {
      const nombre = fila.nombre.trim();
      return {
        clave: fila.area,
        etiqueta: nombre || fila.area,
        titulo: [fila.area, nombre].filter((parte) => Boolean(parte)).join(' · '),
        total: fila.total,
        cumplidos: fila.cumplidos,
        porcentaje: fila.porcentajeCumplimiento,
      };
    });
}

function maximo(filas: readonly { total: number }[]): number {
  return filas.reduce((alto, fila) => Math.max(alto, fila.total), 0);
}

/** Ancho porcentual de una barra; un máximo de cero produce `0%`, no `NaN`. */
function anchoBarra(valor: number, tope: number): string {
  return tope > 0 ? `${Math.round((valor / tope) * 100)}%` : '0%';
}

/**
 * Dos tarjetas de indicadores para el listado de compromisos.
 *
 * Se montan justo debajo de la barra de búsqueda de `/compromisos`, con el mismo
 * lenguaje visual que los gráficos de mesas: `div` y `width` porcentual, sin
 * librerías, con texto visible y resumen accesible por barra. En modo mesas
 * piden el mismo sobre acotado con `soloMesas=1`; si el backend todavía ignora
 * el parámetro, los indicadores globales siguen siendo válidos.
 */
@Component({
  selector: 'app-compromisos-graficos',
  styleUrl: './compromisos-graficos.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="graficos" [attr.aria-label]="etiquetaRegion()">
      <h2 class="chart-heading">
        {{ tituloVista() }}
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
          <h3 class="chart-title">Compromisos por estado de cumplimiento</h3>
          <p class="chart-sub">
            Reparto del conjunto según el estado registrado, en el orden del catálogo de la vista.
          </p>
          <div class="chart-body">
            @if (cargando()) {
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton corto"></div>
            } @else if (!hayEstados()) {
              <p class="chart-empty">No hay compromisos con estado de cumplimiento registrado.</p>
            } @else {
              <ul class="chart-barras" role="img" [attr.aria-label]="resumenEstados()">
                @for (fila of filasEstado(); track fila.clave) {
                  <li class="barra-fila">
                    <span class="barra-etiqueta" [attr.title]="fila.clave">{{ fila.clave }}</span>
                    <span class="barra-valor">{{ fila.total }}</span>
                    <span class="barra-pista" aria-hidden="true">
                      <span
                        [class]="'barra-relleno ' + fila.tono"
                        [style.width]="ancho(fila.total, maxEstados())"
                      ></span>
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        </article>

        <article class="chart-card">
          <h3 class="chart-title">Cumplimiento por área responsable</h3>
          <p class="chart-sub">
            Las ocho áreas con más compromisos. La barra es el porcentaje de cumplidos sobre el
            total del área; la cifra indica cumplidos/total.
          </p>
          <div class="chart-body">
            @if (cargando()) {
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton corto"></div>
            } @else if (filasArea().length === 0) {
              <p class="chart-empty">Sin áreas responsables con compromisos registrados.</p>
            } @else {
              <ul class="chart-barras" role="img" [attr.aria-label]="resumenAreas()">
                @for (fila of filasArea(); track fila.clave) {
                  <li class="barra-fila">
                    <span class="barra-etiqueta" [attr.title]="fila.titulo">{{
                      fila.etiqueta
                    }}</span>
                    <span class="barra-valor" [attr.title]="fila.porcentaje + '% de cumplimiento'">
                      {{ fila.cumplidos }}/{{ fila.total }} · {{ fila.porcentaje }}%
                    </span>
                    <span class="barra-pista" aria-hidden="true">
                      <span
                        class="barra-relleno tono-verde"
                        [style.width]="fila.porcentaje + '%'"
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
export class CompromisosGraficosComponent {
  /**
   * Acota los indicadores a compromisos con espacio de diálogo. La vista lo
   * activa en el modo mesas; si la API aún no conoce el parámetro, lo ignora.
   */
  readonly soloMesas = input(false);

  private readonly recurso = consulta<EstadisticasCompromisos>({
    fuente: () =>
      urlConParametros(urlApi('/v1/commitments/estadisticas'), {
        soloMesas: this.soloMesas() ? '1' : '',
      }),
    esquema: aEstadisticasCompromisos,
  });

  readonly datos = this.recurso.valor;
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;

  readonly cargando = computed(() => {
    const estado = this.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  readonly mensajeError = computed(
    () => this.error()?.message ?? 'No se pudieron cargar los indicadores de compromisos.',
  );

  readonly tituloVista = computed(() =>
    this.soloMesas()
      ? 'Indicadores de compromisos de mesas de diálogo'
      : 'Indicadores de compromisos',
  );

  readonly etiquetaRegion = computed(
    () => `Indicadores de compromisos${this.soloMesas() ? ' registrados en mesas de diálogo' : ''}`,
  );

  readonly filasEstado = computed(() => filasEstado(this.datos()?.porEstado ?? []));
  readonly filasArea = computed(() => filasArea(this.datos()?.porArea ?? []));

  /** Un catálogo con todos sus totales en 0 no es un dato: es ausencia. */
  readonly hayEstados = computed(() => this.filasEstado().some((fila) => fila.total > 0));

  readonly maxEstados = computed(() => maximo(this.filasEstado()));

  /** Se expone como método para la plantilla. */
  readonly ancho = anchoBarra;

  readonly resumenEstados = computed(
    () => `Compromisos por estado: ${this.resumen(this.filasEstado())}.`,
  );

  readonly resumenAreas = computed(
    () =>
      `Compromisos por área: ${this.filasArea()
        .map(
          (fila) =>
            `${fila.etiqueta} ${fila.cumplidos} de ${fila.total}, ${fila.porcentaje}% cumplidos`,
        )
        .join('; ')}.`,
  );

  readonly resumenTotales = computed(() => {
    const datos = this.datos();
    if (!datos) return '';
    return `${datos.total} compromisos · ${datos.cumplidos} cumplidos`;
  });

  private resumen(filas: readonly FilaEstado[]): string {
    if (filas.length === 0) return 'sin datos';
    return filas.map((fila) => `${fila.clave} ${fila.total}`).join('; ');
  }

  recargar(): void {
    this.recurso.recargar();
  }
}
