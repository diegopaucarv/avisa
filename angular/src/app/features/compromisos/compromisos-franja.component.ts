import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import { urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  aEstadisticasCompromisos,
  type EstadisticaArea,
  type EstadisticasCompromisos,
} from './estadisticas-compromisos';

/**
 * Filtros de la lista que se limpian al enlazar desde una cifra global. La
 * búsqueda, el tipo, la mesa y los demás recortes de la URL no participan del
 * agregado, así que se descartan para que la lista de destino muestre el mismo
 * conjunto que se está contando.
 */
const SIN_FILTROS = {
  q: null,
  estado: null,
  tipo: null,
  mesa: null,
  nivelGobierno: null,
  atiendeGenero: null,
  unidad: null,
  vencidos: null,
  pagina: null,
} as const;

/**
 * Franja de estadísticas de Compromisos, arriba de la tabla.
 *
 * Lee `GET /api/v1/commitments/estadisticas` con una petición propia: la tabla
 * está paginada, así que sumar la página visible daría cifras falsas. El sobre
 * ya viene agregado y con el ranking de oficinas, de modo que aquí sólo se
 * pinta; no se recalcula nada en el cliente.
 *
 * Cada tarjeta que tiene un filtro equivalente en la lista enlaza a esa lista
 * con el parámetro aplicado (`estado` o `vencidos`), y cada oficina del ranking
 * enlaza con `unidad=<siglas>`. Cuando no hay un filtro que mida lo mismo —el
 * caso de «Vencidos», que aquí cuenta compromisos con algún hito vencido sin
 * cumplir y la tabla mide el vencimiento efectivo— se muestra el dato sin
 * enlace para no prometer una lista que no coincide.
 */
