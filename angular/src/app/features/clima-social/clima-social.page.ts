import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IconoComponent } from '../../shared/ui/icono.component';
import { PanoramaService } from '../mapa/panorama.service';
import { conteosPorSituacion } from '../mapa/panorama.agregados';

/**
 * Clima social.
 *
 * La base no guarda una serie periódica de clima social, así que la vista no
 * estima un índice: muestra la lectura real de los registros disponibles
 * (casos abiertos por nivel de conflictividad y riesgo alto) y declara «sin
 * dato» en la serie histórica.
 */
@Component({
  selector: 'app-clima-social',
  imports: [RouterLink, IconoComponent],
  providers: [PanoramaService],
  template: `
    <section class="view-body" aria-labelledby="titulo-clima-social">
      <header class="view-head">
        <div>
          <p class="section-eyebrow">PREVENCIÓN</p>
          <h1 id="titulo-clima-social">Clima social</h1>
          <p class="view-subtitle">
            Lectura del estado del diálogo: conflictividad latente y manifiesta, casos con riesgo
            alto y alertas por atender.
          </p>
        </div>
        <div class="view-actions">
          <button type="button" class="button-secondary" (click)="panorama.recargar()">
            Recargar
          </button>
        </div>
      </header>

      @if (panorama.estado() === 'error') {
      <div class="empty-state" role="alert">
        <strong>No se pudo leer el clima social</strong>
        <p>{{ panorama.error()?.message }}</p>
        <button type="button" class="button-secondary" (click)="panorama.recargar()">
          Reintentar
        </button>
      </div>
      } @else if (panorama.estado() === 'cargando' && panorama.casos().length === 0) {
      <div class="empty-state" role="status">Cargando la lectura del territorio…</div>
      } @else {
      <div class="executive-kpis">
        @for (indicador of indicadores(); track indicador.clave) {
        <div class="stat-card">
          <span class="stat-icon"><app-icono [nombre]="indicador.icono" [tamano]="16" /></span>
          <span class="stat-copy">
            <span>{{ indicador.etiqueta }}</span>
            <strong>{{ indicador.valor }}</strong>
          </span>
        </div>
        }
      </div>

      <section class="surface panel" aria-labelledby="titulo-lectura">
        <div class="surface-heading">
          <div>
            <p class="section-eyebrow">SERIE</p>
            <h3 id="titulo-lectura">Índice de clima social</h3>
          </div>
        </div>
        <p class="panel-nota">
          <strong>Sin dato.</strong> La serie de clima social requiere una medición periódica por
          región; la base todavía no registra esas mediciones, así que la vista no deriva un índice
          a partir de otros indicadores.
        </p>
        <p class="panel-nota">
          La lectura disponible son los {{ panorama.casos().length }} casos abiertos registrados al
          {{ panorama.corte() || 'corte actual' }}. Para el detalle por territorio, use el panorama
          territorial.
        </p>
        <div class="enlaces">
          <a class="button-secondary" routerLink="/mapa">Ver panorama territorial</a>
          <a class="button-secondary" routerLink="/casos">Ver casos</a>
          <a class="button-secondary" routerLink="/alertas">Ver alertas tempranas</a>
        </div>
      </section>

      <section class="surface panel" aria-labelledby="titulo-conflictividad">
        <div class="surface-heading">
          <div>
            <p class="section-eyebrow">CONFLICTIVIDAD</p>
            <h3 id="titulo-conflictividad">Casos abiertos por nivel de conflictividad</h3>
            <p>Cuatro niveles de la Guía §7.5.1 agrupados en latente y manifiesto.</p>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table" aria-label="Casos abiertos por nivel de conflictividad">
            <thead>
              <tr>
                <th scope="col">Nivel</th>
                <th scope="col">Casos abiertos</th>
                <th scope="col">Situación</th>
              </tr>
            </thead>
            <tbody>
              @for (fila of niveles(); track fila.nivel) {
              <tr>
                <td><strong>{{ fila.nivel }}</strong></td>
                <td>{{ fila.total }}</td>
                <td>{{ fila.situacion }}</td>
              </tr>
              } @if (sinNivel() > 0) {
              <tr>
                <td><strong>Sin nivel declarado</strong></td>
                <td>{{ sinNivel() }}</td>
                <td><span class="sin-dato">Sin dato</span></td>
              </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="tabla-nota">
          El nivel de conflictividad es el declarado en cada caso; los casos sin nivel no se
          estiman ni se cuentan como «Diferencia».
        </p>
      </section>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .sin-dato {
      color: #8a98a5;
      font-style: italic;
      font-weight: 600;
    }

    .enlaces {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    .enlaces a {
      text-decoration: none;
    }
  `,
})
export class ClimaSocialPage {
  readonly panorama = inject(PanoramaService);

  private readonly conteos = computed(() => conteosPorSituacion(this.panorama.casos()));

  readonly sinNivel = computed(() => this.conteos().sinNivel);

  readonly niveles = computed(() => {
    const porNivel = new Map<string, number>();
    for (const caso of this.panorama.casos()) {
      const nivel = caso.nivelConflicto ?? 'Sin nivel declarado';
      porNivel.set(nivel, (porNivel.get(nivel) ?? 0) + 1);
    }
    const situaciones: Record<string, string> = {
      Diferencia: 'Latente',
      Controversia: 'Latente',
      'Conflicto social': 'Manifiesto',
      'Crisis social': 'Manifiesto',
    };
    return ['Diferencia', 'Controversia', 'Conflicto social', 'Crisis social'].map((nivel) => ({
      nivel,
      total: porNivel.get(nivel) ?? 0,
      situacion: situaciones[nivel],
    }));
  });

  readonly indicadores = computed(() => {
    const casos = this.panorama.casos();
    const alto = casos.filter((caso) => caso.riesgo === 'Alto').length;
    return [
      {
        clave: 'latente',
        etiqueta: 'Conflictividad latente',
        icono: 'alerta',
        valor: this.conteos().latente,
      },
      {
        clave: 'manifiesto',
        etiqueta: 'Conflictividad manifiesta',
        icono: 'casos',
        valor: this.conteos().manifiesto,
      },
      {
        clave: 'sin-nivel',
        etiqueta: 'Casos sin nivel declarado',
        icono: 'info',
        valor: this.conteos().sinNivel,
      },
      {
        clave: 'riesgo',
        etiqueta: 'Casos con riesgo alto',
        icono: 'escudo',
        valor: alto,
      },
    ];
  });
}
