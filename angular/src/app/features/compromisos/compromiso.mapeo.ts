/**
 * Compromisos: contrato de la API y vocabulario congelado.
 *
 * `GET /api/v1/commitments` devuelve los campos en camelCase y los estados con
 * guiones bajos reemplazados (`En ejecucion`). Aquí se normaliza al vocabulario
 * de la Guía (§8.3.2 y Anexo 14) para que la plantilla no conozca variantes.
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

export type EstadoCompromiso =
  'Por iniciar' | 'En proceso' | 'Cumplido' | 'Redefinido' | 'Desestimado';

export type EstadoHito = 'Registrado' | 'En ejecución' | 'Paralizado' | 'Cumplido' | 'Desestimado';

export type TipoCompromiso = 'Actividad' | 'PIP';

/** `manual` prevalece; `hito` viene del próximo hito no terminal. */
export type OrigenVencimiento = 'manual' | 'hito' | null;

export const ESTADOS_COMPROMISO = [
  'Por iniciar',
  'En proceso',
  'Cumplido',
  'Redefinido',
  'Desestimado',
] as const satisfies readonly EstadoCompromiso[];

export const ESTADOS_HITO = [
  'Registrado',
  'En ejecución',
  'Paralizado',
  'Cumplido',
  'Desestimado',
] as const satisfies readonly EstadoHito[];

export const TIPOS_COMPROMISO = ['Actividad', 'PIP'] as const satisfies readonly TipoCompromiso[];

export const NIVELES_GOBIERNO = [
  'Nacional',
  'Regional',
  'Local',
  'Empresa',
  'Sociedad Civil',
] as const;

export const ALCANCES = ['Norte', 'Centro', 'Sur', 'Oriente', 'Nacional'] as const;

export type Hito = {
  id: string;
  codigo: string | null;
  descripcion: string | null;
  fecha: string | null;
  fechaReal: string | null;
  estado: EstadoHito;
  terminal: boolean;
  validacion: string | null;
  descripcionEvidencia: string | null;
  linkEvidencia: string | null;
};

export type ProximoHito = {
  id: string;
  descripcion: string | null;
  fecha: string;
  estado: EstadoHito;
};

export type Compromiso = {
  id: string;
  codigo: string;
  accion: string;
  casoId: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  tipo: TipoCompromiso;
  nivelGobierno: string | null;
  estado: EstadoCompromiso;
  estadoCategoria: string | null;
  terminal: boolean;
  fechaInicio: string | null;
  /** Fecha manual. Puede ser null. */
  fechaVencimiento: string | null;
  /** Manual o, si falta, la del próximo hito no terminal. */
  fechaVencimientoEfectiva: string | null;
  origenVencimiento: OrigenVencimiento;
  unidad: string | null;
  alcance: string | null;
  tematica: string | null;
  atiendeGenero: boolean;
  evidenciaUri: string | null;
  criteriosSmart: unknown;
  documentoOrigenId: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean;
  clasificacion: number;
  hitos: Hito[];
  proximoHito: ProximoHito | null;
  vencido: boolean;
};

export type CasoCompromiso = {
  codigo: string | null;
  titulo: string | null;
  estado: string | null;
};

export type DocumentoCompromiso = {
  codigo: string | null;
  titulo: string | null;
  fecha: string | null;
};

export type DetalleCompromiso = {
  compromiso: Compromiso;
  caso: CasoCompromiso | null;
  documento: DocumentoCompromiso | null;
};

export type OpcionCatalogo = {
  valor: string;
  etiqueta: string;
};

export type CatalogosCompromiso = {
  unidades: OpcionCatalogo[];
  tematicas: OpcionCatalogo[];
};

/** Resultado de aplicar la regla de vencimiento manual → próximo hito → nada. */
export type ResolucionVencimiento = {
  fecha: string | null;
  origen: OrigenVencimiento;
};

export type Situacion = {
  etiqueta: string;
  clase: string;
};

