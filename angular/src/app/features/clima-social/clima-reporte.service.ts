import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
import { aErrorApi, type ErrorApi } from '../../core/http/errores';
import {
  aDetalleReporte,
  aDocumentoClima,
  documentosOrdenados,
  etiquetaDeMes,
  mesDeFecha,
  mesDeHoy,
  mesPrevio,
  mesProximo,
  seleccionarReporteDelMes,
  type DetalleReporte,
  type DocumentoClima,
  type MesConsulta,
} from './clima-social.mapeo';

export type EstadoClima = 'cargando' | 'listo' | 'error';
export type EstadoDetalle = 'inactivo' | 'cargando' | 'listo' | 'error';

/** Tope de `pageSize` que aplica `GET /api/v1/documents`. */
const LOTE = 100;

const TIPOS_REPORTE = ['clima_social_general', 'clima_social_focalizado'] as const;

/**
 * Reportes de clima social.
 *
 * No existe `core.reportes` para clima social: los reportes son documentos de
 * `core.documentos` con tipo `clima_social_general` (Anexo 04) o
 * `clima_social_focalizado` (Anexo 05). Se leen ambos tipos, se ordenan por
 * fecha y el «reporte del mes» es el más reciente cuya `fecha` cae en el mes
 * consultado. El contenido estructurado exige el detalle del documento
 * (`contenido_json`), que no viaja en el listado.
 *
 * El mes por defecto es el actual; si no hay reporte, `reporteDelMes` es
 * `null` y la pantalla lo declara en vez de estimarlo.
 */
@Injectable()
export class ClimaReporteService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private turnoLista = 0;
  private turnoDetalle = 0;
  private idCargado: string | null = null;

  private readonly _documentos = signal<DocumentoClima[]>([]);
  private readonly _estado = signal<EstadoClima>('cargando');
  private readonly _error = signal<ErrorApi | null>(null);
  private readonly _mes = signal<MesConsulta>(mesDeHoy());
  private readonly _detalle = signal<DetalleReporte | null>(null);
  private readonly _estadoDetalle = signal<EstadoDetalle>('inactivo');
  private readonly _errorDetalle = signal<ErrorApi | null>(null);

  readonly documentos = this._documentos.asReadonly();
  readonly estado = this._estado.asReadonly();
  readonly error = this._error.asReadonly();
  readonly mes = this._mes.asReadonly();
  readonly detalle = this._detalle.asReadonly();
  readonly estadoDetalle = this._estadoDetalle.asReadonly();
  readonly errorDetalle = this._errorDetalle.asReadonly();

  readonly reporteDelMes = computed(() =>
    seleccionarReporteDelMes(this._documentos(), this._mes()),
  );
  readonly historico = computed(() => documentosOrdenados(this._documentos()));
  readonly etiquetaMes = computed(() => etiquetaDeMes(this._mes()));
  /** Sólo se avanza hasta el mes actual: no hay reportes con fecha futura. */
  readonly puedeAvanzar = computed(() => {
    const hoy = mesDeHoy();
    const actual = this._mes();
    return actual.anio < hoy.anio || (actual.anio === hoy.anio && actual.mes < hoy.mes);
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.turnoLista += 1;
      this.turnoDetalle += 1;
    });
    void this.cargar();
  }

  recargar(): void {
    void this.cargar();
  }

  irAlMesAnterior(): void {
    this.irAMes(mesPrevio(this._mes()));
  }

  irAlMesSiguiente(): void {
    if (!this.puedeAvanzar()) return;
    this.irAMes(mesProximo(this._mes()));
  }

  volverAlMesActual(): void {
    this.irAMes(mesDeHoy());
  }

  irAMes(mes: MesConsulta): void {
    if (mes.anio === this._mes().anio && mes.mes === this._mes().mes) return;
    this._mes.set(mes);
    this.sincronizarDetalle();
  }

  /** Lleva la vista al mes del reporte histórico elegido. */
  irAlMesDe(documento: DocumentoClima): void {
    const mes = mesDeFecha(documento.fecha);
    if (mes) this.irAMes(mes);
  }

  recargarDetalle(): void {
    const reporte = this.reporteDelMes();
    if (!reporte) return;
    this.idCargado = null;
    void this.cargarDetalle(reporte.id);
  }

  private sincronizarDetalle(): void {
    const reporte = this.reporteDelMes();
    if (!reporte) {
      this.limpiarDetalle();
      return;
    }
    if (reporte.id === this.idCargado) return;
    void this.cargarDetalle(reporte.id);
  }

  private limpiarDetalle(): void {
    this.turnoDetalle += 1;
    this.idCargado = null;
    this._detalle.set(null);
    this._estadoDetalle.set('inactivo');
    this._errorDetalle.set(null);
  }

  private async cargar(): Promise<void> {
    const turno = ++this.turnoLista;
    this._estado.set('cargando');
    this._error.set(null);

    try {
      const lotes = await Promise.all(TIPOS_REPORTE.map((tipo) => this.leerTipo(tipo)));
      if (turno !== this.turnoLista) return;

      this._documentos.set(documentosOrdenados(lotes.flat()));
      this._estado.set('listo');
      // Se fuerza la recarga del detalle aunque el id no cambie: así «Recargar»
      // también refresca `contenido_json`.
      this.idCargado = null;
      this.sincronizarDetalle();
    } catch (fallo) {
      if (turno !== this.turnoLista) return;

      this._error.set(aErrorApi(fallo));
      this._estado.set('error');
    }
  }

  private async leerTipo(tipo: string): Promise<DocumentoClima[]> {
    const acumulado: DocumentoClima[] = [];
    let pagina = 1;

    while (pagina <= 50) {
      const bruto = await firstValueFrom(
        this.http.get<unknown>(
          urlConParametros(urlApi('/v1/documents'), {
            ...paramsDePagina({ pagina, tamano: LOTE }),
            tipo,
            sort: 'recent',
          }),
        ),
      );

      const coleccion = normalizarColeccion<unknown>(bruto);
      acumulado.push(...coleccion.elementos.map(aDocumentoClima));

      // Una página vacía corta el ciclo aunque `total` venga desalineado.
      if (!coleccion.elementos.length || acumulado.length >= coleccion.total) break;
      pagina += 1;
    }

    return acumulado;
  }

  private async cargarDetalle(id: string): Promise<void> {
    const turno = ++this.turnoDetalle;
    this.idCargado = id;
    this._detalle.set(null);
    this._estadoDetalle.set('cargando');
    this._errorDetalle.set(null);

    try {
      const bruto = await firstValueFrom(
        this.http.get<unknown>(urlApi(`/v1/documents/${encodeURIComponent(id)}`)),
      );
      if (turno !== this.turnoDetalle) return;

      this._detalle.set(aDetalleReporte(bruto));
      this._estadoDetalle.set('listo');
    } catch (fallo) {
      if (turno !== this.turnoDetalle) return;

      this._errorDetalle.set(aErrorApi(fallo));
      this._estadoDetalle.set('error');
    }
  }
}
