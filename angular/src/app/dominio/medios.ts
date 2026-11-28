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

import { ENTORNO } from '../core/config/entorno';
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
  /**
   * El medio tiene bytes en `core.medios.contenido`.
   *
   * `url` es una ruta estática que puede sobrevivir al archivo original; este
   * booleano dice si además existe el binario servible por
   * `/api/v1/media/<id>/contenido`. La galería lo usa para preferir ese endpoint
   * (ver `urlFoto`) y para no ofrecer «Abrir original» cuando no hay respaldo.
   */
  tieneContenido: boolean;
  alt: string | null;
  credito: string | null;
};

/**
 * URL servible de una foto. El servidor devuelve rutas relativas
 * (`/api/v1/media/<id>/contenido`); si `apiBase` apunta a otro origen, la ruta
 * relativa resolvería contra el host de la SPA y la imagen no cargaría. En ese
 * caso se antepone el origen de la API. Absolutas y `data:` pasan tal cual.
 */
function urlMedio(cruda: string | null): string {
  const url = (cruda ?? '').trim();
  if (!url || !url.startsWith('/')) return url;

  const base = ENTORNO.apiBase;
  if (!/^https?:\/\//i.test(base)) return url;

  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

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
    url: urlMedio(texto(registro, ['url'])),
    mime: texto(registro, ['mime']) ?? '',
    ancho: numero(registro, ['ancho']),
    alto: numero(registro, ['alto']),
    orden: numero(registro, ['orden']) ?? 0,
    esPrincipal: booleano(registro, ['esPrincipal', 'es_principal']),
    tieneContenido: booleano(registro, ['tieneContenido', 'tiene_contenido']),
    alt: texto(registro, ['alt']),
    credito: texto(registro, ['credito']),
  };
}

/** Una foto sólo es pintable si tiene URL; el resto se descarta. */
export function esFotoPintable(foto: Foto): boolean {
  return !!foto.url.trim();
}

/**
 * URL con la que pintar una foto, prefiriendo el binario guardado.
 *
 * `url` puede ser una ruta estática heredada que ya no exista en disco; cuando
 * el medio declara `tieneContenido`, el endpoint de contenido es la fuente
 * fiable (mismo resultado si el estático sigue ahí). Las URL externas
 * (`http(s)`, `data:`, `blob:`) se respetan tal cual: no pertenecen a la API.
 */
export function urlFoto(foto: Foto): string {
  if (!foto.tieneContenido || !foto.id) return foto.url;
  if (/^(https?:|data:|blob:)/i.test(foto.url.trim())) return foto.url;
  return urlMedio(`/api/v1/media/${foto.id}/contenido`);
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
