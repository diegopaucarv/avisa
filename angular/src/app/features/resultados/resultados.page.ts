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
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import {
  aDocumento,
  claseEstado,
  formatearFecha,
  type Documento,
} from '../documentos/documento.mapeo';
import { ListaAsistenciaComponent } from './lista-asistencia.component';

type Pestana = 'ayuda_memoria' | 'relatoria' | 'reporte_actividad' | 'acta';

const PESTANAS: readonly { codigo: Pestana; etiqueta: string; descripcion: string }[] = [
  {
    codigo: 'ayuda_memoria',
    etiqueta: 'Ayudas memoria',
    descripcion: 'Ayudas memoria organizadas por caso, con la fecha de la reunión.',
  },
  {
    codigo: 'relatoria',
    etiqueta: 'Relatorías',
    descripcion: 'Relatoría de la reunión con el registro de intervenciones.',
  },
  {
    codigo: 'reporte_actividad',
    etiqueta: 'Reportes de Actividad',
    descripcion: 'Reporte rápido después de una reunión',
  },
  {
    codigo: 'acta',
    etiqueta: 'Actas',
    descripcion:
      'Actas de acuerdo de las reuniones de diálogo, incluidas las que elaboran otras oficinas.',
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
  imports: [
    RouterLink,
    PaginacionComponent,
    IconoComponent,
    ThOrdenDirective,
    ListaAsistenciaComponent,
  ],
  template: `
    <section class="view-body" aria-labelledby="titulo-resultados">
      <header class="view-head">
        <div>
          <h1 id="titulo-resultados">Resultados</h1>
        </div>
        <div class="view-actions">
          <button
            type="button"
            class="button-primary"
            title="Toma o elige una foto de la lista y revísala antes de vincular"
            (click)="abrirLista()"
          >
            <app-icono nombre="documentos" [tamano]="14" />
            Tomar foto de la lista de asistencia
          </button>
          <a
            class="button-secondary"
            routerLink="/directorio/actores"
            title="Abre el directorio para preparar la lista de asistencia"
          >
            Cargar lista de asistencia
          </a>
          <a class="button-secondary" routerLink="/documentos">Ver todos los documentos</a>
        </div>
      </header>

      <section class="surface panel" aria-labelledby="titulo-cargar">
        <div class="surface-heading">
          <div>
            <h3 id="titulo-cargar">Cargar un resultado</h3>
          </div>
        </div>

        <div class="carga-cuerpo">
          <label class="zona-archivo" [class.zona-archivo--llena]="archivoNombre()">
            <input type="file" accept=".pdf,.doc,.docx,.txt" (change)="elegirArchivo($event)" />
            <app-icono nombre="documentos" [tamano]="22" />
            <strong>{{ archivoNombre() || 'Arrastra o elige un archivo' }}</strong>
            <small>PDF, DOCX o TXT</small>
          </label>

          <div class="carga-acciones">
            <button
              type="button"
              class="button-primary"
              [disabled]="!archivoNombre() || procesandoIa()"
              (click)="procesarConIa()"
            >
              <app-icono nombre="actividad" [tamano]="14" />
              {{ procesandoIa() ? 'Procesando…' : 'Procesar con IA' }}
            </button>
            <button
              type="button"
              class="button-secondary"
              [disabled]="!archivoNombre()"
              (click)="limpiarArchivo()"
            >
              Quitar archivo
            </button>
            <p class="carga-nota">
              La extracción con IA todavía no está disponible. Al activarse, el texto reconocido se
              inyectará en las ventanas de Prevención y Seguimiento.
            </p>
          </div>
        </div>
      </section>

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
                <th scope="col" class="col-codigo" [appThOrden]="'codigo'" [orden]="orden">
                  Código
                </th>
                <th scope="col" [appThOrden]="'titulo'" [orden]="orden">Título</th>
                <th scope="col" [appThOrden]="'fecha'" [orden]="orden">Fecha de reunión</th>
                <th scope="col" [appThOrden]="'caso'" [orden]="orden">Caso vinculado</th>
                <th scope="col" [appThOrden]="'estado'" [orden]="orden">Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (documento of filasVisibles(); track documento.id) {
                <tr>
                  <td class="col-codigo" [attr.title]="documento.codigo">
                    {{ documento.codigo || 'Sin código' }}
                  </td>
                  <td class="celda-titulo">{{ documento.titulo || 'Sin título' }}</td>
                  <td>{{ formatearFecha(documento.fecha) }}</td>
                  <td>
                    @if (documento.casoCode) {
                      <a
                        class="table-link"
                        [routerLink]="['/casos', documento.casoCode]"
                        [attr.title]="documento.casoTitulo"
                      >
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
            [pagina]="pagina()"
            [tamano]="tamano"
            [total]="total()"
            (paginaCambia)="cambiarPagina($event)"
            (tamanoCambia)="cambiarTamano($event)"
          />
        }
      }

      @if (mostrarLista()) {
        <app-lista-asistencia (cerrar)="cerrarLista()" />
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
    }

    .celda-titulo {
      max-width: 420px;
      white-space: normal;
    }

    /* El global fija min-width 205px a la primera celda; el código no lo necesita. */
    .data-table th.col-codigo,
    .data-table td.col-codigo {
      width: 120px;
      min-width: 96px;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .carga-cuerpo {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
    }

    @media (max-width: 760px) {
      .carga-cuerpo {
        grid-template-columns: 1fr;
      }
    }

    .zona-archivo {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 148px;
      padding: 16px;
      border: 1.5px dashed var(--line);
      border-radius: 10px;
      background: var(--canvas);
      color: var(--muted);
      text-align: center;
      cursor: pointer;
    }

    .zona-archivo:hover,
    .zona-archivo:focus-within {
      border-color: var(--blue);
      color: var(--ink-2);
    }

    .zona-archivo--llena {
      border-style: solid;
      border-color: var(--blue);
      color: var(--ink);
    }

    .zona-archivo input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      overflow: hidden;
    }

    .zona-archivo strong {
      font-size: 15px;
    }

    .zona-archivo small {
      font-size: 14px;
    }

    .carga-acciones {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .carga-nota {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
  `,
})
export class ResultadosPage {
  readonly pestanas = PESTANAS;
  readonly tamano = 25;

  readonly activa = signal<Pestana>('acta');
  readonly pagina = signal(1);
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

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Documento>();

  private readonly accesores: Record<string, (documento: Documento) => unknown> = {
    codigo: (documento) => documento.codigo,
    titulo: (documento) => documento.titulo,
    fecha: (documento) => documento.fecha,
    caso: (documento) => documento.casoCode,
    estado: (documento) => documento.estadoUi,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.documentos(), this.accesores));

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

  readonly mostrarLista = signal(false);

  abrirLista(): void {
    this.mostrarLista.set(true);
  }

  cerrarLista(): void {
    this.mostrarLista.set(false);
  }

  readonly archivoNombre = signal<string | null>(null);
  readonly procesandoIa = signal(false);

  elegirArchivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    this.archivoNombre.set(entrada.files?.[0]?.name ?? null);
  }

  limpiarArchivo(): void {
    this.archivoNombre.set(null);
  }

  procesarConIa(): void {
    if (!this.archivoNombre() || this.procesandoIa()) return;
    // Pendiente: subir el archivo y llamar al servicio de extracción.
    this.procesandoIa.set(true);
    setTimeout(() => this.procesandoIa.set(false), 700);
  }

  formatearFecha = formatearFecha;
  claseEstado = claseEstado;
}
