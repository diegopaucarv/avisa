import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import {
  Coleccion,
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { NIVELES_CONFLICTO, RIESGOS, aCaso, esRegistro, numero } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { IconoComponent } from '../../shared/ui/icono.component';

/** Filas que se leen para construir el desglose (el servidor acota a 100). */
const TAMANO_ANALISIS = 100;

const SIN_REGION = 'Sin región';
const SIN_TEMATICA = 'Sin temática';
const SIN_CLASIFICAR = 'Sin clasificar';

const TEMATICAS = [
  'Infraestructura',
  'Ordenamiento y acceso territorial',
  'Normatividad',
  'Distribución de beneficios',
  'Gobernanza',
  'Impactos de terceros',
] as const;

type Grupo = {
  etiqueta: string;
  total: number;
  porcentaje: number;
};

/**
 * Agrupa valores reales de la API. El porcentaje se calcula siempre sobre la
 * base analizada (las filas efectivamente leídas), nunca sobre el total del
 * servidor: así el desglose no insinúa una proyección que no se ha medido.
 */
function desglosar(
  valores: readonly (string | null)[],
  opciones: { canonicos?: readonly string[]; vacio: string },
): Grupo[] {
  const conteo = new Map<string, number>();

  for (const canonico of opciones.canonicos ?? []) conteo.set(canonico, 0);

  for (const valor of valores) {
    const clave = valor && valor.trim() ? valor.trim() : opciones.vacio;
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }

  const base = valores.length;
  const grupos = [...conteo.entries()].map(([etiqueta, total]) => ({
    etiqueta,
    total,
    porcentaje: base > 0 ? Math.round((total / base) * 100) : 0,
  }));

  if (opciones.canonicos) {
    const orden = new Map(opciones.canonicos.map((valor, indice) => [valor, indice]));
    grupos.sort((a, b) => {
      const posicionA = orden.get(a.etiqueta) ?? Number.MAX_SAFE_INTEGER;
      const posicionB = orden.get(b.etiqueta) ?? Number.MAX_SAFE_INTEGER;
      return posicionA - posicionB || b.total - a.total;
    });
  } else {
    grupos.sort((a, b) => b.total - a.total);
  }

  return grupos;
}

/**
 * Resumen de Dirección.
 *
 * Lectura ejecutiva construida con los `total` y las filas reales de la API.
 * No existe `/api/v1/dashboard` y no se crea: los conteos salen de pedir cada
 * listado con `tamano=1` y leer su `total`; el desglose se calcula en cliente
 * sobre un máximo de 100 filas por listado.
 *
 * Base normativa: Guía §8.1.2.3 (Reportes de clima social) y Anexo 2 (Reporte
 * Regional de Conflictividad y Demandas).
 */
@Component({
  selector: 'app-direccion',
  imports: [RouterLink, IconoComponent],
  templateUrl: './direccion.page.html',
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
      color: var(--ink);
      font: 700 22px/1.3 var(--font-display);
      letter-spacing: -0.65px;
    }

    .view-subtitle {
      max-width: 760px;
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.6;
    }

    .executive-kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    a.stat-card {
      color: inherit;
      text-decoration: none;
    }

    a.stat-card:hover {
      border-color: var(--blue);
    }

    .breakdown-card .link-button {
      margin-top: 10px;
    }

    .breakdown-list a {
      color: inherit;
      text-decoration: none;
    }

    .breakdown-list a:hover,
    .breakdown-list a:focus-visible {
      color: var(--blue);
      text-decoration: underline;
    }

    @media (max-width: 980px) {
      .executive-kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }

      .executive-kpis {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class DireccionPage {
  private readonly plataforma = inject(PLATFORM_ID);

  readonly sinRegion = SIN_REGION;
  readonly tamanoAnalisis = TAMANO_ANALISIS;

  /**
   * Una sola lectura de casos para el desglose. Se piden 100 filas recientes;
   * si el servidor tiene más, se avisa y se muestra su `total`.
   */
  private readonly casosAnalisis = consulta<Coleccion<Caso>>({
    fuente: () =>
      urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: TAMANO_ANALISIS }),
        sort: 'recent',
      }),
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aCaso) };
    },
  });

  /** Totales del servidor: se trae una sola fila y se lee `total`. */
  private readonly casosActivosRec = consulta<Coleccion<unknown>>({
    fuente: () =>
      urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        estado: 'Activo',
      }),
    esquema: (bruto) => normalizarColeccion<unknown>(bruto),
  });

  private readonly alertasRec = consulta<Coleccion<unknown>>({
    fuente: () => urlConParametros(urlApi('/v1/alerts'), paramsDePagina({ pagina: 1, tamano: 1 })),
    esquema: (bruto) => normalizarColeccion<unknown>(bruto),
  });

  private readonly compromisosRec = consulta<Coleccion<unknown>>({
    fuente: () =>
      urlConParametros(urlApi('/v1/commitments'), paramsDePagina({ pagina: 1, tamano: 1 })),
    esquema: (bruto) => normalizarColeccion<unknown>(bruto),
  });

  /**
   * Demandas sin caso. La API devuelve `sinCasoTotal` global aunque se filtre;
   * se prefiere ese valor y se cae al `total` de la página.
   */
  private readonly demandasRec = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/demandas'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        sinCaso: 'true',
      }),
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      const registro = esRegistro(bruto) ? bruto : {};
      return numero(registro, ['sinCasoTotal']) ?? coleccion.total;
    },
  });

  readonly casosFilas = computed(() => this.casosAnalisis.valor()?.elementos ?? []);
  readonly totalServidor = computed(() => this.casosAnalisis.valor()?.total ?? 0);
  readonly filasAnalizadas = computed(() => this.casosFilas().length);
  readonly truncado = computed(() => this.totalServidor() > this.filasAnalizadas());

  readonly casosActivos = computed(() => this.casosActivosRec.valor()?.total ?? null);
  readonly alertas = computed(() => this.alertasRec.valor()?.total ?? null);
  readonly compromisos = computed(() => this.compromisosRec.valor()?.total ?? null);
  readonly demandasSinCaso = computed(() => this.demandasRec.valor() ?? null);

  readonly cargando = computed(() =>
    [
      this.casosAnalisis,
      this.casosActivosRec,
      this.alertasRec,
      this.compromisosRec,
      this.demandasRec,
    ].some((fuente) => fuente.estado() === 'cargando'),
  );

  readonly error = computed(
    () =>
      this.casosAnalisis.error() ??
      this.casosActivosRec.error() ??
      this.alertasRec.error() ??
      this.compromisosRec.error() ??
      this.demandasRec.error(),
  );

  readonly porRegion = computed(() =>
    desglosar(
      this.casosFilas().map((caso) => caso.region),
      { vacio: SIN_REGION },
    ),
  );

  readonly porNivel = computed(() =>
    desglosar(
      this.casosFilas().map((caso) => caso.nivelConflicto),
      { canonicos: NIVELES_CONFLICTO, vacio: SIN_CLASIFICAR },
    ),
  );

  readonly porRiesgo = computed(() =>
    desglosar(
      this.casosFilas().map((caso) => caso.riesgo),
      { canonicos: RIESGOS, vacio: SIN_CLASIFICAR },
    ),
  );

  readonly porTematica = computed(() =>
    desglosar(
      this.casosFilas().map((caso) => caso.tematica),
      { canonicos: TEMATICAS, vacio: SIN_TEMATICA },
    ),
  );

  readonly notaBase = computed(() => {
    const filas = this.filasAnalizadas();
    if (this.truncado()) {
      return `Total del servidor: ${this.totalServidor()} casos. El desglose se calcula sobre las ${filas} filas más recientes; los porcentajes se refieren a esa base, no al total.`;
    }
    return `${filas} casos analizados. Los porcentajes se calculan sobre esa base, no sobre una proyección.`;
  });

  imprimir(): void {
    if (!isPlatformBrowser(this.plataforma)) return;
    window.print();
  }

  recargar(): void {
    this.casosAnalisis.recargar();
    this.casosActivosRec.recargar();
    this.alertasRec.recargar();
    this.compromisosRec.recargar();
    this.demandasRec.recargar();
  }
}
