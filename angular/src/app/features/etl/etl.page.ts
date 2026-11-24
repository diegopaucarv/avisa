import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { TAMANO_PAGINA, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  DESTINOS,
  DESTINOS_PRINCIPALES,
  ORIGENES_MATERIAL,
  aEjecucionColeccion,
  aResumen,
  conteosDeDestino,
  conteosPorClave,
  estadoDestino,
  etiquetaDestinoIngesta,
  etiquetaEstadoIntegracion,
  etiquetaProtocolo,
  etiquetaSentido,
  formatearFechaDdMmAaaa,
  formatearFechaHoraDdMmAaaa,
  formatearNumero,
  tonoEstadoIntegracion,
  type DestinoPrincipal,
  type Ejecucion,
  type EstadoDato,
  type FuenteIntegracion,
  type OrigenMaterial,
  type ResumenEtl,
  type TokenDestino,
} from './etl.mapeo';

export type PestanaEtl = 'extraccion' | 'fuentes' | 'historial';

const PESTANAS: readonly PestanaEtl[] = ['extraccion', 'fuentes', 'historial'];

/**
 * Consola ETL · Extracción, Fuentes e Historial.
 *
 * La pantalla es honesta sobre lo que existe: no hay motor de extracción, ni
 * cola de trabajos, ni programación, ni reintentos. Se muestran los datos
 * reales que la base sí tiene —conteos de `core`, `legacy` y `staging`,
 * migraciones aplicadas en `core.migracion_log`, enlaces declarados en
 * `core.integraciones` y los catálogos de formatos, tipos de documento y
 * puntos de ingesta— y lo que no existe se declara con su motivo.
 *
 * Los botones sin backend («Analizar», «Aplicar aceptadas», «Agregar fuente»,
 * «Reejecutar») quedan deshabilitados con un `title` que explica qué falta.
 * El textarea y el selector de origen/destino son estado local: no envían nada.
 */
