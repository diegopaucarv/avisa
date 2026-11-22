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
  numero,
  texto,
  type Registro,
} from '../../dominio/mapeo';

export type LocalDirectorio = {
  id: string;
  codigo: string;
  nombre: string;
  distritoId: number | null;
  /** Nombre del distrito resuelto por la clave ajena; `null` si no tiene. */
  distrito: string | null;
  direccion: string | null;
  ubicacionRef: string | null;
  aforo: number | null;
  ingresos: string | null;
  tieneProyector: boolean | null;
  tieneEquiposComputo: boolean | null;
  tieneAudioMicro: boolean | null;
  contactoNombre: string | null;
  contactoCelular: string | null;
  contactoEmail: string | null;
  recomendacion: string | null;
  fotoUrl: string | null;
  activo: boolean;
};

/** Igual que `booleano`, pero distingue «no» de «no registrado» (`null`). */
function booleanoOpcional(objeto: Registro, claves: readonly string[]): boolean | null {
  const valor = leer(objeto, claves);
  return typeof valor === 'boolean' ? valor : null;
}

/** Registro de `GET /api/v1/locales` → dominio del directorio. */
export function aLocalDirectorio(bruto: unknown): LocalDirectorio {
  const registro: Registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']) ?? '',
    nombre: texto(registro, ['nombre']) ?? 'Sin nombre',
    distritoId: numero(registro, ['distritoId', 'distrito_id']),
    distrito: texto(registro, ['distrito']),
    direccion: texto(registro, ['direccion']),
    ubicacionRef: texto(registro, ['ubicacionRef', 'ubicacion_ref']),
    aforo: numero(registro, ['aforo']),
    ingresos: texto(registro, ['ingresos']),
    tieneProyector: booleanoOpcional(registro, ['tieneProyector', 'tiene_proyector']),
    tieneEquiposComputo: booleanoOpcional(registro, [
      'tieneEquiposComputo',
      'tiene_equipos_computo',
    ]),
    tieneAudioMicro: booleanoOpcional(registro, ['tieneAudioMicro', 'tiene_audio_micro']),
    contactoNombre: texto(registro, ['contactoNombre', 'contacto_nombre']),
    contactoCelular: texto(registro, ['contactoCelular', 'contacto_celular']),
    contactoEmail: texto(registro, ['contactoEmail', 'contacto_email']),
    recomendacion: texto(registro, ['recomendacion']),
    fotoUrl: texto(registro, ['fotoUrl', 'foto_url']),
    activo: booleano(registro, ['activo']),
  };
}
