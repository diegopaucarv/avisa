/**
 * Validación de una hoja contra un tipo de importación.
 *
 * Dos decisiones que conviene tener presentes:
 *
 * 1. La validación local **no** sustituye a la API. Aquí se atrapan los fallos
 *    que se pueden ver sin red (campos obligatorios, fechas, duplicados del
 *    propio archivo) para no gastar una petición por fila rota; los catálogos
 *    —temática, riesgo, región— los resuelve el servidor y sus rechazos llegan
 *    al informar del resultado, con su código.
 * 2. Un archivo grande se corta, no se intenta: 400 altas por tanda es el
 *    límite que protege la base y la paciencia.
 */

import { limpiarCelda, normalizarEncabezado, type TablaLeida } from './importacion.csv';
import type { TipoImportacion, TipoImportacionId } from './importacion.tipos';
import { TIPO_ACTOR_PUBLICO, TIPOS_ACTOR } from '../directorio/directorio.mapeo';

export const LIMITE_FILAS = 400;

export type Rechazo = {
  /** Número de fila del archivo, contando la cabecera. */
  readonly fila: number;
  readonly codigo: string;
  readonly motivo: string;
};

export type FilaValida = {
  readonly fila: number;
  /** Texto corto para el resumen y para identificar la fila si la API falla. */
  readonly etiqueta: string;
  readonly payload: Record<string, unknown>;
  /** Demandas en texto; el ejecutor las crea después del caso. */
  readonly demandas: readonly string[];
  /** Foto principal declarada en la hoja; el ejecutor la registra tras el alta. */
  readonly foto?: string | null;
};

export type Validacion = {
  readonly tipo: TipoImportacionId;
  readonly totalFilas: number;
  readonly columnasReconocidas: readonly string[];
  readonly columnasIgnoradas: readonly string[];
  /** Rótulos obligatorios que no aparecen en la cabecera. */
  readonly faltantes: readonly string[];
  readonly validas: readonly FilaValida[];
  readonly rechazos: readonly Rechazo[];
  readonly truncada: boolean;
};

const SEPARADOR_DEMANDAS = /\s*(?:\||\n|;)\s*/;

/** `dd/mm/aaaa`, `dd-mm-aaaa` o `aaaa-mm-dd` → `aaaa-mm-dd`. `null` si no es fecha. */
export function normalizarFecha(valor: string): string | null {
  const texto = valor.trim();
  if (texto === '') return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (iso) return fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dma = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(texto);
  if (dma) return fechaValida(Number(dma[3]), Number(dma[2]), Number(dma[1]));

  return null;
}

