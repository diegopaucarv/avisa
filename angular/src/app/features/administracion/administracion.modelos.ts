import {
  esRegistro,
  lista,
  leer,
  numero,
  texto,
  type Registro,
} from '../../dominio/mapeo';

/**
 * Modelos y mapeo de la pantalla de Administración.
 *
 * El formato de fecha es `dd/mm/aaaa`, como pide el encargo. No se reutiliza
 * `shared/formato-fecha.ts` porque ese formateador pinta el formato compacto
 * (`02NOV2025`) del resto de la aplicación: aquí se necesita el día con barras
 * para leer «último acceso» y la bitácora de migraciones. Es una diferencia
 * deliberada y local a esta pantalla.
 */

export const ROL_ADMINISTRADOR = 'administrador';

/** Etiquetas legibles de `core.roles.codigo` (sólo los diez códigos reales). */
export const ETIQUETAS_ROL: Record<string, string> = {
  administrador: 'Administrador',
  direccion_oaipcs: 'Dirección OAIPCS',
  alta_direccion: 'Alta Dirección',
  sectorista: 'Sectorista',
  servicio_agente: 'Servicio de agente',
  analista_cualitativo: 'Analista cualitativo',
  curador_politica: 'Curador de política',
  auditor: 'Auditor',
  consulta_lectura: 'Consulta',
  externo_publico: 'Externo',
};

export function etiquetaRol(codigo: string | null | undefined): string {
  if (!codigo) return 'Sin rol';
  return ETIQUETAS_ROL[codigo] ?? codigo;
}

/* ── Fechas y tamaños ─────────────────────────────────────────────────────── */

function dos(valor: number): string {
  return String(valor).padStart(2, '0');
}

const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

