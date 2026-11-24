import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import { RangoFechasComponent, type RangoFechas } from '../../shared/ui/rango-fechas.component';

import {
  ANALITICA_VACIA,
  COLORES_SERIE,
  ETIQUETAS_SERIE,
  FILTROS_INICIALES,
  aAnalitica,
  construirGrafico,
  etiquetaDiaCorta,
  etiquetaEjePeriodo,
  etiquetaPeriodo as etiquetaPeriodoMapeo,
  fechaHoyLima,
  formatearDias as formatearDiasMapeo,
  formatearFechaDdMmAaaa as formatearFechaMapeo,
  formatearFechaHoraLima as formatearFechaHoraMapeo,
  formatearNumero as formatearNumeroMapeo,
  formatearPorcentaje as formatearPorcentajeMapeo,
  restarMeses,
  totalPeriodo as totalPeriodoMapeo,
  type ActividadUsuario,
  type Analitica,
  type FiltrosDashboard,
  type Grafico,
  type Granularidad,
  type PeriodoAnalitica,
  type SerieGrafico,
} from './dashboard.mapeo';
import { DashboardService } from './dashboard.service';

type Preset = 'todo' | '12m' | '5a';

/**
 * Dashboard analítico (items 51 · 52 · 57 · 85).
 *
 * Dos ejes que no se mezclan: el **volumen** se agrupa por fecha de negocio de
 * cada entidad y la **actividad de la oficina** por `created_at` / `created_by`.
 * La API devuelve el veredicto de confiabilidad de la segunda y la pantalla lo
 * respeta: si la serie diaria no es real, se muestra el motivo y no se dibuja.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [IconoComponent, RangoFechasComponent],
  templateUrl: './dashboard.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .grid {
      display: grid;
      gap: 14px;
    }

    .kpi-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .two-col {
      grid-template-columns: 1.02fr 0.98fr;
      align-items: start;
    }

    @media (max-width: 1120px) {
      .kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .two-col {
        grid-template-columns: 1fr;
      }
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 15px 12px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--paper);
    }

    .card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .card-title {
      margin: 0;
      color: var(--ink);
      font: 700 13px/1.3 var(--font-display);
      letter-spacing: -0.15px;
    }

    .card-sub {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
    }

    .kpi-val {
      color: var(--ink);
      font: 700 32px/1.02 var(--font-display);
      letter-spacing: -1.3px;
    }

    .kpi-val small {
      margin-left: 2px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0;
    }

    .kpi-note {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.55;
    }

    .meta {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 3px 8px;
      margin: 0;
      padding-top: 8px;
      border-top: 1px dashed var(--line);
      color: var(--ink-2);
      font-size: 10.5px;
      line-height: 1.45;
    }

    .meta dt {
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.045em;
      text-transform: uppercase;
    }

    .meta dd {
      margin: 0;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      color: var(--muted);
      font-size: 10.5px;
    }

    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .legend i {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }

    .series {
      display: block;
      width: 100%;
      height: auto;
    }

    .rejilla {
      stroke: var(--line);
      stroke-width: 1;
    }

    .eje-valor,
    .eje-marca {
      fill: var(--muted);
      font-size: 8.5px;
    }

    .chart-empty {
      padding: 26px 18px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: var(--canvas);
      color: var(--muted);
      font-size: 11px;
      line-height: 1.6;
      text-align: center;
    }

    .chart-empty strong {
      display: block;
      margin-bottom: 4px;
      color: var(--ink-2);
      font-size: 12px;
    }

    .chart-empty code {
      font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: 10px;
    }

    .flag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--amber-pale);
      color: var(--ink-2);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .flag-ok {
      background: var(--green-pale);
      color: var(--green);
    }

    .flag-off {
      background: var(--canvas);
      color: var(--muted);
    }

    .bars {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .bar-row {
      display: grid;
      grid-template-columns: 150px 1fr 52px;
      align-items: center;
      gap: 8px;
    }

    .bar-lab {
      overflow: hidden;
      color: var(--ink-2);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bar-track {
      display: flex;
      height: 9px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--canvas);
    }

    .bar-seg {
      height: 100%;
    }

    .bar-val {
      color: var(--ink-2);
      font-size: 11px;
      font-weight: 600;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .metric-inline {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .metric-inline b {
      color: var(--ink);
      font: 700 22px/1 var(--font-display);
      letter-spacing: -0.6px;
    }

    .metric-inline span {
      color: var(--muted);
      font-size: 11px;
    }

    .footnote {
      margin: 0;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.6;
    }

    .footnote strong {
      color: var(--ink-2);
      font-weight: 600;
    }

    .footnote code,
    .meta-line code,
    .declaracion code,
    .head-note code {
      padding: 1px 4px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: var(--canvas);
      color: var(--ink-2);
      font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: 10px;
    }

    .sql-box {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--paper);
    }

    .sql-box > summary {
      padding: 8px 11px;
      color: var(--ink-2);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .sql-tabla {
      border-right: 0;
      border-bottom: 0;
      border-left: 0;
      border-radius: 0;
      background: transparent;
    }

    .meta-line {
      margin: -4px 2px 0;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.6;
    }

    .declaracion {
      padding: 8px 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--canvas);
      color: var(--ink-2);
      font-size: 11.5px;
      line-height: 1.55;
    }

    .declaracion p {
      margin: 0 0 3px;
    }

    .declaracion p:last-child {
      margin-bottom: 0;
    }

    .head-note {
      margin: 2px 0 0;
      color: var(--ink-2);
      font-size: 11.5px;
      line-height: 1.55;
    }

    .head-note b {
      color: var(--ink);
    }

    .anexo-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 9px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--blue-pale);
      color: var(--blue-dark);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .cut-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 35px;
      padding: 0 10px;
      border: 1px dashed var(--line);
      border-radius: 6px;
      background: var(--paper);
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .cut-chip b {
      color: var(--ink-2);
      font-weight: 600;
    }

    .scope-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 9px 16px;
      padding: 9px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }

    .scope-bar .scope-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .scope-bar .scope-note {
      flex: 1 1 100%;
      margin: 0;
      padding-left: 8px;
      border-left: 2px solid var(--amber);
      color: var(--muted);
      font-size: 11px;
      line-height: 1.55;
    }

    .scope-bar .scope-note b {
      color: var(--ink-2);
    }

    .select-filter input[type='date'] {
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ink-2);
      font-family: inherit;
      font-size: 12px;
    }

    .sec-head {
      margin-top: 6px;
    }

    .sec-h2 {
      margin: 4px 0 2px;
      color: var(--ink);
      font: 700 15px/1.2 var(--font-display);
      letter-spacing: -0.3px;
    }

    .sec-sub {
      margin: 0 0 4px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .chart-h3 {
      margin: 0 0 2px;
      color: var(--ink);
      font: 700 12.5px/1.3 var(--font-display);
    }

    .data-table .num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .data-table tfoot td {
      border-top: 1px solid var(--line);
      background: var(--canvas);
      color: var(--ink-2);
      font-weight: 600;
    }

    .tag-mini {
      flex: none;
      padding: 3px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    @media print {
      .scope-bar,
      .filter-bar,
      .declaracion,
      .view-actions {
        display: none;
      }
    }
  `,
})
export class DashboardPage {
  private readonly plataforma = inject(PLATFORM_ID);
  private readonly servicio = inject(DashboardService);

  readonly filtros = signal<FiltrosDashboard>({ ...FILTROS_INICIALES });
  readonly descargando = signal(false);
  readonly errorDescarga = signal<string | null>(null);

  // `consulta` usa `effect`: debe inicializarse como campo de la clase.
  private readonly analitica = consulta<Analitica>({
    fuente: () =>
      urlConParametros(urlApi('/v1/analitica'), {
        ...this.filtros(),
      }),
    esquema: aAnalitica,
  });

  readonly datos = computed<Analitica>(() => this.analitica.valor() ?? ANALITICA_VACIA);
  readonly error = this.analitica.error;
  readonly esquemaPendiente = computed(
    () => this.analitica.error()?.codigo === 'ESQUEMA_PENDIENTE',
  );
  readonly cargando = computed(() => {
    const estado = this.analitica.estado();
    return (estado === 'cargando' || estado === 'inactivo') && this.analitica.valor() === undefined;
  });

  readonly zonaHoraria = computed(() => this.datos().zonaHoraria || 'America/Lima');
  readonly granularidad = computed(() => this.filtros().granularidad);
  readonly corte = computed(() => this.datos().corte);
  readonly catalogos = computed(() => this.datos().catalogos);
  readonly regiones = computed(() => this.catalogos().regiones);
  readonly subsectores = computed(() => this.catalogos().subsectores);
  readonly periodos = computed(() => this.datos().volumen.periodos);
  readonly totales = computed(() => this.datos().volumen.totales);
  readonly actividad = computed(() => this.datos().actividad);
  readonly resolucion = computed(() => this.datos().resolucionCompromisos);
  readonly resumen = computed(() => this.datos().resumen);

  readonly totalVolumen = computed(() => {
    const totales = this.totales();
    return (
      totales.casos +
      totales.demandas +
      totales.alertas +
      totales.compromisos +
      totales.documentos +
      totales.reuniones
    );
  });

  readonly sinDatos = computed(() => this.totalVolumen() === 0);

  readonly latenteTotal = computed(() => this.totales().latente + this.totales().sinNivel);

  readonly porcentajeManifiesto = computed(() => {
    const totales = this.totales();
    return totales.casos > 0 ? (totales.manifiesto / totales.casos) * 100 : 0;
  });

  readonly haySerieVolumen = computed(() =>
    this.periodos().some((periodo) => this.totalPeriodo(periodo) > 0),
  );

  readonly motivoSinVolumen = computed(() => {
    if (this.periodos().length === 0) {
      return 'La consulta no devolvió periodos: revisa el rango de fechas o los filtros territoriales.';
    }
    return 'Ningún registro de la ventana tiene fecha de negocio utilizable; revisa la tabla de resumen para ver cuántos quedan «sin fecha».';
  });

  readonly periodosConDato = computed(() =>
    this.periodos().filter((periodo) => this.totalPeriodo(periodo) > 0),
  );

  readonly periodosOmitidos = computed(
    () => this.periodos().length - this.periodosConDato().length,
  );

  readonly seriesVolumen = computed<readonly SerieGrafico[]>(() => {
    const periodos = this.periodos();
    return [
      {
        clave: 'casos',
        etiqueta: ETIQUETAS_SERIE['casos'] ?? 'Casos',
        color: COLORES_SERIE['casos'] ?? 'var(--blue)',
        valores: periodos.map((periodo) => periodo.casos),
      },
      {
        clave: 'demandas',
        etiqueta: ETIQUETAS_SERIE['demandas'] ?? 'Demandas',
        color: COLORES_SERIE['demandas'] ?? 'var(--teal)',
        valores: periodos.map((periodo) => periodo.demandas),
      },
      {
        clave: 'alertas',
        etiqueta: ETIQUETAS_SERIE['alertas'] ?? 'Alertas',
        color: COLORES_SERIE['alertas'] ?? 'var(--amber)',
        valores: periodos.map((periodo) => periodo.alertas),
      },
      {
        clave: 'compromisos',
        etiqueta: ETIQUETAS_SERIE['compromisos'] ?? 'Compromisos',
        color: COLORES_SERIE['compromisos'] ?? 'var(--red)',
        valores: periodos.map((periodo) => periodo.compromisos),
      },
      {
        clave: 'documentos',
        etiqueta: ETIQUETAS_SERIE['documentos'] ?? 'Documentos',
        color: COLORES_SERIE['documentos'] ?? 'var(--green)',
        valores: periodos.map((periodo) => periodo.documentos),
      },
      {
        clave: 'reuniones',
        etiqueta: ETIQUETAS_SERIE['reuniones'] ?? 'Reuniones',
        color: COLORES_SERIE['reuniones'] ?? 'var(--muted)',
        valores: periodos.map((periodo) => periodo.reuniones),
      },
    ];
  });

  readonly etiquetasEje = computed(() =>
    this.periodos().map((periodo) => etiquetaEjePeriodo(periodo, this.granularidad())),
  );

  readonly graficoVolumen = computed<Grafico>(() =>
    construirGrafico(this.seriesVolumen(), this.etiquetasEje(), { ancho: 760, alto: 240 }),
  );

  readonly seriesMezcla = computed<readonly SerieGrafico[]>(() => {
    const periodos = this.periodos();
    return [
      {
        clave: 'manifiesto',
        etiqueta: 'Manifiesto',
        color: COLORES_SERIE['manifiesto'] ?? 'var(--red)',
        valores: periodos.map((periodo) => periodo.manifiesto),
      },
      {
        clave: 'latente',
        etiqueta: 'Latente',
        color: COLORES_SERIE['latente'] ?? 'var(--blue)',
        valores: periodos.map((periodo) => periodo.latente),
      },
      {
        clave: 'sinNivel',
        etiqueta: 'Sin nivel',
        color: COLORES_SERIE['sinNivel'] ?? 'var(--muted)',
        valores: periodos.map((periodo) => periodo.sinNivel),
      },
    ];
  });

  readonly graficoMezcla = computed<Grafico>(() =>
    construirGrafico(this.seriesMezcla(), this.etiquetasEje(), { ancho: 600, alto: 220 }),
  );

  readonly barrasMezcla = computed(() => {
    const totales = this.totales();
    const total = totales.casos;
    const filas = [
      {
        etiqueta: 'Manifiesto',
        valor: totales.manifiesto,
        color: COLORES_SERIE['manifiesto'] ?? 'var(--red)',
      },
      {
        etiqueta: 'Latente (diferencia o controversia)',
        valor: totales.latente,
        color: COLORES_SERIE['latente'] ?? 'var(--blue)',
      },
      {
        etiqueta: 'Sin nivel',
        valor: totales.sinNivel,
        color: COLORES_SERIE['sinNivel'] ?? 'var(--muted)',
      },
    ];

    return filas.map((fila) => ({
      ...fila,
      ancho: total > 0 ? Math.min(100, Math.max(0, (fila.valor / total) * 100)) : 0,
    }));
  });

  readonly graficoActividad = computed<Grafico | null>(() => {
    const actividad = this.actividad();
    if (!actividad.confiable || actividad.porDia.length < 2) return null;

    const series: SerieGrafico[] = [
      {
        clave: 'registros',
        etiqueta: 'Registros',
        color: COLORES_SERIE['registros'] ?? 'var(--blue)',
        valores: actividad.porDia.map((dia) => dia.registros),
      },
    ];

    return construirGrafico(
      series,
      actividad.porDia.map((dia) => etiquetaDiaCorta(dia.fecha)),
      { ancho: 600, alto: 220 },
    );
  });

  readonly barrasUsuarios = computed(() => {
    const usuarios = this.actividad().porUsuario.slice(0, 12);
    const maximo = usuarios.reduce((tope, usuario) => Math.max(tope, usuario.registros), 0);

    return usuarios.map((usuario) => ({
      etiqueta: this.etiquetaUsuario(usuario),
      titulo: usuario.usuario ?? 'Nombre no visible por la política de fila',
      registros: usuario.registros,
      legado: usuario.legado,
      ancho: maximo > 0 ? Math.max(2, Math.round((usuario.registros / maximo) * 100)) : 0,
    }));
  });

  readonly proporcionLegado = computed(() => {
    const actividad = this.actividad();
    return actividad.totalRegistros > 0
      ? (actividad.totalLegado / actividad.totalRegistros) * 100
      : 0;
  });

  readonly presetActivo = computed<'todo' | '12m' | '5a' | 'personalizado'>(() => {
    const filtros = this.filtros();
    if (!filtros.desde && !filtros.hasta) return 'todo';

    const hoy = fechaHoyLima();
    if (filtros.hasta === hoy && filtros.desde === restarMeses(hoy, 12)) return '12m';
    if (filtros.hasta === hoy && filtros.desde === restarMeses(hoy, 60)) return '5a';
    return 'personalizado';
  });

  readonly corteTexto = computed(() => {
    const corte = this.corte();
    if (!corte.datosDesde || !corte.datosHasta) return 'sin dato';
    return `${formatearFechaMapeo(corte.datosDesde)} – ${formatearFechaMapeo(corte.datosHasta)}`;
  });

  readonly ventanaTexto = computed(() => {
    const corte = this.corte();
    if (!corte.ventanaDesde || !corte.ventanaHasta) return 'sin dato';
    return `${formatearFechaMapeo(corte.ventanaDesde)} – ${formatearFechaMapeo(
      corte.ventanaHasta,
    )}`;
  });

  readonly generadoTexto = computed(() => formatearFechaHoraMapeo(this.datos().generadoEn));

  readonly filtrosTexto = computed(() => {
    const filtros = this.filtros();
    const partes: string[] = [
      filtros.region ? `Región: ${filtros.region}` : 'Todas las regiones',
      filtros.subsector ? `Subsector: ${filtros.subsector}` : 'Ambos subsectores',
    ];

    if (filtros.desde || filtros.hasta) {
      partes.push(
        `Ventana: ${filtros.desde ? formatearFechaMapeo(filtros.desde) : 'inicio'} – ${
          filtros.hasta ? formatearFechaMapeo(filtros.hasta) : 'hoy'
        }`,
      );
    } else {
      partes.push('Ventana: todo el registro');
    }

    return partes.join(' · ');
  });

  readonly ariaVolumen = computed(() => {
    const totales = this.totales();
    return `Volumen por periodo: ${totales.casos} casos, ${totales.demandas} demandas, ${totales.alertas} alertas, ${totales.compromisos} compromisos, ${totales.documentos} documentos y ${totales.reuniones} reuniones.`;
  });

  readonly ariaMezcla = computed(() => {
    const totales = this.totales();
    return `Casos por grupo: ${totales.manifiesto} manifiesto, ${totales.latente} latente y ${totales.sinNivel} sin nivel.`;
  });

  readonly ariaActividad = computed(() => {
    const actividad = this.actividad();
    return `${actividad.totalRegistros} registros en ${actividad.dias} día(s) con marca de creación, entre ${formatearFechaMapeo(
      actividad.rango.primera,
    )} y ${formatearFechaMapeo(actividad.rango.ultima)}.`;
  });

  // ─────────────────────────────── acciones ───────────────────────────────

  cambiarGranularidad(granularidad: Granularidad): void {
    this.filtros.update((actuales) => ({ ...actuales, granularidad }));
  }

  /**
   * El rango compartido entra y sale en ISO; los filtros del dashboard usan
   * cadena vacía para «sin extremo», que `urlConParametros` omite.
   */
  cambiarRango(rango: RangoFechas): void {
    this.filtros.update((actuales) => ({
      ...actuales,
      desde: rango.desde ?? '',
      hasta: rango.hasta ?? '',
    }));
  }

  filtrarRegion(evento: Event): void {
    this.filtros.update((actuales) => ({ ...actuales, region: this.valorDe(evento) }));
  }

  filtrarSubsector(evento: Event): void {
    this.filtros.update((actuales) => ({ ...actuales, subsector: this.valorDe(evento) }));
  }

  aplicarPreset(preset: Preset): void {
    if (preset === 'todo') {
      this.filtros.update((actuales) => ({ ...actuales, desde: '', hasta: '' }));
      return;
    }

    const hoy = fechaHoyLima();
    const meses = preset === '12m' ? 12 : 60;
    this.filtros.update((actuales) => ({
      ...actuales,
      desde: restarMeses(hoy, meses),
      hasta: hoy,
    }));
  }

  limpiar(): void {
    this.filtros.set({ ...FILTROS_INICIALES });
    this.errorDescarga.set(null);
  }

  async descargarCsv(): Promise<void> {
    if (this.descargando()) return;

    this.descargando.set(true);
    this.errorDescarga.set(null);

    try {
      await this.servicio.descargarCsv({ ...this.filtros() });
    } catch (fallo) {
      this.errorDescarga.set(
        aErrorApi(fallo, 'No se pudo descargar el CSV del dashboard.').message,
      );
    } finally {
      this.descargando.set(false);
    }
  }

  imprimir(): void {
    if (!isPlatformBrowser(this.plataforma)) return;
    window.print();
  }

  recargar(): void {
    this.analitica.recargar();
  }

  // ───────────────────────── envoltorios de plantilla ─────────────────────────

  viewBox(grafico: Grafico): string {
    return `0 0 ${grafico.ancho} ${grafico.alto}`;
  }

  etiquetaSerie(clave: string): string {
    return ETIQUETAS_SERIE[clave] ?? clave;
  }

  etiquetaUsuario(usuario: ActividadUsuario): string {
    if (usuario.usuario) return usuario.usuario;
    if (usuario.legado === usuario.registros) return 'Carga del legado';
    return 'Sin nombre visible';
  }

  formatearNumero(valor: number): string {
    return formatearNumeroMapeo(valor);
  }

  formatearPorcentaje(valor: number): string {
    return formatearPorcentajeMapeo(valor);
  }

  formatearDias(valor: number | null): string {
    return formatearDiasMapeo(valor);
  }

  formatearFecha(valor: string | null | undefined): string {
    return formatearFechaMapeo(valor);
  }

  formatearFechaHora(valor: string | null | undefined): string {
    return formatearFechaHoraMapeo(valor);
  }

  etiquetaPeriodo(periodo: PeriodoAnalitica): string {
    return etiquetaPeriodoMapeo(periodo, this.granularidad());
  }

  totalPeriodo(periodo: PeriodoAnalitica): number {
    return totalPeriodoMapeo(periodo);
  }

  private valorDe(evento: Event): string {
    return (evento.target as HTMLSelectElement | HTMLInputElement).value;
  }
}
