/**
 * Mesas de diálogo: contrato de la API y vocabulario de la vista.
 *
 * `GET /api/v1/mesas` y `/api/v1/mesas/{codigo}` devuelven camelCase. Aquí se
 * normaliza al vocabulario de la Guía para que las plantillas no conozcan
 * variantes ni valores crudos de `core.mesas_dialogo`.
 *
 * Las mesas **no** son compromisos: viven en `core.mesas_dialogo` (21 filas) con
 * sus integrantes en `core.mesa_miembros` (62 filas). La migración 81 las enlazó
 * con la base de casos mediante `core.mesas_dialogo.caso_id`: cada mesa tiene su
 * caso espejo `MD-AAAA-NNNN`. Contra una base sin ese enlace, `casoCodigo` llega
 * `null` y los contadores de compromisos en 0; la vista declara esa ausencia en
 * vez de simular cifras.
 */

import { formatearFechaCorta } from '../../shared/formato-fecha';
import { esRegistro, leer, lista, numero, texto, type Registro } from '../../dominio/mapeo';
import { estadoCompromisoDe, type EstadoCompromiso } from '../compromisos/compromiso.mapeo';

export type EstadoVigencia = 'Vigente' | 'Por vencer' | 'Vencido' | 'Permanente' | 'Sin fecha';

export const ESTADOS_VIGENCIA = [
  'Vigente',
  'Por vencer',
  'Vencido',
  'Permanente',
  'Sin fecha',
] as const satisfies readonly EstadoVigencia[];

export type NaturalezaMesa = 'Temporal' | 'Permanente' | 'No definida';

export const NATURALEZAS = [
  'Temporal',
  'Permanente',
  'No definida',
] as const satisfies readonly NaturalezaMesa[];

/** Fila del listado de mesas. Es `type` para ser asignable a `FilaTabla`. */
export type Mesa = {
  id: string;
  codigo: string;
  titulo: string;
  tipoInstrumento: string | null;
  naturaleza: NaturalezaMesa;
  estadoVigencia: EstadoVigencia;
  /** Ámbito para mostrar: «Nacional» si `esNacional`, si no el texto crudo. */
  ambito: string | null;
  /** Texto crudo de `ambito_departamento`, aun cuando se muestre «Nacional». */
  ambitoDetalle: string | null;
  /** Mesa de alcance nacional (más de tres regiones o ámbito declarado así). */
  esNacional: boolean;
  fechaInstalacion: string | null;
  fechaFinVigencia: string | null;
  miembros: number;
  compromisos: number;
  compromisosCumplidos: number;
  /** Código del caso espejo (`MD-AAAA-NNNN`); `null` si la mesa no está enlazada. */
  casoCodigo: string | null;
};

export type MesaResumen = {
  mesas: number;
  vigentes: number;
  porVencer: number;
  vencidas: number;
  miembros: number;
  compromisos: number;
};

export type MesaIntegrante = {
  id: string;
  rol: string;
  nombre: string;
  docDesignacion: string | null;
  desde: string | null;
  hasta: string | null;
};

export type HitoMesa = {
  codigo: string | null;
  descripcion: string | null;
  estado: string;
  fecha: string | null;
};

/** Compromiso visto desde la ficha de una mesa (`/v1/mesas/{codigo}`). */
export type CompromisoMesa = {
  id: string;
  codigo: string;
  titulo: string;
  estado: EstadoCompromiso;
  area: string | null;
  fechaLimite: string | null;
  mesaCodigo: string | null;
  mesaTitulo: string | null;
  hitosTotal: number;
  hitosCumplidos: number;
  proximoHito: HitoMesa | null;
  /** Sólo llega en el detalle de la mesa. */
  hitos: HitoMesa[];
};

/** Campos de `core.mesas_dialogo` que sólo se muestran en la ficha. */
export type MesaFicha = Mesa & {
  objetivo: string | null;
  baseLegal: string | null;
  fechaNorma: string | null;
  rolProduce: string | null;
  linkEvidencia: string | null;
  docDesignacion: string | null;
  origenDato: string | null;
};

export type CasoMesa = {
  codigo: string;
  estado: string;
  titulo: string | null;
};

export type MesaDetalle = {
  mesa: MesaFicha;
  caso: CasoMesa | null;
  integrantes: MesaIntegrante[];
  compromisos: CompromisoMesa[];
};

