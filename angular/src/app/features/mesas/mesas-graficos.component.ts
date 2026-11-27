import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import {
  anchoBarra as calcularAncho,
  leerIndicadores,
  type ConteoClave,
  type IndicadoresMesas,
} from './mesas-indicadores';

/** Pestaña de SEGUIMIENTO que consume estos gráficos. */
export type VistaMesas = 'mesas' | 'compromisos';

type Tono =
  | 'tono-verde'
  | 'tono-ambar'
  | 'tono-rojo'
  | 'tono-azul'
  | 'tono-azul-tenue'
  | 'tono-neutro';

type FilaBarra = { clave: string; total: number; tono: Tono };

/** Orden del catálogo de `core.mesas_dialogo.estado_vigencia`. */
const VIGENCIA_ORDEN = ['Vigente', 'Por vencer', 'Vencido', 'Permanente', 'Sin fecha'] as const;

/** Catálogo de `core.cat_estados_compromiso`. */
const COMPROMISO_ORDEN = [
  'Por iniciar',
  'En proceso',
  'Cumplido',
  'Redefinido',
  'Desestimado',
] as const;

/** Catálogo de estados de hito de un compromiso. */
const HITO_ORDEN = [
  'Registrado',
  'En ejecución',
  'Paralizado',
  'Cumplido',
  'Desestimado',
  'No cumplido',
] as const;

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
      // Permanente y Sin fecha no tienen urgencia: azul tenue.
      return 'tono-azul-tenue';
  }
}

function tonoCompromiso(clave: string): Tono {
  switch (normalizarClave(clave)) {
    case 'cumplido':
      return 'tono-verde';
    case 'en proceso':
      return 'tono-azul';
    case 'redefinido':
      return 'tono-ambar';
    case 'desestimado':
      return 'tono-rojo';
    default:
      return 'tono-neutro';
  }
}

function tonoHito(clave: string): Tono {
  switch (normalizarClave(clave)) {
    case 'cumplido':
      return 'tono-verde';
    case 'en ejecucion':
      return 'tono-azul';
    case 'paralizado':
    case 'desestimado':
    case 'no cumplido':
      return 'tono-rojo';
    default:
      // Registrado: estado inicial, sin urgencia.
      return 'tono-neutro';
  }
}

function totalDe(filas: readonly ConteoClave[], clave: string): number {
  const buscada = normalizarClave(clave);
  return filas.find((fila) => normalizarClave(fila.clave) === buscada)?.total ?? 0;
}

/**
 * Filas del catálogo completo: siempre aparecen todas las claves pedidas (aunque
 * su total sea 0) y, si la API devuelve estados fuera del catálogo, se añaden al
 * final ordenados por total para no perder ningún conteo.
 */
function catalogo(
  filas: readonly ConteoClave[],
  orden: readonly string[],
  tono: (clave: string) => Tono,
): FilaBarra[] {
  const pedidas = new Set(orden.map(normalizarClave));
  const conocidas: FilaBarra[] = orden.map((clave) => ({
    clave,
    total: totalDe(filas, clave),
    tono: tono(clave),
  }));
  const extras: FilaBarra[] = [...filas]
    .filter((fila) => !pedidas.has(normalizarClave(fila.clave)))
    .sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave, 'es'))
    .map((fila) => ({ clave: fila.clave, total: fila.total, tono: 'tono-neutro' }));

  return [...conocidas, ...extras];
}

/** Filas presentes en la respuesta, ordenadas por el catálogo de la vista. */
function presentes(
  filas: readonly ConteoClave[],
  orden: readonly string[],
  tono: (clave: string) => Tono,
): FilaBarra[] {
  const posicion = new Map(
    orden.map((clave, indice) => [normalizarClave(clave), indice] as const),
  );

  return [...filas]
    .sort((a, b) => {
      const ia = posicion.get(normalizarClave(a.clave)) ?? Number.MAX_SAFE_INTEGER;
      const ib = posicion.get(normalizarClave(b.clave)) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib || b.total - a.total || a.clave.localeCompare(b.clave, 'es');
    })
    .map((fila) => ({ clave: fila.clave, total: fila.total, tono: tono(fila.clave) }));
}

