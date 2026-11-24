/**
 * Contrato de la capa de resultados de reunión (`/api/v1/resultados/**`).
 *
 * Igual que el resto de la SPA, la normalización es defensiva: la API puede
 * cambiar de grafía (`items`/`elementos`) y esta capa siempre expone lo mismo.
 * No se inventan valores: lo que falta queda `null` o vacío.
 */

export type ReunionResumen = {
  id: string;
  codigo: string | null;
  titulo: string | null;
  /** `YYYY-MM-DD` (horario de Lima). */
  fecha: string;
  lugar: string | null;
  casoCodigo: string | null;
  casoNombre: string | null;
  asistentes: number;
};

export type ActorOpcion = {
  id: string;
  nombre: string;
  tipo: string | null;
  institucion: string | null;
};

export type AsistentePropuesto = {
  nombre: string;
  cargo: string | null;
};

export type Extraccion = {
  disponible: boolean;
  motor: string | null;
  asistentes: AsistentePropuesto[];
  nota: string | null;
};

export type EstadoAsistente = 'vinculado' | 'omitido' | 'error';

export type ResultadoAsistente = {
  nombre: string;
  actorId: string | null;
  estado: EstadoAsistente;
  motivo: string | null;
};

export type Vinculacion = {
  reunionId: string;
  items: ResultadoAsistente[];
  resumen: {
    total: number;
    vinculados: number;
    omitidos: number;
    errores: number;
  };
};

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

function numero(valor: unknown): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function listaDe(bruto: unknown, claves: string[]): unknown[] {
  if (Array.isArray(bruto)) return bruto;
  if (!esRegistro(bruto)) return [];
  for (const clave of claves) {
    const valor = bruto[clave];
    if (Array.isArray(valor)) return valor;
  }
  return [];
}

export function aReunionResumen(bruto: unknown): ReunionResumen | null {
  if (!esRegistro(bruto)) return null;
  const id = texto(bruto['id']);
  if (!id) return null;
  return {
    id,
    codigo: texto(bruto['codigo']),
    titulo: texto(bruto['titulo']),
    fecha: texto(bruto['fecha']) ?? '',
    lugar: texto(bruto['lugar']),
    casoCodigo: texto(bruto['casoCodigo']),
    casoNombre: texto(bruto['casoNombre']),
    asistentes: numero(bruto['asistentes']),
  };
}

export function aReuniones(bruto: unknown): ReunionResumen[] {
  return listaDe(bruto, ['items', 'elementos', 'data'])
    .map(aReunionResumen)
    .filter((reunion): reunion is ReunionResumen => reunion !== null);
}

export function aActorOpcion(bruto: unknown): ActorOpcion | null {
  if (!esRegistro(bruto)) return null;
  const id = texto(bruto['id']);
  const nombre = texto(bruto['nombre']);
  if (!id || !nombre) return null;
  return {
    id,
    nombre,
    tipo: texto(bruto['tipo']),
    institucion: texto(bruto['organizacionAncla']) ?? texto(bruto['distrito']),
  };
}

export function aActores(bruto: unknown): ActorOpcion[] {
  return listaDe(bruto, ['items', 'elementos', 'data'])
    .map(aActorOpcion)
    .filter((actor): actor is ActorOpcion => actor !== null);
}

/** `POST /v1/actors` devuelve el actor creado; sólo se necesitan `id` y `nombre`. */
export function aActorCreado(bruto: unknown): ActorOpcion | null {
  return aActorOpcion(bruto);
}

export function aExtraccion(bruto: unknown): Extraccion {
  const registro = esRegistro(bruto) ? bruto : {};
  const asistentes = listaDe(registro, ['asistentes'])
    .map((fila): AsistentePropuesto | null => {
      if (!esRegistro(fila)) return null;
      const nombre = texto(fila['nombre']);
      if (!nombre) return null;
      return { nombre, cargo: texto(fila['cargo']) };
    })
    .filter((fila): fila is AsistentePropuesto => fila !== null);

  return {
    disponible: registro['disponible'] === true,
    motor: texto(registro['motor']),
    asistentes,
    nota: texto(registro['nota']),
  };
}

function aResultadoAsistente(bruto: unknown): ResultadoAsistente | null {
  if (!esRegistro(bruto)) return null;
  const estadoBruto = texto(bruto['estado']);
  const estado: EstadoAsistente =
    estadoBruto === 'vinculado' || estadoBruto === 'omitido' || estadoBruto === 'error'
      ? estadoBruto
      : 'error';
  return {
    nombre: texto(bruto['nombre']) ?? '(sin nombre)',
    actorId: texto(bruto['actorId']),
    estado,
    motivo: texto(bruto['motivo']),
  };
}

export function aVinculacion(bruto: unknown): Vinculacion {
  const registro = esRegistro(bruto) ? bruto : {};
  const items = listaDe(registro, ['items'])
    .map(aResultadoAsistente)
    .filter((item): item is ResultadoAsistente => item !== null);

  const resumenBruto = esRegistro(registro['resumen']) ? registro['resumen'] : {};
  const vinculados = numero(resumenBruto['vinculados']);
  const omitidos = numero(resumenBruto['omitidos']);
  const errores = numero(resumenBruto['errores']);

  return {
    reunionId: texto(registro['reunionId']) ?? '',
    items,
    resumen: {
      total: numero(resumenBruto['total']) || items.length,
      vinculados,
      omitidos,
      errores,
    },
  };
}
