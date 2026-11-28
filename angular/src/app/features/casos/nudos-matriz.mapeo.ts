/**
 * Mapeo de los soportes de la ficha del caso: nudos críticos, matriz
 * demandas–intervenciones y actores vinculados.
 *
 * Los tres endpoints devuelven camelCase, pero el parseo acepta también
 * snake_case: la ficha no debe romperse si un despliegue antiguo responde con
 * la otra grafía. Todo dato ausente se conserva como `null`, nunca se estima.
 */

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function registro(valor: unknown): Record<string, unknown> {
  return esRegistro(valor) ? valor : {};
}

function lista(valor: unknown): readonly unknown[] {
  return Array.isArray(valor) ? valor : [];
}

/** Lee una clave camelCase y, si falta, su equivalente snake_case. */
function leer(fuente: Record<string, unknown>, camel: string, snake: string): unknown {
  return fuente[camel] ?? fuente[snake];
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string') {
    const limpio = valor.trim();
    return limpio === '' ? null : limpio;
  }
  return null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const convertido = Number(valor);
    return Number.isFinite(convertido) ? convertido : null;
  }
  return null;
}

function entero(valor: unknown): number {
  return Math.trunc(numero(valor) ?? 0);
}

function booleano(valor: unknown): boolean {
  return valor === true || valor === 'true';
}

/* ------------------------------------------------------------------------- *
 * Nudos críticos del expediente
 * ------------------------------------------------------------------------- */

export type NudoCriticoCaso = {
  id: string;
  semanaDesde: string;
  semanaHasta: string;
  descripcion: string | null;
  seguimiento: string | null;
  estado: string | null;
  terminal: boolean;
  abierto: boolean;
  autor: string | null;
  autorTexto: string | null;
  origen: string;
  compromisoId: string | null;
  compromisoCodigo: string | null;
  creado: string | null;
};

export type SemanaNudosCaso = {
  desde: string;
  hasta: string;
  etiqueta: string;
  nudos: readonly NudoCriticoCaso[];
  conNudo: number;
  conSeguimiento: number;
  abiertos: number;
};

export type CoberturaNudos = {
  semanas: number;
  filas: number;
  conNudo: number;
  conSeguimiento: number;
  abiertos: number;
  primera: string | null;
  ultima: string | null;
};

export type NudosCaso = {
  caso: { id: string; codigo: string; titulo: string };
  semanas: readonly SemanaNudosCaso[];
  cobertura: CoberturaNudos;
  disponible: boolean;
  generadoEn: string | null;
};

function aNudoCritico(valor: unknown): NudoCriticoCaso {
  const fuente = registro(valor);
  return {
    id: String(leer(fuente, 'id', 'id') ?? ''),
    semanaDesde: String(leer(fuente, 'semanaDesde', 'semana_desde') ?? ''),
    semanaHasta: String(leer(fuente, 'semanaHasta', 'semana_hasta') ?? ''),
    descripcion: texto(leer(fuente, 'descripcion', 'descripcion')),
    seguimiento: texto(leer(fuente, 'seguimiento', 'seguimiento')),
    estado: texto(leer(fuente, 'estado', 'estado')),
    terminal: booleano(leer(fuente, 'terminal', 'terminal')),
    abierto: booleano(leer(fuente, 'abierto', 'abierto')),
    autor: texto(leer(fuente, 'autor', 'autor')),
    autorTexto: texto(leer(fuente, 'autorTexto', 'autor_texto')),
    origen: texto(leer(fuente, 'origen', 'origen_dato')) ?? 'sin declarar',
    compromisoId: texto(leer(fuente, 'compromisoId', 'compromiso_id')),
    compromisoCodigo: texto(leer(fuente, 'compromisoCodigo', 'compromiso_codigo')),
    creado: texto(leer(fuente, 'creado', 'creado')),
  };
}

