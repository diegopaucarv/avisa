/**
 * Bandeja de trabajo: cola única y ordenada.
 *
 * El servidor entrega tres listados paginados distintos (alertas pendientes,
 * compromisos vencidos o por vencer y demandas sin caso). Aquí se traducen a un
 * único tipo `ItemCola` para que la pantalla ordene, filtre y pinte una sola
 * tabla sin conocer los tres contratos.
 *
 * Nada se estima: si un registro no declara fecha, queda como «Sin fecha»; si
 * no declara riesgo, queda como «—».
 */

import { formatearFecha } from '../../shared/formato-fecha';
import type { Alerta, PrioridadAlerta } from '../alertas/alerta.mapeo';
import { resolverVencimiento, type Compromiso } from '../compromisos/compromiso.mapeo';
import type { Demanda } from '../casos/demanda-sin-caso.mapeo';

export type TipoItemCola = 'alerta' | 'compromiso' | 'demanda';

/**
 * Filtro visible de la cola, con los valores que viajan en `?tipo=`.
 * `todos` no recorta nada; el plural (`alertas`) no es el tipo de la fila (`alerta`).
 */
export type FiltroTipoCola = 'todos' | 'alertas' | 'compromisos' | 'demandas';

export type ItemCola = {
  tipo: TipoItemCola;
  /** Identificador de la fila origen; con `tipo` sirve de `track` estable. */
  id: string;
  codigo: string;
  titulo: string;
  /** Código del caso vinculado; `null` si no tiene o es una demanda sin caso. */
  caso: string | null;
  /** Distrito/alcance declarado; `null` si el registro no lo trae. */
  territorio: string | null;
  /** Fecha de vencimiento o plazo en `YYYY-MM-DD`; `null` si no hay dato. */
  fecha: string | null;
  /** Etiqueta del plazo para la tabla: `02NOV2025` o «Sin fecha». */
  plazo: string;
  /** Riesgo o prioridad declarados; «—» si el registro no los trae. */
  riesgo: string;
  /** Peso del riesgo/prioridad para el desempate; `0` si no hay dato. */
  pesoRiesgo: number;
  revisionPendiente: boolean;
  /** Pantalla completa que atiende el registro. */
  ruta: string;
};

export type EntradaCola = {
  alertas: readonly Alerta[];
  compromisos: readonly Compromiso[];
  demandas: readonly Demanda[];
};

export const OPCIONES_TIPO: readonly { valor: FiltroTipoCola; etiqueta: string }[] = [
  { valor: 'todos', etiqueta: 'Todas' },
  { valor: 'alertas', etiqueta: 'Alertas' },
  { valor: 'compromisos', etiqueta: 'Compromisos' },
  { valor: 'demandas', etiqueta: 'Demandas' },
];

const PESO_PRIORIDAD: Record<PrioridadAlerta, number> = {
  'Crítica inmediata': 4,
  Urgente: 3,
  Temprana: 2,
  Seguimiento: 1,
};

/** Orden fijo entre tipos para que el desempate final sea reproducible. */
const ORDEN_TIPO: Record<TipoItemCola, number> = {
  alerta: 0,
  compromiso: 1,
  demanda: 2,
};

const DIA_MS = 86_400_000;

/**
 * Normaliza una fecha a `YYYY-MM-DD`. Acepta el ISO del backend (con hora) y el
 * formato legado `DD/MM/YYYY`; cualquier otra forma se declara sin fecha.
 */
function normalizarFechaIso(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const texto = valor.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto);
  if (barras) {
    return `${barras[3]}-${barras[2].padStart(2, '0')}-${barras[1].padStart(2, '0')}`;
  }

  return null;
}

/** Suma días de calendario a una fecha `YYYY-MM-DD` (aritmética en UTC). */
function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const destino = new Date(Date.UTC(anio, mes - 1, dia + dias));
  const resultadoAnio = destino.getUTCFullYear();
  const resultadoMes = String(destino.getUTCMonth() + 1).padStart(2, '0');
  const resultadoDia = String(destino.getUTCDate()).padStart(2, '0');
  return `${resultadoAnio}-${resultadoMes}-${resultadoDia}`;
}

/**
 * Plazo efectivo de una alerta: fecha de reporte + `slaHoras`. El SLA se
 * declara en horas y la cola compara por día, así que se redondea hacia arriba.
 * Si falta la fecha o el SLA, no se inventa un plazo.
 */
function fechaLimiteAlerta(alerta: Alerta): string | null {
  const base = normalizarFechaIso(alerta.fechaReporte);
  if (!base || alerta.plazoHoras === null) return null;
  const dias = Math.max(0, Math.ceil(alerta.plazoHoras / 24));
  return sumarDias(base, dias);
}

/** Días de calendario entre hoy y `fecha`; negativo si ya venció. */
function diasHasta(fecha: string, hoy: Date): number | null {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  if (![anio, mes, dia].every(Number.isFinite)) return null;

  const destino = Date.UTC(anio, mes - 1, dia);
  const base = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((destino - base) / DIA_MS);
}

function pesoPrioridad(prioridad: PrioridadAlerta | null): number {
  return prioridad ? PESO_PRIORIDAD[prioridad] : 0;
}

