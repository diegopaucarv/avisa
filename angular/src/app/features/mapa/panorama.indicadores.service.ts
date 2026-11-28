import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { aErrorApi, type ErrorApi } from '../../core/http/errores';
import type { MedidaRegion, SectoristaMedidas } from './panorama.agregados';

/**
 * Indicadores agregados del panorama (`GET /api/v1/panorama/indicadores`).
 *
 * Es un endpoint opcional: mientras no exista (404) o el backend no esté
 * desplegado (503), la vista lo declara y sigue funcionando con lo que ya
 * calcula sobre `/v1/cases`. Aquí nunca se rellenan cifras ausentes: una medida
 * que no llega queda en 0 y el componente decide si puede mostrarla.
 *
 * El servicio se registra en los `providers` del panorama para que su estado
 * dure lo que dura la pantalla y una recarga no repita la petición en balde.
 */

export type EstadoIndicadores = 'cargando' | 'listo' | 'error';

export type VentanaAlertas = {
  dias: number;
  desde: string | null;
};

const VENTANA_POR_DEFECTO: VentanaAlertas = { dias: 90, desde: null };

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

function numero(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const convertido = Number(valor);
    return Number.isFinite(convertido) ? convertido : 0;
  }
  return 0;
}

function aMedida(bruto: unknown): MedidaRegion | null {
  if (!esRegistro(bruto)) return null;
  const region = texto(bruto['region']);
  if (!region) return null;

  return {
    region,
    ubigeo: texto(bruto['ubigeo']),
    casos: numero(bruto['casos']),
    manifiestos: numero(bruto['manifiestos']),
    riesgoAlto: numero(bruto['riesgoAlto']),
    alertas90d: numero(bruto['alertas90d']),
    alertasRiesgoAlto: numero(bruto['alertasRiesgoAlto']),
  };
}

function aMedidas(bruto: unknown): MedidaRegion[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map(aMedida).filter((medida): medida is MedidaRegion => medida !== null);
}

function aSectorista(bruto: unknown): SectoristaMedidas | null {
  if (!esRegistro(bruto)) return null;
  const id = texto(bruto['id']);
  const nombre = texto(bruto['nombre']);
  if (!id || !nombre) return null;

  // El backend entrega `regionesDetalle` (una medida por región con actividad).
  // Si todavía no llegara —backend viejo—, se acepta `regiones` como lista de
  // nombres para no romper: cada nombre queda como medida en cero.
  const detalle = aMedidas(bruto['regionesDetalle']);
  const regiones: MedidaRegion[] = detalle.length > 0 ? detalle : aMedidas(bruto['regiones']);

  return { id, nombre, regiones };
}

function aVentana(bruto: unknown): VentanaAlertas {
  if (!esRegistro(bruto)) return VENTANA_POR_DEFECTO;
  return {
    dias: numero(bruto['dias']) || VENTANA_POR_DEFECTO.dias,
    desde: texto(bruto['desde']),
  };
}

@Injectable()
export class PanoramaIndicadoresService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  private turno = 0;

  private readonly _regiones = signal<readonly MedidaRegion[]>([]);
  private readonly _sectoristas = signal<readonly SectoristaMedidas[]>([]);
  private readonly _ventana = signal<VentanaAlertas>(VENTANA_POR_DEFECTO);
  private readonly _estado = signal<EstadoIndicadores>('cargando');
  private readonly _error = signal<ErrorApi | null>(null);

  readonly regiones = this._regiones.asReadonly();
  readonly sectoristas = this._sectoristas.asReadonly();
  readonly ventana = this._ventana.asReadonly();
  readonly estado = this._estado.asReadonly();
  readonly error = this._error.asReadonly();

  /** `true` sólo cuando el endpoint respondió con datos utilizables. */
  readonly disponible = computed(() => this._estado() === 'listo');

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.turno += 1;
    });
    void this.cargar();
  }

  recargar(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    const turno = ++this.turno;
    this._estado.set('cargando');
    this._error.set(null);

    try {
      const bruto = await firstValueFrom(this.peticion());
      if (turno !== this.turno) return;

      const registro = esRegistro(bruto) ? bruto : {};
      this._regiones.set(aMedidas(registro['regiones']));
      this._sectoristas.set(
        (Array.isArray(registro['sectoristas']) ? registro['sectoristas'] : [])
          .map(aSectorista)
          .filter((sectorista): sectorista is SectoristaMedidas => sectorista !== null),
      );
      this._ventana.set(aVentana(registro['ventanaAlertas']));
      this._estado.set('listo');
    } catch (fallo) {
      if (turno !== this.turno) return;

      this._error.set(aErrorApi(fallo));
      this._estado.set('error');
    }
  }

  private peticion(): Observable<unknown> {
    return this.http.get<unknown>(urlApi('/v1/panorama/indicadores'));
  }
}
