import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import { PanoramaService } from '../mapa/panorama.service';
import { conteosPorSituacion } from '../mapa/panorama.agregados';
import { ClimaReporteService } from './clima-reporte.service';
import {
  claseValidacion,
  construirSecciones,
  etiquetaTipo,
  etiquetaValidacion,
  formatearFecha,
  urlDeContenido,
  type DocumentoClima,
} from './clima-social.mapeo';

type NivelClima = {
  nivel: string;
  total: number;
  situacion: string;
};

type Indicador = {
  clave: string;
  etiqueta: string;
  icono: string;
  tono: '' | 'amber' | 'red';
  valor: number;
  nota: string;
};

/**
 * Clima social.
 *
 * La vista trabaja sobre el reporte mensual: un `core.documentos` de tipo clima
 * social cuya `fecha` cae en el mes consultado (Anexos 04/05). Primero el mes y
 * el estado de validación, luego el contenido del reporte, después la lectura
 * de casos abiertos y al final el histórico. Si el mes no tiene reporte, se
 * declara el vacío: nunca se estima.
 */
@Component({
  selector: 'app-clima-social',
  imports: [RouterLink, IconoComponent, ExportarMenuComponent, ThOrdenDirective],
  providers: [PanoramaService, ClimaReporteService],
  template: `
    <section class="view-body" aria-labelledby="titulo-clima-social">
      <header class="view-head">
        <div>
          <h1 id="titulo-clima-social">Clima social <span aria-hidden="true">☁️</span></h1>
        </div>
        <div class="view-actions">
          <button type="button" class="button-secondary" (click)="recargar()">Recargar</button>
        </div>
      </header>

      <div class="mes-barra">
        <div class="mes-nav" role="group" aria-label="Mes consultado">
          <button
            type="button"
            class="mes-flecha"
            (click)="servicio.irAlMesAnterior()"
            aria-label="Mes anterior"
          >
            <app-icono nombre="chevron-izquierda" [tamano]="16" />
          </button>
          <strong class="mes-nombre" aria-live="polite">{{ servicio.etiquetaMes() }}</strong>
          <button
            type="button"
            class="mes-flecha"
            (click)="servicio.irAlMesSiguiente()"
            [disabled]="!servicio.puedeAvanzar()"
            aria-label="Mes siguiente"
          >
            <app-icono nombre="chevron-derecha" [tamano]="16" />
          </button>
        </div>
        @if (servicio.puedeAvanzar()) {
          <button type="button" class="button-secondary" (click)="servicio.volverAlMesActual()">
            Ir al mes actual
          </button>
        }
      </div>

      @if (servicio.estado() === 'error') {
        <div class="empty-state" role="alert">
          <strong>No se pudieron leer los reportes de clima social</strong>
          <p>{{ servicio.error()?.message }}</p>
          <button type="button" class="button-secondary" (click)="recargar()">Reintentar</button>
        </div>
      } @else if (servicio.estado() === 'cargando' && servicio.documentos().length === 0) {
        <div class="empty-state" role="status">Cargando los reportes de clima social…</div>
      } @else {
        @if (servicio.reporteDelMes(); as reporte) {
          <section class="surface reporte" aria-labelledby="titulo-reporte">
            <div class="surface-heading">
              <div>
                <p class="section-eyebrow">Reporte del mes</p>
                <h2 id="titulo-reporte">{{ reporte.titulo || 'Sin título' }}</h2>
              </div>
              <div class="acciones">
                @if (enlaceReporte(); as url) {
                  <a class="button-primary" [href]="url" target="_blank" rel="noopener">
                    Abrir reporte
                  </a>
                } @else {
                  <button
                    type="button"
                    class="button-primary"
                    disabled
                    [attr.title]="
                      servicio.estadoDetalle() === 'cargando'
                        ? 'Buscando el enlace del reporte…'
                        : 'El registro no tiene enlace al PDF'
                    "
                  >
                    Abrir reporte
                  </button>
                }
                <app-exportar-menu
                  entidad="documentos"
                  [id]="reporte.id"
                  (fallo)="alFallarExportacion($event)"
                />
              </div>
            </div>

            <dl class="meta">
              <div>
                <dt>Mes</dt>
                <dd>{{ servicio.etiquetaMes() }}</dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>{{ formatearFecha(reporte.fecha) }}</dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{{ etiquetaTipo(reporte) }}</dd>
              </div>
              <div>
                <dt>Responsable</dt>
                <dd>{{ reporte.responsableNombre || 'Sin responsable' }}</dd>
              </div>
              <div>
                <dt>Código</dt>
                <dd>{{ reporte.codigo || 'Sin código' }}</dd>
              </div>
              <div>
                <dt>Validación</dt>
                <dd>
                  <span [class]="'status-badge ' + claseValidacion(reporte)">
                    <span class="status-dot"></span>{{ etiquetaValidacion(reporte) }}
                  </span>
                </dd>
              </div>
            </dl>

            @if (avisoExportacion(); as aviso) {
              <p class="exportar-error" role="alert">{{ aviso }}</p>
            }
          </section>

          @if (servicio.estadoDetalle() === 'cargando') {
            <div class="empty-state" role="status">Cargando el contenido del reporte…</div>
          } @else if (servicio.estadoDetalle() === 'error') {
            <div class="empty-state" role="alert">
              <strong>No se pudo leer el contenido del reporte</strong>
              <p>{{ servicio.errorDetalle()?.message }}</p>
              <button type="button" class="button-secondary" (click)="servicio.recargarDetalle()">
                Reintentar
              </button>
            </div>
          } @else if (servicio.estadoDetalle() === 'listo') {
            @for (seccion of secciones(); track seccion.clave) {
              <section
                class="surface bloque-reporte"
                [attr.aria-labelledby]="'seccion-' + seccion.clave"
              >
                <div class="surface-heading">
                  <div>
                    <h3 [id]="'seccion-' + seccion.clave">{{ seccion.titulo }}</h3>
                  </div>
                </div>
                <div class="prosa">
                  @if (seccion.bloques.length === 0) {
                    <p class="sin-dato">Sin dato en el registro.</p>
                  } @else {
                    @for (bloque of seccion.bloques; track $index) {
                      @if (bloque.tipo === 'lista') {
                        <ul>
                          @for (item of bloque.items; track $index) {
                            <li>{{ item }}</li>
                          }
                        </ul>
                      } @else {
                        <p>{{ bloque.texto }}</p>
                      }
                    }
                  }
                </div>
              </section>
            }
          }
        }

        <section class="lectura" aria-labelledby="titulo-casos">
          <div class="surface-heading lectura-cabecera">
            <div>
              <p class="section-eyebrow">Casos abiertos</p>
              <h3 id="titulo-casos">Lectura del territorio</h3>
            </div>
            <div class="acciones">
              <a class="link-button" routerLink="/mapa">Panorama territorial</a>
              <a class="link-button" routerLink="/casos">Casos</a>
              <a class="link-button" routerLink="/alertas">Alertas tempranas</a>
            </div>
          </div>

          @if (panorama.estado() === 'error') {
            <div class="empty-state" role="alert">
              <strong>No se pudieron leer los casos abiertos</strong>
              <p>{{ panorama.error()?.message }}</p>
              <button type="button" class="button-secondary" (click)="panorama.recargar()">
                Reintentar
              </button>
            </div>
          } @else if (panorama.estado() === 'cargando' && panorama.casos().length === 0) {
            <div class="empty-state" role="status">Cargando los casos abiertos…</div>
          } @else {
            <div class="executive-kpis">
              @for (indicador of indicadores(); track indicador.clave) {
                <div class="stat-card">
                  <span
                    class="stat-icon"
                    [class.amber]="indicador.tono === 'amber'"
                    [class.red]="indicador.tono === 'red'"
                  >
                    <app-icono [nombre]="indicador.icono" [tamano]="16" />
                  </span>
                  <span class="stat-copy">
                    <span>{{ indicador.etiqueta }}</span>
                    <strong>{{ indicador.valor }}</strong>
                    @if (indicador.nota) {
                      <small>{{ indicador.nota }}</small>
                    }
                  </span>
                </div>
              }
            </div>

            <div class="table-wrap">
              <table class="data-table" aria-label="Casos abiertos por nivel de conflictividad">
                <thead>
                  <tr>
                    <th scope="col" [appThOrden]="'nivel'" [orden]="ordenNiveles">Nivel</th>
                    <th scope="col" [appThOrden]="'total'" [orden]="ordenNiveles">
                      Casos abiertos
                    </th>
                    <th scope="col" [appThOrden]="'situacion'" [orden]="ordenNiveles">Situación</th>
                  </tr>
                </thead>
                <tbody>
                  @for (fila of filasVisibles(); track fila.nivel) {
                    <tr>
                      <td>
                        <strong>{{ fila.nivel }}</strong>
                      </td>
                      <td>{{ fila.total }}</td>
                      <td>{{ fila.situacion }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            @if (sinNivel() > 0) {
              <p class="nota">
                Los casos sin nivel declarado se cuentan como latente; no se suman aparte.
              </p>
            }
          }
        </section>

        <section class="historico" aria-labelledby="titulo-historico">
          <div class="surface-heading lectura-cabecera">
            <div>
              <h3 id="titulo-historico">Histórico de reportes de clima social</h3>
            </div>
          </div>

          @if (servicio.historico().length === 0) {
            <div class="empty-state">Sin reportes de clima social registrados.</div>
          } @else {
            <div class="table-wrap">
              <table class="data-table" aria-label="Histórico de reportes de clima social">
                <thead>
                  <tr>
                    <th scope="col" [appThOrden]="'codigo'" [orden]="ordenHistorico">Reporte</th>
                    <th scope="col" [appThOrden]="'fecha'" [orden]="ordenHistorico">Fecha</th>
                    <th scope="col" [appThOrden]="'tipo'" [orden]="ordenHistorico">Tipo</th>
                    <th scope="col" [appThOrden]="'responsable'" [orden]="ordenHistorico">
                      Responsable
                    </th>
                    <th scope="col" [appThOrden]="'validado'" [orden]="ordenHistorico">
                      Validación
                    </th>
                    <th scope="col">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  @for (documento of historicoVisible(); track documento.id) {
                    <tr>
                      <td>
                        <strong>{{ documento.codigo || 'Sin código' }}</strong>
                        <small>{{ documento.titulo || 'Sin título' }}</small>
                      </td>
                      <td>{{ formatearFecha(documento.fecha) }}</td>
                      <td>{{ documento.tipoNombre || 'Clima social' }}</td>
                      <td>{{ documento.responsableNombre || 'Sin responsable' }}</td>
                      <td>
                        <span [class]="'status-badge ' + claseValidacion(documento)">
                          <span class="status-dot"></span>{{ etiquetaValidacion(documento) }}
                        </span>
                      </td>
                      <td>
                        @if (documento.id === idVigente()) {
                          <span class="badge">Vigente</span>
                        } @else {
                          <button
                            type="button"
                            class="link-button"
                            (click)="servicio.irAlMesDe(documento)"
                          >
                            Ver mes
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .mes-barra {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 15px;
    }

    .mes-nav {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper, #fff);
    }

    .mes-flecha {
      min-height: 34px;
      padding: 0 9px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--ink-2);
      cursor: pointer;
    }

    .mes-flecha:hover:not(:disabled) {
      background: var(--canvas);
    }

    .mes-flecha:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .mes-nombre {
      min-width: 148px;
      text-align: center;
      color: var(--ink);
      font: 700 14px var(--font-display, inherit);
    }

    .reporte {
      padding: 16px;
      margin-bottom: 14px;
    }

    .reporte .surface-heading h2 {
      margin: 0;
      color: var(--ink);
      font: 700 17px var(--font-display, inherit);
    }

    .acciones {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .acciones a {
      text-decoration: none;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px 18px;
      margin: 14px 0 0;
      padding: 14px 0 0;
      border-top: 1px solid var(--line);
    }

    .meta dt {
      margin: 0 0 3px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .meta dd {
      margin: 0;
      color: var(--ink);
      font-size: 13px;
      font-weight: 600;
    }

    .bloque-reporte {
      padding: 16px;
      margin-bottom: 12px;
    }

    .bloque-reporte .surface-heading h3 {
      margin: 0 0 4px;
      color: var(--ink);
      font: 700 14.5px var(--font-display, inherit);
    }

    .prosa {
      margin-top: 10px;
      color: var(--ink-2);
      font-size: 13px;
      line-height: 1.6;
    }

    .prosa p {
      margin: 0 0 8px;
    }

    .prosa p:last-child {
      margin-bottom: 0;
    }

    .prosa ul {
      margin: 0 0 10px;
      padding-left: 18px;
      display: grid;
      gap: 5px;
    }

    .prosa ul:last-child {
      margin-bottom: 0;
    }

    .prosa li {
      font-size: 13px;
      line-height: 1.55;
    }

    .sin-dato {
      color: var(--muted);
      font-style: italic;
      font-weight: 600;
    }

    .nota {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 12px;
    }

    .exportar-error {
      margin: 10px 0 0;
      color: var(--red);
      font-size: 12.5px;
      font-weight: 600;
    }

    .lectura,
    .historico {
      margin-bottom: 14px;
    }

    .lectura-cabecera {
      margin-bottom: 12px;
    }

    .lectura-cabecera h3 {
      margin: 0;
      color: var(--ink);
      font: 700 14.5px var(--font-display, inherit);
    }

    @media (max-width: 720px) {
      .meta {
        grid-template-columns: 1fr 1fr;
      }

      .mes-barra {
        align-items: stretch;
      }
    }
  `,
})
export class ClimaSocialPage {
  readonly servicio = inject(ClimaReporteService);
  readonly panorama = inject(PanoramaService);

