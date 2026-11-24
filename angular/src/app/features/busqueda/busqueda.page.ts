import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { paramsDePagina, urlConParametros, type Coleccion } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  GRUPOS,
  MINIMO_TERMINO,
  TOPE_INDICE,
  TOPE_POR_GRUPO,
  aColeccionGrupo,
  aEnlace,
  aIndiceBusqueda,
  enriquecer,
  type ClaveGrupo,
  type Enlace,
  type IndiceBusqueda,
  type Resultado,
  type ResultadoEnlazado,
} from './busqueda.mapeo';

type GrupoVista = {
  clave: ClaveGrupo;
  titulo: string;
  icono: string;
  /** Total real del grupo en el servidor (no el de las filas mostradas). */
  total: number;
  /** Filas que el tope por grupo dejó fuera. */
  omitidos: number;
  resultados: ResultadoEnlazado[];
  enlaceListado: Enlace;
};

const FILTROS_INICIALES = { q: '' };

/**
 * Búsqueda global.
 *
 * El término vive en la URL (`replaceUrl`) y se escribe con 300 ms de espera.
 * Con menos de dos caracteres no se llama a la API (`GET /api/v1/search`
 * responde 422) y se muestra una invitación.
 *
 * Se consulta un listado por entidad —cada uno con `q`, `pagina` y `tamano`
 * verificados en `app/api/v1/`— para tener el total de cada grupo y poder
 * topear filas sin sepultar a los grupos pequeños. Aparte se pide
 * `GET /api/v1/search`, que es la única respuesta con la región heredada del
 * caso: se usa como índice para completar región y el código de las demandas.
 *
 * El atajo `/` del shell enfoca el primer `input[type="search"]` visible
 * (`core/atajos`): este campo lo es, así que no hace falta duplicar nada.
 */
@Component({
  selector: 'app-busqueda',
  imports: [RouterLink, IconoComponent],
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



    .search-groups {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .search-group {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .search-group-head {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0 2px;
    }

    .search-group-icono {
      display: grid;
      place-items: center;
      color: #8b97a2;
    }

    .search-group-head h2 {
      margin: 0;
      color: #5f7690;
      font: 700 12.5px/1.3 var(--font-display);
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }

    .search-group-omitidos {
      margin: 0;
      padding: 0 2px;
      color: #8b97a2;
      font-size: 12px;
    }

    .search-group-omitidos a {
      color: #5f7690;
      font-weight: 600;
      text-decoration: none;
    }

    .search-group-omitidos a:hover,
    .search-group-omitidos a:focus-visible {
      text-decoration: underline;
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
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
    }

    .search-result-subtitulo {
      color: #748391;
      font-size: 12.5px;
      line-height: 1.45;
    }

    .search-result-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      color: #8b97a2;
      font-size: 12px;
    }

    .search-result-tipo {
      padding: 3px 7px;
      border-radius: 12px;
      background: #f1f3f5;
      color: #687783;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .search-result-codigo {
      color: #7f8c98;
      font-weight: 600;
      white-space: nowrap;
    }

    .search-result-dato {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      min-width: 0;
    }

    .search-result-dato-etiqueta {
      color: #a3aeb8;
      font-size: 12px;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }

    .search-result-region {
      color: #7f8c98;
      font-weight: 600;
      white-space: nowrap;
    }

    .search-result-destino {
      flex: none;
      margin-top: 6px;
      color: #9aa5ae;
      font-size: 12px;
      white-space: nowrap;
    }

    .search-result-flecha {
      flex: none;
      color: #9aa5ae;
      margin-top: 6px;
    }

    .search-aviso {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid #f0e2cf;
      border-radius: 8px;
      background: #fdf8f1;
      color: #8a5a1f;
      font-size: 12.5px;
      line-height: 1.5;
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

  readonly topePorGrupo = TOPE_POR_GRUPO;

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
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
  private readonly consultas = GRUPOS.map((definicion) => ({
    definicion,
    fuente: consulta<Coleccion<Resultado>>({
      fuente: () => {
        const termino = this.termino();
        if (termino.length < MINIMO_TERMINO) return null;

        return urlConParametros(urlApi(definicion.recurso), {
          ...paramsDePagina({ pagina: 1, tamano: TOPE_POR_GRUPO }),
          q: termino,
        });
      },
      esquema: (bruto) => aColeccionGrupo(bruto, definicion),
    }),
  }));

  /**
   * Índice de región/código de `GET /api/v1/search`. Es opcional: si falla o no
   * cubre una fila, la tarjeta pinta «—» en lo que falte.
   */
  private readonly indice = consulta<IndiceBusqueda>({
    fuente: () => {
      const termino = this.termino();
      if (termino.length < MINIMO_TERMINO) return null;

      return urlConParametros(urlApi('/v1/search'), {
        ...paramsDePagina({ pagina: 1, tamano: TOPE_INDICE }),
        q: termino,
      });
    },
    esquema: aIndiceBusqueda,
  });

  readonly consultaValida = computed(() => this.termino().length >= MINIMO_TERMINO);

  readonly grupos = computed<GrupoVista[]>(() => {
    const termino = this.termino();
    const indice: IndiceBusqueda = this.indice.valor() ?? new Map();

    return this.consultas.map(({ definicion, fuente }) => {
      // Mientras llega una consulta nueva no se reutilizan filas del término
      // anterior: sus enlaces ya se construirían con el término vigente.
      const coleccion = fuente.estado() === 'listo' ? fuente.valor() : undefined;
      const total = coleccion?.total ?? 0;
      const resultados = (coleccion?.elementos ?? []).map((resultado) =>
        aEnlace(definicion, enriquecer(resultado, indice), termino),
      );

      return {
        clave: definicion.clave,
        titulo: definicion.tituloGrupo,
        icono: definicion.icono,
        total,
        omitidos: Math.max(0, total - resultados.length),
        resultados,
        enlaceListado: { ruta: definicion.listado, parametros: { q: termino } },
      };
    });
  });

  /** Grupos con resultados; los vacíos no se pintan. */
  readonly gruposConResultados = computed(() => this.grupos().filter((grupo) => grupo.total > 0));

  readonly total = computed(() => this.grupos().reduce((suma, grupo) => suma + grupo.total, 0));

  readonly gruposFallidos = computed(() =>
    this.consultas
      .filter(({ fuente }) => fuente.estado() === 'error')
      .map(({ definicion }) => definicion.tituloGrupo),
  );

  readonly cargando = computed(() =>
    this.consultas.some(({ fuente }) => fuente.estado() === 'cargando'),
  );

  readonly todosConError = computed(() =>
    this.consultas.every(({ fuente }) => fuente.estado() === 'error'),
  );

  readonly errorListado = computed(
    () => this.consultas.find(({ fuente }) => fuente.error())?.fuente.error() ?? null,
  );

  private temporizador?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => clearTimeout(this.temporizador));
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      void this.actualizar({ q: valor });
    }, 300);
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
    for (const { fuente } of this.consultas) fuente.recargar();
    this.indice.recargar();
  }

  /**
   * El término es el único parámetro vigente. Se navega sin `merge` para que
   * una URL antigua con `pagina`/`tamano` quede limpia.
   */
  private actualizar(cambios: { q: string }): void {
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { q: cambios.q.trim() || null },
      replaceUrl: true,
    });
  }
}
