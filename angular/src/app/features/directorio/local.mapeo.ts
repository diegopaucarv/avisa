/**
 * Directorio · Locales: contrato de `GET /api/v1/locales`.
 *
 * Los locales son las sedes donde se reúnen los espacios de diálogo (Guía
 * §8.2.5 y Anexo 16, columna «Lugar»). El equipamiento y el aforo son datos
 * operativos; el contacto del local no es PII de actores, pero la pantalla sólo
 * lo muestra a los roles con `puedeVerPii()`.
 *
 * `tiene_*` es booleano anulable en la base: aquí se conserva el `null` para que
 * la ficha muestre «—» en vez de afirmar «No».
 */

import {
  booleano,
  esRegistro,
  leer,
  lista,
  numero,
  texto,
  type Registro,
} from '../../dominio/mapeo';

/**
 * Tabla fantasma «responsables del local» (`local_responsables`).
 *
 * El contacto deja de vivir en columnas propias del local y pasa a colgar de
 * una tabla relacionada 1→N: cada local puede tener varios responsables con
 * nombre, correo y teléfono. La migración aún no se aplica en la base; el
 * frontend anticipa la relación y, mientras la API no la devuelva, rellena la
 * lista con el contacto heredado (`contacto_*`) para no perder lo que hoy se
 * muestra en la ficha.
 */
export type ResponsableLocal = {
  id: string;
  nombre: string | null;
  correo: string | null;
  telefono: string | null;
};

export type LocalDirectorio = {
  id: string;
  codigo: string;
  nombre: string;
  distritoId: number | null;
  /**
   * Distrito, provincia y región se resuelven por la cadena local → distrito →
   * provincia → región; `null` si el local no tiene distrito asignado.
   */
  distrito: string | null;
  provincia: string | null;
  region: string | null;
  direccion: string | null;
  ubicacionRef: string | null;
  /**
   * Coordenadas si la API llegara a publicarlas. Hoy `core.locales` no tiene
   * columnas de latitud/longitud ni geometría (verificado en `information_schema`
   * el 2026-11-27), así que llegan `null`; se conservan para que la ficha use el
   * punto exacto en cuanto exista sin tocar la vista.
   */
  latitud: number | null;
  longitud: number | null;
  aforo: number | null;
  ingresos: string | null;
  tieneProyector: boolean | null;
  tieneEquiposComputo: boolean | null;
  tieneAudioMicro: boolean | null;
  /** Responsables relacionados (`local_responsables`); nunca vacío si hay contacto. */
  responsables: ResponsableLocal[];
  /** JOIN aplanado del primer responsable: lo que pinta la tabla. */
  responsable: string | null;
  correo: string | null;
  telefono: string | null;
  /** Contacto heredado del contrato anterior; se conserva para no perderlo. */
  contactoNombre: string | null;
  contactoCelular: string | null;
  contactoEmail: string | null;
  recomendacion: string | null;
  fotoUrl: string | null;
  disponible: boolean;
};

const CLAVES_RESPONSABLES = ['responsables', 'responsablesLocal', 'responsables_local'];

/** Coordenada geográfica lista para Leaflet. */
export type Coordenadas = { lat: number; lng: number };

/** Igual que `booleano`, pero distingue «no» de «no registrado» (`null`). */
function booleanoOpcional(objeto: Registro, claves: readonly string[]): boolean | null {
  const valor = leer(objeto, claves);
  return typeof valor === 'boolean' ? valor : null;
}

/** Fila de la tabla relacionada de responsables → dominio. */
function aResponsableLocal(bruto: unknown): ResponsableLocal {
  const registro: Registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    nombre: texto(registro, ['nombre', 'responsable']),
    correo: texto(registro, ['correo', 'email', 'correoElectronico', 'correo_electronico']),
    telefono: texto(registro, ['telefono', 'teléfono', 'celular', 'contactoCelular']),
  };
}

/** Una fila sin ningún dato no es un responsable: se descarta. */
function conDatos(responsable: ResponsableLocal): boolean {
  return Boolean(responsable.nombre || responsable.correo || responsable.telefono);
}

/** JOIN del contacto del local: responsable · teléfono · correo. */
export function contactoDeLocal(local: LocalDirectorio): string | null {
  const partes = [local.responsable, local.telefono, local.correo].filter(
    (parte): parte is string => Boolean(parte),
  );

  return partes.length > 0 ? partes.join(' · ') : null;
}

/** Dirección, distrito, provincia y región en una sola línea. */
export function ubicacionDeLocal(local: LocalDirectorio): string | null {
  const partes = [local.direccion, local.distrito, local.provincia, local.region].filter(
    (parte): parte is string => Boolean(parte),
  );

  return partes.length > 0 ? partes.join(', ') : null;
}

/** Distrito, provincia y región sin la dirección (la dirección tiene su línea). */
export function territorioDeLocal(
  local: Pick<LocalDirectorio, 'distrito' | 'provincia' | 'region'>,
): string | null {
  const partes = [local.distrito, local.provincia, local.region].filter((parte): parte is string =>
    Boolean(parte),
  );

  return partes.length > 0 ? partes.join(', ') : null;
}

