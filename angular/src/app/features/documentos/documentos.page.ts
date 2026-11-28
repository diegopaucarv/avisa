import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

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
import { esRegistro, lista } from '../../dominio/mapeo';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';
import { IconoComponent } from '../../shared/ui/icono.component';

import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ClicFila,
  type ColumnaTabla,
  type OrdenColumna,
} from '../../shared/ui/tabla.component';
import {
  AnularPanelComponent,
  type ModoAnulacion,
  type ResultadoAnulacion,
} from '../../shared/ui/anular-panel.component';
import {
  FILTROS_ESTADO,
  ORDENES_DOCUMENTO,
  aDocumento,
  aDetalleDocumento,
  aNormativa,
  aOtroDocumento,
  aTiposDocumento,
  agruparDocumentosPorTipo,
  claseEstado,
  etapaFlujo,
  etiquetaAnexo,
  formatearFecha,
  formatearFechaHora,
  ordenarAlfabetico,
  type Documento,
  type Normativa,
  type OpcionCatalogo,
  type OtroDocumento,
} from './documento.mapeo';
import { DocumentoPanelComponent } from './documento-panel.component';

type FiltrosDocumentos = {
  q: string;
  tipo: string;
  estado: string;
  /** Sólo llega por URL; no hay control visible en esta pantalla. */
  caso: string;
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
  caso: '',
  orden: 'recent',
  pagina: 1,
  tamano: TAMANO_PAGINA,
  ver: 'activos',
};

/** Sobre de `GET /api/v1/documents/arbol`: documentos y las dos ramas no documentales. */
type ArbolDocumentos = {
  documentos: Documento[];
  normativas: Normativa[];
  otros: OtroDocumento[];
};

/** `total` del sobre paginado sin construir las filas (consultas de indicadores). */
function totalDe(bruto: unknown): number {
  return normalizarColeccion<unknown>(bruto).total;
}

