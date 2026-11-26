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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { map } from 'rxjs';

import { AlcanceService, esAlcance } from '../../core/alcance/alcance.service';
import { SesionStore } from '../../core/auth/sesion.store';
import { TerritorioService } from '../../core/territorio/territorio.service';
import type { DistritoGeo, PoblacionRegion } from '../../core/territorio/territorio.tipos';
import { formatearFechaHora } from '../../shared/formato-fecha';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import { formatearFechaCorta } from '../../dominio/mapeo';
import type { Alcance, Caso, PrioridadAtencion, Riesgo } from '../../dominio/modelos';
import { coordenadaDeRegion } from './centroides.regiones';
import {
  CapasMapaService,
  type PuntoInfraestructura,
  type TipoInfraestructura,
} from './capas.service';
import {
  bandasPorAlcance,
  casosDeRegion,
  casosPorDistritoUbigeo,
  casosSinDistrito,
  claseCoropleta,
  claseManifiesto,
  conteosPorAlcance,
  conteosPorSituacion,
  contarRegiones,
  contarRiesgoAlto,
  contarRiesgoAltoSinRegion,
  contarSinRegion,
  ESCALA_COROPLETA,
  ESCALA_MANIFIESTO,
  filasPorRegion,
  indicePoblacionPorRegion,
  normalizarRegion,
  regionDe,
  tasaPor100k,
  type ConteoDistrito,
  type FilaRegion,
} from './panorama.agregados';
import { PanoramaService } from './panorama.service';

/** Teselas públicas de OpenStreetMap: el mapa es referencial, no oficial. */
const TESELAS_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Encuadre inicial: extensión continental del Perú. */
const LIMITES_PERU: [number, number][] = [
  [-18.4, -81.4],
  [-0.05, -68.6],
];

/** Radio en píxeles: acotado por diseño y escalado por la raíz del conteo. */
const RADIO_MIN = 11;
const RADIO_MAX = 34;

/**
 * Color del círculo por composición del agregado, no por el nivel de conflicto
 * de un caso suelto. `ESCALA_MANIFIESTO` va de verde (todo latente) a rojo (todo
 * manifiesto) en cinco tramos; el borde es un tono más oscuro del relleno.
 * El tamaño sigue representando el volumen: sólo el color cambia de eje.
 */
function estiloCirculo(fila: FilaRegion, activa: boolean): L.PathOptions {
  const tramo = ESCALA_MANIFIESTO[claseManifiesto(fila.proporcionLatente)];
  return {
    color: tramo.borde,
    weight: activa ? 2.5 : 1.5,
    fillColor: tramo.relleno,
    fillOpacity: activa ? 0.9 : 0.7,
  };
}

/** Relleno de la coropleta: un tono por tramo de `ESCALA_COROPLETA`. */
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
type RasgoDistrital = L.Path & { feature?: { properties?: unknown } };

/** Ubigeo del rasgo GeoJSON, sin confiar en el tipo de `properties`. */
function ubigeoDelRasgo(rasgo: { properties?: unknown } | null | undefined): string | null {
  const propiedades = rasgo?.properties;
  if (typeof propiedades !== 'object' || propiedades === null) return null;
  const valor = (propiedades as Record<string, unknown>)['ubigeo'];
  return typeof valor === 'string' ? valor : null;
}

function radioCirculo(total: number, maximo: number): number {
  if (maximo <= 1) return RADIO_MIN;
  const proporcion = Math.sqrt((Math.max(1, total) - 1) / (maximo - 1));
  return RADIO_MIN + (RADIO_MAX - RADIO_MIN) * proporcion;
}

