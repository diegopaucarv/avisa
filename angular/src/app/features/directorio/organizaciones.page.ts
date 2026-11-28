import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
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
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import {
  aFoto,
  esFotoPintable,
  fotoPrincipal,
  fotosPorEntidad,
  type Foto,
} from '../../dominio/medios';
import {
  AnularPanelComponent,
  type ResultadoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';
import {
  formatearFechaCompacta,
  formatearFechaHora,
  partesFecha,
} from '../../shared/formato-fecha';

import { FotoFichaComponent } from '../../shared/ui/foto-ficha.component';
import { BotonAccionComponent } from '../../shared/ui/boton-accion.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { esDialogoSuperior } from '../../shared/ui/modal-salida';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ClicFila,
  type ColumnaTabla,
  type OrdenColumna,
} from '../../shared/ui/tabla.component';
import { ActorPanelComponent } from './actor-panel.component';
import { ActorPanelAltaComponent, type NaturalezaAlta } from './actor-panel-alta.component';
import {
  TIPO_ACTOR_PUBLICO,
  aActorDirectorio,
  aCatalogosDirectorio,
  type ActorDirectorio,
  type CatalogosDirectorio,
} from './directorio.mapeo';
import {
  TIPOS_ORGANIZACION,
  aActorDesdeApi,
  aOrganizacionDirectorio,
  type OrganizacionDirectorio,
} from './organizacion.mapeo';
import { ListaAsistenciaComponent } from './lista-asistencia.component';
import { ListaAsistenciaService } from './lista-asistencia.service';

