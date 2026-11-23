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
import { map } from 'rxjs';

import { AlcanceService, esAlcance } from '../../core/alcance/alcance.service';
import { SesionStore } from '../../core/auth/sesion.store';
import { formatearFechaHora } from '../../shared/formato-fecha';
import { IconoComponent } from '../../shared/ui/icono.component';
import type { Alcance, Caso } from '../../dominio/modelos';
import { coordenadaDeRegion } from './centroides.regiones';
import {
  ambitosSinRegion,
  bandasPorAlcance,
  conteosPorAlcance,
  contarRegiones,
  contarRiesgoAlto,
  contarRiesgoAltoSinRegion,
  contarSinRegion,
  filasPorRegion,
  normalizarRegion,
  regionDe,
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

const ESTILO_CIRCULO: L.PathOptions = {
  color: '#1d4b86',
  weight: 1.5,
  fillColor: '#2455a2',
  fillOpacity: 0.3,
};

const ESTILO_CIRCULO_ACTIVO: L.PathOptions = {
  color: '#173f73',
  weight: 2.5,
  fillColor: '#2455a2',
  fillOpacity: 0.55,
};

function radioCirculo(total: number, maximo: number): number {
  if (maximo <= 1) return RADIO_MIN;
  const proporcion = Math.sqrt((Math.max(1, total) - 1) / (maximo - 1));
  return RADIO_MIN + (RADIO_MAX - RADIO_MIN) * proporcion;
}

function etiquetaCirculo(fila: FilaRegion): string {
  return `${fila.region} · ${fila.total} ${fila.total === 1 ? 'caso' : 'casos'}`;
}

/**
 * Panorama territorial (ventana principal de la aplicación).
 *
 * Distribuye los casos abiertos reales por ámbito y región. El esquema usa
 * bandas, chips y una tabla derivados del conteo, y suma un mapa referencial de
 * OpenStreetMap: cada región con casos visibles se ubica en su centroide
 * referencial (`centroides.regiones.ts`). El ubigeo distrital y los límites
 * administrativos siguen aplazados, así que el mapa es una referencia y no una
 * capa institucional.
 *
 * El recorte por `usuario().regiones` es de presentación: hoy la RLS entrega el
 * conjunto completo y `lib/db/scope.ts` documenta que el bloqueo por territorio
 * aún no existe. Si la sesión trae regiones, la vista se acota a ellas y no cae
 * al conjunto nacional cuando no hay coincidencias.
 */
@Component({
  selector: 'app-mapa',
  imports: [RouterLink, IconoComponent],
  templateUrl: './mapa.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PanoramaService],
  styles: `
    :host {
      display: block;
    }

    .view-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 10.5px;
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
      font-size: 9.5px;
      font-weight: 700;
    }

    .ambito-chips {
      flex-wrap: wrap;
    }

    .chip-count {
      margin-left: 4px;
      padding: 0 5px;
      border-radius: 999px;
      background: rgba(100, 116, 135, 0.14);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }

    .segmented > button[aria-pressed='true'] .chip-count {
      background: rgba(29, 75, 134, 0.14);
    }

    .panel {
      padding: 17px;
    }

    .panel-nota {
      margin: 10px 0 0;
      color: var(--amber);
      font-size: 10px;
      line-height: 1.5;
    }

    .panel-vacio {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.5;
    }

    .estado-carga {
      margin: 0;
      padding: 22px 2px;
      color: var(--muted);
      font-size: 11px;
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
      font-size: 11px;
      line-height: 1.5;
    }

    .vacio {
      padding: 22px;
    }

    .vacio h3 {
      margin: 0 0 6px;
      color: var(--ink);
      font: 700 13px/1.35 var(--font-display);
    }

    .vacio p {
      margin: 0;
      color: var(--muted);
      font-size: 10.5px;
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
      font: 700 12px/1.3 var(--font-display);
    }

    .ambito-total {
      color: var(--muted);
      font-size: 10px;
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
      font-size: 9.5px;
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
      font-size: 9.5px;
      line-height: 1.5;
    }

    .mapa-cabeza {
      flex-wrap: wrap;
    }

    .mapa-rotulo {
      display: inline-flex;
      align-items: center;
      margin: 9px 0 0;
      padding: 2px 8px;
      border: 1px dashed var(--line);
      border-radius: 999px;
      color: var(--ink-2);
      font-size: 9.5px;
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
      font-size: 9.5px;
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

    @media (max-width: 760px) {
      .executive-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
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
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionStore);
  private readonly alcanceService = inject(AlcanceService);
  private readonly panorama = inject(PanoramaService);
  private readonly destruccion = inject(DestroyRef);

  private readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');

  /** Clave normalizada de la región seleccionada en el mapa. */
  private readonly claveSeleccionada = signal<string | null>(null);
  /** Cambia en cada montaje para redibujar los círculos sobre el mapa nuevo. */
  private readonly versionMapa = signal(0);

  private mapa: L.Map | null = null;
  private readonly capasRegion = new Map<string, L.CircleMarker>();

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

  /** Casos abiertos ya acotados a las regiones de la sesión, sin filtro de ámbito. */
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
  readonly filasRegion = computed(() => filasPorRegion(this.visibles()));

  /** Región resaltada por el mapa, sólo si sigue teniendo casos visibles. */
  readonly filaSeleccionada = computed<FilaRegion | null>(() => {
    const clave = this.claveSeleccionada();
    if (clave === null) return null;
    return this.filasRegion().find((fila) => normalizarRegion(fila.region) === clave) ?? null;
  });

  readonly regionesConCasos = computed(() => contarRegiones(this.visibles()));
  readonly sinRegion = computed(() => contarSinRegion(this.visibles()));
  readonly riesgoAltoSinRegion = computed(() => contarRiesgoAltoSinRegion(this.visibles()));
  readonly riesgoAlto = computed(() => contarRiesgoAlto(this.visibles()));
  readonly alcancesSinRegion = computed(() => ambitosSinRegion(this.visibles()));

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

  /** El listado de Casos no filtra por región; se conserva «abiertos» y el ámbito. */
  verCasos(fila: FilaRegion): Record<string, string> {
    return fila.ambitos.length === 1
      ? { abiertos: 'true', alcance: fila.ambitos[0] }
      : { abiertos: 'true' };
  }

  etiquetaAmbitos(ambitos: readonly Alcance[]): string {
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

    mapa.fitBounds(LIMITES_PERU, { padding: [12, 12] });
    this.mapa = mapa;
    this.versionMapa.update((version) => version + 1);
  }

  private desmontarMapa(): void {
    this.capasRegion.clear();
    const mapa = this.mapa;
    this.mapa = null;
    mapa?.remove();
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
      const estilo = activa ? ESTILO_CIRCULO_ACTIVO : ESTILO_CIRCULO;
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