function normalizarClave(valor: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function estadoCompromisoDe(valor: string | null): EstadoCompromiso {
  const clave = normalizarClave(valor);
  return ESTADOS_COMPROMISO.find((opcion) => normalizarClave(opcion) === clave) ?? 'Por iniciar';
}

export function estadoHitoDe(valor: string | null): EstadoHito {
  const clave = normalizarClave(valor);
  return ESTADOS_HITO.find((opcion) => normalizarClave(opcion) === clave) ?? 'Registrado';
}

function tipoDe(valor: string | null): TipoCompromiso {
  return normalizarClave(valor) === 'pip' ? 'PIP' : 'Actividad';
}

function nivelGobiernoDe(valor: string | null): string | null {
  if (!valor) return null;
  const limpio = valor.replace(/_/g, ' ').trim();
  return limpio || null;
}

function origenVencimientoDe(valor: string | null): OrigenVencimiento {
  if (valor === 'manual' || valor === 'hito') return valor;
  return null;
}

function aHito(bruto: unknown): Hito {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']),
    descripcion: texto(registro, ['descripcion']),
    fecha: texto(registro, ['fecha']),
    fechaReal: texto(registro, ['fechaReal', 'fecha_real']),
    estado: estadoHitoDe(texto(registro, ['estado'])),
    terminal: booleano(registro, ['terminal']),
    validacion: texto(registro, ['validacion']),
    descripcionEvidencia: texto(registro, ['descripcionEvidencia', 'descripcion_evidencia']),
    linkEvidencia: texto(registro, ['linkEvidencia', 'link_evidencia']),
  };
}

function aProximoHito(bruto: unknown): ProximoHito | null {
  if (!esRegistro(bruto)) return null;
  const fecha = texto(bruto, ['fecha']);
  if (!fecha) return null;
  return {
    id: texto(bruto, ['id']) ?? '',
    descripcion: texto(bruto, ['descripcion']),
    fecha,
    estado: estadoHitoDe(texto(bruto, ['estado'])),
  };
}

/** Registro de `GET /api/v1/commitments` (listado y detalle comparten forma). */
export function aCompromiso(bruto: unknown): Compromiso {
  const registro = esRegistro(bruto) ? bruto : {};

  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']) ?? 'Sin código',
    accion: texto(registro, ['accion']) ?? 'Sin acción registrada',
    casoId: texto(registro, ['casoId', 'caso_id']),
    casoCodigo: texto(registro, ['casoCode', 'caso_code']),
    casoTitulo: texto(registro, ['casoTitulo', 'caso_titulo']),
    tipo: tipoDe(texto(registro, ['tipo'])),
    nivelGobierno: nivelGobiernoDe(texto(registro, ['nivelGobierno'])),
    estado: estadoCompromisoDe(texto(registro, ['estado'])),
    estadoCategoria: texto(registro, ['estadoCategoria', 'estado_categoria']),
    terminal: booleano(registro, ['terminal']),
    fechaInicio: texto(registro, ['fechaInicio', 'fecha_inicio']),
    fechaVencimiento: texto(registro, ['fechaVencimiento', 'fecha_vencimiento']),
    fechaVencimientoEfectiva: texto(registro, [
      'fechaVencimientoEfectiva',
      'fecha_vencimiento_efectiva',
    ]),
    origenVencimiento: origenVencimientoDe(
      texto(registro, ['origenVencimiento', 'origen_vencimiento']),
    ),
    unidad: texto(registro, ['unidad']),
    alcance: texto(registro, ['alcance']),
    tematica: texto(registro, ['tematica']),
    atiendeGenero: booleano(registro, ['atiendeGenero', 'atiende_genero']),
    evidenciaUri: texto(registro, ['evidenciaUri', 'evidencia_uri']),
    criteriosSmart: leer(registro, ['criteriosSmart', 'criterios_smart']) ?? null,
    documentoOrigenId: texto(registro, ['documentoOrigenId', 'documento_origen_id']),
    origen: texto(registro, ['origen']),
    confianza: numero(registro, ['confianza']),
    validado: booleano(registro, ['validado']),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    hitos: lista(registro, ['hitos']).map(aHito),
    proximoHito: aProximoHito(leer(registro, ['proximoHito', 'proximo_hito'])),
    vencido: booleano(registro, ['vencido']),
  };
}

