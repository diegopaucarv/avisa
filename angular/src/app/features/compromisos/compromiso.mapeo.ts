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
  type CompromisoCaso,
  type HitoCompromisoCaso,
  type Registro,
} from '../../dominio/mapeo';

export type EstadoCompromiso =
  | 'Por iniciar'
  | 'En proceso'
  | 'Cumplido'
  | 'Redefinido'
  | 'Desestimado';

export type EstadoHito =
  | 'Registrado'
  | 'En ejecución'
  | 'Paralizado'
  | 'Cumplido'
  | 'Desestimado'
  | 'No cumplido';

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
  'No cumplido',
] as const satisfies readonly EstadoHito[];

export const TIPOS_COMPROMISO = ['Actividad', 'PIP'] as const satisfies readonly TipoCompromiso[];

/** Item 16: el compromiso puede ser progresivo y parcial, operativo o condicionado. */
export type ClasificacionAlcance =
  | 'progresivo_parcial'
  | 'entendimiento_operativo'
  | 'condicionado';

export type FormalVerbal = 'formal' | 'verbal';

export const CLASIFICACIONES_ALCANCE = [
  { valor: 'progresivo_parcial', etiqueta: 'Progresivo y parcial' },
  { valor: 'entendimiento_operativo', etiqueta: 'Entendimiento operativo' },
  { valor: 'condicionado', etiqueta: 'Condicionado' },
] as const satisfies readonly { valor: ClasificacionAlcance; etiqueta: string }[];

export const FORMAS_VERBALES = [
  { valor: 'formal', etiqueta: 'Formal' },
  { valor: 'verbal', etiqueta: 'Verbal' },
] as const satisfies readonly { valor: FormalVerbal; etiqueta: string }[];

export const ETIQUETA_ASUMIDO_MINISTRO = 'Asumido por el Señor Ministro';

/** Valor que la UI muestra cuando el dato no fue declarado. */
export const ETIQUETA_SIN_DECLARAR = 'Sin declarar';

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
  /** Nombre del responsable escrito en el origen, sin usuario resuelto. */
  responsableTexto: string | null;
  responsableUsuarioId: string | null;
  /** Fecha sin tipar (`No aplica`, `Julio 2026`); convive con `fecha` nula. */
  fechaTexto: string | null;
  fechaRealTexto: string | null;
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
  /** Demanda que atiende el compromiso; `null` cuando no se vinculó ninguna. */
  demandaId: string | null;
  demandaCodigo: string | null;
  demandaTexto: string | null;
  tipo: TipoCompromiso;
  clasificacionAlcance: ClasificacionAlcance | null;
  formalVerbal: FormalVerbal | null;
  asumidoMinistro: boolean;
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
  /** Usuario del punto focal cuando la API lo resuelve a una cuenta. */
  puntoFocalUsuarioId: string | null;
  /** Nombre declarado sin cuenta asociada; convive con `puntoFocalUsuarioId` nulo. */
  puntoFocalTexto: string | null;
  /** Nombre resuelto por el servidor o, si no lo hay, el texto libre. */
  puntoFocal: string | null;
  evidenciaUri: string | null;
  criteriosSmart: unknown;
  documentoOrigenId: string | null;
  origen: string | null;
  confianza: number | null;
  validado: boolean;
  /** ISO de la anulación lógica; `null` mientras el registro está activo. */
  anuladoEn: string | null;
  /** Motivo declarado al anular; sólo se puebla en la papelera. */
  motivoAnulacion: string | null;
  /** Usuario que anuló (id); sólo se puebla en la papelera. */
  anuladoPor: string | null;
  /** Nombre legible de quien anuló; `null` si no se puede resolver. */
  anuladoPorNombre: string | null;
  /** Lote de anulación al que pertenece la fila. */
  anulacionId: string | null;
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
  /**
   * Reunión de la que nace el compromiso. La API todavía no la envía, pero se
   * lee por si llega: la versión ampliada la usa como segunda fuente.
   */
  reunion: DocumentoCompromiso | null;
};

