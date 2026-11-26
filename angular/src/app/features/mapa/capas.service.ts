import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
} from '../../core/http/coleccion';
import { aErrorApi, type ErrorApi } from '../../core/http/errores';

/**
 * Capas opcionales del panorama territorial.
 *
 * Se encienden y apagan sobre el mapa principal que ya existe; no abren otra
 * vista. El servicio sólo trae los datos: el dibujo (renderer canvas, agrupación
 * por distrito y simbología) vive en `mapa.page.ts`, que es quien conoce el
 * `L.Map`.
 *
 * Las dos capas declaran su conteo real; nunca se escriben cifras fijas en la
 * UI. Mientras una capa no responde, sus señales de estado permiten mostrar
 * «—» y un botón de reintento en vez de números inventados.
 */

export type EstadoCapa = 'inactivo' | 'cargando' | 'listo' | 'error';

/** Las dos poblaciones que mezcla `gis.infraestructuras_puntos`. */
export type TipoInfraestructura = 'derecho_acuicola' | 'institucional';

export type PuntoInfraestructura = {
  id: string;
  tipo: TipoInfraestructura;
  lat: number;
  lon: number;
  ubigeo: string | null;
  distrito: string | null;
  provincia: string | null;
  region: string | null;
  /** Institución dueña; sólo en sedes. */
  identi: string | null;
  /** Nombre de la instalación; sólo en sedes. */
  nombreInfraestructura: string | null;
};

export type ResumenInfraestructuras = {
  /** Filas totales de la capa, con y sin coordenada. */
  total: number;
  derechosAcuicolas: number;
  sedes: number;
  /** Puntos que no se pueden dibujar; se declaran, no se descartan en silencio. */
  sinCoordenada: number;
};

export type AuditorioMapa = {
  id: string;
  codigo: string;
  nombre: string;
  aforo: number | null;
  activo: boolean;
  ubigeo: string | null;
  distrito: string | null;
  provincia: string | null;
  region: string | null;
  centroide: { lat: number; lon: number } | null;
};

export type ResumenAuditorios = {
  total: number;
  conCentroide: number;
  sinCentroide: number;
  sinDistrito: number;
};

/** Tope de `tamano` que admite `GET /api/v1/territorio/capas` (10 000). */
const LOTE_INFRAESTRUCTURAS = 5_000;

const RESUMEN_INFRA_VACIO: ResumenInfraestructuras = {
  total: 0,
  derechosAcuicolas: 0,
  sedes: 0,
  sinCoordenada: 0,
};

const RESUMEN_AUDITORIOS_VACIO: ResumenAuditorios = {
  total: 0,
  conCentroide: 0,
  sinCentroide: 0,
  sinDistrito: 0,
};

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const convertido = Number(valor);
    return Number.isFinite(convertido) ? convertido : null;
  }
  return null;
}

function aPuntoInfraestructura(bruto: unknown): PuntoInfraestructura | null {
  if (!esRegistro(bruto)) return null;
  const id = texto(bruto['id']);
  const lat = numero(bruto['lat']);
  const lon = numero(bruto['lon']);
  if (!id || lat === null || lon === null) return null;

  return {
    id,
    tipo: bruto['tipo'] === 'institucional' ? 'institucional' : 'derecho_acuicola',
    lat,
    lon,
    ubigeo: texto(bruto['ubigeo']),
    distrito: texto(bruto['distrito']),
    provincia: texto(bruto['provincia']),
    region: texto(bruto['region']),
    identi: texto(bruto['identi']),
    nombreInfraestructura: texto(bruto['nombreInfraestructura']),
  };
}

function aResumenInfraestructuras(bruto: unknown): ResumenInfraestructuras {
  if (!esRegistro(bruto)) return RESUMEN_INFRA_VACIO;
  return {
    total: numero(bruto['total']) ?? 0,
    derechosAcuicolas: numero(bruto['derechosAcuicolas']) ?? 0,
    sedes: numero(bruto['sedes']) ?? 0,
    sinCoordenada: numero(bruto['sinCoordenada']) ?? 0,
  };
}

function aAuditorio(bruto: unknown): AuditorioMapa | null {
  if (!esRegistro(bruto)) return null;
  const id = texto(bruto['id']);
  const nombre = texto(bruto['nombre']);
  if (!id || !nombre) return null;

  const centroide = esRegistro(bruto['centroide'])
    ? (() => {
        const lat = numero((bruto['centroide'] as Record<string, unknown>)['lat']);
        const lon = numero((bruto['centroide'] as Record<string, unknown>)['lon']);
        return lat === null || lon === null ? null : { lat, lon };
      })()
    : null;

  return {
    id,
    codigo: texto(bruto['codigo']) ?? id,
    nombre,
    aforo: numero(bruto['aforo']),
    activo: bruto['activo'] === true,
    ubigeo: texto(bruto['ubigeo']),
    distrito: texto(bruto['distrito']),
    provincia: texto(bruto['provincia']),
    region: texto(bruto['region']),
    centroide,
  };
}

