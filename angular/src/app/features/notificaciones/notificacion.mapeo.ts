import { normalizarColeccion, type Coleccion } from '../../core/http/coleccion';
import { esRegistro, numero, texto, type Registro } from '../../dominio/mapeo';
import { formatearFechaCompacta, partesFecha } from '../../shared/formato-fecha';

/**
 * `GET /api/v1/notifications` devuelve `{items, total, page, pageSize,
 * noLeidas, generatedAt, pagina, tamanoPagina}`. Cada aviso trae `id`, `tipo`,
 * `entidadTipo`, `entidadId`, `entidadCodigo`, `venceEn`, `estado`, `leidoEn` y
 * `createdAt`, el mismo mapeo que `lib/db/repos/notifications.ts`.
 *
 * `entidadCodigo` sólo llega cuando el aviso apunta a un caso que el usuario
 * puede ver: es el único recurso con ficha por código en la SPA.
 *
 * `estado` es el ciclo de vida (`pendiente` | `enviada` | `leida` según el
 * CHECK de `core.notificaciones`) y `leidoEn` el instante de lectura. Un aviso
 * cuenta como leído si `estado = 'leida'` **o** si `leidoEn` está fijado.
 */
export type Notificacion = {
  id: string;
  /** Código técnico del aviso (`regla_por_vencer`, …). */
  tipo: string;
  /** `tipo` legible, porque el modelo no trae título. */
  titulo: string;
  categoria: string;
  icono: string;
  entidadTipo: string | null;
  entidadId: string | null;
  /** Código del caso cuando el aviso lo permite; si no, `null`. */
  entidadCodigo: string | null;
  venceEn: string | null;
  estado: string | null;
  /** Instante de lectura (`leido_en`); `null` si nunca se leyó. */
  leidoEn: string | null;
  leida: boolean;
  creadaEn: string | null;
  /** Sección relacionada; `null` cuando el recurso no tiene pantalla propia. */
  seccion: { ruta: string; etiqueta: string } | null;
};

/** Enlace de la fila: a la ficha del registro o, si no hay código, a su sección. */
export type EnlaceNotificacion = {
  ruta: string;
  etiqueta: string;
  /** `true` sólo cuando abre la ficha concreta, no la sección. */
  concreta: boolean;
};

type Categoria = {
  pista: string;
  etiqueta: string;
  icono: string;
  seccion: { ruta: string; etiqueta: string };
};

const CATEGORIAS: readonly Categoria[] = [
  {
    pista: 'alerta',
    etiqueta: 'Alerta',
    icono: 'alertas',
    seccion: { ruta: '/alertas', etiqueta: 'Alertas tempranas' },
  },
  {
    pista: 'compromiso',
    etiqueta: 'Compromiso',
    icono: 'compromisos',
    seccion: { ruta: '/compromisos', etiqueta: 'Compromisos' },
  },
  {
    pista: 'documento',
    etiqueta: 'Documento',
    icono: 'documentos',
    seccion: { ruta: '/documentos', etiqueta: 'Documentos' },
  },
  {
    pista: 'caso',
    etiqueta: 'Caso',
    icono: 'casos',
    seccion: { ruta: '/casos', etiqueta: 'Casos' },
  },
];

/** Opciones del filtro de estado de lectura; se sincroniza con la URL. */
export const ESTADOS_NOTIFICACION = [
  { valor: '', etiqueta: 'Todos' },
  { valor: 'pendiente', etiqueta: 'Pendientes' },
  { valor: 'enviada', etiqueta: 'Enviadas' },
  { valor: 'leida', etiqueta: 'Leídas' },
] as const;

export type EstadoFiltroNotificacion = (typeof ESTADOS_NOTIFICACION)[number]['valor'];

const ESTADOS_VALIDOS = new Set(['pendiente', 'enviada', 'leida']);

/** Acepta sólo los estados que el `GET` valida; cualquier otro es «Todos». */
export function esEstadoFiltro(valor: string): boolean {
  return ESTADOS_VALIDOS.has(valor);
}

export function etiquetaEstadoFiltro(valor: string): string {
  return ESTADOS_NOTIFICACION.find((opcion) => opcion.valor === valor)?.etiqueta ?? 'Todos';
}

