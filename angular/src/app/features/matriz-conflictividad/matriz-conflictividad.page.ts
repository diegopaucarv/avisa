import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import { hoyIso } from '../../core/fecha/zona-horaria';
import { TAMANO_PAGINA, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';

import {
  CATALOGOS_VACIOS,
  RESUMEN_VACIO,
  aCatalogos,
  aDetalle,
  aLista,
  claseEstado,
  claseNivel,
  clasePrioridad,
  claseRiesgo,
  formatearFechaDdMmAaaa,
  textoOSinDato,
  type CatalogosConflictividad,
  type DetalleConflictividad,
  type FilaConflictividad,
  type FiltrosMatriz,
  type ListaConflictividad,
  type Opcion,
} from './matriz-conflictividad.mapeo';
import { MatrizConflictividadService } from './matriz-conflictividad.service';

const FILTROS_INICIALES: FiltrosMatriz = {
  q: '',
  region: '',
  alcance: '',
  subsector: '',
  estado: '',
  nivel: '',
  prioridad: '',
  desde: '',
  hasta: '',
  orden: 'inicio',
};

/**
 * Matriz de conflictividad (Anexo 15).
 *
 * Una fila por caso abierto con las columnas de la Guía §8.3.1, filtros de
 * territorio, ámbito, estado, nivel y rango de fechas, ficha de fila en un
 * drawer y una hoja imprimible (más descarga CSV). Los conteos de manifiestos
 * y latentes los calcula el servidor; la regla se replica aquí sólo para
 * explicarla en pantalla.
 */
@Component({
  selector: 'app-matriz-conflictividad-page',
  imports: [RouterLink, GlosarioComponent, IconoComponent, PaginacionComponent],
  templateUrl: './matriz-conflictividad.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cerrarDetalle()',
  },
  styles: `
    :host {
      display: block;
    }

    .eyebrow {
      margin: 0 0 2px;
      color: var(--blue);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .regla-nota {
      margin: -2px 2px 0;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .regla-nota strong {
      color: var(--ink-2);
    }

    .chips-label {
      align-self: center;
      padding: 0 4px 0 2px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
    }

    .select-filter input[type='date'] {
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--ink-2);
      font: inherit;
      font-size: 12.5px;
    }

    .matriz-tabla {
      min-width: 1720px;
    }
    .matriz-tabla td:first-child,
    .matriz-tabla td:first-child:not(.col-seleccion) {
      min-width: 40px;
      width: 44px;
      white-space: nowrap;
    }
    .matriz-tabla td.col-codigo,
    .matriz-tabla th.col-codigo {
      min-width: 148px;
      font-weight: 600;
      color: var(--ink-2);
    }
    .matriz-tabla td.col-nombre {
      min-width: 250px;
      max-width: 310px;
      white-space: normal;
      line-height: 1.4;
      color: var(--ink-2);
    }
    .matriz-tabla td.col-date,
    .matriz-tabla td.col-num {
      font-variant-numeric: tabular-nums;
    }
    .matriz-tabla td.col-num,
    .matriz-tabla th.col-num {
      text-align: right;
    }

    .fila-matriz {
      cursor: pointer;
    }
    .fila-matriz:hover td,
    .fila-matriz:focus-within td {
      background: var(--canvas);
    }

    .sin-dato {
      color: var(--muted);
    }

    .conflict-tag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    .conflict-tag::before {
      content: '';
      width: 6px;
      height: 6px;
      flex: none;
      border-radius: 50%;
      background: var(--muted);
    }
    .nivel-diferencia::before {
      background: var(--muted);
    }
    .nivel-controversia::before {
      background: var(--blue);
    }
    .nivel-conflicto::before {
      background: var(--amber);
    }
    .nivel-crisis::before {
      background: var(--red);
    }
    .nivel-sin-dato::before {
      background: var(--line);
    }

    .riesgo-alto {
      background: var(--red-pale);
      color: var(--red);
    }
    .riesgo-moderado {
      background: var(--amber-pale);
      color: var(--amber);
    }
    .riesgo-bajo {
      background: var(--green-pale);
      color: var(--green);
    }
    .riesgo-sin-dato {
      background: var(--canvas);
      color: var(--muted);
    }

    .prioridad-urgente {
      background: var(--red-pale);
      color: var(--red);
    }
    .prioridad-moderado {
      background: var(--amber-pale);
      color: var(--amber);
    }
    .prioridad-bajo {
      background: var(--green-pale);
      color: var(--green);
    }
    .prioridad-sin-dato {
      background: var(--canvas);
      color: var(--muted);
    }

    .estado-abierto {
      background: var(--green-pale);
      color: var(--green);
    }
    .estado-resuelto {
      background: var(--blue-pale);
      color: var(--blue);
    }
    .estado-archivado {
      background: var(--canvas);
      color: var(--muted);
    }
    .estado-sin-dato {
      background: var(--canvas);
      color: var(--muted);
    }

    .rule-note {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 10.5px;
      font-weight: 400;
      white-space: nowrap;
    }

    .nota-tabla {
      margin: 0 2px;
      color: var(--muted);
      font-size: 12.5px;
    }

    .footnote {
      margin: 8px 2px 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }
    .footnote strong {
      color: var(--ink-2);
    }
    .footnote code,
    .hoja-pie code {
      padding: 0 4px;
      border: 1px solid var(--line);
      border-radius: 4px;
      background: var(--canvas);
      font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: 11.5px;
    }

    /* ── Vista imprimible ─────────────────────────────────────────────── */
    .acciones-impresion {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .pista-impresion {
      color: var(--muted);
      font-size: 12px;
    }

    /* La hoja siempre es clara: es la previsualización del papel, no depende
       del tema. No usa clases globales para no heredar los overrides oscuros. */
    .hoja {
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      padding: 28px 32px 34px;
      box-sizing: border-box;
      background: #fff;
      color: #14212b;
      border: 1px solid #d9e0e7;
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(17, 32, 45, 0.1);
    }
    .hoja-cabecera {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 10px;
      border-bottom: 2px solid #1d427f;
    }
    .hoja-emblema {
      display: inline-flex;
      flex-direction: column;
      flex: none;
      width: 22px;
      height: 30px;
      overflow: hidden;
      border-radius: 2px;
    }
    .hoja-emblema i {
      flex: 1;
    }
    .hoja-emblema i:nth-child(1) {
      background: #d91023;
    }
    .hoja-emblema i:nth-child(2) {
      background: #fff;
      border-top: 1px solid #d91023;
      border-bottom: 1px solid #d91023;
    }
    .hoja-emblema i:nth-child(3) {
      background: #d91023;
    }
    .hoja-marca {
      display: flex;
      flex-direction: column;
      line-height: 1.2;
    }
    .hoja-pais {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.14em;
      color: #14212b;
    }
    .hoja-ministerio {
      font-size: 11.5px;
      color: #33475b;
    }
    .hoja-oficina {
      max-width: 440px;
      margin-left: auto;
      text-align: right;
      font-size: 10.5px;
      color: #5a6b7a;
    }
    .hoja-titulo {
      margin: 18px 0 2px;
      color: #14212b;
      font: 700 17px/1.3 var(--font-display);
    }
    .hoja-subtitulo {
      margin: 0;
      font-size: 11px;
      color: #5a6b7a;
    }
    .hoja-meta {
      margin: 6px 0 0;
      font-size: 10.5px;
      color: #5a6b7a;
    }
    .hoja-regla {
      margin: 6px 0 12px;
      font-size: 10px;
      color: #7a8794;
    }
    .hoja-tabla {
      width: 100%;
      border-collapse: collapse;
    }
    .hoja-tabla th {
      padding: 6px 7px;
      border: 1px solid #c9d3dc;
      background: #eef2f6;
      color: #33475b;
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-align: left;
      text-transform: uppercase;
    }
    .hoja-tabla td {
      padding: 5px 7px;
      border: 1px solid #dde4ea;
      color: #26333f;
      font-size: 8.5px;
      vertical-align: top;
    }
    .hoja-tabla tbody tr:nth-child(even) td {
      background: #f8fafc;
    }
    .hoja-pie {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid #d9e0e7;
      color: #5a6b7a;
      font-size: 9.5px;
      line-height: 1.5;
    }
    .hoja-firma {
      display: flex;
      gap: 40px;
      margin-top: 34px;
    }
    .hoja-firma span {
      flex: 1;
      max-width: 240px;
      padding-top: 6px;
      border-top: 1px solid #94a1ad;
      font-size: 9.5px;
      color: #5a6b7a;
    }

    /* ── Detalle (drawer) ─────────────────────────────────────────────── */
    .detalle-codigo {
      margin: 0 0 2px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .detalle-datos {
      display: grid;
      grid-template-columns: minmax(120px, max-content) 1fr;
      gap: 6px 16px;
      margin: 0;
      font-size: 13px;
    }
    .detalle-datos dt {
      color: var(--muted);
    }
    .detalle-datos dd {
      margin: 0;
      color: var(--ink-2);
    }
    .detalle-seccion h3 {
      margin: 0 0 4px;
      color: var(--ink);
      font-size: 13px;
    }
    .detalle-seccion p {
      margin: 0;
      color: var(--ink-2);
      font-size: 13px;
      line-height: 1.55;
      white-space: pre-line;
    }

    /* ── Impresión ────────────────────────────────────────────────────── */
    @media print {
      .no-print {
        display: none !important;
      }
      .hoja {
        max-width: none;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .hoja-tabla th,
      .hoja-tabla td {
        font-size: 7pt;
      }
      .hoja-tabla th {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      .hoja-tabla thead {
        display: table-header-group;
      }
      .hoja-tabla tr {
        break-inside: avoid;
      }
    }
  `,
})
export class MatrizConflictividadPage {
  private readonly plataforma = inject(PLATFORM_ID);
  private readonly servicio = inject(MatrizConflictividadService);
  private readonly destruccion = inject(DestroyRef);

