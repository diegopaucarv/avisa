import { HttpClient } from '@angular/common/http';
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
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aCaso } from '../../dominio/mapeo';
import { formatearFechaHora } from '../../shared/formato-fecha';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import { aAlerta } from '../alertas/alerta.mapeo';
import { aDemanda } from '../casos/demanda-sin-caso.mapeo';
import { aCompromiso } from '../compromisos/compromiso.mapeo';
import { aDocumento } from '../documentos/documento.mapeo';
import { PapeleraPanelComponent } from './papelera-panel.component';
import type { FilaPapelera, PestanaPapelera } from './papelera.tipos';

type ConfigPestana = {
  /** Singular para los avisos («Caso restaurado: …»). */
  singular: string;
  plural: string;
  /** Ruta del listado; siempre se pide con `anulados=true`. */
  ruta: string;
  mapear: (bruto: unknown) => FilaPapelera;
  /** Ruta del POST de restauración, sin el prefijo `/api`. */
  restaurar: (fila: FilaPapelera) => string;
  /** Advertencia que muestra el panel antes de restaurar. */
  advertencia: string | null;
};

const PESTANAS: readonly { valor: PestanaPapelera; etiqueta: string; icono: string }[] = [
  { valor: 'casos', etiqueta: 'Casos', icono: 'casos' },
  { valor: 'alertas', etiqueta: 'Alertas', icono: 'alertas' },
  { valor: 'demandas', etiqueta: 'Demandas', icono: 'compromisos' },
  { valor: 'documentos', etiqueta: 'Documentos', icono: 'documentos' },
  { valor: 'compromisos', etiqueta: 'Compromisos', icono: 'compromisos' },
];

/**
 * `core.restaurar_caso` opera sobre el lote completo: reabrir un caso devuelve
 * también sus documentos, alertas y demandas. Se avisa en la ficha para que la
 * acción no sorprenda; restaurar una pieza suelta se hace en su propia pestaña.
 */
const ADVERTENCIA_CASO =
  'Restaurar el caso lo reabre con todo su lote: vuelven también sus documentos, alertas y demandas anulados con el mismo lote. Para recuperar una sola pieza, use la pestaña correspondiente.';

function filaCaso(bruto: unknown): FilaPapelera {
  const caso = aCaso(bruto);
  return {
    id: caso.id,
    clave: caso.codigo,
    codigo: caso.codigo || null,
    titulo: caso.titulo,
    descripcion: caso.resumen,
    casoCodigo: null,
    casoTitulo: null,
    motivo: caso.motivoAnulacion,
    anuladoEn: caso.anuladoEn,
    anuladoPor: caso.anuladoPor,
    anuladoPorNombre: caso.anuladoPorNombre,
    anulacionId: caso.anulacionId,
    clasificacion: caso.clasificacion,
  };
}

function filaAlerta(bruto: unknown): FilaPapelera {
  const alerta = aAlerta(bruto);
  return {
    id: alerta.id,
    clave: alerta.id,
    codigo: alerta.codigo || null,
    titulo: alerta.titulo,
    descripcion: alerta.descripcionRiesgo,
    casoCodigo: alerta.casoCodigo,
    casoTitulo: alerta.casoTitulo,
    motivo: alerta.motivoAnulacion,
    anuladoEn: alerta.anuladoEn,
    anuladoPor: alerta.anuladoPor,
    anuladoPorNombre: alerta.anuladoPorNombre,
    anulacionId: alerta.anulacionId,
    clasificacion: alerta.clasificacion,
  };
}

function filaDemanda(bruto: unknown): FilaPapelera {
  const demanda = aDemanda(bruto);
  return {
    id: demanda.id,
    clave: demanda.id,
    codigo: null,
    titulo: demanda.descripcion ?? demanda.problema,
    descripcion: demanda.problema ?? demanda.descripcion,
    casoCodigo: demanda.casoCodigo,
    casoTitulo: demanda.casoTitulo,
    motivo: demanda.motivoAnulacion,
    anuladoEn: demanda.anuladoEn,
    anuladoPor: demanda.anuladoPor,
    anuladoPorNombre: demanda.anuladoPorNombre,
    anulacionId: demanda.anulacionId,
    clasificacion: demanda.clasificacion,
  };
}