@Component({
  selector: 'app-compromisos-franja',
  imports: [RouterLink, IconoComponent],
  templateUrl: './compromisos-franja.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .franja {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 14px;
    }

    .franja-cabecera {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 10px;
    }

    .franja-cabecera h2 {
      margin: 0;
      font: 700 13.5px/1.2 var(--font-display);
      color: #23384d;
    }

    .franja-cabecera p {
      margin: 0;
      color: #8995a0;
      font-size: 11.5px;
    }

    /*
     * Cuatro tarjetas compactas en una fila. Se reutiliza el idioma global de
     * los KPIs (.executive-kpis / .stat-card) y sólo se recorta la altura: la
     * franja vive entre la barra de filtros y la tabla, sin empujar el listado
     * una banda entera.
     */
    .executive-kpis.franja-kpis {
      margin: 0;
      gap: 8px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .franja-card {
      min-height: 0;
      padding: 9px 11px;
      align-items: center;
      gap: 8px;
      color: inherit;
      text-decoration: none;
    }

    a.franja-card:hover {
      border-color: #c9d6e2;
      background: #fbfcfe;
    }

    a.franja-card:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 2px;
    }

    .franja-card .stat-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
    }

    .franja-card .stat-copy {
      gap: 0;
    }

    .franja-card .stat-copy > span {
      font-size: 11.5px;
      line-height: 1.2;
    }

    .franja-card .stat-copy > strong {
      font-size: 19px;
    }

    .franja-ranking {
      padding: 11px 13px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .franja-ranking h3 {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 6px 10px;
      margin: 0 0 7px;
      font: 700 12.5px/1.2 var(--font-display);
      color: #23384d;
    }

    .franja-quitar {
      color: #446b9c;
      font-size: 11.5px;
      font-weight: 600;
      text-decoration: none;
    }

    .franja-quitar:hover {
      text-decoration: underline;
    }

    .franja-lista {
      display: grid;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .franja-area {
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr) auto 84px 42px;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 6px;
      color: inherit;
      font-size: 12.5px;
      text-decoration: none;
    }

    a.franja-area:hover {
      background: #f4f7fa;
    }

    a.franja-area:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 1px;
    }

    .franja-area-activa {
      background: var(--blue-pale);
    }

    .franja-area-siglas {
      overflow: hidden;
      color: #33475b;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .franja-area-nombre {
      overflow: hidden;
      color: #7c8b98;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .franja-area-total {
      color: #23384d;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .franja-area-barra {
      display: block;
      height: 6px;
      overflow: hidden;
      border-radius: 4px;
      background: #eef1f4;
    }

    .franja-area-barra i {
      display: block;
      height: 100%;
      border-radius: 4px;
      background: var(--green);
    }

    .franja-area-pct {
      color: #526577;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .franja-vacio,
    .franja-nota {
      margin: 0;
      color: #8995a0;
      font-size: 11.5px;
    }

    .franja-nota {
      margin-top: 6px;
    }

    .franja-aviso {
      margin: 0;
      padding: 8px 11px;
      border: 1px solid var(--red-pale);
      border-radius: 8px;
      background: #fdf6f5;
      color: #a3402f;
      font-size: 12.5px;
    }

    @media (max-width: 980px) {
      .executive-kpis.franja-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      .franja-area {
        grid-template-columns: 58px minmax(0, 1fr) auto 42px;
      }

      .franja-area-barra {
        display: none;
      }
    }
  `,
})
export class CompromisosFranjaComponent {
  /** El modo mesas acota el listado; la franja debe medir el mismo recorte. */
  readonly soloMesas = input(false);

  /** Siglas de la oficina filtrada en la lista, para marcarla en el ranking. */
  readonly unidadActiva = input('');

  private readonly recurso = consulta<EstadisticasCompromisos>({
    fuente: () =>
      urlConParametros(urlApi('/v1/commitments/estadisticas'), {
        soloMesas: this.soloMesas() ? '1' : '',
      }),
    esquema: aEstadisticasCompromisos,
  });

  readonly datos = this.recurso.valor;
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;

  readonly cargando = computed(() => this.estado() === 'inactivo' || this.estado() === 'cargando');

  /** Top 5 de oficinas por cantidad; la API ya devuelve el orden resuelto. */
  readonly ranking = computed(() => (this.datos()?.porArea ?? []).slice(0, 5));

  readonly filtroTotal = SIN_FILTROS;
  readonly filtroCumplidos = { ...SIN_FILTROS, estado: 'Cumplido' };
  readonly filtroEnProceso = { ...SIN_FILTROS, estado: 'En proceso' };
  /** Quitar el filtro de oficina conserva los demás filtros de la lista. */
  readonly filtroQuitarUnidad = { unidad: null, pagina: null };
  /**
   * Filas del ranking con su enlace ya armado. Se calculan una sola vez por
   * carga para que el `queryParams` de cada enlace conserve la misma identidad
   * entre ciclos de detección.
   */
  readonly filasRanking = computed(() =>
    this.ranking().map((fila) => {
      const filtrable = this.esFiltrable(fila);
      const nombre = fila.nombre || fila.area;
      return {
        area: fila.area,
        nombre: fila.nombre,
        total: fila.total,
        porcentajeCumplimiento: fila.porcentajeCumplimiento,
        filtrable,
        queryParams: { ...SIN_FILTROS, unidad: fila.area },
        titulo: `${filtrable ? 'Ver los compromisos de ' : ''}${nombre} · ${fila.cumplidos} de ${fila.total} cumplidos`,
      };
    }),
  );

  readonly cifraTotal = computed(() => this.cifra(this.datos()?.total));
  readonly cifraCumplidos = computed(() => this.cifra(this.datos()?.cumplidos));
  readonly cifraEnProceso = computed(() => this.cifra(this.datos()?.enProceso));
  readonly cifraVencidos = computed(() => this.cifra(this.datos()?.porPlazo.vencidos));

  /** «…» mientras carga, «—» sólo si la petición falló; nunca un cero fingido. */
  private cifra(valor: number | undefined): string {
    if (this.estado() === 'error') return '—';
    return valor === undefined ? '…' : String(valor);
  }

  /** Una oficina sin siglas («—») no es un filtro que la API pueda aplicar. */
  esFiltrable(fila: EstadisticaArea): boolean {
    return Boolean(fila.area) && fila.area !== '—';
  }

  recargar(): void {
    this.recurso.recargar();
  }
}
