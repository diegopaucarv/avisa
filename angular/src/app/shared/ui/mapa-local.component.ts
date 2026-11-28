import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as L from 'leaflet';

import { centroideDeRegion } from './mapa-local.centroides';

/**
 * Coordenada `{ lat, lng }` que consume `app-mapa-local`. Se declara aquí (y no
 * se importa del dominio del directorio) para que el componente de `shared/ui`
 * no dependa de una feature; el objeto de `local.mapeo.ts` es compatible por
 * estructura.
 */
export type CoordenadasMapaLocal = { lat: number; lng: number };

/** Teselas públicas de OpenStreetMap: el mapa es referencial, no oficial. */
const TESELAS_OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * Radio del círculo de aproximación regional, en metros. Es una referencia
 * visual, no un área real del local: el local no tiene coordenadas y la ficha
 * nunca debe sugerir precisión que la base no registra.
 */
const RADIO_APROXIMACION = 60_000;

/** Nota obligatoria cuando sólo se conoce la región. */
const NOTA_APROXIMADA =
  'Ubicación aproximada por región; el local no tiene coordenadas registradas.';

/**
 * Mapa de ubicación de un local (Leaflet).
 *
 * - Con coordenadas pinta un marcador exacto y centra ahí.
 * - Sin coordenadas centra en el centroide de la región con un círculo de
 *   aproximación y una nota explícita; nunca simula una ubicación precisa.
 * - Sin coordenadas ni región no dibuja mapa: no hay nada que ubicar.
 *
 * Leaflet necesita un navegador y el contenedor ya en el DOM: la inicialización
 * se guarda tras `isPlatformBrowser` y el mapa se destruye en `ngOnDestroy`
 * (vía `DestroyRef`) y al desaparecer el contenedor. El contenedor tiene alto
 * fijo y `isolation: isolate`, para que los `z-index` internos de Leaflet no
 * tapen los modales de la aplicación.
 */
