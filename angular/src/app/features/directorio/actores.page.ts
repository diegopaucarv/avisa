import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

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
  urlFoto,
  type Foto,
} from '../../dominio/medios';
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';
import { BotonAccionComponent } from '../../shared/ui/boton-accion.component';

import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import {
  AnularPanelComponent,
  type ResultadoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { ActorPanelComponent } from './actor-panel.component';
import { ActorPanelAltaComponent, type NaturalezaAlta } from './actor-panel-alta.component';
import { ActorPanelFusionComponent } from './actor-panel-fusion.component';
import {
  aActorDirectorio,
  aCatalogosDirectorio,
  aMembresiaActor,
  SIN_DATO,
  type ActorDirectorio,
  type CatalogosDirectorio,
  type MembresiaActor,
} from './directorio.mapeo';
import { ListaAsistenciaComponent } from './lista-asistencia.component';
import { ListaAsistenciaService } from './lista-asistencia.service';
import { HttpClient } from '@angular/common/http';

type FiltrosActores = {
  q: string;
  naturaleza: string;
  tipo: string;
  region: string;
  organizacion: string;
  organizacionNombre: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosActores = {
  q: '',
  naturaleza: '',
  tipo: '',
  region: '',
  organizacion: '',
  organizacionNombre: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/** Referencia estable para «sin membresías»; evita arrays nuevos en cada lectura. */
const SIN_MEMBRESIAS: MembresiaActor[] = [];

/**
 * Directorio · Actores.
 *
 * Listado paginado en servidor (`GET /api/v1/actors`) con los filtros que acepta
 * el repositorio: `q`, `naturaleza`, `tipo` y `region`. Los filtros viven en la
 * URL con `replaceUrl` para que el historial no se llene de estados intermedios.
 *
 * El listado de organizaciones vive en su propia entrada de la barra lateral
 * («Organizaciones», `organizaciones.page`): esta pantalla no alterna vistas ni
 * muestra pestañas. El parámetro `naturaleza` de la URL se mantiene por los
 * enlaces profundos y, sin él, se usa el valor por defecto de la ruta
 * (`/directorio/personas`) o «persona».
 *
 * Al pulsar una fila no se navega: se abre `ActorPanelComponent` con la ficha.
 * Los datos personales NO forman parte de la carga del listado; sólo el panel
 * los pide, a demanda y con motivo auditado.
 */
@Component({
  selector: 'app-actores',
  imports: [
    IconoComponent,
    BotonAccionComponent,
    PaginacionComponent,
    ActorPanelComponent,
    ActorPanelAltaComponent,
    ActorPanelFusionComponent,
    AnularPanelComponent,
    BarraSeleccionComponent,
    ListaAsistenciaComponent,
    ThOrdenDirective,
  ],
  templateUrl: './actores.page.html',
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
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .view-actions {
      flex-wrap: wrap;
    }

    .actor-nombre {
      display: -webkit-box;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font-family: inherit;
      text-align: left;
      white-space: normal;
      overflow: hidden;
      cursor: pointer;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
    }

    /* «Apellidos y nombres» ocupa la mitad del ancho que antes: tres líneas. */
    .col-nombre {
      width: 210px;
      min-width: 150px;
      max-width: 210px;
      white-space: normal;
    }

    /* Organización / Institución a la mitad del ancho anterior. */
    .actor-organizacion {
      max-width: 115px;
      white-space: normal;
    }

    /* El cargo va debajo de la organización, más pequeño que el nombre. */
    .actor-organizacion small {
      display: block;
      color: inherit;
      font-size: 11px;
      font-weight: 400;
    }

    .actor-organizaciones {
      display: grid;
      gap: 3px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /* El cargo va siempre debajo del nombre de la organización, no al lado. */
    .actor-organizaciones li {
      display: grid;
      gap: 1px;
    }

    .filtro-organizacion {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin: 0 0 12px;
      padding: 8px 12px;
      border: 1px solid #e8edf1;
      border-radius: 8px;
      background: #f7fafc;
      font-size: 13px;
    }

    .col-foto {
      width: 46px;
    }

    .tabla-foto {
      display: block;
      width: 32px;
      height: 32px;
      object-fit: cover;
      border-radius: 6px;
      background: #f6f8fa;
    }

    /* global.css fija white-space: nowrap en td; el contacto necesita dos líneas. */
    .actor-contacto {
      white-space: normal;
    }

    .contacto-linea {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .contacto-linea > span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    /* El correo va debajo del teléfono: 12 px y corte de palabra si no cabe. */
    .contacto-correo > span {
      font-size: 12px;
      word-break: break-word;
    }

    /* «sin dato» es información, no un error: tono apagado y sin icono de fallo. */
    .sin-dato {
      color: #97a1aa;
      font-size: 12.5px;
      font-style: italic;
    }

    .fila-inactiva .actor-nombre strong {
      color: #8a98a5;
    }

    .fila-inactiva {
      background: #fafbfc;
    }

    .actor-inactivo {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border: 1px solid #e2e7ec;
      border-radius: 999px;
      background: #f3f5f7;
      color: #7b8896;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.3px;
      text-transform: uppercase;
      vertical-align: middle;
    }

    .actor-actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 12px;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 88px;
      }
    }
  `,
})
export class ActoresPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);
  private readonly http = inject(HttpClient);

  /** Permisos de la sesión: escribir, anular y nivel de clasificación máximo. */
  readonly capacidades = inject(CapacidadesService);

  /** Texto único para un dato ausente; nunca se presenta como error. */
  readonly sinDato = SIN_DATO;

  /**
   * Naturaleza del listado. Las pestañas se retiraron: cada listado tiene su
   * entrada en la barra lateral y `organizaciones.page` cubre las
   * organizaciones, así que esta pantalla es siempre el directorio de personas.
   */
  readonly naturalezaFija = input('persona');

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        tipo: params.get('tipo') ?? '',
        region: params.get('region') ?? '',
        organizacion: params.get('organizacion') ?? '',
        organizacionNombre: params.get('organizacionNombre') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.min(
          100,
          Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
        ),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  /** `?abrir=<uid>`: actor que la búsqueda global pide abrir en el panel. */
  private readonly actorAbiertoSolicitado = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('abrir'))),
    { initialValue: null },
  );

  /** `persona` siempre: la naturaleza ya no se elige ni viaja por la URL. */
  private readonly naturalezaActiva = computed(() => this.naturalezaFija().trim() || 'persona');

  readonly filtros = computed<FiltrosActores>(() => ({
    ...this.parametros(),
    naturaleza: this.naturalezaActiva(),
  }));

  readonly titulo = computed(() => 'Actores');
  readonly sustantivo = computed(() =>
    this.naturalezaActiva() === 'organizacion' ? 'organizaciones' : 'personas',
  );

  private readonly listado = consulta<Coleccion<ActorDirectorio>>({
    fuente: () => {
      const filtros = this.filtros();
      return urlConParametros(urlApi('/v1/actors'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        naturaleza: filtros.naturaleza,
        tipo: filtros.tipo,
        region: filtros.region,
        organizacion: filtros.organizacion,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aActorDirectorio) };
    },
  });

  readonly actores = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);

  /**
   * Lista de asistencia de la sesión. Vive en un servicio raíz para no perderse
   * al cambiar de página ni al navegar entre actores y organizaciones.
   */
  readonly lista = inject(ListaAsistenciaService);

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<ActorDirectorio>();

  private readonly accesores: Record<string, (actor: ActorDirectorio) => unknown> = {
    nombre: (actor) => actor.nombre,
    region: (actor) => actor.region,
    organizacion: (actor) =>
      this.membresiasDe(actor)[0]?.nombre ?? actor.organizacionAncla ?? actor.cargo,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.actores(), this.accesores));

  idsVisibles(): string[] {
    return this.actores()
      .map((actor) => actor.id)
      .filter((id): id is string => !!id);
  }

  /** Entradas de persona de la lista; las organizaciones se marcan en su vista. */
  readonly personasEnLista = computed(() =>
    this.lista.entradas().filter((entrada) => entrada.tipo === 'persona'),
  );

  /** Ids de personas en la lista, para la barra de selección y la exportación. */
  readonly idsPersonasEnLista = computed(() =>
    this.personasEnLista().map((entrada) => entrada.actor.id),
  );

  /** Estado de la casilla de cabecera: toda la página visible está en la lista. */
  readonly todasVisiblesEnLista = computed(() => {
    const ids = this.idsVisibles();
    return ids.length > 0 && ids.every((id) => this.lista.esta(id));
  });

  /** Estado intermedio de la casilla de cabecera: hay parte de la página marcada. */
  readonly algunasVisiblesEnLista = computed(() => {
    const ids = this.idsVisibles();
    const marcadas = ids.filter((id) => this.lista.esta(id)).length;
    return marcadas > 0 && marcadas < ids.length;
  });

  /** Añade o quita toda la página visible de la lista de asistencia. */
  alternarPaginaLista(evento: Event): void {
    const marcar = (evento.target as HTMLInputElement).checked;
    this.lista.alternarVarios(this.actores(), 'persona', marcar);
  }

  /**
   * Fotos de la página visible en una sola petición (`entidadIds`). Si la
   * consulta falla, la columna queda en «—» y el listado sigue funcionando.
   */
  private readonly fotosPagina = consulta<Map<string, Foto[]>>({
    fuente: () => {
      const ids = this.idsVisibles();
      if (ids.length === 0) return null;
      return urlConParametros(urlApi('/v1/media'), {
        entidadTipo: 'actor',
        entidadIds: ids.join(','),
        pageSize: '200',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return fotosPorEntidad(coleccion.elementos.map(aFoto).filter(esFotoPintable));
    },
  });

  readonly fotosPorActor = computed(() => this.fotosPagina.valor() ?? new Map<string, Foto[]>());

  /**
   * Foto principal del actor para la columna de la tabla; `null` = sin foto.
   * La `url` ya viene resuelta por `urlFoto`, que prefiere el binario cuando el
   * medio lo declara, de modo que la plantilla sólo pinta `foto.url`.
   */
  fotoDe(actorId: string): Foto | null {
    const principal = fotoPrincipal(this.fotosPorActor().get(actorId) ?? []);
    return principal ? { ...principal, url: urlFoto(principal) } : null;
  }

  /**
   * Membresías vigentes de la página visible en una sola petición (`actorIds`),
   * igual que las fotos. Si falla, la columna cae al ancla del listado y la
   * tabla sigue funcionando.
   */
  private readonly membresiasPagina = consulta<Map<string, MembresiaActor[]>>({
    fuente: () => {
      const ids = this.idsVisibles();
      if (ids.length === 0) return null;
      return urlConParametros(urlApi('/v1/actors/membresias'), {
        actorIds: ids.join(','),
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      const mapa = new Map<string, MembresiaActor[]>();
      for (const item of coleccion.elementos) {
        const membresia = aMembresiaActor(item);
        if (!membresia) continue;
        const actuales = mapa.get(membresia.actorId) ?? [];
        actuales.push(membresia);
        mapa.set(membresia.actorId, actuales);
      }
      return mapa;
    },
  });

  readonly membresiasPorActor = computed<ReadonlyMap<string, MembresiaActor[]>>(
    () => this.membresiasPagina.valor() ?? new Map<string, MembresiaActor[]>(),
  );

  /** Organizaciones vigentes del actor; `[]` cuando no declara ninguna. */
  membresiasDe(actor: ActorDirectorio): MembresiaActor[] {
    return this.membresiasPorActor().get(actor.id) ?? SIN_MEMBRESIAS;
  }

  readonly estado = this.listado.estado;
  readonly error = this.listado.error;

  /**
   * Tipos de actor desde el catálogo, no escritos a mano. Si esta petición
   * falla el listado sigue siendo útil: sólo se omite el select de tipo.
   */
  private readonly catalogos = consulta<CatalogosDirectorio>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosDirectorio,
  });

  readonly tiposActor = computed(() => this.catalogos.valor()?.tiposActor ?? []);

  /** Regiones del catálogo territorial; alimentan el select de la ficha. */
  readonly regiones = computed(() => this.catalogos.valor()?.regiones ?? []);

  /** Actor cuya ficha está abierta en el panel lateral. */
  readonly seleccionado = signal<ActorDirectorio | null>(null);
  /** `true` cuando la ficha debe abrirse directamente en modo edición. */
  readonly editarAlAbrir = signal(false);

  /** `null` = cerrado; la naturaleza fija el bloque inicial del alta. */
  readonly altaNaturaleza = signal<NaturalezaAlta | null>(null);
  /** Actor abierto que se propone fusionar con otro. */
  readonly fusionOrigen = signal<ActorDirectorio | null>(null);
  /** Confirmación de baja o restauración pendiente. */
  readonly bajaAbierta = signal<{
    actor: ActorDirectorio;
    modo: 'anular' | 'restaurar';
  } | null>(null);
  readonly enviandoBaja = signal(false);
  readonly errorBaja = signal<string | null>(null);

  /** Valor copiado recientemente, para confirmar la acción en la fila. */
  readonly copiado = signal<string | null>(null);
  private temporizadorCopiado?: ReturnType<typeof setTimeout>;

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Fallo al abrir por `?abrir=`, cuando el actor pedido no se puede leer. */
  readonly errorApertura = signal<string | null>(null);

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizadorBusqueda);
      clearTimeout(this.temporizadorCopiado);
    });
    // La búsqueda global llega con `?abrir=<uid>`: se pide el actor y se abre el
    // panel aunque su fila no esté en la página visible.
    effect(() => {
      const uid = this.actorAbiertoSolicitado();
      if (uid) this.abrirActorPorUid(uid);
    });
  }

  abrir(actor: ActorDirectorio): void {
    this.editarAlAbrir.set(false);
    this.seleccionado.set(actor);
  }

  abrirEdicion(actor: ActorDirectorio, evento?: Event): void {
    evento?.stopPropagation();
    this.editarAlAbrir.set(true);
    this.seleccionado.set(actor);
  }

  estaEnLista(actor: ActorDirectorio): boolean {
    return this.lista.esta(actor.id);
  }

  alternarLista(actor: ActorDirectorio, evento?: Event): void {
    evento?.stopPropagation();
    this.lista.alternar(actor, 'persona');
  }

  /** Copia al portapapeles y confirma el valor copiado durante un instante. */
  copiar(valor: string | null | undefined, evento?: Event): void {
    evento?.stopPropagation();
    if (!valor) return;

    void navigator.clipboard?.writeText(valor);
    this.copiado.set(valor);
    clearTimeout(this.temporizadorCopiado);
    this.temporizadorCopiado = setTimeout(() => this.copiado.set(null), 1600);
  }

  cerrarPanel(): void {
    this.seleccionado.set(null);
    this.editarAlAbrir.set(false);
    this.errorApertura.set(null);
    // Un `?abrir=` de la búsqueda no debe sobrevivir al cierre de la ficha.
    this.limpiarParametroAbrir();
  }

  /** Abre la ficha de un actor por uid, venga o no del listado visible. */
  private abrirActorPorUid(uid: string): void {
    this.errorApertura.set(null);
    firstValueFrom(
      this.http
        .get<unknown>(urlApi(`/v1/actors/${encodeURIComponent(uid)}`))
        .pipe(takeUntilDestroyed(this.destruccion)),
    )
      .then((bruto) => {
        const actor = aActorDirectorio(bruto);
        if (!actor.id) {
          this.errorApertura.set('No se pudo leer el actor solicitado.');
          this.limpiarParametroAbrir();
          return;
        }
        this.abrir(actor);
      })
      .catch((fallo: unknown) => {
        this.errorApertura.set(aErrorApi(fallo).message);
        this.limpiarParametroAbrir();
      });
  }

  /** Quita `abrir` de la URL sin recargar el listado. */
  private limpiarParametroAbrir(): void {
    if (this.actorAbiertoSolicitado() === null) return;
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { abrir: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  alActualizarActor(actor: ActorDirectorio): void {
    this.seleccionado.set(actor);
    this.lista.actualizar(actor);
    this.listado.recargar();
    // La columna «Organización» de la tabla se pinta desde `/v1/actors/membresias`,
    // no desde el listado: se invalida para que refleje el vínculo recién editado
    // sin recargar la página. Su URL no cambia, así que el `effect` no la relanza.
    this.membresiasPagina.recargar();
  }

  /** Abre el alta con la naturaleza elegida (acción del encabezado del shell). */
  abrirAlta(naturaleza: NaturalezaAlta): void {
    this.altaNaturaleza.set(naturaleza);
  }

  cerrarAlta(): void {
    this.altaNaturaleza.set(null);
  }

  alCrearActor(actor: ActorDirectorio): void {
    this.altaNaturaleza.set(null);
    this.listado.recargar();
    this.abrir(actor);
  }

  /** La fusión necesita un actor de origen: el que está abierto en el panel. */
  abrirFusion(): void {
    const origen = this.seleccionado();
    if (!origen) return;
    this.fusionOrigen.set(origen);
  }

  cerrarFusion(): void {
    this.fusionOrigen.set(null);
  }

  alFusionar(): void {
    this.fusionOrigen.set(null);
    // El origen queda inactivo: se cierra su ficha y se refresca el listado.
    this.cerrarPanel();
    this.listado.recargar();
  }

  /** Abre la baja lógica —o la restauración— del actor seleccionado. */
  abrirBajaSeleccionado(): void {
    const actor = this.seleccionado();
    if (actor) this.abrirBaja(actor, actor.activo ? 'anular' : 'restaurar');
  }

  abrirBaja(actor: ActorDirectorio, modo: 'anular' | 'restaurar'): void {
    this.errorBaja.set(null);
    this.bajaAbierta.set({ actor, modo });
  }

  cerrarBaja(): void {
    this.bajaAbierta.set(null);
    this.errorBaja.set(null);
  }

  /** Ejecuta `POST …/baja` o `POST …/restaurar` según lo confirmado en el panel. */
  alConfirmarBaja(resultado: ResultadoAnulacion): void {
    const abierta = this.bajaAbierta();
    if (!abierta || this.enviandoBaja()) return;

    const { actor } = abierta;
    const esAnular = resultado.modo === 'anular';
    const url = urlApi(
      `/v1/actors/${encodeURIComponent(actor.id)}/${esAnular ? 'baja' : 'restaurar'}`,
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
        this.alActualizarActor(aActorDirectorio(bruto));
      },
      error: (fallo: unknown) => {
        this.enviandoBaja.set(false);
        this.errorBaja.set(aErrorApi(fallo).message);
      },
    });
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarTipo(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ tipo: valor, pagina: 1 });
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
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
    });
  }

  /** Quita sólo el filtro por organización y conserva el resto de filtros. */
  quitarFiltroOrganizacion(): void {
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { organizacion: null, organizacionNombre: null, pagina: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.listado.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  private actualizar(cambios: Partial<FiltrosActores>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    // Cualquier cambio de consulta descarta la ficha abierta: así no queda PII
    // en pantalla mientras el listado de fondo ya es otro.
    this.cerrarPanel();

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        tipo: siguiente.tipo || null,
        region: siguiente.region || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