@Component({
  selector: 'app-etl-page',
  imports: [IconoComponent, PaginacionComponent],
  templateUrl: './etl.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .view-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
      max-width: 1420px;
      margin: 0 auto;
      padding: 27px 34px 50px;
      box-sizing: border-box;
    }

    .view-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    /* ── pestañas ─────────────────────────────────────────────────────── */

    .etl-tabs {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 3px;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
      width: max-content;
      max-width: 100%;
    }

    .etl-tabs button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 13px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font: 600 12.5px var(--font-sans);
      cursor: pointer;
    }

    .etl-tabs button:hover {
      color: var(--ink-2);
      background: var(--paper);
    }

    .etl-tabs button[aria-selected='true'] {
      background: var(--paper);
      color: var(--ink);
      box-shadow: 0 1px 3px rgba(17, 32, 45, 0.12);
    }

    .etl-tab-num {
      padding: 1px 6px;
      border-radius: 10px;
      background: var(--blue-pale);
      color: var(--blue);
      font-size: 11px;
      font-weight: 700;
    }

    .etl-panel {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .etl-panel:focus-visible {
      outline: 3px solid var(--blue);
      outline-offset: 3px;
    }

    /* ── tarjetas ─────────────────────────────────────────────────────── */

    .etl-card {
      padding: 16px 18px 18px;
    }

    .etl-card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
    }

    .etl-card-title {
      margin: 0;
      color: var(--ink);
      font: 700 14.5px var(--font-display);
      letter-spacing: -0.15px;
    }

    .etl-card-sub {
      max-width: 720px;
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.55;
    }

    .etl-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .etl-tag {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border: 1px solid var(--line);
      border-radius: 11px;
      background: var(--canvas);
      color: var(--ink-2);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    .etl-tag.off {
      border-style: dashed;
      color: var(--muted);
      background: transparent;
    }

    /* ── avisos y notas ───────────────────────────────────────────────── */

    .etl-banner {
      display: flex;
      gap: 10px;
      padding: 11px 14px;
      border: 1px solid var(--amber);
      border-left-width: 4px;
      border-radius: 7px;
      background: var(--amber-pale);
      color: var(--ink-2);
      font-size: 12.5px;
      line-height: 1.55;
    }

    .etl-banner .mk {
      color: var(--amber);
      font-weight: 700;
    }

    .etl-banner b {
      color: var(--ink);
    }

    .etl-callout {
      margin: 10px 0 0;
      padding: 9px 12px;
      border-left: 3px solid var(--red);
      border-radius: 0 6px 6px 0;
      background: var(--red-pale);
      color: var(--ink-2);
      font-size: 12px;
      line-height: 1.55;
    }

    .etl-hint {
      display: block;
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.55;
    }

    .etl-empty {
      margin: 0;
      padding: 22px 14px;
      border: 1px dashed var(--line);
      border-radius: 7px;
      background: var(--canvas);
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.6;
      text-align: center;
    }

    .etl-notas {
      margin: 10px 0 0;
      padding-left: 18px;
      color: var(--ink-2);
      font-size: 12.5px;
      line-height: 1.6;
    }

    .etl-notas li + li {
      margin-top: 6px;
    }

    .etl-error {
      margin: 0;
      color: var(--red);
      font-size: 12.5px;
    }

    /* ── disposición ──────────────────────────────────────────────────── */

    .etl-split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr);
      gap: 14px;
      align-items: start;
    }

    .etl-fields {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .etl-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .etl-lab {
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 700;
    }

    .etl-field textarea {
      width: 100%;
      min-height: 128px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--paper);
      color: var(--ink);
      font: 400 12.5px/1.6 var(--font-sans);
      resize: vertical;
    }

    .etl-field textarea::placeholder {
      color: var(--muted);
    }

    .etl-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 9px;
      margin-top: 14px;
    }

    .etl-row .button-primary,
    .etl-row .button-secondary {
      padding: 7px 13px;
      border-radius: 6px;
      font: 600 12.5px var(--font-sans);
    }

    .etl-row .button-primary:disabled,
    .etl-row .button-secondary:disabled,
    .etl-mini:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .etl-mini {
      padding: 4px 9px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: var(--paper);
      color: var(--ink-2);
      font: 600 11.5px var(--font-sans);
    }

    .etl-mini:not(:disabled):hover {
      background: var(--canvas);
    }

    /* ── propuesta ────────────────────────────────────────────────────── */

    .etl-pairs {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 5px 12px;
      margin: 0;
    }

    .etl-pairs dt {
      color: var(--muted);
      font-size: 11.5px;
      font-weight: 700;
    }

    .etl-pairs dd {
      margin: 0;
      color: var(--ink-2);
      font-size: 12px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .etl-destino-bloque {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }

    .etl-subtitle {
      margin: 0 0 8px;
      color: var(--ink);
      font: 700 12.5px var(--font-sans);
    }

    /* ── tablas ───────────────────────────────────────────────────────── */

    .etl-tabla-destinos td {
      white-space: normal;
      vertical-align: top;
      line-height: 1.55;
    }

    .etl-tabla-destinos th:first-child {
      width: 26%;
    }

    .etl-tabla-destinos th:nth-child(2) {
      width: 20%;
    }

    .etl-destino-celda code,
    .etl-codigo {
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--canvas);
      color: var(--ink-2);
      font:
        500 11.5px ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
      overflow-wrap: anywhere;
    }

    .etl-num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .etl-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      white-space: nowrap;
    }

    .etl-nodato {
      color: var(--muted);
    }

    /* ── distintivos de estado ────────────────────────────────────────── */

    .etl-st {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }

    .etl-st.ok {
      background: var(--green-pale);
      color: var(--green);
    }

    .etl-st.warn {
      background: var(--amber-pale);
      color: var(--amber);
    }

    .etl-st.bad {
      background: var(--red-pale);
      color: var(--red);
    }

    .etl-st.nodata {
      border: 1px solid var(--line);
      background: var(--canvas);
      color: var(--muted);
    }

    /* ── chips y métricas ─────────────────────────────────────────────── */

    .etl-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .etl-chips li {
      padding: 3px 9px;
      border: 1px solid var(--line);
      border-radius: 11px;
      background: var(--canvas);
      color: var(--ink-2);
      font:
        500 11.5px ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
    }

    .etl-catalogo {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }

    .etl-metricas {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .etl-metrica {
      padding: 14px 16px;
    }

    .etl-metrica .k {
      display: block;
      color: var(--muted);
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }

    .etl-metrica .v {
      margin: 6px 0 0;
      color: var(--ink);
      font: 700 23px/1.1 var(--font-display);
      letter-spacing: -0.5px;
    }

    .etl-metrica .v.sin-dato {
      color: var(--muted);
      font-size: 16px;
    }

    .etl-metrica .s {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.5;
    }

    /* ── conteos por esquema ──────────────────────────────────────────── */

    .etl-esquemas {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
    }

    .etl-esquema {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--paper);
    }

    .etl-esquema summary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 12px;
      cursor: pointer;
      color: var(--ink-2);
      font-size: 12.5px;
      font-weight: 600;
      list-style: none;
    }

    .etl-esquema summary::-webkit-details-marker {
      display: none;
    }

    .etl-esquema summary:hover {
      background: var(--canvas);
    }

    .etl-esquema-listas {
      max-height: 320px;
      overflow: auto;
      border-top: 1px solid var(--line);
    }

    .etl-esquema-listas table {
      width: 100%;
      border-collapse: collapse;
    }

    .etl-esquema-listas td {
      padding: 5px 12px;
      border-bottom: 1px solid var(--line);
      color: var(--ink-2);
      font-size: 12px;
    }

    .etl-esquema-listas tr:last-child td {
      border-bottom: 0;
    }

    .etl-esquema-listas td:last-child {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .etl-esquema-listas tr.etl-vacia td {
      color: var(--muted);
    }

    /* ── pie ──────────────────────────────────────────────────────────── */

    .etl-pie {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 10px;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.5;
    }

    @media (max-width: 1180px) {
      .etl-split,
      .etl-catalogo {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    @media (max-width: 760px) {
      .view-body {
        padding: 18px 16px 40px;
      }

      .etl-metricas {
        grid-template-columns: minmax(0, 1fr);
      }

      .etl-pairs {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class EtlPage {
  readonly origenes = ORIGENES_MATERIAL;
  readonly destinosPrincipales = DESTINOS_PRINCIPALES;

  readonly pestana = signal<PestanaEtl>('extraccion');
  readonly origen = signal<OrigenMaterial>('texto');
  readonly destino = signal<DestinoPrincipal>('caso');
  readonly texto = signal('');
  readonly migracionSeleccionada = signal<string | null>(null);
  readonly pagina = signal(1);
  readonly tamano = signal(TAMANO_PAGINA);

  private readonly resumenConsulta = consulta({
    fuente: () => urlApi('/v1/etl/resumen'),
    esquema: (bruto) => aResumen(bruto),
  });

  private readonly ejecucionesConsulta = consulta({
    fuente: () =>
      urlConParametros(
        urlApi('/v1/etl/ejecuciones'),
        paramsDePagina({ pagina: this.pagina(), tamano: this.tamano() }),
      ),
    esquema: (bruto) => aEjecucionColeccion(bruto),
  });

  readonly resumen = this.resumenConsulta.valor;
  readonly estadoResumen = this.resumenConsulta.estado;
  readonly errorResumen = this.resumenConsulta.error;

  readonly ejecuciones = this.ejecucionesConsulta.valor;
  readonly estadoEjecuciones = this.ejecucionesConsulta.estado;
  readonly errorEjecuciones = this.ejecucionesConsulta.error;

  readonly conteos = computed(() => conteosPorClave(this.resumen()));

  readonly filasDestino = computed(() =>
    DESTINOS.map((fila) => ({ fila, estado: estadoDestino(fila, this.conteos()) })),
  );

  readonly tablasDestino = computed(() => conteosDeDestino(this.destino(), this.conteos()));

  readonly etiquetaDestinoActual = computed(() => {
    const opcion = DESTINOS_PRINCIPALES.find((item) => item.clave === this.destino());
    return opcion?.etiqueta ?? 'sin dato';
  });

  readonly core = computed(() => this.resumen()?.esquemas.find((e) => e.esquema === 'core'));

  readonly staging = computed(() => {
    const staging = this.resumen()?.esquemas.find((e) => e.esquema === 'staging');
    const filasDe = (tabla: string): number | null =>
      staging?.tablas.find((item) => item.tabla === tabla)?.filas ?? null;
    return { lotes: filasDe('lote'), registros: filasDe('registro') };
  });

  readonly tablasConDatos = computed(
    () => (this.core()?.tablas ?? []).filter((tabla) => tabla.filas > 0).length,
  );

  /** `core.documento_fragmento` sólo aparece si existe en la base. */
  readonly fragmentoCore = computed(() => this.conteos().get('core.documento_fragmento') ?? null);

  readonly fragmentoCoreExiste = computed(() => this.conteos().has('core.documento_fragmento'));

  readonly tablasOmitidas = computed(() => this.resumen()?.tablasOmitidas ?? 0);

  readonly fuentesTotal = computed(() => this.resumen()?.fuentesIntegracion.length ?? 0);

  readonly migracionesTotal = computed(
    () => this.ejecuciones()?.total ?? this.resumen()?.migraciones.aplicadas ?? 0,
  );

  readonly migracionDetalle = computed<Ejecucion | null>(() => {
    const lista = this.ejecuciones()?.elementos ?? [];
    const clave = this.migracionSeleccionada();
    if (clave) return lista.find((item) => item.clave === clave) ?? null;
    return lista[0] ?? null;
  });

  readonly generadoEn = computed(() => this.resumen()?.generadoEn ?? null);

  readonly formatearNumero = formatearNumero;
  readonly formatearFechaDdMmAaaa = formatearFechaDdMmAaaa;
  readonly formatearFechaHoraDdMmAaaa = formatearFechaHoraDdMmAaaa;
  readonly etiquetaEstadoIntegracion = etiquetaEstadoIntegracion;
  readonly tonoEstadoIntegracion = tonoEstadoIntegracion;
  readonly etiquetaDestinoIngesta = etiquetaDestinoIngesta;

  seleccionarPestana(pestana: PestanaEtl): void {
    this.pestana.set(pestana);
  }

  alTeclaPestana(evento: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) return;
    evento.preventDefault();

    const contenedor = (evento.currentTarget as HTMLElement | null)?.parentElement;
    if (!contenedor) return;

    const botones = Array.from(contenedor.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const actual = botones.indexOf(evento.currentTarget as HTMLButtonElement);
    if (actual < 0) return;

    let siguiente = actual;
    if (evento.key === 'ArrowLeft') siguiente = (actual - 1 + botones.length) % botones.length;
    else if (evento.key === 'ArrowRight') siguiente = (actual + 1) % botones.length;
    else if (evento.key === 'Home') siguiente = 0;
    else if (evento.key === 'End') siguiente = botones.length - 1;

    const boton = botones[siguiente];
    const valor = boton?.getAttribute('data-tab');
    if (!boton || !valor || !PESTANAS.includes(valor as PestanaEtl)) return;

    this.seleccionarPestana(valor as PestanaEtl);
    boton.focus();
  }

  cambiarOrigen(clave: OrigenMaterial): void {
    this.origen.set(clave);
  }

  cambiarDestino(clave: DestinoPrincipal): void {
    this.destino.set(clave);
  }

  alEscribir(evento: Event): void {
    this.texto.set((evento.target as HTMLTextAreaElement).value);
  }

  limpiar(): void {
    this.texto.set('');
  }

  verMigracion(clave: string): void {
    this.migracionSeleccionada.set(clave);
  }

  cambiarPagina(pagina: number): void {
    this.pagina.set(pagina);
  }

  cambiarTamano(tamano: number): void {
    this.tamano.set(tamano);
    this.pagina.set(1);
  }

  recargar(): void {
    this.resumenConsulta.recargar();
    this.ejecucionesConsulta.recargar();
  }

  tonoDe(estado: EstadoDato): string {
    return `etl-st ${estado.tono}`;
  }

  esCodigo(token: TokenDestino): boolean {
    return token.tipo === 'codigo';
  }

  /** Sentidos de un enlace, ya traducidos y unidos por coma. */
  unirSentidos(fuente: FuenteIntegracion): string {
    return fuente.tipos.map(etiquetaSentido).join(', ');
  }

  /** Protocolos de un enlace, ya traducidos y unidos por coma. */
  unirProtocolos(fuente: FuenteIntegracion): string {
    return fuente.protocolos.map(etiquetaProtocolo).join(', ');
  }

  /** Clave a mostrar en el título del detalle; `—` si no hay selección. */
  claveDetalle(componente: Ejecucion | null): string {
    return componente?.clave ?? '—';
  }

  resumenEsquema(esquema: ResumenEtl['esquemas'][number]): string {
    return `${formatearNumero(esquema.totalTablas)} tablas · ${formatearNumero(
      esquema.totalFilas,
    )} filas`;
  }
}
