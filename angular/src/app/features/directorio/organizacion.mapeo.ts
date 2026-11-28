/**
 * Directorio · Organizaciones: contrato de `GET /api/v1/organizaciones`.
 *
 * La organización hereda identidad y estado del actor colectivo
 * (`core.actores`): de ahí vienen `nombre`, `codigo` y `activo`. Los datos
 * propios viven en `core.organizaciones` y el tipo en
 * `core.cat_tipos_organizacion`.
 *
 * No hay campo de distrito: `core.organizaciones` no tiene `distrito_id`, y
 * esta capa no lo inventa. La región no está en `core.organizaciones` sino en
 * el actor colectivo (`core.actores.region_id`) y `GET /v1/organizaciones` no
 * la proyecta: se rellena desde el detalle del actor en la página.
 */

import { booleano, esRegistro, numero, texto, type Registro } from '../../dominio/mapeo';
import { aActorDirectorio, type ActorDirectorio } from './directorio.mapeo';

/**
 * `core.cat_tipos_organizacion.nombre` completo (7 filas verificadas en la
 * base). No existe un endpoint de catálogo para este vocabulario, así que la
 * lista se congela aquí; el filtro de la API acepta indistintamente el nombre
 * o el `codigo_legado`.
 */
export const TIPOS_ORGANIZACION = [
  'ASOCIACIÓN',
  'ASOCIACIÓN DE ASOCIACIONES',
  'SINDICATO',
  'COOPERATIVA',
  'GREMIO (no formalizado)',
  'COMITÉ',
  'FEDERACIÓN',
] as const;

export type OrganizacionDirectorio = {
  id: string;
  /** `core.actores.codigo_legado` (`ORG-001`). */
  codigo: string | null;
  nombre: string;
  abreviatura: string | null;
  tipo: string | null;
  tipoId: number | null;
  ruc: string | null;
  razonSocial: string | null;
  numeroIntegrantes: number | null;
  /**
   * Región del actor colectivo (`core.actores.region_id`). El listado no la
   * proyecta hoy; la página la completa desde `GET /v1/actors/{uid}` o, en su
   * defecto, la deriva de la región de sus integrantes.
   */
  region: string | null;
  /** Fechas ISO `YYYY-MM-DD`; el formato de pantalla lo pone la página. */
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  estadoOspa: string | null;
  expedienteOspa: string | null;
  nEmbarcaciones: number | null;
  nArmadores: number | null;
  perfil: string | null;
  direccion: string | null;
  fechaConstitucion: string | null;
  inscripcionSunarp: string | null;
  fuenteSync: string | null;
  ultimaSync: string | null;
  fotoUrl: string | null;
  facebookUrl: string | null;
  representante: string | null;
  activo: boolean;
};

/** Registro de `GET /api/v1/organizaciones` → dominio del directorio. */
export function aOrganizacionDirectorio(bruto: unknown): OrganizacionDirectorio {
  const registro: Registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']),
    nombre: texto(registro, ['nombre']) ?? 'Sin nombre',
    abreviatura: texto(registro, ['abreviatura']),
    tipo: texto(registro, ['tipo']),
    tipoId: numero(registro, ['tipoId', 'tipo_id']),
    ruc: texto(registro, ['ruc']),
    razonSocial: texto(registro, ['razonSocial', 'razon_social']),
    numeroIntegrantes: numero(registro, ['numeroIntegrantes', 'numero_integrantes']),
    region: texto(registro, ['region']),
    vigenciaDesde: texto(registro, ['vigenciaDesde', 'vigencia_desde']),
    vigenciaHasta: texto(registro, ['vigenciaHasta', 'vigencia_hasta']),
    estadoOspa: texto(registro, ['estadoOspa', 'estado_ospa']),
    expedienteOspa: texto(registro, ['expedienteOspa', 'expediente_ospa']),
    nEmbarcaciones: numero(registro, ['nEmbarcaciones', 'n_embarcaciones']),
    nArmadores: numero(registro, ['nArmadores', 'n_armadores']),
    perfil: texto(registro, ['perfil']),
    direccion: texto(registro, ['direccion']),
    fechaConstitucion: texto(registro, ['fechaConstitucion', 'fecha_constitucion']),
    inscripcionSunarp: texto(registro, ['inscripcionSunarp', 'inscripcion_sunarp']),
    fuenteSync: texto(registro, ['fuenteSync', 'fuente_sync']),
    ultimaSync: texto(registro, ['ultimaSync', 'ultima_sync']),
    fotoUrl: texto(registro, ['fotoUrl', 'foto_url']),
    facebookUrl: texto(registro, ['facebookUrl', 'facebook_url']),
    representante: texto(registro, ['representante']),
    activo: booleano(registro, ['activo']),
  };
}

/**
 * Respuesta de actor de la API → dominio del directorio.
 *
 * `GET /v1/actors/{uid}` envuelve el actor (`{ actor, casos, organizacion, … }`)
 * mientras que las respuestas de escritura (PATCH y baja lógica) lo devuelven
 * plano. Desenvolver aquí evita pasar el sobre a `aActorDirectorio`, que
 * produciría un actor vacío (`id: ''`, nombre «Sin nombre»).
 */
export function aActorDesdeApi(bruto: unknown): ActorDirectorio {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const actor = registro['actor'];
  return aActorDirectorio(esRegistro(actor) ? actor : registro);
}