function etiquetaCirculo(fila: FilaRegion): string {
  const porcentaje = Math.round(fila.proporcionLatente * 100);
  return `${fila.region} · ${fila.latentes} latentes · ${fila.manifiestos} manifiestos · ${fila.total} ${fila.total === 1 ? 'caso' : 'casos'} · ${porcentaje} % latente`;
}

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
 * latente + manifiesto siempre suma el total. El conteo de «sin nivel» se
 * conserva como declaración, no como tercera situación. La cabecera resume la
 * situación con cuatro tarjetas fijas —latentes, manifiestos, regiones con casos
 * y riesgo alto— más la de casos sin nivel declarado cuando existe, y el panel
 * «Casos por región» abre un cajón lateral «Ver
 * casos» (item 109) con el territorio de la fila y el ámbito vigente, enlazado
 * al listado completo. El esquema usa
 * bandas, chips y una tabla derivados del conteo, y suma un mapa referencial de
 * OpenStreetMap con dos capas: un círculo por región con casos visibles, ubicado
 * en su centroide referencial (`centroides.regiones.ts`), y los límites
 * distritales coropléticos de `territorio.distrito` (item 129), cuyo relleno es
 * el número de casos abiertos por ubigeo. El radio del círculo representa el
 * volumen y el color, la proporción latente/manifiesta (`ESCALA_MANIFIESTO`); no
 * codifica el nivel de conflicto de un caso suelto. Sobre el mismo mapa se
 * encienden capas opcionales de infraestructuras y auditorios. Al pulsar un
 * polígono se abre su ficha
 * territorial con población, casos y tasa por 100 000 habitantes. La tabla suma
 * esa tasa por región (item 131); la población sólo es denominador y nunca
 * interviene en el riesgo ni en la prioridad (Guía §7.5.2, Tabla 3).
 *
 * El recorte por `usuario().regiones` es de presentación: hoy la RLS entrega el
 * conjunto completo y `lib/db/scope.ts` documenta que el bloqueo por territorio
 * aún no existe. Si la sesión trae regiones, la vista se acota a ellas y no cae
 * al conjunto nacional cuando no hay coincidencias.
 */