/** Alerta → fila de cola. La consulta sólo trae `Pendiente de revisión`. */
export function itemDeAlerta(alerta: Alerta): ItemCola {
  const fecha = fechaLimiteAlerta(alerta);

  return {
    tipo: 'alerta',
    id: alerta.id || alerta.codigo,
    codigo: alerta.codigo || 'Sin código',
    titulo: alerta.titulo ?? 'Sin título',
    caso: alerta.casoCodigo,
    territorio: alerta.distritoRuta ?? alerta.distrito,
    fecha,
    plazo: fecha ? formatearFecha(fecha) : 'Sin fecha',
    riesgo: alerta.prioridad ?? '—',
    pesoRiesgo: pesoPrioridad(alerta.prioridad),
    revisionPendiente: true,
    ruta: '/alertas',
  };
}

/**
 * Compromiso → fila de cola. La fecha sale de la regla compartida (manual y,
 * si falta, próximo hito no terminal). El alcance declarado es la única
 * referencia territorial del compromiso.
 */
export function itemDeCompromiso(compromiso: Compromiso): ItemCola {
  const fecha = normalizarFechaIso(resolverVencimiento(compromiso).fecha);

  return {
    tipo: 'compromiso',
    id: compromiso.id || compromiso.codigo,
    codigo: compromiso.codigo || 'Sin código',
    titulo: compromiso.accion || 'Sin acción registrada',
    caso: compromiso.casoCodigo,
    territorio: compromiso.alcance,
    fecha,
    plazo: fecha ? formatearFecha(fecha) : 'Sin fecha',
    riesgo: '—',
    pesoRiesgo: 0,
    revisionPendiente: false,
    ruta: '/compromisos',
  };
}

/**
 * Demanda sin caso → fila de cola. No tiene código legible ni caso; si declara
 * `fechaVencimiento` se usa como plazo y, si no, se muestra «Sin fecha».
 */
export function itemDeDemanda(demanda: Demanda): ItemCola {
  const fecha = normalizarFechaIso(demanda.fechaVencimiento);

  return {
    tipo: 'demanda',
    id: demanda.id,
    codigo: 'Sin código',
    titulo: demanda.descripcion ?? demanda.pedido ?? demanda.problema ?? 'Sin descripción',
    caso: demanda.casoCodigo,
    territorio: null,
    fecha,
    plazo: fecha ? formatearFecha(fecha) : 'Sin fecha',
    riesgo: '—',
    pesoRiesgo: 0,
    revisionPendiente: false,
    ruta: '/casos/sin-caso',
  };
}

/**
 * Regla de orden, de mayor a menor urgencia:
 * 1. Primero lo vencido (fecha anterior a hoy).
 * 2. Luego, por vencimiento/plazo ascendente.
 * 3. Al final, lo que no tiene fecha («Sin fecha»).
 * 4. En empate, por riesgo/prioridad (mayor primero).
 * 5. Después, por revisión pendiente (sí primero).
 * 6. Desempate final estable: tipo y código.
 *
 * Las fechas se comparan como `YYYY-MM-DD`, que ordena lexicográficamente.
 */
function compararItems(a: ItemCola, b: ItemCola, hoy: Date): number {
  const diasA = a.fecha ? diasHasta(a.fecha, hoy) : null;
  const diasB = b.fecha ? diasHasta(b.fecha, hoy) : null;
  const vencidaA = diasA !== null && diasA < 0;
  const vencidaB = diasB !== null && diasB < 0;

  if (vencidaA !== vencidaB) return vencidaA ? -1 : 1;

  if (a.fecha && b.fecha) {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  } else if (a.fecha) {
    return -1;
  } else if (b.fecha) {
    return 1;
  }

  if (a.pesoRiesgo !== b.pesoRiesgo) return b.pesoRiesgo - a.pesoRiesgo;
  if (a.revisionPendiente !== b.revisionPendiente) return a.revisionPendiente ? -1 : 1;
  if (a.tipo !== b.tipo) return ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo];
  return a.codigo.localeCompare(b.codigo);
}

/** Ordena una copia de la cola con la regla documentada. */
export function ordenarCola(items: readonly ItemCola[], hoy: Date = new Date()): ItemCola[] {
  return [...items].sort((a, b) => compararItems(a, b, hoy));
}

/** Une las tres fuentes y ordena el resultado. */
export function construirCola(entrada: EntradaCola, hoy: Date = new Date()): ItemCola[] {
  return ordenarCola(
    [
      ...entrada.alertas.map(itemDeAlerta),
      ...entrada.compromisos.map(itemDeCompromiso),
      ...entrada.demandas.map(itemDeDemanda),
    ],
    hoy,
  );
}

/** Aplica el filtro de tipo; `todos` devuelve una copia sin recortar. */
export function filtrarColaPorTipo(items: readonly ItemCola[], filtro: FiltroTipoCola): ItemCola[] {
  if (filtro === 'todos') return [...items];

  const tipo: TipoItemCola =
    filtro === 'alertas' ? 'alerta' : filtro === 'compromisos' ? 'compromiso' : 'demanda';
  return items.filter((item) => item.tipo === tipo);
}

/** Valida el valor de `?tipo=`; cualquier variante desconocida cae en `todos`. */
export function normalizarFiltroTipo(valor: string | null | undefined): FiltroTipoCola {
  switch (valor) {
    case 'alertas':
    case 'compromisos':
    case 'demandas':
    case 'todos':
      return valor;
    default:
      return 'todos';
  }
}

/** Clases de `global.css` (`due-*`) para la etiqueta de plazo. */
export function claseVencimiento(item: ItemCola, hoy: Date = new Date()): string {
  if (!item.fecha) return 'due-sin-fecha';

  const dias = diasHasta(item.fecha, hoy);
  if (dias === null) return 'due-sin-fecha';
  if (dias < 0) return 'due-vencido';
  if (dias <= 30) return 'due-por-vencer';
  return 'due-en-plazo';
}