/** «Otro (sin clasificar)» es la bolsa del catálogo: se lista al final. */
function esBolsaOtros(opcion: OpcionCatalogo): boolean {
  return opcion.valor === 'otro' || /^otros?\b/i.test(opcion.etiqueta.trim());
}

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
    BarraSeleccionComponent,
    TablaComponent,
    CeldaTablaDirectiva,
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

    .view-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .exportar-error {
      margin: 0;
      color: #b42318;
      font-size: 12.5px;
    }

    .aviso-ok {
      margin: 0;
      color: var(--green);
      font-size: 13.5px;
    }

    .table-link {
      cursor: pointer;
      font-family: inherit;
      text-align: left;
    }

    .celda-titulo {
      display: block;
      max-width: 340px;
      white-space: normal;
    }

    .celda-tipo small,
    .celda-caso small {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
    }

    .celda-caso strong {
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 600;
    }

    .celda-caso {
      display: block;
      white-space: normal;
    }

    .sin-dato {
      color: var(--muted);
      font-style: italic;
    }

    .actualizando {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
    }

    .arbol-documentos {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 14px;
    }

    .arbol-rama {
      border-left: 2px solid #dbe7f4;
      padding-left: 10px;
    }

    .arbol-rama summary {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 4px 0;
      color: #33475b;
      font-size: 13px;
      font-weight: 600;
    }

    .arbol-subrama {
      margin-left: 14px;
    }

    .arbol-cuenta {
      padding: 1px 7px;
      border-radius: 999px;
      background: #eaf1f8;
      color: #52677a;
      font-size: 12px;
      font-weight: 600;
    }

    .arbol-hojas {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 2px 0 8px 20px;
      padding: 0;
      list-style: none;
    }

    .arbol-hoja {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 5px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .arbol-hoja:hover,
    .arbol-hoja:focus-visible {
      background: #f2f6fa;
    }

    /* Filas del marco normativo y de otros documentos: informan, no abren ficha. */
    .arbol-hoja--estatica,
    .arbol-hoja--estatica:hover,
    .arbol-hoja--estatica:focus-visible {
      background: transparent;
      cursor: default;
    }

    .arbol-hoja-codigo {
      flex: 0 0 auto;
      color: #2f5f8f;
      font-size: 12px;
      font-weight: 600;
    }

    .arbol-hoja-titulo {
      flex: 1 1 auto;
      overflow: hidden;
      color: #465a6c;
      font-size: 12.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .arbol-hoja-etapa {
      flex: 0 0 auto;
    }

    .arbol-hoja-dato {
      flex: 0 0 auto;
      color: #52677a;
      font-size: 12px;
      white-space: nowrap;
    }

    .arbol-hoja-fecha {
      flex: 0 0 auto;
      color: #8d99a6;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
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
  private readonly registroSolicitado = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('registrar'))),
    { initialValue: null },
  );
  /** `?abrir=<id>`: documento que la búsqueda global pide abrir en el panel. */
  private readonly documentoAbiertoSolicitado = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('abrir'))),
    { initialValue: null },
  );
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
        caso: params.get('caso') ?? '',
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

  /** Vista del listado: árbol del RAG (por defecto) o tabla operativa. */
  readonly vista = signal<'arbol' | 'tabla'>('arbol');

  /** El árbol se sirve completo y sin paginar sólo fuera de la papelera. */
  readonly enArbol = computed(() => this.vista() === 'arbol' && !this.verPapelera());

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

  /**
   * Árbol completo del RAG. Se pide aparte del listado paginado y sólo cuando
   * la vista de árbol está activa: así «Todo» incluye todos los documentos y no
   * sólo la página visible. La papelera no usa árbol.
   */
  private readonly arbolListado = consulta<ArbolDocumentos>({
    fuente: () => {
      if (!this.enArbol()) return null;
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/documents/arbol'), {
        q: filtros.q,
        tipo: filtros.tipo,
        estado: filtros.estado,
        sort: filtros.orden,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      const sobre = esRegistro(bruto) ? bruto : {};
      return {
        documentos: coleccion.elementos.map(aDocumento),
        // Una respuesta antigua puede no traer las ramas: se leen como listas vacías.
        normativas: lista(sobre, ['normativas']).map(aNormativa),
        otros: lista(sobre, ['otros', 'otrosDocumentos', 'otros_documentos']).map(aOtroDocumento),
      } satisfies ArbolDocumentos;
    },
  });

  readonly documentosArbol = computed(() =>
    ordenarAlfabetico(this.arbolListado.valor()?.documentos ?? []),
  );
  readonly normativas = computed(() =>
    ordenarAlfabetico(this.arbolListado.valor()?.normativas ?? []),
  );
  readonly otrosDocumentos = computed(() =>
    ordenarAlfabetico(this.arbolListado.valor()?.otros ?? []),
  );

  /** El árbol se pagina en el cliente: el sobre del RAG llega completo. */
  readonly documentosArbolPagina = computed(() => {
    const documentos = this.documentosArbol();
    const { pagina, tamano } = this.parametros();
    const inicio = (pagina - 1) * tamano;
    return documentos.slice(inicio, inicio + tamano);
  });

  readonly estadoArbol = this.arbolListado.estado;
  readonly errorArbol = this.arbolListado.error;

  readonly rango = computed(() => {
    const valor = this.listado.valor();
    return valor ? rangoPagina(valor) : { desde: 0, hasta: 0 };
  });

  readonly resumenTabla = computed(() => {
    const rango = this.rango();
    return `${this.total()} documentos · ${rango.desde}–${rango.hasta} · pulse una fila para abrir la ficha en el panel lateral.`;
  });

  /**
   * Árbol del RAG: una rama por tipo documental, más «Normativas» y «Otros
   * documentos» tal como los devuelve el sobre del endpoint. El sobre llega
   * completo y se pagina en cliente (ver `documentosArbolPagina`), así que cada
   * página agrupa sus hojas y la navegación inferior recorre el árbol entero.
   */
  readonly arbol = computed(() =>
    agruparDocumentosPorTipo(this.enArbol() ? this.documentosArbolPagina() : this.documentos()),
  );

  /** Hojas del árbol, sumando todas las ramas. */
  readonly totalArbol = computed(
    () =>
      (this.enArbol() ? this.documentosArbol().length : this.documentos().length) +
      this.normativas().length +
      this.otrosDocumentos().length,
  );

  /**
   * El servidor aplica `q` a normativas y otros documentos, pero no `tipo`,
   * `estado` ni `caso`. Con alguno de esos filtros activo, las dos ramas se
   * ocultan en vez de mostrar listas que no corresponden al recorte.
   */
  readonly hayFiltroDocumental = computed(() => {
    const filtros = this.parametros();
    return Boolean(filtros.tipo || filtros.estado || filtros.caso);
  });

  /** Pie de la papelera: sólo lo que devuelve la API, sin estimar nada. */
  readonly resumenPapelera = computed(() => {
    const rango = this.rango();
    return `${this.total()} documentos anulados · ${rango.desde}–${rango.hasta}`;
  });

  /**
   * Indicadores de la pantalla (item 112): totales del servidor, no de la página
   * visible. Cada tarjeta repite el recorte de filtros con un `estado` adicional
   * y lee `total` con `pageSize=1`. Se ocultan en la papelera.
   */
  private contar(extra: Record<string, string>) {
    return consulta<number>({
      fuente: () => {
        const filtros = this.parametros();
        return urlConParametros(urlApi('/v1/documents'), {
          ...paramsDePagina({ pagina: 1, tamano: 1 }),
          anulados: filtros.ver === 'anulados' ? 'true' : '',
          q: filtros.q,
          tipo: filtros.tipo,
          estado: filtros.estado,
          sort: filtros.orden,
          ...extra,
        });
      },
      esquema: totalDe,
    });
  }

  private readonly conEstadoRec = this.contar({ estado: 'con_estado' });
  private readonly sinEstadoRec = this.contar({ estado: 'sin_estado' });
  private readonly validadosRec = this.contar({ estado: 'Validado' });

  readonly conEstado = computed(() => this.conEstadoRec.valor() ?? null);
  readonly sinEstado = computed(() => this.sinEstadoRec.valor() ?? null);
  readonly validados = computed(() => this.validadosRec.valor() ?? null);

  /**
   * Tipos del catálogo, no una lista escrita a mano: el filtro y el formulario
   * del panel usan el mismo vocabulario que la API. Se ordenan por etiqueta y
   * «Otro» queda al final, como bolsa del resto de categorías.
   */
  private readonly catalogo = consulta<readonly OpcionCatalogo[]>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aTiposDocumento,
  });

  readonly tipos = computed(() => {
    const opciones = [...(this.catalogo.valor() ?? [])];
    return opciones.sort((a, b) => {
      const aBolsa = esBolsaOtros(a);
      const bBolsa = esBolsaOtros(b);
      if (aBolsa !== bBolsa) return aBolsa ? 1 : -1;
      return a.etiqueta.localeCompare(b.etiqueta, 'es', { sensitivity: 'base' });
    });
  });

  /**
   * Categorías del filtro. «Reporte de Actividad» no se ofrece aquí: esos
   * reportes se consultan en su propia pantalla (`/reportes`).
   */
  readonly tiposFiltro = computed(() =>
    this.tipos().filter((tipo) => tipo.valor !== 'reporte_actividad'),
  );

  /** Documento mostrado al abrir la fila; `null` cierra el panel. */
  readonly seleccionadaId = signal<string | null>(null);

  /** Alta abierta en el panel; sin documento, el panel entra en modo alta. */
  readonly altaAbierta = signal(false);

  /** Aviso posterior a un alta correcta. */
  readonly avisoCreacion = signal<string | null>(null);

  /** El alta se ofrece a quien tiene permiso de escritura. */
  readonly puedeRegistrar = this.capacidades.puedeEditar;

  /** Selección de la tabla (página visible) para exportar o anular en lote. */
  readonly seleccion = new SeleccionTabla();

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Documento>();

  private readonly accesoresDocumento: Record<string, (documento: Documento) => unknown> = {
    codigo: (documento) => documento.codigo,
    titulo: (documento) => documento.titulo,
    tipo: (documento) => documento.tipoNombre || documento.tipo,
    caso: (documento) => documento.casoCode,
    responsable: (documento) => documento.responsableNombre,
    fecha: (documento) => documento.fecha,
    anulado: (documento) => documento.anuladoEn,
    etapa: (documento) => this.etapa(documento),
  };

  readonly filasVisibles = computed(() =>
    this.orden.ordenar(this.documentos(), this.accesoresDocumento),
  );

  /** Ids marcados, en una referencia estable para `app-tabla`. */
  readonly idsSeleccionados = computed(() => this.seleccion.lista());

  /** Columnas de la papelera: sólo lo que devuelve la API. */
  readonly columnasPapelera: readonly ColumnaTabla[] = [
    {
      clave: 'codigo',
      titulo: 'Código',
      ordenable: true,
      formato: (valor) => {
        const texto = valor as string | null;
        return texto && texto.trim() ? texto : 'Sin código';
      },
    },
    { clave: 'titulo', titulo: 'Título', ordenable: true },
    { clave: 'caso', titulo: 'Caso', ordenable: true },
    {
      clave: 'anulado',
      titulo: 'Fecha de anulación',
      ordenable: true,
      acceso: (fila) => (fila as Documento).anuladoEn,
      formato: (valor) => this.fechaHoraTexto(valor as string | null),
    },
    { clave: 'accion', titulo: 'Acción' },
  ];

  /** Columnas del listado activo. */
  readonly columnasListado: readonly ColumnaTabla[] = [
    { clave: 'codigo', titulo: 'Código', ordenable: true },
    { clave: 'titulo', titulo: 'Título', ordenable: true },
    { clave: 'tipo', titulo: 'Tipo', ordenable: true },
    { clave: 'caso', titulo: 'Caso', ordenable: true },
    {
      clave: 'responsable',
      titulo: 'Responsable',
      ordenable: true,
      acceso: (fila) => (fila as Documento).responsableNombre,
      formato: (valor) => (valor as string | null) || 'Sin dato',
    },
    {
      clave: 'fecha',
      titulo: 'Fecha',
      ordenable: true,
      acceso: (fila) => (fila as Documento).fecha,
      formato: (valor) => this.formatearFecha(valor as string | null),
    },
    { clave: 'etapa', titulo: 'Etapa', ordenable: true },
  ];

  /** Orden que pinta `app-tabla`; la página sigue ordenando con `OrdenTabla`. */
  readonly ordenTabla = computed<OrdenColumna | null>(() => {
    const clave = this.orden.columna();
    return clave ? { clave, direccion: this.orden.direccion() } : null;
  });

  alCambiarOrden(cambio: OrdenColumna | null): void {
    const clave = cambio?.clave ?? this.orden.columna();
    if (clave) this.orden.alternar(clave);
  }

  /** Refleja en `SeleccionTabla` lo que marca la tabla (barra de selección). */
  alCambiarSeleccion(ids: readonly string[]): void {
    const marcadas = new Set(ids);
    for (const id of this.seleccion.lista()) {
      if (!marcadas.has(id)) this.seleccion.alternar(id);
    }
    for (const id of ids) {
      if (!this.seleccion.esta(id)) this.seleccion.alternar(id);
    }
  }

  alClicFila(evento: ClicFila): void {
    this.abrir(evento.fila as Documento);
  }

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Fallo al abrir por `?abrir=`, cuando el documento pedido no se puede leer. */
  readonly errorApertura = signal<string | null>(null);

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
    effect(() => {
      if (this.registroSolicitado() !== 'documento') return;
      this.abrirAlta();
      void this.router.navigate([], {
        relativeTo: this.ruta,
        queryParams: { registrar: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
    // La búsqueda global llega con `?abrir=<id>`: se pide el documento y se abre
    // el panel aunque su fila no esté en la página visible.
    effect(() => {
      const id = this.documentoAbiertoSolicitado();
      if (id) this.abrirDocumentoPorId(id);
    });
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

  etapa(documento: Documento): string {
    return etapaFlujo(documento);
  }

  cambiarVista(vista: 'arbol' | 'tabla'): void {
    this.vista.set(vista);
  }

  etiquetaAnexo(anexoNumero: number): string {
    return etiquetaAnexo(anexoNumero);
  }

  abrir(documento: Documento): void {
    if (!documento.id) return;
    this.cerrarAlta();
    this.respaldo.set(documento);
    this.seleccionadaId.set(documento.id);
  }

  abrirAlta(): void {
    if (!this.puedeRegistrar()) return;
    this.cerrarPanel();
    this.cerrarAnulacion();
    this.avisoCreacion.set(null);
    this.altaAbierta.set(true);
  }

  cerrarAlta(): void {
    this.altaAbierta.set(false);
  }

  /** Tras el `POST` correcto: cierra el panel, recarga el listado y avisa. */
  alCrearDocumento(documento: Documento): void {
    this.altaAbierta.set(false);
    const etiqueta = documento.codigo || documento.titulo || 'nuevo';
    this.avisoCreacion.set(`Documento ${etiqueta} registrado.`);
    if (this.verPapelera()) {
      void this.actualizar({ ver: 'activos', pagina: 1 });
      return;
    }
    this.alActualizar();
  }

  cerrarPanel(): void {
    this.seleccionadaId.set(null);
    this.respaldo.set(null);
    this.errorApertura.set(null);
    // Un `?abrir=` de la búsqueda no debe sobrevivir al cierre de la ficha.
    this.limpiarParametroAbrir();
  }

  /** Abre la ficha de un documento por id, venga o no del listado visible. */
  private abrirDocumentoPorId(id: string): void {
    this.errorApertura.set(null);
    firstValueFrom(
      this.http
        .get<unknown>(urlApi(`/v1/documents/${encodeURIComponent(id)}`))
        .pipe(takeUntilDestroyed(this.destruccion)),
    )
      .then((bruto) => {
        // El detalle responde `{ document, fuentes }`; el panel vuelve a pedirlo,
        // así que aquí sólo se necesita el documento para abrirlo.
        const documento = aDetalleDocumento(bruto).documento;
        if (!documento.id) {
          this.errorApertura.set('No se pudo leer el documento solicitado.');
          this.limpiarParametroAbrir();
          return;
        }
        this.abrir(documento);
      })
      .catch((fallo: unknown) => {
        this.errorApertura.set(aErrorApi(fallo).message);
        this.limpiarParametroAbrir();
      });
  }

  /** Quita `abrir` de la URL sin recargar la ruta ni el listado. */
  private limpiarParametroAbrir(): void {
    if (this.documentoAbiertoSolicitado() === null) return;
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { abrir: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  recargarListado(): void {
    this.listado.recargar();
    this.arbolListado.recargar();
  }

  recargarArbol(): void {
    this.arbolListado.recargar();
  }

  alAnularLote(cantidad: number): void {
    this.seleccion.limpiar();
    this.avisoAnulacion.set(
      cantidad === 1 ? '1 registro anulado.' : `${cantidad} registros anulados.`,
    );
    this.alActualizar();
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
    this.cerrarAlta();
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
    this.cerrarAlta();
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
    this.cerrarAlta();
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
