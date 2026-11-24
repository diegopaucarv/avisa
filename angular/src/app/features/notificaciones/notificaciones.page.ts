import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';

import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import {
  ESTADOS_NOTIFICACION,
  aNotificacion,
  claseLectura,
  enlaceNotificacion,
  esEstadoFiltro,
  estadoDeMarcado,
  etiquetaEstado,
  etiquetaEstadoFiltro,
  etiquetaLectura,
  formatearFecha,
  type EnlaceNotificacion,
  type Notificacion,
} from './notificacion.mapeo';

type FiltrosNotificaciones = {
  pagina: number;
  tamano: number;
  estado: string;
};

const FILTROS_INICIALES: FiltrosNotificaciones = {
  pagina: 1,
  tamano: TAMANO_PAGINA,
  estado: '',
};

/** Mensaje en línea de una acción de lectura, con su reintento opcional. */
type AvisoLectura = {
  texto: string;
  tipo: 'ok' | 'error';
  reintento: { id: string; estado: 'leida' | 'pendiente' } | null;
};

/**
 * Centro de notificaciones.
 *
 * Listado paginado en servidor con filtro por estado de lectura en la URL. Las
 * no leídas se resaltan y llevan la insignia «Sin leer». «Marcar como leída» y
 * «Desmarcar» usan `PATCH /v1/notifications/{id}` y recargan lista y contador.
 *
 * El enlace abre la ficha del caso cuando la API entrega `entidadCodigo`; en
 * cualquier otro caso abre la sección y la nota lo declara.
 */