/** `GET /api/v1/commitments/:id` envuelve compromiso, caso y documento. */
export function aDetalleCompromiso(bruto: unknown): DetalleCompromiso {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudoCaso = leer(registro, ['caso']);
  const crudoDocumento = leer(registro, ['documentoOrigen', 'documento_origen']);

  const caso = esRegistro(crudoCaso) ? crudoCaso : null;
  const documento = esRegistro(crudoDocumento) ? crudoDocumento : null;

  return {
    compromiso: aCompromiso(leer(registro, ['commitment', 'compromiso']) ?? registro),
    caso: caso
      ? {
          codigo: texto(caso, ['code', 'codigo']),
          titulo: texto(caso, ['title', 'titulo']),
          estado: texto(caso, ['estado']),
        }
      : null,
    documento: documento
      ? {
          codigo: texto(documento, ['codigo', 'code']),
          titulo: texto(documento, ['titulo', 'title']),
          fecha: texto(documento, ['fecha']),
        }
      : null,
  };
}

function aOpciones(bruto: unknown): OpcionCatalogo[] {
  if (!Array.isArray(bruto)) return [];
  const opciones: OpcionCatalogo[] = [];

  for (const item of bruto) {
    const registro: Registro = esRegistro(item) ? item : {};
    const valor = texto(registro, ['codigo', 'valor', 'nombre']);
    const etiqueta = texto(registro, ['etiqueta', 'nombre']) ?? valor;
    if (valor && etiqueta) opciones.push({ valor, etiqueta });
  }

  return opciones;
}

/** `GET /api/v1/catalogs`, sólo lo que el panel necesita para editar. */
export function aCatalogosCompromiso(bruto: unknown): CatalogosCompromiso {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = leer(registro, ['catalogs', 'catalogos']);
  const catalogo = esRegistro(crudo) ? crudo : {};

  return {
    unidades: aOpciones(leer(catalogo, ['unidades'])),
    tematicas: aOpciones(leer(catalogo, ['tematicas'])),
  };
}

/**
 * Regla del usuario: la fecha manual manda; si no existe, se usa la efectiva
 * derivada del próximo hito; si tampoco hay, no se inventa ninguna fecha.
 */
export function resolverVencimiento(compromiso: Compromiso): ResolucionVencimiento {
  if (compromiso.fechaVencimiento) {
    return { fecha: compromiso.fechaVencimiento, origen: 'manual' };
  }
  if (compromiso.fechaVencimientoEfectiva) {
    return {
      fecha: compromiso.fechaVencimientoEfectiva,
      origen: compromiso.origenVencimiento ?? 'hito',
    };
  }
  return { fecha: null, origen: null };
}

function diasHasta(fecha: string, hoy: Date): number | null {
  const partes = fecha.slice(0, 10).split('-');
  if (partes.length !== 3) return null;

  const anio = Number(partes[0]);
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);
  if (!Number.isFinite(anio) || !Number.isFinite(mes) || !Number.isFinite(dia)) {
    return null;
  }

  const destino = Date.UTC(anio, mes - 1, dia);
  const base = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((destino - base) / 86_400_000);
}

export function situacionDe(compromiso: Compromiso, hoy: Date = new Date()): Situacion {
  const { fecha } = resolverVencimiento(compromiso);
  if (!fecha) return { etiqueta: 'Sin fecha', clase: 'due-sin-fecha' };
  if (compromiso.vencido) return { etiqueta: 'Atrasado', clase: 'due-vencido' };

  const dias = diasHasta(fecha, hoy);
  if (dias !== null && dias >= 0 && dias <= 30) {
    return { etiqueta: 'Por vencer', clase: 'due-por-vencer' };
  }
  return { etiqueta: 'En plazo', clase: 'due-en-plazo' };
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`; no se usa un pipe para no depender del locale. */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';

  const partes = valor.slice(0, 10).split('-');
  if (partes.length !== 3) return valor;

  const anio = partes[0];
  const mes = partes[1];
  const dia = partes[2];
  if (!anio || !mes || !dia) return valor;

  return `${dia}/${mes}/${anio}`;
}
