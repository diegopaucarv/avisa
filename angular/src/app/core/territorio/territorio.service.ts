import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../config/entorno';
import { urlConParametros } from '../http/coleccion';
import { aErrorApi, type ErrorApi } from '../http/errores';
import type {
  AnpGeo,
  CentroideDistrito,
  DistritoGeo,
  EstadoCapa,
  PoblacionRegion,
  ProvinciaGeo,
  RegionGeo,
} from './territorio.tipos';

/**
 * Capa distrital censal (`territorio.distrito`) y sus denominadores.
 *
 * La geometría dice **dónde** está un territorio, no cuánto pesa: la población
 * se usa sólo como denominador de tasas por 100 000 habitantes y nunca entra en
 * el nivel de riesgo ni en la prioridad (Guía §7.5.2, Tabla 3).
 *
 * Los nombres de `region` y `provincia` llegan de la tabla en mayúsculas y sin
 * tildes (`LIMA`, `ANCASH`); quien los cruce con `core.regiones` debe comparar
 * con `normalizarRegion` del panorama, nunca por igualdad de cadena.
 */

export type {
  AnpGeo,
  CentroideDistrito,
  DistritoGeo,
  EstadoCapa,
  PoblacionRegion,
  ProvinciaGeo,
  RegionGeo,
} from './territorio.tipos';

/** Tolerancia de simplificación por defecto: la misma que aplica el servidor. */
const TOLERANCIA_POR_DEFECTO = 0.01;

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

function centroideDe(valor: unknown): CentroideDistrito | null {
  if (!esRegistro(valor)) return null;
  const lat = numero(valor['lat']);
  const lon = numero(valor['lon']);
  return lat === null || lon === null ? null : { lat, lon };
}

/**
 * Acepta `MultiPolygon` y `Polygon`: `ST_SimplifyPreserveTopology` puede
 * devolver una sola parte, y el servidor la envuelve en `MultiPolygon`, pero la
 * ficha individual de un distrito no lo hace. Cualquier otra forma se descarta
 * en vez de dibujar una geometría que no se entiende.
 */
function geometriaDe(valor: unknown): DistritoGeo['geometria'] | null {
  if (!esRegistro(valor)) return null;
  const tipo = valor['type'];
  if (tipo !== 'MultiPolygon' && tipo !== 'Polygon') return null;
  if (!Array.isArray(valor['coordinates'])) return null;
  return valor as unknown as DistritoGeo['geometria'];
}

function aDistrito(bruto: unknown): DistritoGeo | null {
  if (!esRegistro(bruto)) return null;
  const propiedades = esRegistro(bruto['properties']) ? bruto['properties'] : {};
  const geometria = geometriaDe(bruto['geometry']);
  const ubigeo = texto(propiedades['ubigeo']) ?? texto(bruto['id']);
  const nombre = texto(propiedades['nombre']);
  if (!ubigeo || !nombre || !geometria) return null;

  return {
    ubigeo,
    nombre,
    provincia: texto(propiedades['provincia']),
    region: texto(propiedades['region']),
    poblacion: numero(propiedades['poblacion']),
    centroide: centroideDe(propiedades['centroide']),
    geometria,
  };
}

/**
 * Región o provincia. Comparten contrato (`ubigeo|nombre|region|alcance|poblacion`),
 * así que el mismo lector sirve a las dos capas y a la vista no le importa cuál
 * respondió.
 */
function aRegionOProvincia(bruto: unknown): RegionGeo | null {
  if (!esRegistro(bruto)) return null;
  const propiedades = esRegistro(bruto['properties']) ? bruto['properties'] : {};
  const geometria = geometriaDe(bruto['geometry']);
  const ubigeo = texto(propiedades['ubigeo']) ?? texto(bruto['id']);
  const nombre = texto(propiedades['nombre']);
  if (!ubigeo || !nombre || !geometria) return null;

  return {
    ubigeo,
    nombre,
    region: texto(propiedades['region']) ?? nombre,
    alcance: texto(propiedades['alcance']),
    poblacion: numero(propiedades['poblacion']),
    geometria,
  };
}

function aAnp(bruto: unknown): AnpGeo | null {
  if (!esRegistro(bruto)) return null;
  const propiedades = esRegistro(bruto['properties']) ? bruto['properties'] : {};
  const geometria = geometriaDe(bruto['geometry']);
  const codigo = texto(propiedades['codigo']) ?? texto(bruto['id']);
  const nombre = texto(propiedades['nombre']);
  if (!codigo || !nombre || !geometria) return null;

  return {
    codigo,
    nombre,
    categoria: texto(propiedades['categoria']),
    geometria,
  };
}