function aSemanaNudos(valor: unknown): SemanaNudosCaso {
  const fuente = registro(valor);
  return {
    desde: String(leer(fuente, 'desde', 'desde') ?? ''),
    hasta: String(leer(fuente, 'hasta', 'hasta') ?? ''),
    etiqueta: String(leer(fuente, 'etiqueta', 'etiqueta') ?? ''),
    nudos: lista(leer(fuente, 'nudos', 'nudos')).map(aNudoCritico),
    conNudo: entero(leer(fuente, 'conNudo', 'con_nudo')),
    conSeguimiento: entero(leer(fuente, 'conSeguimiento', 'con_seguimiento')),
    abiertos: entero(leer(fuente, 'abiertos', 'abiertos')),
  };
}

export function aNudosCaso(valor: unknown): NudosCaso {
  const fuente = registro(valor);
  const caso = registro(leer(fuente, 'caso', 'caso'));
  const cobertura = registro(leer(fuente, 'cobertura', 'cobertura'));
  return {
    caso: {
      id: String(caso['id'] ?? ''),
      codigo: String(caso['codigo'] ?? ''),
      titulo: String(caso['titulo'] ?? ''),
    },
    semanas: lista(leer(fuente, 'semanas', 'semanas')).map(aSemanaNudos),
    cobertura: {
      semanas: entero(cobertura['semanas']),
      filas: entero(cobertura['filas']),
      conNudo: entero(leer(cobertura, 'conNudo', 'con_nudo')),
      conSeguimiento: entero(leer(cobertura, 'conSeguimiento', 'con_seguimiento')),
      abiertos: entero(cobertura['abiertos']),
      primera: texto(cobertura['primera']),
      ultima: texto(cobertura['ultima']),
    },
    disponible: booleano(leer(fuente, 'disponible', 'disponible')),
    generadoEn: texto(leer(fuente, 'generadoEn', 'generado_en')),
  };
}

/* ------------------------------------------------------------------------- *
 * Nudos de la semana (tablero de /casos)
 * ------------------------------------------------------------------------- */

export type NudosSemanaItem = {
  casoId: string;
  codigo: string;
  titulo: string;
  region: string | null;
  nudos: readonly NudoCriticoCaso[];
  abiertos: number;
};

export type NudosSemanaTablero = {
  periodo: { desde: string; hasta: string; etiqueta: string };
  items: readonly NudosSemanaItem[];
  filas: number;
  casosConNudo: number;
  casosConNudoAbierto: number;
  casosDelAmbito: number;
  periodoSinRegistro: boolean;
  generadoEn: string | null;
};

export function aNudosSemana(valor: unknown): NudosSemanaTablero {
  const fuente = registro(valor);
  const periodo = registro(leer(fuente, 'periodo', 'periodo'));
  return {
    periodo: {
      desde: String(periodo['desde'] ?? ''),
      hasta: String(periodo['hasta'] ?? ''),
      etiqueta: String(periodo['etiqueta'] ?? ''),
    },
    items: lista(leer(fuente, 'items', 'items')).map((item) => {
      const fila = registro(item);
      return {
        casoId: String(leer(fila, 'casoId', 'caso_id') ?? ''),
        codigo: String(fila['codigo'] ?? ''),
        titulo: String(fila['titulo'] ?? ''),
        region: texto(fila['region']),
        nudos: lista(fila['nudos']).map(aNudoCritico),
        abiertos: entero(fila['abiertos']),
      };
    }),
    filas: entero(leer(fuente, 'filas', 'filas')),
    casosConNudo: entero(leer(fuente, 'casosConNudo', 'casos_con_nudo')),
    casosConNudoAbierto: entero(leer(fuente, 'casosConNudoAbierto', 'casos_con_nudo_abierto')),
    casosDelAmbito: entero(leer(fuente, 'casosDelAmbito', 'casos_del_ambito')),
    periodoSinRegistro: booleano(leer(fuente, 'periodoSinRegistro', 'periodo_sin_registro')),
    generadoEn: texto(leer(fuente, 'generadoEn', 'generado_en')),
  };
}

/* ------------------------------------------------------------------------- *
 * Matriz demandas — intervenciones
 * ------------------------------------------------------------------------- */

