import type { MultiPolygon, Polygon } from 'geojson';

/**
 * Tipos de la capa distrital, sin dependencias de Angular, para que los
 * agregados puros y sus pruebas puedan usarlos sin arrastrar el cliente HTTP.
 */

export type EstadoCapa = 'inactivo' | 'cargando' | 'listo' | 'error';

export type CentroideDistrito = { lat: number; lon: number };

export type DistritoGeo = {
  ubigeo: string;
  nombre: string;
  provincia: string | null;
  region: string | null;
  /** Denominador (Censo 2025 del archivo). `null` si el insumo no lo trae. */
  poblacion: number | null;
  centroide: CentroideDistrito | null;
  geometria: MultiPolygon | Polygon;
};

/**
 * Región o provincia de la capa censal con su geometría.
 *
 * `properties` trae `ubigeo|nombre|region|alcance|poblacion`; `alcance` es el
 * ámbito de `dominio/mapeo.ts` al que el servidor adscribe la región y llega como
 * texto libre, así que se declara `string | null` y se compara por valor.
 */
export type RegionGeo = {
  ubigeo: string;
  nombre: string;
  region: string | null;
  alcance: string | null;
  poblacion: number | null;
  geometria: MultiPolygon | Polygon;
};

/** Provincias: misma forma que `RegionGeo`. */
export type ProvinciaGeo = RegionGeo;

/** Área natural protegida: sólo se dibuja su contorno, sin denominadores. */
export type AnpGeo = {
  codigo: string;
  nombre: string;
  categoria: string | null;
  geometria: MultiPolygon | Polygon;
};

export type PoblacionRegion = {
  /** Ubigeo de región de dos dígitos (`01` Amazonas … `25` Ucayali). */
  clave: string;
  /** Nombre tal como lo trae la capa (mayúsculas, sin tildes). */
  nombre: string;
  /** Suma de los distritos con dato; `null` si ninguno lo trae. */
  poblacion: number | null;
  /** Distritos de la región en la capa. */
  distritos: number;
  /** Distritos con población declarada; mide la cobertura. */
  distritosConPoblacion: number;
};
