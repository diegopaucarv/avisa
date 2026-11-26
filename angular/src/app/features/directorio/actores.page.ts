import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
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
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';

import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import {
  AnularPanelComponent,
  type ResultadoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { ActorPanelComponent } from './actor-panel.component';
import { ActorPanelAltaComponent, type NaturalezaAlta } from './actor-panel-alta.component';
import { ActorPanelFusionComponent } from './actor-panel-fusion.component';
import { alternarActorLista, etiquetaItemLista, quitarActorListaPorIndice } from './lista-temporal';
import { crearCsvPadronAsistencia } from './padron-asistencia';
import {
  aActorDirectorio,
  aCatalogosDirectorio,
  aMembresiaActor,
  SIN_DATO,
  type ActorDirectorio,
  type CatalogosDirectorio,
  type MembresiaActor,
} from './directorio.mapeo';
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
    PaginacionComponent,
    ActorPanelComponent,
    ActorPanelAltaComponent,
    ActorPanelFusionComponent,
    AnularPanelComponent,
    BarraSeleccionComponent,
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
      /* Espacio inferior extra: el botón flotante de la lista temporal vive ahí. */
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

    /* Menú «Nuevo»: alta no disponible en este entorno. */
    .menu-nuevo {
      position: relative;
    }

    .menu-nuevo summary {
      list-style: none;
      cursor: pointer;
      user-select: none;
    }

    /* «Nuevo» es un <summary>: se iguala al alto del resto de botones. */
    .menu-nuevo-toggle {
      padding: 0 11px;
      line-height: 1;
      font-size: 12.5px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
    }

    .menu-nuevo summary::-webkit-details-marker {
      display: none;
    }

    .menu-nuevo-lista {
      position: absolute;
      right: 0;
      z-index: 30;
      display: grid;
      gap: 2px;
      min-width: 190px;
      margin-top: 4px;
      padding: 6px;
      border: 1px solid #dce5ef;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 12px 32px rgb(25 45 68 / 14%);
    }

    .menu-nuevo-lista button {
      padding: 7px 10px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #465a6c;
      font: inherit;
      text-align: left;
    }

    .menu-nuevo-lista button:disabled {
      color: #aab4bd;
      cursor: not-allowed;
    }

    .menu-nuevo-lista button:not(:disabled):hover {
      background: #f5f7f8;
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

    .boton-copiar-icono {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: 0;
      background: none;
      color: #526577;
      cursor: pointer;
    }

    .boton-copiar-icono:hover {
      color: #1f5597;
    }

    .col-acciones {
      width: 1%;
    }

    .acciones-fila {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      white-space: nowrap;
    }

    .accion {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 1px solid #dce3e8;
      border-radius: 6px;
      background: #fff;
      color: #526577;
      cursor: pointer;
    }

    .accion:hover:not(:disabled) {
      background: #f5f7f8;
    }

    .accion:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .accion.activa {
      border-color: #1f5597;
      color: #1f5597;
      background: #eef3fa;
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

    /*
      Botón flotante de la lista temporal. z-index 60: por encima de la
      cabecera (30) y del menú lateral (41), pero por debajo del velo modal
      (80). El desplazamiento inferior respeta el área segura de los móviles.
    */
    .lista-temporal-fab {
      position: fixed;
      right: 28px;
      bottom: calc(28px + env(safe-area-inset-bottom, 0px));
      z-index: 60;
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 12px 16px;
      border: 1px solid #cfd9e2;
      border-radius: 999px;
      background: #1f5597;
      color: #fff;
      font: 600 13px/1 var(--font-body, inherit);
      box-shadow: 0 10px 26px rgb(17 32 45 / 22%);
      cursor: pointer;
    }

    .lista-temporal-fab:hover {
      background: #1a4a85;
    }

    .lista-temporal-fab:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    /* Sin actores la lista sigue accesible, pero no llama la atención. */
    .lista-temporal-fab-vacia {
      border-color: #cfd9e2;
      background: #fff;
      color: #465a6c;
      box-shadow: 0 8px 20px rgb(17 32 45 / 12%);
    }

    .lista-temporal-fab-vacia:hover {
      background: #f5f7f8;
    }

    .lista-temporal-contador {
      min-width: 22px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgb(255 255 255 / 22%);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: center;
    }

    .lista-temporal-fab-vacia .lista-temporal-contador {
      background: #eef2f6;
      color: #526577;
    }

    /* El cajón de la lista temporal no necesita los 600 px de una ficha. */
    .lista-temporal-drawer {
      width: min(420px, 100%);
      gap: 12px;
      padding: 18px 18px 14px;
    }

    .lista-temporal-cabecera {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .lista-temporal-cabecera h2 {
      margin: 0;
      color: #1a2b3e;
      font: 700 15px/1.4 var(--font-display);
    }

    .lista-temporal-cabecera p,
    .lista-temporal-vacia {
      margin: 4px 0 0;
      color: #7b8896;
      font-size: 13px;
      line-height: 1.5;
    }

    .lista-temporal-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    /* La lista puede crecer sin límite: sólo este cuerpo se desplaza. */
    .lista-temporal-cuerpo {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
    }

    .lista-temporal-items {
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .lista-temporal-items li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
      padding: 9px 0;
      border-top: 1px solid #edf0f2;
    }

    .lista-temporal-items li > div {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .lista-temporal-items strong {
      color: #465a6c;
      font-size: 13px;
    }

    .lista-temporal-items span {
      color: #8a98a5;
      font-size: 12.5px;
    }

    .lista-quitar {
      flex: none;
      padding: 5px 8px;
      border: 1px solid #dce3e8;
      border-radius: 5px;
      background: #fff;
      color: #526577;
      font-size: 12.5px;
      cursor: pointer;
    }

    /* El diálogo nativo se centra en la ventana: margen automático y alto guiado. */
    .padron-dialogo {
      position: fixed;
      inset: 0;
      width: min(520px, calc(100vw - 32px));
      height: fit-content;
      max-height: calc(100vh - 40px);
      margin: auto;
      padding: 0;
      border: 1px solid #dce5ef;
      border-radius: 12px;
      color: #26384a;
      box-shadow: 0 24px 70px rgb(10 20 30 / 28%);
    }

    .padron-dialogo::backdrop {
      background: var(--modal-velo);
    }

    .padron-form {
      display: grid;
      gap: 14px;
      padding: 20px;
    }

    .padron-form h2,
    .padron-form p {
      margin: 0;
    }

    .padron-form h2 {
      font: 700 17.5px/1.35 var(--font-display);
    }

    .padron-form p {
      color: #68798a;
      font-size: 14px;
      line-height: 1.5;
    }

    .padron-form label {
      display: grid;
      gap: 5px;
      color: #465a6c;
      font-size: 13px;
      font-weight: 600;
    }

    .padron-form input {
      min-width: 0;
      min-height: 38px;
      padding: 0 10px;
      border: 1px solid #cfd9e2;
      border-radius: 6px;
      background: #fff;
      color: #26384a;
      font: inherit;
    }

    .padron-form input:focus-visible {
      outline: 2px solid #3576c5;
      outline-offset: 2px;
    }

    .padron-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 2px;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 88px;
      }

      /* En pantallas angostas el botón se queda con el icono y el contador. */
      .lista-temporal-fab {
        right: 16px;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      }

      .lista-temporal-fab-texto {
        display: none;
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

  /** Selección de la tabla (página visible) para exportar. */
  readonly seleccion = new SeleccionTabla();

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

  /** Foto principal del actor para la columna de la tabla; `null` = sin foto. */
  fotoDe(actorId: string): Foto | null {
    return fotoPrincipal(this.fotosPorActor().get(actorId) ?? []);
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

  /** Selección de trabajo en memoria, conservada al cambiar página o filtros. */
  readonly listaTemporal = signal<ActorDirectorio[]>([]);
  readonly listaTemporalAbierta = signal(false);
  readonly padronTitulo = signal('');
  readonly padronLugar = signal('');
  readonly padronFecha = signal(new Date().toLocaleDateString('en-CA'));
  private readonly dialogoPadron = viewChild<ElementRef<HTMLDialogElement>>('dialogoPadron');

  /** Valor copiado recientemente, para confirmar la acción en la fila. */
  readonly copiado = signal<string | null>(null);
  private temporizadorCopiado?: ReturnType<typeof setTimeout>;

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizadorBusqueda);
      clearTimeout(this.temporizadorCopiado);
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
    return this.listaTemporal().some((seleccionado) => seleccionado.id === actor.id);
  }

  alternarLista(actor: ActorDirectorio, evento?: Event): void {
    evento?.stopPropagation();
    this.listaTemporal.update((actual) => alternarActorLista(actual, actor));
  }

  quitarDeListaPorIndice(indice: number): void {
    this.listaTemporal.update((actual) => quitarActorListaPorIndice(actual, indice));
  }

  /** «Cargo · OSPA» de un ítem de la lista temporal. */
  etiquetaListaTemporal(actor: ActorDirectorio): string {
    return etiquetaItemLista(actor, this.membresiasDe(actor)[0]?.nombre);
  }

  /**
   * Cierra la lista temporal. El clic dentro del cajón también burbujea hasta el
   * velo, así que sólo cerramos cuando el clic nació en el propio velo.
   */
  cerrarListaTemporal(evento: Event): void {
    if (evento.target !== evento.currentTarget) return;
    this.listaTemporalAbierta.set(false);
  }

  vaciarLista(): void {
    this.listaTemporal.set([]);
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

  abrirPadron(): void {
    if (!this.listaTemporal().length) return;
    this.padronTitulo.set('');
    this.padronLugar.set('');
    this.padronFecha.set(new Date().toISOString().slice(0, 10));
    this.listaTemporalAbierta.set(true);
    this.dialogoPadron()?.nativeElement.showModal();
  }

  descargarPadron(): void {
    const titulo = this.padronTitulo().trim();
    const lugar = this.padronLugar().trim();
    const fecha = this.padronFecha();
    if (!titulo || !lugar || !fecha) return;

    const contenido = crearCsvPadronAsistencia({
      titulo,
      lugar,
      fecha,
      actores: this.listaTemporal(),
    });
    const archivo = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(archivo);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = 'lista-de-asistencia.csv';
    enlace.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.dialogoPadron()?.nativeElement.close();
  }

  cerrarPanel(): void {
    this.seleccionado.set(null);
    this.editarAlAbrir.set(false);
  }

  alActualizarActor(actor: ActorDirectorio): void {
    this.seleccionado.set(actor);
    this.listaTemporal.update((actual) =>
      actual.map((seleccionado) => (seleccionado.id === actor.id ? actor : seleccionado)),
    );
    this.listado.recargar();
  }

  /** Abre el alta con la naturaleza elegida en el menú «Nuevo». */
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
