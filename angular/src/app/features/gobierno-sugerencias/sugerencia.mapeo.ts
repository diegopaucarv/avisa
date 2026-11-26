import { booleano, esRegistro, numero, texto } from '../../dominio/mapeo';

/**
 * Dominio de la pantalla «Archivo de sugerencias».
 *
 * El backend entrega camelCase y fechas ISO; aquí se normaliza todo a un tipo
 * estable y tolerante (`aSugerencia` acepta respuestas parciales sin romper la
 * tabla). Ningún dato ausente se rellena: los `null` viajan como `null` y la
 * plantilla los declara «—» o «sin dato».
 */

export type SugerenciaEntidadTipo = 'caso' | 'territorio';

export type OrigenSugerencia = 'persona' | 'agente' | 'mesa' | 'sistema';

export const ORIGENES_SUGERENCIA: readonly OrigenSugerencia[] = [
  'persona',
  'agente',
  'mesa',
  'sistema',
];

const ETIQUETA_ORIGEN: Record<string, string> = {
  persona: 'Persona',
  agente: 'Agente',
  mesa: 'Mesa de trabajo',
  sistema: 'Sistema',
};

export function etiquetaOrigen(origen: string | null | undefined): string {
  if (!origen) return 'Sin dato';
  return ETIQUETA_ORIGEN[origen] ?? origen;
}

/**
 * Estados con su símbolo. El estado nunca se lee sólo por color: cada chip
 * lleva color, símbolo y texto (regla de accesibilidad del mockup).
 */
export type EstadoSugerenciaVista = {
  codigo: string;
  etiqueta: string;
  simbolo: string;
  clave: string;
};

export const ESTADOS_SUGERENCIA: readonly EstadoSugerenciaVista[] = [
  { codigo: 'pendiente', etiqueta: 'Pendiente', simbolo: '○', clave: 'pendiente' },
  { codigo: 'aceptada', etiqueta: 'Aceptada', simbolo: '✓', clave: 'aceptada' },
  {
    codigo: 'aceptada_con_cambios',
    etiqueta: 'Aceptada con cambios',
    simbolo: '✎',
    clave: 'cambios',
  },
  { codigo: 'rechazada', etiqueta: 'Rechazada', simbolo: '✕', clave: 'rechazada' },
  { codigo: 'expirada', etiqueta: 'Expirada', simbolo: '◷', clave: 'expirada' },
];

/** Símbolo del estado por código; los códigos nuevos caen en un punto neutro. */
export function simboloEstado(codigo: string | null | undefined): string {
  if (!codigo) return '·';
  return ESTADOS_SUGERENCIA.find((estado) => estado.codigo === codigo)?.simbolo ?? '·';
}

/** Sufijo de clase CSS del chip por código de estado. */
export function claveEstado(codigo: string | null | undefined): string {
  if (!codigo) return 'gris';
  return ESTADOS_SUGERENCIA.find((estado) => estado.codigo === codigo)?.clave ?? 'gris';
}

/** Fechas de la pantalla en `dd/mm/aaaa` (instrucción de producto). */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';
  const dia = valor.slice(0, 10);
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!partes) return '—';
  return `${partes[3]}/${partes[2]}/${partes[1]}`;
}

/** Fecha y hora local en `dd/mm/aaaa hh:mm`. */
export function formatearFechaHora(valor: string | null | undefined): string {
  if (!valor) return '—';
  const fecha = formatearFecha(valor);
  if (fecha === '—') return '—';
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) return fecha;
  const horas = String(instante.getHours()).padStart(2, '0');
  const minutos = String(instante.getMinutes()).padStart(2, '0');
  return `${fecha} ${horas}:${minutos}`;
}

/** Horas decimales a «9 h 40 min»; `null` se declara «sin dato». */
export function formatearDuracionHoras(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return 'sin dato';
  const totalMinutos = Math.round(valor * 60);
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  if (horas === 0) return `${minutos} min`;
  return `${horas} h ${minutos} min`;
}