export function normalizarClave(valor: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function vigenciaDe(valor: string | null): EstadoVigencia {
  const clave = normalizarClave(valor);
  return ESTADOS_VIGENCIA.find((opcion) => normalizarClave(opcion) === clave) ?? 'Sin fecha';
}

export function naturalezaDe(valor: string | null): NaturalezaMesa {
  const clave = normalizarClave(valor);
  return NATURALEZAS.find((opcion) => normalizarClave(opcion) === clave) ?? 'No definida';
}

export function aMesa(bruto: unknown): Mesa {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo', 'code']) ?? 'Sin código',
    titulo: texto(registro, ['titulo', 'title']) ?? 'Mesa sin título',
    tipoInstrumento: texto(registro, ['tipoInstrumento', 'tipo_instrumento']),
    naturaleza: naturalezaDe(texto(registro, ['naturaleza'])),
    estadoVigencia: vigenciaDe(texto(registro, ['estadoVigencia', 'estado_vigencia'])),
    ambito: texto(registro, ['ambito', 'ambitoDepartamento', 'ambito_departamento']),
    ambitoDetalle: texto(registro, ['ambitoDetalle', 'ambito_detalle', 'ambito_departamento']),
    esNacional: registro['esNacional'] === true || registro['es_nacional'] === true,
    fechaInstalacion: texto(registro, ['fechaInstalacion', 'fecha_instalacion']),
    fechaFinVigencia: texto(registro, ['fechaFinVigencia', 'fecha_fin_vigencia']),
    miembros: numero(registro, ['miembros']) ?? 0,
    compromisos: numero(registro, ['compromisos']) ?? 0,
    compromisosCumplidos: numero(registro, ['compromisosCumplidos', 'compromisos_cumplidos']) ?? 0,
    casoCodigo: texto(registro, ['casoCodigo', 'caso_codigo']),
  };
}

/** `resumen` del listado: cifras globales para la franja de indicadores. */
export function leerResumen(bruto: unknown): MesaResumen | null {
  if (!esRegistro(bruto)) return null;
  const resumen = leer(bruto, ['resumen']);
  if (!esRegistro(resumen)) return null;

  return {
    mesas: numero(resumen, ['mesas']) ?? 0,
    vigentes: numero(resumen, ['vigentes']) ?? 0,
    porVencer: numero(resumen, ['porVencer', 'por_vencer']) ?? 0,
    vencidas: numero(resumen, ['vencidas']) ?? 0,
    miembros: numero(resumen, ['miembros']) ?? 0,
    compromisos: numero(resumen, ['compromisos']) ?? 0,
  };
}

function aIntegrante(bruto: unknown): MesaIntegrante {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    rol: texto(registro, ['rol']) ?? 'Sin rol',
    nombre: texto(registro, ['nombre', 'nombreTexto', 'nombre_texto']) ?? 'Sin nombre',
    docDesignacion: texto(registro, ['docDesignacion', 'doc_designacion']),
    desde: texto(registro, ['desde', 'validFrom', 'valid_from']),
    hasta: texto(registro, ['hasta', 'validTo', 'valid_to']),
  };
}

export function aHito(bruto: unknown): HitoMesa {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  return {
    codigo: texto(registro, ['codigo', 'code']),
    descripcion: texto(registro, ['descripcion', 'descripción']),
    estado: texto(registro, ['estado']) ?? 'Registrado',
    fecha: texto(registro, ['fecha']),
  };
}

export function aCompromisoMesa(bruto: unknown): CompromisoMesa {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const hitos = lista(registro, ['hitos']).map(aHito);
  const proximo = leer(registro, ['proximoHito', 'proximo_hito']);

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo', 'code']) ?? 'Sin código',
    titulo: texto(registro, ['titulo', 'accion', 'acción']) ?? 'Sin descripción',
    estado: estadoCompromisoDe(texto(registro, ['estado'])),
    area: texto(registro, ['area', 'unidad']),
    fechaLimite: texto(registro, ['fechaLimite', 'fecha_limite', 'fechaVencimiento']),
    mesaCodigo: texto(registro, ['mesaCodigo', 'mesa_codigo']),
    mesaTitulo: texto(registro, ['mesaTitulo', 'mesa_titulo']),
    hitosTotal: numero(registro, ['hitosTotal', 'hitos_total']) ?? hitos.length,
    hitosCumplidos:
      numero(registro, ['hitosCumplidos', 'hitos_cumplidos']) ??
      hitos.filter(esHitoCumplido).length,
    proximoHito: esRegistro(proximo) ? aHito(proximo) : null,
    hitos,
  };
}