@Component({
  selector: 'app-mapa-local',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hayMapa()) {
      <div
        #lienzo
        class="mapa-local-lienzo"
        role="application"
        [attr.aria-label]="etiquetaMapa()"
      ></div>
    }
    @if (nota(); as aviso) {
      <p class="mapa-local-nota" role="note">{{ aviso }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      margin-top: 8px;
    }

    /*
     * 'isolation' crea un contexto de apilamiento propio: los controles y paneles
     * de Leaflet (hasta z-index 1000) quedan contenidos y no pueden quedar por
     * encima de los modales del resto de la aplicación, que viven fuera de la
     * ficha. El alto es fijo para que el panel lateral estrecho no se desborde.
     */
    .mapa-local-lienzo {
      position: relative;
      isolation: isolate;
      z-index: 0;
      width: 100%;
      height: 220px;
      overflow: hidden;
      border: 1px solid #e6ecf1;
      border-radius: 8px;
      background: #f6f8fa;
    }

    .mapa-local-nota {
      margin: 6px 0 0;
      color: #8d99a6;
      font-size: 12.5px;
      line-height: 1.5;
    }
  `,
})
export class MapaLocalComponent {
  private readonly plataforma = inject(PLATFORM_ID);
  private readonly destruccion = inject(DestroyRef);

  /** Nombre del local, para el tooltip y la etiqueta accesible del mapa. */
  readonly nombre = input('');
  /** Coordenadas exactas si existen; `null` fuerza el modo aproximado por región. */
  readonly coordenadas = input<CoordenadasMapaLocal | null>(null);
  /** Región del local, para el centroide de aproximación. */
  readonly region = input<string | null>(null);

  private readonly lienzo = viewChild<ElementRef<HTMLElement>>('lienzo');
  private mapa: L.Map | null = null;
  private grupo: L.LayerGroup | null = null;

  /** Se incrementa al montar para que el efecto de dibujo pinte sin recrear teselas. */
  private readonly version = signal(0);

  readonly centroide = computed(() => centroideDeRegion(this.region()));

  readonly hayMapa = computed(() => this.coordenadas() !== null || this.centroide() !== null);

  readonly nota = computed(() => {
    if (this.coordenadas()) return null;
    if (this.centroide()) return NOTA_APROXIMADA;
    return 'El local no tiene coordenadas ni una región registrada; no se puede ubicar en el mapa.';
  });

  readonly etiquetaMapa = computed(() => {
    const nombre = this.nombre() || 'el local';
    if (this.coordenadas()) return `Mapa con la ubicación de ${nombre}`;
    const region = this.region();
    return region
      ? `Mapa con la ubicación aproximada de ${nombre} en ${region}`
      : `Mapa con la ubicación aproximada de ${nombre}`;
  });

  constructor() {
    // Montar sólo cuando el contenedor existe y hay navegador. El `onCleanup`
    // desmonta el mapa si el contenedor desaparece (local sin coordenadas ni
    // región) y evita fugas al cerrar la ficha.
    effect((onCleanup) => {
      const contenedor = this.lienzo()?.nativeElement;
      if (!contenedor || !isPlatformBrowser(this.plataforma)) return;

      this.montar(contenedor);
      onCleanup(() => this.desmontar());
    });

    // Redibuja el punto al cambiar de local sin recrear el mapa ni sus teselas.
    effect(() => {
      this.version();
      this.coordenadas();
      this.centroide();
      this.dibujar();
    });

    this.destruccion.onDestroy(() => this.desmontar());
  }

  private montar(contenedor: HTMLElement): void {
    if (this.mapa) return;

    const mapa = L.map(contenedor, {
      scrollWheelZoom: false,
      zoomControl: true,
      minZoom: 3,
      maxZoom: 17,
    });

    L.tileLayer(TESELAS_OSM, {
      maxZoom: 19,
      attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
    }).addTo(mapa);

    this.grupo = L.layerGroup().addTo(mapa);
    this.mapa = mapa;

    // El panel lateral se abre con animación: su ancho real llega un instante
    // después y Leaflet necesita recalcular el tamaño de las teselas. Se comprueba
    // que el mapa siga siendo el vigente por si la ficha se cerró entre medias.
    mapa.whenReady(() => {
      if (this.mapa === mapa) mapa.invalidateSize();
    });
    setTimeout(() => {
      if (this.mapa === mapa) mapa.invalidateSize();
    }, 0);

    this.version.update((valor) => valor + 1);
  }

  private dibujar(): void {
    const mapa = this.mapa;
    const grupo = this.grupo;
    if (!mapa || !grupo) return;

    grupo.clearLayers();

    const coordenadas = this.coordenadas();
    if (coordenadas) {
      L.circleMarker([coordenadas.lat, coordenadas.lng], {
        radius: 8,
        color: '#1d427f',
        weight: 2,
        fillColor: '#2f6fb0',
        fillOpacity: 0.9,
      })
        .bindTooltip(this.nombre() || 'Local')
        .addTo(grupo);

      mapa.setView([coordenadas.lat, coordenadas.lng], 15);
      mapa.invalidateSize();
      return;
    }

    const centroide = this.centroide();
    if (!centroide) return;

    L.circle([centroide.lat, centroide.lng], {
      radius: RADIO_APROXIMACION,
      color: '#2f5d86',
      weight: 1.5,
      fillColor: '#2f5d86',
      fillOpacity: 0.12,
    })
      .bindTooltip(`Aproximación regional · ${this.region() ?? ''}`.trim())
      .addTo(grupo);

    L.circleMarker([centroide.lat, centroide.lng], {
      radius: 5,
      color: '#2f5d86',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 0.95,
    }).addTo(grupo);

    mapa.setView([centroide.lat, centroide.lng], 7);
    mapa.invalidateSize();
  }

  private desmontar(): void {
    const mapa = this.mapa;
    this.mapa = null;
    this.grupo = null;
    mapa?.remove();
  }
}
