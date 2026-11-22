import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import {
  paramsDePagina,
  normalizarColeccion,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta, type Consulta } from '../../core/http/consulta';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { aAlerta, formatearPlazo, type Alerta } from '../alertas/alerta.mapeo';
import {
  aCompromiso,
  formatearFecha,
  resolverVencimiento,
  situacionDe,
  type Compromiso,
  type ResolucionVencimiento,
  type Situacion,
} from '../compromisos/compromiso.mapeo';
import { HORIZONTE_POR_VENCER_DIAS, aSinCasoTotal, aTotal, rangoPorVencer } from './resumen.mapeo';

type Indicador = {
  clave: string;
  etiqueta: string;
  detalle: string;
  icono: string;
  /** Sufijo de `stat-icon` (`amber`, `red`, `green`); vacío usa el azul base. */
  color: string;
  ruta: string;
  texto: string;
  disponible: boolean;
};

/**
 * Resumen operativo.
 *
 * Cuatro indicadores, cada uno con su propia consulta, de modo que un endpoint
 * caído sólo marca «No disponible» en su tarjeta. Nada que la API no reporte se
 * completa con ceros ni con datos de ejemplo.
 */
@Component({
  selector: 'app-resumen',
  imports: [RouterLink, IconoComponent, ExportarMenuComponent],
  templateUrl: './resumen.page.html',
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

    a.stat-card {
      color: inherit;
      text-decoration: none;
    }

    a.stat-card:hover {
      border-color: #cdd9e6;
    }

    .stat-copy > strong.kpi-sin-dato {
      font-size: 12px;
      color: #8b97a2;
    }

    .panel {
      padding: 17px;
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

    .panel-nota,
    .panel-vacio {
      margin: 10px 0 0;
      font-size: 10px;
      line-height: 1.5;
    }

    .panel-nota {
      color: #8b5a54;
    }

    .panel-vacio {
      color: #909ba4;
    }

    .panel-pie {
      margin: 9px 0 0;
      color: #9aa5ae;
      font-size: 9px;
      line-height: 1.5;
    }

    @media (max-width: 760px) {
      .view-body {
        padding: 18px 16px 40px;
      }
      .executive-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .overview-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ResumenPage {
  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /* ------------------------------------------------------------------ *
   * Indicadores: un `total` por endpoint, sin traer filas
   * ------------------------------------------------------------------ */

  private readonly kpiCasos = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        estado: 'Activo',
      }),
    esquema: aTotal,
  });

  private readonly kpiAlertas = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        estado: 'Pendiente de revisión',
      }),
    esquema: aTotal,
  });

  private readonly kpiCompromisos = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        estado: 'En proceso',
      }),
    esquema: aTotal,
  });

  private readonly kpiDemandas = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/demandas'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        sinCaso: 'true',
      }),
    esquema: aSinCasoTotal,
  });

  readonly indicadores = computed<Indicador[]>(() => [
    this.indicador(
      'casos',
      'Casos activos',
      'Casos con estado Activo',
      'casos',
      '',
      '/casos',
      this.kpiCasos,
    ),
    this.indicador(
      'alertas',
      'Alertas pendientes',
      'En espera de revisión',
      'alertas',
      'red',
      '/alertas',
      this.kpiAlertas,
    ),
    this.indicador(
      'compromisos',
      'Compromisos en proceso',
      'Abiertos y en ejecución',
      'compromisos',
      'green',
      '/compromisos',
      this.kpiCompromisos,
    ),
    this.indicador(
      'demandas',
      'Demandas sin caso',
      'Pendientes de vincular',
      'bandeja',
      'amber',
      '/casos/sin-caso',
      this.kpiDemandas,
    ),
  ]);

  /* ------------------------------------------------------------------ *
   * Listas breves de trabajo
   * ------------------------------------------------------------------ */

  private readonly recursoAlertas = consulta<Coleccion<Alerta>>({
    fuente: () =>
      urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: 1, tamano: 5 }),
        sort: 'recent',
      }),
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aAlerta) };
    },
  });

  readonly alertas = computed(() => this.recursoAlertas.valor()?.elementos ?? []);
  readonly estadoAlertas = this.recursoAlertas.estado;
  readonly errorAlertas = this.recursoAlertas.error;

  /** Días del horizonte que anuncia el bloque y que se envía al servidor. */
  readonly horizonteDias = HORIZONTE_POR_VENCER_DIAS;

  /**
   * El listado aplica el rango en el servidor (`vencimiento_desde` hoy,
   * `vencimiento_hasta` hoy + horizonte) sobre el vencimiento efectivo y ordena
   * por esa fecha de forma ascendente. El `total` del sobre cuenta la cola
   * completa y la página trae sólo las cinco más próximas.
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
   * Helpers de plantilla
   * ------------------------------------------------------------------ */

  fecha(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  plazo(horas: number | null): string {
    return formatearPlazo(horas);
  }

  situacion(compromiso: Compromiso): Situacion {
    return situacionDe(compromiso);
  }

  vencimiento(compromiso: Compromiso): ResolucionVencimiento {
    return resolverVencimiento(compromiso);
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  recargar(): void {
    this.kpiCasos.recargar();
    this.kpiAlertas.recargar();
    this.kpiCompromisos.recargar();
    this.kpiDemandas.recargar();
    this.recursoAlertas.recargar();
    this.recursoCompromisos.recargar();
  }

  private indicador(
    clave: string,
    etiqueta: string,
    detalle: string,
    icono: string,
    color: string,
    ruta: string,
    recurso: Consulta<number>,
  ): Indicador {
    const estado = recurso.estado();
    const valor = recurso.valor();

    return {
      clave,
      etiqueta,
      detalle,
      icono,
      color,
      ruta,
      texto: estado === 'error' ? 'No disponible' : valor === undefined ? '…' : String(valor),
      disponible: estado !== 'error',
    };
  }
}