export function aMesaDetalle(bruto: unknown): MesaDetalle | null {
  if (!esRegistro(bruto)) return null;
  const mesa = leer(bruto, ['mesa']);
  if (!esRegistro(mesa)) return null;

  const base = aMesa(mesa);
  const caso = leer(bruto, ['caso']);

  return {
    mesa: {
      ...base,
      objetivo: texto(mesa, ['objetivo']),
      baseLegal: texto(mesa, ['baseLegal', 'base_legal']),
      fechaNorma: texto(mesa, ['fechaNorma', 'fecha_norma']),
      rolProduce: texto(mesa, ['rolProduce', 'rol_produce']),
      linkEvidencia: texto(mesa, ['linkEvidencia', 'link_evidencia']),
      docDesignacion: texto(mesa, ['docDesignacion', 'doc_designacion']),
      origenDato: texto(mesa, ['origenDato', 'origen_dato']),
    },
    caso: esRegistro(caso)
      ? {
          codigo: texto(caso, ['codigo']) ?? '',
          estado: texto(caso, ['estado']) ?? 'Abierto',
          titulo: texto(caso, ['titulo']),
        }
      : null,
    integrantes: lista(bruto, ['integrantes']).map(aIntegrante),
    compromisos: lista(bruto, ['compromisos']).map(aCompromisoMesa),
  };
}

/** Fecha de la vista: `27NOV2026`; `—` cuando no hay dato. */
export function fechaTexto(valor: string | null | undefined): string {
  return valor && valor.trim() ? formatearFechaCorta(valor) : '—';
}

/**
 * Modificador de `.commit-status` para la vigencia.
 *
 * Reutiliza los tonos de compromisos: verde para vigente, ámbar para por vencer,
 * rojo para vencido. `Permanente` y `Sin fecha` no tienen urgencia y se pintan
 * con el tono azul de «en curso»; el texto del chip sigue siendo el estado real.
 */
export function claseVigencia(estado: EstadoVigencia | string): string {
  switch (vigenciaDe(String(estado))) {
    case 'Vigente':
      return 'commit-cumplido';
    case 'Por vencer':
      return 'commit-por-vencer';
    case 'Vencido':
      return 'commit-vencido';
    default:
      return 'commit-en-curso';
  }
}

export function esHitoCumplido(hito: Pick<HitoMesa, 'estado'>): boolean {
  return normalizarClave(hito.estado) === 'cumplido';
}

/** Modificador de `.commit-status` para el estado de un hito. */
export function claseEstadoHito(estado: string): string {
  switch (normalizarClave(estado)) {
    case 'cumplido':
      return 'commit-cumplido';
    case 'en ejecucion':
      return 'commit-en-curso';
    case 'paralizado':
      return 'commit-paralizado';
    case 'no cumplido':
    case 'desestimado':
      return 'commit-vencido';
    default:
      return '';
  }
}

/** `2/5` con los hitos cumplidos, o `—` si el compromiso aún no tiene hitos. */
export function avanceHitos(hitos: readonly HitoMesa[] | undefined): string {
  if (!hitos || hitos.length === 0) return '—';
  const cumplidos = hitos.filter(esHitoCumplido).length;
  return `${cumplidos}/${hitos.length}`;
}

/**
 * Próximo hito por fecha entre los no terminales. Es el mismo criterio que usa
 * `lib/db/repos/commitments.ts`: ni cumplido ni desestimado cuentan.
 */
export function proximoHito(hitos: readonly HitoMesa[] | undefined): HitoMesa | null {
  if (!hitos) return null;
  const pendientes = hitos
    .filter((hito) => {
      const clave = normalizarClave(hito.estado);
      return clave !== 'cumplido' && clave !== 'desestimado' && hito.fecha;
    })
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''));
  return pendientes[0] ?? null;
}

/** Texto de la celda «Compromisos» del listado de mesas. */
export function avanceCompromisos(
  mesa: Pick<Mesa, 'compromisos' | 'compromisosCumplidos'>,
): string {
  if (mesa.compromisos === 0) return 'Sin compromisos';
  if (mesa.compromisosCumplidos >= mesa.compromisos) return `${mesa.compromisos} cumplidos`;
  return `${mesa.compromisosCumplidos}/${mesa.compromisos}`;
}