export type MatrizColumna = {
  clave: string;
  etiqueta: string;
  base: string;
  vinculoDeclarado: boolean;
  declaracion: string | null;
};

export type MatrizCelda = {
  total: number | null;
  declaracion: string | null;
};

export type MatrizFila = {
  demandaId: string;
  numero: number;
  demanda: string;
  estado: string | null;
  tematica: string | null;
  fecha: string | null;
  celdas: Readonly<Record<string, MatrizCelda>>;
  totalVinculado: number;
  sinVinculo: boolean;
};

export type MatrizTotales = {
  demandas: number;
  compromisos: number;
  hitos: number;
  reuniones: number;
  nudos: number | null;
  hechos: number;
};

export type MatrizCaso = {
  caso: { id: string; codigo: string; titulo: string };
  columnas: readonly MatrizColumna[];
  filas: readonly MatrizFila[];
  totales: MatrizTotales;
  sumas: Readonly<Record<string, number | null>>;
  demandasSinVinculo: number;
  sinDemandas: boolean;
  declaraciones: readonly string[];
  generadoEn: string | null;
};

export function aMatrizCaso(valor: unknown): MatrizCaso {
  const fuente = registro(valor);
  const caso = registro(leer(fuente, 'caso', 'caso'));
  const totales = registro(leer(fuente, 'totales', 'totales'));

  const sumasBrutas = registro(leer(fuente, 'sumas', 'sumas'));
  const sumas: Record<string, number | null> = {};
  for (const [clave, bruto] of Object.entries(sumasBrutas)) {
    sumas[clave] = numero(bruto);
  }

  return {
    caso: {
      id: String(caso['id'] ?? ''),
      codigo: String(caso['codigo'] ?? ''),
      titulo: String(caso['titulo'] ?? ''),
    },
    columnas: lista(leer(fuente, 'columnas', 'columnas')).map((columna) => {
      const fila = registro(columna);
      return {
        clave: String(fila['clave'] ?? ''),
        etiqueta: String(fila['etiqueta'] ?? ''),
        base: String(fila['base'] ?? ''),
        vinculoDeclarado: booleano(leer(fila, 'vinculoDeclarado', 'vinculo_declarado')),
        declaracion: texto(fila['declaracion']),
      };
    }),
    filas: lista(leer(fuente, 'filas', 'filas')).map((fila) => {
      const datos = registro(fila);
      const celdasBrutas = registro(datos['celdas']);
      const celdas: Record<string, MatrizCelda> = {};
      for (const [clave, celdaBruta] of Object.entries(celdasBrutas)) {
        const celda = registro(celdaBruta);
        celdas[clave] = {
          total: numero(celda['total']),
          declaracion: texto(celda['declaracion']),
        };
      }
      return {
        demandaId: String(leer(datos, 'demandaId', 'demanda_id') ?? ''),
        numero: entero(datos['numero']),
        demanda: String(datos['demanda'] ?? ''),
        estado: texto(datos['estado']),
        tematica: texto(datos['tematica']),
        fecha: texto(datos['fecha']),
        celdas,
        totalVinculado: entero(leer(datos, 'totalVinculado', 'total_vinculado')),
        sinVinculo: booleano(leer(datos, 'sinVinculo', 'sin_vinculo')),
      };
    }),
    totales: {
      demandas: entero(totales['demandas']),
      compromisos: entero(totales['compromisos']),
      hitos: entero(totales['hitos']),
      reuniones: entero(totales['reuniones']),
      nudos: numero(totales['nudos']),
      hechos: entero(totales['hechos']),
    },
    sumas,
    demandasSinVinculo: entero(leer(fuente, 'demandasSinVinculo', 'demandas_sin_vinculo')),
    sinDemandas: booleano(leer(fuente, 'sinDemandas', 'sin_demandas')),
    declaraciones: lista(leer(fuente, 'declaraciones', 'declaraciones'))
      .map((item) => texto(item))
      .filter((item): item is string => item !== null),
    generadoEn: texto(leer(fuente, 'generadoEn', 'generado_en')),
  };
}

