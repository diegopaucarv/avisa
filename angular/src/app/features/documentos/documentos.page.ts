import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  rangoPagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  AnularPanelComponent,
  type ModoAnulacion,
  type ResultadoAnulacion,
} from '../../shared/ui/anular-panel.component';
import {
  FILTROS_ESTADO,
  ORDENES_DOCUMENTO,
  aDocumento,
  aTiposDocumento,
  claseEstado,
  etiquetaAnexo,
  formatearFecha,
  formatearFechaHora,
  type Documento,
  type OpcionCatalogo,
} from './documento.mapeo';
import { DocumentoPanelComponent } from './documento-panel.component';

type FiltrosDocumentos = {
  q: string;
  tipo: string;
  estado: string;
  orden: string;
  pagina: number;
  tamano: number;
  ver: VerRegistros;
};

/** La papelera lista sólo lo anulado; «activos» es la vista de siempre. */
type VerRegistros = 'activos' | 'anulados';

const FILTROS_INICIALES: FiltrosDocumentos = {
  q: '',
  tipo: '',
  estado: '',
  orden: 'recent',
  pagina: 1,
  tamano: TAMANO_PAGINA,
  ver: 'activos',
};

/**
 * Documentos: anexos y formatos de la Guía (§7.7.1, §8.3.3; Anexos 1–17).
 *
 * Maestro-detalle en una sola vista: listado con paginación de servidor y
 * filtros en la URL (`replaceUrl`), y `DocumentoPanelComponent` como panel
 * lateral derecho con la ficha del documento seleccionado. Pulsar una fila no
 * navega a otra ruta.
 *
 * Los filtros se envían con los nombres que acepta `GET /api/v1/documents`
 * (`lib/db/repos/documents.ts`): `q`, `caso`, `tipo`, `estado` y `sort`.
 */