function fechaValida(anio: number, mes: number, dia: number): string | null {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const real =
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia;
  if (!real) return null;
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(
    2,
    '0',
  )}`;
}

const NIVELES_GOBIERNO: Record<string, string> = {
  nacional: 'Nacional',
  regional: 'Regional',
  local: 'Local',
  empresa: 'Empresa',
  'sociedad civil': 'Sociedad_Civil',
};

/** Tipos de actor ya normalizados; el catálogo congelado vive en el directorio. */
const TIPOS_ACTOR_NORMALIZADOS = new Set(TIPOS_ACTOR.map((tipo) => normalizarEncabezado(tipo)));

/** Texto de la hoja → nombre canónico del catálogo, o `null` si no existe. */
function tipoActorCanonico(valor: string): string | null {
  const buscado = normalizarEncabezado(valor);
  return TIPOS_ACTOR_NORMALIZADOS.has(buscado)
    ? (TIPOS_ACTOR.find((tipo) => normalizarEncabezado(tipo) === buscado) ?? null)
    : null;
}

/** Una URL de foto aceptable: http(s) absoluta y de largo razonable. */
function esUrlPublica(valor: string): boolean {
  if (valor.length > 2000) return false;
  try {
    const url = new URL(valor);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Índice de la cabecera: clave de columna → posición. */
function indexarCabecera(
  tipo: TipoImportacion,
  cabecera: readonly string[],
): {
  posiciones: Map<string, number>;
  reconocidas: string[];
  ignoradas: string[];
} {
  const normalizadas = cabecera.map((celda) => normalizarEncabezado(celda));
  const posiciones = new Map<string, number>();
  const usadas = new Set<number>();

  for (const columna of tipo.columnas) {
    for (const alias of columna.alias) {
      const buscado = normalizarEncabezado(alias);
      const indice = normalizadas.findIndex(
        (celda, posicion) => celda === buscado && !usadas.has(posicion),
      );
      if (indice >= 0) {
        posiciones.set(columna.clave, indice);
        usadas.add(indice);
        break;
      }
    }
  }

  const reconocidas = tipo.columnas
    .filter((columna) => posiciones.has(columna.clave))
    .map((columna) => columna.rotulo);
  const ignoradas = cabecera.filter((_, indice) => !usadas.has(indice)).filter(Boolean);

  return { posiciones, reconocidas, ignoradas };
}

/** Valores de una fila por clave de columna, ya recortados. */
function valoresDe(
  fila: readonly string[],
  posiciones: Map<string, number>,
): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const [clave, indice] of posiciones) {
    valores[clave] = limpiarCelda(fila[indice]);
  }
  return valores;
}

function partirLista(valor: string): string[] {
  return valor
    .split(SEPARADOR_DEMANDAS)
    .map((parte) => parte.trim())
    .filter(Boolean);
}

export function validarImportacion(tipo: TipoImportacion, tabla: TablaLeida): Validacion {
  const { posiciones, reconocidas, ignoradas } = indexarCabecera(tipo, tabla.cabecera);
  const faltantes = tipo.columnas
    .filter((columna) => columna.obligatoria && !posiciones.has(columna.clave))
    .map((columna) => columna.rotulo);

  const base: Validacion = {
    tipo: tipo.id,
    totalFilas: tabla.filas.length,
    columnasReconocidas: reconocidas,
    columnasIgnoradas: ignoradas,
    faltantes,
    validas: [],
    rechazos: [],
    truncada: false,
  };

  if (faltantes.length > 0 || tabla.filas.length === 0) return base;

  const validas: FilaValida[] = [];
  const rechazos: Rechazo[] = [];
  const vistos = new Set<string>();
  const filasProcesables = tabla.filas.slice(0, LIMITE_FILAS);

  tabla.filas.slice(LIMITE_FILAS).forEach((_, indice) => {
    rechazos.push({
      fila: LIMITE_FILAS + indice + 2,
      codigo: 'LIMITE_FILAS',
      motivo: `El archivo supera el límite de ${LIMITE_FILAS} filas por tanda.`,
    });
  });

  filasProcesables.forEach((fila, indice) => {
    const numero = indice + 2; // +1 por la cabecera, +1 porque se cuenta desde 1
    const valores = valoresDe(fila, posiciones);
    const resultado = construirFila(tipo.id, numero, valores);

    if (resultado.rechazo) {
      rechazos.push(resultado.rechazo);
      return;
    }
    if (!resultado.fila) return;

    // Duplicados dentro del archivo: se rechaza la segunda aparición.
    if (vistos.has(resultado.clave)) {
      rechazos.push({
        fila: numero,
        codigo: 'DUPLICADO_EN_ARCHIVO',
        motivo: `«${resultado.fila.etiqueta}» ya aparece en una fila anterior de este archivo.`,
      });
      return;
    }
    vistos.add(resultado.clave);
    validas.push(resultado.fila);
  });

  return { ...base, validas, rechazos, truncada: tabla.filas.length > LIMITE_FILAS };
}

type FilaConstruida = {
  fila?: FilaValida;
  clave: string;
  rechazo?: Rechazo;
};

function faltante(fila: number, rotulo: string): FilaConstruida {
  return {
    clave: '',
    rechazo: {
      fila,
      codigo: 'CAMPO_OBLIGATORIO',
      motivo: `La columna «${rotulo}» está vacía en la fila ${fila}.`,
    },
  };
}

function fechaInvalida(fila: number, rotulo: string, valor: string): FilaConstruida {
  return {
    clave: '',
    rechazo: {
      fila,
      codigo: 'FECHA_INVALIDA',
      motivo: `«${valor}» no es una fecha válida en «${rotulo}». Use AAAA-MM-DD o DD/MM/AAAA.`,
    },
  };
}

function construirFila(
  tipo: TipoImportacionId,
  fila: number,
  valores: Record<string, string>,
): FilaConstruida {
  switch (tipo) {
    case 'casos':
    case 'casos-demandas':
      return filaDeCaso(tipo, fila, valores);
    case 'actores-personas':
    case 'actores-organizaciones':
    case 'actores-instituciones':
      return filaDeActor(tipo, fila, valores);
    case 'asistencia':
      return filaDeAsistencia(fila, valores);
    default:
      return faltante(fila, 'tipo de importación');
  }
}

function filaDeCaso(
  tipo: TipoImportacionId,
  fila: number,
  valores: Record<string, string>,
): FilaConstruida {
  const titulo = valores['titulo'] ?? '';
  if (titulo === '') return faltante(fila, 'Título del caso');

  const regiones = partirLista(valores['region'] ?? '');
  if (regiones.length === 0) return faltante(fila, 'Región');

  const inicio = valores['fechaInicio'] ?? '';
  const fechaInicio = inicio === '' ? undefined : normalizarFecha(inicio);
  if (inicio !== '' && fechaInicio === null) {
    return {
      clave: '',
      rechazo: {
        fila,
        codigo: 'FECHA_INVALIDA',
        motivo: `«${inicio}» no es una fecha. Use AAAA-MM-DD o DD/MM/AAAA.`,
      },
    };
  }

  const demandas = tipo === 'casos-demandas' ? partirLista(valores['demandas'] ?? '') : [];
  if (tipo === 'casos-demandas' && demandas.length === 0) return faltante(fila, 'Demandas');

  const payload: Record<string, unknown> = {
    titulo,
    regiones,
    tematica: valores['tematica'] || undefined,
    subsector: valores['subsector'] || undefined,
    naturaleza: valores['naturaleza'] || undefined,
    riesgo: valores['riesgo'] || undefined,
    nivelConflicto: valores['conflictividad'] || undefined,
    unidadResponsable: valores['unidad'] || undefined,
    prioridad: valores['prioridad'] || undefined,
    fechaInicio: fechaInicio ?? undefined,
    resumen: valores['resumen'] || undefined,
  };

  return {
    clave: `${normalizarEncabezado(titulo)}|${normalizarEncabezado(regiones.join(' '))}`,
    fila: {
      fila,
      etiqueta: titulo,
      payload,
      demandas,
    },
  };
}

function filaDeActor(
  tipo: TipoImportacionId,
  fila: number,
  valores: Record<string, string>,
): FilaConstruida {
  const nombre = valores['nombre'] ?? '';
  if (nombre === '') return faltante(fila, 'Nombre');

  const esPersona = tipo === 'actores-personas';
  const nivelGobiernoTexto = valores['nivelGobierno'] ?? '';
  const nivelGobierno = NIVELES_GOBIERNO[normalizarEncabezado(nivelGobiernoTexto)];

  if (tipo === 'actores-instituciones') {
    if (nivelGobiernoTexto === '') return faltante(fila, 'Nivel de gobierno');
    if (!nivelGobierno) {
      return {
        clave: '',
        rechazo: {
          fila,
          codigo: 'NIVEL_GOBIERNO_INVALIDO',
          motivo: `«${nivelGobiernoTexto}» no está en el catálogo (Nacional, Regional o Local).`,
        },
      };
    }
  }

  const dni = valores['dni'] ?? '';
  if (esPersona && dni !== '' && !/^\d{8}$/.test(dni)) {
    return {
      clave: '',
      rechazo: {
        fila,
        codigo: 'DNI_INVALIDO',
        motivo: `El DNI «${dni}» debe tener 8 dígitos.`,
      },
    };
  }

  const ruc = valores['ruc'] ?? '';
  if (!esPersona && ruc !== '' && !/^\d{11}$/.test(ruc)) {
    return {
      clave: '',
      rechazo: {
        fila,
        codigo: 'RUC_INVALIDO',
        motivo: `El RUC «${ruc}» debe tener 11 dígitos.`,
      },
    };
  }

  // El tipo escrito sólo se valida fuera de instituciones: ahí el tipo es fijo.
  const tipoCelda = valores['tipo'] ?? '';
  const tipoCanonico = tipoCelda === '' ? null : tipoActorCanonico(tipoCelda);
  if (tipo !== 'actores-instituciones' && tipoCelda !== '' && !tipoCanonico) {
    return {
      clave: '',
      rechazo: {
        fila,
        codigo: 'TIPO_ACTOR_INVALIDO',
        motivo: `El tipo de actor «${tipoCelda}» no está en el catálogo (${TIPOS_ACTOR.join(
          ', ',
        )}).`,
      },
    };
  }

  // Las vigencias OSPA se parsean aquí para no gastar una petición por fila.
  const vigenciaDesdeTexto = valores['vigenciaDesde'] ?? '';
  const vigenciaDesde = vigenciaDesdeTexto === '' ? undefined : normalizarFecha(vigenciaDesdeTexto);
  if (vigenciaDesdeTexto !== '' && vigenciaDesde === null) {
    return fechaInvalida(fila, 'Vigencia desde', vigenciaDesdeTexto);
  }

  const vigenciaHastaTexto = valores['vigenciaHasta'] ?? '';
  const vigenciaHasta = vigenciaHastaTexto === '' ? undefined : normalizarFecha(vigenciaHastaTexto);
  if (vigenciaHastaTexto !== '' && vigenciaHasta === null) {
    return fechaInvalida(fila, 'Vigencia hasta', vigenciaHastaTexto);
  }

  const foto = valores['foto'] ?? '';
  if (foto !== '' && !esUrlPublica(foto)) {
    return {
      clave: '',
      rechazo: {
        fila,
        codigo: 'FOTO_INVALIDA',
        motivo: `La foto «${foto}» no es una URL pública válida (http o https).`,
      },
    };
  }

  const payload: Record<string, unknown> = {
    naturaleza: esPersona ? 'persona' : 'organizacion',
    nombre,
    cargo: valores['cargo'] || undefined,
    tipo: tipo === 'actores-instituciones' ? TIPO_ACTOR_PUBLICO : (tipoCanonico ?? undefined),
    funcion: valores['funcion'] || undefined,
    posicionamiento: valores['posicionamiento'] || undefined,
    region: valores['region'] || undefined,
    nivelGobierno: nivelGobierno || undefined,
  };

  if (esPersona) {
    payload['dni'] = dni || undefined;
    payload['telefono'] = valores['telefono'] || undefined;
    payload['email'] = valores['correo'] || undefined;
  } else {
    payload['abreviatura'] = valores['abreviatura'] || undefined;
    payload['ruc'] = ruc || undefined;
    payload['expedienteOspa'] = valores['expedienteOspa'] || undefined;
    payload['estadoOspa'] = valores['estadoOspa'] || undefined;
    payload['vigenciaDesde'] = vigenciaDesde ?? undefined;
    payload['vigenciaHasta'] = vigenciaHasta ?? undefined;
  }

  return {
    clave: normalizarEncabezado(nombre),
    fila: { fila, etiqueta: nombre, payload, demandas: [], foto: foto || null },
  };
}

function filaDeAsistencia(fila: number, valores: Record<string, string>): FilaConstruida {
  const nombre = valores['nombre'] ?? '';
  if (nombre === '') return faltante(fila, 'Nombre');

  return {
    clave: normalizarEncabezado(nombre),
    fila: {
      fila,
      etiqueta: nombre,
      payload: {
        nombre,
        cargo: valores['cargo'] ?? '',
        organizacion: valores['organizacion'] ?? '',
        region: valores['region'] ?? '',
      },
      demandas: [],
    },
  };
}