type FiltrosOrganizaciones = {
  q: string;
  tipo: string;
  activo: string;
  vigente: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosOrganizaciones = {
  q: '',
  tipo: '',
  activo: '',
  vigente: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Directorio · Organizaciones.
 *
 * Listado paginado en servidor (`GET /api/v1/organizaciones`) con los filtros
 * que acepta el repositorio: `q`, `tipo`, `activo` y `vigente`. Los filtros
 * viven en la URL con `replaceUrl` para no llenar el historial.
 *
 * Al pulsar una fila se abre la ficha en un panel lateral; no se navega. La
 * ficha muestra los campos reales de `core.organizaciones` y del actor
 * colectivo, con «—» donde la base no tiene dato. La región se toma del actor
 * y, si falta, se deriva de la de sus integrantes; los integrantes se listan
 * por nombre con `GET /v1/actors?organizacion=<id>`.
 *
 * `?alta=organizacion` (o `?alta=institucion`) abre el alta directamente, para
 * los enlaces que llegan desde la ficha de un actor.
 */
@Component({
  selector: 'app-organizaciones',
  imports: [
    IconoComponent,
    BotonAccionComponent,
    PaginacionComponent,
    BarraSeleccionComponent,
    TablaComponent,
    CeldaTablaDirectiva,
    FotoFichaComponent,
    ActorPanelComponent,
    ActorPanelAltaComponent,
    AnularPanelComponent,
    ListaAsistenciaComponent,
  ],
  templateUrl: './organizaciones.page.html',
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
      /* Espacio inferior extra: el botón flotante de la lista de asistencia vive ahí. */
      padding: 27px 34px 96px;
      box-sizing: border-box;
    }

    .view-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .org-nombre {
      display: flex;
      flex-direction: column;
      gap: 2px;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
    }

    .org-nombre small {
      color: var(--muted);
      font-size: 12px;
    }

    .org-razon {
      display: block;
      max-width: 260px;
      white-space: normal;
    }

    .tabla-foto {
      display: block;
      width: 32px;
      height: 32px;
      object-fit: cover;
      border-radius: 6px;
      background: #f6f8fa;
    }

    .org-actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 12px;
    }

    .sin-dato {
      color: var(--muted);
      font-style: italic;
    }

    .boton-ver-actores {
      padding: 4px 10px;
      font-size: 12px;
      white-space: nowrap;
    }

    .drawer {
      width: min(560px, 100%);
    }

    /* El cuerpo se queda con el alto libre para que el pie quede anclado abajo. */
    .drawer-body {
      flex: 1;
      min-height: 0;
    }

    .ficha-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .ficha-cabecera-acciones {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }

    .ficha-etiqueta {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .ficha-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }

    .ficha-chip {
      background: #f0f3f5;
      color: #657684;
    }

    .ficha-activo {
      background: #edf4ef;
      color: #557a64;
    }

    .ficha-inactivo {
      background: #fff3e5;
      color: #a6732d;
    }

    .ficha-seccion {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ficha-seccion h3 {
      margin: 0;
      color: #7b8896;
      font: 700 11.5px var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .ficha-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px 16px;
      margin: 0;
    }

    .ficha-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .ficha-datos dt {
      color: #97a1aa;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .ficha-conteo {
      margin: 0;
      color: #465a6c;
      font-size: 13px;
      font-weight: 600;
    }

    .ficha-integrantes {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0 0 0 18px;
      color: #465a6c;
      font-size: 13px;
      line-height: 1.45;
    }

    .ficha-nota {
      margin: 0;
      color: #97a1aa;
      font-size: 12px;
      line-height: 1.4;
    }

    .ficha-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .ficha-perfil {
      margin: 0;
      color: #52677a;
      font-size: 13px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .ficha-vacio {
      margin: 0;
      color: #a0aab3;
      font-size: 13px;
      font-style: italic;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 88px;
      }
    }
  `,
})
export class OrganizacionesPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly destruccion = inject(DestroyRef);
  private readonly injector = inject(Injector);

  /** La edición y la baja lógica exigen `puede_editar` en la base. */
  readonly capacidades = inject(CapacidadesService);

  readonly tipos = TIPOS_ORGANIZACION;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        tipo: params.get('tipo') ?? '',
        activo: params.get('activo') ?? '',
        vigente: params.get('vigente') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.min(
          100,
          Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        ),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  /** `?alta=organizacion|institucion` abre el alta al entrar desde otra vista. */
  private readonly altaSolicitada = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('alta'))),
    { initialValue: null },
  );

  private readonly listado = consulta<Coleccion<OrganizacionDirectorio>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/organizaciones'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        tipo: filtros.tipo,
        activo: filtros.activo,
        vigente: filtros.vigente,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aOrganizacionDirectorio) };
    },
  });

  readonly organizaciones = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);

  /**
   * Lista de asistencia de la sesión, compartida con el directorio de actores.
   * Marcar una organización la añade; al exportar se expanden sus integrantes.
   */
  readonly lista = inject(ListaAsistenciaService);

  /** Entradas de organización de la lista de asistencia. */
  readonly organizacionesEnLista = computed(() =>
    this.lista.entradas().filter((entrada) => entrada.tipo === 'organizacion'),
  );

  /** Ids de organizaciones en la lista, en una referencia estable para `app-tabla`. */
  readonly idsSeleccionados = computed(() =>
    this.organizacionesEnLista().map((entrada) => entrada.actor.id),
  );

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<OrganizacionDirectorio>();

  /**
   * Columnas del listado. El nombre va primero porque `app-tabla` reserva
   * 200 px a la celda que nombra la fila; con la foto delante, la miniatura de
   * 32 px estiraría toda la columna.
   */
  readonly columnas: readonly ColumnaTabla[] = [
    { clave: 'nombre', titulo: 'Nombre', ordenable: true },
    { clave: 'foto', titulo: 'Foto', ancho: '46px' },
    { clave: 'tipo', titulo: 'Tipo', ordenable: true },
    { clave: 'ruc', titulo: 'RUC / razón social', ordenable: true },
    {
      clave: 'integrantes',
      titulo: 'Integrantes',
      ordenable: true,
      acceso: (fila) => (fila as unknown as OrganizacionDirectorio).numeroIntegrantes,
    },
    {
      clave: 'vigencia',
      titulo: 'Vigencia',
      ordenable: true,
      acceso: (fila) =>
        (fila as unknown as OrganizacionDirectorio).vigenciaDesde ??
        (fila as unknown as OrganizacionDirectorio).vigenciaHasta,
      formato: (_valor, fila) => this.periodoVigencia(fila as unknown as OrganizacionDirectorio),
    },
    { clave: 'estadoOspa', titulo: 'Estado OSPA', ordenable: true },
    { clave: 'actores', titulo: 'Actores', ancho: '116px' },
  ];

  /** Orden que pinta `app-tabla`; la página ordena con `OrdenTabla`. */
  readonly ordenTabla = computed<OrdenColumna | null>(() => {
    const clave = this.orden.columna();
    return clave ? { clave, direccion: this.orden.direccion() } : null;
  });

  private readonly accesores: Record<string, (fila: OrganizacionDirectorio) => unknown> = {
    nombre: (fila) => fila.nombre,
    tipo: (fila) => fila.tipo,
    ruc: (fila) => fila.ruc ?? fila.razonSocial,
    integrantes: (fila) => fila.numeroIntegrantes,
    vigencia: (fila) => fila.vigenciaDesde ?? fila.vigenciaHasta,
    estadoOspa: (fila) => fila.estadoOspa,
  };

  readonly filasVisibles = computed(() =>
    this.orden.ordenar(this.organizaciones(), this.accesores),
  );

  alCambiarOrden(cambio: OrdenColumna | null): void {
    const clave = cambio?.clave ?? this.orden.columna();
    if (clave) this.orden.alternar(clave);
  }

  /** Refleja en la lista de asistencia lo que marca la tabla de organizaciones. */
  alCambiarSeleccion(ids: readonly string[]): void {
    // Una organización sin id real llega como `#índice`: no se puede exportar.
    const marcadas = new Set(ids.filter((id) => !!id && !id.startsWith('#')));

    // Quita de la lista las que la tabla dejó de marcar.
    for (const entrada of this.organizacionesEnLista()) {
      if (!marcadas.has(entrada.actor.id)) this.lista.quitar(entrada.actor.id);
    }

    // Añade las recién marcadas; sus datos salen de la página visible.
    const enPagina = new Map(this.organizaciones().map((org) => [org.id, org]));
    for (const id of marcadas) {
      if (this.lista.esta(id)) continue;
      const org = enPagina.get(id);
      if (org) this.lista.alternar(this.actorDeOrganizacion(org), 'organizacion');
    }
  }

  /**
   * Ficha mínima del directorio para tratar una organización como entrada de la
   * lista. La organización no firma: al exportar se cambia por sus integrantes.
   */
  private actorDeOrganizacion(org: OrganizacionDirectorio): ActorDirectorio {
    return {
      id: org.id,
      nombre: org.nombre,
      abreviatura: org.abreviatura,
      naturaleza: 'Organización',
      tipo: org.tipo,
      funcion: null,
      posicionamiento: null,
      cargo: null,
      nivelGobierno: null,
      categoria: null,
      region: org.region,
      distrito: null,
      organizacionAncla: null,
      validado: false,
      activo: org.activo,
      clasificacion: 2,
      perfil: org.perfil,
      expedienteOspa: org.expedienteOspa,
      estadoOspa: org.estadoOspa,
      vigenciaDesde: org.vigenciaDesde,
      vigenciaHasta: org.vigenciaHasta,
      ruc: org.ruc,
      numeroIntegrantes: org.numeroIntegrantes,
      localesDelActor: [],
    };
  }

  alClicFila(evento: ClicFila): void {
    this.abrir(evento.fila as unknown as OrganizacionDirectorio);
  }

  /**
   * Lleva al directorio de personas filtrado por esta organización. El nombre
   * viaja sólo como etiqueta de pantalla; el filtro real es el `id`.
   */
  verActores(organizacion: unknown, evento?: Event): void {
    evento?.stopPropagation();
    if (!organizacion || typeof organizacion !== 'object') return;

    const fila = organizacion as Partial<OrganizacionDirectorio>;
    const id = fila.id;
    if (!id) return;

    void this.router.navigate(['/directorio/personas'], {
      queryParams: {
        organizacion: id,
        organizacionNombre: fila.nombre || null,
      },
    });
  }

  idsVisibles(): string[] {
    return this.organizaciones()
      .map((organizacion) => organizacion.id)
      .filter((id): id is string => !!id);
  }

  /** Fotos de la página visible en una sola petición (`entidadIds`). */
  private readonly fotosPagina = consulta<Map<string, Foto[]>>({
    fuente: () => {
      const ids = this.idsVisibles();
      if (ids.length === 0) return null;
      return urlConParametros(urlApi('/v1/media'), {
        entidadTipo: 'organizacion',
        entidadIds: ids.join(','),
        pageSize: '200',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return fotosPorEntidad(coleccion.elementos.map(aFoto).filter(esFotoPintable));
    },
  });

  readonly fotosPorOrganizacion = computed(
    () => this.fotosPagina.valor() ?? new Map<string, Foto[]>(),
  );

  /** Foto principal de la organización; `null` = sin foto registrada. */
  fotoDe(organizacionId: string): Foto | null {
    return fotoPrincipal(this.fotosPorOrganizacion().get(organizacionId) ?? []);
  }
  readonly estado = this.listado.estado;
  readonly error = this.listado.error;

  /** Organización cuya ficha está abierta en el panel lateral. */
  readonly seleccionado = signal<OrganizacionDirectorio | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Fallo de una acción (editar, baja); vacío si no hubo. */
  readonly errorAccion = signal<string | null>(null);

  /** Detalle del actor colectivo: aporta la región propia de la organización. */
  private readonly detalleActorConsulta = consulta<ActorDirectorio>({
    fuente: () => {
      const id = this.seleccionado()?.id;
      if (!id) return null;
      return urlApi(`/v1/actors/${encodeURIComponent(id)}`);
    },
    esquema: aActorDesdeApi,
  });
  readonly detalleActor = this.detalleActorConsulta.valor;

  /** Integrantes con pertenencia vigente, por nombre, para la ficha. */
  private readonly integrantesConsulta = consulta<{ personas: ActorDirectorio[]; total: number }>({
    fuente: () => {
      const id = this.seleccionado()?.id;
      if (!id) return null;
      return urlConParametros(urlApi('/v1/actors'), {
        organizacion: id,
        ...paramsDePagina({ pagina: 1, tamano: 25 }),
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { personas: coleccion.elementos.map(aActorDirectorio), total: coleccion.total };
    },
  });
  readonly integrantes = computed(() => this.integrantesConsulta.valor()?.personas ?? []);
  readonly integrantesTotal = computed(() => this.integrantesConsulta.valor()?.total ?? 0);
  /** Primeros nombres visibles; el resto se resume con «y X más». */
  readonly integrantesVisibles = computed(() => this.integrantes().slice(0, 6));
  readonly integrantesRestantes = computed(() =>
    Math.max(0, this.integrantesTotal() - this.integrantesVisibles().length),
  );
  readonly estadoIntegrantes = this.integrantesConsulta.estado;

  /**
   * Región de la ficha: la propia del actor colectivo o, si falta, la más
   * frecuente entre sus integrantes. `derivada` avisa de que no es un dato
   * declarado de la organización.
   */
  readonly regionFicha = computed<{ valor: string; derivada: boolean } | null>(() => {
    const org = this.seleccionado();
    if (!org) return null;

    const propia = org.region ?? this.detalleActor()?.region ?? null;
    if (propia) return { valor: propia, derivada: false };

    const conteo = new Map<string, number>();
    for (const persona of this.integrantes()) {
      if (!persona.region) continue;
      conteo.set(persona.region, (conteo.get(persona.region) ?? 0) + 1);
    }

    let elegida: string | null = null;
    let maximo = 0;
    for (const [region, cantidad] of conteo) {
      if (cantidad > maximo) {
        maximo = cantidad;
        elegida = region;
      }
    }
    return elegida ? { valor: elegida, derivada: true } : null;
  });

  /** Registro que se edita en `app-actor-panel`; `null` cuando está cerrado. */
  readonly actorEdicion = signal<ActorDirectorio | null>(null);
  readonly cargandoEdicion = signal(false);

  /** Baja lógica o restauración pendiente de confirmar. */
  readonly bajaAbierta = signal<{
    id: string;
    nombre: string;
    codigo: string | null;
    modo: 'anular' | 'restaurar';
  } | null>(null);
  readonly enviandoBaja = signal(false);
  readonly errorBaja = signal<string | null>(null);

  /** `null` = alta cerrada; la naturaleza fija el bloque del formulario. */
  readonly altaNaturaleza = signal<NaturalezaAlta | null>(null);
  /** Tipo de actor preseleccionado en el alta (`?alta=institucion`). */
  readonly altaTipo = signal('');

  /** Regiones del catálogo para el select de la edición. */
  private readonly catalogos = consulta<CatalogosDirectorio>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosDirectorio,
  });
  readonly regionesCatalogo = computed(() => this.catalogos.valor()?.regiones ?? []);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private focoPrevio: HTMLElement | null = null;

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizadorBusqueda));

    // `?alta=…` abre el modal y desaparece de la URL: recargar no lo reabre.
    effect(() => {
      const alta = this.altaSolicitada();
      if (!alta) return;

      const valida = alta === 'organizacion' || alta === 'institucion';
      if (valida && this.capacidades.puedeEditar()) {
        this.altaTipo.set(alta === 'institucion' ? TIPO_ACTOR_PUBLICO : '');
        this.altaNaturaleza.set('organizacion');
      }

      void this.router.navigate([], {
        relativeTo: this.ruta,
        queryParams: { alta: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    if (typeof document !== 'undefined') {
      // Escape cierra la ficha sólo si está encima: con el panel de edición o
      // la baja abiertos, el que se cierra es el de arriba.
      const alEscape = (evento: KeyboardEvent): void => {
        if (evento.key !== 'Escape' || !this.seleccionado()) return;
        if (!esDialogoSuperior(this.panel()?.nativeElement)) return;
        evento.preventDefault();
        this.cerrarPanel();
      };
      document.addEventListener('keydown', alEscape);
      this.destruccion.onDestroy(() => document.removeEventListener('keydown', alEscape));
    }
  }

  abrir(organizacion: OrganizacionDirectorio): void {
    const estabaCerrado = this.seleccionado() === null;
    if (estabaCerrado && typeof document !== 'undefined') {
      const activo = document.activeElement;
      this.focoPrevio = activo instanceof HTMLElement ? activo : null;
    }

    this.seleccionado.set(organizacion);
    afterNextRender(() => this.panel()?.nativeElement.focus({ preventScroll: true }), {
      injector: this.injector,
    });
  }

  cerrarPanel(): void {
    if (this.seleccionado() === null) return;

    this.seleccionado.set(null);
    const previo = this.focoPrevio;
    this.focoPrevio = null;
    afterNextRender(() => previo?.focus(), { injector: this.injector });
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarTipo(evento: Event): void {
    void this.actualizar({ tipo: (evento.target as HTMLSelectElement).value, pagina: 1 });
  }

  cambiarActivo(evento: Event): void {
    void this.actualizar({ activo: (evento.target as HTMLSelectElement).value, pagina: 1 });
  }

  cambiarVigente(evento: Event): void {
    void this.actualizar({ vigente: (evento.target as HTMLSelectElement).value, pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    clearTimeout(this.temporizadorBusqueda);
    this.cerrarPanel();
    this.cerrarEdicion();
    this.cerrarBaja();
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.listado.recargar();
  }

  /** Abre la edición de la organización desde el actor completo. */
  editar(org: OrganizacionDirectorio, evento?: Event): void {
    evento?.stopPropagation();
    if (!this.capacidades.puedeEditar() || !org.id) return;

    this.errorAccion.set(null);
    this.cargandoEdicion.set(true);
    this.actorEdicion.set(null);

    this.http
      .get<unknown>(urlApi(`/v1/actors/${encodeURIComponent(org.id)}`))
      .pipe(takeUntilDestroyed(this.destruccion))
      .subscribe({
        next: (bruto) => {
          this.cargandoEdicion.set(false);
          this.actorEdicion.set(aActorDesdeApi(bruto));
        },
        error: (fallo: unknown) => {
          this.cargandoEdicion.set(false);
          this.errorAccion.set(aErrorApi(fallo).message);
        },
      });
  }

  cerrarEdicion(): void {
    this.actorEdicion.set(null);
    this.cargandoEdicion.set(false);
  }

  /** Refleja lo guardado en la ficha y recarga el detalle y los integrantes. */
  alActualizarActor(actor: ActorDirectorio): void {
    this.actorEdicion.set(actor);
    this.seleccionado.update((actual) =>
      actual && actual.id === actor.id
        ? {
            ...actual,
            nombre: actor.nombre,
            abreviatura: actor.abreviatura,
            ruc: actor.ruc ?? actual.ruc,
            region: actor.region ?? actual.region,
            numeroIntegrantes: actor.numeroIntegrantes ?? actual.numeroIntegrantes,
            perfil: actor.perfil ?? actual.perfil,
            activo: actor.activo,
          }
        : actual,
    );

    this.listado.recargar();
    this.detalleActorConsulta.recargar();
    this.integrantesConsulta.recargar();
  }

  /** Abre la baja lógica (o la restauración) de la organización abierta. */
  abrirBaja(modo: 'anular' | 'restaurar', evento?: Event): void {
    evento?.stopPropagation();
    const org = this.seleccionado();
    if (!org || !org.id || !this.capacidades.puedeEditar()) return;

    this.errorBaja.set(null);
    this.bajaAbierta.set({ id: org.id, nombre: org.nombre, codigo: org.codigo, modo });
  }

  cerrarBaja(): void {
    this.bajaAbierta.set(null);
    this.errorBaja.set(null);
  }

  /** Ejecuta `POST …/baja` o `…/restaurar`; es un UPDATE, no borra el registro. */
  alConfirmarBaja(resultado: ResultadoAnulacion): void {
    const abierta = this.bajaAbierta();
    if (!abierta || this.enviandoBaja()) return;

    const esAnular = resultado.modo === 'anular';
    const url = urlApi(
      `/v1/actors/${encodeURIComponent(abierta.id)}/${esAnular ? 'baja' : 'restaurar'}`,
    );

    this.enviandoBaja.set(true);
    this.errorBaja.set(null);

    const peticion = esAnular
      ? this.http.post<unknown>(url, { motivo: resultado.motivo })
      : this.http.post<unknown>(url, {});

    peticion.pipe(takeUntilDestroyed(this.destruccion)).subscribe({
      next: (bruto) => {
        this.enviandoBaja.set(false);
        this.bajaAbierta.set(null);

        // Una organización dada de baja no debe seguir en la lista de asistencia.
        this.lista.quitar(abierta.id);

        const actor = aActorDesdeApi(bruto);
        if (this.actorEdicion()) this.actorEdicion.set(actor);
        this.seleccionado.update((actual) =>
          actual && actual.id === abierta.id ? { ...actual, activo: actor.activo } : actual,
        );
        this.listado.recargar();
        this.detalleActorConsulta.recargar();
      },
      error: (fallo: unknown) => {
        this.enviandoBaja.set(false);
        this.errorBaja.set(aErrorApi(fallo).message);
      },
    });
  }

  cerrarAlta(): void {
    this.altaNaturaleza.set(null);
    this.altaTipo.set('');
  }

  /** Tras crear la organización: cierra el alta y refresca el listado. */
  alCrearOrganizacion(_actor: ActorDirectorio): void {
    this.cerrarAlta();
    this.listado.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  /** `YYYY-MM-DD` → `02NOV2025`; cualquier otro valor se deja tal cual. */
  fecha(valor: string | null): string {
    if (!valor) return '—';
    return partesFecha(valor) ? formatearFechaCompacta(valor) : valor;
  }

  /** Marca de tiempo ISO → fecha compacta y hora: `02NOV2025 16:00`. */
  fechaHora(valor: string | null): string {
    return formatearFechaHora(valor);
  }

  /** RUC y razón social en una celda; «—» cuando no hay ninguno. */
  rucRazon(organizacion: OrganizacionDirectorio): string {
    const ruc = organizacion.ruc || '—';
    return organizacion.razonSocial ? `${ruc} · ${organizacion.razonSocial}` : ruc;
  }

  /** Vigencia con el dato disponible; nunca completa lo que la base no tiene. */
  periodoVigencia(organizacion: OrganizacionDirectorio): string {
    const { vigenciaDesde, vigenciaHasta } = organizacion;
    if (!vigenciaDesde && !vigenciaHasta) return '—';
    if (vigenciaDesde && vigenciaHasta) {
      return `${this.fecha(vigenciaDesde)} – ${this.fecha(vigenciaHasta)}`;
    }
    if (vigenciaDesde) return `Desde ${this.fecha(vigenciaDesde)}`;
    return `Hasta ${this.fecha(vigenciaHasta)}`;
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarPanel();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /** El panel es modal: Tab y Shift+Tab ciclan dentro de él. */
  private atraparFoco(evento: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const enfocables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;

    const activo = typeof document === 'undefined' ? null : document.activeElement;

    if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
      return;
    }

    if (evento.shiftKey && (activo === primero || !panel.contains(activo))) {
      evento.preventDefault();
      ultimo.focus();
    }
  }

  private actualizar(cambios: Partial<FiltrosOrganizaciones>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    // Cualquier cambio de consulta descarta la ficha abierta: así no queda una
    // organización de otro listado en pantalla.
    this.cerrarPanel();
    this.cerrarEdicion();
    this.cerrarBaja();

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        tipo: siguiente.tipo || null,
        activo: siguiente.activo || null,
        vigente: siguiente.vigente || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
