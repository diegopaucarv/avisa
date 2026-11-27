/**
 * Mesas · indicadores: contrato de `GET /api/v1/mesas/indicadores`.
 *
 * El endpoint devuelve un sobre ya agregado (no filas) para las dos pestañas de
 * SEGUIMIENTO: `/mesas` y `/mesas/compromisos`. Aquí se hace el mapeo tolerante
 * (camelCase o snake_case, sobre envuelto en `data` o directo, números enviados
 * como texto) y el cálculo del ancho de barra, de modo que la plantilla no
 * conozca variantes ni haga aritmética.
 *
 * Mientras la migración 81 no vincule `core.mesas_dialogo.caso_id` con la base
 * de casos, el backend manda `vinculoDisponible: false` y los contadores de
 * compromisos e hitos en 0 con sus arrays vacíos. Este lector no inventa cifras:
 * refleja ese sobre tal cual.
 */

import { booleano, esRegistro, leer, lista, numero, texto, type Registro } from '../../dominio/mapeo';

/** Conteo genérico `clave → total` (vigencia, naturaleza, estado, departamento…). */
export type ConteoClave = { clave: string; total: number };

/** Compromisos de una mesa: totales y cumplidos para el ranking por mesa. */
export type ConteoMesa = {
  codigo: string;
  titulo: string;
  total: number;
  cumplidos: number;
};

export type IndicadoresMesas = {
  /** `false` cuando la migración 81 no ha vinculado mesas con casos. */
  vinculoDisponible: boolean;
  totales: {
    mesas: number;
    miembros: number;
    compromisos: number;
    hitos: number;
  };
  vigencia: ConteoClave[];
  naturaleza: ConteoClave[];
  departamentos: ConteoClave[];
  compromisosEstado: ConteoClave[];
  compromisosPorMesa: ConteoMesa[];
  hitosEstado: ConteoClave[];
};

/** Sobre vacío: útil como valor inicial y en pruebas. */
export const VACIO: IndicadoresMesas = {
  vinculoDisponible: false,
  totales: { mesas: 0, miembros: 0, compromisos: 0, hitos: 0 },
  vigencia: [],
  naturaleza: [],
  departamentos: [],
  compromisosEstado: [],
  compromisosPorMesa: [],
  hitosEstado: [],
};

function entero(valor: number | null): number {
  return valor === null ? 0 : Math.trunc(valor);
}

/** Desenvuelve un `{ data: {...} }` si lo hubiera; si no, devuelve el objeto. */
function raiz(bruto: unknown): Registro {
  if (!esRegistro(bruto)) return {};
  const envuelto = leer(bruto, ['data']);
  return esRegistro(envuelto) ? envuelto : bruto;
}

function aConteoClave(bruto: unknown): ConteoClave | null {
  if (!esRegistro(bruto)) return null;
  const clave = texto(bruto, ['clave', 'key', 'estado', 'nombre', 'label']);
  if (!clave) return null;
  return {
    clave,
    total: entero(numero(bruto, ['total', 'cantidad', 'conteo', 'count'])),
  };
}

function conteos(contenedor: Registro, claves: readonly string[]): ConteoClave[] {
  return lista(contenedor, claves)
    .map(aConteoClave)
    .filter((fila): fila is ConteoClave => fila !== null);
}

function aConteoMesa(bruto: unknown): ConteoMesa {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    codigo: texto(registro, ['codigo', 'code']) ?? 'Sin código',
    titulo: texto(registro, ['titulo', 'title', 'accion', 'acción']) ?? '',
    total: entero(numero(registro, ['total', 'compromisos'])),
    cumplidos: entero(numero(registro, ['cumplidos', 'cumplidosTotal', 'cumplidos_total'])),
  };
}

/**
 * Mapea el sobre de la API al contrato de la pantalla. Tolera `null`, arreglos
 * sueltos y números enviados como texto; nunca inventa filas. Si `totales` no
 * viene como objeto, se leen las cifras del propio sobre raíz.
 */
export function leerIndicadores(bruto: unknown): IndicadoresMesas {
  const datos = raiz(bruto);
  const crudo = leer(datos, ['totales', 'totals', 'resumen']);
  const totales = esRegistro(crudo) ? crudo : datos;

  return {
    vinculoDisponible: booleano(datos, [
      'vinculoDisponible',
      'vinculo_disponible',
      'linkDisponible',
    ]),
    totales: {
      mesas: entero(numero(totales, ['mesas', 'totalMesas', 'total_mesas'])),
      miembros: entero(numero(totales, ['miembros', 'members'])),
      compromisos: entero(numero(totales, ['compromisos', 'commitments'])),
      hitos: entero(numero(totales, ['hitos', 'milestones'])),
    },
    vigencia: conteos(datos, ['vigencia', 'porVigencia', 'por_vigencia']),
    naturaleza: conteos(datos, ['naturaleza', 'porNaturaleza', 'por_naturaleza']),
    departamentos: conteos(datos, ['departamentos', 'porDepartamento', 'por_departamento']),
    compromisosEstado: conteos(datos, [
      'compromisosEstado',
      'compromisos_estado',
      'porEstadoCompromiso',
      'por_estado_compromiso',
    ]),
    compromisosPorMesa: lista(datos, ['compromisosPorMesa', 'compromisos_por_mesa']).map(
      aConteoMesa,
    ),
    hitosEstado: conteos(datos, ['hitosEstado', 'hitos_estado', 'porEstadoHito', 'por_estado_hito']),
  };
}

/**
 * Porcentaje de `total` sobre `maximo`, listo para `style.width`.
 *
 * Un total de cero devuelve `0%` (no dibuja barra); un total positivo nunca
 * baja del 2% para que la fila se vea aunque su valor sea mínimo frente al
 * máximo. El resultado se limita a 100% y se redondea a un decimal.
 */
export function anchoBarra(total: number, maximo: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0%';

  const base = Number.isFinite(maximo) && maximo > 0 ? maximo : total;
  const porcentaje = Math.min(100, Math.max(2, (total / base) * 100));
  return `${Math.round(porcentaje * 10) / 10}%`;
}