  readonly filtros = signal<FiltrosMatriz>({ ...FILTROS_INICIALES });
  readonly pagina = signal(1);
  readonly tamano = signal(TAMANO_PAGINA);
  readonly modo = signal<'lista' | 'imprimible'>('lista');
  readonly codigoDetalle = signal<string | null>(null);
  readonly descargando = signal(false);
  readonly errorDescarga = signal<string | null>(null);

  /** Fecha de corte de la hoja; se fija al abrir la pantalla. */
  readonly fechaCorte = formatearFechaDdMmAaaa(hoyIso());

  private temporizador?: ReturnType<typeof setTimeout>;

  // `consulta` usa `effect`: debe inicializarse como campo de la clase.
  private readonly catalogo = consulta<CatalogosConflictividad>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogos,
  });

  private readonly listado = consulta<ListaConflictividad>({
    fuente: () =>
      urlConParametros(urlApi('/v1/conflictividad'), {
        ...paramsDePagina({ pagina: this.pagina(), tamano: this.tamano() }),
        ...this.filtros(),
        ...(this.modo() === 'imprimible' ? { todas: '1' } : {}),
      }),
    esquema: aLista,
  });

  private readonly detalle = consulta<DetalleConflictividad | null>({
    fuente: () => {
      const codigo = this.codigoDetalle();
      return codigo ? urlApi(`/v1/conflictividad/${encodeURIComponent(codigo)}`) : null;
    },
    esquema: aDetalle,
  });

  readonly filas = computed<readonly FilaConflictividad[]>(
    () => this.listado.valor()?.elementos ?? [],
  );
  readonly resumen = computed(() => this.listado.valor()?.resumen ?? RESUMEN_VACIO);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly hayResumen = computed(() => this.listado.valor() !== undefined);

  readonly errorLista = this.listado.error;
  readonly esquemaPendiente = computed(() => this.listado.error()?.codigo === 'ESQUEMA_PENDIENTE');
  readonly cargando = computed(() => {
    const estado = this.listado.estado();
    return (estado === 'cargando' || estado === 'inactivo') && this.filas().length === 0;
  });
  readonly actualizando = computed(
    () => this.listado.estado() === 'cargando' && this.filas().length > 0,
  );
  readonly modoImprimible = computed(() => this.modo() === 'imprimible');

  readonly opcionesRegion = computed<readonly Opcion[]>(
    () => this.catalogo.valor()?.regiones ?? CATALOGOS_VACIOS.regiones,
  );
  readonly opcionesAlcance = computed<readonly Opcion[]>(
    () => this.catalogo.valor()?.alcances ?? CATALOGOS_VACIOS.alcances,
  );
  readonly opcionesSubsector = computed<readonly Opcion[]>(
    () => this.catalogo.valor()?.subsectores ?? CATALOGOS_VACIOS.subsectores,
  );
  readonly opcionesPrioridad = computed<readonly Opcion[]>(
    () => this.catalogo.valor()?.prioridades ?? CATALOGOS_VACIOS.prioridades,
  );
  readonly opcionesNivel = computed<readonly Opcion[]>(() => [
    { valor: 'manifiesto', etiqueta: 'Manifiesto (conflicto o crisis social)' },
    { valor: 'latente', etiqueta: 'Latente (diferencia, controversia o sin nivel)' },
    ...(this.catalogo.valor()?.niveles ?? CATALOGOS_VACIOS.niveles),
  ]);

  readonly numeroInicial = computed(() => (this.pagina() - 1) * this.tamano() + 1);

  readonly filtrosTexto = computed(() => {
    const filtros = this.filtros();
    const partes: string[] = [];
    if (filtros.q) partes.push(`Búsqueda: «${filtros.q}»`);
    if (filtros.region) partes.push(`Región: ${filtros.region}`);
    if (filtros.alcance) partes.push(`Alcance: ${filtros.alcance}`);
    if (filtros.subsector) partes.push(`Subsector: ${filtros.subsector}`);
    if (filtros.estado) partes.push(`Estado: ${filtros.estado}`);
    if (filtros.nivel) partes.push(`Nivel: ${this.etiquetaNivel(filtros.nivel)}`);
    if (filtros.prioridad) partes.push(`Prioridad: ${filtros.prioridad}`);
    if (filtros.desde) partes.push(`Desde: ${formatearFechaDdMmAaaa(filtros.desde)}`);
    if (filtros.hasta) partes.push(`Hasta: ${formatearFechaDdMmAaaa(filtros.hasta)}`);
    return partes.length
      ? partes.join(' · ')
      : 'Sin filtros: toda la matriz disponible para su rol.';
  });

  readonly detalleValor = this.detalle.valor;
  readonly detalleError = this.detalle.error;
  readonly detalleCargando = computed(() => {
    const estado = this.detalle.estado();
    return estado === 'cargando' || estado === 'inactivo';
  });

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizador));
  }

  // Envoltorios para el template: evitan el choque de nombres con las
  // funciones importadas y dejan una única firma visible.
  formatearFecha(valor: string | null | undefined): string {
    return formatearFechaDdMmAaaa(valor);
  }

  textoOSinDato(valor: string | null | undefined): string {
    return textoOSinDato(valor);
  }

  claseNivel(nivel: string | null | undefined): string {
    return claseNivel(nivel);
  }

  claseRiesgo(riesgo: string | null | undefined): string {
    return claseRiesgo(riesgo);
  }

  clasePrioridad(prioridad: string | null | undefined): string {
    return clasePrioridad(prioridad);
  }

  claseEstado(estado: string | null | undefined): string {
    return claseEstado(estado);
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    // Sin `trim`: el valor se refleja en el `<input>` y recortarlo aquí mueve
    // el cursor. El repositorio recorta `q`.
    this.temporizador = setTimeout(() => this.actualizarFiltros({ q: valor }), 300);
  }

  filtrarEstado(valor: string): void {
    this.actualizarFiltros({ estado: valor });
  }

  filtrarRegion(evento: Event): void {
    this.actualizarFiltros({ region: this.valorDe(evento) });
  }

  filtrarAlcance(evento: Event): void {
    this.actualizarFiltros({ alcance: this.valorDe(evento) });
  }

  filtrarSubsector(evento: Event): void {
    this.actualizarFiltros({ subsector: this.valorDe(evento) });
  }

  filtrarNivel(evento: Event): void {
    this.actualizarFiltros({ nivel: this.valorDe(evento) });
  }

  filtrarPrioridad(evento: Event): void {
    this.actualizarFiltros({ prioridad: this.valorDe(evento) });
  }

  cambiarDesde(evento: Event): void {
    this.actualizarFiltros({ desde: this.valorDe(evento) });
  }

  cambiarHasta(evento: Event): void {
    this.actualizarFiltros({ hasta: this.valorDe(evento) });
  }

  cambiarOrden(evento: Event): void {
    this.actualizarFiltros({ orden: this.valorDe(evento) });
  }

  limpiar(): void {
    this.filtros.set({ ...FILTROS_INICIALES });
    this.pagina.set(1);
  }

  cambiarPagina(pagina: number): void {
    this.pagina.set(pagina);
  }

  cambiarTamano(tamano: number): void {
    this.tamano.set(tamano);
    this.pagina.set(1);
  }

  alternarModo(): void {
    this.modo.update((actual) => (actual === 'lista' ? 'imprimible' : 'lista'));
    this.pagina.set(1);
    this.codigoDetalle.set(null);
  }

  abrirDetalle(codigo: string): void {
    this.codigoDetalle.set(codigo);
  }

  cerrarDetalle(): void {
    if (this.codigoDetalle()) this.codigoDetalle.set(null);
  }

  /** El clic fuera cierra; arrastrar dentro de la ficha no. */
  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarDetalle();
  }

  async descargarCsv(): Promise<void> {
    if (this.descargando()) return;
    this.descargando.set(true);
    this.errorDescarga.set(null);
    try {
      await this.servicio.descargarCsv({ ...this.filtros() });
    } catch (fallo) {
      this.errorDescarga.set(aErrorApi(fallo, 'No se pudo descargar la matriz.').message);
    } finally {
      this.descargando.set(false);
    }
  }

  imprimir(): void {
    if (!isPlatformBrowser(this.plataforma)) return;
    window.print();
  }

  recargar(): void {
    this.listado.recargar();
  }

  etiquetaNivel(valor: string): string {
    if (valor === 'manifiesto') return 'Manifiesto';
    if (valor === 'latente') return 'Latente';
    return valor;
  }

  private actualizarFiltros(cambios: Partial<FiltrosMatriz>): void {
    this.filtros.update((actuales) => ({ ...actuales, ...cambios }));
    this.pagina.set(1);
  }

  private valorDe(evento: Event): string {
    return (evento.target as HTMLSelectElement | HTMLInputElement).value;
  }
}
