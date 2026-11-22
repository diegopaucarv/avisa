import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { TAMANO_PAGINA, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { MINIMO_TERMINO, aColeccionBusqueda, type ColeccionBusqueda } from './busqueda.mapeo';

type FiltrosBusqueda = {
  q: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosBusqueda = {
  q: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Búsqueda global.
 *
 * El término y la página viven en la URL (`replaceUrl`) y el término se
 * escribe con 300 ms de espera. Con menos de dos caracteres no se llama a la
 * API (`GET /api/v1/search` responde 422) y se muestra una invitación.
 *
 * La respuesta usa `results` como clave de la lista, que `normalizarColeccion`
 * no reconoce; el sobre se normaliza a mano en `busqueda.mapeo.ts`.
 */
@Component({
  selector: 'app-busqueda',
  imports: [RouterLink, IconoComponent, PaginacionComponent],
  templateUrl: './busqueda.page.html',
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

    .search-results {
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
    }

    .search-results li + li {
      border-top: 1px solid #f0f2f4;
    }

    .search-result {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      padding: 12px 14px;
      color: inherit;
      text-decoration: none;
    }

    a.search-result:hover,
    a.search-result:focus-visible {
      background: #fbfcfd;
    }

    .search-result-icono {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      flex: none;
      border-radius: 50%;
      background: #eef3f7;
      color: #5f7690;
    }

    .search-result-cuerpo {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .search-result-titulo {
      color: #33465a;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.4;
    }

    .search-result-subtitulo {
      color: #748391;
      font-size: 10px;
      line-height: 1.45;
    }

    .search-result-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      color: #8b97a2;
      font-size: 9px;
    }

    .search-result-tipo {
      padding: 3px 7px;
      border-radius: 12px;
      background: #f1f3f5;
      color: #687783;
      font-size: 9px;
      font-weight: 600;
      white-space: nowrap;
    }

    .search-result-codigo {
      color: #7f8c98;
      font-weight: 600;
      white-space: nowrap;
    }

    .search-result-flecha {
      flex: none;
      color: #9aa5ae;
      margin-top: 6px;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class BusquedaPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  /** Término efectivo; la API compara sin espacios en los extremos. */
  readonly termino = computed(() => this.parametros().q.trim());

  /**
   * Sin dos caracteres no hay petición: la ruta responde 422, no una lista
   * vacía. `consulta` acepta `null` y deja el estado en «inactivo».
   */
  private readonly busqueda = consulta<ColeccionBusqueda>({
    fuente: () => {
      const { pagina, tamano } = this.parametros();
      const termino = this.termino();
      if (termino.length < MINIMO_TERMINO) return null;

      return urlConParametros(urlApi('/v1/search'), {
        ...paramsDePagina({ pagina, tamano }),
        q: termino,
      });
    },
    esquema: aColeccionBusqueda,
  });

  readonly resultados = computed(() => this.busqueda.valor()?.elementos ?? []);
  readonly total = computed(() => this.busqueda.valor()?.total ?? 0);
  readonly estadoListado = this.busqueda.estado;
  readonly errorListado = this.busqueda.error;
  readonly consultaValida = computed(() => this.termino().length >= MINIMO_TERMINO);

  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizador));
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
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
      queryParams: {},
      replaceUrl: true,
    });
  }

  recargar(): void {
    this.busqueda.recargar();
  }

  private actualizar(cambios: Partial<FiltrosBusqueda>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q.trim() || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