function aPoblacionRegion(bruto: unknown): PoblacionRegion | null {
  if (!esRegistro(bruto)) return null;
  const clave = texto(bruto['clave']);
  const nombre = texto(bruto['nombre']);
  if (!clave || !nombre) return null;

  return {
    clave,
    nombre,
    poblacion: numero(bruto['poblacion']),
    distritos: numero(bruto['distritos']) ?? 0,
    distritosConPoblacion: numero(bruto['distritosConPoblacion']) ?? 0,
  };
}

/**
 * Servicio de la capa distrital. Cachea por región: la geometría nacional se
 * pide una sola vez aunque el usuario entre y salga del panorama. Es
 * `providedIn: 'root'` para que la caché sobreviva a la navegación.
 */
@Injectable({ providedIn: 'root' })
export class TerritorioService {
  private readonly http = inject(HttpClient);

  private readonly cacheDistritos = new Map<string, Promise<DistritoGeo[]>>();
  private poblacion: Promise<ReadonlyMap<string, PoblacionRegion>> | null = null;

  private readonly _estadoDistritos = signal<EstadoCapa>('inactivo');
  private readonly _errorDistritos = signal<ErrorApi | null>(null);
  private readonly _estadoPoblacion = signal<EstadoCapa>('inactivo');
  private readonly _errorPoblacion = signal<ErrorApi | null>(null);

  readonly estadoDistritos = this._estadoDistritos.asReadonly();
  readonly errorDistritos = this._errorDistritos.asReadonly();
  readonly estadoPoblacion = this._estadoPoblacion.asReadonly();
  readonly errorPoblacion = this._errorPoblacion.asReadonly();

  // ── Capas territoriales (regiones permanentes; provincias y ANP opcionales) ──
  // Se cargan con señal y no con promesa porque el mapa las repinta cada vez
  // que cambia el ámbito o el coroplético: el componente necesita observar los
  // datos ya resueltos, no volver a suscribirse a la petición.
  private readonly _regiones = signal<readonly RegionGeo[]>([]);
  private readonly _estadoRegiones = signal<EstadoCapa>('inactivo');
  private readonly _errorRegiones = signal<ErrorApi | null>(null);

  private readonly _provincias = signal<readonly ProvinciaGeo[]>([]);
  private readonly _estadoProvincias = signal<EstadoCapa>('inactivo');
  private readonly _errorProvincias = signal<ErrorApi | null>(null);

  private readonly _anp = signal<readonly AnpGeo[]>([]);
  private readonly _estadoAnp = signal<EstadoCapa>('inactivo');
  private readonly _errorAnp = signal<ErrorApi | null>(null);

  readonly regiones = this._regiones.asReadonly();
  readonly estadoRegiones = this._estadoRegiones.asReadonly();
  readonly errorRegiones = this._errorRegiones.asReadonly();

  readonly provincias = this._provincias.asReadonly();
  readonly estadoProvincias = this._estadoProvincias.asReadonly();
  readonly errorProvincias = this._errorProvincias.asReadonly();

  readonly anp = this._anp.asReadonly();
  readonly estadoAnp = this._estadoAnp.asReadonly();
  readonly errorAnp = this._errorAnp.asReadonly();

  /**
   * Distritos de la capa GIS, opcionalmente acotados a una región.
   *
   * La respuesta ya viene simplificada en el servidor; la tolerancia sólo se
   * envía cuando se quiere una vista más gruesa o más fina que la de omisión.
   */
  distritos(region?: string | null, tolerancia?: number): Promise<DistritoGeo[]> {
    const clave = `${region?.trim() || 'nacional'}|${tolerancia ?? TOLERANCIA_POR_DEFECTO}`;
    const enCache = this.cacheDistritos.get(clave);
    if (enCache) return enCache;

    this._estadoDistritos.set('cargando');
    this._errorDistritos.set(null);

    const peticion = this.pedirDistritos(region, tolerancia)
      .then((distritos) => {
        this._estadoDistritos.set('listo');
        return distritos;
      })
      .catch((fallo: unknown) => {
        // Un fallo no se cachea: se reintenta en el próximo montaje.
        this.cacheDistritos.delete(clave);
        this._errorDistritos.set(aErrorApi(fallo));
        this._estadoDistritos.set('error');
        throw fallo;
      });

    this.cacheDistritos.set(clave, peticion);
    return peticion;
  }

  private async pedirDistritos(
    region: string | null | undefined,
    tolerancia: number | undefined,
  ): Promise<DistritoGeo[]> {
    const parametros: Record<string, string | number> = {};
    if (region?.trim()) parametros['region'] = region.trim();

    const rasgos = await this.leerRasgos('distritos', parametros, tolerancia);
    return rasgos.map(aDistrito).filter((distrito): distrito is DistritoGeo => distrito !== null);
  }