/** `regla_por_vencer` → `Regla por vencer`; no hay título en el modelo. */
function humanizar(valor: string): string {
  const frase = valor.replace(/_/g, ' ').trim();
  if (!frase) return 'Notificación';
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

function estadoClave(valor: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function etiquetaEstado(valor: string | null): string {
  switch (estadoClave(valor)) {
    case 'leida':
      return 'Leída';
    case 'enviada':
      return 'Enviada';
    case 'pendiente':
      return 'Pendiente';
    default:
      return valor?.trim() ? humanizar(valor) : 'Sin estado';
  }
}

/** `true` si el aviso está leído: `estado = 'leida'` o `leidoEn` fijado. */
export function esLeida(valor: string | boolean | null, leidoEn: string | null = null): boolean {
  if (typeof valor === 'boolean') return valor;
  return estadoClave(valor) === 'leida' || leidoEn !== null;
}

/** Estado de lectura visible; acepta el estado, el booleano ya resuelto o ambos. */
export function etiquetaLectura(
  valor: string | boolean | null,
  leidoEn: string | null = null,
): string {
  return esLeida(valor, leidoEn) ? 'Leída' : 'Sin leer';
}

export function claseLectura(
  valor: string | boolean | null,
  leidoEn: string | null = null,
): string {
  return esLeida(valor, leidoEn) ? 'state-approved' : 'state-pending';
}

/** Estado que se envía al `PATCH` para marcar o deshacer. */
export function estadoDeMarcado(leida: boolean): 'leida' | 'pendiente' {
  return leida ? 'leida' : 'pendiente';
}

/** Un elemento de `items[]`. */
export function aNotificacion(bruto: unknown): Notificacion {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const tipo = texto(registro, ['tipo']) ?? '';
  const entidadTipo = texto(registro, ['entidadTipo', 'entidad_tipo']);
  const pista = `${entidadTipo ?? ''} ${tipo}`.toLowerCase();
  const categoria = CATEGORIAS.find((opcion) => pista.includes(opcion.pista)) ?? null;
  const estado = texto(registro, ['estado']);
  const leidoEn = texto(registro, ['leidoEn', 'leido_en']);

  return {
    id: texto(registro, ['id']) ?? '',
    tipo,
    titulo: humanizar(tipo),
    categoria: categoria?.etiqueta ?? 'Sistema',
    icono: categoria?.icono ?? 'campana',
    entidadTipo,
    entidadId: texto(registro, ['entidadId', 'entidad_id']),
    entidadCodigo: texto(registro, ['entidadCodigo', 'entidad_codigo']),
    venceEn: texto(registro, ['venceEn', 'vence_en']),
    estado,
    leidoEn,
    leida: estadoClave(estado) === 'leida' || leidoEn !== null,
    creadaEn: texto(registro, ['createdAt', 'created_at']),
    seccion: categoria ? categoria.seccion : null,
  };
}

/**
 * Enlace de la fila.
 *
 * Sólo el caso tiene ficha por código (`/casos/{código}`) y la API entrega ese
 * código en `entidadCodigo` cuando el usuario puede ver el caso. Sin código no
 * se inventa una ruta: se abre la sección del recurso y la vista lo declara.
 */
export function enlaceNotificacion(notificacion: Notificacion): EnlaceNotificacion | null {
  const entidad = estadoClave(notificacion.entidadTipo);
  const codigo = notificacion.entidadCodigo?.trim();

  if ((entidad === 'caso' || entidad === 'casos') && codigo) {
    return {
      ruta: `/casos/${encodeURIComponent(codigo)}`,
      etiqueta: `Caso ${codigo}`,
      concreta: true,
    };
  }

  return notificacion.seccion ? { ...notificacion.seccion, concreta: false } : null;
}

/** `YYYY-MM-DD` (o ISO completo) → `02NOV2025`, sin depender del locale. */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';
  return partesFecha(valor) ? formatearFechaCompacta(valor) : valor;
}

/** Sobre del listado: la colección paginada más el contador de la bandeja. */
export type ColeccionNotificaciones = Coleccion<Notificacion> & {
  /** Avisos sin leer con el alcance de la sesión, sin el filtro de la lista. */
  noLeidas: number;
};

/**
 * Normaliza el sobre de `GET /api/v1/notifications`.
 *
 * `noLeidas` es un total del servidor: no se deduce de las filas visibles. Si
 * la clave falta (respuesta antigua), se declara `0` en vez de inventar un
 * conteo a partir de la página.
 */
export function aColeccionNotificaciones(bruto: unknown): ColeccionNotificaciones {
  const base = normalizarColeccion<unknown>(bruto);
  const registro: Registro = esRegistro(bruto) ? bruto : {};

  return {
    ...base,
    elementos: base.elementos.map(aNotificacion),
    noLeidas: numero(registro, ['noLeidas', 'no_leidas']) ?? 0,
  };
}

/** Día del listado agrupado; conserva el orden descendente del servidor. */
export type GrupoDia = {
  /** `YYYY-MM-DD`, o `sin-fecha` cuando el aviso no trae `created_at`. */
  clave: string;
  /** Rótulo `DD/MM/YYYY`. */
  etiqueta: string;
  notificaciones: Notificacion[];
};

/**
 * Agrupa por día de registro respetando el orden recibido (más recientes
 * primero). No reordena: la lista ya viene del servidor y puede venir ordenada
 * localmente por la tabla.
 */
export function agruparPorDia(notificaciones: readonly Notificacion[]): GrupoDia[] {
  const grupos = new Map<string, Notificacion[]>();

  for (const notificacion of notificaciones) {
    const clave = (notificacion.creadaEn ?? '').slice(0, 10) || 'sin-fecha';
    const actual = grupos.get(clave);
    if (actual) {
      actual.push(notificacion);
    } else {
      grupos.set(clave, [notificacion]);
    }
  }

  return [...grupos].map(([clave, filas]) => ({
    clave,
    etiqueta: clave === 'sin-fecha' ? 'Sin fecha' : formatearFecha(clave),
    notificaciones: filas,
  }));
}

/** Rótulo del contador de no leídas; «…» mientras la primera lectura no llega. */
export function etiquetaNoLeidas(noLeidas: number | null): string {
  if (noLeidas === null) return '… sin leer';
  return `${noLeidas} sin leer`;
}
