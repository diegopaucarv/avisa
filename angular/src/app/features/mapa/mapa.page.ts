import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { map } from 'rxjs';

import { AlcanceService, esAlcance } from '../../core/alcance/alcance.service';
import { SesionStore } from '../../core/auth/sesion.store';
import { codigoRegion } from '../../core/territorio/ubigeo';
import { TerritorioService } from '../../core/territorio/territorio.service';
import type { AnpGeo, DistritoGeo, RegionGeo } from '../../core/territorio/territorio.tipos';
import { formatearFechaHora } from '../../shared/formato-fecha';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import { formatearFechaCorta } from '../../dominio/mapeo';
import type { Alcance, Caso, PrioridadAtencion, Riesgo } from '../../dominio/modelos';
import { CapasMapaService, type AuditorioMapa, type PuntoInfraestructura } from './capas.service';
import {
  casosPorDistritoUbigeo,
  claseCoropleta,
  colorChoropleta,
  conteosPorSituacion,
  contarRegiones,
  contarRiesgoAlto,
  distribuirPorRegion,
  distribuirPorSectorista,
  ESCALA_COROPLETA_ALERTAS,
  ESCALA_COROPLETA_MANIFIESTOS,
  filasPorRegion,
  intensidadMedida,
  medidasDeCasos,
  normalizarRegion,
  regionDe,
  tasaPor100k,
  valorMedida,
  type ConteoDistrito,
  type FilaDistribucion,
  type FilaRegion,
  type MedidaRegion,
  type MetricaDistribucion,
  type VariableDistribucion,
} from './panorama.agregados';
import { PanoramaDistribucionComponent } from './panorama-distribucion.component';
import { PanoramaIndicadoresService } from './panorama.indicadores.service';
import { PanoramaService } from './panorama.service';

/** Teselas públicas de OpenStreetMap: el mapa es referencial, no oficial. */
const TESELAS_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Encuadre inicial: extensión continental del Perú. */
const LIMITES_PERU: [number, number][] = [
  [-18.4, -81.4],
  [-0.05, -68.6],
];

/** Relleno de la coropleta distrital: un tono por tramo de `ESCALA_COROPLETA`. */
const COLORES_COROPLETA = ['#e3e9f0', '#cfe0f5', '#9dc0e8', '#5f92cd', '#2455a2'];

/** Borde fino para el distrito con casos; «Sin casos» queda transparente. */
const ESTILO_DISTRITO: L.PathOptions = { color: '#22456f', weight: 0.8, fillOpacity: 0.55 };
const ESTILO_DISTRITO_SIN_CASOS: L.PathOptions = {
  color: '#8b97a1',
  weight: 0.7,
  fillOpacity: 0,
};

function estiloDistrito(clase: number, seleccionado: boolean): L.PathOptions {
  const relleno = COLORES_COROPLETA[clase] ?? COLORES_COROPLETA[0];
  if (seleccionado) {
    return {
      color: '#173f73',
      weight: 2.2,
      fillColor: relleno,
      fillOpacity: clase > 0 ? 0.75 : 0.2,
    };
  }
  if (clase <= 0) return ESTILO_DISTRITO_SIN_CASOS;
  return { ...ESTILO_DISTRITO, fillColor: relleno };
}