@Component({
  selector: 'app-mapa',
  imports: [RouterLink, IconoComponent, ThOrdenDirective, GlosarioComponent],
  templateUrl: './mapa.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PanoramaService, CapasMapaService],
  styles: `
    :host {
      display: block;
    }

    /* Hasta cinco tarjetas (latentes, manifiestos, sin nivel declarado, regiones
       con casos y riesgo alto); la rejilla global es de cuatro y aquí se fija.
       Con auto-fit las cinco reparten el ancho sin dejar un hueco. */
    .executive-kpis {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }

    @media (max-width: 980px) {
      .executive-kpis {
        grid-template-columns: repeat(3, minmax(0, 1fr));
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

    .ambito-chips {
      flex-wrap: wrap;
      /* El selector de ámbito queda fijo bajo la cabecera (64 px; 58 px en móvil). */
      position: sticky;
      top: 64px;
      z-index: 20;
      margin: 0;
      padding: 8px 0;
      background: var(--canvas);
    }

    .chip-count {
      margin-left: 4px;
      padding: 0 5px;
      border-radius: 999px;
      background: rgba(100, 116, 135, 0.14);
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
    }

    .segmented > button[aria-pressed='true'] .chip-count {
      background: rgba(29, 75, 134, 0.14);
    }

    .panel {
      padding: 17px;
    }

    /* Primera fila: mapa a la izquierda y casos por región a la derecha. */
    .panel-doble {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 14px;
      align-items: start;
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

    .ambitos {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 12px;
    }

    .ambito {
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }

    .ambito-cabeza {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .ambito-nombre {
      color: var(--ink);
      font: 700 14px/1.3 var(--font-display);
    }

    .ambito-total {
      color: var(--muted);
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
    }

    .ambito-barra {
      height: 5px;
      border-radius: 999px;
      background: var(--canvas);
      overflow: hidden;
    }

    .ambito-barra > span {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: var(--blue);
    }

    .ambito-regiones {
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

    .tabla-nota {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .mapa-cabeza {
      flex-wrap: wrap;
    }

    .regiones-cabeza {
      flex-wrap: wrap;
    }

    .celda-caso small {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }

    /*
     * La primera celda de .data-table mide 205px por regla global; aquí la
     * Región va un 40 % más estrecha y el Caso, un 30 %.
     */
    .data-table th.col-region,
    .data-table td:first-child.col-region {
      width: 17%;
      min-width: 0;
    }

    .data-table td:first-child.celda-caso {
      width: 28%;
      min-width: 0;
    }

    .mapa-rotulo {
      display: inline-flex;
      align-items: center;
      margin: 9px 0 0;
      padding: 2px 8px;
      border: 1px dashed var(--line);
      border-radius: 999px;
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 600;
    }

    .mapa-lienzo {
      height: 360px;
      min-height: 320px;
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--canvas);
      overflow: hidden;
      isolation: isolate;
    }

    .mapa-leyenda {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .mapa-leyenda li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .leyenda-punto,
    .leyenda-anillo {
      flex: none;
      width: 10px;
      height: 10px;
      border: 1.5px solid var(--blue);
      border-radius: 50%;
      background: var(--blue-pale);
    }

    .leyenda-anillo {
      border: 2px solid var(--blue-dark);
    }

    .mapa-controles {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .mapa-estado {
      color: var(--muted);
      font-size: 12px;
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

    .mapa-nota {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .mapa-leyenda-coropleta {
      margin-top: 4px;
    }

    .leyenda-titulo {
      color: var(--ink-2);
      font-weight: 600;
    }

    .leyenda-tramo {
      flex: none;
      width: 14px;
      height: 8px;
      border: 1px solid rgba(34, 69, 111, 0.35);
      border-radius: 2px;
      background: var(--canvas);
    }

    .mapa-lienzo:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
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

    .celda-tasa {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .region-chip-activa {
      border-color: var(--blue);
      background: var(--blue-pale);
      color: var(--blue-dark);
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

    /* Cajón «Ver casos» (item 109): entra de izquierda a derecha. */
    .casos-drawer-scrim {
      position: fixed;
      inset: 0;
      display: flex;
      justify-content: flex-start;
      overflow: hidden;
    }

    .casos-drawer {
      display: flex;
      flex-direction: column;
      width: min(52%, 620px);
      height: 100%;
      border-right: 1px solid #dbe3ea;
      background: #fff;
      box-shadow: 18px 0 44px rgba(17, 32, 45, 0.2);
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

    .casos-drawer-lista {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .casos-drawer-caso {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      padding: 9px 11px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: inherit;
      text-decoration: none;
    }

    .casos-drawer-caso:hover,
    .casos-drawer-caso:focus-visible {
      border-color: #c9d5e0;
      background: var(--blue-pale);
    }

    .casos-drawer-principal {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .casos-drawer-codigo {
      color: #35618f;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .casos-drawer-titulo {
      margin-top: 2px;
      color: var(--ink);
      font-size: 13px;
      line-height: 1.45;
    }

    .casos-drawer-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 10px;
      margin-top: 5px;
      color: #5a6b7b;
      font-size: 12px;
      line-height: 1.4;
    }

    .casos-drawer-tags {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .casos-drawer-vacio {
      margin: 0;
      padding: 24px 4px;
      color: #59697a;
      font-size: 13px;
      line-height: 1.5;
    }

    .casos-drawer-pie {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 20px;
      border-top: 1px solid #eef2f6;
      background: #fafbfc;
    }

    .casos-drawer-pie a {
      text-decoration: none;
    }

    @media (max-width: 760px) {
      .executive-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .ambito-chips {
        top: 58px;
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

    /* ── Escala de color y capas opcionales ── */
    .leyenda-escala {
      align-items: center;
    }

    .leyenda-escala-tramo {
      display: inline-block;
      width: 16px;
      height: 10px;
      margin-right: 5px;
      border-radius: 2px;
      vertical-align: middle;
    }

    .leyenda-extremos {
      color: #33475b;
    }

    .punto-situacion {
      display: inline-block;
      width: 9px;
      height: 9px;
      margin-right: 6px;
      border-radius: 50%;
      vertical-align: baseline;
    }

    .mapa-capas {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 12px 0 4px;
      padding: 12px 14px;
      border: 1px solid #e6ebef;
      border-radius: 10px;
      background: #fafbfc;
    }

    .mapa-capas h4 {
      margin: 0;
      font-size: 13px;
      color: #33475b;
    }

    .capa-fila {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 9px 0;
      border-top: 1px solid #eef2f6;
      cursor: pointer;
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

    .capa-filtro {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 2px 0 0 24px;
    }

    .capa-filtro button {
      border: 1px solid #e6ebef;
      border-radius: 999px;
      background: #fff;
      color: #33475b;
      font-size: 12px;
      padding: 3px 10px;
      cursor: pointer;
    }

    .capa-filtro button[aria-pressed='true'] {
      border-color: #2455a2;
      background: #eaf1fb;
      color: #1d427f;
    }

    .mapa-estado-capas {
      margin: 0;
      font-size: 12px;
      color: #778797;
    }

    .mapa-estado-capas[role='alert'] {
      color: #ad4d46;
    }
  `,
})
export class MapaPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionStore);
  private readonly alcanceService = inject(AlcanceService);
  private readonly panorama = inject(PanoramaService);
  private readonly territorio = inject(TerritorioService);
  private readonly capas = inject(CapasMapaService);
  private readonly destruccion = inject(DestroyRef);

  private readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');
  private readonly cajon = viewChild<ElementRef<HTMLElement>>('cajon');
  private readonly ficha = viewChild<ElementRef<HTMLElement>>('ficha');

  /** Clave normalizada de la región seleccionada en el mapa. */
  private readonly claveSeleccionada = signal<string | null>(null);
  /** Cambia en cada montaje para redibujar los círculos sobre el mapa nuevo. */
  private readonly versionMapa = signal(0);

  /** Cajón lateral «Ver casos» (item 109). */
  readonly cajonAbierto = signal(false);
  private focoCajonPrevio: HTMLElement | null = null;

  /**
   * Orden local de la tabla de regiones. Sin columna activa rige el orden de
   * `filasPorRegion`: total de mayor a menor.
   */
  readonly ordenRegiones = new OrdenTabla<FilaRegion>();

  private mapa: L.Map | null = null;
  private readonly capasRegion = new Map<string, L.CircleMarker>();

  /** Capa coroplética de límites distritales (item 129) y su control. */
  readonly capaDistritosVisible = signal(true);
  readonly escalaCoropleta = ESCALA_COROPLETA;
  readonly coloresCoropleta = COLORES_COROPLETA;
  readonly estadoDistritos = this.territorio.estadoDistritos;
  readonly errorDistritos = this.territorio.errorDistritos;
  readonly estadoPoblacion = this.territorio.estadoPoblacion;
  readonly casosPorUbigeo = computed(() => casosPorDistritoUbigeo(this.visibles()));
  readonly casosSinDistritoTotal = computed(() => casosSinDistrito(this.visibles()));

  /** Escala del color de los círculos: verde (latente) → rojo (manifiesto). */
  readonly escalaManifiesto = ESCALA_MANIFIESTO;

  // ── Capas opcionales (se encienden sobre el mapa principal) ──
  readonly capaInfraVisible = signal(false);
  readonly capaAuditoriosVisible = signal(false);
  readonly filtroInfra = signal<'todos' | TipoInfraestructura>('todos');
  readonly estadoInfra = this.capas.estadoInfra;
  readonly errorInfra = this.capas.errorInfra;
  readonly resumenInfra = this.capas.resumenInfra;
  readonly estadoAuditorios = this.capas.estadoAuditorios;
  readonly errorAuditorios = this.capas.errorAuditorios;
  readonly resumenAuditorios = this.capas.resumenAuditorios;

  private infraDerechos: L.LayerGroup | null = null;
  private infraSedes: L.LayerGroup | null = null;
  private capaAuditorios: L.LayerGroup | null = null;

  /** Ficha territorial del distrito pulsado (paso 3). */
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
  private focoFichaPrevio: HTMLElement | null = null;

  /** Población por región, indexada por nombre normalizado (sólo denominador). */
  private readonly poblacionIndice = signal<ReadonlyMap<string, PoblacionRegion> | null>(null);

  private capaDistritos: L.GeoJSON | null = null;
  private claveDistritos = '';
  private distritosEnCurso: string | null = null;
  private distritoSeleccionadoUbigeo: string | null = null;
  /** Fuerza un nuevo intento de la capa tras un 503 o un fallo de red. */
  private readonly reintentoDistritos = signal(0);

  constructor() {
    // Leaflet necesita el contenedor ya en el DOM. El `@if` de la plantilla lo
    // crea al haber datos; si la sección desaparece (recarga o cambio de
    // ámbito), el mismo efecto desmonta el mapa.
    effect((onCleanup) => {
      const contenedor = this.lienzo()?.nativeElement;
      if (!contenedor) return;

      this.montarMapa(contenedor);
      onCleanup(() => this.desmontarMapa());
    });

    // Recalcula los círculos al cambiar los casos visibles o la selección, sin
    // recrear el mapa ni sus teselas.
    effect(() => {
      this.versionMapa();
      this.sincronizarCirculos(this.filasRegion(), this.claveSeleccionada());
    });

    // Capa distrital (item 129): se pide al montar —acotada a la región de la
    // fila seleccionada— y se recarga cuando esa región cambia. El relleno se
    // recalcula con los casos visibles; un 503 deja la capa fuera y conserva
    // los círculos por región.
    effect(() => {
      this.versionMapa();
      this.reintentoDistritos();
      const mapa = this.mapa;
      const visible = this.capaDistritosVisible();
      const region = this.filaSeleccionada()?.region ?? null;
      const conteo = this.casosPorUbigeo();
      if (!mapa) return;

      this.aplicarVisibilidadDistritos(mapa, visible);
      this.refrescarDistritos(conteo);
      void this.asegurarDistritos(mapa, region);
    });

    // Capa de infraestructuras: se pide la primera vez que se enciende y se
    // dibuja con renderer canvas, porque son ~13 456 puntos. El filtro por tipo
    // oculta un grupo sin volver a pedir los datos.
    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      const visible = this.capaInfraVisible();
      const filtro = this.filtroInfra();
      const puntos = this.capas.puntosInfra();
      if (!mapa) return;

      if (!visible) {
        this.infraDerechos?.remove();
        this.infraSedes?.remove();
        return;
      }

      if (puntos.length > 0 && !this.infraDerechos) this.construirInfra();

      this.alternarGrupo(mapa, this.infraDerechos, filtro !== 'institucional');
      this.alternarGrupo(mapa, this.infraSedes, filtro !== 'derecho_acuicola');
    });

    // Capa de auditorios: un marcador por distrito en su centroide, rotulado con
    // el nombre del distrito. Se agrupa para no dibujar 27 chinchetas encimadas.
    effect(() => {
      this.versionMapa();
      const mapa = this.mapa;
      const visible = this.capaAuditoriosVisible();
      const auditorios = this.capas.auditorios();
      if (!mapa) return;

      if (!visible) {
        this.capaAuditorios?.remove();
        return;
      }

      if (auditorios.length > 0 && !this.capaAuditorios) this.construirAuditorios();
      this.alternarGrupo(mapa, this.capaAuditorios, true);
    });

    // El cajón de «Ver casos» se enfoca en cuanto `viewChild` resuelve el panel
    // recién renderizado; Escape lo cierra y devuelve el foco al disparador.
    effect(() => {
      const panel = this.cajon()?.nativeElement;
      if (panel && this.cajonAbierto()) panel.focus();
    });

    // Misma pauta para la ficha distrital: se enfoca al abrirse y Escape la
    // cierra devolviendo el foco al mapa, que es el disparador.
    effect(() => {
      const panel = this.ficha()?.nativeElement;
      if (panel && this.distritoActivo()) panel.focus();
    });

    if (typeof document !== 'undefined') {
      const alEscape = (evento: KeyboardEvent): void => {
        if (evento.key !== 'Escape') return;
        if (this.cajonAbierto()) {
          evento.preventDefault();
          this.cerrarCajon();
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

    void this.cargarPoblacion();

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

  readonly conteos = computed(() => conteosPorAlcance(this.base()));
  readonly bandas = computed(() => bandasPorAlcance(this.visibles()));
  readonly filasRegion = computed(() =>
    this.ordenRegiones.ordenar(filasPorRegion(this.visibles()), this.accesoresRegiones),
  );

  /**
   * Claves de orden de la tabla de regiones. «Lat/Man» usa una clave compuesta:
   * primero los latentes y, a igualdad, los manifiestos. La tasa llega vacía
   * cuando falta el denominador y esos huecos quedan al final, se ordene como
   * se ordene.
   */
  private readonly accesoresRegiones: Record<string, (fila: FilaRegion) => unknown> = {
    region: (fila) => fila.region,
    situacion: (fila) => [fila.latentes, fila.manifiestos],
    proporcion: (fila) => fila.proporcionLatente,
    total: (fila) => fila.total,
    riesgoAlto: (fila) => fila.riesgoAlto,
  };

  /**
   * Entrada de conflictividad (item 118): los casos visibles antes que el
   * desglose territorial, ordenados por gravedad del riesgo propio y, dentro de
   * cada nivel, por la prioridad de atención (Urgente → Bajo); a igualdad de
   * ambas, por el inicio más antiguo. Los casos sin `fecha_inicio` se declaran y
   * se ordenan al final; no se inventa una fecha.
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

  readonly casosPrioritarios = computed(() => this.casosOrdenados().slice(0, 50));

  /** Orden local de la tabla «Casos priorizados» (independiente de la de regiones). */
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
  readonly sinInicio = computed(() => this.visibles().filter((caso) => !caso.inicio).length);

  /** Región resaltada por el mapa, sólo si sigue teniendo casos visibles. */
  readonly filaSeleccionada = computed<FilaRegion | null>(() => {
    const clave = this.claveSeleccionada();
    if (clave === null) return null;
    return this.filasRegion().find((fila) => normalizarRegion(fila.region) === clave) ?? null;
  });

  /**
   * Casos del cajón «Ver casos»: los de la región seleccionada o, si no hay
   * fila activa, todos los visibles del ámbito vigente. Conserva el orden de
   * gravedad y prioridad del resto de la vista.
   */
  readonly cajonCasos = computed(() =>
    casosDeRegion(this.casosOrdenados(), this.filaSeleccionada()?.region ?? null),
  );

  readonly cajonTerritorio = computed(
    () => this.filaSeleccionada()?.region ?? 'Todas las regiones',
  );

  /** Rótulo del cajón: territorio de la fila y ámbito aplicado. */
  readonly cajonTitulo = computed(
    () => `Casos · ${this.cajonTerritorio()} · ${this.alcanceActivo() ?? 'Todos'}`,
  );

  /** Mismos queryParams que la fila de la tabla, para que el listado coincida. */
  readonly cajonEnlace = computed<Record<string, string>>(() => {
    const fila = this.filaSeleccionada();
    return fila ? this.verCasos(fila) : this.recorteListado();
  });

  readonly regionesConCasos = computed(() => contarRegiones(this.visibles()));
  readonly sinRegion = computed(() => contarSinRegion(this.visibles()));
  readonly riesgoAltoSinRegion = computed(() => contarRiesgoAltoSinRegion(this.visibles()));
  readonly riesgoAlto = computed(() => contarRiesgoAlto(this.visibles()));

  /** Conteo latente/manifiesto de los casos visibles; los sin nivel se declaran. */
  readonly conteoSituacion = computed(() => conteosPorSituacion(this.visibles()));

  /** Mismo conteo para la fila «Sin región» de la tabla de regiones. */
  readonly situacionSinRegion = computed(() =>
    conteosPorSituacion(this.visibles().filter((caso) => regionDe(caso) === null)),
  );

  readonly alcanceTexto = computed(() => this.alcanceActivo() ?? 'Todos los ámbitos');

  /** `generatedAt` de la API, sin segundos. */
  readonly corte = computed(() => {
    const valor = this.panorama.corte();
    return valor ? formatearFechaHora(valor) : null;
  });

  elegirAlcance(alcance: Alcance | null): void {
    // `todos` es la limpieza explícita: `null` dejaría que la preferencia vuelva
    // a imponerse al recargar o al compartir el enlace.
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { alcance: alcance ?? 'todos' },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Recorte común a los enlaces al listado («Ver casos» de la fila y «Abrir
   * listado completo» del cajón): el ámbito bajo el que se contaron los casos y
   * «Abiertos». Cuando no hay ámbito vigente se envía `todos` de forma
   * explícita, porque si se omitiera el listado reaplicaría la preferencia
   * guardada y los números de la fila y del listado dejarían de coincidir.
   */
  private recorteListado(): Record<string, string> {
    return { abiertos: 'true', alcance: this.alcanceActivo() ?? 'todos' };
  }

  /**
   * El enlace de la fila (y «Abrir listado completo» del cajón) abre el listado
   * con el mismo recorte que esta tabla: la región principal de la fila y el
   * ámbito bajo el que se contaron sus casos.
   */
  verCasos(fila: FilaRegion): Record<string, string> {
    return { ...this.recorteListado(), region: fila.region };
  }

  /**
   * La fila «Sin región» usa el complemento `sinregion`, no un nombre de región:
   * no existe en `core.regiones` y el listado lo resuelve como ausencia de
   * región principal.
   */
  verCasosSinRegion(): Record<string, string> {
    return { ...this.recorteListado(), sinregion: 'true' };
  }

  etiquetaAmbitos(ambitos: readonly string[]): string {
    return ambitos.length ? ambitos.join(' · ') : '—';
  }

  esSeleccionada(fila: FilaRegion): boolean {
    const seleccion = this.filaSeleccionada();
    return (
      seleccion !== null && normalizarRegion(seleccion.region) === normalizarRegion(fila.region)
    );
  }

  quitarSeleccion(): void {
    this.claveSeleccionada.set(null);
  }

  cerrarFichaDistrito(): void {
    if (!this.distritoActivo()) return;
    this.distritoActivo.set(null);
    this.distritoSeleccionadoUbigeo = null;
    this.refrescarDistritos(this.casosPorUbigeo());
    this.focoFichaPrevio?.focus?.();
    this.focoFichaPrevio = null;
  }

  alFondoFicha(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarFichaDistrito();
  }

  alTeclaFicha(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(this.ficha()?.nativeElement, evento);
  }

  abrirCajon(evento?: Event): void {
    if (this.cajonAbierto()) return;
    const disparador = evento?.currentTarget;
    this.focoCajonPrevio =
      disparador instanceof HTMLElement
        ? disparador
        : ((document.activeElement as HTMLElement | null) ?? null);
    this.cajonAbierto.set(true);
  }

  cerrarCajon(): void {
    if (!this.cajonAbierto()) return;
    this.cajonAbierto.set(false);
    this.focoCajonPrevio?.focus?.();
    this.focoCajonPrevio = null;
  }

  alFondoCajon(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarCajon();
  }

  alTeclaCajon(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFocoCajon(evento);
  }

  /** Mantiene el tabulador dentro del cajón mientras está abierto. */
  private atraparFocoCajon(evento: KeyboardEvent): void {
    this.atraparFoco(this.cajon()?.nativeElement, evento);
  }

  /** Mantiene el tabulador dentro del panel abierto (cajón o ficha). */
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

  alternarCapaDistritos(): void {
    this.capaDistritosVisible.update((valor) => !valor);
  }

  reintentarDistritos(): void {
    this.claveDistritos = '';
    this.distritosEnCurso = null;
    this.reintentoDistritos.update((valor) => valor + 1);
  }

  /** Enciende/apaga la capa de infraestructuras y pide los puntos la 1.ª vez. */
  alternarCapaInfraestructura(): void {
    const siguiente = !this.capaInfraVisible();
    this.capaInfraVisible.set(siguiente);
    if (siguiente) void this.capas.cargarInfraestructuras();
  }

  /** Enciende/apaga la capa de auditorios y pide la lista la 1.ª vez. */
  alternarCapaAuditorios(): void {
    const siguiente = !this.capaAuditoriosVisible();
    this.capaAuditoriosVisible.set(siguiente);
    if (siguiente) void this.capas.cargarAuditorios();
  }

  elegirFiltroInfra(filtro: 'todos' | TipoInfraestructura): void {
    this.filtroInfra.set(filtro);
  }

  /** El servicio no cachea los fallos: un reintento vuelve a pedir la capa. */
  reintentarInfraestructura(): void {
    void this.capas.cargarInfraestructuras();
  }

  reintentarAuditorios(): void {
    void this.capas.cargarAuditorios();
  }

  /** Porcentaje latente redondeado, para leyenda y tabla («60 %»). */
  porcentajeLatente(proporcion: number): string {
    return `${Math.round(proporcion * 100)} %`;
  }

  /** Color del tramo de `ESCALA_MANIFIESTO` para una proporción latente (0..1). */
  colorManifiesto(proporcion: number): string {
    return ESCALA_MANIFIESTO[claseManifiesto(proporcion)].relleno;
  }

  /**
   * Puntos de infraestructuras en dos grupos: derechos acuícolas (miles, sin
   * interacción y sobre canvas) y sedes (pocas, con tooltip). Construir una vez
   * y alternar grupos evita rehacer 13 456 marcadores al cambiar el filtro.
   */
  private construirInfra(): void {
    const derechos = L.layerGroup();
    const sedes = L.layerGroup();
    const renderer = L.canvas({ padding: 0.3 });

    for (const punto of this.capas.puntosInfra()) {
      if (punto.tipo === 'institucional') {
        L.circleMarker([punto.lat, punto.lon], {
          radius: 4,
          color: '#1d427f',
          weight: 1.6,
          fillColor: '#eaf1fb',
          fillOpacity: 0.95,
        })
          .bindTooltip(this.etiquetaSede(punto), { direction: 'top', sticky: true })
          .addTo(sedes);
        continue;
      }

      L.circleMarker([punto.lat, punto.lon], {
        radius: 2.4,
        color: '#397c79',
        weight: 0,
        fillColor: '#397c79',
        fillOpacity: 0.55,
        interactive: false,
        renderer,
      }).addTo(derechos);
    }

    this.infraDerechos = derechos;
    this.infraSedes = sedes;
  }

  /**
   * Auditorios agrupados por distrito: un marcador por centroide, rotulado con
   * el nombre del distrito y cuántos auditorios contiene. La precisión es
   * «distrito», nunca la puerta del local.
   */
  private construirAuditorios(): void {
    const grupo = L.layerGroup();
    const porDistrito = new Map<
      string,
      { nombre: string; lat: number; lon: number; total: number }
    >();

    for (const auditorio of this.capas.auditorios()) {
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

    this.capaAuditorios = grupo;
  }

  private etiquetaSede(punto: PuntoInfraestructura): string {
    const nombre = punto.nombreInfraestructura ?? 'Sede institucional';
    const institucion = punto.identi ?? 'Sin IDENTI';
    const distrito = punto.distrito ?? 'distrito sin declarar';
    return `${nombre} · ${institucion} · ${distrito}`;
  }

  private alternarGrupo(mapa: L.Map, grupo: L.LayerGroup | null, visible: boolean): void {
    if (!grupo) return;
    if (visible) {
      if (!mapa.hasLayer(grupo)) grupo.addTo(mapa);
    } else if (mapa.hasLayer(grupo)) {
      grupo.remove();
    }
  }

  fechaInicio(valor: string | null): string {
    return formatearFechaCorta(valor);
  }

  recargar(): void {
    this.panorama.recargar();
  }

  private seleccionarRegion(region: string): void {
    this.claveSeleccionada.set(normalizarRegion(region));
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

    // La capa distrital vive en un panel propio por debajo del `overlayPane`:
    // así los círculos por región conservan sus clics y su relieve sobre el
    // relleno, aunque los polígonos se añadan después.
    mapa.createPane('distritos');
    const panelDistritos = mapa.getPane('distritos');
    if (panelDistritos) panelDistritos.style.zIndex = '390';

    mapa.fitBounds(LIMITES_PERU, { padding: [12, 12] });
    this.mapa = mapa;
    this.versionMapa.update((version) => version + 1);
  }

  private desmontarMapa(): void {
    this.capasRegion.clear();
    this.capaDistritos = null;
    this.claveDistritos = '';
    this.distritosEnCurso = null;
    this.distritoSeleccionadoUbigeo = null;
    this.infraDerechos = null;
    this.infraSedes = null;
    this.capaAuditorios = null;
    const mapa = this.mapa;
    this.mapa = null;
    mapa?.remove();
  }

  /**
   * Denominadores por región. Se piden una vez y se indexan por nombre
   * normalizado; un fallo deja las tasas en «—» sin inventar población.
   */
  private async cargarPoblacion(): Promise<void> {
    try {
      const porClave = await this.territorio.poblacionPorRegion();
      this.poblacionIndice.set(indicePoblacionPorRegion([...porClave.values()]));
    } catch {
      this.poblacionIndice.set(null);
    }
  }

  /**
   * Pide la capa distrital una vez por ámbito: nacional al montar y acotada a la
   * región cuando hay una fila seleccionada. El servicio cachea por región.
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
      // la capa no se dibuja y los círculos por región siguen intactos.
      this.claveDistritos = '';
      this.quitarCapaDistritos();
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
    if (this.capaDistritosVisible()) capa.addTo(mapa);

    const limites = capa.getBounds();
    if (region !== null && limites.isValid()) {
      mapa.fitBounds(limites, { padding: [10, 10] });
    }
  }

  private quitarCapaDistritos(): void {
    this.capaDistritos?.remove();
    this.capaDistritos = null;
  }

  private aplicarVisibilidadDistritos(mapa: L.Map, visible: boolean): void {
    const capa = this.capaDistritos;
    if (!capa) return;
    if (visible) {
      if (!mapa.hasLayer(capa)) capa.addTo(mapa);
    } else if (mapa.hasLayer(capa)) {
      capa.remove();
    }
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

  private sincronizarCirculos(filas: readonly FilaRegion[], seleccion: string | null): void {
    const mapa = this.mapa;
    if (!mapa) return;

    const maximo = filas.reduce((tope, fila) => Math.max(tope, fila.total), 0);
    const vigentes = new Set<string>();

    for (const fila of filas) {
      const coordenada = coordenadaDeRegion(fila.region);
      if (!coordenada) continue; // Sin centroide conocido no se ubica: no se inventa.

      const clave = normalizarRegion(fila.region);
      const activa = clave === seleccion;
      const radio = radioCirculo(fila.total, maximo);
      const estilo = estiloCirculo(fila, activa);
      vigentes.add(clave);

      const existente = this.capasRegion.get(clave);
      if (existente) {
        existente.setLatLng(coordenada);
        existente.setRadius(radio);
        existente.setStyle(estilo);
        existente.setTooltipContent(etiquetaCirculo(fila));
        if (activa) existente.bringToFront();
        continue;
      }

      const capa = L.circleMarker(coordenada, { ...estilo, radius: radio })
        .addTo(mapa)
        .bindTooltip(etiquetaCirculo(fila), { direction: 'top', offset: [0, -4] })
        .on('click', () => this.seleccionarRegion(fila.region));

      this.capasRegion.set(clave, capa);
    }

    for (const [clave, capa] of this.capasRegion) {
      if (vigentes.has(clave)) continue;
      capa.remove();
      this.capasRegion.delete(clave);
    }
  }
}
