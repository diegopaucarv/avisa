/**
 * Demandas sin caso: contrato de `GET /api/v1/demandas` y vocabulario cerrado.
 *
 * Las 3P son `problema`, `propuesta` y `pedido` (Guía §8.1.2.1) y no se
 * renombran. `estado` llega con guiones bajos ya reemplazados por espacios
 * (`En proceso`); la lectura normaliza acentos y separadores para no depender de
 * esa variante.
 */

import { normalizarColeccion, type Coleccion } from '../../core/http/coleccion';
import { booleano, esRegistro, numero, texto } from '../../dominio/mapeo';

export const ESTADOS_DEMANDA = ['Pendiente', 'En proceso', 'Atendida', 'Desestimada'] as const;

export type EstadoDemanda = (typeof ESTADOS_DEMANDA)[number];

export type Demanda = {
  id: string;
  descripcion: string | null;
  /** 3P: problema. */
  problema: string | null;
  /** 3P: propuesta. */
  propuesta: string | null;
  /** 3P: pedido. */
  pedido: string | null;
  estado: EstadoDemanda;
  motivo: string | null;
  casoId: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  alertaId: string | null;
  fechaRegistro: string | null;
  fechaVencimiento: string | null;
  tematica: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean;
  clasificacion: number;
  afectaMujeres: boolean;
  documentoOrigenId: string | null;
  /** ISO de la anulación lógica; `null` mientras la demanda está vigente. */
  anuladoEn: string | null;
  /** Motivo declarado al anular; sólo se puebla en la papelera. */
  motivoAnulacion: string | null;
  /** Usuario que anuló (id); sólo se puebla en la papelera. */
  anuladoPor: string | null;
  /** Nombre legible de quien anuló; `null` si no se puede resolver. */
  anuladoPorNombre: string | null;
  /** Lote de anulación al que pertenece la fila. */
  anulacionId: string | null;
};

export type ColeccionDemandas = Coleccion<Demanda> & {
  /** Demandas sin caso en toda la base, no sólo en la página pedida. */
  sinCasoTotal: number;
  vinculadasTotal: number;
};

export type ParteDemanda = {
  etiqueta: string;
  valor: string;
};

function normalizarClave(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function estadoDemandaDe(valor: string | null): EstadoDemanda {
  if (!valor) return 'Pendiente';
  const clave = normalizarClave(valor);
  return ESTADOS_DEMANDA.find((estado) => normalizarClave(estado) === clave) ?? 'Pendiente';
}

/** Registro de `items[]`: sólo los campos que el repositorio documenta. */
export function aDemanda(bruto: unknown): Demanda {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    descripcion: texto(registro, ['descripcion']),
    problema: texto(registro, ['problema']),
    propuesta: texto(registro, ['propuesta']),
    pedido: texto(registro, ['pedido']),
    estado: estadoDemandaDe(texto(registro, ['estado'])),
    motivo: texto(registro, ['motivo']),
    casoId: texto(registro, ['casoId', 'caso_id']),
    casoCodigo: texto(registro, ['casoCode', 'caso_code']),
    casoTitulo: texto(registro, ['casoTitulo', 'caso_titulo']),
    alertaId: texto(registro, ['alertaId', 'alerta_id']),
    fechaRegistro: texto(registro, ['fechaRegistro', 'fecha_registro']),
    fechaVencimiento: texto(registro, ['fechaVencimiento', 'fecha_vencimiento']),
    tematica: texto(registro, ['tematica']),
    origen: texto(registro, ['origen']),
    confianza: numero(registro, ['confianza']),
    validado: booleano(registro, ['validado']),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    afectaMujeres: booleano(registro, ['afectaMujeres', 'afecta_mujeres']),
    documentoOrigenId: texto(registro, ['documentoOrigenId', 'documento_origen_id']),
    anuladoEn: texto(registro, ['anuladoEn', 'anulado_en']),
    motivoAnulacion: texto(registro, ['motivoAnulacion', 'motivo_anulacion']),
    anuladoPor: texto(registro, ['anuladoPor', 'anulado_por']),
    anuladoPorNombre: texto(registro, ['anuladoPorNombre', 'anulado_por_nombre']),
    anulacionId: texto(registro, ['anulacionId', 'anulacion_id']),
  };
}

function leerTotal(valor: unknown, respaldo: number): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : respaldo;
}

/**
 * Sobre de `GET /api/v1/demandas`, que además de paginar informa
 * `sinCasoTotal` y `vinculadasTotal`. Si la clave faltara, `total` sirve de
 * respaldo porque el listado se pide con `sinCaso=true`.
 */
export function aColeccionDemandas(bruto: unknown): ColeccionDemandas {
  const base = normalizarColeccion<unknown>(bruto);
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    ...base,
    elementos: base.elementos.map(aDemanda),
    sinCasoTotal: leerTotal(registro['sinCasoTotal'], base.total),
    vinculadasTotal: leerTotal(registro['vinculadasTotal'], 0),
  };
}

/** Las 3P presentes, en el orden problema → propuesta → pedido. */
export function partesDemanda(demanda: Demanda): ParteDemanda[] {
  const partes: ParteDemanda[] = [];
  if (demanda.problema) partes.push({ etiqueta: 'Problema', valor: demanda.problema });
  if (demanda.propuesta) partes.push({ etiqueta: 'Propuesta', valor: demanda.propuesta });
  if (demanda.pedido) partes.push({ etiqueta: 'Pedido', valor: demanda.pedido });
  return partes;
}

/** Clases de estado de `global.css` (`state-*`), para el badge. */
export function claseEstadoDemanda(estado: EstadoDemanda): string {
  switch (estado) {
    case 'Atendida':
      return 'state-approved';
    case 'Desestimada':
      return 'state-dismissed';
    default:
      return 'state-pending';
  }
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`, sin depender del locale. */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';

  const partes = valor.slice(0, 10).split('-');
  if (partes.length !== 3) return valor;

  const [anio, mes, dia] = partes;
  if (!anio || !mes || !dia) return valor;

  return `${dia}/${mes}/${anio}`;
}