  readonly avisoExportacion = signal<string | null>(null);

  // Helpers expuestos a la plantilla.
  readonly formatearFecha = formatearFecha;
  readonly etiquetaTipo = etiquetaTipo;
  readonly etiquetaValidacion = etiquetaValidacion;
  readonly claseValidacion = claseValidacion;

  private readonly conteos = computed(() => conteosPorSituacion(this.panorama.casos()));

  readonly sinNivel = computed(() => this.conteos().sinNivel);

  private readonly riesgoAlto = computed(
    () => this.panorama.casos().filter((caso) => caso.riesgo === 'Alto').length,
  );

  readonly idVigente = computed(() => this.servicio.reporteDelMes()?.id ?? null);

  readonly secciones = computed(() => construirSecciones(this.servicio.detalle()));

  readonly enlaceReporte = computed(() => {
    const reporte = this.servicio.reporteDelMes();
    if (!reporte) return null;
    if (reporte.archivo) return reporte.archivo;

    const detalle = this.servicio.detalle();
    if (detalle && detalle.documento.id === reporte.id) {
      return urlDeContenido(detalle.contenido);
    }
    return null;
  });

  readonly indicadores = computed<Indicador[]>(() => {
    const conteos = this.conteos();
    const sinNivel = conteos.sinNivel;
    return [
      {
        clave: 'total',
        etiqueta: 'Casos abiertos',
        icono: 'casos',
        tono: '',
        valor: conteos.total,
        nota: '',
      },
      {
        clave: 'latente',
        etiqueta: 'Conflictividad latente',
        icono: 'alerta',
        tono: 'amber',
        valor: conteos.latentes,
        nota: sinNivel > 0 ? `Incluye ${sinNivel} sin nivel declarado` : '',
      },
      {
        clave: 'manifiesto',
        etiqueta: 'Conflictividad manifiesta',
        icono: 'casos',
        tono: 'red',
        valor: conteos.manifiestos,
        nota: '',
      },
      {
        clave: 'riesgo',
        etiqueta: 'Casos con riesgo alto',
        icono: 'escudo',
        tono: 'red',
        valor: this.riesgoAlto(),
        nota: '',
      },
    ];
  });