/* ------------------------------------------------------------------------- *
 * Actores del caso
 * ------------------------------------------------------------------------- */

export type CasoActorVinculoFlags = {
  rolEnCaso: boolean;
  vigencia: boolean;
  bajaLogica: boolean;
  posicionObligatoria: boolean;
  influenciaObligatoria: boolean;
};

export type CasoActorFila = {
  id: string;
  nombre: string;
  abreviatura: string | null;
  tipo: string | null;
  funcion: string | null;
  naturaleza: string | null;
  posicionamiento: string | null;
  correo: string | null;
  posicion: string | null;
  nivelInfluencia: number | null;
  rolEnCaso: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  vigente: boolean;
  desvinculadoEn: string | null;
  motivoBaja: string | null;
};

export type CasoActoresCaso = {
  caso: { id: string; codigo: string; titulo: string };
  actores: readonly CasoActorFila[];
  vigentes: number;
  desvinculados: number;
  vinculo: CasoActorVinculoFlags;
  generadoEn: string | null;
};

export function aCasoActores(valor: unknown): CasoActoresCaso {
  const fuente = registro(valor);
  const caso = registro(leer(fuente, 'caso', 'caso'));
  const vinculo = registro(leer(fuente, 'vinculo', 'vinculo'));
  return {
    caso: {
      id: String(caso['id'] ?? ''),
      codigo: String(caso['codigo'] ?? ''),
      titulo: String(caso['titulo'] ?? ''),
    },
    actores: lista(leer(fuente, 'actores', 'actores')).map((actor) => {
      const fila = registro(actor);
      return {
        id: String(fila['id'] ?? ''),
        nombre: String(fila['nombre'] ?? ''),
        abreviatura: texto(fila['abreviatura']),
        tipo: texto(fila['tipo']),
        funcion: texto(fila['funcion']),
        naturaleza: texto(fila['naturaleza']),
        posicionamiento: texto(fila['posicionamiento']),
        correo: texto(fila['correo']),
        posicion: texto(fila['posicion']),
        nivelInfluencia: numero(leer(fila, 'nivelInfluencia', 'nivel_influencia')),
        rolEnCaso: texto(leer(fila, 'rolEnCaso', 'rol_en_caso')),
        vigenteDesde: texto(leer(fila, 'vigenteDesde', 'vigente_desde')),
        vigenteHasta: texto(leer(fila, 'vigenteHasta', 'vigente_hasta')),
        vigente: booleano(fila['vigente']),
        desvinculadoEn: texto(leer(fila, 'desvinculadoEn', 'desvinculado_en')),
        motivoBaja: texto(leer(fila, 'motivoBaja', 'motivo_baja')),
      };
    }),
    vigentes: entero(fuente['vigentes']),
    desvinculados: entero(fuente['desvinculados']),
    vinculo: {
      rolEnCaso: booleano(leer(vinculo, 'rolEnCaso', 'rol_en_caso')),
      vigencia: booleano(vinculo['vigencia']),
      bajaLogica: booleano(leer(vinculo, 'bajaLogica', 'baja_logica')),
      posicionObligatoria: booleano(leer(vinculo, 'posicionObligatoria', 'posicion_obligatoria')),
      influenciaObligatoria: booleano(
        leer(vinculo, 'influenciaObligatoria', 'influencia_obligatoria'),
      ),
    },
    generadoEn: texto(leer(fuente, 'generadoEn', 'generado_en')),
  };
}

/* ------------------------------------------------------------------------- *
 * Cuerpos de escritura
 * ------------------------------------------------------------------------- */

export type CuerpoVincularActor = {
  actorId: string;
  posicion?: string;
  nivelInfluencia?: number;
  rolEnCaso?: string;
  vigenteDesde?: string;
};

/** Etiqueta visible de la posición guardada en la base. */
export function etiquetaPosicion(valor: string | null): string {
  if (!valor) return '—';
  const clave = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (clave === 'oposicion') return 'Oposición';
  if (clave === 'no dialogante' || clave === 'no_dialogante') {
    return 'No dialogante';
  }
  return valor;
}
