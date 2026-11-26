import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

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
import { aErrorApi, ErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ColumnaTabla,
  type OrdenColumna,
} from '../../shared/ui/tabla.component';
import { COLUMNAS_MATRIZ, aMatrizFila, normalizarCodigo, type MatrizFila } from './matriz-csv';
import { MatrizImportarComponent } from './matriz-importar.component';

type Opcion = { valor: string; etiqueta: string };

/** `GET /api/v1/catalogs`, sólo los desplegables de la matriz. */
type CatalogosMatriz = {
  regiones: Opcion[];
  estadosHito: Opcion[];
};

type FiltrosMatriz = {
  region: string;
  caso: string;
  estado: string;
  pagina: number;
  tamano: number;
};

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function leer(registro: Record<string, unknown>, claves: string[]): unknown {
  for (const clave of claves) {
    if (clave in registro) return registro[clave];
  }
  return undefined;
}

function textoDe(registro: Record<string, unknown>, claves: string[]): string | null {
  const valor = leer(registro, claves);
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

function opcionesDe(catalogo: Record<string, unknown>, clave: string): Opcion[] {
  const crudo = leer(catalogo, [clave]);
  if (!Array.isArray(crudo)) return [];

  const opciones: Opcion[] = [];
  for (const item of crudo) {
    const fila = esRegistro(item) ? item : {};
    const valor = textoDe(fila, ['codigo', 'valor', 'nombre']);
    const etiqueta = textoDe(fila, ['etiqueta', 'nombre']) ?? valor;
    if (valor && etiqueta) opciones.push({ valor, etiqueta });
  }
  return opciones;
}

/**
 * Catálogos que alimentan la barra de filtros. Los estados del hito viajan con
 * espacios («En ejecucion»), que es la misma grafía que devuelve la API.
 */
function aCatalogosMatriz(bruto: unknown): CatalogosMatriz {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    regiones: opcionesDe(catalogo, 'regiones'),
    estadosHito: opcionesDe(catalogo, 'estadosHito'),
  };
}

/** Columnas con texto largo: necesitan más ancho y permiten salto de línea. */
const COLUMNAS_TEXTO = new Set<keyof MatrizFila>([
  'narracion',
  'analisis',
  'riesgoActual',
  'actoresEstado',
  'actoresSociedadCivil',
  'demandas',
  'accion',
  'descripcionHito',
  'documentos',
]);

function valorDe(evento: Event): string {
  return (evento.target as HTMLInputElement | HTMLSelectElement).value;
}

function nombreDesdeCabecera(valor: string | null): string | null {
  if (!valor) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(valor);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const simple = /filename="?([^";]+)"?/i.exec(valor);
  return simple?.[1]?.trim() || null;
}

/**
 * Matriz del equipo en el formato A..W.
 *
 * Es la lectura de `analytics.vw_anexo_15_matriz_conflictividad` cruzada con
 * `analytics.vw_anexo_14_seguimiento_compromisos`: una fila por compromiso ×
 * hito. La tabla no edita nada; la escritura es del importador de Python.
 */