/** Las `limite` filas de mayor total, con desempate alfabético estable. */
function topes(filas: readonly ConteoClave[], limite: number): FilaBarra[] {
  return [...filas]
    .sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave, 'es'))
    .slice(0, limite)
    .map((fila): FilaBarra => ({ clave: fila.clave, total: fila.total, tono: 'tono-azul' }));
}

function maximo(filas: readonly FilaBarra[]): number {
  return filas.reduce((alto, fila) => Math.max(alto, fila.total), 0);
}

/**
 * Dos tarjetas de gráficos de barras para las vistas de mesas de diálogo.
 *
 * Se colocan justo debajo de la barra de búsqueda de `/mesas` y
 * `/mesas/compromisos`; la pestaña activa decide el par de tarjetas mediante el
 * input `vista`. Todo se dibuja con `div` y `width` porcentual: sin librerías de
 * gráficos, cada valor tiene su texto visible y su resumen en `aria-label`.
 *
 * La tarjeta de compromisos declara la ausencia de vínculo cuando la migración
 * 81 no ha corrido, en vez de pintar barras vacías que parecerían un cero real.
 */
@Component({
  selector: 'app-mesas-graficos',
  styleUrl: './mesas-graficos.css',
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
      } @else if (esVistaMesas()) {
        <article class="chart-card">
          <h3 class="chart-title">Mesas por estado de vigencia</h3>
          <p class="chart-sub">Según la fecha de fin de vigencia de cada mesa.</p>
          <div class="chart-body">
            @if (cargando()) {
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton corto"></div>
            } @else if (filasVigencia().length === 0) {
              <p class="chart-empty">No hay mesas con estado de vigencia registrado.</p>
            } @else {
              <ul class="chart-barras" role="img" [attr.aria-label]="resumenVigencia()">
                @for (fila of filasVigencia(); track fila.clave) {
                  <li class="barra-fila">
                    <span class="barra-etiqueta" [attr.title]="fila.clave">{{ fila.clave }}</span>
                    <span class="barra-valor">{{ fila.total }}</span>
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
          <p class="chart-sub">Las diez primeras según su ámbito departamental.</p>
          <div class="chart-body">
            @if (cargando()) {
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton corto"></div>
            } @else if (filasDepartamentos().length === 0) {
              <p class="chart-empty">Sin departamentos registrados en las mesas.</p>
            } @else {
              <ul class="chart-barras" role="img" [attr.aria-label]="resumenDepartamentos()">
                @for (fila of filasDepartamentos(); track fila.clave) {
                  <li class="barra-fila">
                    <span class="barra-etiqueta" [attr.title]="fila.clave">{{ fila.clave }}</span>
                    <span class="barra-valor">{{ fila.total }}</span>
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
      } @else {
        <article class="chart-card">
          <h3 class="chart-title">Compromisos por estado</h3>
          <p class="chart-sub">Catálogo de estados de los compromisos asumidos en mesas.</p>
          <div class="chart-body">
            @if (cargando()) {
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton corto"></div>
            } @else if (sinVinculo()) {
              <p class="chart-empty">
                Aún no hay compromisos vinculados a mesas: requiere la migración 81.
              </p>
            } @else {
              <ul class="chart-barras" role="img" [attr.aria-label]="resumenCompromisos()">
                @for (fila of filasCompromisos(); track fila.clave) {
                  <li class="barra-fila">
                    <span class="barra-etiqueta" [attr.title]="fila.clave">{{ fila.clave }}</span>
                    <span class="barra-valor">{{ fila.total }}</span>
                    <span class="barra-pista" aria-hidden="true">
                      <span
                        [class]="'barra-relleno ' + fila.tono"
                        [style.width]="anchoBarra(fila.total, maxCompromisos())"
                      ></span>
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        </article>

        <article class="chart-card">
          <h3 class="chart-title">Hitos por estado</h3>
          <p class="chart-sub">Estados de los hitos de esos compromisos.</p>
          <div class="chart-body">
            @if (cargando()) {
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton"></div>
              <div class="chart-skeleton corto"></div>
            } @else if (sinVinculo()) {
              <p class="chart-empty">
                Aún no hay hitos vinculados a mesas: requiere la migración 81.
              </p>
            } @else {
              <ul class="chart-barras" role="img" [attr.aria-label]="resumenHitos()">
                @for (fila of filasHitos(); track fila.clave) {
                  <li class="barra-fila">
                    <span class="barra-etiqueta" [attr.title]="fila.clave">{{ fila.clave }}</span>
                    <span class="barra-valor">{{ fila.total }}</span>
                    <span class="barra-pista" aria-hidden="true">
                      <span
                        [class]="'barra-relleno ' + fila.tono"
                        [style.width]="anchoBarra(fila.total, maxHitos())"
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
  /** Pestaña activa: decide qué par de tarjetas se pinta. */
  readonly vista = input<VistaMesas>('mesas');

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

  readonly esVistaMesas = computed(() => this.vista() === 'mesas');

  readonly tituloVista = computed(() =>
    this.esVistaMesas() ? 'Mesas de diálogo' : 'Compromisos de mesas',
  );

  readonly etiquetaRegion = computed(() =>
    this.esVistaMesas()
      ? 'Indicadores de las mesas de diálogo'
      : 'Indicadores de los compromisos de las mesas',
  );

  readonly filasVigencia = computed(() =>
    presentes(this.datos()?.vigencia ?? [], VIGENCIA_ORDEN, tonoVigencia),
  );

  readonly filasDepartamentos = computed(() => topes(this.datos()?.departamentos ?? [], 10));

  readonly filasCompromisos = computed(() =>
    catalogo(this.datos()?.compromisosEstado ?? [], COMPROMISO_ORDEN, tonoCompromiso),
  );

  readonly filasHitos = computed(() =>
    catalogo(this.datos()?.hitosEstado ?? [], HITO_ORDEN, tonoHito),
  );

  readonly maxVigencia = computed(() => maximo(this.filasVigencia()));
  readonly maxDepartamentos = computed(() => maximo(this.filasDepartamentos()));
  readonly maxCompromisos = computed(() => maximo(this.filasCompromisos()));
  readonly maxHitos = computed(() => maximo(this.filasHitos()));

  /** La migración 81 aún no vinculó mesas con casos. */
  readonly sinVinculo = computed(() => this.datos()?.vinculoDisponible === false);

  /** Se expone como método para la plantilla. */
  readonly anchoBarra = calcularAncho;

  readonly resumenVigencia = computed(
    () => `Mesas por vigencia: ${this.resumen(this.filasVigencia())}.`,
  );
  readonly resumenDepartamentos = computed(
    () => `Mesas por departamento: ${this.resumen(this.filasDepartamentos())}.`,
  );
  readonly resumenCompromisos = computed(
    () => `Compromisos por estado: ${this.resumen(this.filasCompromisos())}.`,
  );
  readonly resumenHitos = computed(() => `Hitos por estado: ${this.resumen(this.filasHitos())}.`);

  readonly resumenTotales = computed(() => {
    const datos = this.datos();
    if (!datos) return '';
    return this.esVistaMesas()
      ? `${datos.totales.mesas} mesas · ${datos.totales.miembros} miembros`
      : `${datos.totales.compromisos} compromisos · ${datos.totales.hitos} hitos`;
  });

  private resumen(filas: readonly FilaBarra[]): string {
    if (filas.length === 0) return 'sin datos';
    return filas.map((fila) => `${fila.clave} ${fila.total}`).join('; ');
  }

  recargar(): void {
    this.recurso.recargar();
  }
}