function filaDocumento(bruto: unknown): FilaPapelera {
  const documento = aDocumento(bruto);
  return {
    id: documento.id,
    clave: documento.id,
    codigo: documento.codigo,
    titulo: documento.titulo,
    descripcion: documento.resumen,
    casoCodigo: documento.casoCode,
    casoTitulo: documento.casoTitulo,
    motivo: documento.motivoAnulacion,
    anuladoEn: documento.anuladoEn,
    anuladoPor: documento.anuladoPor,
    anuladoPorNombre: documento.anuladoPorNombre,
    anulacionId: documento.anulacionId,
    clasificacion: documento.clasificacion,
  };
}

function filaCompromiso(bruto: unknown): FilaPapelera {
  const compromiso = aCompromiso(bruto);
  return {
    id: compromiso.id,
    clave: compromiso.id,
    codigo: compromiso.codigo || null,
    titulo: compromiso.accion,
    descripcion: null,
    casoCodigo: compromiso.casoCodigo,
    casoTitulo: compromiso.casoTitulo,
    motivo: compromiso.motivoAnulacion,
    anuladoEn: compromiso.anuladoEn,
    anuladoPor: compromiso.anuladoPor,
    anuladoPorNombre: compromiso.anuladoPorNombre,
    anulacionId: compromiso.anulacionId,
    clasificacion: compromiso.clasificacion ?? 1,
  };
}

/** Una configuración por pestaña: listado, mapeo y endpoint de restauración. */
const CONFIGS: Record<PestanaPapelera, ConfigPestana> = {
  casos: {
    singular: 'Caso',
    plural: 'casos',
    ruta: '/v1/cases',
    mapear: filaCaso,
    restaurar: (fila) => `/v1/cases/${encodeURIComponent(fila.clave)}/restaurar`,
    advertencia: ADVERTENCIA_CASO,
  },
  alertas: {
    singular: 'Alerta',
    plural: 'alertas',
    ruta: '/v1/alerts',
    mapear: filaAlerta,
    restaurar: (fila) => `/v1/alerts/${encodeURIComponent(fila.id)}/restaurar`,
    advertencia: null,
  },
  demandas: {
    singular: 'Demanda',
    plural: 'demandas',
    ruta: '/v1/demandas',
    mapear: filaDemanda,
    restaurar: (fila) => `/v1/demandas/${encodeURIComponent(fila.id)}/restaurar`,
    advertencia: null,
  },
  documentos: {
    singular: 'Documento',
    plural: 'documentos',
    ruta: '/v1/documents',
    mapear: filaDocumento,
    restaurar: (fila) => `/v1/documents/${encodeURIComponent(fila.id)}/restaurar`,
    advertencia: null,
  },
  compromisos: {
    singular: 'Compromiso',
    plural: 'compromisos',
    ruta: '/v1/commitments',
    mapear: filaCompromiso,
    restaurar: (fila) => `/v1/commitments/${encodeURIComponent(fila.id)}/restaurar`,
    advertencia: null,
  },
};

/**
 * Papelera: los registros anulados de las cinco entidades en una sola vista.
 *
 * Cada pestaña consulta su listado con `?anulados=true` y paginación de servidor
 * (la API responde 403 si el rol no puede anular; la RLS deja pasar las filas
 * anuladas sólo con `verAnulados`). La tabla comparte columnas —registro, caso,
 * motivo, fecha, autor y acción— porque los cinco repositorios exponen los
 * mismos campos de anulación.
 *
 * Restaurar es `POST` al endpoint de la entidad. Desde la migración 29 el
 * borrado se deshace **por fila**: restaurar un documento devuelve ese documento
 * y no el lote completo. La excepción intencional es el caso: `restaurar_caso`
 * reabre el caso con sus dependencias, y el panel lo advierte.
 */
