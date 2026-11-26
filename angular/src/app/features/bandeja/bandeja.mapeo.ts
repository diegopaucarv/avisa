/**
 * Tablero (Kanban) de la bandeja: contrato y normalización.
 *
 * La API entrega las cuatro columnas con sus tarjetas ya resueltas en SQL y los
 * registros que aún no tienen tarjeta (`candidatos`). Aquí sólo se normaliza la
 * forma y se declaran las etiquetas y reglas de presentación; ningún agregado
 * se recalcula: la completitud llega del endpoint `/v1/bandeja/completitud`.
 *
 * Nada se estima: una fecha ausente se muestra «Sin fecha» y un responsable
 * ausente, «Sin asignar».
 */

import { formatearFecha } from '../../shared/formato-fecha';

export const COLUMNAS_TABLERO = ['backlog', 'en_curso', 'en_espera', 'hecho'] as const;

export type ClaveColumna = (typeof COLUMNAS_TABLERO)[number];

export type TipoEntidadTablero = 'alerta' | 'compromiso' | 'demanda' | 'caso';

export type FiltroTipoTablero = 'todas' | 'alerta' | 'compromiso' | 'demanda';

export const ETIQUETAS_COLUMNA: Record<ClaveColumna, string> = {
  backlog: 'Backlog',
  en_curso: 'En curso',
  en_espera: 'En espera',
  hecho: 'Hecho',
};

export const ETIQUETAS_TIPO: Record<TipoEntidadTablero, string> = {
  alerta: 'Alerta',
  compromiso: 'Compromiso',
  demanda: 'Demanda',
  caso: 'Caso',
};

export const OPCIONES_FILTRO: readonly { valor: FiltroTipoTablero; etiqueta: string }[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'alerta', etiqueta: 'Alertas' },
  { valor: 'compromiso', etiqueta: 'Compromisos' },
  { valor: 'demanda', etiqueta: 'Demandas' },
];

export type TarjetaTablero = {
  id: string;
  entidadTipo: TipoEntidadTablero;
  entidadId: string;
  columna: ClaveColumna;
  asignacionTexto: string | null;
  responsableUsuarioId: string | null;
  responsableUsuarioNombre: string | null;
  responsableTexto: string | null;
  fechaLimite: string | null;
  pospuestoHasta: string | null;
  motivoPosposicion: string | null;
  orden: number;
  codigo: string | null;
  titulo: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  riesgo: string | null;
  estado: string | null;
  fechaReferencia: string | null;
  actualizadoEn: string | null;
};

export type CandidatoTablero = {
  entidadTipo: 'alerta' | 'compromiso' | 'demanda';
  entidadId: string;
  codigo: string | null;
  titulo: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  riesgo: string | null;
  estado: string | null;
  fechaReferencia: string | null;
};

export type ColumnaTablero = {
  clave: ClaveColumna;
  etiqueta: string;
  tarjetas: TarjetaTablero[];
  total: number;
};

export type ConteosTipo = Record<TipoEntidadTablero, number>;

export type Tablero = {
  columnas: ColumnaTablero[];
  total: number;
  pospuestas: number;
  conFechaLimite: number;
  vencidas: number;
  sinResponsable: number;
  conteosTipo: ConteosTipo;
  candidatos: CandidatoTablero[];
  candidatosTotal: number;
  hoy: string | null;
  generadoEn: string;
};

export type CompletitudColumna = {
  clave: ClaveColumna;
  etiqueta: string;
  total: number;
  conResponsable: number;
  sinResponsable: number;
  conFechaLimite: number;
  sinFechaLimite: number;
  conAsignacion: number;
  sinAsignacion: number;
  completas: number;
  incompletas: number;
};

export type CompletitudTotales = Omit<CompletitudColumna, 'clave' | 'etiqueta'>;

export type Completitud = {
  columnas: CompletitudColumna[];
  total: CompletitudTotales;
  generadoEn: string;
};

/** Cuerpo de `PATCH /v1/bandeja/{tipo}/{id}` (nombres del contrato en español). */
export type CambiosTarjeta = {
  columna?: ClaveColumna;
  asignacionTexto?: string | null;
  responsableUsuarioId?: string | null;
  responsableTexto?: string | null;
  fechaLimite?: string | null;
  pospuestoHasta?: string | null;
  motivoPosposicion?: string | null;
  orden?: number;
};

export type ResultadoActualizacion = {
  creada: boolean;
  tarjeta: {
    id: string;
    entidadTipo: TipoEntidadTablero;
    entidadId: string;
    columna: ClaveColumna;
    asignacionTexto: string | null;
    responsableUsuarioId: string | null;
    responsableTexto: string | null;
    fechaLimite: string | null;
    pospuestoHasta: string | null;
    motivoPosposicion: string | null;
    orden: number;
  };
  eventos: string[];
};

/* ------------------------------------------------------------------ *
 * Normalización defensiva
 * ------------------------------------------------------------------ */

type Registro = Record<string, unknown>;