/** Día literal de una fecha o marca ISO, sin desplazarla por zona horaria. */
export function fechaDdMmAaaa(valor: string | null | undefined): string {
  if (!valor) return '—';
  const coincidencia = DIA_ISO.exec(valor);
  if (coincidencia) {
    return `${coincidencia[3]}/${coincidencia[2]}/${coincidencia[1]}`;
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}

/** Marca temporal en hora local (`dd/mm/aaaa hh:mm`). */
export function fechaHoraDdMmAaaa(valor: string | null | undefined): string {
  if (!valor) return '—';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '—';
  return (
    `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()}` +
    ` ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
  );
}

export function tamanoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  const textoMb = Number.isInteger(mb) ? String(mb) : mb.toFixed(1).replace('.', ',');
  return `${textoMb} MB`;
}

/** Representación de un valor `jsonb` para la tabla de configuración. */
export function valorJson(valor: unknown): string {
  if (valor === undefined) return '—';
  if (typeof valor === 'string') return JSON.stringify(valor);
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

/* ── Utilidades de formulario ─────────────────────────────────────────────── */

export function campoTexto(evento: Event): string {
  const elemento = evento.target as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  return elemento?.value ?? '';
}

export function campoMarcado(evento: Event): boolean {
  return (evento.target as HTMLInputElement | null)?.checked === true;
}

/* ── Resumen (tarjetas) ───────────────────────────────────────────────────── */

export type ResumenAdmin = {
  usuarios: { total: number; activos: number };
  roles: { total: number };
  listaBlanca: { total: number; activos: number };
  configuracion: { total: number };
  migraciones: { total: number; ultima: string | null };
  rolRequerido: string;
};

function sub(registro: Registro, clave: string): Registro {
  return esRegistro(registro[clave]) ? (registro[clave] as Registro) : {};
}

export function aResumenAdmin(bruto: unknown): ResumenAdmin {
  const r = esRegistro(bruto) ? bruto : {};
  const usuarios = sub(r, 'usuarios');
  const roles = sub(r, 'roles');
  const listaBlanca = sub(r, 'listaBlanca');
  const configuracion = sub(r, 'configuracion');
  const migraciones = sub(r, 'migraciones');
  return {
    usuarios: {
      total: numero(usuarios, ['total']) ?? 0,
      activos: numero(usuarios, ['activos']) ?? 0,
    },
    roles: { total: numero(roles, ['total']) ?? 0 },
    listaBlanca: {
      total: numero(listaBlanca, ['total']) ?? 0,
      activos: numero(listaBlanca, ['activos']) ?? 0,
    },
    configuracion: { total: numero(configuracion, ['total']) ?? 0 },
    migraciones: {
      total: numero(migraciones, ['total']) ?? 0,
      ultima: texto(migraciones, ['ultima']),
    },
    rolRequerido: texto(r, ['rolRequerido']) ?? ROL_ADMINISTRADOR,
  };
}

/* ── Usuarios ─────────────────────────────────────────────────────────────── */

export type UsuarioAdmin = {
  id: string;
  nombre: string;
  dni: string | null;
  email: string | null;
  cargo: string | null;
  activo: boolean;
  tieneClave: boolean;
  roles: string[];
  rolPrincipal: string | null;
  ultimoAcceso: string | null;
  creadoEn: string | null;
};

export type RolDisponible = {
  codigo: string;
  maxClasificacion: number;
};

export function aUsuarioAdmin(bruto: unknown): UsuarioAdmin {
  const r = esRegistro(bruto) ? bruto : {};
  const roles = lista(r, ['roles']).filter(
    (valor): valor is string => typeof valor === 'string',
  );
  return {
    id: texto(r, ['id']) ?? '',
    nombre: texto(r, ['nombre']) ?? 'Sin nombre',
    dni: texto(r, ['dni']),
    email: texto(r, ['email']),
    cargo: texto(r, ['cargo']),
    activo: r['activo'] === true,
    tieneClave: r['tieneClave'] === true,
    roles,
    rolPrincipal: texto(r, ['rolPrincipal']),
    ultimoAcceso: texto(r, ['ultimoAcceso']),
    creadoEn: texto(r, ['creadoEn']),
  };
}

export function aRolDisponible(bruto: unknown): RolDisponible {
  const r = esRegistro(bruto) ? bruto : {};
  return {
    codigo: texto(r, ['codigo']) ?? '',
    maxClasificacion: numero(r, ['maxClasificacion']) ?? 1,
  };
}

/* ── Catálogos ────────────────────────────────────────────────────────────── */

export type ValorCatalogo = {
  id: number;
  etiqueta: string;
  codigo: string | null;
  orden: number | null;
  activo: boolean | null;
  uso: number;
  maxClasificacion: number | null;
  puedeCrear: boolean | null;
  puedeEditar: boolean | null;
  puedeEliminar: boolean | null;
};

export type CatalogoAdmin = {
  codigo: string;
  etiqueta: string;
  descripcion: string;
  editable: boolean;
  motivoSoloLectura: string | null;
  permiteEliminar: boolean;
  campos: string[];
  totalUso: number;
  valores: ValorCatalogo[];
};

function booleanoONulo(registro: Registro, clave: string): boolean | null {
  const valor = leer(registro, [clave]);
  return typeof valor === 'boolean' ? valor : null;
}

export function aValorCatalogo(bruto: unknown): ValorCatalogo {
  const r = esRegistro(bruto) ? bruto : {};
  return {
    id: numero(r, ['id']) ?? 0,
    etiqueta: texto(r, ['etiqueta']) ?? '—',
    codigo: texto(r, ['codigo']),
    orden: numero(r, ['orden']),
    activo: booleanoONulo(r, 'activo'),
    uso: numero(r, ['uso']) ?? 0,
    maxClasificacion: numero(r, ['maxClasificacion']),
    puedeCrear: booleanoONulo(r, 'puedeCrear'),
    puedeEditar: booleanoONulo(r, 'puedeEditar'),
    puedeEliminar: booleanoONulo(r, 'puedeEliminar'),
  };
}

export function aCatalogoAdmin(bruto: unknown): CatalogoAdmin {
  const r = esRegistro(bruto) ? bruto : {};
  const campos = lista(r, ['campos']).filter(
    (valor): valor is string => typeof valor === 'string',
  );
  return {
    codigo: texto(r, ['codigo']) ?? '',
    etiqueta: texto(r, ['etiqueta']) ?? 'Catálogo',
    descripcion: texto(r, ['descripcion']) ?? '',
    editable: r['editable'] === true,
    motivoSoloLectura: texto(r, ['motivoSoloLectura']),
    permiteEliminar: r['permiteEliminar'] === true,
    campos,
    totalUso: numero(r, ['totalUso']) ?? 0,
    valores: lista(r, ['valores']).map(aValorCatalogo),
  };
}

/** «Crear · Editar · Eliminar» o «Sólo lectura» para la columna de roles. */
export function capacidadesTexto(valor: ValorCatalogo): string {
  const partes: string[] = [];
  if (valor.puedeCrear) partes.push('Crear');
  if (valor.puedeEditar) partes.push('Editar');
  if (valor.puedeEliminar) partes.push('Eliminar');
  return partes.length ? partes.join(' · ') : 'Sólo lectura';
}

/* ── Lista blanca ─────────────────────────────────────────────────────────── */

export type ListaBlancaItem = {
  mime: string;
  extension: string | null;
  activo: boolean;
  nota: string | null;
  uso: number;
};

export function aListaBlancaItem(bruto: unknown): ListaBlancaItem {
  const r = esRegistro(bruto) ? bruto : {};
  return {
    mime: texto(r, ['mime']) ?? '—',
    extension: texto(r, ['extension']),
    activo: r['activo'] === true,
    nota: texto(r, ['nota']),
    uso: numero(r, ['uso']) ?? 0,
  };
}

/* ── Configuración ────────────────────────────────────────────────────────── */

export type ConfiguracionItem = {
  clave: string;
  valor: unknown;
  descripcion: string | null;
  actualizadoEn: string | null;
  actualizadoPor: string | null;
  actualizadoPorNombre: string | null;
};

export function aConfiguracionItem(bruto: unknown): ConfiguracionItem {
  const r = esRegistro(bruto) ? bruto : {};
  return {
    clave: texto(r, ['clave']) ?? '—',
    valor: r['valor'],
    descripcion: texto(r, ['descripcion']),
    actualizadoEn: texto(r, ['actualizadoEn']),
    actualizadoPor: texto(r, ['actualizadoPor']),
    actualizadoPorNombre: texto(r, ['actualizadoPorNombre']),
  };
}

/* ── Migraciones ──────────────────────────────────────────────────────────── */

export type MigracionItem = {
  clave: string;
  aplicadaEn: string | null;
};

export function aMigracionItem(bruto: unknown): MigracionItem {
  const r = esRegistro(bruto) ? bruto : {};
  return {
    clave: texto(r, ['clave']) ?? '—',
    aplicadaEn: texto(r, ['aplicadaEn']),
  };
}
