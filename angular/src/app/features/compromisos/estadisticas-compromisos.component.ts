import { ChangeDetectionStrategy, Component, computed } from '@angular/core';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import {
  aEstadisticasCompromisos,
  generarCsvEstadisticas,
  nombreArchivoEstadisticas,
  type EstadisticasCompromisos,
} from './estadisticas-compromisos';

/**
 * Pestaña «Estadísticas» de compromisos (Guía §8.3.2 / C1).
 *
 * Lee `GET /api/v1/commitments/estadisticas` con la misma fachada `consulta`
 * del resto de la pantalla, pinta los indicadores, el ranking por área y la
 * situación de plazo, y exporta el mismo sobre a CSV desde el cliente: lo que
 * se descarga es exactamente lo que se está viendo, sin una segunda petición.
 */
@Component({
  selector: 'app-estadisticas-compromisos',
  templateUrl: './estadisticas-compromisos.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .estadisticas {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .est-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .est-head h2 {
      margin: 0 0 3px;
      font: 700 16px/1.2 var(--font-display);
      color: #23384d;
    }

    .est-nota {
      margin: 0;
      color: #75838f;
      font-size: 12.5px;
    }

    .est-nota code {
      font-size: 11.5px;
    }

    /* Seis tarjetas caben en una fila flexible; la rejilla global es de cuatro. */
    .executive-kpis.est-kpis {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      margin-bottom: 0;
    }

    .est-card {
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .est-card h3 {
      margin: 0 0 10px;
      font: 700 13.5px/1.2 var(--font-display);
      color: #23384d;
    }

    .est-scroll {
      overflow-x: auto;
    }

    .est-tabla {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }

    .est-tabla th,
    .est-tabla td {
      padding: 7px 9px;
      border-bottom: 1px solid #eef1f4;
      text-align: left;
      white-space: nowrap;
    }

    .est-tabla thead th {
      color: #6c7b87;
      font-size: 11.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    .est-tabla tbody th {
      color: #33475b;
      font-weight: 600;
    }

    .est-tabla .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .est-nombre {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .est-porcentaje {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .est-barra {
      display: inline-block;
      width: 90px;
      height: 7px;
      border-radius: 4px;
      overflow: hidden;
      background: #eef1f4;
    }

    .est-barra i {
      display: block;
      height: 100%;
      border-radius: 4px;
      background: var(--green);
    }

    .est-barra i.vencido {
      background: var(--red);
    }

    .est-barra i.sinplazo {
      background: #c3ccd4;
    }

    .est-cifra {
      min-width: 42px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: #33475b;
    }

    .est-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }

    .est-plazos,
    .est-estados {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .est-plazos li {
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 10px;
      color: #526577;
      font-size: 12.5px;
    }

    .est-estados li {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 10px;
      color: #526577;
      font-size: 12.5px;
    }

    .est-plazos b,
    .est-estados b {
      color: #23384d;
      font-variant-numeric: tabular-nums;
    }

    .est-estados small {
      margin-left: 6px;
      color: #9aa6b0;
      font-size: 11px;
    }

    .est-vacio {
      margin: 0;
      color: #8995a0;
      font-size: 12.5px;
    }

    @media (max-width: 720px) {
      .est-nombre {
        max-width: 150px;
      }
    }
  `,
})
export class EstadisticasCompromisosComponent {
  private readonly recurso = consulta<EstadisticasCompromisos>({
    fuente: () => urlApi('/v1/commitments/estadisticas'),
    esquema: aEstadisticasCompromisos,
  });

  readonly datos = this.recurso.valor;
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;

  readonly cargando = computed(
    () => this.estado() === 'inactivo' || this.estado() === 'cargando',
  );

  /** Base del porcentaje de plazo: compromisos con y sin fecha de hito. */
  readonly totalPlazo = computed(() => {
    const datos = this.datos();
    if (!datos) return 0;
    return (
      datos.porPlazo.vencidos + datos.porPlazo.alDia + datos.porPlazo.sinPlazo
    );
  });

  recargar(): void {
    this.recurso.recargar();
  }

  porcentajePlazo(cantidad: number): number {
    const base = this.totalPlazo();
    return base ? Math.round((cantidad / base) * 100) : 0;
  }

  /** Descarga el sobre visible como CSV con BOM UTF-8. */
  exportar(): void {
    const datos = this.datos();
    if (!datos) return;
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;

    const csv = generarCsvEstadisticas(datos);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivoEstadisticas();
    enlace.click();
    URL.revokeObjectURL(url);
  }
}
