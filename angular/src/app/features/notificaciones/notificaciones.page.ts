import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { TAMANO_PAGINA, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
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
  aColeccionNotificaciones,
  agruparPorDia,
  claseLectura,
  enlaceNotificacion,
  esEstadoFiltro,
  estadoDeMarcado,
  etiquetaEstado,
  etiquetaEstadoFiltro,
  etiquetaLectura,
  etiquetaNoLeidas,
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

/** Reintento de la acción de lectura: una fila concreta o la bandeja entera. */
type Reintento = { tipo: 'una'; id: string; leer: boolean } | { tipo: 'todas' };

/** Mensaje en línea de una acción de lectura, con su reintento opcional. */
type AvisoLectura = {
  texto: string;
  tipo: 'ok' | 'error';
  reintento: Reintento | null;
};

/**
 * Centro de notificaciones.
 *
 * Listado paginado en servidor con filtro por estado de lectura en la URL,
 * agrupado por día en la tabla. El contador de no leídas sale del sobre
 * (`noLeidas`), no de una segunda consulta ni de las filas visibles, así que
 * vale para toda la bandeja y no sólo para la página.
 *
 * «Marcar como leída» usa `POST /v1/notifications/{id}/leer`; «Desmarcar» usa
 * `PATCH /v1/notifications/{id}` con `estado=pendiente`; «Marcar todas» usa
 * `POST /v1/notifications/leer-todas`. Tras cada acción se recarga lista y
 * contador.
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

    .contador {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: 999px;
      background: #eef3f7;
      color: #4f6480;
      font: 700 12px/1.4 var(--font-display);
      white-space: nowrap;
    }

    .contador-vacio {
      background: #f1f3f5;
      color: #687783;
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

    .data-table tr.grupo-dia td {
      background: #f6f8fa;
      border-top: 1px solid var(--line);
      color: #5f7690;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }

    .data-table tr.grupo-dia td small {
      margin-left: 6px;
      color: #8b97a2;
      font-weight: 500;
      text-transform: none;
      letter-spacing: 0;
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

  private readonly listado = consulta({
    fuente: () => {
      const { pagina, tamano, estado } = this.parametros();
      return urlConParametros(urlApi('/v1/notifications'), {
        ...paramsDePagina({ pagina, tamano }),
        estado,
      });
    },
    esquema: aColeccionNotificaciones,
  });

  readonly notificaciones = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);

  /** Contador de no leídas del servidor; `null` mientras no llega la respuesta. */
  readonly sinLeer = computed(() => this.listado.valor()?.noLeidas ?? null);

  readonly textoContador = computed(() => etiquetaNoLeidas(this.sinLeer()));

  /** El botón «Marcar todas» sólo se habilita si hay algo sin leer. */
  readonly puedeMarcarTodas = computed(() => (this.sinLeer() ?? 0) > 0);

  readonly estadoListado = this.listado.estado;
  readonly errorListado = this.listado.error;

  /** Fila cuya lectura se está guardando; bloquea las demás acciones. */
  readonly enviandoId = signal<string | null>(null);

  /** Acción «marcar todas» en curso. */
  readonly marcandoTodas = signal(false);

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
    lectura: (notificacion) => notificacion.leida,
    vence: (notificacion) => notificacion.venceEn,
    registrada: (notificacion) => notificacion.creadaEn,
    registro: (notificacion) => notificacion.entidadCodigo ?? notificacion.seccion?.etiqueta ?? '',
  };

  readonly filasVisibles = computed(() =>
    this.orden.ordenar(this.notificaciones(), this.accesores),
  );

  /** Filas visibles agrupadas por día de registro, conservando el orden. */
  readonly grupos = computed(() => agruparPorDia(this.filasVisibles()));

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
    partes.push(`${this.textoContador()} en la bandeja`);
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

  lecturaEtiqueta(notificacion: Notificacion): string {
    return etiquetaLectura(notificacion.estado, notificacion.leidoEn);
  }

  lecturaClase(notificacion: Notificacion): string {
    return claseLectura(notificacion.estado, notificacion.leidoEn);
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
    if (!notificacion.id || this.enviandoId() || this.marcandoTodas()) return;
    if (leida) {
      this.enviarLeer(notificacion.id);
    } else {
      this.enviarDesmarcar(notificacion.id);
    }
  }

  /** Marca como leídas todas las notificaciones sin leer de la bandeja. */
  marcarTodas(): void {
    if (this.enviandoId() || this.marcandoTodas() || !this.puedeMarcarTodas()) return;
    this.enviarLeerTodas();
  }

  /** Reintenta la última acción de lectura que falló. */
  reintentarLectura(): void {
    const aviso = this.aviso();
    if (!aviso?.reintento || this.enviandoId() || this.marcandoTodas()) return;

    const reintento = aviso.reintento;
    if (reintento.tipo === 'todas') {
      this.enviarLeerTodas();
    } else if (reintento.leer) {
      this.enviarLeer(reintento.id);
    } else {
      this.enviarDesmarcar(reintento.id);
    }
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
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  private enviarLeer(id: string): void {
    this.enviandoId.set(id);
    this.aviso.set(null);

    this.http
      .post<unknown>(urlApi(`/v1/notifications/${encodeURIComponent(id)}/leer`), {})
      .subscribe({
        next: () => {
          this.enviandoId.set(null);
          this.aviso.set({
            tipo: 'ok',
            texto: 'Notificación marcada como leída.',
            reintento: null,
          });
          this.recargar();
        },
        error: (fallo: unknown) => {
          this.enviandoId.set(null);
          this.aviso.set({
            tipo: 'error',
            texto: this.mensajeDeError(fallo),
            reintento: { tipo: 'una', id, leer: true },
          });
        },
      });
  }

  private enviarDesmarcar(id: string): void {
    this.enviandoId.set(id);
    this.aviso.set(null);

    this.http
      .patch<unknown>(urlApi(`/v1/notifications/${encodeURIComponent(id)}`), {
        estado: estadoDeMarcado(false),
      })
      .subscribe({
        next: () => {
          this.enviandoId.set(null);
          this.aviso.set({
            tipo: 'ok',
            texto: 'Notificación devuelta a «sin leer».',
            reintento: null,
          });
          this.recargar();
        },
        error: (fallo: unknown) => {
          this.enviandoId.set(null);
          this.aviso.set({
            tipo: 'error',
            texto: this.mensajeDeError(fallo),
            reintento: { tipo: 'una', id, leer: false },
          });
        },
      });
  }

  private enviarLeerTodas(): void {
    this.marcandoTodas.set(true);
    this.aviso.set(null);

    this.http.post<unknown>(urlApi('/v1/notifications/leer-todas'), {}).subscribe({
      next: (bruto) => {
        this.marcandoTodas.set(false);
        const actualizadas = this.actualizadasDe(bruto);
        this.aviso.set({
          tipo: 'ok',
          texto:
            actualizadas === 0
              ? 'No había notificaciones sin leer.'
              : `Se marcaron ${actualizadas} ${
                  actualizadas === 1 ? 'notificación' : 'notificaciones'
                } como leídas.`,
          reintento: null,
        });
        this.recargar();
      },
      error: (fallo: unknown) => {
        this.marcandoTodas.set(false);
        this.aviso.set({
          tipo: 'error',
          texto: this.mensajeDeError(fallo),
          reintento: { tipo: 'todas' },
        });
      },
    });
  }

  private actualizadasDe(bruto: unknown): number {
    if (typeof bruto === 'object' && bruto !== null && 'actualizadas' in bruto) {
      const valor = (bruto as { actualizadas: unknown }).actualizadas;
      if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    }
    return 0;
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