/** Porcentaje con coma decimal y un decimal, como el resto de la app (es-PE). */
export function formatearPorcentaje(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return 'sin dato';
  return `${valor.toFixed(1).replace('.', ',')} %`;
}

export type Sugerencia = {
  id: string;
  codigo: string;
  /** Fecha de alta en `YYYY-MM-DD`. */
  fecha: string | null;
  creadaEn: string | null;
  entidadTipo: SugerenciaEntidadTipo;
  casoId: string | null;
  casoCodigo: string | null;
  casoTitulo: string | null;
  regionId: number | null;
  region: string | null;
  provinciaId: number | null;
  provincia: string | null;
  distritoId: number | null;
  distrito: string | null;
  territorioTexto: string | null;
  tipoId: number | null;
  tipoCodigo: string | null;
  tipo: string;
  titulo: string;
  detalle: string | null;
  destinatario: string | null;
  unidadId: number | null;
  unidad: string | null;
  prioridadId: number | null;
  prioridad: string | null;
  prioridadOrden: number | null;
  estadoId: number | null;
  estadoCodigo: string | null;
  estado: string;
  estadoCategoria: string | null;
  terminal: boolean;
  responsableUsuarioId: string | null;
  responsableUsuarioNombre: string | null;
  responsableTexto: string | null;
  responsable: string | null;
  sustento: string | null;
  sustentoUri: string | null;
  origen: string | null;
  confianza: number | null;
  decisionNota: string | null;
  motivoRechazo: string | null;
  decididoPor: string | null;
  decididoPorNombre: string | null;
  decididoEn: string | null;
  venceEn: string | null;
  clasificacion: number;
  anuladoEn: string | null;
  motivoAnulacion: string | null;
  /** Código del caso o, en territorio, la ruta regional declarada. */
  entidad: string;
  /** La fecha de vencimiento ya pasó y la fila sigue sin cerrar. */
  vencida: boolean;
};

export type CasoOpcion = {
  id: string;
  codigo: string;
  titulo: string;
  region: string | null;
};

export type SugerenciaCasoRef = {
  id: string;
  codigo: string;
  titulo: string | null;
};

export type SugerenciaDetalle = {
  sugerencia: Sugerencia;
  caso: SugerenciaCasoRef | null;
};

export type SugerenciaResumen = {
  total: number;
  pendientes: number;
  decididas: number;
  aceptadas: number;
  aceptadasConCambios: number;
  rechazadas: number;
  expiradas: number;
  sinDecision: number;
  conSustento: number;
  autoAplicadas: number;
  tasaAceptacion: number | null;
  tiempoMedioHoras: number | null;
};

export type OpcionEstado = {
  codigo: string;
  etiqueta: string;
  categoria: string;
  terminal: boolean;
};

export type OpcionTipo = { codigo: string; etiqueta: string };
export type OpcionPrioridad = { codigo: string; orden: number | null };
export type OpcionUnidad = { siglas: string; nombre: string | null };
export type OpcionResponsable = { id: string; nombre: string; cargo: string | null };
export type OpcionRegion = { id: number; nombre: string };

export type OpcionesSugerencias = {
  estados: OpcionEstado[];
  tipos: OpcionTipo[];
  prioridades: OpcionPrioridad[];
  unidades: OpcionUnidad[];
  responsables: OpcionResponsable[];
};

function registroDe(bruto: unknown): Record<string, unknown> {
  return esRegistro(bruto) ? bruto : {};
}

function listaDe(bruto: unknown, clave: string): Record<string, unknown>[] {
  const registro = registroDe(bruto);
  const crudo = registro[clave];
  if (!Array.isArray(crudo)) return [];
  return crudo.map((item) => registroDe(item));
}