function aResumenAuditorios(bruto: unknown): ResumenAuditorios {
  if (!esRegistro(bruto)) return RESUMEN_AUDITORIOS_VACIO;
  return {
    total: numero(bruto['total']) ?? 0,
    conCentroide: numero(bruto['conCentroide']) ?? 0,
    sinCentroide: numero(bruto['sinCentroide']) ?? 0,
    sinDistrito: numero(bruto['sinDistrito']) ?? 0,
  };
}

/**
 * Cliente de `/api/v1/territorio/capas`. Se registra en los `providers` del
 * panorama para que su caché dure lo que dura la pantalla.
 */
@Injectable()
export class CapasMapaService {
  private readonly http = inject(HttpClient);

  private readonly _estadoInfra = signal<EstadoCapa>('inactivo');
  private readonly _errorInfra = signal<ErrorApi | null>(null);
  private readonly _resumenInfra = signal<ResumenInfraestructuras>(RESUMEN_INFRA_VACIO);
  private readonly _puntosInfra = signal<readonly PuntoInfraestructura[]>([]);

  private readonly _estadoAuditorios = signal<EstadoCapa>('inactivo');
  private readonly _errorAuditorios = signal<ErrorApi | null>(null);
  private readonly _resumenAuditorios = signal<ResumenAuditorios>(RESUMEN_AUDITORIOS_VACIO);
  private readonly _auditorios = signal<readonly AuditorioMapa[]>([]);

  readonly estadoInfra = this._estadoInfra.asReadonly();
  readonly errorInfra = this._errorInfra.asReadonly();
  readonly resumenInfra = this._resumenInfra.asReadonly();
  readonly puntosInfra = this._puntosInfra.asReadonly();

  readonly estadoAuditorios = this._estadoAuditorios.asReadonly();
  readonly errorAuditorios = this._errorAuditorios.asReadonly();
  readonly resumenAuditorios = this._resumenAuditorios.asReadonly();
  readonly auditorios = this._auditorios.asReadonly();

  /**
   * Trae los puntos de infraestructuras recorriendo todas las páginas. Ya
   * cargados, el filtro por tipo se resuelve en el cliente para no volver a
   * pedir 13 456 filas cada vez que se cambia el segmentado.
   */
  async cargarInfraestructuras(): Promise<void> {
    const estado = this._estadoInfra();
    if (estado === 'cargando' || estado === 'listo') return;

    this._estadoInfra.set('cargando');
    this._errorInfra.set(null);

    try {
      const { puntos, resumen } = await this.leerInfraestructuras();
      this._puntosInfra.set(puntos);
      this._resumenInfra.set(resumen);
      this._estadoInfra.set('listo');
    } catch (fallo) {
      this._errorInfra.set(aErrorApi(fallo));
      this._estadoInfra.set('error');
    }
  }

  /** Los 27 auditorios en una sola petición; ya vienen ubicados por distrito. */
  async cargarAuditorios(): Promise<void> {
    const estado = this._estadoAuditorios();
    if (estado === 'cargando' || estado === 'listo') return;

    this._estadoAuditorios.set('cargando');
    this._errorAuditorios.set(null);

    try {
      const bruto = await firstValueFrom(
        this.http.get<unknown>(
          urlConParametros(urlApi('/v1/territorio/capas'), { recurso: 'auditorios' }),
        ),
      );

      const coleccion = normalizarColeccion<unknown>(bruto);
      const auditorios = coleccion.elementos
        .map(aAuditorio)
        .filter((auditorio): auditorio is AuditorioMapa => auditorio !== null);

      this._auditorios.set(auditorios);
      this._resumenAuditorios.set(aResumenAuditorios(bruto));
      this._estadoAuditorios.set('listo');
    } catch (fallo) {
      this._errorAuditorios.set(aErrorApi(fallo));
      this._estadoAuditorios.set('error');
    }
  }

  private async leerInfraestructuras(): Promise<{
    puntos: PuntoInfraestructura[];
    resumen: ResumenInfraestructuras;
  }> {
    const puntos: PuntoInfraestructura[] = [];
    let resumen = RESUMEN_INFRA_VACIO;
    let pagina = 1;

    while (true) {
      const bruto = await firstValueFrom(
        this.http.get<unknown>(
          urlConParametros(urlApi('/v1/territorio/capas'), {
            recurso: 'infraestructuras',
            ...paramsDePagina({ pagina, tamano: LOTE_INFRAESTRUCTURAS }),
          }),
        ),
      );

      resumen = aResumenInfraestructuras(esRegistro(bruto) ? bruto['resumen'] : undefined);

      const coleccion = normalizarColeccion<unknown>(bruto);
      for (const elemento of coleccion.elementos) {
        const punto = aPuntoInfraestructura(elemento);
        if (punto) puntos.push(punto);
      }

      // Una página vacía corta el ciclo aunque `total` venga desalineado.
      if (!coleccion.elementos.length || puntos.length >= coleccion.total) break;
      pagina += 1;
    }

    return { puntos, resumen };
  }
}
