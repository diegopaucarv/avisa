import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { normalizarColeccion, paramsDePagina, urlConParametros } from '../../core/http/coleccion';
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

/** Las dos poblaciones que mezcla la capa de infraestructuras. */
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

/** Las tres capas de puntos que comparten contrato con `infraestructuras`. */
export type RecursoPuntos = 'infraestructuras' | 'fondepes' | 'desembarcaderos';

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

type CapaPuntos = {
  estado: EstadoCapa;
  error: ErrorApi | null;
  resumen: ResumenInfraestructuras;
  puntos: readonly PuntoInfraestructura[];
};

const CAPA_PUNTOS_VACIA: CapaPuntos = {
  estado: 'inactivo',
  error: null,
  resumen: RESUMEN_INFRA_VACIO,
  puntos: [],
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

  private readonly _estadoAuditorios = signal<EstadoCapa>('inactivo');
  private readonly _errorAuditorios = signal<ErrorApi | null>(null);
  private readonly _resumenAuditorios = signal<ResumenAuditorios>(RESUMEN_AUDITORIOS_VACIO);
  private readonly _auditorios = signal<readonly AuditorioMapa[]>([]);

  // Cada capa de puntos guarda su propio estado: encender FONDEPES no debe
  // reutilizar (ni invalidar) el estado de derechos acuícolas.
  private readonly _capasPuntos = signal<Record<RecursoPuntos, CapaPuntos>>({
    infraestructuras: CAPA_PUNTOS_VACIA,
    fondepes: CAPA_PUNTOS_VACIA,
    desembarcaderos: CAPA_PUNTOS_VACIA,
  });

  readonly estadoInfra = computed(() => this._capasPuntos()['infraestructuras'].estado);
  readonly errorInfra = computed(() => this._capasPuntos()['infraestructuras'].error);
  readonly resumenInfra = computed(() => this._capasPuntos()['infraestructuras'].resumen);
  readonly puntosInfra = computed(() => this._capasPuntos()['infraestructuras'].puntos);

  readonly estadoFondepes = computed(() => this._capasPuntos()['fondepes'].estado);
  readonly errorFondepes = computed(() => this._capasPuntos()['fondepes'].error);
  readonly resumenFondepes = computed(() => this._capasPuntos()['fondepes'].resumen);
  readonly puntosFondepes = computed(() => this._capasPuntos()['fondepes'].puntos);

  readonly estadoDpa = computed(() => this._capasPuntos()['desembarcaderos'].estado);
  readonly errorDpa = computed(() => this._capasPuntos()['desembarcaderos'].error);
  readonly resumenDpa = computed(() => this._capasPuntos()['desembarcaderos'].resumen);
  readonly puntosDpa = computed(() => this._capasPuntos()['desembarcaderos'].puntos);

  readonly estadoAuditorios = this._estadoAuditorios.asReadonly();
  readonly errorAuditorios = this._errorAuditorios.asReadonly();
  readonly resumenAuditorios = this._resumenAuditorios.asReadonly();
  readonly auditorios = this._auditorios.asReadonly();

  /**
   * Trae los puntos de una capa recorriendo todas las páginas. Ya cargados, el
   * filtro por tipo se resuelve en el cliente para no volver a pedir 13 456
   * filas cada vez que se cambia de capa.
   */
  async cargarInfraestructuras(): Promise<void> {
    await this.cargarPuntos('infraestructuras');
  }

  /** Sedes de FONDEPES: misma forma que infraestructuras, endpoint propio. */
  async cargarFondepes(): Promise<void> {
    await this.cargarPuntos('fondepes');
  }

  /** Desembarcaderos pesqueros artesanales (DPA). */
  async cargarDesembarcaderos(): Promise<void> {
    await this.cargarPuntos('desembarcaderos');
  }

  private async cargarPuntos(recurso: RecursoPuntos): Promise<void> {
    const actual = this._capasPuntos()[recurso];
    if (actual.estado === 'cargando' || actual.estado === 'listo') return;

    this.parcharCapa(recurso, { estado: 'cargando', error: null });

    try {
      const { puntos, resumen } = await this.leerPuntos(recurso);
      this.parcharCapa(recurso, { puntos, resumen, estado: 'listo' });
    } catch (fallo) {
      this.parcharCapa(recurso, { error: aErrorApi(fallo), estado: 'error' });
    }
  }

  private parcharCapa(recurso: RecursoPuntos, cambio: Partial<CapaPuntos>): void {
    this._capasPuntos.update((capas) => ({
      ...capas,
      [recurso]: { ...capas[recurso], ...cambio },
    }));
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

  private async leerPuntos(recurso: RecursoPuntos): Promise<{
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
            recurso,
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