@Component({
  selector: 'app-documentos',
  imports: [
    IconoComponent,
    PaginacionComponent,
    DocumentoPanelComponent,
    AnularPanelComponent,
    ExportarMenuComponent,
  ],
  templateUrl: './documentos.page.html',
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

    .view-acciones {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }

    .exportar-error {
      margin: 0;
      color: #b42318;
      font-size: 10px;
    }

    .aviso-ok {
      margin: 0;
      color: #2f6f52;
      font-size: 11.5px;
    }

    .fila-documento {
      cursor: pointer;
    }

    .fila-documento:hover td,
    .fila-documento:focus-within td {
      background: #fbfcfd;
    }

    .data-table .table-link {
      cursor: pointer;
      font-family: inherit;
      text-align: left;
    }

    .celda-titulo {
      max-width: 340px;
      white-space: normal;
    }

    .celda-tipo small,
    .celda-caso small {
      display: block;
      margin-top: 3px;
      color: #99a3aa;
      font-size: 8px;
    }

    .celda-caso strong {
      color: #465a6c;
      font-size: 9px;
      font-weight: 600;
    }

    .celda-caso {
      white-space: normal;
    }

    .sin-dato {
      color: #a0aab3;
      font-style: italic;
    }

    .actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 9.5px;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class DocumentosPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);

  /** La papelera sólo se ofrece a quien puede anular y restaurar. */
  readonly puedeVerPapelera = this.capacidades.puedeEliminar;

  readonly estados = FILTROS_ESTADO;
  readonly ordenes = ORDENES_DOCUMENTO;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        tipo: params.get('tipo') ?? '',
        estado: params.get('estado') ?? '',
        orden: params.get('orden') ?? 'recent',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        ver: params.get('ver') === 'anulados' ? 'anulados' : 'activos',
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  /** `?ver=anulados`: el listado muestra la papelera. */
  readonly verPapelera = computed(() => this.parametros().ver === 'anulados');

  private readonly listado = consulta<Coleccion<Documento>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/documents'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        anulados: filtros.ver === 'anulados' ? 'true' : '',
        q: filtros.q,
        tipo: filtros.tipo,
        estado: filtros.estado,
        sort: filtros.orden,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aDocumento),
      } satisfies Coleccion<Documento>;
    },
  });

  readonly documentos = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly estadoListado = this.listado.estado;
  readonly errorListado = this.listado.error;

  readonly rango = computed(() => {
    const valor = this.listado.valor();
    return valor ? rangoPagina(valor) : { desde: 0, hasta: 0 };
  });

  readonly resumenTabla = computed(() => {
    const rango = this.rango();
    return `${this.total()} documentos · ${rango.desde}–${rango.hasta} · pulse una fila para abrir la ficha en el panel lateral. «Cargado» filtra el estado heredado «Activo»; los documentos sin estado se filtran aparte.`;
  });

  /** Pie de la papelera: sólo lo que devuelve la API, sin estimar nada. */
  readonly resumenPapelera = computed(() => {
    const rango = this.rango();
    return `${this.total()} documentos anulados · ${rango.desde}–${rango.hasta}`;
  });

  /**
   * Tipos del catálogo, no una lista escrita a mano: el filtro y el formulario
   * del panel usan el mismo vocabulario que la API.
   */
  private readonly catalogo = consulta<readonly OpcionCatalogo[]>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aTiposDocumento,
  });

  readonly tipos = computed(() => this.catalogo.valor() ?? []);

  /** Documento mostrado al abrir la fila; `null` cierra el panel. */
  readonly seleccionadaId = signal<string | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Documento que se está anulando en el panel compartido. */
  readonly documentoAnulacion = signal<Documento | null>(null);
  readonly enviandoAnulacion = signal(false);
  readonly errorAnulacion = signal<string | null>(null);
  readonly avisoAnulacion = signal<string | null>(null);

  /** Modo del panel compartido: anular pide motivo, restaurar no. */
  readonly modoAnulacion = signal<ModoAnulacion>('anular');

  private readonly respaldo = signal<Documento | null>(null);

  /**
   * Si el listado se recarga (o cambia de página) se usa la fila vigente por
   * identificador y, sólo si ya no está, la copia con la que se abrió el panel.
   * Así el panel no queda desfasado tras guardar.
   */
  readonly documentoAbierto = computed(() => {
    const id = this.seleccionadaId();
    if (!id) return null;
    return this.documentos().find((documento) => documento.id === id) ?? this.respaldo();
  });

  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizador));
  }

  formatearFecha(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  fechaHoraTexto(valor: string | null | undefined): string {
    return formatearFechaHora(valor);
  }

  claseEstado(estado: string | null): string {
    return claseEstado(estado);
  }

  etiquetaAnexo(anexoNumero: number): string {
    return etiquetaAnexo(anexoNumero);
  }

  abrir(documento: Documento): void {
    if (!documento.id) return;
    this.respaldo.set(documento);
    this.seleccionadaId.set(documento.id);
  }

  cerrarPanel(): void {
    this.seleccionadaId.set(null);
    this.respaldo.set(null);
  }

  recargarListado(): void {
    this.listado.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  alActualizar(): void {
    this.listado.recargar();
  }

  /** Anular exige el privilegio de anulación y escritura sobre la clasificación. */
  puedeAnular(documento: Documento): boolean {
    return (
      this.capacidades.puedeEliminar() && this.capacidades.puedeModificar(documento.clasificacion)
    );
  }

  abrirAnulacion(documento: Documento): void {
    if (!documento.id || !this.puedeAnular(documento)) return;
    this.errorAnulacion.set(null);
    this.avisoAnulacion.set(null);
    // El panel del documento y el de anulación escuchan Escape en `document`:
    // se deja abierto uno solo.
    this.cerrarPanel();
    this.modoAnulacion.set('anular');
    this.documentoAnulacion.set(documento);
  }

  /**
   * Restaurar desde la papelera: no pide motivo. No se abre el panel de detalle
   * porque `GET /v1/documents/{id}` responde 404 mientras el registro está
   * anulado; la acción vive en la propia fila.
   */
  abrirRestauracion(documento: Documento): void {
    if (!documento.id || !this.puedeVerPapelera()) return;
    this.errorAnulacion.set(null);
    this.avisoAnulacion.set(null);
    this.cerrarPanel();
    this.modoAnulacion.set('restaurar');
    this.documentoAnulacion.set(documento);
  }

  cerrarAnulacion(): void {
    this.documentoAnulacion.set(null);
    this.errorAnulacion.set(null);
  }

  /**
   * `DELETE /v1/documents/{id}` con `{ motivo }` es la anulación lógica: la fila
   * deja de devolverse. Restaurar no lleva cuerpo. No se navega: se recarga el
   * listado y los filtros y la página de la URL se conservan.
   */
  confirmarAnulacion(resultado: ResultadoAnulacion): void {
    const documento = this.documentoAnulacion();
    if (!documento?.id) return;

    const anular = resultado.modo === 'anular';
    const motivo = (resultado.motivo ?? '').trim();
    if (anular && !motivo) return;

    const id = encodeURIComponent(documento.id);
    const peticion = anular
      ? this.http.delete<unknown>(urlApi(`/v1/documents/${id}`), { body: { motivo } })
      : this.http.post<unknown>(urlApi(`/v1/documents/${id}/restaurar`), null);

    this.enviandoAnulacion.set(true);
    this.errorAnulacion.set(null);

    peticion.subscribe({
      next: () => {
        this.enviandoAnulacion.set(false);
        this.documentoAnulacion.set(null);
        const etiqueta = documento.codigo || documento.titulo || 'seleccionado';
        this.avisoAnulacion.set(
          anular ? `Documento ${etiqueta} anulado.` : `Documento ${etiqueta} restaurado.`,
        );
        this.alActualizar();
      },
      error: (fallo: unknown) => {
        this.enviandoAnulacion.set(false);
        this.errorAnulacion.set(aErrorApi(fallo).message);
      },
    });
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarTipo(evento: Event): void {
    void this.actualizar({ tipo: this.valorDe(evento), pagina: 1 });
  }

  cambiarEstado(evento: Event): void {
    void this.actualizar({ estado: this.valorDe(evento), pagina: 1 });
  }

  cambiarOrden(evento: Event): void {
    void this.actualizar({ orden: this.valorDe(evento), pagina: 1 });
  }

  /** Cambia entre activos y papelera; reinicia a la primera página y cierra el panel. */
  cambiarVer(ver: VerRegistros): void {
    this.cerrarPanel();
    this.cerrarAnulacion();
    void this.actualizar({ ver, pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    clearTimeout(this.temporizador);
    void this.router.navigate([], {
      relativeTo: this.ruta,
      // `ver` no es un filtro: se conserva la pestaña (activos o papelera).
      queryParams: { ver: this.verPapelera() ? 'anulados' : null },
      replaceUrl: true,
    });
  }

  /**
   * Navegación simple entre filas: las flechas mueven el foco al botón de la
   * fila anterior o siguiente. Enter abre la ficha con el botón nativo.
   */
  moverFoco(evento: Event, paso: -1 | 1): void {
    evento.preventDefault();

    const fila = (evento.currentTarget as HTMLElement | null)?.closest('tr');
    const destino = paso > 0 ? fila?.nextElementSibling : fila?.previousElementSibling;
    destino?.querySelector<HTMLElement>('button.table-link')?.focus();
  }

  private valorDe(evento: Event): string {
    return (evento.target as HTMLSelectElement).value;
  }

  private actualizar(cambios: Partial<FiltrosDocumentos>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        tipo: siguiente.tipo || null,
        estado: siguiente.estado || null,
        orden: siguiente.orden !== 'recent' ? siguiente.orden : null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
        ver: siguiente.ver === 'anulados' ? 'anulados' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
