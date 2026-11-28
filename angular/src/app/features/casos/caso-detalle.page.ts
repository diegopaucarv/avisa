import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import {
  ActorCaso,
  AlertaCaso,
  DemandaCaso,
  DocumentoCaso,
  EventoCaso,
  fechaIso,
  TramoEstadoCaso,
} from '../../dominio/mapeo';
import {
  AnularPanelComponent,
  ResultadoAnulacion,
  type ModoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { BotonAccionComponent } from '../../shared/ui/boton-accion.component';
import { formatearFecha, formatearFechaCompacta, partesFecha } from '../../shared/formato-fecha';
import { copiarAlPortapapeles } from '../alertas/portapapeles';
import { AlertaPanelComponent } from '../alertas/alerta-panel.component';
import { aDetalleAlerta, type DetalleAlerta } from '../alertas/alerta.mapeo';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import {
  aCompromisosCaso,
  etiquetaClasificacionAlcance,
  etiquetaFormalVerbal,
  etiquetaNivelGobierno,
  type ClasificacionAlcance,
  type CompromisoCasoConCaracteristicas,
  type FormalVerbal,
  type HitoCasoConResponsable,
} from '../compromisos/compromiso.mapeo';
import {
  claseVigencia,
  fechaTexto as fechaTextoMesa,
  vigenciaDe,
  type EstadoVigencia,
} from '../mesas/mesa.mapeo';
import {
  AccionEstado,
  aCatalogosEdicion,
  accionDeEstado,
  aDetalleCasoConCierre,
  CAMPOS_EDITABLES,
  CampoEditable,
  CatalogosEdicion,
  cuerpoPatchDeCampo,
  definicionDe,
  DetalleCasoConCierre,
  ESTADO_ABIERTO,
  ESTADO_ARCHIVADO,
  etiquetaDeCatalogo,
  OpcionCatalogo,
  opcionesDeCampo,
  resolverValorCatalogo,
  sinCambios,
  VALORES_VACIOS,
  validarValorCampo,
  valoresDeCaso,
  type ValoresEditables,
} from './caso-edicion.mapeo';
import {
  CuerpoDemanda,
  DemandaPanelComponent,
  type OpcionTematicaDemanda,
} from './demanda-panel.component';
import {
  CuerpoEvento,
  EventoPanelComponent,
  OpcionTipoHecho,
  aTiposHecho,
} from './evento-panel.component';
import {
  type CasoActorFila,
  type CasoActoresCaso,
  type CuerpoVincularActor,
  aCasoActores,
} from './nudos-matriz.mapeo';
import { VincularActorComponent } from './vincular-actor.component';
import { EnlaceRiel, RielRelacionesComponent } from './riel-relaciones.component';

/**
 * Claves que `GET /api/v1/cases/{codigo}` entrega por hito y que el mapeo
 * compartido de `dominio/mapeo.ts` no conserva: se releen del bruto en
 * `datosHitosCrudos()` y se suman al hito ya mapeado.
 */
type DatosHitoCrudos = {
  /** Código visible del hito (`COMP001_H001`). */
  codigo: string | null;
  /** Fecha real de cumplimiento, en `YYYY-MM-DD`. */
  fechaReal: string | null;
  /** El estado del hito cierra el compromiso. */
  terminal: boolean;
};

type HitoDetalle = HitoCasoConResponsable & DatosHitoCrudos;

/**
 * Vínculo de una demanda con sus compromisos (A4). La API entrega `demandaId` y
 * `demandaCodigo` por compromiso; `CompromisoCasoConCaracteristicas` no los
 * conserva, así que la ficha los relee del bruto.
 */
type VinculoCompromisoDemanda = {
  demandaId: string | null;
  demandaCodigo: string | null;
};

/** Compromiso del detalle con sus hitos y su vínculo de demanda ya resueltos. */
type CompromisoCasoEnFicha = Omit<CompromisoCasoConCaracteristicas, 'hitos'> &
  VinculoCompromisoDemanda & {
    hitos: HitoDetalle[];
  };

/**
 * Caso del detalle con la descripción de riesgo y el sectorista. `aCaso` no
 * las conserva porque el listado no las necesita, pero
 * `GET /api/v1/cases/{codigo}` las entrega y la ficha las muestra en los datos
 * generales. Se añaden aquí, sin tocar `dominio/`.
 */
type CasoConDescripcionRiesgo = DetalleCasoConCierre['caso'] & {
  descripcionRiesgo: string | null;
  sectorista: string | null;
  /** UUID del sectorista asignado (`punto_focal_usuario_id`); aditivo. */
  sectoristaUsuarioId: string | null;
};

/** Temática declarada de una demanda (`A4`). `null` = sin temática. */
type TematicaDemanda = {
  tematica: string | null;
  tematicaId: number | null;
};

/**
 * Demanda del expediente con su temática. `aDemandaCaso` del dominio no la
 * conserva, así que se relee del bruto y se indexa por id.
 */
type DemandaCasoConTematica = DemandaCaso &
  TematicaDemanda & {
    /** Fecha de registro (`core.demandas.fecha_registro`) normalizada; `null` si falta. */
    fechaRegistro: string | null;
  };

/**
 * Mesa de diálogo del caso (`core.mesas_dialogo`, migración 81). Sólo llega si
 * el caso es el espejo `MD-AAAA-NNNN` de una mesa; un caso común devuelve
 * `null`. Los vacíos se conservan como `null`: la plantilla omite la celda en
 * vez de rellenarla con «0» o texto de relleno.
 */
export type MesaDelCaso = {
  codigo: string | null;
  titulo: string | null;
  naturaleza: string | null;
  estadoVigencia: EstadoVigencia;
  fechaInstalacion: string | null;
  fechaFinVigencia: string | null;
  tipoInstrumento: string | null;
  baseLegal: string | null;
  ambitoDepartamento: string | null;
  objetivo: string | null;
  miembros: number | null;
};

/** Detalle del caso con las columnas nuevas de compromisos e hitos. */
type DetalleCasoConCompromisos = Omit<DetalleCasoConCierre, 'compromisos' | 'caso' | 'demandas'> & {
  compromisos: CompromisoCasoEnFicha[];
  caso: CasoConDescripcionRiesgo;
  demandas: DemandaCasoConTematica[];
  /** Mesa de diálogo enlazada; `null` si el caso no es mesa. */
  mesa: MesaDelCaso | null;
};

/**
 * Hito aplanado de la ficha: `hitosDelCaso()` añade el código del compromiso y
 * su id, que las acciones necesitan para llamar a
 * `PATCH /api/v1/commitments/{compromisoId}/hitos/{hitoId}`.
 */
type HitoEnCaso = HitoDetalle & {
  compromiso: string;
  compromisoId: string;
};

/** Estados del hito que edita la ficha: el catálogo completo, en su orden. */
export const ESTADOS_HITO_FICHA = [
  'Registrado',
  'En ejecución',
  'Paralizado',
  'Cumplido',
  'Desestimado',
  'No cumplido',
] as const;

export type EstadoHitoFicha = (typeof ESTADOS_HITO_FICHA)[number];

/**
 * Orden de los controles de acción de cada hito. La plantilla los pinta
 * recorriendo esta constante, así que reordenarla es suficiente para cambiar
 * el orden de la fila.
 */
export const ACCIONES_HITO = [
  'estado', // 1. Estado del hito → `PATCH { estado }`.
  'fechaReal', // 2. Fecha real → `PATCH { fechaReal }`.
  'responsable', // 3. Responsable → `PATCH { responsableTexto }`.
] as const;

export type AccionHito = (typeof ACCIONES_HITO)[number];

/** Código del hito para la columna «Código»; sin dato, «—». */
export function codigoHitoVisible(codigo: string | null | undefined): string {
  return (codigo ?? '').trim() || '—';
}

/** Código del hito para las etiquetas accesibles de los controles. */
export function referenciaHito(codigo: string | null | undefined): string {
  return (codigo ?? '').trim() || 'sin código';
}

/** Insignia del estado del hito, con las clases que ya usa la ficha. */
export function claseEstadoHito(
  estado: string | null | undefined,
): 'state-approved' | 'state-dismissed' | 'state-pending' {
  const clave = (estado ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (clave === 'cumplido') return 'state-approved';
  if (clave === 'desestimado' || clave === 'no cumplido' || clave === 'paralizado') {
    return 'state-dismissed';
  }
  return 'state-pending';
}

/**
 * Fecha planificada: la ISO pasa a `02NOV2025`; si sólo hay texto del origen
 * (`Julio 2026`), se muestra tal cual. Sin dato, «—».
 */
export function textoFechaHito(
  fecha: string | null | undefined,
  fechaTexto: string | null | undefined,
): string {
  const limpia = (fecha ?? '').trim();
  if (limpia) return formatearFecha(limpia);
  return (fechaTexto ?? '').trim() || '—';
}

/** Fecha real: ISO, texto del origen o «Sin fecha real». Nunca se estima. */
export function textoFechaRealHito(
  fechaReal: string | null | undefined,
  fechaRealTexto: string | null | undefined,
): string {
  const limpia = (fechaReal ?? '').trim();
  if (limpia) return formatearFecha(limpia);
  return (fechaRealTexto ?? '').trim() || 'Sin fecha real';
}

export function esEstadoHitoFicha(valor: string): valor is EstadoHitoFicha {
  return (ESTADOS_HITO_FICHA as readonly string[]).includes(valor);
}

const SIN_DATOS_HITO: DatosHitoCrudos = { codigo: null, fechaReal: null, terminal: false };

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Primer valor de las claves indicadas que sea texto no vacío; `null` si no hay. */
function textoDe(registro: Record<string, unknown>, ...claves: string[]): string | null {
  for (const clave of claves) {
    const valor = registro[clave];
    if (typeof valor === 'string' && valor.trim() !== '') return valor;
  }
  return null;
}

/**
 * `GET /api/v1/cases/{codigo}` entrega por hito `codigo`, `fechaReal` y
 * `terminal`, pero el mapeo compartido sólo conserva id, descripción, fecha y
 * estado. Se releen del bruto y se indexan por id: así `hitosDelCaso()` puede
 * completarlos sin duplicar el mapeo de `dominio/`.
 */
function datosHitosCrudos(bruto: unknown): Map<string, DatosHitoCrudos> {
  const datos = new Map<string, DatosHitoCrudos>();
  const registro = esRegistro(bruto) ? bruto : {};
  const compromisos = registro['compromisos'] ?? registro['commitments'];
  if (!Array.isArray(compromisos)) return datos;

  for (const compromiso of compromisos) {
    if (!esRegistro(compromiso) || !Array.isArray(compromiso['hitos'])) continue;
    for (const hito of compromiso['hitos'] as unknown[]) {
      if (!esRegistro(hito)) continue;
      const id = textoDe(hito, 'id');
      if (!id) continue;
      datos.set(id, {
        codigo: textoDe(hito, 'codigo'),
        fechaReal: textoDe(hito, 'fechaReal', 'fecha_real'),
        // Bandera booleana de la consulta; cualquier otro valor se lee ausente.
        terminal: hito['terminal'] === true,
      });
    }
  }

  return datos;
}

/** Primer valor numérico de las claves indicadas; `null` si no hay. */
function numeroDe(registro: Record<string, unknown>, ...claves: string[]): number | null {
  for (const clave of claves) {
    const valor = registro[clave];
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
    if (typeof valor === 'string' && valor.trim() !== '') {
      const numero = Number(valor);
      if (Number.isFinite(numero)) return numero;
    }
  }
  return null;
}

const SIN_TEMATICA_DEMANDA: TematicaDemanda = { tematica: null, tematicaId: null };
const SIN_VINCULO_DEMANDA: VinculoCompromisoDemanda = { demandaId: null, demandaCodigo: null };

/**
 * Ventana de demandas del expediente, en meses, contada desde el último hecho
 * registrado. `core.demandas` no vincula la demanda con el hecho que la origina.
 */
const MESES_VENTANA_DEMANDAS = 6;

/**
 * Resta meses a una fecha `YYYY-MM-DD` sin desplazar el día por zona horaria.
 * Si el día no existe en el mes destino (31 → febrero), se ajusta al último día
 * disponible. Devuelve `null` si la fecha de entrada no se reconoce.
 */
function restarMeses(fecha: string, meses: number): string | null {
  const partes = partesFecha(fecha);
  if (!partes) return null;

  const [anio, mes, dia] = partes;
  const destino = new Date(Date.UTC(anio, mes - 1 - meses, 1));
  const anioDestino = destino.getUTCFullYear();
  const mesDestino = destino.getUTCMonth();
  const ultimoDia = new Date(Date.UTC(anioDestino, mesDestino + 1, 0)).getUTCDate();
  const diaDestino = Math.min(dia, ultimoDia);

  return `${anioDestino}-${String(mesDestino + 1).padStart(2, '0')}-${String(diaDestino).padStart(2, '0')}`;
}

/**
 * Ventana de la cronología del expediente (E3), en meses, contada desde hoy.
 * El requisito pide mostrar sólo el último hecho y sólo si es reciente: el
 * «mínimo» de antigüedad es en realidad un máximo de seis meses.
 */
const MESES_VENTANA_CRONOLOGIA = 6;

/**
 * Fecha de hoy en `YYYY-MM-DD`, en hora local del navegador. Se construye con
 * los getters locales y no con `toISOString()` para no desplazar el día según
 * la zona horaria.
 */
export function fechaHoyIso(ahora: Date = new Date()): string {
  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

/**
 * Hecho visible de la cronología: el más reciente con fecha válida, siempre que
 * su fecha caiga dentro de la ventana de `meses` contada desde `hoy` (el borde
 * se incluye). Sin hechos, sin fechas válidas o con el último fuera de la
 * ventana devuelve `null`: la ficha no inventa ni muestra hechos antiguos.
 */
export function hechoEnVentana<T extends { fecha: string }>(
  eventos: readonly T[],
  hoy: string,
  meses = MESES_VENTANA_CRONOLOGIA,
): T | null {
  const umbral = restarMeses(hoy, meses);
  if (umbral === null) return null;

  let ultimo: { evento: T; fecha: string } | null = null;
  for (const evento of eventos) {
    const fecha = fechaIso(evento.fecha);
    if (fecha === null) continue;
    // `YYYY-MM-DD` se compara lexicográficamente sin construir fechas.
    if (ultimo === null || fecha > ultimo.fecha) ultimo = { evento, fecha };
  }

  if (ultimo === null || ultimo.fecha < umbral) return null;
  return ultimo.evento;
}

/**
 * Tipologías del actor para la tabla: agrega las columnas de categoría que el
 * modelo ya guarda —tipo (rol estructural: público, social o privado), función
 * en la intervención (principal, secundario o tercero imparcial) y
 * posicionamiento (dialogante, legitimante o conflictivo)—. No se crea un campo
 * nuevo: son las columnas existentes del endpoint del caso. Se recortan, se
 * deduplican y, si hay más de una, se separan con comas.
 */
export function textoTipologias(
  actor: Pick<ActorCaso, 'tipo' | 'funcion' | 'posicionamiento'>,
): string {
  const valores = new Set<string>();
  for (const valor of [actor.tipo, actor.funcion, actor.posicionamiento]) {
    const limpio = (valor ?? '').trim();
    if (limpio) valores.add(limpio);
  }
  return [...valores].join(', ');
}

/**
 * `tematicaId` y `tematica` de cada demanda del expediente. `dominio/mapeo.ts`
 * descarta esas columnas nuevas; se releen del bruto y se indexan por id sin
 * tocar el mapeo compartido.
 */
function tematicasDemandasCrudas(bruto: unknown): Map<string, TematicaDemanda> {
  const mapa = new Map<string, TematicaDemanda>();
  const registro = esRegistro(bruto) ? bruto : {};
  const demandas = registro['demandas'];
  if (!Array.isArray(demandas)) return mapa;

  for (const demanda of demandas) {
    if (!esRegistro(demanda)) continue;
    const id = textoDe(demanda, 'id');
    if (!id) continue;
    mapa.set(id, {
      tematica: textoDe(demanda, 'tematica'),
      tematicaId: numeroDe(demanda, 'tematicaId', 'tematica_id'),
    });
  }

  return mapa;
}

/**
 * Fecha de registro de cada demanda del expediente. `GET /cases/{codigo}` la
 * entrega como `fecha_registro`; el mapeo del dominio no la conserva, así que
 * se relee del bruto y se indexa por id (igual que la temática).
 */
function fechasDemandasCrudas(bruto: unknown): Map<string, string | null> {
  const mapa = new Map<string, string | null>();
  const registro = esRegistro(bruto) ? bruto : {};
  const demandas = registro['demandas'];
  if (!Array.isArray(demandas)) return mapa;

  for (const demanda of demandas) {
    if (!esRegistro(demanda)) continue;
    const id = textoDe(demanda, 'id');
    if (!id) continue;
    mapa.set(id, fechaIso(textoDe(demanda, 'fechaRegistro', 'fecha_registro')));
  }

  return mapa;
}

/**
 * Demanda a la que pertenece cada compromiso del caso. La API la entrega como
 * `demandaId` y `demandaCodigo`; el mapeo compartido no la conserva.
 */
function vinculosCompromisoDemanda(bruto: unknown): Map<string, VinculoCompromisoDemanda> {
  const mapa = new Map<string, VinculoCompromisoDemanda>();
  const registro = esRegistro(bruto) ? bruto : {};
  const compromisos = registro['compromisos'] ?? registro['commitments'];
  if (!Array.isArray(compromisos)) return mapa;

  for (const compromiso of compromisos) {
    if (!esRegistro(compromiso)) continue;
    const id = textoDe(compromiso, 'id');
    if (!id) continue;
    mapa.set(id, {
      demandaId: textoDe(compromiso, 'demandaId', 'demanda_id'),
      demandaCodigo: textoDe(compromiso, 'demandaCodigo', 'demanda_codigo'),
    });
  }

  return mapa;
}

/**
 * Catálogo de temáticas tal como lo entrega `/api/v1/catalogs`: el `id` es el
 * número que espera `tematicaId` y el nombre es el texto visible. El mapeo de
 * la ficha sólo conserva valor y etiqueta, así que el id se relee aquí.
 */
function aTematicasDemanda(bruto: unknown): readonly OpcionTematicaDemanda[] {
  const registro = esRegistro(bruto) ? bruto : {};
  const crudo = registro['catalogs'] ?? registro['catalogos'];
  const catalogo = esRegistro(crudo) ? crudo : {};
  const filas = catalogo['tematicas'];
  if (!Array.isArray(filas)) return [];

  const opciones: OpcionTematicaDemanda[] = [];
  for (const fila of filas) {
    if (!esRegistro(fila)) continue;
    const id = numeroDe(fila, 'id');
    const nombre = textoDe(fila, 'etiqueta', 'codigo', 'nombre');
    if (id !== null && nombre) opciones.push({ id, nombre });
  }

  return opciones;
}

/**
 * Campos retirados de la ficha por el ajuste de producto del 22 nov: la
 * cabecera ya muestra el título, el resumen ejecutivo se quitó y el cierre, el
 * ciclo, la naturaleza y el avance no se presentan. Siguen en
 * `CAMPOS_EDITABLES` porque `PATCH` los admite, pero no se pintan.
 */
const CAMPOS_OCULTOS: ReadonlySet<CampoEditable> = new Set<CampoEditable>([
  'titulo',
  'resumenEjecutivo',
  'riesgo',
  'nivelConflicto',
  'naturaleza',
  'ciclo',
  'pctAvance',
  'fechaCierre',
  'prioridad',
  'unidadResponsable',
]);

/**
 * Mesa del caso. `null` cuando el caso no es espejo de una mesa; el backend ya
 * entrega camelCase y aquí sólo se valida el vocabulario de la vista.
 */
function aMesaDelCaso(bruto: unknown): MesaDelCaso | null {
  if (!esRegistro(bruto)) return null;
  return {
    codigo: textoDe(bruto, 'codigo'),
    titulo: textoDe(bruto, 'titulo'),
    naturaleza: textoDe(bruto, 'naturaleza'),
    estadoVigencia: vigenciaDe(textoDe(bruto, 'estadoVigencia', 'estado_vigencia')),
    fechaInstalacion: textoDe(bruto, 'fechaInstalacion', 'fecha_instalacion'),
    fechaFinVigencia: textoDe(bruto, 'fechaFinVigencia', 'fecha_fin_vigencia'),
    tipoInstrumento: textoDe(bruto, 'tipoInstrumento', 'tipo_instrumento'),
    baseLegal: textoDe(bruto, 'baseLegal', 'base_legal'),
    ambitoDepartamento: textoDe(bruto, 'ambitoDepartamento', 'ambito_departamento'),
    objetivo: textoDe(bruto, 'objetivo'),
    miembros: numeroDe(bruto, 'miembros'),
  };
}

/** «12 integrantes registrados»; un cero se declara, no se pinta como cifra. */
export function integrantesTexto(miembros: number | null): string {
  if (miembros === null || miembros <= 0) return 'sin integrantes registrados';
  return miembros === 1 ? '1 integrante registrado' : `${miembros} integrantes registrados`;
}

/**
 * Esquema de `GET /api/v1/cases/{codigo}` (y del `PATCH`, mismo contrato):
 * suma al mapeo del caso los hitos con su código, fecha real y bandera de
 * terminal, que la sección «Hitos del caso» necesita. El mapeo compartido
 * descarta la clasificación, el carácter, la bandera del Ministro y el
 * responsable del hito; se recuperan del bruto sin tocar `dominio/mapeo.ts`.
 */
export function aDetalleCasoConCompromisos(bruto: unknown): DetalleCasoConCompromisos {
  const detalle = aDetalleCasoConCierre(bruto);
  const registro = esRegistro(bruto) ? bruto : {};
  const casoBruto = registro['caso'] ?? registro['case'];
  const filaCaso = esRegistro(casoBruto) ? casoBruto : {};
  const descripcionRiesgo = textoDe(filaCaso, 'descripcionRiesgo', 'descripcion_riesgo');
  const sectorista = textoDe(filaCaso, 'sectorista', 'sectoristaNombre');
  const sectoristaUsuarioId = textoDe(filaCaso, 'sectoristaUsuarioId', 'sectorista_usuario_id');
  const datos = datosHitosCrudos(bruto);
  const tematicas = tematicasDemandasCrudas(bruto);
  const fechas = fechasDemandasCrudas(bruto);
  const vinculos = vinculosCompromisoDemanda(bruto);
  const mesa = aMesaDelCaso(registro['mesa']);
  const compromisos = aCompromisosCaso(bruto, detalle.compromisos).map((compromiso) => ({
    ...compromiso,
    ...(vinculos.get(compromiso.id) ?? SIN_VINCULO_DEMANDA),
    hitos: compromiso.hitos.map((hito) => ({ ...hito, ...(datos.get(hito.id) ?? SIN_DATOS_HITO) })),
  }));
  const demandas = detalle.demandas.map((demanda) => ({
    ...demanda,
    ...(tematicas.get(demanda.id) ?? SIN_TEMATICA_DEMANDA),
    fechaRegistro: fechas.get(demanda.id) ?? null,
  }));
  return {
    ...detalle,
    caso: { ...detalle.caso, descripcionRiesgo, sectorista, sectoristaUsuarioId },
    compromisos,
    demandas,
    mesa,
  };
}

@Component({
  selector: 'app-caso-detalle',
  imports: [
    RouterLink,
    IconoComponent,
    ExportarMenuComponent,
    GlosarioComponent,
    EventoPanelComponent,
    DemandaPanelComponent,
    AlertaPanelComponent,
    AnularPanelComponent,
    RielRelacionesComponent,
    ThOrdenDirective,
    VincularActorComponent,
    BotonAccionComponent,
  ],
  templateUrl: './caso-detalle.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .timeline-edit {
      min-height: 26px;
      margin-top: 4px;
      padding: 0 10px;
      font-size: 12.5px;
    }

    .aviso-ok {
      color: #2f6f52;
      font-size: 13.5px;
    }

    /*
     * Cabecera: etiquetas bajo el título y acciones en una grilla de tres
     * columnas con botones del mismo ancho (fila 1: Modificar, Archivar, Anular;
     * fila 2: Exportar, Imprimir). El ancho acotado evita que dos botones
     * cortos ocupen toda la línea.
     */
    .caso-etiquetas {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 6px;
    }

    .etiquetas-linea {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .caso-acciones {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      width: min(100%, 480px);
      margin-left: auto;
      justify-self: end;
      align-self: start;
    }

    /*
     * El nombre del caso se queda con la mitad izquierda del encabezado y los
     * botones con la derecha: sin el tope, un título largo empujaba las acciones
     * y las partía en dos filas. Por debajo de 900 px vuelve a ocupar la línea
     * completa, porque ahí los botones ya van debajo.
     */
    .view-head > div:first-child {
      flex: 1 1 50%;
      max-width: 50%;
      min-width: 0;
    }

    @media (max-width: 960px) {
      .view-head > div:first-child {
        flex-basis: 100%;
        max-width: none;
      }
    }

    /* Botones de la línea de tiempo: icono sin relleno, alineados a la
       izquierda de la viñeta. */
    .timeline-acciones app-boton-accion {
      min-width: 28px;
    }

    .caso-acciones > * {
      width: 100%;
    }

    .caso-acciones app-exportar-menu {
      display: block;
    }

    /* El botón del menú de exportación vive en un componente hijo: se iguala al
       ancho de la celda para que la grilla se vea uniforme. */
    :host ::ng-deep .caso-acciones app-exportar-menu .exportar-boton {
      width: 100%;
      justify-content: center;
    }

    .baja-inline {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px;
    }

    .baja-inline .baja-pregunta {
      flex: 1 1 260px;
      margin: 0;
    }

    .detail-hint {
      display: block;
      margin-top: 2px;
      font-size: 13px;
      font-weight: 400;
      color: #8d99a6;
    }

    /* Encabezado: código y última actualización juntos (items 24). */
    .view-actualizacion {
      margin-left: 4px;
      color: var(--muted);
      font-size: 12.5px;
    }

    /* Resumen del caso al inicio de la ficha (item 27). */
    .resumen-caso {
      margin-bottom: 2px;
    }

    .resumen-caso h2 {
      margin: 0 0 6px;
      color: var(--ink);
      font-size: 13px;
      font-weight: 700;
    }

    .resumen-texto {
      margin: 0;
      color: var(--ink-2);
      font-size: 13px;
      line-height: 1.6;
      text-align: justify;
    }

    /* Riesgo concreto (E3): texto libre de core.casos.descripcion_riesgo,
       separado del resumen ejecutivo para no confundir ambos relatos. */
    .riesgo-concreto {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
    }

    .riesgo-concreto h3 {
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    /* Edición en línea de las etiquetas de riesgo y conflictividad (item 26). */
    .badge-edit {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .badge-edit .form-select {
      height: 30px;
      min-width: 150px;
    }

    .badge-edit .button-primary,
    .badge-edit .button-secondary {
      min-height: 30px;
      padding: 0 10px;
      font-size: 12.5px;
    }

    .badge-edit-btn {
      margin-left: 4px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--blue-dark);
      font-size: 12px;
      cursor: pointer;
    }

    /* Acceso al tablero de Canva en el riel (item 29). */
    .canva-riel {
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }

    .canva-titulo {
      margin: 0 0 8px;
      color: var(--muted);
      font: 700 12px var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .canva-enlace {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--blue-dark);
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
    }

    .canva-enlace:hover,
    .canva-enlace:focus-visible {
      text-decoration: underline;
    }

    .canva-editor {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .canva-editor input {
      flex: 1 1 100%;
      min-width: 0;
      height: 32px;
      padding: 0 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--ink);
      font-size: 12.5px;
    }

    .canva-vacio {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 8px;
      border: 1px dashed var(--line);
      border-radius: 6px;
      background: var(--canvas);
      color: #a1abb4;
      font-size: 12.5px;
      cursor: pointer;
    }

    .canva-vacio:disabled {
      cursor: default;
      opacity: 0.7;
    }

    .canva-mas {
      margin-left: auto;
      font-size: 14px;
      line-height: 1;
    }

    /* Los saltos por fragment deben dejar visible el título de la sección. */
    h2[id] {
      scroll-margin-top: 16px;
    }

    /* Item 18: cada recuadro editable centra su valor; la edición en línea
       vuelve a alinear el control a la izquierda para poder escribir. */
    .campo-editable dd {
      text-align: center;
    }

    .campo-editable .campo-valor {
      display: block;
      font-weight: 600;
    }

    /* Priorizado (migración 76): la casilla y su estado comparten línea. */
    .campo-casilla {
      align-items: center;
      cursor: pointer;
      display: inline-flex;
      gap: 6px;
    }

    .campo-editable .edit-form {
      text-align: left;
    }

    .campo-editable .link-button {
      margin-top: 4px;
    }

    /* Item 37: confirmación de estado en línea, dentro de la cabecera. */
    .archivo-confirmacion {
      margin: 10px 0 0;
      padding: 10px 12px;
      border: 1px dashed var(--line);
      border-radius: 6px;
      background: var(--canvas);
    }

    .archivo-confirmacion .form-hint {
      margin: 0;
    }

    .risk-inactivo {
      background: var(--canvas);
      color: var(--muted);
    }

    .risk-inactivo .status-dot {
      background: var(--muted);
    }

    /* Ficha en dos columnas: contenido y riel de relaciones (item 67). */
    .ficha-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 252px;
      grid-template-areas: 'principal lateral';
      gap: 14px;
      align-items: start;
    }

    .ficha-principal,
    .ficha-lateral {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .ficha-principal {
      grid-area: principal;
    }

    .ficha-lateral {
      grid-area: lateral;
      position: sticky;
      top: 14px;
    }

    /* Acciones del encabezado de Actores (WhatsApp / CSV), item 102. */
    .actores-acciones {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    /* Contacto del actor: teléfono arriba y correo debajo, cada uno con su
       botón de copiar. El correo va a 12 px para distinguirlo del teléfono. */
    .dato-contacto {
      display: flex;
      align-items: center;
      gap: 4px;
      line-height: 1.5;
    }

    .dato-contacto .correo-contacto {
      font-size: 12px;
    }

    .actor-cargo {
      color: var(--muted);
      font-size: 12px;
    }

    /* Demanda: hasta tres líneas en la tabla; el texto completo va en el atributo
       title. */
    .demanda-texto {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      white-space: normal;
    }

    .demandas-acciones {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    /* Confirmación de borrado de demandas, justo bajo la cabecera. */
    .baja-confirmacion {
      margin: 8px 0;
    }

    /*
     * Columna de selección de demandas: se ajusta al checkbox. El ancho es una
     * sugerencia en una tabla de layout automático, así que lo que manda es
     * quitar el relleno: la celda mide lo que mide la casilla.
     */
    .demanda-check-col {
      width: 1%;
      padding-right: 2px;
      padding-left: 2px;
      text-align: center;
      white-space: nowrap;
    }

    .demanda-check {
      width: 15px;
      height: 15px;
      margin: 0;
      cursor: pointer;
    }

    /* Riel de Canva: enlace y lápiz de edición en la misma línea. */
    .canva-fila {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .canva-editar {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--blue-dark);
      font-size: 12px;
      cursor: pointer;
    }

    /* Acciones por hito (estado, fecha real y responsable), en el orden de
       ACCIONES_HITO. Se apilan cuando la tabla no da ancho. */
    .hitos-acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .hito-control {
      width: auto;
      min-width: 132px;
      height: 28px;
      padding: 2px 8px;
      font-size: 12.5px;
    }

    /* Cronología: una viñeta por hecho, con la fecha en negrita y el texto en
       peso normal. La fecha ocupa su propia columna para que el texto largo no
       vuelva a quedar debajo de ella (sangría francesa). */
    .timeline-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .timeline-list li {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: baseline;
      column-gap: 8px;
      row-gap: 4px;
      padding: 0 0 0 16px;
      border-left: 0;
    }

    .timeline-list li::before {
      content: '';
      position: absolute;
      top: 0.42em;
      left: 3px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--blue, #1a4f8b);
    }

    .tl-fecha {
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }

    .tl-texto {
      font-size: 13px;
      font-weight: 400;
      text-transform: none;
    }

    .timeline-list .timeline-edit {
      grid-column: 1 / -1;
      justify-self: start;
    }

    /* Acciones y confirmación de una viñeta ocupan el ancho completo de la
       viñeta para que no se apilen junto a la fecha ni al texto. */
    .timeline-acciones,
    .timeline-confirmacion {
      grid-column: 1 / -1;
    }

    .timeline-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .cronologia-acciones {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    /* Se anida para ganar al white-space: nowrap de las celdas de la tabla. */
    .data-table td.celda-larga {
      min-width: 220px;
      white-space: normal;
    }

    /* «Alertas vinculadas»: el título va bajo el código, recortado a dos líneas; */
    /* el atributo title conserva el texto completo cuando el recorte lo esconde. */
    .alerta-fila {
      cursor: pointer;
    }

    .alerta-celda {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .alerta-celda-linea {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .alerta-celda-titulo {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      max-width: 100%;
      overflow: hidden;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.3;
      white-space: normal;
    }

    @media (max-width: 1120px) {
      .ficha-layout {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas:
          'lateral'
          'principal';
      }

      .ficha-lateral {
        position: static;
      }

      .ficha-lateral app-riel-relaciones {
        order: -1;
      }
    }

    /*
     * Impresión de la ficha (item 42). El bloque global de styles/global.css ya
     * retira la cabecera, la barra lateral y el pie del shell; aquí se retira lo
     * propio de la ficha: acciones, ayudas de glosario y paneles laterales, y se
     * evita que una fila o una sección queden partidas entre páginas.
     */
    @media print {
      .view-actions button,
      .view-actions app-exportar-menu,
      .view-actions app-glosario,
      .detail-section-title button,
      .timeline-edit,
      app-boton-accion,
      .archivo-confirmacion,
      .campo-editable .edit-form,
      .campo-editable .link-button,
      app-glosario,
      app-demanda-panel,
      app-evento-panel,
      app-anular-panel {
        display: none !important;
      }

      /* El riel enlaza a las secciones; no aporta nada en papel. */
      app-riel-relaciones {
        display: none !important;
      }

      .ficha-layout {
        display: block;
      }

      .ficha-lateral {
        position: static;
      }

      .detail-section > .detail-hint,
      .ficha-principal > .detail-hint,
      .view-body > .detail-hint {
        display: none;
      }

      .detail-section h2 {
        break-after: avoid;
      }

      .table-wrap {
        overflow: visible !important;
      }

      .data-table tr,
      .detail-grid > div,
      .timeline-list li {
        break-inside: avoid;
      }
    }
  `,
})
export class CasoDetallePage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);
  private readonly plataforma = inject(PLATFORM_ID);

  readonly codigo = toSignal(this.ruta.paramMap.pipe(map((params) => params.get('codigo') ?? '')), {
    initialValue: '',
  });
  private readonly registroSolicitado = toSignal(
    this.ruta.queryParamMap.pipe(map((params) => params.get('registrar'))),
    { initialValue: null },
  );

  private readonly recurso = consulta<DetalleCasoConCompromisos>({
    fuente: () => {
      const codigo = this.codigo();
      if (!codigo) return null;
      return urlApi(`/v1/cases/${encodeURIComponent(codigo)}`);
    },
    esquema: aDetalleCasoConCompromisos,
  });

  readonly detalle = this.recurso.valor;
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;

  /* ----------------------------------------------------------------------- *
   * Soporte de la ficha (2026-11-24)
   *
   * `GET /cases/{codigo}` se mapea con `aDetalleCasoConCierre`, que no conoce el
   * vínculo de actores. Ese soporte se pide aparte, con su propia `consulta`,
   * para no tocar el mapeo compartido del dominio.
   * --------------------------------------------------------------------- */

  private readonly actoresRecurso = consulta<CasoActoresCaso>({
    fuente: () => {
      const codigo = this.codigo();
      if (!codigo) return null;
      return urlApi(`/v1/cases/${encodeURIComponent(codigo)}/actores`);
    },
    esquema: aCasoActores,
  });

  readonly actoresVinculo = this.actoresRecurso.valor;
  readonly estadoActoresVinculo = this.actoresRecurso.estado;
  readonly errorActoresVinculo = this.actoresRecurso.error;

  /** Actor del vínculo por id; alimenta posición, nivel y vigencia de la tabla. */
  readonly mapaActores = computed(() => {
    const mapa = new Map<string, CasoActorFila>();
    for (const actor of this.actoresVinculo()?.actores ?? []) {
      mapa.set(actor.id, actor);
    }
    return mapa;
  });

  /** Ids de los actores con vínculo vigente; el panel no los vuelve a ofrecer. */
  readonly idsActoresVinculados = computed<readonly string[]>(() =>
    (this.actoresVinculo()?.actores ?? [])
      .filter((actor) => actor.vigente)
      .map((actor) => actor.id),
  );

  /**
   * Hitos de todos los acuerdos y compromisos del caso, aplanados. Cada fila
   * lleva el código del compromiso y su id: las acciones por hito necesitan
   * ambos para armar `PATCH /v1/commitments/{compromisoId}/hitos/{hitoId}`.
   */
  readonly hitosDelCaso = computed<HitoEnCaso[]>(() =>
    (this.ficha()?.compromisos ?? []).flatMap((compromiso) =>
      compromiso.hitos.map((hito) => ({
        ...hito,
        compromiso: compromiso.codigo,
        compromisoId: compromiso.id,
      })),
    ),
  );

  /* Orden local de cada tabla de la ficha (asc → desc → sin orden). */

  readonly ordenActores = new OrdenTabla<ActorCaso>();
  private readonly accesoresActores: Record<string, (actor: ActorCaso) => unknown> = {
    actor: (actor) => this.nombreActor(actor),
    institucion: (actor) => this.institucionActor(actor),
    contacto: (actor) => [this.telefonoActor(actor), actor.correo],
    // Se ordena por el texto completo (tipo, función y posicionamiento) para
    // que el usuario vea el mismo criterio que la celda «Tipologías».
    tipologia: (actor) => textoTipologias(actor),
  };
  readonly filasActores = computed(() =>
    this.ordenActores.ordenar(this.ficha()?.actores ?? [], this.accesoresActores),
  );

  /**
   * Actores con vínculo vigente. `GET /cases/{codigo}` devuelve también los
   * desvinculados (su consulta no filtra `anulado_en`); la vigencia llega en
   * `/actores`, así que se descartan con ese mapa. Si el soporte no está
   * disponible, `estaVigente()` responde «true» y no se puede filtrar aquí.
   */
  readonly actoresVigentes = computed(() =>
    this.filasActores().filter((actor) => this.estaVigente(actor.id)),
  );

  readonly ordenDemandas = new OrdenTabla<DemandaCasoConTematica>();
  private readonly accesoresDemandas: Record<string, (demanda: DemandaCasoConTematica) => unknown> =
    {
      demanda: (demanda) => demanda.descripcion ?? demanda.problema,
      tematica: (demanda) => demanda.tematica,
      estado: (demanda) => demanda.estado,
      origen: (demanda) => demanda.documentoOrigenCodigo ?? demanda.documentoOrigenTitulo,
    };
  /**
   * Fecha del hecho más reciente del caso (`YYYY-MM-DD`), o `null` si no hay
   * hechos con fecha. Se toma el máximo y no se confía en el orden de la API.
   */
  private readonly fechaUltimoHecho = computed(() => {
    let ultima: string | null = null;
    for (const evento of this.ficha()?.eventos ?? []) {
      const fecha = fechaIso(evento.fecha);
      if (fecha !== null && (ultima === null || fecha > ultima)) ultima = fecha;
    }
    return ultima;
  });

  // TODO(confirmar): `core.demandas` no guarda el hecho que originó cada
  // demanda. Se aproxima por fecha: sólo entran las demandas de la ventana de
  // 6 meses contada desde el último hecho registrado. Falta confirmar qué hacer
  // cuando ese último hecho tiene más de 6 meses: ¿dejar la tabla vacía
  // (comportamiento actual) o mostrar el histórico completo?
  readonly filasDemandas = computed(() => {
    const ultimoHecho = this.fechaUltimoHecho();
    if (ultimoHecho === null) return [];
    const umbral = restarMeses(ultimoHecho, MESES_VENTANA_DEMANDAS);
    if (umbral === null) return [];
    const demandas = (this.ficha()?.demandas ?? []).filter(
      (demanda) => demanda.fechaRegistro !== null && demanda.fechaRegistro >= umbral,
    );
    return this.ordenDemandas.ordenar(demandas, this.accesoresDemandas);
  });

  /** Meses de la ventana de demandas, para los textos de la vista. */
  readonly mesesVentanaDemandas = MESES_VENTANA_DEMANDAS;

  /**
   * Cronología del expediente (E3). El requisito pide sólo el último hecho y
   * sólo si es reciente: la antigüedad máxima es de seis meses contados desde
   * hoy. El filtro es de presentación; la API sigue devolviendo el histórico.
   */
  private readonly hoy = fechaHoyIso();
  readonly hechosVisibles = computed<readonly EventoCaso[]>(() => {
    const hecho = hechoEnVentana(this.ficha()?.eventos ?? [], this.hoy);
    return hecho ? [hecho] : [];
  });
  readonly mesesVentanaCronologia = MESES_VENTANA_CRONOLOGIA;
  /** Se expone a la plantilla y al CSV; la lógica vive fuera de la clase. */
  readonly textoTipologias = textoTipologias;

  /**
   * Demandas del caso que la ventana deja fuera (anteriores al umbral o sin
   * `fecha_registro`). La vista lo dice en voz alta para que no parezca que el
   * expediente perdió datos.
   */
  readonly demandasFueraDeVentana = computed(() =>
    Math.max(0, (this.ficha()?.demandas.length ?? 0) - this.filasDemandas().length),
  );

  /** Explica por qué la tabla de demandas está vacía; no siempre es «no hay». */
  readonly motivoDemandasVacias = computed(() => {
    if (this.fechaUltimoHecho() === null) {
      return 'El caso no tiene hechos registrados y la ventana se cuenta desde el último hecho.';
    }
    const fuera = this.demandasFueraDeVentana();
    if (fuera > 0) {
      return `Sin demandas en los últimos ${MESES_VENTANA_DEMANDAS} meses desde el último hecho. ${fuera} demanda(s) quedan fuera de la ventana o sin fecha.`;
    }
    return 'Sin demandas registradas en el caso.';
  });

  /**
   * Compromisos del caso agrupados por la demanda a la que pertenecen. Sólo los
   * vinculados entran en la columna «Compromisos» de la tabla de demandas.
   */
  readonly compromisosPorDemanda = computed(() => {
    const mapa = new Map<string, CompromisoCasoEnFicha[]>();
    for (const compromiso of this.ficha()?.compromisos ?? []) {
      if (!compromiso.demandaId) continue;
      const lista = mapa.get(compromiso.demandaId) ?? [];
      lista.push(compromiso);
      mapa.set(compromiso.demandaId, lista);
    }
    return mapa;
  });

  compromisosDeDemanda(demandaId: string): readonly CompromisoCasoEnFicha[] {
    return this.compromisosPorDemanda().get(demandaId) ?? [];
  }

  readonly ordenAlertas = new OrdenTabla<AlertaCaso>();
  private readonly accesoresAlertas: Record<string, (alerta: AlertaCaso) => unknown> = {
    codigo: (alerta) => alerta.codigo,
    nivel: (alerta) => alerta.nivel,
    prioridad: (alerta) => alerta.prioridad,
    estado: (alerta) => alerta.estado,
    fecha: (alerta) => alerta.fechaReporte,
  };
  readonly filasAlertas = computed(() =>
    this.ordenAlertas.ordenar(this.ficha()?.alertas ?? [], this.accesoresAlertas),
  );

  readonly ordenCompromisos = new OrdenTabla<CompromisoCasoConCaracteristicas>();
  private readonly accesoresCompromisos: Record<
    string,
    (compromiso: CompromisoCasoConCaracteristicas) => unknown
  > = {
    codigo: (compromiso) => compromiso.codigo,
    compromiso: (compromiso) => compromiso.accion,
    clasificacion: (compromiso) => this.clasificacionAlcanceTexto(compromiso.clasificacionAlcance),
    estado: (compromiso) => compromiso.estado,
    nivel: (compromiso) => this.nivelGobiernoTexto(compromiso.nivelGobierno),
    unidad: (compromiso) => compromiso.unidad,
    vencimiento: (compromiso) => compromiso.vencimiento,
  };
  readonly filasCompromisos = computed(() =>
    this.ordenCompromisos.ordenar(this.ficha()?.compromisos ?? [], this.accesoresCompromisos),
  );

  readonly ordenHitos = new OrdenTabla<HitoEnCaso>();
  private readonly accesoresHitos: Record<string, (hito: HitoEnCaso) => unknown> = {
    // El código visible es la pareja «compromiso + hito»; se ordena por ambos.
    compromiso: (hito) => [hito.compromiso, hito.codigo ?? ''],
    hito: (hito) => hito.descripcion,
    estado: (hito) => hito.estado,
    fecha: (hito) => hito.fecha ?? hito.fechaTexto,
    real: (hito) => hito.fechaReal ?? hito.fechaRealTexto,
    responsable: (hito) => hito.responsableTexto,
  };
  readonly filasHitos = computed(() =>
    this.ordenHitos.ordenar(this.hitosDelCaso(), this.accesoresHitos),
  );

  /** Catálogo y orden de las acciones por hito (ver `ACCIONES_HITO`). */
  readonly estadosHito: readonly EstadoHitoFicha[] = ESTADOS_HITO_FICHA;
  readonly accionesHito: readonly AccionHito[] = ACCIONES_HITO;

  /**
   * Formateo de las columnas de hitos. Las funciones viven fuera de la clase
   * para poder probarlas sin TestBed; aquí sólo se exponen a la plantilla.
   */
  readonly codigoHitoVisible = codigoHitoVisible;
  readonly referenciaHito = referenciaHito;
  readonly claseEstadoHito = claseEstadoHito;
  readonly textoFechaHito = textoFechaHito;
  readonly textoFechaRealHito = textoFechaRealHito;
  readonly esEstadoHitoFicha = esEstadoHitoFicha;

  /**
   * Bloque «Espacio de diálogo»: reutiliza el vocabulario de `mesa.mapeo`
   * (vigencia y fechas) en vez de duplicar catálogos en esta ficha.
   */
  readonly claseVigencia = claseVigencia;
  readonly fechaTextoMesa = fechaTextoMesa;
  readonly integrantesTexto = integrantesTexto;
  /** Id del hito cuyo `PATCH` está en vuelo; bloquea sus tres controles. */
  readonly guardandoHito = signal<string | null>(null);
  /** Último fallo al editar un hito; se muestra sobre la tabla. */
  readonly errorHitos = signal<string | null>(null);

  readonly ordenDocumentos = new OrdenTabla<DocumentoCaso>();
  private readonly accesoresDocumentos: Record<string, (documento: DocumentoCaso) => unknown> = {
    codigo: (documento) => documento.codigo,
    titulo: (documento) => documento.titulo,
    tipo: (documento) => documento.tipoNombre ?? documento.tipo,
    fecha: (documento) => documento.fecha,
  };
  readonly filasDocumentos = computed(() =>
    this.ordenDocumentos.ordenar(this.ficha()?.documentos ?? [], this.accesoresDocumentos),
  );

  readonly ordenHistorial = new OrdenTabla<TramoEstadoCaso>();
  private readonly accesoresHistorial: Record<string, (tramo: TramoEstadoCaso) => unknown> = {
    estado: (tramo) => tramo.estado,
    desde: (tramo) => tramo.desde,
    hasta: (tramo) => tramo.hasta,
    motivo: (tramo) => tramo.motivo,
    usuario: (tramo) => tramo.usuario,
  };
  readonly filasHistorial = computed(() =>
    this.ordenHistorial.ordenar(this.ficha()?.historial ?? [], this.accesoresHistorial),
  );

  /**
   * Tras anular, la API deja de devolver el caso: la política RLS de `SELECT`
   * esconde lo anulado. Se retiene la última ficha para poder mostrar el estado
   * y ofrecer la restauración sin inventar una papelera.
   */
  readonly snapshotAnulado = signal<DetalleCasoConCompromisos | null>(null);

  /**
   * Última respuesta de un `PATCH` (campo o estado). Evita recargar la ficha y
   * conserva el resto del expediente: la API devuelve el detalle completo.
   */
  readonly detalleActualizado = signal<DetalleCasoConCompromisos | null>(null);

  /** Ficha visible: la retenida tras anular, la actualizada o la de la API. */
  readonly ficha = computed(
    () => this.snapshotAnulado() ?? this.detalleActualizado() ?? this.detalle() ?? null,
  );
  readonly caso = computed(() => this.ficha()?.caso);
  readonly anulado = computed(
    () => this.snapshotAnulado() !== null || this.caso()?.anulado === true,
  );

  /**
   * Item 11: la insignia de riesgo sólo conserva su color si el caso está
   * abierto. Resuelto, Archivado o anulado la muestran en gris. El valor no se
   * recalcula aquí: la regla pertenece al servidor (matriz del caso) y
   * `GET /api/v1/cases/{codigo}` no expone endpoint de recálculo.
   */
  readonly riesgoInactivo = computed(() => {
    const caso = this.caso();
    if (!caso) return false;
    return this.anulado() || caso.estado !== 'Abierto';
  });

  /**
   * Sólo el caso **archivado** muestra el riesgo como «Inactivo». Un caso
   * resuelto conserva su nivel (la insignia sí pierde el color, por
   * `riesgoInactivo`).
   */
  readonly estaArchivado = computed(() => this.caso()?.estado === 'Archivado');

  /**
   * Riel del expediente (items 67 y 97). El expediente se reduce a cuatro
   * piezas: línea de tiempo, mapeo de actores, caso de análisis y documentos
   * vinculados. «Caso de análisis (Canva)» se declara no disponible porque el
   * caso no guarda un tablero asociado; no se inventa un enlace.
   *
   * Sólo lee lo que ya está en el detalle: no lanza consultas adicionales.
   */
  readonly enlacesRiel = computed<readonly EnlaceRiel[]>(() => {
    const ficha = this.ficha();
    if (!ficha) return [];
    return [
      {
        etiqueta: 'Mapeo de actores',
        ancla: 'actores-caso',
        contador: ficha.actores.length,
        icono: 'actores',
      },
      {
        etiqueta: 'Línea de tiempo',
        ancla: 'eventos-caso',
        // La ficha sólo lista el último hecho reciente: el contador debe
        // describir lo que se ve y no el histórico del caso.
        contador: this.hechosVisibles().length,
        icono: 'actividad',
      },
      {
        etiqueta: 'Demandas',
        ancla: 'demandas-caso',
        contador: ficha.demandas.length,
        icono: 'documentos',
      },
      {
        etiqueta: 'Acuerdos y compromisos',
        ancla: 'compromisos-caso',
        contador: ficha.compromisos.length,
        icono: 'compromisos',
      },

      {
        etiqueta: 'Documentos',
        ancla: 'documentos-caso',
        contador: ficha.documentos.length,
        icono: 'documentos',
      },
    ];
  });

  /** Edición del enlace del tablero de Canva desde el riel (item 29). */
  readonly editandoCanva = signal(false);
  readonly borradorCanva = signal('');
  readonly guardandoCanva = signal(false);
  readonly errorCanva = signal<string | null>(null);

  abrirCanva(): void {
    if (!this.puedeModificar() || !this.modoEdicion()) return;
    this.errorCanva.set(null);
    this.borradorCanva.set(this.caso()?.enlaceAnalisis ?? '');
    this.editandoCanva.set(true);
  }

  cancelarCanva(): void {
    if (this.guardandoCanva()) return;
    this.editandoCanva.set(false);
    this.borradorCanva.set('');
    this.errorCanva.set(null);
  }

  alEscribirCanva(evento: Event): void {
    this.borradorCanva.set((evento.target as HTMLInputElement).value);
  }

  /**
   * Normaliza el enlace del tablero: si no trae protocolo se antepone
   * `https://`, de modo que `www.canva.com/…` se guarde como URL absoluta. El
   * backend aplica la misma normalización en `urlOpcional` antes de validar.
   */
  private normalizarEnlaceCanva(valor: string): string {
    const limpio = valor.trim();
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(limpio) ? limpio : `https://${limpio}`;
  }

  guardarCanva(evento: Event): void {
    evento.preventDefault();
    const codigo = this.codigo();
    const url = this.normalizarEnlaceCanva(this.borradorCanva());
    if (!codigo || !this.borradorCanva().trim() || this.guardandoCanva()) return;

    this.guardandoCanva.set(true);
    this.errorCanva.set(null);
    this.http
      .patch<unknown>(urlApi(`/v1/cases/${encodeURIComponent(codigo)}`), { enlaceAnalisis: url })
      .subscribe({
        next: (respuesta) => {
          this.guardandoCanva.set(false);
          this.detalleActualizado.set(aDetalleCasoConCompromisos(respuesta));
          this.editandoCanva.set(false);
          this.borradorCanva.set('');
        },
        error: (fallo: unknown) => {
          this.guardandoCanva.set(false);
          this.errorCanva.set(this.mensajeDeErrorCampo(fallo));
        },
      });
  }

  /**
   * Copia el hecho visible en formato WhatsApp (`*05NOV2026* - texto`) sin
   * abrir ningún editor (item 34). La ficha sólo lista el último hecho
   * reciente, así que la copia usa esa misma lista.
   */
  async copiarCronologia(eventos: readonly EventoCaso[]): Promise<void> {
    if (eventos.length === 0) return;
    const texto = eventos
      .map((evento) => `*${this.fechaCorta(evento.fecha)}* - ${evento.descripcion}`)
      .join('\n');
    const ok = await copiarAlPortapapeles(texto);
    this.avisoCronologia.set(
      ok
        ? 'Hecho copiado al portapapeles.'
        : 'No se pudo copiar. Seleccione el texto y use Ctrl + C.',
    );
  }

  readonly avisoCronologia = signal<string | null>(null);

  /** Mismo criterio que la ficha de alerta: el rol debe poder escribir el caso. */
  readonly puedeModificar = computed(() => {
    const caso = this.caso();
    if (!caso || this.anulado()) return false;
    return this.capacidades.puedeModificar(caso.clasificacion);
  });

  /** Anular y restaurar exigen, además de escritura, el privilegio de anulación. */
  readonly puedeAnular = computed(() => {
    const caso = this.caso();
    if (!caso) return false;
    return this.capacidades.puedeEliminar() && this.capacidades.puedeModificar(caso.clasificacion);
  });

  /**
   * Edición explícita por campo (item 18). El estado no está aquí: se cambia
   * con Archivar/Reabrir, más abajo.
   */
  /**
   * Campos visibles en la ficha. Los retirados por el ajuste del 22 nov no se
   * pintan, aunque `PATCH` siga admitiéndolos.
   */
  readonly campos = CAMPOS_EDITABLES.filter((definicion) => !CAMPOS_OCULTOS.has(definicion.campo));

  /**
   * Interruptor de edición: sustituye a los botones «Editar» sueltos. Apagado,
   * la ficha se lee; encendido, aparecen las acciones de edición.
   */
  readonly modoEdicion = signal(false);
  readonly editando = signal<CampoEditable | null>(null);
  readonly borrador = signal('');
  readonly guardandoCampo = signal(false);
  readonly errorCampo = signal<string | null>(null);
  readonly avisoCampo = signal<string | null>(null);

  readonly editandoSectorista = signal(false);
  readonly borradorSectorista = signal('');
  readonly guardandoSectorista = signal(false);
  readonly errorSectorista = signal<string | null>(null);

  /** UUID del sectorista actual; vacío si el caso no tiene foco asignado. */
  readonly sectoristaActualId = computed(() => this.caso()?.sectoristaUsuarioId ?? '');

  /**
   * Catálogos de los desplegables. Se piden sólo cuando el rol puede escribir:
   * un lector no necesita este tráfico adicional.
   */
  private readonly catalogoEdicion = consulta<CatalogosEdicion>({
    fuente: () => (this.puedeModificar() ? urlApi('/v1/catalogs') : null),
    esquema: aCatalogosEdicion,
  });

  readonly cargandoCatalogos = computed(() => {
    const estado = this.catalogoEdicion.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  /**
   * Catálogo de sectoristas para el select del cuadro de datos. Sale de la misma
   * respuesta de `/v1/catalogs` que el resto de desplegables: una sola petición.
   */
  readonly sectoristas = computed(() => this.catalogoEdicion.valor()?.sectoristas ?? []);

  /**
   * Nombre del sectorista para la ficha. La API resuelve `sectorista` con un
   * join a `core.usuarios`, tabla con RLS que sólo deja ver al administrador o
   * la fila propia: para el resto de roles llega nulo. El catálogo de la
   * migración 74 sí trae el nombre, así que se usa como respaldo.
   */
  readonly sectoristaNombre = computed(() => {
    const id = this.sectoristaActualId();
    const nombre = id ? this.sectoristas().find((opcion) => opcion.id === id)?.nombre : undefined;
    return nombre ?? this.caso()?.sectorista ?? '';
  });

  /**
   * Marca de la Dirección OAIPCS (`core.casos.priorizado`, migración 76). Es una
   * decisión explícita: no se deriva del riesgo ni de la prioridad de atención.
   */
  readonly esDireccion = this.capacidades.esDireccion;
  readonly priorizadoActual = computed(() => this.caso()?.priorizado === true);
  readonly guardandoPriorizado = signal(false);
  readonly errorPriorizado = signal<string | null>(null);

  /**
   * `PATCH /api/v1/cases/{codigo}` con sólo `priorizado`. La API responde 403 si
   * el rol no es de Dirección, así que la casilla se protege dos veces: aquí y
   * en el backend.
   */
  alternarPriorizado(evento: Event): void {
    const codigo = this.codigo();
    if (!codigo || !this.esDireccion() || this.guardandoPriorizado()) return;
    const casilla = evento.target as HTMLInputElement;
    const valor = casilla.checked;
    if (valor === this.priorizadoActual()) return;

    this.guardandoPriorizado.set(true);
    this.errorPriorizado.set(null);
    this.http
      .patch<unknown>(urlApi(`/v1/cases/${encodeURIComponent(codigo)}`), { priorizado: valor })
      .subscribe({
        next: (respuesta) => {
          this.guardandoPriorizado.set(false);
          this.detalleActualizado.set(aDetalleCasoConCompromisos(respuesta));
          this.avisoCampo.set(
            valor ? 'Caso marcado como priorizado.' : 'Caso desmarcado como priorizado.',
          );
        },
        error: (fallo: unknown) => {
          this.guardandoPriorizado.set(false);
          // La casilla vuelve a su estado real: un control no puede quedarse
          // mostrando algo que no se guardó.
          casilla.checked = this.priorizadoActual();
          this.errorPriorizado.set(this.mensajeDeErrorCampo(fallo));
        },
      });
  }

  /**
   * Valores actuales del caso. Los campos de catálogo se resuelven a su valor
   * canónico para que abrir y guardar sin cambios no envíe un `PATCH` espurio.
   */
  readonly valoresCaso = computed<ValoresEditables>(() => {
    const caso = this.caso();
    if (!caso) return VALORES_VACIOS;

    const base = valoresDeCaso(caso);
    const catalogo = this.catalogoEdicion.valor();
    if (!catalogo) return base;

    const resuelto: ValoresEditables = { ...base };
    for (const definicion of CAMPOS_EDITABLES) {
      if (!definicion.catalogo) continue;
      const canonico = resolverValorCatalogo(catalogo[definicion.catalogo], base[definicion.campo]);
      if (canonico) resuelto[definicion.campo] = canonico;
    }
    return resuelto;
  });

  /** Valor del control en línea: un `select` se pinta con el código canónico. */
  readonly valorControl = computed(() => {
    const campo = this.editando();
    const valor = this.borrador();
    if (!campo) return valor;
    if (definicionDe(campo).control !== 'select') return valor;
    return resolverValorCatalogo(this.opcionesDe(campo), valor) ?? valor;
  });

  /** Acción de estado disponible (item 37): archivar o reabrir. */
  readonly accionEstado = computed<AccionEstado | null>(() => {
    const caso = this.caso();
    return caso ? accionDeEstado(caso.estado) : null;
  });

  readonly confirmandoArchivo = signal<'archivar' | 'reabrir' | null>(null);
  readonly enviandoArchivo = signal(false);
  readonly errorArchivo = signal<string | null>(null);
  readonly avisoArchivo = signal<string | null>(null);

  readonly panelAnulacion = signal<ModoAnulacion | null>(null);
  readonly enviandoAnulacion = signal(false);
  readonly errorAnulacion = signal<string | null>(null);
  readonly avisoAnulacion = signal<string | null>(null);

  /** Hecho abierto en el panel; `null` significa alta. */
  readonly eventoEditado = signal<EventoCaso | null>(null);
  readonly panelHechoAbierto = signal(false);
  readonly guardandoEvento = signal(false);
  readonly errorEvento = signal<string | null>(null);

  /** Demanda abierta en el panel; `null` significa alta. */
  readonly demandaEditada = signal<DemandaCasoConTematica | null>(null);
  readonly panelDemandaAbierto = signal(false);
  readonly guardandoDemanda = signal(false);
  readonly errorDemanda = signal<string | null>(null);
  readonly avisoDemanda = signal<string | null>(null);

  /** Alerta vinculada abierta en el panel de sólo lectura; `null` lo cierra. */
  readonly alertaVinculada = signal<AlertaCaso | null>(null);

  /**
   * La tabla del expediente sólo trae el resumen de la alerta. El panel necesita
   * la ficha completa, así que se pide al abrir: una lectura por alerta abierta.
   */
  private readonly detalleAlerta = consulta<DetalleAlerta>({
    fuente: () => {
      const alerta = this.alertaVinculada();
      return alerta ? urlApi(`/v1/alerts/${encodeURIComponent(alerta.id)}`) : null;
    },
    esquema: aDetalleAlerta,
  });

  /** Descarta la respuesta de una alerta anterior mientras carga la nueva. */
  private readonly detalleAlertaVigente = computed(() => {
    const abierta = this.alertaVinculada();
    const detalle = this.detalleAlerta.valor();
    return abierta && detalle && detalle.alerta.id === abierta.id ? detalle : null;
  });

  readonly alertaPanel = computed(() => this.detalleAlertaVigente()?.alerta ?? null);
  readonly cargandoAlerta = computed(
    () => this.detalleAlerta.estado() === 'cargando' && this.detalleAlertaVigente() === null,
  );
  readonly errorAlerta = this.detalleAlerta.error;
  readonly panelAlertaAbierto = computed(() => this.alertaVinculada() !== null);

  abrirAlerta(alerta: AlertaCaso): void {
    this.alertaVinculada.set(alerta);
  }

  cerrarPanelAlerta(): void {
    this.alertaVinculada.set(null);
  }

  recargarAlerta(): void {
    this.detalleAlerta.recargar();
  }

  /**
   * El catálogo de tipos de hecho sólo se pide al abrir el panel: la ficha en
   * lectura no necesita tráfico adicional.
   */
  private readonly catalogoTipos = consulta<readonly OpcionTipoHecho[]>({
    fuente: () => (this.panelHechoAbierto() ? urlApi('/v1/catalogs') : null),
    esquema: aTiposHecho,
  });

  readonly tiposHecho = computed(() => this.catalogoTipos.valor() ?? []);

  readonly cargandoTipos = computed(() => {
    const estado = this.catalogoTipos.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  /**
   * Catálogo de temáticas con su `id` numérico, que es lo que espera
   * `tematicaId` en el alta y la edición de demandas. Igual que el de tipos de
   * hecho, sólo se pide al abrir el panel: la ficha en lectura no lo necesita.
   */
  private readonly catalogoTematicas = consulta<readonly OpcionTematicaDemanda[]>({
    fuente: () => (this.panelDemandaAbierto() ? urlApi('/v1/catalogs') : null),
    esquema: aTematicasDemanda,
  });

  readonly tematicasDemanda = computed(() => this.catalogoTematicas.valor() ?? []);

  readonly cargandoTematicasDemanda = computed(() => {
    const estado = this.catalogoTematicas.estado();
    return estado === 'inactivo' || estado === 'cargando';
  });

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  recargar(): void {
    this.detalleActualizado.set(null);
    this.recurso.recargar();
    this.actoresRecurso.recargar();
  }

  /** Opciones de un desplegable según el catálogo ya cargado. */
  opcionesDe(campo: CampoEditable): readonly OpcionCatalogo[] {
    return opcionesDeCampo(this.catalogoEdicion.valor(), campo);
  }

  /**
   * Valor que no existe en el catálogo (base sin migrar). Se conserva como
   * opción para que el `select` no cambie de valor sin que el usuario lo pida.
   */
  opcionDesconocida(campo: CampoEditable): string | null {
    const valor = this.valorControl();
    const opciones = this.opcionesDe(campo);
    if (!valor || opciones.length === 0) return null;
    return opciones.some((opcion) => opcion.valor === valor) ? null : valor;
  }

  /** Texto de lectura del recuadro: fecha y número llevan formato propio. */
  valorMostrado(campo: CampoEditable): string {
    const valor = this.valoresCaso()[campo];
    if (!valor) return '—';
    if (campo === 'pctAvance') return `${valor} %`;
    if (campo === 'fechaInicio' || campo === 'fechaCierre') return this.fechaTexto(valor);
    // La unidad se rotula con sus siglas, como en la cabecera y el mockup; el
    // catálogo aporta el nombre completo como etiqueta, que aquí no cabe.
    if (campo === 'unidadResponsable') return valor;
    return etiquetaDeCatalogo(this.opcionesDe(campo), valor) ?? valor;
  }

  /** Abre un recuadro en línea. No hay cierre por clic fuera: ver plantilla. */
  abrirEdicion(campo: CampoEditable): void {
    if (!this.puedeModificar() || !this.modoEdicion()) return;
    this.errorCampo.set(null);
    this.avisoCampo.set(null);
    this.borrador.set(this.valoresCaso()[campo]);
    this.editando.set(campo);
  }

  /**
   * Edición de la ficha: apagada, la ficha se lee; encendida, aparecen las
   * acciones de edición. Al apagarla se cancela cualquier recuadro abierto.
   */
  alternarModoEdicion(): void {
    if (this.modoEdicion()) {
      this.modoEdicion.set(false);
      this.cancelarEdicion();
      return;
    }
    if (!this.puedeModificar()) return;
    this.modoEdicion.set(true);
    // El punto focal se edita con la ficha: al entrar en modo edición el select
    // queda listo, sin un segundo clic en «Editar».
    if (this.sectoristas().length > 0) this.abrirSectorista();
  }

  alCambiarCampo(evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    this.borrador.set(objetivo.value);
    this.errorCampo.set(null);
  }

  cancelarEdicion(): void {
    if (this.guardandoCampo()) return;
    this.editando.set(null);
    this.borrador.set('');
    this.errorCampo.set(null);
  }

  /**
   * `PATCH /api/v1/cases/{codigo}` con una sola clave. La respuesta es el
   * detalle completo, así que se publica en `detalleActualizado` sin recargar
   * la página ni perder el resto del expediente.
   */
  guardarCampo(): void {
    const campo = this.editando();
    const codigo = this.codigo();
    if (!campo || !codigo || !this.puedeModificar() || this.guardandoCampo()) return;

    const validado = validarValorCampo(campo, this.borrador());
    if (!validado.valido) {
      this.errorCampo.set(validado.mensaje);
      return;
    }

    const cuerpo = cuerpoPatchDeCampo(campo, this.valoresCaso()[campo], this.borrador());
    if (sinCambios(cuerpo)) {
      this.errorCampo.set('No hay cambios que guardar.');
      return;
    }

    this.guardandoCampo.set(true);
    this.errorCampo.set(null);

    this.http.patch<unknown>(urlApi(`/v1/cases/${encodeURIComponent(codigo)}`), cuerpo).subscribe({
      next: (respuesta) => {
        this.guardandoCampo.set(false);
        this.detalleActualizado.set(aDetalleCasoConCompromisos(respuesta));
        this.editando.set(null);
        this.borrador.set('');
        this.avisoCampo.set(`${definicionDe(campo).etiqueta} actualizado.`);
      },
      error: (fallo: unknown) => {
        this.guardandoCampo.set(false);
        this.errorCampo.set(this.mensajeDeErrorCampo(fallo));
      },
    });
  }

  /** Abre el editor del sectorista a partir del valor actual del caso. */
  abrirSectorista(): void {
    if (!this.puedeModificar() || !this.modoEdicion()) return;
    const actual = this.sectoristaActualId();
    // Si el usuario actual no está en el catálogo (p. ej. desactivado), el
    // select arranca vacío para no ofrecer una opción inexistente.
    this.borradorSectorista.set(
      this.sectoristas().some((opcion) => opcion.id === actual) ? actual : '',
    );
    this.errorSectorista.set(null);
    this.editandoSectorista.set(true);
  }

  alCambiarSectorista(evento: Event): void {
    this.borradorSectorista.set((evento.target as HTMLSelectElement).value);
    this.errorSectorista.set(null);
  }

  cancelarSectorista(): void {
    if (this.guardandoSectorista()) return;
    this.editandoSectorista.set(false);
    this.borradorSectorista.set('');
    this.errorSectorista.set(null);
  }

  /**
   * `PATCH /api/v1/cases/{codigo}` con `sectoristaId`; vaciarlo envía `null` y
   * desasigna el foco. El backend valida que sea un usuario activo con rol
   * `sectorista` y responde 422 en caso contrario.
   */
  guardarSectorista(): void {
    const codigo = this.codigo();
    if (!codigo || !this.puedeModificar() || this.guardandoSectorista()) return;
    const id = this.borradorSectorista();
    if (id === (this.sectoristaActualId() || '')) {
      this.errorSectorista.set('No hay cambios que guardar.');
      return;
    }

    this.guardandoSectorista.set(true);
    this.errorSectorista.set(null);
    this.http
      .patch<unknown>(urlApi(`/v1/cases/${encodeURIComponent(codigo)}`), {
        sectoristaId: id || null,
      })
      .subscribe({
        next: (respuesta) => {
          this.guardandoSectorista.set(false);
          this.detalleActualizado.set(aDetalleCasoConCompromisos(respuesta));
          this.editandoSectorista.set(false);
          this.borradorSectorista.set('');
          this.avisoCampo.set('Sectorista actualizado.');
        },
        error: (fallo: unknown) => {
          this.guardandoSectorista.set(false);
          this.errorSectorista.set(this.mensajeDeErrorCampo(fallo));
        },
      });
  }

  /** Abre el aviso de confirmación dentro de la cabecera; nunca `window.confirm`. */
  abrirConfirmacionArchivo(): void {
    const accion = this.accionEstado();
    if (!accion || !this.puedeModificar()) return;
    this.errorArchivo.set(null);
    this.avisoArchivo.set(null);
    this.confirmandoArchivo.set(accion.modo);
  }

  cancelarArchivo(): void {
    if (this.enviandoArchivo()) return;
    this.confirmandoArchivo.set(null);
    this.errorArchivo.set(null);
  }

  /**
   * Item 37: Archivar/Reabrir como transición visible. Archivar es un estado
   * del caso, no una baja: la anulación (papelera, con motivo) es otra acción y
   * se conserva aparte.
   */
  confirmarArchivo(): void {
    const modo = this.confirmandoArchivo();
    const codigo = this.codigo();
    if (!modo || !codigo || !this.puedeModificar() || this.enviandoArchivo()) return;

    const destino = modo === 'archivar' ? ESTADO_ARCHIVADO : ESTADO_ABIERTO;
    this.enviandoArchivo.set(true);
    this.errorArchivo.set(null);

    this.http
      .patch<unknown>(urlApi(`/v1/cases/${encodeURIComponent(codigo)}`), { estado: destino })
      .subscribe({
        next: (respuesta) => {
          this.enviandoArchivo.set(false);
          this.confirmandoArchivo.set(null);
          this.detalleActualizado.set(aDetalleCasoConCompromisos(respuesta));
          this.avisoArchivo.set(
            modo === 'archivar'
              ? 'Caso archivado. Sigue disponible y puede reabrirse; anular es una operación distinta.'
              : 'Caso reabierto: volvió al estado Abierto.',
          );
        },
        error: (fallo: unknown) => {
          this.enviandoArchivo.set(false);
          this.errorArchivo.set(this.mensajeDeErrorArchivo(fallo));
        },
      });
  }

  /**
   * Estado de un hito. Revierte el `select` si el valor no es del catálogo o no
   * cambió, y delega el `PATCH` en `guardarCambioHito`.
   */
  async cambiarEstadoHito(hito: HitoEnCaso, evento: Event): Promise<void> {
    const select = evento.target as HTMLSelectElement;
    const estado = select.value;
    const anterior = hito.estado ?? '';
    if (!esEstadoHitoFicha(estado) || estado === anterior) return;
    await this.guardarCambioHito(hito, { estado }, () => {
      select.value = anterior;
    });
  }

  /** Fecha real del hito (`fechaReal`); vaciarla envía `null`. */
  async cambiarFechaRealHito(hito: HitoEnCaso, evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const fechaReal = input.value.trim();
    const anterior = hito.fechaReal ?? '';
    if (fechaReal === anterior) return;
    await this.guardarCambioHito(hito, { fechaReal: fechaReal || null }, () => {
      input.value = anterior;
    });
  }

  /** Responsable del hito (`responsableTexto`); vaciarlo envía `null`. */
  async cambiarResponsableHito(hito: HitoEnCaso, evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const nuevo = input.value.trim();
    const anterior = (hito.responsableTexto ?? '').trim();
    if (nuevo === anterior) return;
    await this.guardarCambioHito(hito, { responsableTexto: nuevo || null }, () => {
      input.value = anterior;
    });
  }

  /**
   * `PATCH /api/v1/commitments/{compromisoId}/hitos/{hitoId}` con una sola
   * clave. Mismo manejo que el panel de compromisos: se bloquea el hito en
   * vuelo, se revierte el control si falla y se recarga la ficha al terminar.
   */
  private async guardarCambioHito(
    hito: HitoEnCaso,
    cuerpo: Record<string, unknown>,
    revertir: () => void,
  ): Promise<void> {
    if (!this.puedeModificar()) {
      revertir();
      this.errorHitos.set('No tiene permisos para modificar los hitos de este caso.');
      return;
    }

    if (!hito.id || !hito.compromisoId) {
      revertir();
      this.errorHitos.set('El hito no tiene identificador; no se puede actualizar.');
      return;
    }

    if (this.guardandoHito() === hito.id) return;

    this.guardandoHito.set(hito.id);
    this.errorHitos.set(null);

    try {
      await firstValueFrom(
        this.http.patch<unknown>(
          urlApi(
            `/v1/commitments/${encodeURIComponent(hito.compromisoId)}/hitos/${encodeURIComponent(hito.id)}`,
          ),
          cuerpo,
        ),
      );
      this.recargar();
    } catch (fallo) {
      revertir();
      this.errorHitos.set(this.mensajeDeErrorHito(fallo));
    } finally {
      this.guardandoHito.set(null);
    }
  }

  /** Fecha de inicio del caso en `02NOV2025`; `—` cuando no está registrada. */
  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor) || '—';
  }

  /**
   * Formato compacto de la cronología (`15NOV2026`), el que pide el ajuste del
   * 22 nov para la línea de tiempo.
   */
  fechaCorta(valor: string | null | undefined): string {
    return formatearFechaCompacta(valor);
  }

  /**
   * Organización del actor para la columna «Institución»: la resuelta por la API
   * o, si el propio actor es una organización, su nombre. Sin dato, «—».
   */
  institucionActor(actor: ActorCaso): string {
    const organizacion = actor.organizacion?.trim();
    if (organizacion) return organizacion;
    if (actor.naturaleza === 'organizacion') return this.nombreActor(actor);
    return '—';
  }

  /** Cargo declarado del actor; «—» cuando la API no lo trae. */
  cargoActor(actor: ActorCaso): string {
    return actor.cargo?.trim() || '—';
  }

  /** Teléfono de contacto público del actor; «—» cuando no llega. */
  telefonoActor(actor: ActorCaso): string {
    return actor.telefono?.trim() || '—';
  }

  /**
   * Copia un solo dato de contacto de la tabla de actores (teléfono o correo).
   * Se reutiliza `avisoActores` para no inventar otra región de estado.
   */
  async copiarDato(valor: string | null | undefined, etiqueta: string): Promise<void> {
    this.avisoActores.set(null);
    const limpio = (valor ?? '').trim();
    if (!limpio) return;
    const ok = await copiarAlPortapapeles(limpio);
    this.avisoActores.set(
      ok
        ? `${etiqueta} copiado al portapapeles.`
        : 'No se pudo copiar. Seleccione el valor y use Ctrl + C.',
    );
  }

  /**
   * Organizaciones solicitantes: las demandas siempre provienen de personas
   * jurídicas y el caso ya relaciona sus organizaciones como actores. Se
   * deduplican nombres para no repetir el distintivo de una misma institución.
   */
  readonly organizacionesDelCaso = computed<readonly string[]>(() => {
    const nombres = (this.ficha()?.actores ?? [])
      .filter((actor) => actor.naturaleza === 'organizacion')
      .map((actor) => this.nombreActor(actor).trim())
      .filter((nombre) => nombre.length > 0);
    return [...new Set(nombres)];
  });

  /**
   * Nombre visible del actor. `core.actores` sólo guarda `nombre_actual`: hoy
   * `apellidos` y `nombres` llegan nulos y no se parten por espacios. Si alguna
   * vez se pueblan, se concatenan en ese orden y sustituyen a `nombre`.
   */
  nombreActor(actor: ActorCaso): string {
    const partes = [actor.apellidos, actor.nombres].filter(
      (parte): parte is string => parte !== null,
    );
    return partes.length > 0 ? partes.join(' ') : actor.nombre;
  }

  /** `Regional` se muestra como «GORE», igual que en el módulo de Compromisos. */
  nivelGobiernoTexto(valor: string | null): string {
    return etiquetaNivelGobierno(valor);
  }

  /** Item 16: clasificación de alcance; sin dato, «Sin declarar». */
  clasificacionAlcanceTexto(valor: ClasificacionAlcance | null): string {
    return etiquetaClasificacionAlcance(valor);
  }

  /** Item 16: carácter formal o verbal; sin dato, «Sin declarar». */
  formalVerbalTexto(valor: FormalVerbal | null): string {
    return etiquetaFormalVerbal(valor);
  }

  /** Texto corto de la demanda para las etiquetas accesibles de la tabla. */
  referenciaDemanda(demanda: DemandaCaso): string {
    const texto = (demanda.descripcion ?? demanda.problema ?? '').trim();
    if (!texto) return 'sin demanda';
    return texto.length > 60 ? `${texto.slice(0, 57)}…` : texto;
  }

  /** Etiqueta accesible del enlace al documento que originó la demanda. */
  etiquetaDocumentoOrigen(demanda: DemandaCaso): string {
    const codigo = demanda.documentoOrigenCodigo ?? '';
    return demanda.documentoOrigenTitulo
      ? `Ver el documento ${codigo}: ${demanda.documentoOrigenTitulo} en Documentos`
      : `Ver el documento ${codigo} en Documentos`;
  }

  registrarHecho(): void {
    if (!this.puedeModificar()) return;
    this.errorEvento.set(null);
    this.eventoEditado.set(null);
    this.panelHechoAbierto.set(true);
  }

  editarHecho(evento: EventoCaso): void {
    if (!this.puedeModificar()) return;
    this.errorEvento.set(null);
    this.eventoEditado.set(evento);
    this.panelHechoAbierto.set(true);
  }

  cerrarPanelHecho(): void {
    this.panelHechoAbierto.set(false);
    this.eventoEditado.set(null);
    this.errorEvento.set(null);
  }

  /** Hecho pendiente de confirmación para quitar de la cronología. */
  readonly hechoAQuitar = signal<string | null>(null);
  readonly quitandoHecho = signal(false);
  readonly errorCronologia = signal<string | null>(null);

  pedirQuitarHecho(eventoId: string): void {
    if (!this.puedeModificar() || !this.modoEdicion()) return;
    this.errorCronologia.set(null);
    this.avisoCronologia.set(null);
    this.hechoAQuitar.set(eventoId);
  }

  cancelarQuitarHecho(): void {
    if (this.quitandoHecho()) return;
    this.hechoAQuitar.set(null);
    this.errorCronologia.set(null);
  }

  /**
   * `DELETE /v1/cases/{codigo}/events/{eventId}`. La API exige un motivo
   * (`leerMotivo`), por eso se envía en el cuerpo. La baja es lógica y, al
   * terminar, se recarga la ficha para releer la cronología del servidor.
   */
  confirmarQuitarHecho(eventoId: string): void {
    const codigo = this.codigo();
    if (!codigo || !this.puedeModificar() || this.quitandoHecho()) return;
    this.quitandoHecho.set(true);
    this.errorCronologia.set(null);
    const url = urlApi(
      `/v1/cases/${encodeURIComponent(codigo)}/events/${encodeURIComponent(eventoId)}`,
    );
    this.http.delete<unknown>(url, { body: { motivo: 'Quitado desde la cronología' } }).subscribe({
      next: () => {
        this.quitandoHecho.set(false);
        this.hechoAQuitar.set(null);
        this.recargar();
        this.avisoCronologia.set('Hecho quitado de la cronología.');
      },
      error: (fallo: unknown) => {
        this.quitandoHecho.set(false);
        this.errorCronologia.set(this.mensajeDeError(fallo));
      },
    });
  }

  guardarHecho(cambios: CuerpoEvento): void {
    const codigo = this.codigo();
    if (!codigo) return;

    const evento = this.eventoEditado();
    const base = `/v1/cases/${encodeURIComponent(codigo)}/events`;
    const url = urlApi(evento ? `${base}/${encodeURIComponent(evento.id)}` : base);
    const peticion = evento
      ? this.http.patch<unknown>(url, cambios)
      : this.http.post<unknown>(url, cambios);

    this.guardandoEvento.set(true);
    this.errorEvento.set(null);

    peticion.subscribe({
      next: () => {
        this.guardandoEvento.set(false);
        this.panelHechoAbierto.set(false);
        this.eventoEditado.set(null);
        this.recargar();
      },
      error: (fallo: unknown) => {
        this.guardandoEvento.set(false);
        this.errorEvento.set(this.mensajeDeError(fallo));
      },
    });
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  /** Aviso del bloque de actores tras copiar o descargar (items 99 y 102). */
  readonly avisoActores = signal<string | null>(null);

  /** El administrador imprime; el resto sólo guarda el PDF de la ficha. */
  readonly esAdmin = this.capacidades.esAdmin;

  /**
   * Línea de WhatsApp por actor (item 99), con el formato pedido:
   * `- Apellidos, Nombres - Organización - teléfono - correo`.
   *
   * La organización y el teléfono ya llegan en el detalle del caso; si algún
   * actor no los trae, el hueco se declara con un guion en vez de rellenarse.
   */
  private lineaWhatsApp(actor: ActorCaso): string {
    const campos = [
      this.nombreActor(actor),
      this.institucionActor(actor),
      this.telefonoActor(actor),
      actor.correo || '—',
    ];
    return `- ${campos.join(' - ')}`;
  }

  async copiarActoresWhatsApp(actores: readonly ActorCaso[]): Promise<void> {
    this.avisoActores.set(null);
    if (actores.length === 0) return;

    const texto = actores.map((actor) => this.lineaWhatsApp(actor)).join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      this.avisoActores.set(`Se copiaron ${actores.length} actores con el formato de WhatsApp.`);
    } catch {
      this.avisoActores.set(
        'El navegador no permitió copiar al portapapeles. Use «Exportar CSV» y comparta el archivo.',
      );
    }
  }

  /**
   * Exportación local de la tabla de actores (item 102).
   *
   * `/v1/export` no acepta `caso` para la entidad `actores`, así que el archivo
   * se arma con las filas que la ficha ya tiene en pantalla: exporta lo que se
   * ve, sin una consulta nueva. Separador `;` y BOM porque es lo que Excel en
   * es-PE abre de una pasada.
   */
  exportarActoresCsv(actores: readonly ActorCaso[]): void {
    this.avisoActores.set(null);
    if (actores.length === 0) return;
    if (!isPlatformBrowser(this.plataforma)) return;

    const escapar = (valor: string | null | undefined): string =>
      `"${(valor ?? '').replace(/"/g, '""')}"`;
    const filas = [
      ['Actor', 'Institución', 'Cargo', 'Teléfono', 'Correo', 'Tipologías'].map(escapar).join(';'),
      ...actores.map((actor) =>
        [
          this.nombreActor(actor),
          this.institucionActor(actor),
          this.cargoActor(actor),
          this.telefonoActor(actor),
          actor.correo,
          textoTipologias(actor),
        ]
          .map(escapar)
          .join(';'),
      ),
    ];
    const contenido = `\uFEFF${filas.join('\r\n')}`;
    const archivo = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = `${this.caso()?.codigo ?? 'caso'}-actores.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
    this.avisoActores.set(`Se descargaron ${actores.length} actores de la ficha.`);
  }

  /* ----------------------------------------------------------------------- *
   * Vínculo de actores: alta y baja lógica
   * --------------------------------------------------------------------- */

  readonly panelVincularAbierto = signal(false);
  readonly guardandoVinculo = signal(false);
  readonly errorVinculo = signal<string | null>(null);

  readonly actorADesvincular = signal<string | null>(null);
  readonly enviandoBaja = signal(false);
  readonly errorBaja = signal<string | null>(null);
  readonly avisoBaja = signal<string | null>(null);

  actorVinculo(id: string): CasoActorFila | undefined {
    return this.mapaActores().get(id);
  }

  estaVigente(id: string): boolean {
    return this.actorVinculo(id)?.vigente ?? true;
  }

  abrirVincularActor(): void {
    if (!this.puedeModificar()) return;
    this.errorVinculo.set(null);
    this.avisoBaja.set(null);
    this.panelVincularAbierto.set(true);
  }

  cerrarVincularActor(): void {
    this.panelVincularAbierto.set(false);
    this.errorVinculo.set(null);
  }

  guardarVincularActor(cuerpo: CuerpoVincularActor): void {
    const codigo = this.codigo();
    if (!codigo) return;

    this.guardandoVinculo.set(true);
    this.errorVinculo.set(null);

    const url = urlApi(`/v1/cases/${encodeURIComponent(codigo)}/actores`);
    this.http.post<unknown>(url, cuerpo).subscribe({
      next: () => {
        this.guardandoVinculo.set(false);
        this.panelVincularAbierto.set(false);
        // `recargar()` limpia `detalleActualizado`. Sin eso, `ficha()` seguiría
        // leyendo la instantánea del último `PATCH` y el actor recién vinculado
        // no aparecería hasta refrescar la página.
        this.recargar();
        this.avisoActores.set('Actor vinculado al caso.');
      },
      error: (fallo: unknown) => {
        this.guardandoVinculo.set(false);
        this.errorVinculo.set(this.mensajeDeErrorVinculo(fallo));
      },
    });
  }

  pedirDesvincular(actorId: string): void {
    if (!this.puedeModificar()) return;
    this.actorADesvincular.set(actorId);
    this.errorBaja.set(null);
    this.avisoBaja.set(null);
    this.avisoActores.set(null);
  }

  cancelarDesvincular(): void {
    this.actorADesvincular.set(null);
    this.errorBaja.set(null);
  }

  /**
   * Baja lógica sin motivo. El contrato actual de
   * `DELETE /v1/cases/{codigo}/actores/{actorId}` todavía lo exige
   * (`leerMotivo` en `lib/db/http.ts`), así que la petición recibirá
   * `400 MOTIVO_REQUERIDO` hasta que la API relaje el requisito.
   */
  confirmarDesvincular(): void {
    const actorId = this.actorADesvincular();
    const codigo = this.codigo();
    if (!actorId || !codigo || this.enviandoBaja()) return;

    const url = urlApi(
      `/v1/cases/${encodeURIComponent(codigo)}/actores/${encodeURIComponent(actorId)}`,
    );
    this.enviandoBaja.set(true);
    this.errorBaja.set(null);

    this.http.delete<unknown>(url).subscribe({
      next: () => {
        this.enviandoBaja.set(false);
        this.actorADesvincular.set(null);
        // Mismo motivo que en el alta: la instantánea del `PATCH` oculta la recarga.
        this.recargar();
        this.avisoActores.set('Actor desvinculado del caso. El histórico se conserva.');
      },
      error: (fallo: unknown) => {
        this.enviandoBaja.set(false);
        this.errorBaja.set(this.mensajeDeErrorVinculo(fallo));
      },
    });
  }

  private mensajeDeErrorVinculo(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) {
      return 'Su rol no permite modificar los actores de este caso.';
    }
    // El mensaje de `503 MIGRACION_PENDIENTE` se muestra tal cual: explica qué
    // migración falta y evita que el usuario crea que el fallo es suyo.
    return error.message;
  }

  /** Impresión de la ficha (item 42): usa la hoja `@media print` del componente. */
  imprimir(): void {
    if (!isPlatformBrowser(this.plataforma)) return;
    window.print();
  }

  constructor() {
    effect(() => {
      if (this.registroSolicitado() !== 'demanda' || !this.caso()) return;
      if (this.puedeModificar()) this.altaDemanda();
      void this.router.navigate([], {
        relativeTo: this.ruta,
        queryParams: { registrar: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    // Al cambiar de caso en la ruta se reinician los estados de esta pantalla:
    // la respuesta de un PATCH anterior no debe sobrevivir al nuevo expediente.
    effect(() => {
      this.codigo();
      this.detalleActualizado.set(null);
      this.editando.set(null);
      this.borrador.set('');
      this.modoEdicion.set(false);
      this.confirmandoArchivo.set(null);
      this.errorCampo.set(null);
      this.errorArchivo.set(null);
      this.editandoSectorista.set(false);
      this.borradorSectorista.set('');
      this.hechoAQuitar.set(null);
      this.demandasSeleccionadas.set(new Set());
      this.confirmandoEliminarDemandas.set(false);
    });

    // Si el catálogo llega después de abrir un `select`, el borrador se
    // resuelve a su valor canónico para no enviar una etiqueta al PATCH.
    effect(() => {
      const campo = this.editando();
      const catalogo = this.catalogoEdicion.valor();
      if (!campo || !catalogo) return;
      const definicion = definicionDe(campo);
      if (!definicion.catalogo) return;

      const actual = untracked(() => this.borrador());
      const canonico = resolverValorCatalogo(catalogo[definicion.catalogo], actual);
      if (canonico && canonico !== actual) this.borrador.set(canonico);
    });
  }

  altaDemanda(): void {
    if (!this.puedeModificar()) return;
    this.errorDemanda.set(null);
    this.avisoDemanda.set(null);
    this.demandaEditada.set(null);
    this.panelDemandaAbierto.set(true);
  }

  editarDemanda(demanda: DemandaCasoConTematica): void {
    if (!this.puedeModificar()) return;
    this.errorDemanda.set(null);
    this.avisoDemanda.set(null);
    this.demandaEditada.set(demanda);
    this.panelDemandaAbierto.set(true);
  }

  cerrarPanelDemanda(): void {
    this.panelDemandaAbierto.set(false);
    this.demandaEditada.set(null);
    this.errorDemanda.set(null);
  }

  /**
   * `POST /v1/demandas` (alta, con `casoCode`) y `PATCH /v1/demandas/{id}`
   * (edición). Tras guardar se cierra el panel, se recarga la ficha y se deja un
   * aviso breve en el estilo `aviso-ok`.
   */
  guardarDemanda(cambios: CuerpoDemanda): void {
    const demanda = this.demandaEditada();
    const url = urlApi(demanda ? `/v1/demandas/${encodeURIComponent(demanda.id)}` : '/v1/demandas');
    const peticion = demanda
      ? this.http.patch<unknown>(url, cambios)
      : this.http.post<unknown>(url, cambios);

    this.guardandoDemanda.set(true);
    this.errorDemanda.set(null);

    peticion.subscribe({
      next: () => {
        this.guardandoDemanda.set(false);
        this.panelDemandaAbierto.set(false);
        this.demandaEditada.set(null);
        this.recargar();
        this.avisoDemanda.set(
          demanda
            ? 'Cambios de la demanda guardados.'
            : 'Demanda registrada. La ficha se actualizó con el nuevo registro.',
        );
      },
      error: (fallo: unknown) => {
        this.guardandoDemanda.set(false);
        this.errorDemanda.set(this.mensajeDeErrorDemanda(fallo));
      },
    });
  }

  /**
   * Ids de demandas marcadas en la tabla. Alimentan «Copiar» y «Eliminar
   * demanda»: con al menos una casilla activa se habilita la eliminación.
   */
  readonly demandasSeleccionadas = signal<ReadonlySet<string>>(new Set());
  readonly confirmandoEliminarDemandas = signal(false);
  readonly eliminandoDemandas = signal(false);

  /** Ids visibles en la tabla; alimenta el «seleccionar todas» de la cabecera. */
  readonly idsDemandas = computed<readonly string[]>(() =>
    this.filasDemandas().map((demanda) => demanda.id),
  );

  readonly todasDemandasSeleccionadas = computed(() => {
    const ids = this.idsDemandas();
    const marcadas = this.demandasSeleccionadas();
    return ids.length > 0 && ids.every((id) => marcadas.has(id));
  });

  alternarDemanda(id: string): void {
    const marcadas = new Set(this.demandasSeleccionadas());
    if (marcadas.has(id)) marcadas.delete(id);
    else marcadas.add(id);
    this.demandasSeleccionadas.set(marcadas);
    this.confirmandoEliminarDemandas.set(false);
  }

  alternarTodasDemandas(): void {
    this.demandasSeleccionadas.set(
      this.todasDemandasSeleccionadas() ? new Set() : new Set(this.idsDemandas()),
    );
    this.confirmandoEliminarDemandas.set(false);
  }

  /**
   * Copia las demandas marcadas —o todas si no hay ninguna— con el mismo formato
   * de una línea por registro que «Copiar» de la cronología: rótulo en negrita
   * y el texto después, listo para pegar en WhatsApp.
   */
  async copiarDemandas(): Promise<void> {
    const marcadas = this.demandasSeleccionadas();
    const demandas = this.filasDemandas().filter(
      (demanda) => marcadas.size === 0 || marcadas.has(demanda.id),
    );
    if (demandas.length === 0) return;

    const texto = demandas
      .map((demanda) => {
        const estado = demanda.estado || 'Sin estado';
        const descripcion = demanda.descripcion || demanda.problema || 'Sin descripción';
        const compromisos = this.compromisosDeDemanda(demanda.id)
          .map((compromiso) => compromiso.codigo)
          .join(', ');
        const sufijo = compromisos ? ` (Compromisos: ${compromisos})` : '';
        return `*${estado}* - ${descripcion}${sufijo}`;
      })
      .join('\n');

    const ok = await copiarAlPortapapeles(texto);
    this.avisoDemanda.set(
      ok
        ? 'Demandas copiadas al portapapeles.'
        : 'No se pudo copiar. Seleccione el texto y use Ctrl + C.',
    );
  }

  pedirEliminarDemandas(): void {
    if (!this.puedeModificar() || this.demandasSeleccionadas().size === 0) return;
    this.errorDemanda.set(null);
    this.avisoDemanda.set(null);
    this.confirmandoEliminarDemandas.set(true);
  }

  cancelarEliminarDemandas(): void {
    if (this.eliminandoDemandas()) return;
    this.confirmandoEliminarDemandas.set(false);
  }

  /**
   * `DELETE /v1/demandas/{id}` por cada demanda marcada. La API exige un motivo
   * (`leerMotivo`), por eso se envía en el cuerpo; la baja es lógica. Al
   * terminar se recarga la ficha y se limpia la selección.
   */
  async confirmarEliminarDemandas(): Promise<void> {
    const ids = [...this.demandasSeleccionadas()];
    if (!this.puedeModificar() || ids.length === 0 || this.eliminandoDemandas()) return;

    this.eliminandoDemandas.set(true);
    this.errorDemanda.set(null);
    try {
      for (const id of ids) {
        await firstValueFrom(
          this.http.delete(urlApi(`/v1/demandas/${encodeURIComponent(id)}`), {
            body: { motivo: 'Eliminada desde la ficha del caso' },
          }),
        );
      }
      this.eliminandoDemandas.set(false);
      this.confirmandoEliminarDemandas.set(false);
      this.demandasSeleccionadas.set(new Set());
      this.recargar();
      this.avisoDemanda.set(
        ids.length === 1 ? 'Demanda eliminada.' : `${ids.length} demandas eliminadas.`,
      );
    } catch (fallo: unknown) {
      this.eliminandoDemandas.set(false);
      this.errorDemanda.set(this.mensajeDeErrorDemanda(fallo));
    }
  }

  abrirAnulacion(): void {
    if (!this.puedeAnular() || this.anulado()) return;
    this.errorAnulacion.set(null);
    this.avisoAnulacion.set(null);
    this.panelAnulacion.set('anular');
  }

  abrirRestauracion(): void {
    if (!this.puedeAnular() || !this.anulado()) return;
    this.errorAnulacion.set(null);
    this.avisoAnulacion.set(null);
    this.panelAnulacion.set('restaurar');
  }

  cerrarPanelAnulacion(): void {
    this.panelAnulacion.set(null);
    this.errorAnulacion.set(null);
  }

  /**
   * `POST /v1/cases/{codigo}/anular` (con `motivo`) y `…/restaurar` (sin
   * cuerpo). Tras restaurar se recarga la ficha; tras anular no se puede, así
   * que se conserva la copia local marcada como anulada.
   */
  confirmarAnulacion(resultado: ResultadoAnulacion): void {
    const codigo = this.codigo();
    if (!codigo) return;

    const base = `/v1/cases/${encodeURIComponent(codigo)}`;
    const url = urlApi(resultado.modo === 'anular' ? `${base}/anular` : `${base}/restaurar`);
    const cuerpo = resultado.modo === 'anular' ? { motivo: resultado.motivo ?? '' } : {};

    this.enviandoAnulacion.set(true);
    this.errorAnulacion.set(null);

    this.http.post<unknown>(url, cuerpo).subscribe({
      next: () => {
        this.enviandoAnulacion.set(false);
        this.panelAnulacion.set(null);

        if (resultado.modo === 'anular') {
          const actual = this.ficha();
          this.snapshotAnulado.set(
            actual ? { ...actual, caso: { ...actual.caso, anulado: true } } : null,
          );
          this.avisoAnulacion.set(
            'Caso anulado. Sus alertas y registros vinculados quedaron anulados en cascada.',
          );
          return;
        }

        this.snapshotAnulado.set(null);
        this.recargar();
        this.avisoAnulacion.set(
          'Caso restaurado. Se recuperaron también los registros anulados en la misma operación.',
        );
      },
      error: (fallo: unknown) => {
        this.enviandoAnulacion.set(false);
        this.errorAnulacion.set(aErrorApi(fallo).message);
      },
    });
  }

  private mensajeDeError(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite modificar la cronología de este caso.';
    if (error.codigo === 'SIN_CAMBIOS') return 'No hay cambios que guardar.';
    return error.message;
  }

  private mensajeDeErrorDemanda(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite modificar las demandas de este caso.';
    if (error.codigo === 'SIN_CAMBIOS') return 'No hay cambios que guardar.';
    if (error.codigo === 'INVALID_INPUT' || error.estado === 422) {
      return 'Datos inválidos: la temática es obligatoria y la demanda debe tener descripción y estado válidos.';
    }
    return error.message;
  }

  private mensajeDeErrorCampo(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite modificar este caso.';
    if (error.codigo === 'SIN_CAMBIOS') return 'No hay cambios que guardar.';
    return error.message;
  }

  private mensajeDeErrorHito(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite modificar los hitos de este caso.';
    if (error.codigo === 'SIN_CAMBIOS') return 'No hay cambios que guardar.';
    if (error.estado === 404) return 'El hito o su compromiso ya no existe; recargue la ficha.';
    if (error.codigo === 'INVALID_INPUT' || error.estado === 422) {
      return `Datos inválidos: ${error.message}`;
    }
    return error.message;
  }

  private mensajeDeErrorArchivo(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite cambiar el estado de este caso.';
    return error.message;
  }
}