  /**
   * Rasgos GeoJSON de `GET /api/v1/territorio`. Un solo punto de validación del
   * sobre: si el servidor no devuelve `features`, se falla en vez de dibujar un
   * mapa vacío que parecería un cero real.
   */
  private async leerRasgos(
    recurso: string,
    extra: Record<string, string | number> = {},
    tolerancia: number = TOLERANCIA_POR_DEFECTO,
  ): Promise<unknown[]> {
    const bruto = await firstValueFrom(
      this.http.get<unknown>(
        urlConParametros(urlApi('/v1/territorio'), {
          recurso,
          geometria: 1,
          tolerancia,
          ...extra,
        }),
      ),
    );
    if (!esRegistro(bruto) || !Array.isArray(bruto['features'])) {
      throw new Error('La capa territorial no devolvió una colección de elementos.');
    }
    return bruto['features'];
  }

  /**
   * Regiones del país (`recurso=regiones`). Se piden una sola vez al montar el
   * mapa: la capa de departamentos es permanente y también alimenta el
   * coroplético y el encuadre por ámbito.
   */
  async cargarRegiones(): Promise<void> {
    const estadoActual = this._estadoRegiones();
    if (estadoActual === 'cargando' || estadoActual === 'listo') return;

    this._estadoRegiones.set('cargando');
    this._errorRegiones.set(null);
    try {
      const rasgos = await this.leerRasgos('regiones');
      this._regiones.set(
        rasgos.map(aRegionOProvincia).filter((region): region is RegionGeo => region !== null),
      );
      this._estadoRegiones.set('listo');
    } catch (fallo) {
      this._errorRegiones.set(aErrorApi(fallo));
      this._estadoRegiones.set('error');
    }
  }

  /** Provincias: capa opcional, se pide al encenderse. */
  async cargarProvincias(): Promise<void> {
    const estadoActual = this._estadoProvincias();
    if (estadoActual === 'cargando' || estadoActual === 'listo') return;

    this._estadoProvincias.set('cargando');
    this._errorProvincias.set(null);
    try {
      const rasgos = await this.leerRasgos('provincias');
      this._provincias.set(
        rasgos
          .map(aRegionOProvincia)
          .filter((provincia): provincia is ProvinciaGeo => provincia !== null),
      );
      this._estadoProvincias.set('listo');
    } catch (fallo) {
      this._errorProvincias.set(aErrorApi(fallo));
      this._estadoProvincias.set('error');
    }
  }

  /** Áreas naturales protegidas: capa opcional, se pide al encenderse. */
  async cargarAnp(): Promise<void> {
    const estadoActual = this._estadoAnp();
    if (estadoActual === 'cargando' || estadoActual === 'listo') return;

    this._estadoAnp.set('cargando');
    this._errorAnp.set(null);
    try {
      const rasgos = await this.leerRasgos('anp');
      this._anp.set(rasgos.map(aAnp).filter((anp): anp is AnpGeo => anp !== null));
      this._estadoAnp.set('listo');
    } catch (fallo) {
      this._errorAnp.set(aErrorApi(fallo));
      this._estadoAnp.set('error');
    }
  }

  /** Reintento de una capa: se limpia el estado y se vuelve a pedir. */
  reintentarRegiones(): void {
    this._estadoRegiones.set('inactivo');
    void this.cargarRegiones();
  }

  reintentarProvincias(): void {
    this._estadoProvincias.set('inactivo');
    void this.cargarProvincias();
  }

  reintentarAnp(): void {
    this._estadoAnp.set('inactivo');
    void this.cargarAnp();
  }

  /** Población agregada por región, indexada por ubigeo de dos dígitos. */
  poblacionPorRegion(): Promise<ReadonlyMap<string, PoblacionRegion>> {
    if (this.poblacion) return this.poblacion;

    this._estadoPoblacion.set('cargando');
    this._errorPoblacion.set(null);

    this.poblacion = firstValueFrom(
      this.http.get<unknown>(
        urlConParametros(urlApi('/v1/territorio'), {
          recurso: 'poblacion',
          agrupar: 'region',
        }),
      ),
    )
      .then((bruto) => {
        const items = esRegistro(bruto) && Array.isArray(bruto['items']) ? bruto['items'] : [];
        const indice = new Map<string, PoblacionRegion>();
        for (const item of items) {
          const region = aPoblacionRegion(item);
          if (region && !indice.has(region.clave)) indice.set(region.clave, region);
        }
        this._estadoPoblacion.set('listo');
        return indice as ReadonlyMap<string, PoblacionRegion>;
      })
      .catch((fallo: unknown) => {
        this.poblacion = null;
        this._errorPoblacion.set(aErrorApi(fallo));
        this._estadoPoblacion.set('error');
        throw fallo;
      });

    return this.poblacion;
  }
}
