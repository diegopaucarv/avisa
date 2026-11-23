import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { consulta, type Consulta } from '../../core/http/consulta';
import { PRIORIDADES, RIESGOS, esRegistro, numero } from '../../dominio/mapeo';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { DesgloseRegionesService, SIN_REGION } from './desglose-regiones.service';

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
  /**
   * Filtros que reproducen el grupo en el listado de Casos. `null` cuando el
   * grupo no se corresponde con un filtro del servidor (el resto sin clasificar).
   */
  enlace: Record<string, string> | null;
};

/** `total` del sobre paginado (`{items,total,...}`), sin construir filas. */
function totalDe(bruto: unknown): number {
  return normalizarColeccion<unknown>(bruto).total;
}

/** `sinCasoTotal` del sobre de demandas; si falta, el `total` ya filtrado. */
function totalDemandas(bruto: unknown): number {
  const coleccion = normalizarColeccion<unknown>(bruto);
  const registro = esRegistro(bruto) ? bruto : {};
  return numero(registro, ['sinCasoTotal']) ?? coleccion.total;
}

/**
 * Resumen de Dirección.
 *
 * Lectura ejecutiva construida sólo con los `total` de los sobres paginados:
 * cada conteo es una petición `pagina=1&tamano=1` y no se traen filas. No existe
 * `/api/v1/dashboard` y no se crea.
 *
 * El desglose agrupa por los filtros que el servidor expone de forma exacta
 * (`prioridad`, `riesgo`, `tematica`, `region`). La API no acepta filtro por
 * nivel de conflicto, así que esa dimensión no se estima con una muestra: se
 * omite. La región sí se desglosa: `GET /api/v1/catalogs` publica `regiones` y
 * cada grupo se cuenta con el `total` de `region=<nombre>` (o `sinregion=true`
 * para los casos sin región principal), sin traer filas.
 *
 * Base normativa: Guía §8.1.2.3 (Reportes de clima social) y Anexo 2 (Reporte
 * Regional de Conflictividad y Demandas).
 */
