import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import {
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { aAlerta, formatearPlazo, type Alerta } from '../alertas/alerta.mapeo';
import {
  aColeccionDemandas,
  claseEstadoDemanda,
  formatearFecha as formatearFechaDemanda,
  type ColeccionDemandas,
  type EstadoDemanda,
} from '../casos/demanda-sin-caso.mapeo';
import {
  aCompromiso,
  formatearFecha,
  resolverVencimiento,
  situacionDe,
  type Compromiso,
  type ResolucionVencimiento,
  type Situacion,
} from '../compromisos/compromiso.mapeo';
import { HORIZONTE_POR_VENCER_DIAS, rangoPorVencer } from '../resumen/resumen.mapeo';

/**
 * Bandeja de trabajo.
 *
 * Reúne en una sola vista lo que exige atención. Cada bloque consulta su propio
 * endpoint paginado con un tamaño pequeño, lleva su estado de carga y error, y
 * enlaza a la pantalla completa. No repite la lógica de esas pantallas: sólo
 * reutiliza sus mapeos.
 */
@Component({
  selector: 'app-bandeja',
  imports: [RouterLink, IconoComponent, ExportarMenuComponent],
  templateUrl: './bandeja.page.html',
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

    .view-head h1 {
      margin: 0;
      color: #1a2b3e;
      font: 700 22px/1.3 var(--font-display);
      letter-spacing: -0.65px;
    }

    .view-subtitle {
      max-width: 760px;
      margin: 6px 0 0;
      color: #7b8896;
      font-size: 11px;
      line-height: 1.6;
    }

    .bloque {
      padding: 17px;
    }

    .bloque-titulo {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .bloque-titulo app-icono {
      color: #5b7290;
    }

    .tarea-lista {
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
    }

    .tarea {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 0;
      border-top: 1px solid #f0f2f4;
    }

    .tarea:first-child {
      border-top: 0;
      padding-top: 4px;
    }

    .tarea-principal {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .tarea-titulo {
      color: #33465a;
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.45;
    }

    .tarea-texto {
      color: #748391;
      font-size: 10px;
      line-height: 1.5;
    }

    .tarea-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      color: #8b97a2;
      font-size: 9px;
    }

    .tarea-codigo {
      flex: none;
      color: #7f8c98;
      font-size: 9px;
      font-weight: 600;
      white-space: nowrap;
    }

    .bloque-nota,
    .bloque-vacio {
      margin: 10px 0 0;
      font-size: 10px;
      line-height: 1.5;
    }

    .bloque-nota {
      color: #8b5a54;
    }

    .bloque-vacio {
      color: #909ba4;
    }

    .bloque-pie {
      margin: 9px 0 0;
      color: #9aa5ae;
      font-size: 9px;
      line-height: 1.5;
    }

    @media (max-width: 760px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class BandejaPage {
  /* ------------------------------------------------------------------ *
   * Alertas pendientes
   * ------------------------------------------------------------------ */

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  private readonly recursoAlertas = consulta<Coleccion<Alerta>>({
    fuente: () =>
      urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: 1, tamano: 5 }),
        estado: 'Pendiente de revisión',
        sort: 'recent',
      }),
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aAlerta) };
    },
  });

  readonly alertas = computed(() => this.recursoAlertas.valor()?.elementos ?? []);
  readonly totalAlertas = computed(() => this.recursoAlertas.valor()?.total ?? 0);
  readonly estadoAlertas = this.recursoAlertas.estado;
  readonly errorAlertas = this.recursoAlertas.error;

  /* ------------------------------------------------------------------ *
   * Compromisos por vencer
   * ------------------------------------------------------------------ */

  /** Días del horizonte que anuncia el bloque y que se envía al servidor. */
  readonly horizonteDias = HORIZONTE_POR_VENCER_DIAS;

  /**
   * El rango de vencimiento se resuelve en el servidor (`vencimiento_desde`
   * hoy, `vencimiento_hasta` hoy + horizonte), que lo aplica sobre el
   * vencimiento efectivo y ordena por esa misma fecha de forma ascendente. El
   * `total` del sobre es el recuento exacto de la cola y la página trae sólo
   * las cinco filas más próximas.
   */
  private readonly recursoCompromisos = consulta<Coleccion<Compromiso>>({
    fuente: () => {
      const rango = rangoPorVencer();
      return urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: 1, tamano: 5 }),
        vencimiento_desde: rango.desde,
        vencimiento_hasta: rango.hasta,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aCompromiso) };
    },
  });

  readonly compromisos = computed(() => this.recursoCompromisos.valor()?.elementos ?? []);
  readonly totalCompromisos = computed(() => this.recursoCompromisos.valor()?.total ?? 0);
  readonly estadoCompromisos = this.recursoCompromisos.estado;
  readonly errorCompromisos = this.recursoCompromisos.error;

  /* ------------------------------------------------------------------ *
   * Demandas sin caso
   * ------------------------------------------------------------------ */

  private readonly recursoDemandas = consulta<ColeccionDemandas>({
    fuente: () =>
      urlConParametros(urlApi('/v1/demandas'), {
        ...paramsDePagina({ pagina: 1, tamano: 5 }),
        sinCaso: 'true',
        sort: 'recent',
      }),
    esquema: aColeccionDemandas,
  });

  readonly demandas = computed(() => this.recursoDemandas.valor()?.elementos ?? []);
  readonly totalDemandas = computed(() => this.recursoDemandas.valor()?.sinCasoTotal ?? 0);
  readonly estadoDemandas = this.recursoDemandas.estado;
  readonly errorDemandas = this.recursoDemandas.error;

  /* ------------------------------------------------------------------ *
   * Helpers de plantilla
   * ------------------------------------------------------------------ */

  plazo(horas: number | null): string {
    return formatearPlazo(horas);
  }

  fecha(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  fechaDemanda(valor: string | null | undefined): string {
    return formatearFechaDemanda(valor);
  }

  situacion(compromiso: Compromiso): Situacion {
    return situacionDe(compromiso);
  }

  vencimiento(compromiso: Compromiso): ResolucionVencimiento {
    return resolverVencimiento(compromiso);
  }

  claseDemanda(estado: EstadoDemanda): string {
    return claseEstadoDemanda(estado);
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  recargar(): void {
    this.recursoAlertas.recargar();
    this.recursoCompromisos.recargar();
    this.recursoDemandas.recargar();
  }
}
