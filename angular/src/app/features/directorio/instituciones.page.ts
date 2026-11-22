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
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { ActorPanelComponent } from './actor-panel.component';
import {
  NATURALEZAS,
  TIPO_ACTOR_PUBLICO,
  aActorDirectorio,
  type ActorDirectorio,
} from './directorio.mapeo';

type FiltrosInstituciones = {
  q: string;
  naturaleza: string;
  region: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosInstituciones = {
  q: '',
  naturaleza: '',
  region: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Directorio · Instituciones.
 *
 * Es el mismo listado de actores restringido a `tipo=Actor público`: las
 * autoridades y entidades del Estado con competencia registrada. El tipo no se
 * expone como filtro porque la pantalla ya lo fija; se ignora cualquier `tipo`
 * que llegue por la URL y se limpia al navegar.
 *
 * Los datos personales siguen la misma regla que en Actores: sólo se piden
 * desde la ficha, con motivo auditado.
 */
@Component({
  selector: 'app-instituciones',
  imports: [IconoComponent, PaginacionComponent, ActorPanelComponent, ExportarMenuComponent],
  templateUrl: './instituciones.page.html',
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

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class InstitucionesPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);

  readonly naturalezas = NATURALEZAS;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        naturaleza: params.get('naturaleza') ?? '',
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

  private readonly listado = consulta<Coleccion<ActorDirectorio>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/actors'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        naturaleza: filtros.naturaleza,
        tipo: TIPO_ACTOR_PUBLICO,
        region: filtros.region,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aActorDirectorio) };
    },
  });

  readonly instituciones = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly estado = this.listado.estado;
  readonly error = this.listado.error;

  /** Actor público cuya ficha está abierta en el panel lateral. */
  readonly seleccionado = signal<ActorDirectorio | null>(null);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  private temporizadorBusqueda?: ReturnType<typeof setTimeout>;
  private temporizadorRegion?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizadorBusqueda);
      clearTimeout(this.temporizadorRegion);
    });
  }

  abrir(actor: ActorDirectorio): void {
    this.seleccionado.set(actor);
  }

  cerrarPanel(): void {
    this.seleccionado.set(null);
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

  /** La API compara el nombre de la región de forma exacta; se envía tal cual. */
  cambiarRegion(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorRegion);
    this.temporizadorRegion = setTimeout(() => {
      void this.actualizar({ region: valor, pagina: 1 });
    }, 300);
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    clearTimeout(this.temporizadorBusqueda);
    clearTimeout(this.temporizadorRegion);
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

  private actualizar(cambios: Partial<FiltrosInstituciones>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    this.cerrarPanel();

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        naturaleza: siguiente.naturaleza || null,
        region: siguiente.region || null,
        // El tipo queda fijado por la pantalla: si la URL traía otro, se retira.
        tipo: null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