export function aSugerencia(bruto: unknown): Sugerencia {
  const fila = registroDe(bruto);
  const entidadTipoBruta = texto(fila, ['entidadTipo', 'entidad_tipo']);
  const casoCodigo = texto(fila, ['casoCodigo', 'caso_codigo']);

  return {
    id: texto(fila, ['id']) ?? '',
    codigo: texto(fila, ['codigo']) ?? '',
    fecha: texto(fila, ['fecha']),
    creadaEn: texto(fila, ['creadaEn', 'creada_en', 'createdAt']),
    entidadTipo: entidadTipoBruta === 'caso' ? 'caso' : 'territorio',
    casoId: texto(fila, ['casoId', 'caso_id']),
    casoCodigo,
    casoTitulo: texto(fila, ['casoTitulo', 'caso_titulo']),
    regionId: numero(fila, ['regionId', 'region_id']),
    region: texto(fila, ['region']),
    provinciaId: numero(fila, ['provinciaId', 'provincia_id']),
    provincia: texto(fila, ['provincia']),
    distritoId: numero(fila, ['distritoId', 'distrito_id']),
    distrito: texto(fila, ['distrito']),
    territorioTexto: texto(fila, ['territorioTexto', 'territorio_texto']),
    tipoId: numero(fila, ['tipoId', 'tipo_id']),
    tipoCodigo: texto(fila, ['tipoCodigo', 'tipo_codigo']),
    tipo: texto(fila, ['tipo']) ?? 'Sin tipo',
    titulo: texto(fila, ['titulo']) ?? 'Sin título',
    detalle: texto(fila, ['detalle']),
    destinatario: texto(fila, ['destinatario']),
    unidadId: numero(fila, ['unidadId', 'unidad_id']),
    unidad: texto(fila, ['unidad']),
    prioridadId: numero(fila, ['prioridadId', 'prioridad_id']),
    prioridad: texto(fila, ['prioridad']),
    prioridadOrden: numero(fila, ['prioridadOrden', 'prioridad_orden']),
    estadoId: numero(fila, ['estadoId', 'estado_id']),
    estadoCodigo: texto(fila, ['estadoCodigo', 'estado_codigo']),
    estado: texto(fila, ['estado']) ?? 'Sin estado',
    estadoCategoria: texto(fila, ['estadoCategoria', 'estado_categoria']),
    terminal: booleano(fila, ['terminal']),
    responsableUsuarioId: texto(fila, ['responsableUsuarioId', 'responsable_usuario_id']),
    responsableUsuarioNombre: texto(fila, [
      'responsableUsuarioNombre',
      'responsable_usuario_nombre',
    ]),
    responsableTexto: texto(fila, ['responsableTexto', 'responsable_texto']),
    responsable: texto(fila, ['responsable']),
    sustento: texto(fila, ['sustento']),
    sustentoUri: texto(fila, ['sustentoUri', 'sustento_uri']),
    origen: texto(fila, ['origen']),
    confianza: numero(fila, ['confianza']),
    decisionNota: texto(fila, ['decisionNota', 'decision_nota']),
    motivoRechazo: texto(fila, ['motivoRechazo', 'motivo_rechazo']),
    decididoPor: texto(fila, ['decididoPor', 'decidido_por']),
    decididoPorNombre: texto(fila, ['decididoPorNombre', 'decidido_por_nombre']),
    decididoEn: texto(fila, ['decididoEn', 'decidido_en']),
    venceEn: texto(fila, ['venceEn', 'vence_en']),
    clasificacion: numero(fila, ['clasificacion', 'nivelClasificacion']) ?? 2,
    anuladoEn: texto(fila, ['anuladoEn', 'anulado_en']),
    motivoAnulacion: texto(fila, ['motivoAnulacion', 'motivo_anulacion']),
    entidad: texto(fila, ['entidad']) ?? '—',
    vencida: booleano(fila, ['vencida']),
  };
}

