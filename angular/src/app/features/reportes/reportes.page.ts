import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

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
import { BarraSeleccionComponent } from '../../shared/ui/barra-seleccion.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { SeleccionTabla } from '../../shared/ui/seleccion-tabla';
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ColumnaTabla,
  type OrdenColumna,
} from '../../shared/ui/tabla.component';
import { aReporte, formatearFecha, type Reporte } from './reportes.mapeo';

/** Tipo literal de `core.cat_tipos_documento` para cada pestaña de IyC. */
const TIPO_REPORTE_ACTIVIDAD = 'Reporte de Actividad';
const TIPO_INFORME_OFICIAL = 'Informe/Reporte institucional (POI, Willaqniki, bimestral…)';

type PestanaIyC = 'actividad' | 'informe';

type FiltrosReportes = {
  q: string;
  tipo: string;
  region: string;
  desde: string;
  hasta: string;
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosReportes = {
  q: '',
  tipo: '',
  region: '',
  desde: '',
  hasta: '',
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Registro de reportes: Anexo N° 17 de la Guía de Prevención y Gestión de
 * Conflictos Sociales.
 *
 * Es una vista de **sólo lectura** sobre `analytics.vw_anexo_17_registro_reportes`
 * (repo `lib/db/repos/reportes.ts`, endpoint `GET /api/v1/reportes`). El alta de
 * un reporte se hace en las pantallas ya existentes de Documentos y Alertas; por
 * eso aquí no hay formulario de alta.
 *
 * Lista con paginación de servidor y filtros guardados en la URL (`replaceUrl`),
 * igual que `DocumentosPage`. No hay panel lateral: pulsar una fila no navega.
 */
@Component({
  selector: 'app-reportes',
  imports: [
    RouterLink,
    IconoComponent,
    PaginacionComponent,
    BarraSeleccionComponent,
    TablaComponent,
    CeldaTablaDirectiva,
  ],
  templateUrl: './reportes.page.html',
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

    .exportar-error {
      margin: 0;
      color: #b42318;
      font-size: 12.5px;
    }

    .select-filter input[type='date'] {
      border: 0;
      outline: 0;
      background: transparent;
      color: #536779;
      font-size: 12.5px;
      font-family: inherit;
    }

    .celda-titulo {
      display: block;
      max-width: 340px;
      line-height: 1.35;
      white-space: normal;
    }

    .sin-dato {
      color: var(--muted);
      font-style: italic;
    }

    .actualizando {
      margin: 0;
      color: #8d99a6;
      font-size: 12px;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class ReportesPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destruccion = inject(DestroyRef);

  readonly pestanas: readonly { codigo: PestanaIyC; etiqueta: string; tipo: string }[] = [
    { codigo: 'actividad', etiqueta: 'Reporte de actividad', tipo: TIPO_REPORTE_ACTIVIDAD },
    { codigo: 'informe', etiqueta: 'Informe oficial', tipo: TIPO_INFORME_OFICIAL },
  ];

  /** La pestaña activa se deriva del `tipo` de la URL; por defecto, actividad. */
  readonly pestanaActiva = computed<PestanaIyC>(() =>
    this.filtros().tipo === TIPO_INFORME_OFICIAL ? 'informe' : 'actividad',
  );

  private readonly tipoDePestana = computed(() =>
    this.pestanaActiva() === 'informe' ? TIPO_INFORME_OFICIAL : TIPO_REPORTE_ACTIVIDAD,
  );

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        q: params.get('q') ?? '',
        tipo: params.get('tipo') ?? '',
        region: params.get('region') ?? '',
        desde: params.get('desde') ?? '',
        hasta: params.get('hasta') ?? '',
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly listado = consulta<Coleccion<Reporte>>({
    fuente: () => {
      const filtros = this.parametros();
      return urlConParametros(urlApi('/v1/reportes'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        q: filtros.q,
        tipo: this.tipoDePestana(),
        region: filtros.region,
        desde: filtros.desde,
        hasta: filtros.hasta,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aReporte),
      } satisfies Coleccion<Reporte>;
    },
  });

  readonly reportes = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);

  /** Selección de la tabla (página visible) para exportar. */
  readonly seleccion = new SeleccionTabla();

  /** Ids marcados, en una referencia estable para `app-tabla`. */
  readonly idsSeleccionados = computed(() => this.seleccion.lista());

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<Reporte>();

  /** Columnas del listado, en el orden del registro (Anexo N° 17). */
  readonly columnas: readonly ColumnaTabla[] = [
    { clave: 'tipo', titulo: 'Tipo', ordenable: true },
    {
      clave: 'codigo',
      titulo: 'Código',
      ordenable: true,
      acceso: (fila) => (fila as unknown as Reporte).codigoReporte,
    },
    { clave: 'caso', titulo: 'Caso', ordenable: true },
    { clave: 'responsable', titulo: 'Responsable', ordenable: true },
    {
      clave: 'fecha',
      titulo: 'Fecha',
      ordenable: true,
      formato: (valor) => this.formatearFecha(valor as string | null),
    },
    { clave: 'region', titulo: 'Región', ordenable: true },
    { clave: 'ubicacion', titulo: 'Ubicación', ordenable: true },
    { clave: 'titulo', titulo: 'Título', ordenable: true },
  ];

  /** Orden que pinta `app-tabla`; la página ordena con `OrdenTabla`. */
  readonly ordenTabla = computed<OrdenColumna | null>(() => {
    const clave = this.orden.columna();
    return clave ? { clave, direccion: this.orden.direccion() } : null;
  });

  private readonly accesoresReporte: Record<string, (reporte: Reporte) => unknown> = {
    tipo: (reporte) => reporte.tipo,
    codigo: (reporte) => reporte.codigoReporte,
    caso: (reporte) => reporte.codigoCaso,
    responsable: (reporte) => reporte.responsable,
    fecha: (reporte) => reporte.fecha,
    region: (reporte) => reporte.region,
    ubicacion: (reporte) => reporte.ubicacion,
    titulo: (reporte) => reporte.titulo,
  };

  readonly filasVisibles = computed(() =>
    this.orden.ordenar(this.reportes(), this.accesoresReporte),
  );

  alCambiarOrden(cambio: OrdenColumna | null): void {
    const clave = cambio?.clave ?? this.orden.columna();
    if (clave) this.orden.alternar(clave);
  }

  /** Refleja en `SeleccionTabla` lo que marca la tabla (barra de selección). */
  alCambiarSeleccion(ids: readonly string[]): void {
    // Las filas sin código llegan como `#índice`: no se pueden exportar.
    const marcadas = new Set(ids.filter((id) => !!id && !id.startsWith('#')));
    for (const id of this.seleccion.lista()) {
      if (!marcadas.has(id)) this.seleccion.alternar(id);
    }
    for (const id of marcadas) {
      if (!this.seleccion.esta(id)) this.seleccion.alternar(id);
    }
  }

  readonly estadoListado = this.listado.estado;
  readonly errorListado = this.listado.error;

  readonly rango = computed(() => {
    const valor = this.listado.valor();
    return valor ? rangoPagina(valor) : { desde: 0, hasta: 0 };
  });

  readonly resumenTabla = computed(() => {
    const rango = this.rango();
    return `${this.total()} reportes · ${rango.desde}–${rango.hasta} · productos de la Gestión de Información y Conocimiento (registro de sólo lectura).`;
  });

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  private temporizadorQ?: ReturnType<typeof setTimeout>;
  private temporizadorRegion?: ReturnType<typeof setTimeout>;

  constructor() {
    this.destruccion.onDestroy(() => {
      clearTimeout(this.temporizadorQ);
      clearTimeout(this.temporizadorRegion);
    });
  }

  formatearFecha(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  recargarListado(): void {
    this.listado.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  buscar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorQ);
    this.temporizadorQ = setTimeout(() => {
      void this.actualizar({ q: valor, pagina: 1 });
    }, 300);
  }

  filtrarRegion(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    clearTimeout(this.temporizadorRegion);
    this.temporizadorRegion = setTimeout(() => {
      void this.actualizar({ region: valor, pagina: 1 });
    }, 300);
  }

  cambiarPestana(pestana: PestanaIyC): void {
    const opcion = this.pestanas.find((item) => item.codigo === pestana);
    if (!opcion) return;
    void this.actualizar({ tipo: opcion.tipo, pagina: 1 });
  }

  cambiarDesde(evento: Event): void {
    void this.actualizar({ desde: this.valorDe(evento), pagina: 1 });
  }

  cambiarHasta(evento: Event): void {
    void this.actualizar({ hasta: this.valorDe(evento), pagina: 1 });
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    clearTimeout(this.temporizadorQ);
    clearTimeout(this.temporizadorRegion);
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {},
      replaceUrl: true,
    });
  }

  private valorDe(evento: Event): string {
    return (evento.target as HTMLInputElement | HTMLSelectElement).value;
  }

  private actualizar(cambios: Partial<FiltrosReportes>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        q: siguiente.q || null,
        tipo: siguiente.tipo || null,
        region: siguiente.region || null,
        desde: siguiente.desde || null,
        hasta: siguiente.hasta || null,
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