/** Documento o reunión del que nace el compromiso (fuente de la versión ampliada). */
export type FuenteCompromiso = DocumentoCompromiso;

export type OpcionCatalogo = {
  valor: string;
  etiqueta: string;
};

export type CatalogosCompromiso = {
  unidades: OpcionCatalogo[];
  tematicas: OpcionCatalogo[];
  alcances: OpcionCatalogo[];
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

export function clasificacionAlcanceDe(valor: string | null): ClasificacionAlcance | null {
  const clave = normalizarClave(valor);
  const opcion = CLASIFICACIONES_ALCANCE.find(
    (candidata) =>
      normalizarClave(candidata.valor) === clave || normalizarClave(candidata.etiqueta) === clave,
  );
  return opcion?.valor ?? null;
}

export function formalVerbalDe(valor: string | null): FormalVerbal | null {
  const clave = normalizarClave(valor);
  const opcion = FORMAS_VERBALES.find(
    (candidata) =>
      normalizarClave(candidata.valor) === clave || normalizarClave(candidata.etiqueta) === clave,
  );
  return opcion?.valor ?? null;
}

/** Etiqueta visible de la clasificación de alcance; sin dato, «Sin declarar». */
export function etiquetaClasificacionAlcance(valor: string | null | undefined): string {
  const clasificacion = clasificacionAlcanceDe(valor ?? null);
  const opcion = CLASIFICACIONES_ALCANCE.find((candidata) => candidata.valor === clasificacion);
  return opcion?.etiqueta ?? ETIQUETA_SIN_DECLARAR;
}

/** Etiqueta visible del carácter formal o verbal; sin dato, «Sin declarar». */
export function etiquetaFormalVerbal(valor: string | null | undefined): string {
  const forma = formalVerbalDe(valor ?? null);
  const opcion = FORMAS_VERBALES.find((candidata) => candidata.valor === forma);
  return opcion?.etiqueta ?? ETIQUETA_SIN_DECLARAR;
}

function atributosCompromisoDe(
  registro: Registro,
): Pick<Compromiso, 'clasificacionAlcance' | 'formalVerbal' | 'asumidoMinistro'> {
  return {
    clasificacionAlcance: clasificacionAlcanceDe(
      texto(registro, ['clasificacionAlcance', 'clasificacion_alcance']),
    ),
    formalVerbal: formalVerbalDe(texto(registro, ['formalVerbal', 'formal_verbal'])),
    asumidoMinistro: booleano(registro, ['asumidoMinistro', 'asumido_ministro']),
  };
}

type AtributosHito = Pick<
  Hito,
  'responsableTexto' | 'responsableUsuarioId' | 'fechaTexto' | 'fechaRealTexto'
>;

function atributosHitoDe(registro: Registro): AtributosHito {
  return {
    responsableTexto: texto(registro, ['responsableTexto', 'responsable_texto']),
    responsableUsuarioId: texto(registro, ['responsableUsuarioId', 'responsable_usuario_id']),
    fechaTexto: texto(registro, ['fechaTexto', 'fecha_texto']),
    fechaRealTexto: texto(registro, ['fechaRealTexto', 'fecha_real_texto']),
  };
}

function nivelGobiernoDe(valor: string | null): string | null {
  if (!valor) return null;
  const limpio = valor.replace(/_/g, ' ').trim();
  return limpio || null;
}

/**
 * Etiqueta visible de `nivelGobierno`. El valor de la API sigue siendo
 * `Regional`; la UI muestra `GORE` (Gobierno Regional). También se cubre la
 * grafía larga (`Gobierno regional`) por si llega de un registro legado.
 */
export function etiquetaNivelGobierno(valor: string | null): string {
  if (!valor) return '—';
  return valor === 'Regional' || valor === 'Gobierno regional' ? 'GORE' : valor;
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
    ...atributosHitoDe(registro),
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
    demandaId: texto(registro, ['demandaId', 'demanda_id']),
    demandaCodigo: texto(registro, ['demandaCodigo', 'demanda_codigo']),
    demandaTexto: texto(registro, ['demandaTexto', 'demanda_texto']),
    tipo: tipoDe(texto(registro, ['tipo'])),
    ...atributosCompromisoDe(registro),
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
    puntoFocalUsuarioId: texto(registro, ['puntoFocalUsuarioId', 'punto_focal_usuario_id']),
    puntoFocalTexto: texto(registro, ['puntoFocalTexto', 'punto_focal_texto']),
    puntoFocal: texto(registro, ['puntoFocal', 'punto_focal']),
    evidenciaUri: texto(registro, ['evidenciaUri', 'evidencia_uri']),
    criteriosSmart: leer(registro, ['criteriosSmart', 'criterios_smart']) ?? null,
    documentoOrigenId: texto(registro, ['documentoOrigenId', 'documento_origen_id']),
    origen: texto(registro, ['origen']),
    confianza: numero(registro, ['confianza']),
    validado: booleano(registro, ['validado']),
    anuladoEn: texto(registro, ['anuladoEn', 'anulado_en']),
    motivoAnulacion: texto(registro, ['motivoAnulacion', 'motivo_anulacion']),
    anuladoPor: texto(registro, ['anuladoPor', 'anulado_por']),
    anuladoPorNombre: texto(registro, ['anuladoPorNombre', 'anulado_por_nombre']),
    anulacionId: texto(registro, ['anulacionId', 'anulacion_id']),
    clasificacion: numero(registro, ['clasificacion']) ?? 1,
    hitos: lista(registro, ['hitos']).map(aHito),
    proximoHito: aProximoHito(leer(registro, ['proximoHito', 'proximo_hito'])),
    vencido: booleano(registro, ['vencido']),
  };
}