  readonly niveles = computed<NivelClima[]>(() => {
    const porNivel = new Map<string, number>();
    for (const caso of this.panorama.casos()) {
      const nivel = caso.nivelConflicto ?? 'Sin nivel declarado';
      porNivel.set(nivel, (porNivel.get(nivel) ?? 0) + 1);
    }

    const situaciones: Record<string, string> = {
      Diferencia: 'Latente',
      Controversia: 'Latente',
      'Conflicto social': 'Manifiesto',
      'Crisis social': 'Manifiesto',
    };

    return ['Diferencia', 'Controversia', 'Conflicto social', 'Crisis social'].map((nivel) => ({
      nivel,
      total: porNivel.get(nivel) ?? 0,
      situacion: situaciones[nivel] ?? '—',
    }));
  });

  readonly ordenNiveles = new OrdenTabla<NivelClima>();

  private readonly accesoresNivel: Record<string, (fila: NivelClima) => unknown> = {
    nivel: (fila) => fila.nivel,
    total: (fila) => fila.total,
    situacion: (fila) => fila.situacion,
  };

  readonly filasVisibles = computed(() =>
    this.ordenNiveles.ordenar(this.niveles(), this.accesoresNivel),
  );

  readonly ordenHistorico = new OrdenTabla<DocumentoClima>();

  private readonly accesoresHistorico: Record<string, (fila: DocumentoClima) => unknown> = {
    codigo: (fila) => fila.codigo,
    fecha: (fila) => fila.fecha,
    tipo: (fila) => fila.tipoNombre,
    responsable: (fila) => fila.responsableNombre,
    validado: (fila) => fila.validado,
  };

  readonly historicoVisible = computed(() =>
    this.ordenHistorico.ordenar(this.servicio.historico(), this.accesoresHistorico),
  );

  recargar(): void {
    this.servicio.recargar();
    this.panorama.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.avisoExportacion.set(mensaje);
  }
}