@Component({
  selector: 'app-papelera',
  imports: [IconoComponent, PaginacionComponent, PapeleraPanelComponent],
  templateUrl: './papelera.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .aviso-ok {
      margin: 0;
      color: #2f6f52;
      font-size: 11.5px;
    }

    .celda-registro {
      max-width: 300px;
      white-space: normal;
    }

    .celda-registro strong {
      color: #2b3d4f;
      font-size: 10px;
      font-weight: 700;
    }

    .celda-registro small,
    .celda-caso small {
      display: block;
      margin-top: 3px;
      color: #99a3aa;
      font-size: 9px;
      line-height: 1.4;
    }

    .celda-caso {
      max-width: 210px;
      white-space: normal;
    }

    .celda-caso strong {
      color: #465a6c;
      font-size: 9px;
      font-weight: 600;
    }

    .celda-motivo {
      max-width: 320px;
      white-space: normal;
      color: #52677a;
      font-size: 9.5px;
      line-height: 1.5;
    }

    .sin-dato {
      color: #a0aab3;
      font-style: italic;
    }

    .actualizando {
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
export class PapeleraPage {
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);

  /** La papelera sólo se ofrece a quien puede anular y restaurar. */
  readonly puedeVer = this.capacidades.puedeEliminar;
  readonly pestanas = PESTANAS;

  readonly pestana = signal<PestanaPapelera>('casos');
  readonly pagina = signal(1);
  readonly tamano = signal(TAMANO_PAGINA);

  readonly configActual = computed(() => CONFIGS[this.pestana()]);

  private readonly listado = consulta<Coleccion<FilaPapelera>>({
    fuente: () => {
      if (!this.puedeVer()) return null;
      return urlConParametros(urlApi(CONFIGS[this.pestana()].ruta), {
        ...paramsDePagina({ pagina: this.pagina(), tamano: this.tamano() }),
        anulados: 'true',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      const mapear = CONFIGS[this.pestana()].mapear;
      return {
        ...coleccion,
        elementos: coleccion.elementos.map(mapear),
      } satisfies Coleccion<FilaPapelera>;
    },
  });

  readonly filas = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly estadoListado = this.listado.estado;
  readonly errorListado = this.listado.error;

  readonly rango = computed(() => {
    const valor = this.listado.valor();
    return valor ? rangoPagina(valor) : { desde: 0, hasta: 0 };
  });

  readonly resumenTabla = computed(() => {
    const rango = this.rango();
    return `${this.total()} ${this.configActual().plural} en la papelera · ${rango.desde}–${rango.hasta} · pulse una fila para ver el detalle y restaurar.`;
  });

  /** Fila abierta en el panel; `null` lo cierra. */
  readonly filaAbierta = signal<FilaPapelera | null>(null);

  readonly restaurando = signal(false);
  readonly errorRestauracion = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  formatearFechaHora(valor: string | null | undefined): string {
    return formatearFechaHora(valor);
  }

  cambiarPestana(valor: PestanaPapelera): void {
    if (valor === this.pestana()) return;
    this.cerrarPanel();
    this.aviso.set(null);
    this.errorRestauracion.set(null);
    this.pestana.set(valor);
    this.pagina.set(1);
  }

  cambiarPagina(pagina: number): void {
    this.pagina.set(pagina);
  }

  cambiarTamano(tamano: number): void {
    this.tamano.set(tamano);
    this.pagina.set(1);
  }

  recargarListado(): void {
    this.listado.recargar();
  }

  abrir(fila: FilaPapelera): void {
    this.errorRestauracion.set(null);
    this.filaAbierta.set(fila);
  }

  cerrarPanel(): void {
    this.filaAbierta.set(null);
    this.errorRestauracion.set(null);
  }

  /**
   * Restaura la fila con el POST de su entidad. No pide motivo: restaurar es
   * deshacer la baja. Al volver 200 se cierra el panel, se recarga la página
   * actual del listado y se muestra el aviso.
   */
  restaurarFila(fila: FilaPapelera): void {
    if (this.restaurando()) return;

    const config = this.configActual();
    this.restaurando.set(true);
    this.errorRestauracion.set(null);

    this.http.post<unknown>(urlApi(config.restaurar(fila)), {}).subscribe({
      next: () => {
        this.restaurando.set(false);
        this.filaAbierta.set(null);
        const referencia = fila.codigo || fila.titulo || 'registro';
        this.aviso.set(`${config.singular} restaurado: ${referencia}.`);
        this.listado.recargar();
      },
      error: (fallo: unknown) => {
        this.restaurando.set(false);
        this.errorRestauracion.set(this.mensajeDeError(fallo));
      },
    });
  }

  private mensajeDeError(fallo: unknown): string {
    const error = aErrorApi(fallo);

    if (error.esProhibido) {
      return 'Su rol no permite restaurar registros anulados (403). No se modificó nada.';
    }

    if (error.estado === 404) {
      return 'El registro ya no existe; actualice el listado.';
    }

    if (error.esNoAutorizado) {
      return 'La sesión expiró. Vuelva a iniciar sesión.';
    }

    return error.message;
  }
}