/**
 * Texto visible de la demanda vinculada: código y texto si llegan ambos, o el
 * que exista. Sin vínculo no se estima nada: se declara «Sin demanda».
 */
export function etiquetaDemandaVinculada(
  compromiso: Pick<Compromiso, 'demandaCodigo' | 'demandaTexto'>,
): string {
  const codigo = compromiso.demandaCodigo;
  const textoDemanda = compromiso.demandaTexto;
  if (codigo && textoDemanda) return `${codigo} · ${textoDemanda}`;
  return codigo ?? textoDemanda ?? 'Sin demanda';
}

/**
 * Nombre visible del punto focal: el resuelto por el servidor manda; después el
 * texto libre. Sin ninguno de los dos se declara «Sin punto focal».
 */
export function etiquetaPuntoFocal(
  compromiso: Pick<Compromiso, 'puntoFocal' | 'puntoFocalTexto'>,
): string {
  return compromiso.puntoFocal ?? compromiso.puntoFocalTexto ?? 'Sin punto focal';
}

/**
 * Fuente del compromiso: primero el documento de origen y, si no hay, la
 * reunión. Sin ninguna de las dos se devuelve `null` (la UI muestra «—»).
 */
export function fuenteDe(
  documento: FuenteCompromiso | null,
  reunion: FuenteCompromiso | null,
): FuenteCompromiso | null {
  if (documento && (documento.codigo || documento.titulo)) return documento;
  if (reunion && (reunion.codigo || reunion.titulo)) return reunion;
  return null;
}

/**
 * Texto visible de la fuente: código y título si llegan ambos, o el que exista.
 * Sin dato se declara «—»: no se inventa la fuente.
 */
export function etiquetaFuente(fuente: FuenteCompromiso | null | undefined): string {
  const codigo = fuente?.codigo;
  const titulo = fuente?.titulo;
  if (codigo && titulo) return `${codigo} · ${titulo}`;
  return codigo ?? titulo ?? '—';
}

/** Estado de cumplimiento legible que ofrece la versión ampliada. */
export type EstadoCumplimiento = 'Cumplido' | 'No cumplido' | 'En proceso' | 'Por iniciar';

