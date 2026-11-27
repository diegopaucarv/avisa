import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
  formatearFecha as formatearFechaDocumento,
  type Documento,
} from '../documentos/documento.mapeo';
import { ListaAsistenciaComponent } from './lista-asistencia.component';
import { ProductoPanelComponent } from './producto-panel.component';
import {
  claseEstadoProducto,
  etapaDeProducto,
  etapasProducto,
  type AccionFlujo,
} from './producto.mapeo';
import { ResultadosService } from './resultados.service';

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
    ProductoPanelComponent,
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

      <!-- Mismo vocabulario que alertas: deja visible el recorrido completo. -->
      <div class="flujo-leyenda" role="note" aria-label="Etapas del flujo de aprobación">
        <span class="flujo-leyenda-titulo">Flujo de aprobación</span>
        @for (etapa of etapasFlujo; track etapa.paso) {
          <span class="flujo-leyenda-paso">
            <span class="flujo-leyenda-numero" aria-hidden="true">{{ etapa.paso }}</span>
            {{ etapa.nombre }}
          </span>
          @if (!$last) {
            <span class="flujo-leyenda-flecha" aria-hidden="true">→</span>
          }
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
                <th scope="col" [appThOrden]="'etapa'" [orden]="orden">Etapa</th>
                <th scope="col" [appThOrden]="'estado'" [orden]="orden">Estado</th>
                <th scope="col" class="col-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (documento of filasVisibles(); track documento.id) {
                <tr (click)="abrirProducto(documento)">
                  <td class="col-codigo" [attr.title]="documento.codigo">
                    <button
                      type="button"
                      class="table-link"
                      [attr.aria-label]="
                        'Abrir el producto ' +
                        (documento.codigo || documento.titulo || 'sin título')
                      "
                      (click)="abrirProducto(documento); $event.stopPropagation()"
                    >
                      {{ documento.codigo || 'Sin código' }}
                    </button>
                  </td>
                  <td class="celda-titulo">{{ documento.titulo || 'Sin título' }}</td>
                  <td>{{ formatearFecha(documento.fecha) }}</td>
                  <td>
                    @if (documento.casoCode) {
                      <a
                        class="table-link"
                        [routerLink]="['/casos', documento.casoCode]"
                        [attr.title]="documento.casoTitulo"
                        (click)="$event.stopPropagation()"
                      >
                        {{ documento.casoCode }}
                      </a>
                    } @else {
                      <span class="sin-dato">Sin caso</span>
                    }
                  </td>
                  <td>
                    @if (etapaDelProducto(documento); as etapa) {
                      <div
                        class="flujo-mini"
                        [attr.title]="
                          'Paso ' + etapa.paso + ' de ' + etapasFlujo.length + ' · ' + etapa.nombre
                        "
                        [attr.aria-label]="
                          'Etapa ' + etapa.paso + ' de ' + etapasFlujo.length + ': ' + etapa.nombre
                        "
                      >
                        <span class="flujo-mini-pasos" aria-hidden="true">
                          @for (paso of etapasFlujo; track paso.paso) {
                            <span
                              class="flujo-mini-punto"
                              [class.completado]="paso.paso < etapa.paso"
                              [class.actual]="paso.paso === etapa.paso"
                            ></span>
                          }
                        </span>
                        <span class="flujo-mini-etapa">{{ etapa.nombre }}</span>
                      </div>
                    } @else {
                      <span class="sin-dato">Sin etapa</span>
                    }
                  </td>
                  <td>
                    <span [class]="'status-badge ' + claseEstado(documento.estado)">
                      <span class="status-dot"></span>
                      {{ documento.estadoUi }}
                    </span>
                  </td>
                  <td class="col-acciones">
                    <button
                      type="button"
                      class="table-link flujo-abrir"
                      [attr.aria-label]="
                        'Abrir la ficha de ' +
                        (documento.codigo || documento.titulo || 'el producto')
                      "
                      (click)="abrirProducto(documento); $event.stopPropagation()"
                    >
                      <app-icono nombre="ojo" [tamano]="14" />
                      Abrir
                    </button>
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

      @if (productoPanel(); as producto) {
        <app-producto-panel
          [producto]="producto"
          [guardando]="guardandoFlujo()"
          [errorGuardado]="errorFlujo()"
          [aviso]="avisoFlujo()"
          (cerrar)="cerrarPanel()"
          (accion)="alAccionFlujo($event)"
        />
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .surface.panel {
      padding: 17px;
    }

    /* Leyenda del flujo: mismo recorrido que la ficha, visible también arriba. */
    .flujo-leyenda {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 12.5px;
    }

    .flujo-leyenda-titulo {
      color: var(--ink-2);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .flujo-leyenda-paso {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px 3px 4px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--paper);
    }

    .flujo-leyenda-numero {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 17px;
      height: 17px;
      border-radius: 50%;
      background: var(--blue-pale);
      color: var(--blue);
      font-size: 10.5px;
      font-weight: 700;
    }

    .flujo-leyenda-flecha {
      color: var(--muted);
    }

    /* Indicador compacto de la etapa actual dentro de cada fila. */
    .flujo-mini {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .flujo-mini-pasos {
      display: inline-flex;
      gap: 3px;
    }

    .flujo-mini-punto {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--line);
    }

    .flujo-mini-punto.completado {
      background: #5b9874;
    }

    .flujo-mini-punto.actual {
      background: var(--blue);
      box-shadow: 0 0 0 2px var(--blue-pale);
    }

    .flujo-mini-etapa {
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .data-table tbody tr {
      cursor: pointer;
    }

    .data-table th.col-acciones,
    .data-table td.col-acciones {
      width: 118px;
      min-width: 96px;
      white-space: nowrap;
    }

    .flujo-abrir {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
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
  private readonly resultados = inject(ResultadosService);

  readonly pestanas = PESTANAS;
  readonly tamano = 25;

  readonly etapasFlujo = etapasProducto;
  readonly etapaDelProducto = etapaDeProducto;

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
    etapa: (documento) => etapaDeProducto(documento)?.paso ?? 0,
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
    // La ficha abierta pertenece a la pestaña anterior; no se reutiliza.
    this.productoPanel.set(null);
  }

  cambiarPagina(pagina: number): void {
    this.productoPanel.set(null);
    this.pagina.set(pagina);
  }

  cambiarTamano(tamano: number): void {
    this.productoPanel.set(null);
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

  /* -------- Ficha y flujo de aprobación del producto -------- */

  readonly productoPanel = signal<Documento | null>(null);
  readonly guardandoFlujo = signal(false);
  readonly errorFlujo = signal<string | null>(null);
  readonly avisoFlujo = signal<string | null>(null);

  abrirProducto(documento: Documento): void {
    this.errorFlujo.set(null);
    this.avisoFlujo.set(null);
    this.guardandoFlujo.set(false);
    this.productoPanel.set(documento);
  }

  cerrarPanel(): void {
    this.productoPanel.set(null);
  }

  /**
   * Aplica una transición confirmada por la ficha.
   *
   * El panel ya filtró por rol y la ficha pidió confirmación; aquí sólo se
   * hace el `PATCH` y se refleja la fila devuelta para que la tabla y la
   * cabecera del panel no esperen a la recarga.
   */
  alAccionFlujo(accion: AccionFlujo): void {
    const producto = this.productoPanel();
    if (!producto || this.guardandoFlujo()) return;

    this.guardandoFlujo.set(true);
    this.errorFlujo.set(null);
    this.avisoFlujo.set(null);

    this.resultados.actualizarEstado(producto.id, accion.estado).subscribe({
      next: (actualizado) => {
        this.guardandoFlujo.set(false);
        this.productoPanel.set(actualizado);
        const etapa = etapaDeProducto(actualizado);
        const destino = etapa ? `paso ${etapa.paso} · ${etapa.nombre}` : `paso ${accion.paso}`;
        this.avisoFlujo.set(`${actualizado.codigo || 'El producto'}: ${destino}.`);
        this.listado.recargar();
      },
      error: (fallo: unknown) => {
        this.guardandoFlujo.set(false);
        this.errorFlujo.set(this.mensajeDeError(fallo));
      },
    });
  }

  private mensajeDeError(fallo: unknown): string {
    if (fallo && typeof fallo === 'object' && 'message' in fallo) {
      const mensaje = (fallo as { message?: unknown }).message;
      if (typeof mensaje === 'string' && mensaje.trim()) return mensaje;
    }
    return 'No se pudo cambiar la etapa del producto.';
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

  /**
   * Se delega en el formateador de documentos para no duplicar las reglas de
   * fecha; el import va con alias para que el nombre del método no choque.
   */
  formatearFecha(valor: string | null | undefined): string {
    return formatearFechaDocumento(valor);
  }

  /** Clase de estado compartida con la leyenda del flujo y la ficha lateral. */
  readonly claseEstado = claseEstadoProducto;
}
