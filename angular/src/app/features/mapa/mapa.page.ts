import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { AlcanceService, esAlcance } from '../../core/alcance/alcance.service';
import { SesionStore } from '../../core/auth/sesion.store';
import { formatearFechaHora } from '../../shared/formato-fecha';
import { IconoComponent } from '../../shared/ui/icono.component';
import type { Alcance, Caso } from '../../dominio/modelos';
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

/**
 * Panorama territorial (ventana principal de la aplicación).
 *
 * Distribuye los casos abiertos reales por ámbito y región. No dibuja un mapa:
 * el dataset ubigeo/centroide está aplazado, así que el esquema usa bandas y
 * chips, con el tamaño y el orden derivados del conteo y nunca de coordenadas.
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

  recargar(): void {
    this.panorama.recargar();
  }
}