/**
 * Regla de derivación del estado de cumplimiento (sólo con datos que la API ya
 * devuelve):
 *   · `Cumplido` cuando el estado registrado es `Cumplido`.
 *   · `No cumplido` cuando el estado es terminal y distinto de `Cumplido`
 *     (`Redefinido`, `Desestimado`) o cuando todos los hitos del compromiso
 *     están en `No cumplido`.
 *   · `Por iniciar` cuando el estado registrado es ese; en cualquier otro caso,
 *     `En proceso`.
 */
export function estadoCumplimientoDe(
  compromiso: Pick<Compromiso, 'estado' | 'terminal' | 'hitos'>,
): EstadoCumplimiento {
  if (compromiso.estado === 'Cumplido') return 'Cumplido';

  const terminal =
    compromiso.terminal ||
    compromiso.estado === 'Redefinido' ||
    compromiso.estado === 'Desestimado';
  if (terminal) return 'No cumplido';

  const hitos = compromiso.hitos;
  if (hitos.length > 0 && hitos.every((hito) => hito.estado === 'No cumplido')) {
    return 'No cumplido';
  }

  return compromiso.estado === 'Por iniciar' ? 'Por iniciar' : 'En proceso';
}

/** Usuario sugerido para el punto focal, tal como lo entrega el directorio. */
export type SugerenciaUsuario = { id: string; nombre: string };

/**
 * Fila del directorio de usuarios reducida a lo que necesita el sugeridor.
 * Devuelve `null` cuando falta el id o el nombre: no se inventan cuentas.
 */
export function aSugerenciaUsuario(bruto: unknown): SugerenciaUsuario | null {
  const registro = esRegistro(bruto) ? bruto : {};
  const id = texto(registro, ['id', 'usuarioId', 'usuario_id']);
  const nombre = texto(registro, ['nombre', 'name']);
  return id && nombre ? { id, nombre } : null;
}

/** `GET /api/v1/commitments/:id` envuelve compromiso, caso y documento. */
export function aDetalleCompromiso(bruto: unknown): DetalleCompromiso {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudoCaso = leer(registro, ['caso']);
  const crudoDocumento = leer(registro, ['documentoOrigen', 'documento_origen']);
  // La API aún no devuelve la reunión; se acepta por si el detalle la agrega.
  const crudoReunion = leer(registro, ['reunion', 'reunión']);

  const caso = esRegistro(crudoCaso) ? crudoCaso : null;
  const documento = esRegistro(crudoDocumento) ? crudoDocumento : null;
  const reunion = esRegistro(crudoReunion) ? crudoReunion : null;

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
    reunion: reunion
      ? {
          codigo: texto(reunion, ['codigo', 'code', 'codigoReunion', 'codigo_reunion']),
          titulo: texto(reunion, ['titulo', 'title']),
          fecha: texto(reunion, ['fecha']),
        }
      : null,
  };
}

/** Hito del detalle del caso con las columnas nuevas (responsable y fechas en texto). */
export type HitoCasoConResponsable = HitoCompromisoCaso & AtributosHito;

/** Compromiso del detalle del caso con su clasificación, carácter y bandera. */
export type CompromisoCasoConCaracteristicas = Omit<CompromisoCaso, 'hitos'> & {
  clasificacionAlcance: ClasificacionAlcance | null;
  formalVerbal: FormalVerbal | null;
  asumidoMinistro: boolean;
  hitos: HitoCasoConResponsable[];
};

function registroDe(valor: unknown): Registro {
  return esRegistro(valor) ? valor : {};
}

function idDe(valor: unknown): string | null {
  return texto(registroDe(valor), ['id']);
}

function atributosHitoCrudo(valor: unknown): AtributosHito {
  return atributosHitoDe(registroDe(valor));
}

/**
 * `GET /api/v1/cases/{codigo}` ya mapea los compromisos y sus hitos, pero
 * `dominio/mapeo.ts` descarta las columnas nuevas. Se vuelven a leer del bruto
 * para no tocar el mapeo compartido ni duplicar el panel de compromisos.
 */
