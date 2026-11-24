import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import { PanoramaService } from '../mapa/panorama.service';
import { conteosPorSituacion } from '../mapa/panorama.agregados';

type NivelClima = {
  nivel: string;
  total: number;
  situacion: string;
};

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
  imports: [RouterLink, IconoComponent, ThOrdenDirective],
  providers: [PanoramaService],
  template: `
    <section class="view-body" aria-labelledby="titulo-clima-social">
      <header class="view-head">
        <div>
          <h1 id="titulo-clima-social">Clima social</h1>
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
              <h3 id="titulo-lectura">Índice de clima social</h3>
            </div>
          </div>
          <div class="enlaces">
            <a class="button-secondary" routerLink="/mapa">Ver panorama territorial</a>
            <a class="button-secondary" routerLink="/casos">Ver casos</a>
            <a class="button-secondary" routerLink="/alertas">Ver alertas tempranas</a>
          </div>
        </section>

        <section class="surface panel" aria-labelledby="titulo-conflictividad">
          <div class="surface-heading">
            <div>
              <h3 id="titulo-conflictividad">Casos abiertos por nivel de conflictividad</h3>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data-table" aria-label="Casos abiertos por nivel de conflictividad">
              <thead>
                <tr>
                  <th scope="col" [appThOrden]="'nivel'" [orden]="orden">Nivel</th>
                  <th scope="col" [appThOrden]="'total'" [orden]="orden">Casos abiertos</th>
                  <th scope="col" [appThOrden]="'situacion'" [orden]="orden">Situación</th>
                </tr>
              </thead>
              <tbody>
                @for (fila of filasVisibles(); track fila.nivel) {
                  <tr>
                    <td>
                      <strong>{{ fila.nivel }}</strong>
                    </td>
                    <td>{{ fila.total }}</td>
                    <td>{{ fila.situacion }}</td>
                  </tr>
                }
                @if (sinNivel() > 0) {
                  <tr>
                    <td><strong>Sin nivel declarado</strong></td>
                    <td>{{ sinNivel() }}</td>
                    <td><span class="sin-dato">Sin dato</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
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
      color: var(--muted);
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

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<NivelClima>();

  private readonly accesores: Record<string, (fila: NivelClima) => unknown> = {
    nivel: (fila) => fila.nivel,
    total: (fila) => fila.total,
    situacion: (fila) => fila.situacion,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.niveles(), this.accesores));

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