function esRegistro(valor: unknown): valor is Registro {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

function numero(valor: unknown, respaldo = 0): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : respaldo;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function columnaValida(valor: unknown): ClaveColumna {
  return typeof valor === 'string' && (COLUMNAS_TABLERO as readonly string[]).includes(valor)
    ? (valor as ClaveColumna)
    : 'backlog';
}

function tipoValido(valor: unknown): TipoEntidadTablero {
  switch (valor) {
    case 'alerta':
    case 'compromiso':
    case 'demanda':
    case 'caso':
      return valor;
    default:
      return 'alerta';
  }
}

function aTarjeta(bruto: unknown): TarjetaTablero | null {
  if (!esRegistro(bruto)) return null;
  const entidadId = texto(bruto['entidadId']);
  if (!entidadId) return null;

  return {
    id: texto(bruto['id']) ?? `${String(bruto['entidadTipo'])}:${entidadId}`,
    entidadTipo: tipoValido(bruto['entidadTipo']),
    entidadId,
    columna: columnaValida(bruto['columna']),
    asignacionTexto: texto(bruto['asignacionTexto']),
    responsableUsuarioId: texto(bruto['responsableUsuarioId']),
    responsableUsuarioNombre: texto(bruto['responsableUsuarioNombre']),
    responsableTexto: texto(bruto['responsableTexto']),
    fechaLimite: texto(bruto['fechaLimite']),
    pospuestoHasta: texto(bruto['pospuestoHasta']),
    motivoPosposicion: texto(bruto['motivoPosposicion']),
    orden: numero(bruto['orden']),
    codigo: texto(bruto['codigo']),
    titulo: texto(bruto['titulo']),
    casoCodigo: texto(bruto['casoCodigo']),
    casoTitulo: texto(bruto['casoTitulo']),
    riesgo: texto(bruto['riesgo']),
    estado: texto(bruto['estado']),
    fechaReferencia: texto(bruto['fechaReferencia']),
    actualizadoEn: texto(bruto['actualizadoEn']),
  };
}

function aCandidato(bruto: unknown): CandidatoTablero | null {
  if (!esRegistro(bruto)) return null;
  const entidadId = texto(bruto['entidadId']);
  if (!entidadId) return null;
  const tipo = bruto['entidadTipo'];
  if (tipo !== 'alerta' && tipo !== 'compromiso' && tipo !== 'demanda') return null;

  return {
    entidadTipo: tipo,
    entidadId,
    codigo: texto(bruto['codigo']),
    titulo: texto(bruto['titulo']),
    casoCodigo: texto(bruto['casoCodigo']),
    casoTitulo: texto(bruto['casoTitulo']),
    riesgo: texto(bruto['riesgo']),
    estado: texto(bruto['estado']),
    fechaReferencia: texto(bruto['fechaReferencia']),
  };
}

function conteosDe(bruto: unknown): ConteosTipo {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  return {
    alerta: numero(registro['alerta']),
    compromiso: numero(registro['compromiso']),
    demanda: numero(registro['demanda']),
    caso: numero(registro['caso']),
  };
}

export function normalizarTablero(bruto: unknown): Tablero {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const columnas = lista(registro['columnas'])
    .map((columna) => {
      if (!esRegistro(columna)) return null;
      const clave = columnaValida(columna['clave']);
      const tarjetas = lista(columna['tarjetas'])
        .map(aTarjeta)
        .filter((tarjeta): tarjeta is TarjetaTablero => tarjeta !== null);
      return {
        clave,
        etiqueta: texto(columna['etiqueta']) ?? ETIQUETAS_COLUMNA[clave],
        tarjetas,
        total: numero(columna['total'], tarjetas.length),
      } satisfies ColumnaTablero;
    })
    .filter((columna): columna is ColumnaTablero => columna !== null);

  return {
    columnas,
    total: numero(registro['total']),
    pospuestas: numero(registro['pospuestas']),
    conFechaLimite: numero(registro['conFechaLimite']),
    vencidas: numero(registro['vencidas']),
    sinResponsable: numero(registro['sinResponsable']),
    conteosTipo: conteosDe(registro['conteosTipo']),
    candidatos: lista(registro['candidatos'])
      .map(aCandidato)
      .filter((candidato): candidato is CandidatoTablero => candidato !== null),
    candidatosTotal: numero(registro['candidatosTotal']),
    hoy: texto(registro['hoy']),
    generadoEn: texto(registro['generadoEn']) ?? '',
  };
}

function cerosColumna(clave: ClaveColumna): CompletitudColumna {
  return {
    clave,
    etiqueta: ETIQUETAS_COLUMNA[clave],
    total: 0,
    conResponsable: 0,
    sinResponsable: 0,
    conFechaLimite: 0,
    sinFechaLimite: 0,
    conAsignacion: 0,
    sinAsignacion: 0,
    completas: 0,
    incompletas: 0,
  };
}

export function normalizarCompletitud(bruto: unknown): Completitud {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const columnas = lista(registro['columnas'])
    .map((columna) => {
      if (!esRegistro(columna)) return null;
      const clave = columnaValida(columna['clave']);
      const base = cerosColumna(clave);
      return {
        clave,
        etiqueta: texto(columna['etiqueta']) ?? base.etiqueta,
        total: numero(columna['total']),
        conResponsable: numero(columna['conResponsable']),
        sinResponsable: numero(columna['sinResponsable']),
        conFechaLimite: numero(columna['conFechaLimite']),
        sinFechaLimite: numero(columna['sinFechaLimite']),
        conAsignacion: numero(columna['conAsignacion']),
        sinAsignacion: numero(columna['sinAsignacion']),
        completas: numero(columna['completas']),
        incompletas: numero(columna['incompletas']),
      } satisfies CompletitudColumna;
    })
    .filter((columna): columna is CompletitudColumna => columna !== null);

  const totalBruto: Registro = esRegistro(registro['total']) ? (registro['total'] as Registro) : {};
  return {
    columnas,
    total: {
      total: numero(totalBruto['total']),
      conResponsable: numero(totalBruto['conResponsable']),
      sinResponsable: numero(totalBruto['sinResponsable']),
      conFechaLimite: numero(totalBruto['conFechaLimite']),
      sinFechaLimite: numero(totalBruto['sinFechaLimite']),
      conAsignacion: numero(totalBruto['conAsignacion']),
      sinAsignacion: numero(totalBruto['sinAsignacion']),
      completas: numero(totalBruto['completas']),
      incompletas: numero(totalBruto['incompletas']),
    },
    generadoEn: texto(registro['generadoEn']) ?? '',
  };
}

/* ------------------------------------------------------------------ *
 * Presentación
 * ------------------------------------------------------------------ */

export function normalizarFiltroTipo(valor: string | null | undefined): FiltroTipoTablero {
  switch (valor) {
    case 'alerta':
    case 'compromiso':
    case 'demanda':
    case 'todas':
      return valor;
    case 'alertas':
      return 'alerta';
    case 'compromisos':
      return 'compromiso';
    case 'demandas':
      return 'demanda';
    default:
      return 'todas';
  }
}

export function claveTarjeta(tarjeta: Pick<TarjetaTablero, 'entidadTipo' | 'entidadId'>): string {
  return `${tarjeta.entidadTipo}:${tarjeta.entidadId}`;
}

export function responsableDe(tarjeta: TarjetaTablero): string {
  return tarjeta.responsableUsuarioNombre ?? tarjeta.responsableTexto ?? 'Sin asignar';
}

export function tieneResponsable(tarjeta: TarjetaTablero): boolean {
  return Boolean(tarjeta.responsableUsuarioId || tarjeta.responsableTexto);
}

/** Ruta de la pantalla que atiende la entidad; `null` si no hay código de caso. */
export function rutaEntidad(tipo: TipoEntidadTablero, codigo: string | null): string | null {
  switch (tipo) {
    case 'alerta':
      return '/alertas';
    case 'compromiso':
      return '/compromisos';
    case 'demanda':
      return '/casos/sin-caso';
    case 'caso':
      return codigo ? `/casos/${encodeURIComponent(codigo)}` : null;
    default:
      return null;
  }
}

export function fechaTexto(fecha: string | null): string {
  return fecha ? formatearFecha(fecha) : '—';
}

const DIA_MS = 86_400_000;

function diasHasta(fecha: string, hoy: string): number | null {
  const destino = fecha.split('-').map(Number);
  const base = hoy.split('-').map(Number);
  if (destino.length !== 3 || base.length !== 3) return null;
  if (![...destino, ...base].every(Number.isFinite)) return null;

  const fin = Date.UTC(destino[0], destino[1] - 1, destino[2]);
  const inicio = Date.UTC(base[0], base[1] - 1, base[2]);
  return Math.round((fin - inicio) / DIA_MS);
}

/** Clases `due-*` de `global.css` para la fecha límite. */
export function claseFechaLimite(fecha: string | null, hoy: string | null): string {
  if (!fecha) return 'due-sin-fecha';
  if (!hoy) return 'due-en-plazo';

  const dias = diasHasta(fecha, hoy);
  if (dias === null) return 'due-sin-fecha';
  if (dias < 0) return 'due-vencido';
  if (dias <= 30) return 'due-por-vencer';
  return 'due-en-plazo';
}

export function etiquetaFechaLimite(fecha: string | null, hoy: string | null): string {
  switch (claseFechaLimite(fecha, hoy)) {
    case 'due-vencido':
      return 'Vencida';
    case 'due-por-vencer':
      return 'Por vencer';
    case 'due-en-plazo':
      return 'En plazo';
    default:
      return 'Sin fecha';
  }
}

/** Clase `r-*` para la etiqueta de riesgo (Alto · Moderado · Bajo). */
export function claseRiesgo(riesgo: string | null): string {
  const valor = (riesgo ?? '').toLowerCase();
  if (valor.includes('alto')) return 'r-alto';
  if (valor.includes('moderado') || valor.includes('medio')) return 'r-moderado';
  if (valor.includes('bajo')) return 'r-bajo';
  return '';
}

/** Clase `tipo-*` de la etiqueta de origen. */
export function claseTipo(tipo: TipoEntidadTablero): string {
  return `tipo-${tipo}`;
}