export function aCompromisosCaso(
  bruto: unknown,
  compromisos: CompromisoCaso[],
): CompromisoCasoConCaracteristicas[] {
  const registro = registroDe(bruto);
  const crudos = lista(registro, ['compromisos', 'commitments']);

  return compromisos.map((compromiso, indice) => {
    // El id manda; el índice sólo cubre una respuesta sin identificadores.
    const porId = compromiso.id
      ? crudos.find((candidato) => idDe(candidato) === compromiso.id)
      : undefined;
    const fila = registroDe(porId ?? crudos[indice]);
    const hitosCrudos = lista(fila, ['hitos']);

    return {
      ...compromiso,
      ...atributosCompromisoDe(fila),
      hitos: compromiso.hitos.map((hito, posicion) => {
        const hitoPorId = hito.id
          ? hitosCrudos.find((candidato) => idDe(candidato) === hito.id)
          : undefined;
        const atributos = atributosHitoCrudo(hitoPorId ?? hitosCrudos[posicion]);
        return { ...hito, ...atributos };
      }),
    };
  });
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
    alcances: aOpciones(leer(catalogo, ['alcances'])),
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
  if (compromiso.vencido) return { etiqueta: 'Vencido', clase: 'due-vencido' };

  const dias = diasHasta(fecha, hoy);
  if (dias !== null && dias >= 0 && dias <= 30) {
    return { etiqueta: 'Por vencer', clase: 'due-por-vencer' };
  }
  return { etiqueta: 'En plazo', clase: 'due-en-plazo' };
}

/* ------------------------------------------------------------------ */
/* Historia: eventos, hitos y adjuntos de un compromiso                */
/* ------------------------------------------------------------------ */

/** Evento de `core.compromiso_evento` tal como lo devuelve el historial. */
export type EventoCompromiso = {
  id: string;
  tipo: string;
  /** Cuerpo libre; se muestra sólo el texto declarado en `detalle.texto`. */
  detalle: unknown;
  autor: string | null;
  usuarioId: string | null;
  createdAt: string | null;
};

/** Hito dentro de la línea de tiempo, con el conteo de adjuntos vigentes. */
export type HitoHistorial = {
  id: string;
  codigo: string | null;
  descripcion: string | null;
  fecha: string | null;
  fechaReal: string | null;
  estado: EstadoHito;
  terminal: boolean;
  responsableTexto: string | null;
  adjuntos: number;
};

/** Adjunto vigente del compromiso o de uno de sus hitos. */
export type AdjuntoHistorial = {
  id: string;
  entidadTipo: 'compromiso' | 'hito';
  entidadId: string;
  nombre: string;
  mime: string | null;
  tamanoBytes: number | null;
  descripcion: string | null;
  subidoPor: string | null;
  createdAt: string | null;
  /** Código del hito cuando el adjunto cuelga de uno. */
  hitoCodigo: string | null;
};

export type TipoItemHistorial = 'evento' | 'hito' | 'adjunto';

/**
 * Ítem de la línea de tiempo. Los campos son opcionales a propósito: la
 * plantilla discrimina por `tipo` y lee `evento`, `hito` o `adjunto` bajo `@if`.
 */
export type ItemHistorial = {
  tipo: TipoItemHistorial;
  id: string;
  fecha: string | null;
  evento?: EventoCompromiso;
  hito?: HitoHistorial;
  adjunto?: AdjuntoHistorial;
};

export type HistorialCompromiso = {
  compromisoId: string;
  codigo: string | null;
  eventos: EventoCompromiso[];
  hitos: HitoHistorial[];
  adjuntos: AdjuntoHistorial[];
  linea: ItemHistorial[];
};

function tipoItemHistorial(valor: string | null): TipoItemHistorial | null {
  if (valor === 'evento' || valor === 'hito' || valor === 'adjunto') return valor;
  return null;
}

