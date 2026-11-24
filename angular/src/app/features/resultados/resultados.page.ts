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
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  aDocumento,
  claseEstado,
  formatearFecha,
  type Documento,
} from '../documentos/documento.mapeo';

type Pestana = 'acta' | 'ayuda_memoria' | 'relatoria';

const PESTANAS: readonly { codigo: Pestana; etiqueta: string; descripcion: string }[] = [
  {
    codigo: 'acta',
    etiqueta: 'Actas',
    descripcion:
      'Actas de acuerdo de las reuniones de diálogo, incluidas las que elaboran otras oficinas.',
  },
  {
    codigo: 'ayuda_memoria',
    etiqueta: 'Ayudas memoria',
    descripcion: 'Ayudas memoria organizadas por temática, con el caso y la fecha de la reunión.',
  },
  {
    codigo: 'relatoria',
    etiqueta: 'Relatorías',
    descripcion: 'Relatoría de la reunión con el registro de intervenciones.',
  },
];

/**
 * Resultados.
 *
 * Las actas, ayudas memoria y relatorías son tipos de `core.documentos`
 * (`acta`, `ayuda_memoria`, `relatoria`), así que la vista los lee del mismo
 * endpoint de documentos y los separa por pestaña. No se inventan filas: si el
 * tipo no tiene documentos, se declara el vacío.
 */
@Component({
  selector: 'app-resultados',
  imports: [RouterLink, PaginacionComponent],
  template: `
    <section class="view-body" aria-labelledby="titulo-resultados">
      <header class="view-head">
        <div>
          <p class="section-eyebrow">INTERVENCIÓN</p>
          <h1 id="titulo-resultados">Resultados</h1>
          <p class="view-subtitle">
            Documentos que cierran la intervención: actas de acuerdo, ayudas memoria por temática y
            relatoría de las reuniones.
          </p>
        </div>
        <div class="view-actions">
          <a class="button-secondary" routerLink="/documentos">Ver todos los documentos</a>
        </div>
      </header>

      <div class="segmented" role="tablist" aria-label="Tipo de resultado">
        @for (opcion of pestanas; track opcion.codigo) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="activa() === opcion.codigo"
            (click)="cambiar(opcion.codigo)"
          >
            {{ opcion.etiqueta }}
          </button>
        }
      </div>

      <p class="view-subtitle">{{ descripcionActiva() }}</p>

      @if (estado() === 'error') {
        <div class="empty-state" role="alert">
          <strong>No se pudieron cargar los resultados</strong>
          <p>{{ error()?.message }}</p>
          <button type="button" class="button-secondary" (click)="recargar()">Reintentar</button>
        </div>
      } @else if (documentos().length === 0) {
        @if (estado() === 'cargando' || estado() === 'inactivo') {
          <div class="empty-state" role="status">Cargando resultados…</div>
        } @else {
          <div class="empty-state">
            <strong>Sin {{ etiquetaActiva().toLowerCase() }} registradas</strong>
            <p>El tipo existe en el catálogo, pero todavía no tiene documentos cargados.</p>
          </div>
        }
      } @else {
        <div class="table-wrap">
          <table class="data-table" [attr.aria-label]="etiquetaActiva()">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Título</th>
                <th scope="col">Fecha</th>
                <th scope="col">Caso</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (documento of documentos(); track documento.id) {
                <tr>
                  <td>{{ documento.codigo || 'Sin código' }}</td>
                  <td class="celda-titulo">{{ documento.titulo || 'Sin título' }}</td>
                  <td>{{ formatearFecha(documento.fecha) }}</td>
                  <td>
                    @if (documento.casoCode) {
                      <a class="table-link" [routerLink]="['/casos', documento.casoCode]">
                        {{ documento.casoCode }}
                      </a>
                    } @else {
                      <span class="sin-dato">Sin caso</span>
                    }
                  </td>
                  <td>
                    <span [class]="'status-badge ' + claseEstado(documento.estadoUi)">
                      <span class="status-dot"></span>
                      {{ documento.estadoUi }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (total() > 0) {
          <app-paginacion
            [pagina]="1"
            [tamano]="tamano"
            [total]="total()"
            (paginaCambia)="cambiarPagina($event)"
            (tamanoCambia)="cambiarTamano($event)"
          />
        }
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
    }

    .celda-titulo {
      max-width: 420px;
      white-space: normal;
    }
  `,
})
export class ResultadosPage {
  readonly pestanas = PESTANAS;
  readonly tamano = 25;

  readonly activa = signal<Pestana>('acta');
  private readonly pagina = signal(1);
  private readonly porPagina = signal(this.tamano);

  private readonly listado = consulta<Coleccion<Documento>>({
    fuente: () => {
      return urlConParametros(urlApi('/v1/documents'), {
        ...paramsDePagina({ pagina: this.pagina(), tamano: this.porPagina() }),
        tipo: this.activa(),
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aDocumento) };
    },
  });

  readonly documentos = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly estado = this.listado.estado;
  readonly error = this.listado.error;

  readonly etiquetaActiva = computed(
    () => PESTANAS.find((pestana) => pestana.codigo === this.activa())?.etiqueta ?? 'Resultados',
  );

  readonly descripcionActiva = computed(
    () => PESTANAS.find((pestana) => pestana.codigo === this.activa())?.descripcion ?? '',
  );

  cambiar(pestana: Pestana): void {
    if (this.activa() === pestana) return;
    this.pagina.set(1);
    this.activa.set(pestana);
  }

  cambiarPagina(pagina: number): void {
    this.pagina.set(pagina);
  }

  cambiarTamano(tamano: number): void {
    this.porPagina.set(tamano);
    this.pagina.set(1);
  }

  recargar(): void {
    this.listado.recargar();
  }

  formatearFecha = formatearFecha;
  claseEstado = claseEstado;
}