export function aSugerenciaDetalle(bruto: unknown): SugerenciaDetalle {
  const registro = registroDe(bruto);
  const casoBruto = registro['caso'];
  const caso = esRegistro(casoBruto)
    ? {
        id: texto(casoBruto, ['id']) ?? '',
        codigo: texto(casoBruto, ['codigo']) ?? '',
        titulo: texto(casoBruto, ['titulo']),
      }
    : null;

  return {
    sugerencia: aSugerencia(registro['sugerencia'] ?? registro),
    caso,
  };
}

export function aCasoOpcion(bruto: unknown): CasoOpcion {
  const fila = registroDe(bruto);
  return {
    id: texto(fila, ['id']) ?? '',
    codigo: texto(fila, ['codigo', 'codigoCaso']) ?? '',
    titulo: texto(fila, ['titulo', 'nombreCaso']) ?? 'Sin título',
    region: texto(fila, ['region']),
  };
}

export function aSugerenciaResumen(bruto: unknown): SugerenciaResumen {
  const fila = registroDe(bruto);
  return {
    total: numero(fila, ['total']) ?? 0,
    pendientes: numero(fila, ['pendientes']) ?? 0,
    decididas: numero(fila, ['decididas']) ?? 0,
    aceptadas: numero(fila, ['aceptadas']) ?? 0,
    aceptadasConCambios: numero(fila, ['aceptadasConCambios', 'aceptadas_con_cambios']) ?? 0,
    rechazadas: numero(fila, ['rechazadas']) ?? 0,
    expiradas: numero(fila, ['expiradas']) ?? 0,
    sinDecision: numero(fila, ['sinDecision', 'sin_decision']) ?? 0,
    conSustento: numero(fila, ['conSustento', 'con_sustento']) ?? 0,
    autoAplicadas: numero(fila, ['autoAplicadas', 'auto_aplicadas']) ?? 0,
    tasaAceptacion: numero(fila, ['tasaAceptacion', 'tasa_aceptacion']),
    tiempoMedioHoras: numero(fila, ['tiempoMedioHoras', 'tiempo_medio_horas']),
  };
}

export function aOpcionesSugerencias(bruto: unknown): OpcionesSugerencias {
  return {
    estados: listaDe(bruto, 'estados').map((fila) => ({
      codigo: texto(fila, ['codigo']) ?? '',
      etiqueta: texto(fila, ['etiqueta']) ?? '',
      categoria: texto(fila, ['categoria']) ?? '',
      terminal: booleano(fila, ['terminal']),
    })),
    tipos: listaDe(bruto, 'tipos').map((fila) => ({
      codigo: texto(fila, ['codigo']) ?? '',
      etiqueta: texto(fila, ['etiqueta']) ?? '',
    })),
    prioridades: listaDe(bruto, 'prioridades').map((fila) => ({
      codigo: texto(fila, ['codigo']) ?? '',
      orden: numero(fila, ['orden']),
    })),
    unidades: listaDe(bruto, 'unidades').map((fila) => ({
      siglas: texto(fila, ['siglas']) ?? '',
      nombre: texto(fila, ['nombre']),
    })),
    responsables: listaDe(bruto, 'responsables').map((fila) => ({
      id: texto(fila, ['id']) ?? '',
      nombre: texto(fila, ['nombre']) ?? '',
      cargo: texto(fila, ['cargo']),
    })),
  };
}

/**
 * Regiones desde `GET /v1/catalogs`. La respuesta envuelve los catálogos en
 * `catalogs`; se acepta también el objeto ya desenvuelto.
 */
export function aRegiones(bruto: unknown): OpcionRegion[] {
  const raiz = registroDe(bruto);
  const contenedor = esRegistro(raiz['catalogs']) ? raiz['catalogs'] : raiz;
  return listaDe(contenedor, 'regiones').map((fila) => ({
    id: numero(fila, ['id']) ?? 0,
    nombre: texto(fila, ['nombre', 'etiqueta', 'codigo']) ?? '',
  }));
}