function aEventoCompromiso(bruto: unknown): EventoCompromiso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    tipo: texto(registro, ['tipo']) ?? 'evento',
    detalle: leer(registro, ['detalle']) ?? null,
    autor: texto(registro, ['autor']),
    usuarioId: texto(registro, ['usuarioId', 'usuario_id']),
    createdAt: texto(registro, ['createdAt', 'created_at']),
  };
}

function aHitoHistorial(bruto: unknown): HitoHistorial {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    id: texto(registro, ['id']) ?? '',
    codigo: texto(registro, ['codigo']),
    descripcion: texto(registro, ['descripcion']),
    fecha: texto(registro, ['fecha']),
    fechaReal: texto(registro, ['fechaReal', 'fecha_real']),
    estado: estadoHitoDe(texto(registro, ['estado'])),
    terminal: booleano(registro, ['terminal']),
    responsableTexto: texto(registro, ['responsableTexto', 'responsable_texto']),
    adjuntos: numero(registro, ['adjuntos']) ?? 0,
  };
}

function aAdjuntoHistorial(bruto: unknown): AdjuntoHistorial {
  const registro = esRegistro(bruto) ? bruto : {};
  const entidadTipo = texto(registro, ['entidadTipo', 'entidad_tipo']);
  return {
    id: texto(registro, ['id']) ?? '',
    entidadTipo: entidadTipo === 'hito' ? 'hito' : 'compromiso',
    entidadId: texto(registro, ['entidadId', 'entidad_id']) ?? '',
    nombre: texto(registro, ['nombre']) ?? 'Sin nombre',
    mime: texto(registro, ['mime']),
    tamanoBytes: numero(registro, ['tamanoBytes', 'tamano_bytes']),
    descripcion: texto(registro, ['descripcion']),
    subidoPor: texto(registro, ['subidoPor', 'subido_por']),
    createdAt: texto(registro, ['createdAt', 'created_at']),
    hitoCodigo: texto(registro, ['hitoCodigo', 'hito_codigo']),
  };
}

function aItemHistorial(bruto: unknown): ItemHistorial | null {
  const registro = esRegistro(bruto) ? bruto : {};
  const tipo = tipoItemHistorial(texto(registro, ['tipo']));
  const id = texto(registro, ['id']);
  if (!tipo || !id) return null;

  const item: ItemHistorial = {
    tipo,
    id,
    fecha: texto(registro, ['fecha']),
  };

  const evento = leer(registro, ['evento']);
  const hito = leer(registro, ['hito']);
  const adjunto = leer(registro, ['adjunto']);
  if (tipo === 'evento' && esRegistro(evento)) item.evento = aEventoCompromiso(evento);
  if (tipo === 'hito' && esRegistro(hito)) item.hito = aHitoHistorial(hito);
  if (tipo === 'adjunto' && esRegistro(adjunto)) item.adjunto = aAdjuntoHistorial(adjunto);

  return item;
}

/** `GET /api/v1/commitments/{id}/historial`, defensivo ante campos ausentes. */
export function aHistorialCompromiso(bruto: unknown): HistorialCompromiso {
  const registro = esRegistro(bruto) ? bruto : {};
  return {
    compromisoId: texto(registro, ['compromisoId', 'compromiso_id']) ?? '',
    codigo: texto(registro, ['codigo']),
    eventos: lista(registro, ['eventos']).map(aEventoCompromiso),
    hitos: lista(registro, ['hitos']).map(aHitoHistorial),
    adjuntos: lista(registro, ['adjuntos']).map(aAdjuntoHistorial),
    linea: lista(registro, ['linea'])
      .map(aItemHistorial)
      .filter((item): item is ItemHistorial => item !== null),
  };
}

/**
 * `YYYY-MM-DD` → `02NOV2025` y anulación como timestamp. Se movieron a
 * `shared/formato-fecha.ts` y se reexportan para no romper los imports que ya
 * apuntaban a este mapeo.
 */
export { formatearFecha, formatearFechaHora } from '../../shared/formato-fecha';