@Component({
  selector: 'app-direccion',
  imports: [RouterLink, IconoComponent, ExportarMenuComponent],
  templateUrl: './direccion.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DesgloseRegionesService],
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
  private readonly desgloseRegiones = inject(DesgloseRegionesService);

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /* ------------------------------------------------------------------ *
   * Totales del servidor: una fila por consulta, se lee `total`
   * ------------------------------------------------------------------ */

  private readonly casosTotal = this.contarCasos({});

  private readonly casosAbiertosRec = this.contarCasos({ abiertos: 'true' });

  private readonly alertasRec = consulta<number>({
    fuente: () => urlConParametros(urlApi('/v1/alerts'), paramsDePagina({ pagina: 1, tamano: 1 })),
    esquema: totalDe,
  });

  private readonly compromisosRec = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/commitments'), paramsDePagina({ pagina: 1, tamano: 1 })),
    esquema: totalDe,
  });

  private readonly demandasRec = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/demandas'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        sinCaso: 'true',
      }),
    esquema: totalDemandas,
  });

  /* ------------------------------------------------------------------ *
   * Desglose: cada grupo es el `total` exacto de un filtro del servidor
   * ------------------------------------------------------------------ */

  private readonly prioridad = PRIORIDADES.map((valor) => ({
    etiqueta: valor,
    recurso: this.contarCasos({ prioridad: valor }),
  }));

  private readonly riesgo = RIESGOS.map((valor) => ({
    etiqueta: valor,
    recurso: this.contarCasos({ riesgo: valor }),
  }));

  private readonly tematica = TEMATICAS.map((valor) => ({
    etiqueta: valor,
    recurso: this.contarCasos({ tematica: valor }),
  }));

  readonly casosAbiertos = computed(() => this.casosAbiertosRec.valor() ?? null);
  readonly alertas = computed(() => this.alertasRec.valor() ?? null);
  readonly compromisos = computed(() => this.compromisosRec.valor() ?? null);
  readonly demandasSinCaso = computed(() => this.demandasRec.valor() ?? null);
  readonly casosTotales = computed(() => this.casosTotal.valor() ?? 0);

  readonly porPrioridad = computed(() => this.desglosar(this.prioridad, SIN_CLASIFICAR));
  readonly porRiesgo = computed(() => this.desglosar(this.riesgo, SIN_CLASIFICAR));
  readonly porTematica = computed(() => this.desglosar(this.tematica, SIN_TEMATICA));

  /**
   * Desglose por región principal. Cada fila enlaza al listado con el mismo
   * recorte: `region` (o `sinregion`) y `alcance=todos`, porque este resumen
   * cuenta sin filtrar por ámbito y, sin ese parámetro, la lista reaplicaría la
   * preferencia guardada y el número dejaría de coincidir con la fila.
   */
  readonly porRegion = computed(() =>
    this.desglosarTotales(
      this.desgloseRegiones.grupos().map(({ etiqueta, total }) => {
        const enlace: Record<string, string> =
          etiqueta === SIN_REGION
            ? { sinregion: 'true', alcance: 'todos' }
            : { region: etiqueta, alcance: 'todos' };
        return { etiqueta, total, enlace };
      }),
      SIN_CLASIFICAR,
    ),
  );

  private readonly recursos = computed<Consulta<number>[]>(() => [
    this.casosTotal,
    this.casosAbiertosRec,
    this.alertasRec,
    this.compromisosRec,
    this.demandasRec,
    ...this.prioridad.map(({ recurso }) => recurso),
    ...this.riesgo.map(({ recurso }) => recurso),
    ...this.tematica.map(({ recurso }) => recurso),
  ]);

  /**
   * La tarjeta de región tiene su propio estado: el desglose necesita el catálogo
   * más una consulta por región, así que no debe retrasar el «cargando» de los
   * totales principales.
   */
  readonly cargandoRegiones = computed(() => this.desgloseRegiones.estado() === 'cargando');

  readonly cargando = computed(() =>
    this.recursos().some((fuente) => fuente.estado() === 'cargando'),
  );

  readonly error = computed(
    () =>
      this.desgloseRegiones.error() ??
      this.recursos()
        .map((fuente) => fuente.error())
        .find((fallo) => fallo !== null) ??
      null,
  );

  readonly notaBase = computed(() => {
    const total = this.casosTotales();
    return `${total} casos registrados. Cada grupo se cuenta con el total del servidor para su filtro y su porcentaje se calcula sobre ese total.`;
  });

  imprimir(): void {
    if (!isPlatformBrowser(this.plataforma)) return;
    window.print();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  recargar(): void {
    this.desgloseRegiones.recargar();
    for (const fuente of this.recursos()) fuente.recargar();
  }

  private contarCasos(filtros: Record<string, string>): Consulta<number> {
    return consulta<number>({
      fuente: () =>
        urlConParametros(urlApi('/v1/cases'), {
          ...paramsDePagina({ pagina: 1, tamano: 1 }),
          ...filtros,
        }),
      esquema: totalDe,
    });
  }

  private desglosar(
    entradas: readonly { etiqueta: string; recurso: Consulta<number> }[],
    vacio: string,
  ): Grupo[] {
    return this.desglosarTotales(
      entradas.map(({ etiqueta, recurso }) => ({
        etiqueta,
        total: recurso.valor() ?? 0,
        enlace: null,
      })),
      vacio,
    );
  }

  /**
   * Convierte totales ya resueltos en grupos con porcentaje sobre el total de
   * casos. El resto que no cubre ningún grupo se declara como `vacio` en lugar
   * de repartirse: si la suma no alcanza la base, falta una clasificación y eso
   * se muestra.
   */
  private desglosarTotales(
    entradas: readonly { etiqueta: string; total: number; enlace: Record<string, string> | null }[],
    vacio: string,
  ): Grupo[] {
    const base = this.casosTotales();
    const grupos: Grupo[] = entradas.map(({ etiqueta, total, enlace }) => ({
      etiqueta,
      total,
      porcentaje: 0,
      enlace,
    }));

    const sumados = grupos.reduce((acumulado, grupo) => acumulado + grupo.total, 0);
    const resto = Math.max(0, base - sumados);
    if (resto > 0) grupos.push({ etiqueta: vacio, total: resto, porcentaje: 0, enlace: null });

    return grupos.map((grupo) => ({
      ...grupo,
      porcentaje: base > 0 ? Math.round((grupo.total / base) * 100) : 0,
    }));
  }
}