const FORMATO_ENTERO = new Intl.NumberFormat('es-PE');
const FORMATO_TASA = new Intl.NumberFormat('es-PE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

type PropiedadesDistrito = { ubigeo: string; nombre: string };

/** Propiedades de la capa de regiones: ubigeo, nombre, región y ámbito. */
type PropsRegion = {
  ubigeo: string;
  nombre: string;
  region: string;
  alcance: string | null;
};

type RasgoDistrital = L.Path & { feature?: { properties?: unknown } };

/** Lee una propiedad de texto de un rasgo GeoJSON sin confiar en su tipo. */
function propiedadDelRasgo(
  rasgo: { properties?: unknown } | null | undefined,
  clave: string,
): string | null {
  const propiedades = rasgo?.properties;
  if (typeof propiedades !== 'object' || propiedades === null) return null;
  const valor = (propiedades as Record<string, unknown>)[clave];
  return typeof valor === 'string' ? valor : null;
}

/** Ubigeo del rasgo GeoJSON. */
function ubigeoDelRasgo(rasgo: { properties?: unknown } | null | undefined): string | null {
  return propiedadDelRasgo(rasgo, 'ubigeo');
}

/** Nombre de región del rasgo: `region` si viene, si no `nombre`. */
function regionDelRasgo(rasgo: { properties?: unknown } | null | undefined): string | null {
  return propiedadDelRasgo(rasgo, 'region') ?? propiedadDelRasgo(rasgo, 'nombre');
}

/** Los siete conmutadores del panel de capas opcionales. */
type ClaveCapa =
  | 'auditorios'
  | 'fondepes'
  | 'dpa'
  | 'provincias'
  | 'distritos'
  | 'derechos'
  | 'anp';

type CapasOpcionales = Record<ClaveCapa, boolean>;

/** Gravedad declarada del caso: ordena de más a menos grave. */
const ORDEN_RIESGO: Record<Riesgo, number> = { Alto: 0, Medio: 1, Bajo: 2 };

/** Prioridad de atención: ordena de más a menos urgente (eje distinto del riesgo). */
const ORDEN_PRIORIDAD: Record<PrioridadAtencion, number> = { Urgente: 0, Medio: 1, Bajo: 2 };

/** Antigüedad: el inicio más antiguo primero; sin fecha declarada, al final. */
function compararInicio(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Panorama territorial (ventana principal de la aplicación).
 *
 * Distribuye los casos reales por ámbito y región y agrupa su conflictividad en
 * situación latente (Diferencia + Controversia) y manifiesta (Conflicto social +
 * Crisis social), según la Guía §7.5.1. OVERRIDE (decisión expresa del usuario,
 * 2026-11-24): los casos sin nivel declarado cuentan como latentes, de modo que
 * latente + manifiesto siempre suma el total. La cabecera resume la situación con
 * cuatro tarjetas —manifiestos, latentes, regiones afectadas y riesgo alto— y el
 * ámbito sólo se cambia desde la cabecera del shell (`?alcance=`).
 *
 * El mapa es referencial de OpenStreetMap y mantiene siempre la capa de
 * departamentos; encima se encienden dos coropléticos mutuamente excluyentes
 * (riesgo en alertas del último trimestre, en rojo, y % de casos manifiestos, en
 * azul) y siete capas opcionales que se piden al encenderse. Al cambiar el ámbito
 * el mapa encuadra las regiones de ese alcance y destaca sus bordes, salvo que
 * haya una región seleccionada. Un clic en un polígono de distrito abre su ficha
 * territorial; el cajón se cierra con Escape o con un clic fuera.
 *
 * El panel derecho distribuye la misma medida que el coroplético: una barra por
 * sectorista con los chips de sus regiones, o por región cuando el endpoint de
 * indicadores no está disponible. Las cifras que faltan se declaran; nunca se
 * inventan.
 *
 * El recorte por `usuario().regiones` es de presentación: hoy la RLS entrega el
 * conjunto completo y `lib/db/scope.ts` documenta que el bloqueo por territorio
 * aún no existe. Si la sesión trae regiones, la vista se acota a ellas y no cae
 * al conjunto nacional cuando no hay coincidencias.
 */
@Component({
  selector: 'app-mapa',
  imports: [
    RouterLink,
    IconoComponent,
    ThOrdenDirective,
    GlosarioComponent,
    PanoramaDistribucionComponent,
  ],
  templateUrl: './mapa.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PanoramaService, CapasMapaService, PanoramaIndicadoresService],
  styles: `
    :host {
      display: block;
    }

    /* Cuatro tarjetas fijas (manifiestos, latentes, regiones afectadas y riesgo
       alto); la rejilla global es de cuatro y aquí se fija para repartir el ancho
       sin dejar hueco. */
    .executive-kpis {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      margin-bottom: 8px;
    }

    @media (max-width: 980px) {
      .executive-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .view-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .meta-separador {
      color: inherit;
      opacity: 0.55;
    }

    .sesion-chip {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--blue-pale);
      color: var(--blue-dark);
      font-size: 12px;
      font-weight: 700;
    }

    .panel {
      padding: 17px;
    }

    /* Mapa y distribución comparten una altura fija para que el coroplético y
       las barras se lean en paralelo. Ninguna de las dos depende del contenido:
       es la misma regla, en porcentaje del contenedor. */
    .panel-doble {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      height: min(62vh, 520px);
      align-items: stretch;
    }

    .panel-mapa {
      display: flex;
      flex-direction: column;
      min-height: 0;
      /* Contexto de apilamiento propio: los z-index internos de Leaflet (panes
         y controles, 200–1000) y los flotantes (960) quedan contenidos aquí, de
         modo que el shell (29/41) se pinta por encima sin tocar Leaflet. */
      isolation: isolate;
    }

    .panel-nota {
      margin: 10px 0 0;
      color: var(--amber);
      font-size: 12.5px;
      line-height: 1.5;
    }

    .panel-vacio {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .estado-carga {
      margin: 0;
      padding: 22px 2px;
      color: var(--muted);
      font-size: 13px;
    }

    .estado-error {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }

    .estado-error p {
      flex: 1 1 240px;
      margin: 0;
      color: var(--red);
      font-size: 13px;
      line-height: 1.5;
    }

    .vacio {
      padding: 22px;
    }

    .vacio h3 {
      margin: 0 0 6px;
      color: var(--ink);
      font: 700 14.5px/1.35 var(--font-display);
    }

    .vacio p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
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

    .region-chip-activa {
      border-color: var(--blue);
      background: var(--blue-pale);
      color: var(--blue-dark);
    }

    .mapa-cabeza {
      flex-wrap: wrap;
    }

    .celda-caso small {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }

    /* La columna Caso de «Casos priorizados» va más estrecha que la regla global
       de la primera celda. */
    .data-table td:first-child.celda-caso {
      width: 28%;
      min-width: 0;
    }

    .mapa-marco {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      margin-top: 10px;
    }

    .mapa-lienzo {
      height: 100%;
      min-height: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
      overflow: hidden;
    }

    .mapa-lienzo:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }

    /* Botones flotantes dentro del mapa: arrancan debajo de los controles de
       zoom (que quedan arriba a la izquierda) para no taparlos. */
    .mapa-flotantes {
      position: absolute;
      top: 96px;
      left: 10px;
      z-index: 960;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .mapa-flotante {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 1px solid #cfd8e3;
      border-radius: 7px;
      background: #fff;
      color: #33475b;
      box-shadow: 0 1px 4px rgba(17, 32, 45, 0.18);
      cursor: pointer;
    }

    .mapa-flotante:hover {
      background: #f1f5f9;
      color: #1d427f;
    }

    .mapa-flotante[aria-pressed='true'] {
      border-color: #1d427f;
      background: #1d427f;
      color: #fff;
    }

    .mapa-flotante-alerta[aria-pressed='true'] {
      border-color: #ad4d46;
      background: #ad4d46;
    }

    .mapa-flotante-manifiesto[aria-pressed='true'] {
      border-color: #2455a2;
      background: #2455a2;
    }

    /* Velo tenue bajo el panel de capas: un clic fuera cierra, como el resto de
       paneles de la casa. Los botones flotantes quedan por encima para poder
       cerrar también desde el disparador. */
    .mapa-panel-scrim {
      position: absolute;
      inset: 0;
      z-index: 920;
      background: rgba(17, 32, 45, 0.08);
    }

    .mapa-panel-capas {
      position: absolute;
      top: 96px;
      bottom: 10px;
      left: 54px;
      z-index: 950;
      display: flex;
      flex-direction: column;
      width: min(330px, calc(100% - 66px));
      border: 1px solid #dbe3ea;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 12px 32px rgba(17, 32, 45, 0.24);
      outline: none;
      animation: panel-capas-entra 160ms ease-out;
    }

    @keyframes panel-capas-entra {
      from {
        opacity: 0;
        transform: translateX(-12px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .mapa-panel-cabeza {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px 10px;
      border-bottom: 1px solid #eef2f6;
    }

    .mapa-panel-cabeza h4 {
      margin: 0;
      color: #17283a;
      font: 700 13.5px/1.3 var(--font-display);
    }

    .mapa-panel-lista {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      padding: 4px 14px 14px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .mapa-aviso {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 8px 0 0;
      padding: 6px 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--canvas);
      color: var(--red);
      font-size: 12px;
      line-height: 1.5;
    }

    .mapa-aviso p {
      flex: 1 1 220px;
      margin: 0;
    }

    .ficha-tabla th {
      width: 42%;
      text-align: left;
      vertical-align: top;
    }

    .ficha-tabla td {
      font-variant-numeric: tabular-nums;
    }

    .ficha-motivo {
      color: var(--muted);
      font-size: 12px;
    }

    .quitar-seleccion {
      margin-left: 2px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--blue-dark);
      font: inherit;
      font-weight: 700;
      text-decoration: underline;
      cursor: pointer;
    }

    .quitar-seleccion:hover {
      color: var(--red);
    }

    /* Cajón de la ficha distrital: entra desde el borde derecho, como el resto
       de modales de la aplicación. */
    .casos-drawer-scrim {
      position: fixed;
      inset: 0;
      display: flex;
      justify-content: flex-end;
      overflow: clip;
    }

    .casos-drawer {
      display: flex;
      flex-direction: column;
      width: min(52%, 620px);
      height: 100%;
      border-left: 1px solid #dbe3ea;
      background: #fff;
      box-shadow: -18px 0 44px rgba(17, 32, 45, 0.2);
      outline: none;
    }

    .casos-drawer-cabeza {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      padding: 18px 20px 13px;
      border-bottom: 1px solid #eef2f6;
    }

    .casos-drawer-cabeza h3 {
      margin: 0;
      color: #1c2a38;
      font: 700 16px/1.3 var(--font-display);
    }

    .casos-drawer-sub {
      margin: 4px 0 0;
      color: #59697a;
      font-size: 13px;
      line-height: 1.5;
    }

    .casos-drawer-cuerpo {
      flex: 1;
      min-height: 0;
      padding: 12px 20px 16px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .punto-situacion {
      display: inline-block;
      width: 9px;
      height: 9px;
      margin-right: 6px;
      border-radius: 50%;
      vertical-align: baseline;
    }

    /* Filas del panel de capas: reutiliza el lenguaje de las antiguas capas. */
    .capa-fila {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 9px 0;
      border-top: 1px solid #eef2f6;
      cursor: pointer;
    }

    .capa-fila:first-child {
      border-top: 0;
    }

    .capa-fila input {
      margin-top: 2px;
    }

    .capa-texto {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .capa-nombre {
      font-size: 13px;
      font-weight: 600;
      color: #17283a;
    }

    .capa-sub {
      font-size: 12px;
      color: #778797;
    }

    .capa-conteo {
      margin-left: auto;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: #33475b;
    }

    .mapa-estado-capas {
      margin: 0;
      padding: 4px 0 8px;
      font-size: 12px;
      color: #778797;
    }

    .mapa-estado-capas[role='alert'] {
      color: #ad4d46;
    }

    /* Responsive: un panel debajo del otro, cada uno con la misma altura fija. */
    @media (max-width: 980px) {
      .panel-doble {
        grid-template-columns: 1fr;
        height: auto;
      }

      .panel-doble > .panel-mapa {
        height: min(62vh, 520px);
      }

      .mapa-panel-capas {
        top: auto;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        max-height: 72%;
        border-radius: 12px 12px 0 0;
        animation-name: panel-capas-sube;
      }
    }

    @keyframes panel-capas-sube {
      from {
        opacity: 0;
        transform: translateY(16px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (max-width: 760px) {
      .executive-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .casos-drawer {
        width: 100%;
      }
    }

    @media (max-width: 480px) {
      .executive-kpis {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class MapaPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly sesion = inject(SesionStore);
  private readonly alcanceService = inject(AlcanceService);
  private readonly panorama = inject(PanoramaService);
  private readonly territorio = inject(TerritorioService);
  private readonly capas = inject(CapasMapaService);
  private readonly indicadores = inject(PanoramaIndicadoresService);
  private readonly destruccion = inject(DestroyRef);

  private readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');
  private readonly panelCapas = viewChild<ElementRef<HTMLElement>>('panelCapas');
  private readonly ficha = viewChild<ElementRef<HTMLElement>>('ficha');

  /** Clave normalizada de la región seleccionada en el mapa. */
  private readonly claveSeleccionada = signal<string | null>(null);
  /** Cambia en cada montaje para redibujar las capas sobre el mapa nuevo. */
  private readonly versionMapa = signal(0);

  /** Panel deslizante de capas opcionales. */
  readonly panelCapasAbierto = signal(false);
  private focoPanelPrevio: HTMLElement | null = null;
  private cerrandoFicha = false;
  private focoFichaPrevio: HTMLElement | null = null;

  /** Conmutadores del panel de capas; todo apagado por omisión. */
  readonly capasOpcionales = signal<CapasOpcionales>({
    derechos: false,
    fondepes: false,
    dpa: false,
    auditorios: false,
    provincias: false,
    distritos: false,
    anp: false,
  });

  /** Eje y medida compartidos por el gráfico de distribución y el coroplético. */
  readonly variableDistribucion = signal<VariableDistribucion>('casos');
  readonly metricaDistribucion = signal<MetricaDistribucion>('manifiestos');
  readonly coropletaVisible = signal(false);

  private mapa: L.Map | null = null;

  readonly estadoDistritos = this.territorio.estadoDistritos;
  readonly errorDistritos = this.territorio.errorDistritos;
  readonly casosPorUbigeo = computed(() => casosPorDistritoUbigeo(this.visibles()));

  // Capas opcionales: estado publicado por sus servicios.
  readonly estadoInfra = this.capas.estadoInfra;
  readonly errorInfra = this.capas.errorInfra;
  readonly resumenInfra = this.capas.resumenInfra;
  readonly estadoFondepes = this.capas.estadoFondepes;
  readonly errorFondepes = this.capas.errorFondepes;
  readonly resumenFondepes = this.capas.resumenFondepes;
  readonly estadoDpa = this.capas.estadoDpa;
  readonly errorDpa = this.capas.errorDpa;
  readonly resumenDpa = this.capas.resumenDpa;
  readonly estadoAuditorios = this.capas.estadoAuditorios;
  readonly errorAuditorios = this.capas.errorAuditorios;
  readonly resumenAuditorios = this.capas.resumenAuditorios;

  readonly estadoRegiones = this.territorio.estadoRegiones;
  readonly errorRegiones = this.territorio.errorRegiones;
  readonly estadoProvincias = this.territorio.estadoProvincias;
  readonly errorProvincias = this.territorio.errorProvincias;
  readonly estadoAnp = this.territorio.estadoAnp;
  readonly errorAnp = this.territorio.errorAnp;

  readonly provinciasTotal = computed(() => this.territorio.provincias().length);
  readonly anpTotal = computed(() => this.territorio.anp().length);
  /** Distritos dibujados; `null` mientras la capa no se pidió o falló. */
  readonly distritosCargados = signal<number | null>(null);

  private capaRegiones: L.GeoJSON | null = null;
  private regionesFuente: readonly RegionGeo[] | null = null;
  private capaProvincias: L.GeoJSON | null = null;
  private capaAnp: L.GeoJSON | null = null;
  private capaDerechos: L.LayerGroup | null = null;
  private capaFondepes: L.LayerGroup | null = null;
  private capaDpa: L.LayerGroup | null = null;
  private capaAuditorios: L.LayerGroup | null = null;

  private capaDistritos: L.GeoJSON | null = null;
  private claveDistritos = '';
  private distritosEnCurso: string | null = null;
  private distritoSeleccionadoUbigeo: string | null = null;
  /** Último encuadre aplicado; evita repetir `fitBounds` en cada repintado. */
  private ultimoEncuadre: string | null = null;
  /** Fuerza un nuevo intento de la capa tras un 503 o un fallo de red. */
  private readonly reintentoDistritos = signal(0);

  /** Ficha territorial del distrito pulsado. */
  private readonly distritoActivo = signal<DistritoGeo | null>(null);
  readonly fichaDistrito = this.distritoActivo.asReadonly();
  readonly fichaConteo = computed<ConteoDistrito | null>(() => {
    const distrito = this.distritoActivo();
    if (!distrito) return null;
    return this.casosPorUbigeo().get(distrito.ubigeo) ?? null;
  });
  readonly fichaCasos = computed(() => this.fichaConteo()?.total ?? 0);
  readonly fichaTasa = computed(() =>
    tasaPor100k(this.fichaCasos(), this.distritoActivo()?.poblacion ?? null),
  );

  constructor() {
    // Leaflet necesita el contenedor ya en el DOM. El `@if` de la plantilla lo
    // crea al haber datos; si la sección desaparece (recarga), este mismo efecto
    // desmonta el mapa.
    effect((onCleanup) => {
      const contenedor = this.lienzo()?.nativeElement;
      if (!contenedor) return;

      this.montarMapa(contenedor);
      onCleanup(() => this.desmontarMapa());
    });

    // Capa de departamentos permanente y coroplético. El estilo lee las señales
    // del eje, la medida y el ámbito, así que este efecto basta para repintar
    // los 26 polígonos cuando cambia cualquiera de ellas.
    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      const regiones = this.territorio.regiones();
      // La selección cambia el borde resaltado: hay que repintar sin reconstruir.
      this.claveSeleccionada();
      if (!mapa) return;

      this.sincronizarRegiones(mapa, regiones);
      this.aplicarEstiloRegiones();
    });

    // Encuadre por ámbito: `fitBounds` a las regiones del alcance vigente. Se
    // respeta la selección de una región (no se mueve el mapa bajo los pies) y
    // «todos» vuelve al encuadre nacional.
    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      const regiones = this.territorio.regiones();
      const alcance = this.alcanceActivo();
      const seleccion = this.claveSeleccionada();
      if (!mapa) return;

      if (seleccion !== null) {
        // Al limpiar la selección, el encuadre vuelve a aplicarse.
        this.ultimoEncuadre = null;
        return;
      }

      const clave = `${alcance ?? 'todos'}|${regiones.length}`;
      if (this.ultimoEncuadre === clave) return;
      this.ultimoEncuadre = clave;

      if (alcance === null) {
        mapa.fitBounds(LIMITES_PERU, { padding: [12, 12] });
        return;
      }

      const claveAlcance = normalizarRegion(alcance);
      const delAlcance = regiones.filter(
        (region) => normalizarRegion(region.alcance ?? '') === claveAlcance,
      );
      const limites = this.limitesDe(delAlcance);
      mapa.fitBounds(limites ?? L.latLngBounds(LIMITES_PERU), { padding: [16, 16] });
    });

    // Capa distrital: opcional y apagada por omisión. Al encenderse se pide una
    // vez —acotada a la región seleccionada— y su relleno se recalcula con los
    // casos visibles.
    effect(() => {
      this.versionMapa();
      this.reintentoDistritos();
      const mapa = this.mapa;
      if (!mapa) return;

      if (!this.capasOpcionales()['distritos']) {
        this.quitarCapaDistritos();
        this.claveDistritos = '';
        this.distritosEnCurso = null;
        this.distritosCargados.set(null);
        return;
      }

      const region = this.filaSeleccionada()?.region ?? null;
      this.refrescarDistritos(this.casosPorUbigeo());
      void this.asegurarDistritos(mapa, region);
    });

    // Capas de puntos: se dibujan sólo cuando están encendidas. Los derechos
    // acuícolas son miles de puntos y van sobre canvas; las sedes y auditorios,
    // con tooltip.
    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      if (!mapa) return;
      this.capaDerechos = this.sincronizarGrupo(
        mapa,
        this.capasOpcionales()['derechos'],
        this.capas.puntosInfra(),
        this.capaDerechos,
        (puntos) => this.construirDerechos(puntos),
      );
    });

    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      if (!mapa) return;
      this.capaFondepes = this.sincronizarGrupo(
        mapa,
        this.capasOpcionales()['fondepes'],
        this.capas.puntosFondepes(),
        this.capaFondepes,
        (puntos) => this.construirAnillos(puntos, '#1d427f', (punto) => this.etiquetaSede(punto)),
      );
    });

    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      if (!mapa) return;
      this.capaDpa = this.sincronizarGrupo(
        mapa,
        this.capasOpcionales()['dpa'],
        this.capas.puntosDpa(),
        this.capaDpa,
        (puntos) => this.construirAnillos(puntos, '#b5651d', (punto) => this.etiquetaDpa(punto)),
      );
    });

    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      const auditorios = this.capas.auditorios();
      if (!mapa) return;

      if (!this.capasOpcionales()['auditorios'] || auditorios.length === 0) {
        this.capaAuditorios?.remove();
        this.capaAuditorios = null;
        return;
      }
      if (!this.capaAuditorios) this.capaAuditorios = this.construirAuditorios(auditorios);
      if (!mapa.hasLayer(this.capaAuditorios)) this.capaAuditorios.addTo(mapa);
    });

    // Provincias y ANP: contornos que no capturan clics para no robarle el clic
    // a los polígonos de distrito.
    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      const provincias = this.territorio.provincias();
      if (!mapa) return;

      if (!this.capasOpcionales()['provincias'] || provincias.length === 0) {
        this.capaProvincias?.remove();
        this.capaProvincias = null;
        return;
      }
      if (!this.capaProvincias) this.capaProvincias = this.construirProvincias(provincias);
      if (!mapa.hasLayer(this.capaProvincias)) this.capaProvincias.addTo(mapa);
    });

    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      const anp = this.territorio.anp();
      if (!mapa) return;

      if (!this.capasOpcionales()['anp'] || anp.length === 0) {
        this.capaAnp?.remove();
        this.capaAnp = null;
        return;
      }
      if (!this.capaAnp) this.capaAnp = this.construirAnp(anp);
      if (!mapa.hasLayer(this.capaAnp)) this.capaAnp.addTo(mapa);
    });

    // El panel de capas se enfoca al abrirse; el foco vuelve al disparador al
    // cerrar. La ficha distrital sigue la misma pauta.
    effect(() => {
      const panel = this.panelCapas()?.nativeElement;
      if (panel && this.panelCapasAbierto()) panel.focus();
    });

    effect(() => {
      const panel = this.ficha()?.nativeElement;
      if (panel && this.distritoActivo()) panel.focus();
    });

    if (typeof document !== 'undefined') {
      const alEscape = (evento: KeyboardEvent): void => {
        if (evento.key !== 'Escape') return;
        if (this.panelCapasAbierto()) {
          evento.preventDefault();
          this.cerrarPanelCapas();
          return;
        }
        if (this.distritoActivo()) {
          evento.preventDefault();
          this.cerrarFichaDistrito();
        }
      };
      document.addEventListener('keydown', alEscape);
      this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
    }

    void this.territorio.cargarRegiones();

    this.destruccion.onDestroy(() => this.desmontarMapa());
  }

  readonly estado = this.panorama.estado;
  readonly error = this.panorama.error;
  readonly cargando = computed(() => this.estado() === 'cargando');

  /** `alcance` tal como llega en la URL; `null` = sin parámetro. */
  private readonly alcanceUrl = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('alcance'))),
    { initialValue: null },
  );

  readonly regionesSesion = computed(() => this.sesion.usuario()?.regiones ?? []);
  readonly conRecorte = computed(() => this.regionesSesion().length > 0);

  /** Casos ya acotados a las regiones de la sesión, sin filtro de ámbito. */
  readonly base = computed<Caso[]>(() => {
    const casos = this.panorama.casos();
    const regiones = this.regionesSesion();
    if (regiones.length === 0) return casos;

    const permitidas = new Set(regiones.map(normalizarRegion));
    return casos.filter((caso) => {
      const region = regionDe(caso);
      return region !== null && permitidas.has(normalizarRegion(region));
    });
  });

  /**
   * Ámbito vigente: la URL manda; si no hay parámetro rige la preferencia
   * (`avisa-alcance`), salvo `auto`, que no impone ámbito. Una preferencia sin
   * casos visibles no se aplica para no dejar la pantalla vacía sin chip activo.
   */
  readonly alcanceActivo = computed<Alcance | null>(() => {
    const crudo = this.alcanceUrl();
    if (crudo === 'todos') return null;
    if (esAlcance(crudo)) return crudo;

    const preferido = this.alcanceService.preferido();
    if (preferido === 'auto') return null;

    return this.base().some((caso) => caso.alcance === preferido) ? preferido : null;
  });

  readonly visibles = computed<Caso[]>(() => {
    const alcance = this.alcanceActivo();
    if (alcance === null) return this.base();
    return this.base().filter((caso) => caso.alcance === alcance);
  });

  readonly sinCoincidenciasRol = computed(() => this.conRecorte() && this.base().length === 0);
  readonly sinCasos = computed(() => !this.conRecorte() && this.base().length === 0);
  readonly sinCoincidenciasAlcance = computed(
    () => this.base().length > 0 && this.visibles().length === 0,
  );

  /** Filas por región de los casos visibles, sin tabla: alimenta el mapa. */
  readonly filasRegion = computed(() => filasPorRegion(this.visibles()));

  /**
   * Entrada de conflictividad: los casos visibles ordenados por gravedad del
   * riesgo propio y, dentro de cada nivel, por la prioridad de atención
   * (Urgente → Bajo); a igualdad de ambas, por el inicio más antiguo. Los casos
   * sin `fecha_inicio` se ordenan al final; no se inventa una fecha.
   */
  private readonly casosOrdenados = computed<Caso[]>(() =>
    [...this.visibles()].sort(
      (a, b) =>
        (ORDEN_RIESGO[a.riesgo] ?? 3) - (ORDEN_RIESGO[b.riesgo] ?? 3) ||
        (ORDEN_PRIORIDAD[a.prioridad] ?? 3) - (ORDEN_PRIORIDAD[b.prioridad] ?? 3) ||
        compararInicio(a.inicio, b.inicio) ||
        a.codigo.localeCompare(b.codigo, 'es'),
    ),
  );

  /**
   * «Casos priorizados» son los que la Dirección OAIPCS marcó a mano
   * (`core.casos.priorizado`, migración 76), no los primeros por riesgo. Se
   * conserva el orden por gravedad dentro de la selección.
   */
  readonly casosPrioritarios = computed(() =>
    this.casosOrdenados().filter((caso) => caso.priorizado),
  );

  /** Orden local de la tabla «Casos priorizados». */
  readonly ordenPrioritarios = new OrdenTabla<Caso>();

  private readonly accesoresPrioritarios: Record<string, (caso: Caso) => unknown> = {
    codigo: (caso) => caso.codigo,
    region: (caso) => caso.region,
    distrito: (caso) => caso.distrito,
    conflictividad: (caso) => caso.nivelConflicto,
    riesgo: (caso) => ORDEN_RIESGO[caso.riesgo] ?? 3,
    inicio: (caso) => caso.inicio,
  };

  readonly casosPrioritariosVisibles = computed(() =>
    this.ordenPrioritarios.ordenar(this.casosPrioritarios(), this.accesoresPrioritarios),
  );

  /** Región resaltada por el mapa, sólo si sigue teniendo casos visibles. */
  readonly filaSeleccionada = computed<FilaRegion | null>(() => {
    const clave = this.claveSeleccionada();
    if (clave === null) return null;
    return this.filasRegion().find((fila) => normalizarRegion(fila.region) === clave) ?? null;
  });

  readonly regionesConCasos = computed(() => contarRegiones(this.visibles()));
  readonly riesgoAlto = computed(() => contarRiesgoAlto(this.visibles()));

  /** Conteo latente/manifiesto de los casos visibles; los sin nivel se suman a latentes. */
  readonly conteoSituacion = computed(() => conteosPorSituacion(this.visibles()));

  readonly alcanceTexto = computed(() => this.alcanceActivo() ?? 'Todos los ámbitos');

  /** `generatedAt` de la API, sin segundos. */
  readonly corte = computed(() => {
    const valor = this.panorama.corte();
    return valor ? formatearFechaHora(valor) : null;
  });

  // ── Distribución por sectorista (panel derecho) ───────────────────────────

  /** El eje de alertas sólo existe si el endpoint de indicadores respondió. */
  readonly alertasDisponibles = computed(() => this.indicadores.disponible());
  readonly ventanaDias = computed(() => this.indicadores.ventana().dias);
  readonly cargandoDistribucion = computed(() => this.indicadores.estado() === 'cargando');

  /**
   * Aviso discreto cuando el endpoint opcional no está: la vista sigue midiendo
   * con los casos que ya cargó y nunca rellena las alertas que faltan.
   */
  readonly avisoIndicadores = computed<string | null>(() => {
    if (this.indicadores.estado() !== 'error') return null;
    return this.variableDistribucion() === 'alertas'
      ? 'Las alertas del último trimestre requieren los indicadores por sectorista, que no están disponibles.'
      : 'Los indicadores por sectorista no están disponibles; se muestra la distribución por región con los casos cargados.';
  });

  readonly tituloDistribucion = computed(() =>
    this.indicadores.disponible() ? 'Distribución por sectorista' : 'Distribución por región',
  );

  readonly subtituloDistribucion = computed(() => {
    if (this.variableDistribucion() === 'alertas') {
      return `Alertas de los últimos ${this.indicadores.ventana().dias} días.`;
    }
    return this.indicadores.disponible()
      ? 'Participación de cada responsable en la medida elegida.'
      : 'Medido sobre los casos cargados en el panorama.';
  });

  readonly filasDistribucion = computed<FilaDistribucion[]>(() => {
    if (this.indicadores.disponible()) {
      // Se descartan los sectoristas sin ninguna actividad: aparecen en el
      // contrato con ceros por tener el rol vigente, pero una barra a 0 % en la
      // distribución sólo es ruido. Se conserva quien tenga regiones con dato o
      // algún valor en la medida elegida.
      return distribuirPorSectorista(
        this.indicadores.sectoristas(),
        this.variableDistribucion(),
        this.metricaDistribucion(),
      ).filter((fila) => fila.regiones.length > 0 || fila.valor > 0);
    }
    if (this.variableDistribucion() === 'casos') {
      return distribuirPorRegion(this.filasRegion(), this.metricaDistribucion());
    }
    return [];
  });

  // ── Coroplético del mapa (misma variable que el gráfico) ──────────────────

  readonly coropletaAlertas = computed(
    () => this.coropletaVisible() && this.variableDistribucion() === 'alertas',
  );
  readonly coropletaManifiestos = computed(
    () => this.coropletaVisible() && this.variableDistribucion() === 'casos',
  );

  /**
   * Medidas por región para el coroplético. Con el eje de casos se derivan de
   * las filas y se les adjunta el ubigeo de la capa de regiones; con el eje de
   * alertas vienen del endpoint de indicadores.
   */
  private readonly medidasCoropleta = computed<readonly MedidaRegion[]>(() => {
    if (this.variableDistribucion() === 'alertas') return this.indicadores.regiones();

    const ubigeoPorNombre = new Map<string, string>();
    for (const region of this.territorio.regiones()) {
      ubigeoPorNombre.set(normalizarRegion(region.region ?? region.nombre), region.ubigeo);
    }

    return medidasDeCasos(this.filasRegion()).map((medida) => ({
      ...medida,
      ubigeo: ubigeoPorNombre.get(normalizarRegion(medida.region)) ?? null,
    }));
  });

  private readonly maximoCoropleta = computed(() => {
    const variable = this.variableDistribucion();
    const metrica = this.metricaDistribucion();
    return this.medidasCoropleta().reduce(
      (tope, medida) => Math.max(tope, valorMedida(medida, variable, metrica)),
      0,
    );
  });

  private readonly intensidades = computed<{
    porUbigeo: ReadonlyMap<string, number | null>;
    porNombre: ReadonlyMap<string, number | null>;
  }>(() => {
    const variable = this.variableDistribucion();
    const metrica = this.metricaDistribucion();
    const maximo = this.maximoCoropleta();
    const porUbigeo = new Map<string, number | null>();
    const porNombre = new Map<string, number | null>();

    for (const medida of this.medidasCoropleta()) {
      const intensidad = intensidadMedida(medida, variable, metrica, maximo);
      if (medida.ubigeo) porUbigeo.set(medida.ubigeo, intensidad);
      porNombre.set(normalizarRegion(medida.region), intensidad);
    }
    return { porUbigeo, porNombre };
  });

  /** Ubigeos de las regiones del alcance vigente, para destacar sus bordes. */
  private readonly alcanceUbigeos = computed<ReadonlySet<string>>(() => {
    const alcance = this.alcanceActivo();
    const ubigeos = new Set<string>();
    if (alcance === null) return ubigeos;

    const clave = normalizarRegion(alcance);
    for (const region of this.territorio.regiones()) {
      if (normalizarRegion(region.alcance ?? '') === clave) ubigeos.add(region.ubigeo);
    }
    return ubigeos;
  });

  // ── Acciones de la distribución y del coroplético ─────────────────────────

  elegirVariable(variable: VariableDistribucion): void {
    let metrica = this.metricaDistribucion();
    // «% manifiestos» no existe en el eje de alertas: se cae a riesgo alto.
    if (variable === 'alertas' && metrica === 'manifiestos') metrica = 'riesgoAlto';

    this.variableDistribucion.set(variable);
    this.metricaDistribucion.set(metrica);
  }

  elegirMetrica(metrica: MetricaDistribucion): void {
    this.metricaDistribucion.set(metrica);
  }

  /** Botón rojo: riesgo en alertas del último trimestre. */
  alternarCoropletaAlertas(): void {
    if (this.variableDistribucion() === 'alertas' && this.coropletaVisible()) {
      this.coropletaVisible.set(false);
      return;
    }
    this.variableDistribucion.set('alertas');
    this.metricaDistribucion.set('riesgoAlto');
    this.coropletaVisible.set(true);
  }

  /** Botón azul: % de casos manifiestos por región. */
  alternarCoropletaManifiestos(): void {
    if (this.variableDistribucion() === 'casos' && this.coropletaVisible()) {
      this.coropletaVisible.set(false);
      return;
    }
    this.variableDistribucion.set('casos');
    this.metricaDistribucion.set('manifiestos');
    this.coropletaVisible.set(true);
  }

  // ── Panel deslizante de capas ─────────────────────────────────────────────

  alternarPanelCapas(): void {
    if (this.panelCapasAbierto()) {
      this.cerrarPanelCapas();
      return;
    }
    const activo = typeof document !== 'undefined' ? document.activeElement : null;
    this.focoPanelPrevio = activo instanceof HTMLElement ? activo : null;
    this.panelCapasAbierto.set(true);
  }

  cerrarPanelCapas(): void {
    if (!this.panelCapasAbierto()) return;
    this.panelCapasAbierto.set(false);
    this.focoPanelPrevio?.focus?.();
    this.focoPanelPrevio = null;
  }

  alFondoPanel(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarPanelCapas();
  }

  alTeclaPanel(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(this.panelCapas()?.nativeElement, evento);
  }

  /** Enciende/apaga una capa opcional y pide sus datos la primera vez. */
  alternarCapa(clave: ClaveCapa): void {
    const siguiente = !this.capasOpcionales()[clave];
    this.capasOpcionales.update((capas) => ({ ...capas, [clave]: siguiente }));
    if (!siguiente) return;

    switch (clave) {
      case 'derechos':
        void this.capas.cargarInfraestructuras();
        break;
      case 'fondepes':
        void this.capas.cargarFondepes();
        break;
      case 'dpa':
        void this.capas.cargarDesembarcaderos();
        break;
      case 'auditorios':
        void this.capas.cargarAuditorios();
        break;
      case 'provincias':
        void this.territorio.cargarProvincias();
        break;
      case 'anp':
        void this.territorio.cargarAnp();
        break;
      case 'distritos':
        // La pide el efecto de distritos, que conoce la región seleccionada.
        break;
    }
  }

  reintentarDistritos(): void {
    this.claveDistritos = '';
    this.distritosEnCurso = null;
    this.reintentoDistritos.update((valor) => valor + 1);
  }

  reintentarRegiones(): void {
    this.territorio.reintentarRegiones();
  }

  reintentarInfraestructura(): void {
    void this.capas.cargarInfraestructuras();
  }

  reintentarFondepes(): void {
    void this.capas.cargarFondepes();
  }

  reintentarDpa(): void {
    void this.capas.cargarDesembarcaderos();
  }

  reintentarAuditorios(): void {
    void this.capas.cargarAuditorios();
  }

  reintentarProvincias(): void {
    this.territorio.reintentarProvincias();
  }

  reintentarAnp(): void {
    this.territorio.reintentarAnp();
  }

  // ── Ficha distrital ───────────────────────────────────────────────────────

  cerrarFichaDistrito(): void {
    if (!this.distritoActivo() || this.cerrandoFicha) return;
    this.cerrandoFicha = true;
    // La ficha se desmonta en el acto: se espera la salida con los datos vivos.
    salirModal(this.ficha()?.nativeElement, () => {
      this.cerrandoFicha = false;
      this.distritoActivo.set(null);
      this.distritoSeleccionadoUbigeo = null;
      this.refrescarDistritos(this.casosPorUbigeo());
      this.focoFichaPrevio?.focus?.();
      this.focoFichaPrevio = null;
    });
  }

  alFondoFicha(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarFichaDistrito();
  }

  alTeclaFicha(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(this.ficha()?.nativeElement, evento);
  }

  quitarSeleccion(): void {
    this.claveSeleccionada.set(null);
  }

  /** Mantiene el tabulador dentro del panel abierto (capas o ficha). */
  private atraparFoco(panel: HTMLElement | null | undefined, evento: KeyboardEvent): void {
    if (!panel) return;

    const enfocables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((elemento) => elemento.offsetParent !== null);
    if (enfocables.length === 0) return;

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    const activo = document.activeElement;

    // El foco inicial vive en el propio diálogo (`tabindex="-1"`): Shift+Tab
    // desde ahí saltaría al contenido de detrás, así que se cierra el ciclo.
    if (evento.shiftKey && activo === panel) {
      evento.preventDefault();
      ultimo.focus();
      return;
    }
    if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
      return;
    }
    if (evento.shiftKey && activo === primero) {
      evento.preventDefault();
      ultimo.focus();
    }
  }

  /** Una sola cifra decimal; «—» cuando falta el denominador. */
  formatearTasa(valor: number | null): string {
    return valor === null ? '—' : FORMATO_TASA.format(valor);
  }

  formatearNumero(valor: number | null): string {
    return valor === null ? '—' : FORMATO_ENTERO.format(valor);
  }

  fechaInicio(valor: string | null): string {
    return formatearFechaCorta(valor);
  }

  recargar(): void {
    this.panorama.recargar();
    this.indicadores.recargar();
    if (this.territorio.estadoRegiones() === 'error') this.territorio.reintentarRegiones();
  }

  private seleccionarRegion(region: string): void {
    // El nombre del polígono puede no coincidir literalmente con el de los casos
    // (Callao, Lima); se empareja por código INEI y se guarda la clave de la fila.
    const codigo = codigoRegion(region);
    const clave = normalizarRegion(region);
    const fila = this.filasRegion().find((f) =>
      codigo !== null ? codigoRegion(f.region) === codigo : normalizarRegion(f.region) === clave,
    );
    if (!fila) return; // Sin casos visibles no hay chip ni recorte que mostrar.
    this.claveSeleccionada.set(normalizarRegion(fila.region));
  }

  private montarMapa(contenedor: HTMLElement): void {
    if (this.mapa) return;

    const mapa = L.map(contenedor, {
      scrollWheelZoom: false,
      zoomControl: true,
      minZoom: 3,
      maxZoom: 11,
    });

    L.tileLayer(TESELAS_OSM, {
      maxZoom: 19,
      attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
    }).addTo(mapa);

    // Las capas territoriales viven en un panel propio por debajo del
    // `overlayPane`: los polígonos de región y de distrito comparten capa y los
    // distritos, añadidos después, quedan encima para capturar su clic.
    mapa.createPane('distritos');
    const panelDistritos = mapa.getPane('distritos');
    if (panelDistritos) panelDistritos.style.zIndex = '390';

    mapa.fitBounds(LIMITES_PERU, { padding: [12, 12] });
    this.mapa = mapa;
    this.versionMapa.update((version) => version + 1);
  }

  private desmontarMapa(): void {
    this.capaRegiones = null;
    this.regionesFuente = null;
    this.capaProvincias = null;
    this.capaAnp = null;
    this.capaDerechos = null;
    this.capaFondepes = null;
    this.capaDpa = null;
    this.capaAuditorios = null;
    this.capaDistritos = null;
    this.claveDistritos = '';
    this.distritosEnCurso = null;
    this.distritoSeleccionadoUbigeo = null;
    this.distritosCargados.set(null);
    this.ultimoEncuadre = null;
    const mapa = this.mapa;
    this.mapa = null;
    mapa?.remove();
  }

  // ── Capa de regiones y coroplético ────────────────────────────────────────

  private sincronizarRegiones(mapa: L.Map, regiones: readonly RegionGeo[]): void {
    if (this.capaRegiones && this.regionesFuente === regiones) return;

    this.quitarRegiones();
    if (regiones.length === 0) return;

    const coleccion: FeatureCollection<Polygon | MultiPolygon, PropsRegion> = {
      type: 'FeatureCollection',
      features: regiones.map((region) => ({
        type: 'Feature',
        properties: {
          ubigeo: region.ubigeo,
          nombre: region.nombre,
          region: region.region ?? region.nombre,
          alcance: region.alcance,
        },
        geometry: region.geometria,
      })),
    };

    const capa = L.geoJSON(coleccion, {
      pane: 'distritos',
      interactive: true,
      style: (rasgo) => this.estiloRegion(rasgo),
      // Sin las burbujas por región, el propio polígono selecciona: el clic
      // mantiene viva la selección (chip de cabecera y filtro de la capa distrital).
      onEachFeature: (rasgo, subcapa) => {
        subcapa.on('click', () => {
          const region = regionDelRasgo(rasgo);
          if (region) this.seleccionarRegion(region);
        });
      },
    });
    capa.addTo(mapa);

    this.capaRegiones = capa;
    this.regionesFuente = regiones;
  }

  private quitarRegiones(): void {
    this.capaRegiones?.remove();
    this.capaRegiones = null;
    this.regionesFuente = null;
  }

  /** Reaplica relleno y borde sin reconstruir la geometría (26 polígonos). */
  private aplicarEstiloRegiones(): void {
    const capa = this.capaRegiones;
    if (!capa) return;

    capa.eachLayer((subcapa) => {
      const ruta = subcapa as RasgoDistrital;
      ruta.setStyle(this.estiloRegion(ruta.feature));
    });
  }

  private estiloRegion(rasgo: { properties?: unknown } | null | undefined): L.PathOptions {
    const ubigeo = ubigeoDelRasgo(rasgo);
    const region = regionDelRasgo(rasgo);
    const destacada = ubigeo !== null && this.alcanceUbigeos().has(ubigeo);
    const seleccion = this.claveSeleccionada();
    const codigoSeleccion = seleccion !== null ? codigoRegion(seleccion) : null;
    const seleccionada =
      seleccion !== null &&
      region !== null &&
      (normalizarRegion(region) === seleccion ||
        (codigoSeleccion !== null && codigoRegion(region) === codigoSeleccion));

    let fillColor = '#eef3f8';
    let fillOpacity = 0.18;

    if (this.coropletaVisible()) {
      const escala =
        this.variableDistribucion() === 'alertas'
          ? ESCALA_COROPLETA_ALERTAS
          : ESCALA_COROPLETA_MANIFIESTOS;
      const color = colorChoropleta(this.intensidadDeRegion(ubigeo, region), escala);
      if (color) {
        fillColor = color;
        fillOpacity = 0.82;
      }
    }

    return {
      color: seleccionada ? '#0b2d5c' : destacada ? '#1d427f' : '#8a98a5',
      weight: seleccionada ? 2.8 : destacada ? 1.8 : 0.6,
      fillColor,
      fillOpacity,
    };
  }

  private intensidadDeRegion(ubigeo: string | null, region: string | null): number | null {
    const { porUbigeo, porNombre } = this.intensidades();
    if (ubigeo !== null && porUbigeo.has(ubigeo)) return porUbigeo.get(ubigeo) ?? null;
    if (region !== null) return porNombre.get(normalizarRegion(region)) ?? null;
    return null;
  }

  /** Límites de un conjunto de regiones; `null` si no hay geometría válida. */
  private limitesDe(regiones: readonly RegionGeo[]): L.LatLngBounds | null {
    if (regiones.length === 0) return null;

    const coleccion: FeatureCollection<Polygon | MultiPolygon> = {
      type: 'FeatureCollection',
      features: regiones.map((region) => ({
        type: 'Feature',
        properties: {},
        geometry: region.geometria,
      })),
    };
    const limites = L.geoJSON(coleccion).getBounds();
    return limites.isValid() ? limites : null;
  }

  // ── Capa distrital y ficha ────────────────────────────────────────────────

  /**
   * Pide la capa distrital una vez por ámbito: nacional al encenderla y acotada a
   * la región cuando hay una fila seleccionada. El servicio cachea por región.
   */
  private async asegurarDistritos(mapa: L.Map, region: string | null): Promise<void> {
    const clave = region ?? '';
    if (this.claveDistritos === clave && this.capaDistritos) return;
    if (this.distritosEnCurso === clave) return;
    this.claveDistritos = clave;
    this.distritosEnCurso = clave;

    try {
      const distritos = await this.territorio.distritos(region);
      if (this.mapa !== mapa || this.claveDistritos !== clave) return;
      this.dibujarDistritos(mapa, distritos, region);
    } catch {
      if (this.mapa !== mapa || this.claveDistritos !== clave) return;
      // El servicio ya publica el 503 o el fallo de red en `errorDistritos`:
      // la capa no se dibuja y el resto del mapa sigue intacto.
      this.claveDistritos = '';
      this.quitarCapaDistritos();
      this.distritosCargados.set(null);
    } finally {
      if (this.distritosEnCurso === clave) this.distritosEnCurso = null;
    }
  }

  private dibujarDistritos(
    mapa: L.Map,
    distritos: readonly DistritoGeo[],
    region: string | null,
  ): void {
    this.quitarCapaDistritos();

    const conteo = this.casosPorUbigeo();
    const porUbigeo = new Map(distritos.map((distrito) => [distrito.ubigeo, distrito]));
    const coleccion: FeatureCollection<Polygon | MultiPolygon, PropiedadesDistrito> = {
      type: 'FeatureCollection',
      features: distritos.map((distrito) => ({
        type: 'Feature',
        id: distrito.ubigeo,
        properties: { ubigeo: distrito.ubigeo, nombre: distrito.nombre },
        geometry: distrito.geometria,
      })),
    };

    const capa = L.geoJSON(coleccion, {
      pane: 'distritos',
      interactive: true,
      style: (rasgo) => {
        const ubigeo = ubigeoDelRasgo(rasgo);
        return estiloDistrito(
          claseCoropleta(conteo.get(ubigeo ?? '')?.total ?? 0),
          ubigeo === this.distritoSeleccionadoUbigeo,
        );
      },
      onEachFeature: (rasgo, subcapa) => {
        const ubigeo = ubigeoDelRasgo(rasgo);
        const distrito = ubigeo ? porUbigeo.get(ubigeo) : undefined;
        if (!distrito) return;

        const registro = conteo.get(distrito.ubigeo);
        const casos = registro?.total ?? 0;
        const desglose = registro
          ? ` · ${registro.latentes} lat. / ${registro.manifiestos} man.`
          : '';
        const ruta = subcapa as L.Path;
        ruta.bindTooltip(
          `${distrito.nombre} · ${casos} ${casos === 1 ? 'caso abierto' : 'casos abiertos'}${desglose}`,
          { direction: 'top', sticky: true },
        );
        ruta.on('click', () => this.abrirFichaDistrito(distrito, ruta));
      },
    });

    this.capaDistritos = capa;
    this.claveDistritos = region ?? '';
    this.distritosCargados.set(distritos.length);
    capa.addTo(mapa);

    const limites = capa.getBounds();
    if (region !== null && limites.isValid()) {
      mapa.fitBounds(limites, { padding: [10, 10] });
    }
  }

  private quitarCapaDistritos(): void {
    this.capaDistritos?.remove();
    this.capaDistritos = null;
  }

  /** Reaplica el relleno y el resaltado sin reconstruir la geometría. */
  private refrescarDistritos(conteo: ReadonlyMap<string, ConteoDistrito>): void {
    const capa = this.capaDistritos;
    if (!capa) return;

    capa.eachLayer((subcapa) => {
      const ruta = subcapa as RasgoDistrital;
      const ubigeo = ubigeoDelRasgo(ruta.feature);
      if (!ubigeo) return;
      ruta.setStyle(
        estiloDistrito(
          claseCoropleta(conteo.get(ubigeo)?.total ?? 0),
          ubigeo === this.distritoSeleccionadoUbigeo,
        ),
      );
    });
  }

  private abrirFichaDistrito(distrito: DistritoGeo, ruta: L.Path): void {
    const activo = document.activeElement;
    this.focoFichaPrevio =
      activo instanceof HTMLElement && activo !== document.body
        ? activo
        : (this.lienzo()?.nativeElement ?? null);

    this.distritoSeleccionadoUbigeo = distrito.ubigeo;
    ruta.bringToFront();
    this.refrescarDistritos(this.casosPorUbigeo());
    this.distritoActivo.set(distrito);
  }

  // ── Construcción de capas opcionales ──────────────────────────────────────

  /**
   * Alterna un grupo de puntos según su conmutador. Cuando la capa está apagada
   * no se construye nada: pedir 13 456 marcadores para ocultarlos sería tirar
   * memoria y CPU.
   */
  private sincronizarGrupo(
    mapa: L.Map,
    visible: boolean,
    puntos: readonly PuntoInfraestructura[],
    actual: L.LayerGroup | null,
    construir: (puntos: readonly PuntoInfraestructura[]) => L.LayerGroup,
  ): L.LayerGroup | null {
    if (!visible || puntos.length === 0) {
      actual?.remove();
      return null;
    }
    const grupo = actual ?? construir(puntos);
    if (!mapa.hasLayer(grupo)) grupo.addTo(mapa);
    return grupo;
  }

  /**
   * Derechos acuícolas: miles de puntos, sin interacción y sobre canvas. Se
   * dibujan sólo mientras la capa está encendida.
   */
  private construirDerechos(puntos: readonly PuntoInfraestructura[]): L.LayerGroup {
    const grupo = L.layerGroup();
    const renderer = L.canvas({ padding: 0.3 });

    for (const punto of puntos) {
      if (punto.tipo !== 'derecho_acuicola') continue;
      L.circleMarker([punto.lat, punto.lon], {
        radius: 2.4,
        color: '#397c79',
        weight: 0,
        fillColor: '#397c79',
        fillOpacity: 0.55,
        interactive: false,
        renderer,
      }).addTo(grupo);
    }

    return grupo;
  }

  /** Sedes y desembarcaderos: anillos pocos y con tooltip. */
  private construirAnillos(
    puntos: readonly PuntoInfraestructura[],
    color: string,
    etiqueta: (punto: PuntoInfraestructura) => string,
  ): L.LayerGroup {
    const grupo = L.layerGroup();

    for (const punto of puntos) {
      L.circleMarker([punto.lat, punto.lon], {
        radius: 4,
        color,
        weight: 1.6,
        fillColor: '#eaf1fb',
        fillOpacity: 0.95,
      })
        .bindTooltip(etiqueta(punto), { direction: 'top', sticky: true })
        .addTo(grupo);
    }

    return grupo;
  }

  /**
   * Auditorios agrupados por distrito: un marcador por centroide, rotulado con
   * el nombre del distrito y cuántos auditorios contiene. La precisión es
   * «distrito», nunca la puerta del local.
   */
  private construirAuditorios(auditorios: readonly AuditorioMapa[]): L.LayerGroup {
    const grupo = L.layerGroup();
    const porDistrito = new Map<
      string,
      { nombre: string; lat: number; lon: number; total: number }
    >();

    for (const auditorio of auditorios) {
      const centroide = auditorio.centroide;
      if (!centroide) continue;

      const clave = auditorio.ubigeo ?? `${centroide.lat},${centroide.lon}`;
      const actual = porDistrito.get(clave);
      if (actual) {
        actual.total += 1;
        continue;
      }
      porDistrito.set(clave, {
        nombre: auditorio.distrito ?? 'Distrito sin declarar',
        lat: centroide.lat,
        lon: centroide.lon,
        total: 1,
      });
    }

    for (const distrito of porDistrito.values()) {
      const etiqueta = `${distrito.nombre} · ${distrito.total} ${
        distrito.total === 1 ? 'auditorio' : 'auditorios'
      }`;
      L.circleMarker([distrito.lat, distrito.lon], {
        radius: 6,
        color: '#1d427f',
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 0.95,
      })
        .bindTooltip(etiqueta, {
          permanent: true,
          direction: 'right',
          className: 'etiqueta-auditorio',
        })
        .addTo(grupo);
    }

    return grupo;
  }

  /** Provincias: sólo contorno fino, transparente, para no tapar el relleno. */
  private construirProvincias(provincias: readonly RegionGeo[]): L.GeoJSON {
    const coleccion: FeatureCollection<Polygon | MultiPolygon, PropsRegion> = {
      type: 'FeatureCollection',
      features: provincias.map((provincia) => ({
        type: 'Feature',
        properties: {
          ubigeo: provincia.ubigeo,
          nombre: provincia.nombre,
          region: provincia.region ?? provincia.nombre,
          alcance: provincia.alcance,
        },
        geometry: provincia.geometria,
      })),
    };

    return L.geoJSON(coleccion, {
      pane: 'distritos',
      interactive: false,
      style: { color: '#5d6d7c', weight: 0.5, fillOpacity: 0 },
    });
  }

  /** ANP Reservas Nacionales: contorno verde discontinuo y relleno tenue. */
  private construirAnp(anp: readonly AnpGeo[]): L.GeoJSON {
    const coleccion: FeatureCollection<
      Polygon | MultiPolygon,
      { codigo: string; nombre: string; categoria: string | null }
    > = {
      type: 'FeatureCollection',
      features: anp.map((area) => ({
        type: 'Feature',
        properties: {
          codigo: area.codigo,
          nombre: area.nombre,
          categoria: area.categoria,
        },
        geometry: area.geometria,
      })),
    };

    return L.geoJSON(coleccion, {
      pane: 'distritos',
      interactive: false,
      style: {
        color: '#2f6b4f',
        weight: 1,
        dashArray: '4 3',
        fillColor: '#2f6b4f',
        fillOpacity: 0.12,
      },
    });
  }

  private etiquetaSede(punto: PuntoInfraestructura): string {
    const nombre = punto.nombreInfraestructura ?? 'Sede FONDEPES';
    const institucion = punto.identi ?? 'Sin IDENTI';
    const distrito = punto.distrito ?? 'distrito sin declarar';
    return `${nombre} · ${institucion} · ${distrito}`;
  }

  private etiquetaDpa(punto: PuntoInfraestructura): string {
    const nombre = punto.nombreInfraestructura ?? 'Desembarcadero';
    const distrito = punto.distrito ?? 'distrito sin declarar';
    const region = punto.region ?? 'región sin declarar';
    return `${nombre} · ${distrito} · ${region}`;
  }
}
