/**
 * Medios y galería fotográfica → dominio.
 *
 * Único punto donde se traduce `GET /api/v1/media` (`core.medios`) al
 * vocabulario de las fichas y tablas. El modelo es polimórfico: una fila
 * pertenece a una entidad por `entidadTipo` + `entidadId`, de modo que la misma
 * tabla sostiene las fotos de actores, organizaciones y locales.
 *
 * Regla del proyecto: si una entidad no tiene fotos, la galería declara
 * «Sin fotografías». No se siembran imágenes ni se estiman.
 */

import { booleano, esRegistro, numero, texto } from './mapeo';

/** Tipos de entidad que acepta `core.medios` (`MEDIA_ENTITY_TYPES`). */
export const MEDIOS_ENTIDADES = [
  'actor',
  'organizacion',
  'local',
  'caso',
  'documento',
  'reunion',
] as const;

export type MedioEntidadTipo = (typeof MEDIOS_ENTIDADES)[number];

/** Roles del catálogo (`MEDIA_ROLES`). */
export const MEDIOS_ROLES = ['principal', 'galeria', 'adjunto', 'evidencia'] as const;

export type MedioRol = (typeof MEDIOS_ROLES)[number];

export type Foto = {
  id: string;
  entidadTipo: string;
  entidadId: string;
  rol: string;
  titulo: string | null;
  descripcion: string | null;
  url: string;
  mime: string;
  ancho: number | null;
  alto: number | null;
  orden: number;
  esPrincipal: boolean;
  alt: string | null;
  credito: string | null;
};

/** Fila de `items[]` del sobre paginado de medios. */
export function aFoto(bruto: unknown): Foto {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    entidadTipo: texto(registro, ['entidadTipo', 'entidad_tipo']) ?? '',
    entidadId: texto(registro, ['entidadId', 'entidad_id']) ?? '',
    rol: texto(registro, ['rol']) ?? 'galeria',
    titulo: texto(registro, ['titulo']),
    descripcion: texto(registro, ['descripcion']),
    url: texto(registro, ['url']) ?? '',
    mime: texto(registro, ['mime']) ?? '',
    ancho: numero(registro, ['ancho']),
    alto: numero(registro, ['alto']),
    orden: numero(registro, ['orden']) ?? 0,
    esPrincipal: booleano(registro, ['esPrincipal', 'es_principal']),
    alt: texto(registro, ['alt']),
    credito: texto(registro, ['credito']),
  };
}

/** Una foto sólo es pintable si tiene URL; el resto se descarta. */
export function esFotoPintable(foto: Foto): boolean {
  return !!foto.url.trim();
}

/** Foto principal de un conjunto ya ordenado por el servidor. */
export function fotoPrincipal(fotos: readonly Foto[]): Foto | null {
  return fotos.find((foto) => foto.esPrincipal) ?? fotos[0] ?? null;
}

/** Agrupa fotos por `entidadId`, respetando el orden que devolvió el servidor. */
export function fotosPorEntidad(fotos: readonly Foto[]): Map<string, Foto[]> {
  const mapa = new Map<string, Foto[]>();
  for (const foto of fotos) {
    const lista = mapa.get(foto.entidadId) ?? [];
    lista.push(foto);
    mapa.set(foto.entidadId, lista);
  }
  return mapa;
}
