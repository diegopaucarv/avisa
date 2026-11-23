import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from '../../shared/ui/territorio-buscador.component';
import { ActorPanelComponent } from './actor-panel.component';
import { alternarActorLista, quitarActorLista } from './lista-temporal';
import { crearCsvPadronAsistencia } from './padron-asistencia';
import {
  NATURALEZAS,
  aActorDirectorio,
  aCatalogosDirectorio,
  type ActorDirectorio,
  type CatalogosDirectorio,
} from './directorio.mapeo';

type FiltrosActores = {
  q: string;
  naturaleza: string;
  tipo: string;
  region: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosActores = {
  q: '',
  naturaleza: '',
  tipo: '',
  region: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Directorio · Actores.
 *
 * Listado paginado en servidor (`GET /api/v1/actors`) con los filtros que acepta
 * el repositorio: `q`, `naturaleza`, `tipo` y `region`. Los filtros viven en la
 * URL con `replaceUrl` para que el historial no se llene de estados intermedios.
 *
 * La región se elige con el buscador territorial, no escribiendo el nombre: la
 * API compara `core.regiones.nombre` de forma exacta y `core.actores` tiene
 * región (355 de 1 160) pero no distrito (0 de 1 160), así que el grano honesto
 * del filtro es la región del distrito elegido.
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
    ExportarMenuComponent,
    TerritorioBuscadorComponent,
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

    /* El buscador territorial entra en la barra como un filtro más. */
    .territorio-filtro {
      width: 240px;
      min-width: 0;
    }

    .actor-nombre {
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font-family: inherit;
      text-align: left;
      cursor: pointer;
    }

    .actor-organizacion {
      max-width: 240px;
      white-space: normal;
    }

    .actor-actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 9.5px;
    }

    .lista-contador {
      display: inline-grid;
      min-width: 18px;
      height: 18px;
      margin-left: 4px;
      place-items: center;
      border-radius: 999px;
      background: #eaf1fb;
      color: #2455a2;
      font-size: 10px;
      font-weight: 700;
    }

    .button-lista {
      min-height: 27px;
      padding: 0 8px;
    }

    .lista-temporal-panel {
      padding: 14px 16px;
      border: 1px solid #dce5ef;
      border-radius: 9px;
      background: #fff;
      box-shadow: 0 4px 16px rgb(25 45 68 / 5%);
    }

    .lista-temporal-cabecera,
    .lista-temporal-acciones,
    .lista-temporal-items li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .lista-temporal-cabecera h2 {
      margin: 0;
      color: #1a2b3e;
      font: 700 14px/1.4 var(--font-display);
    }

    .lista-temporal-cabecera p,
    .lista-temporal-vacia {
      margin: 4px 0 0;
      color: #7b8896;
      font-size: 11px;
      line-height: 1.5;
    }

    .lista-temporal-items {
      display: grid;
      gap: 0;
      margin: 12px 0 0;
      padding: 0;
      list-style: none;
    }

    .lista-temporal-items li {
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
      font-size: 11px;
    }

    .lista-temporal-items span {
      color: #8a98a5;
      font-size: 10px;
    }

    .lista-quitar {
      flex: none;
      padding: 5px 8px;
      border: 1px solid #dce3e8;
      border-radius: 5px;
      background: #fff;
      color: #526577;
      font-size: 10px;
    }

    .padron-dialogo {
      width: min(520px, calc(100vw - 32px));
      padding: 0;
      border: 1px solid #dce5ef;
      border-radius: 12px;
      color: #26384a;
      box-shadow: 0 24px 70px rgb(10 20 30 / 28%);
    }

    .padron-dialogo::backdrop {
      background: rgb(12 20 29 / 62%);
      backdrop-filter: blur(3px);
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
      font: 700 17px/1.35 var(--font-display);
    }

    .padron-form p {
      color: #68798a;
      font-size: 12px;
      line-height: 1.5;
    }

    .padron-form label {
      display: grid;
      gap: 5px;
      color: #465a6c;
      font-size: 11px;
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
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class ActoresPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);

  readonly naturalezas = NATURALEZAS;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        naturaleza: params.get('naturaleza') ?? '',
        tipo: params.get('tipo') ?? '',
        region: params.get('region') ?? '',
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

  /** Región activa como etiqueta del buscador territorial restaurado. */
  readonly regionFiltroInicial = computed(() => {
    const region = this.filtros().region;
    return region ? { id: 0, nombre: region } : null;
  });

  private readonly listado = consulta<Coleccion<ActorDirectorio>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/actors'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        naturaleza: filtros.naturaleza,
        tipo: filtros.tipo,
        region: filtros.region,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aActorDirectorio) };
    },
  });

  readonly actores = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
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

  /** Actor cuya ficha está abierta en el panel lateral. */
  readonly seleccionado = signal<ActorDirectorio | null>(null);

  /** Selección de trabajo en memoria, conservada al cambiar página o filtros. */
  readonly listaTemporal = signal<ActorDirectorio[]>([]);
  readonly listaTemporalAbierta = signal(false);
  readonly padronTitulo = signal('');
  readonly padronLugar = signal('');
  readonly padronFecha = signal(new Date().toLocaleDateString('en-CA'));
  private readonly dialogoPadron = viewChild<ElementRef<HTMLDialogElement>>('dialogoPadron');

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizadorBusqueda);
    });
  }

  abrir(actor: ActorDirectorio): void {
    this.seleccionado.set(actor);
  }

  estaEnLista(actor: ActorDirectorio): boolean {
    return this.listaTemporal().some((seleccionado) => seleccionado.id === actor.id);
  }

  alternarLista(actor: ActorDirectorio, evento?: Event): void {
    evento?.stopPropagation();
    this.listaTemporal.update((actual) => alternarActorLista(actual, actor));
  }

  quitarDeLista(id: string): void {
    this.listaTemporal.update((actual) => quitarActorLista(actual, id));
  }

  vaciarLista(): void {
    this.listaTemporal.set([]);
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
    enlace.download = 'padron-asistencia.csv';
    enlace.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.dialogoPadron()?.nativeElement.close();
  }

  cerrarPanel(): void {
    this.seleccionado.set(null);
  }

  alActualizarActor(actor: ActorDirectorio): void {
    this.seleccionado.set(actor);
    this.listaTemporal.update((actual) =>
      actual.map((seleccionado) => (seleccionado.id === actor.id ? actor : seleccionado)),
    );
    this.listado.recargar();
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  cambiarNaturaleza(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ naturaleza: valor, pagina: 1 });
  }

  cambiarTipo(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    void this.actualizar({ tipo: valor, pagina: 1 });
  }

  /**
   * El buscador entrega un distrito (o lugar) y aquí se usa su **región**: es el
   * único grano territorial que `core.actores` guarda hoy. Un distrito del
   * Callao o de Lima sigue funcionando porque la región viene resuelta.
   */
  alElegirTerritorio(opcion: OpcionTerritorio | null): void {
    void this.actualizar({ region: opcion?.region ?? '', pagina: 1 });
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
        naturaleza: siguiente.naturaleza || null,
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