/** Descarta coordenadas incompletas o fuera del rango terrestre. */
function coordenadaValida(lat: number | null, lng: number | null): Coordenadas | null {
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Coordenadas embebidas en una URL de Google Maps. Sólo se reconocen las formas
 * que las incluyen literalmente en la URL (`@lat,lng` y `?q=`/`?ll=`/`?query=`).
 * Un enlace corto (`maps.app.goo.gl/…`) no las contiene y, por tanto, no se
 * resuelve aquí: no se hace ninguna petición de red ni se adivina el punto.
 */
const COORDENADAS_EN_URL: readonly RegExp[] = [
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  /[?&](?:q|ll|query|destination|center)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i,
];

/** Extrae `lat,lng` de una URL de mapa; `null` si no las incluye o son inválidas. */
export function coordenadasEnUbicacion(
  ubicacionRef: string | null | undefined,
): Coordenadas | null {
  const referencia = ubicacionRef?.trim() ?? '';
  if (!referencia) return null;

  for (const patron of COORDENADAS_EN_URL) {
    const coincidencia = patron.exec(referencia);
    if (!coincidencia) continue;

    const coordenadas = coordenadaValida(Number(coincidencia[1]), Number(coincidencia[2]));
    if (coordenadas) return coordenadas;
  }

  return null;
}

/**
 * Coordenadas del local: primero las columnas (si existieran) y luego las que se
 * puedan leer de `ubicacion_ref`. `null` cuando no hay ninguna: la ficha cae al
 * centroide regional y, si tampoco hay región, no dibuja un punto inventado.
 */
export function coordenadasDeLocal(
  local: Pick<LocalDirectorio, 'latitud' | 'longitud' | 'ubicacionRef'>,
): Coordenadas | null {
  return (
    coordenadaValida(local.latitud, local.longitud) ?? coordenadasEnUbicacion(local.ubicacionRef)
  );
}

/**
 * Enlace para abrir el local en Google Maps.
 *
 * `ubicacion_ref` trae a veces una URL de Google Maps y a veces una referencia
 * textual (o `null`). Sólo se considera URL si empieza por http(s), en cuyo caso
 * se devuelve tal cual; si no, se busca por la dirección del local. Devuelve
 * `null` cuando no hay ni URL ni dirección: la ficha entonces no ofrece botón.
 */
export function enlaceMapaLocal(
  local: Pick<LocalDirectorio, 'ubicacionRef' | 'direccion'>,
): string | null {
  const referencia = local.ubicacionRef?.trim() ?? '';
  if (/^https?:\/\//i.test(referencia)) return referencia;

  const direccion = local.direccion?.trim() ?? '';
  if (!direccion) return null;

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

/** Registro de `GET /api/v1/locales` → dominio del directorio. */
export function aLocalDirectorio(bruto: unknown): LocalDirectorio {
  const registro: Registro = esRegistro(bruto) ? bruto : {};

  const id = texto(registro, ['id']) ?? '';
  const contactoNombre = texto(registro, ['contactoNombre', 'contacto_nombre']);
  const contactoCelular = texto(registro, ['contactoCelular', 'contacto_celular']);
  const contactoEmail = texto(registro, ['contactoEmail', 'contacto_email']);

  const relacionados = lista(registro, CLAVES_RESPONSABLES).map(aResponsableLocal).filter(conDatos);

  // Sin tabla relacionada en la respuesta, el contacto heredado se presenta
  // como único responsable: la vista lee siempre de una sola fuente.
  const heredado: ResponsableLocal = {
    id: `${id}-contacto`,
    nombre: contactoNombre,
    correo: contactoEmail,
    telefono: contactoCelular,
  };
  const responsables =
    relacionados.length > 0 ? relacionados : conDatos(heredado) ? [heredado] : [];
  const principal = responsables[0];

  return {
    id,
    codigo: texto(registro, ['codigo']) ?? '',
    nombre: texto(registro, ['nombre']) ?? 'Sin nombre',
    distritoId: numero(registro, ['distritoId', 'distrito_id']),
    distrito: texto(registro, ['distrito']),
    provincia: texto(registro, ['provincia']),
    region: texto(registro, ['region']),
    direccion: texto(registro, ['direccion']),
    ubicacionRef: texto(registro, ['ubicacionRef', 'ubicacion_ref']),
    latitud: numero(registro, ['latitud', 'lat', 'latitude']),
    longitud: numero(registro, ['longitud', 'lng', 'lon', 'longitude']),
    aforo: numero(registro, ['aforo']),
    ingresos: texto(registro, ['ingresos']),
    tieneProyector: booleanoOpcional(registro, ['tieneProyector', 'tiene_proyector']),
    tieneEquiposComputo: booleanoOpcional(registro, [
      'tieneEquiposComputo',
      'tiene_equipos_computo',
    ]),
    tieneAudioMicro: booleanoOpcional(registro, ['tieneAudioMicro', 'tiene_audio_micro']),
    responsables,
    responsable:
      texto(registro, ['responsable', 'responsableNombre', 'responsable_nombre']) ??
      principal?.nombre ??
      contactoNombre,
    correo: texto(registro, ['correo']) ?? principal?.correo ?? contactoEmail,
    telefono: texto(registro, ['telefono', 'teléfono']) ?? principal?.telefono ?? contactoCelular,
    contactoNombre,
    contactoCelular,
    contactoEmail,
    recomendacion: texto(registro, ['recomendacion']),
    fotoUrl: texto(registro, ['fotoUrl', 'foto_url']),
    disponible: booleano(registro, ['disponible', 'activo']),
  };
}