@Component({
  selector: 'app-matriz-equipo',
  imports: [
    IconoComponent,
    PaginacionComponent,
    MatrizImportarComponent,
    TablaComponent,
    CeldaTablaDirectiva,
  ],
  templateUrl: './matriz-equipo.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .matriz-cabecera {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .matriz-cabecera h2 {
      margin: 0 0 4px;
      font-size: 1.15rem;
    }
    .matriz-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    /* La matriz conserva su ancho fijo y alinea arriba (celdas de texto largo). */
    :host ::ng-deep app-tabla .tabla {
      min-width: 2100px;
    }
    :host ::ng-deep app-tabla .tabla thead th,
    :host ::ng-deep app-tabla .tabla tbody td {
      vertical-align: top;
    }
    /* La primera columna (N°) no es la que nombra la fila. */
    :host ::ng-deep app-tabla .tabla tbody td.celda-principal {
      min-width: 64px;
      white-space: nowrap;
    }
    .matriz-texto {
      display: block;
      min-width: 220px;
      max-width: 340px;
      white-space: pre-wrap;
    }
    .matriz-fecha {
      min-width: 110px;
      white-space: nowrap;
    }
    .matriz-corta {
      min-width: 64px;
      white-space: nowrap;
    }
    .matriz-codigos {
      display: block;
      margin-top: 2px;
      font-size: 0.72rem;
      opacity: 0.7;
    }
    .matriz-vacio {
      opacity: 0.5;
    }
    .matriz-estado-cumplido {
      color: #1b7f3b;
    }
    .matriz-estado-no-cumplido {
      color: #b3261e;
    }
    .matriz-estado-desestimado {
      color: #6b7280;
    }
    :host-context(html[data-theme='dark']) .matriz-estado-cumplido {
      color: #7fd1a0;
    }
    :host-context(html[data-theme='dark']) .matriz-estado-no-cumplido {
      color: #ff9d95;
    }
    :host-context(html[data-theme='dark']) .matriz-estado-desestimado {
      color: #a7b3bf;
    }
    .matriz-pendiente {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 720px;
    }
    .matriz-nota {
      margin: 8px 0 0;
      font-size: 0.85rem;
      opacity: 0.8;
    }
  `,
})
export class MatrizEquipoComponent {
  readonly columnas = COLUMNAS_MATRIZ;

  readonly filtros = signal<FiltrosMatriz>({
    region: '',
    caso: '',
    estado: '',
    pagina: 1,
    tamano: TAMANO_PAGINA,
  });

  readonly errorDescarga = signal<string | null>(null);

  private readonly catalogo = consulta<CatalogosMatriz>({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: aCatalogosMatriz,
  });

  readonly regiones = computed(() => this.catalogo.valor()?.regiones ?? []);
  readonly estadosHito = computed(() => this.catalogo.valor()?.estadosHito ?? []);

  private readonly recurso = consulta<Coleccion<MatrizFila>>({
    fuente: () => {
      const filtros = this.filtros();
      return urlConParametros(urlApi('/v1/matriz'), {
        ...paramsDePagina({ pagina: filtros.pagina, tamano: filtros.tamano }),
        region: filtros.region,
        q: filtros.caso,
        estado: filtros.estado,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(aMatrizFila),
      } satisfies Coleccion<MatrizFila>;
    },
  });

  readonly filas = computed(() => this.recurso.valor()?.elementos ?? []);
  readonly total = computed(() => this.recurso.valor()?.total ?? 0);
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;

  /** Orden local de la página visible. */
  readonly orden = new OrdenTabla<MatrizFila>();

  /** Una entrada por columna A..W: `clave` siempre corresponde a un campo real. */
  private readonly accesoresMatriz: Record<string, (fila: MatrizFila) => unknown> =
    Object.fromEntries(
      COLUMNAS_MATRIZ.map(
        (columna) => [columna.clave, (fila: MatrizFila) => fila[columna.clave]] as const,
      ),
    );

  readonly filasVisibles = computed(() => this.orden.ordenar(this.filas(), this.accesoresMatriz));

  /** Columnas de `app-tabla`: la letra A..W se suma al título (sin segunda línea). */
  readonly columnasTabla = computed<readonly ColumnaTabla[]>(() =>
    COLUMNAS_MATRIZ.map((columna) => ({
      clave: columna.clave,
      titulo: `${columna.letra} · ${columna.etiqueta}`,
      ancho: this.anchoColumna(columna.clave),
      ordenable: true,
    })),
  );

  /** Orden que pinta `app-tabla`; la página sigue ordenando con `OrdenTabla`. */
  readonly ordenTabla = computed<OrdenColumna | null>(() => {
    const clave = this.orden.columna();
    return clave ? { clave, direccion: this.orden.direccion() } : null;
  });

  alCambiarOrden(cambio: OrdenColumna | null): void {
    const clave = cambio?.clave ?? this.orden.columna();
    if (clave) this.orden.alternar(clave);
  }

  readonly esquemaPendiente = computed(() => this.error()?.codigo === 'ESQUEMA_PENDIENTE');

  readonly rango = computed(() => {
    const valor = this.recurso.valor();
    return valor ? rangoPagina(valor) : { desde: 0, hasta: 0 };
  });

  readonly resumenTabla = computed(() => {
    const total = this.total();
    if (total === 0) return 'Sin filas para los filtros seleccionados.';
    const rango = this.rango();
    return `${total} filas · ${rango.desde}–${rango.hasta} · una fila por compromiso × hito.`;
  });

  private temporizador?: ReturnType<typeof setTimeout>;

  buscarCaso(evento: Event): void {
    const valor = valorDe(evento);
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.filtros.update((filtros) => ({ ...filtros, caso: valor, pagina: 1 }));
    }, 300);
  }

  filtrarRegion(evento: Event): void {
    const region = valorDe(evento);
    this.filtros.update((filtros) => ({ ...filtros, region, pagina: 1 }));
  }

  filtrarEstado(evento: Event): void {
    const estado = valorDe(evento);
    this.filtros.update((filtros) => ({ ...filtros, estado, pagina: 1 }));
  }

  limpiar(): void {
    clearTimeout(this.temporizador);
    this.filtros.set({
      region: '',
      caso: '',
      estado: '',
      pagina: 1,
      tamano: this.filtros().tamano,
    });
  }

  cambiarPagina(pagina: number): void {
    this.filtros.update((filtros) => ({ ...filtros, pagina }));
  }

  cambiarTamano(tamano: number): void {
    this.filtros.update((filtros) => ({ ...filtros, tamano, pagina: 1 }));
  }

  recargar(): void {
    this.recurso.recargar();
  }

  /** Celda vacía: se declara con un guion, nunca se rellena con un valor. */
  celda(fila: MatrizFila, clave: keyof MatrizFila): string {
    const valor = fila[clave];
    if (valor === null || valor === undefined || valor === '') return '—';
    return String(valor);
  }

  claseColumna(clave: keyof MatrizFila): string {
    if (clave === 'numero' || clave === 'bloqueFila') return 'matriz-corta';
    if (clave === 'fechaPlanificada' || clave === 'fechaReal') return 'matriz-fecha';
    if (COLUMNAS_TEXTO.has(clave)) return 'matriz-texto';
    return '';
  }

  /** Ancho de la columna en `app-tabla`, equivalente al que daba `claseColumna`. */
  private anchoColumna(clave: keyof MatrizFila): string | undefined {
    if (clave === 'numero' || clave === 'bloqueFila') return '64px';
    if (clave === 'fechaPlanificada' || clave === 'fechaReal') return '110px';
    if (COLUMNAS_TEXTO.has(clave)) return '240px';
    return undefined;
  }

  estadoClase(valor: string | null): string {
    const normalizado = normalizarCodigo(valor);
    if (normalizado === 'cumplido') return 'matriz-estado-cumplido';
    if (normalizado === 'no cumplido') return 'matriz-estado-no-cumplido';
    if (normalizado === 'desestimado') return 'matriz-estado-desestimado';
    return '';
  }

  async descargarCsv(): Promise<void> {
    const filtros = this.filtros();
    const url = urlConParametros(urlApi('/v1/matriz/export'), {
      region: filtros.region,
      q: filtros.caso,
      estado: filtros.estado,
    });
    await this.descargar(url, 'avisa_matriz_equipo.csv', 'No se pudo descargar la matriz.');
  }

  async descargarMapeo(): Promise<void> {
    await this.descargar(
      `${urlApi('/v1/matriz/mapeo')}?formato=csv`,
      'avisa_matriz_mapeo.csv',
      'No se pudo descargar el mapeo de equivalencias.',
    );
  }

  /**
   * Descarga autenticada: la sesión vive en una cookie HttpOnly, así que no se
   * puede usar un `<a>` directo. Se pide con `fetch` y se dispara con un Blob.
   */
  private async descargar(url: string, respaldo: string, mensaje: string): Promise<void> {
    this.errorDescarga.set(null);
    try {
      const respuesta = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'text/csv' },
      });
      if (!respuesta.ok) {
        throw await this.errorDeRespuesta(respuesta, mensaje);
      }

      const archivo = await respuesta.blob();
      const nombre = nombreDesdeCabecera(respuesta.headers.get('content-disposition')) ?? respaldo;
      const objeto = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = objeto;
      enlace.download = nombre;
      enlace.rel = 'noopener';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      // Se libera en el siguiente turno para no cortar la descarga en Safari.
      setTimeout(() => URL.revokeObjectURL(objeto), 0);
    } catch (error) {
      const api = error instanceof ErrorApi ? error : aErrorApi(error, mensaje);
      this.errorDescarga.set(api.message);
    }
  }

  private async errorDeRespuesta(respuesta: Response, respaldo: string): Promise<ErrorApi> {
    let detalle = respaldo;
    let codigo = 'HTTP_ERROR';
    try {
      const cuerpo = (await respuesta.json()) as { detail?: unknown; code?: unknown };
      if (typeof cuerpo.detail === 'string' && cuerpo.detail) detalle = cuerpo.detail;
      if (typeof cuerpo.code === 'string' && cuerpo.code) codigo = cuerpo.code;
    } catch {
      // El cuerpo del error no era JSON (o venía vacío).
    }
    return new ErrorApi(detalle, respuesta.status, codigo);
  }
}