@Component({
  selector: 'app-notificaciones',
  imports: [
    RouterLink,
    IconoComponent,
    PaginacionComponent,
    BarraSeleccionComponent,
    ThOrdenDirective,
  ],
  templateUrl: './notificaciones.page.html',
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

    .notificacion {
      display: flex;
      align-items: flex-start;
      gap: 9px;
    }

    .notificacion-icono {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      flex: none;
      border-radius: 50%;
      background: #eef3f7;
      color: #5f7690;
    }

    .notificacion-texto {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .data-table tr.sin-leer td {
      background: #fbfdff;
    }

    .data-table tr.sin-leer td:first-child {
      box-shadow: inset 3px 0 0 #4f7fc4;
    }

    .data-table tr.sin-leer .notificacion-texto strong {
      color: #1f3850;
      font-weight: 700;
    }

    .aviso-ok {
      color: #3f6b52;
    }

    .aviso-lectura {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }

    .accion-leida {
      white-space: nowrap;
    }

    .sin-dato {
      color: #a0aab3;
      font-style: italic;
    }

    .notificaciones-nota {
      margin: 0;
      color: #8b97a2;
      font-size: 12px;
      line-height: 1.55;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class NotificacionesPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly estados = ESTADOS_NOTIFICACION;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => {
        const estado = params.get('estado') ?? '';
        return {
          pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
          tamano: Math.max(
            1,
            Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA,
          ),
          estado: esEstadoFiltro(estado) ? estado : '',
        };
      }),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly listado = consulta<Coleccion<Notificacion>>({
    fuente: () => {
      const { pagina, tamano, estado } = this.parametros();
      return urlConParametros(urlApi('/v1/notifications'), {
        ...paramsDePagina({ pagina, tamano }),
        estado,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aNotificacion) };
    },
  });

  /**
   * Contador de no leídas. Es un total del servidor, no de la página visible:
   * pide `estado=pendiente` con `pageSize=1` y lee el `total` del sobre.
   */
  private readonly contador = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/notifications'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        estado: 'pendiente',
      }),
    esquema: (bruto) => normalizarColeccion<unknown>(bruto).total,
  });

  readonly notificaciones = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly sinLeer = computed(() => this.contador.valor() ?? null);

  /** Rótulo del contador; «…» mientras la primera lectura no llega. */
  readonly textoContador = computed(() => {
    const cuenta = this.sinLeer();
    return cuenta === null ? '… sin leer' : `${cuenta} sin leer`;
  });

  readonly estadoListado = this.listado.estado;
  readonly errorListado = this.listado.error;
  readonly errorContador = this.contador.error;

  /** Fila cuya lectura se está guardando; bloquea las demás acciones. */
  readonly enviandoId = signal<string | null>(null);

  /** Mensaje en línea del último intento de marcar o desmarcar. */
  readonly aviso = signal<AvisoLectura | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Selección de la tabla (página visible) para exportar. */
  readonly seleccion = new SeleccionTabla();

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Notificacion>();

  private readonly accesores: Record<string, (notificacion: Notificacion) => unknown> = {
    notificacion: (notificacion) => notificacion.titulo,
    categoria: (notificacion) => notificacion.categoria,
    lectura: (notificacion) => notificacion.estado,
    vence: (notificacion) => notificacion.venceEn,
    registrada: (notificacion) => notificacion.creadaEn,
    registro: (notificacion) => notificacion.entidadCodigo ?? notificacion.seccion?.etiqueta ?? '',
  };

  readonly filasVisibles = computed(() =>
    this.orden.ordenar(this.notificaciones(), this.accesores),
  );

  idsVisibles(): string[] {
    return this.notificaciones()
      .map((notificacion) => notificacion.id)
      .filter((id): id is string => !!id);
  }

  readonly sinLeerEnPagina = computed(
    () => this.notificaciones().filter((notificacion) => !notificacion.leida).length,
  );

  /** Leyenda de la tabla; se arma aquí para no partir `@if` dentro de `<caption>`. */
  readonly resumenTabla = computed(() => {
    const partes = [`Total: ${this.total()}`];
    const { estado } = this.filtros();
    if (estado) partes.push(`filtro: ${etiquetaEstadoFiltro(estado)}`);
    const sinLeer = this.sinLeerEnPagina();
    if (sinLeer > 0) partes.push(`${sinLeer} sin leer en esta página`);
    partes.push('orden del servidor, más recientes primero');
    return `${partes.join(' · ')}.`;
  });

  fecha(valor: string | null): string {
    return formatearFecha(valor);
  }

  estadoEtiqueta(valor: string | null): string {
    return etiquetaEstado(valor);
  }

  estadoFiltroEtiqueta(valor: string): string {
    return etiquetaEstadoFiltro(valor);
  }

  lecturaEtiqueta(valor: string | null): string {
    return etiquetaLectura(valor);
  }

  lecturaClase(valor: string | null): string {
    return claseLectura(valor);
  }

  enlace(notificacion: Notificacion): EnlaceNotificacion | null {
    return enlaceNotificacion(notificacion);
  }

  pistaEnlace(notificacion: Notificacion): string {
    const enlace = enlaceNotificacion(notificacion);
    if (!enlace) return 'El aviso no tiene un registro asociado';
    if (enlace.concreta) return `Abrir la ficha del ${enlace.etiqueta}`;
    return `Abrir la sección ${enlace.etiqueta}; el aviso no trae el código del registro`;
  }

  etiquetaAccion(notificacion: Notificacion): string {
    return notificacion.leida ? 'Desmarcar' : 'Marcar como leída';
  }

  ariaAccion(notificacion: Notificacion): string {
    const accion = notificacion.leida ? 'Desmarcar' : 'Marcar como leída';
    return `${accion} la notificación ${notificacion.titulo}`;
  }

  /** Marca o deshace la lectura de una fila. */
  cambiarLectura(notificacion: Notificacion, leida: boolean): void {
    if (!notificacion.id || this.enviandoId()) return;
    this.enviarLectura(notificacion.id, estadoDeMarcado(leida));
  }

  /** Reintenta la última acción de lectura que falló. */
  reintentarLectura(): void {
    const aviso = this.aviso();
    if (!aviso?.reintento || this.enviandoId()) return;
    this.enviarLectura(aviso.reintento.id, aviso.reintento.estado);
  }

  cambiarEstado(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    this.actualizar({ estado: esEstadoFiltro(valor) ? valor : '', pagina: 1 });
  }

  limpiar(): void {
    this.actualizar({ estado: '', pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  recargar(): void {
    this.listado.recargar();
    this.contador.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  private enviarLectura(id: string, estado: 'leida' | 'pendiente'): void {
    this.enviandoId.set(id);
    this.aviso.set(null);

    this.http
      .patch<unknown>(urlApi(`/v1/notifications/${encodeURIComponent(id)}`), { estado })
      .subscribe({
        next: () => {
          this.enviandoId.set(null);
          this.aviso.set({
            tipo: 'ok',
            texto:
              estado === 'leida'
                ? 'Notificación marcada como leída.'
                : 'Notificación devuelta a «sin leer».',
            reintento: null,
          });
          this.recargar();
        },
        error: (fallo: unknown) => {
          this.enviandoId.set(null);
          this.aviso.set({
            tipo: 'error',
            texto: this.mensajeDeError(fallo),
            reintento: { id, estado },
          });
        },
      });
  }

  private mensajeDeError(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.estado === 404) {
      return 'La notificación ya no existe o no le pertenece.';
    }
    if (error.esProhibido) {
      return 'Su rol no permite cambiar el estado de esta notificación.';
    }
    return error.message;
  }

  private actualizar(cambios: Partial<FiltrosNotificaciones>): void {
    const siguiente = { ...this.parametros(), ...cambios };
    this.aviso.set(null);

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        estado: siguiente.estado || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
