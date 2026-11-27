import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aCaso, aDetalleCaso, type DemandaCaso } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import { AdjuntosPanelComponent } from '../../shared/ui/adjuntos-panel.component';
import { formatearFechaHora } from '../../shared/formato-fecha';
import { codigoHitoCorto, etiquetaHito as etiquetaHitoDe } from '../../shared/hito-texto';
import {
  ALCANCES,
  CLASIFICACIONES_ALCANCE,
  ESTADOS_COMPROMISO,
  ESTADOS_HITO,
  ETIQUETA_ASUMIDO_MINISTRO,
  FORMAS_VERBALES,
  NIVELES_GOBIERNO,
  TIPOS_COMPROMISO,
  aCatalogosCompromiso,
  aCompromiso,
  aDetalleCompromiso,
  aHistorialCompromiso,
  aSugerenciaUsuario,
  avanceHitosDe,
  estadoCumplimientoDe,
  etiquetaClasificacionAlcance,
  etiquetaDemandaVinculada,
  etiquetaFormalVerbal,
  etiquetaFuente,
  etiquetaNivelGobierno,
  etiquetaPuntoFocal as etiquetaPuntoFocalDe,
  formatearFecha,
  fuenteDe,
  resolverVencimiento,
  resumenValidacionHitos,
  situacionDe,
  type CatalogosCompromiso,
  type Compromiso,
  type DetalleCompromiso,
  type EstadoCumplimiento,
  type EstadoHito,
  type EventoCompromiso,
  type FuenteCompromiso,
  type Hito,
  type HistorialCompromiso,
  type OpcionCatalogo,
  type ResolucionVencimiento,
  type Situacion,
  type SugerenciaUsuario,
} from './compromiso.mapeo';

type FormularioCompromiso = {
  accion: string;
  fechaInicio: string;
  fechaVencimiento: string;
  tipo: string;
  clasificacionAlcance: string;
  formalVerbal: string;
  asumidoMinistro: boolean;
  nivelGobierno: string;
  estado: string;
  unidad: string;
  alcance: string;
  atiendeGenero: boolean;
  criteriosSmart: string;
  evidenciaUri: string;
  /** Demanda del caso elegido en el alta; obligatoria si el caso tiene demandas. */
  demandaId: string;
  /** Usuario del directorio elegido como punto focal; vacío si es texto libre. */
  puntoFocalUsuarioId: string;
  /** Nombre del punto focal: lo que se pinta y lo que viaja como texto libre. */
  puntoFocalTexto: string;
};

type CampoTexto = Exclude<keyof FormularioCompromiso, 'atiendeGenero' | 'asumidoMinistro'>;

type FormularioHito = {
  descripcion: string;
  fecha: string;
  fechaReal: string;
  estado: EstadoHito;
  responsableTexto: string;
};

type ResultadoCriterios = { ok: true; valor: unknown } | { ok: false };

/** Un criterio SMART legible: rótulo deducido de la clave y valor en texto. */
type CriterioLegible = { clave: string; valor: string };

function formularioVacio(): FormularioCompromiso {
  return {
    accion: '',
    fechaInicio: '',
    fechaVencimiento: '',
    tipo: 'Actividad',
    clasificacionAlcance: '',
    formalVerbal: '',
    asumidoMinistro: false,
    nivelGobierno: '',
    estado: 'Por iniciar',
    unidad: '',
    alcance: '',
    atiendeGenero: false,
    criteriosSmart: '',
    evidenciaUri: '',
    demandaId: '',
    puntoFocalUsuarioId: '',
    puntoFocalTexto: '',
  };
}

function formularioDe(compromiso: Compromiso): FormularioCompromiso {
  let criterios = '';
  if (compromiso.criteriosSmart !== null && compromiso.criteriosSmart !== undefined) {
    try {
      criterios = JSON.stringify(compromiso.criteriosSmart, null, 2);
    } catch {
      criterios = '';
    }
  }

  return {
    accion: compromiso.accion,
    fechaInicio: compromiso.fechaInicio ?? '',
    fechaVencimiento: compromiso.fechaVencimiento ?? '',
    tipo: compromiso.tipo,
    clasificacionAlcance: compromiso.clasificacionAlcance ?? '',
    formalVerbal: compromiso.formalVerbal ?? '',
    asumidoMinistro: compromiso.asumidoMinistro,
    nivelGobierno: compromiso.nivelGobierno ?? '',
    estado: compromiso.estado,
    unidad: compromiso.unidad ?? '',
    alcance: compromiso.alcance ?? '',
    atiendeGenero: compromiso.atiendeGenero,
    criteriosSmart: criterios,
    evidenciaUri: compromiso.evidenciaUri ?? '',
    demandaId: compromiso.demandaId ?? '',
    puntoFocalUsuarioId: compromiso.puntoFocalUsuarioId ?? '',
    puntoFocalTexto:
      compromiso.puntoFocalUsuarioId !== null
        ? (compromiso.puntoFocal ?? '')
        : (compromiso.puntoFocalTexto ?? compromiso.puntoFocal ?? ''),
  };
}

/** Fecha de hoy en ISO corto (`YYYY-MM-DD`), como la esperan los `<input type="date">`. */
function hoyIso(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

function leerValor(evento: Event): string {
  return (evento.target as HTMLInputElement | HTMLSelectElement).value;
}

/** Cabecera de relleno mientras no existe compromiso (modo alta). */
const COMPROMISO_VACIO: Compromiso = aCompromiso({});

@Component({
  selector: 'app-compromiso-panel',
  imports: [IconoComponent, GlosarioComponent, AdjuntosPanelComponent],
  templateUrl: './compromiso-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }
    .panel-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .drawer-body {
      flex: 1;
      min-height: 0;
    }
    .drawer-body .detail-section {
      padding: 14px 0;
      border-top: 1px solid #eef2f6;
    }
    .drawer-body .detail-section:first-of-type {
      padding-top: 0;
      border-top: 0;
    }
    .drawer-body .detail-section h3 {
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .panel-fecha {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 10px 0 4px;
    }
    .panel-linea {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 12px;
      font-size: 12.5px;
      color: #52677a;
    }
    .panel-aviso {
      margin: 6px 0 0;
      padding: 8px 10px;
      border: 1px solid #f0d9b5;
      border-radius: 6px;
      background: #fff8ec;
      color: #8a5a1f;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .criterios-lista {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 4px 0 0;
    }
    .criterios-lista > div {
      display: grid;
      grid-template-columns: minmax(110px, max-content) minmax(0, 1fr);
      gap: 8px;
      padding: 3px 0;
      border-bottom: 1px solid var(--line);
    }
    .criterios-lista dt {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .criterios-lista dd {
      margin: 0;
      color: var(--ink-2);
      font-size: 12.5px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    /*
     * C3: el alta se lee sin recuadros. Cada campo es rótulo tenue y valor,
     * separados por espacio; los colores salen de variables de tema.
     */
    .form-campo {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .detail-section.form-alta .form-field {
      gap: 6px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }
    .detail-section.form-alta .form-field > .form-label {
      text-align: left;
    }
    .detail-section.form-alta .form-grid {
      gap: 18px 16px;
    }
    .detail-section.form-alta .form-grid .form-input,
    .detail-section.form-alta .form-grid .form-select,
    .detail-section.form-alta .form-grid .form-textarea {
      padding-left: 0;
      padding-right: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: var(--ink);
    }
    .panel-hito-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed #e2e8ee;
    }
    .panel-hito-adjuntos {
      margin-top: 10px;
    }
    .panel-hito-toggle {
      min-height: 24px;
      padding: 0 8px;
      border: 1px solid #dbe3ea;
      border-radius: 6px;
      background: #fff;
      color: #1d427f;
      font: 600 11.5px/1 var(--font-body, system-ui);
      cursor: pointer;
    }
    .panel-hito-toggle:hover {
      background: #eaf1fb;
    }
    .panel-hito-toggle:focus-visible {
      outline: 2px solid #2455a2;
      outline-offset: 1px;
    }
    .panel-evento-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed #e2e8ee;
    }
    .panel-evento-form h4 {
      margin: 0;
      color: #3c4a59;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .panel-evento-form .form-field {
      padding: 0;
      border: 0;
      background: transparent;
    }
    .panel-hito-form h4 {
      margin: 0;
      color: #3c4a59;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .panel-hito-form .form-field {
      padding: 0;
      border: 0;
      background: transparent;
    }
    .hito-estado {
      display: inline-flex;
    }
    .hito-responsable {
      display: inline-flex;
    }
    .hito-responsable-input {
      min-width: 160px;
      max-width: 220px;
      height: 26px;
      padding: 0 8px;
      font-size: 13px;
    }
    .panel-campo-ancho {
      grid-column: 1 / -1;
    }
    /* Punto focal: campo y «Quitar» en la misma línea, sin recuadros nuevos. */
    .punto-focal-campo {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .punto-focal-campo .form-input {
      flex: 1 1 auto;
      min-width: 0;
    }
    .panel-check {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #52677a;
      font-size: 12.5px;
    }
    .panel-permiso {
      margin: 0 auto 0 0;
      align-self: center;
    }
    .panel-caso-lista {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
    }
    .panel-caso-opcion {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      text-align: left;
      cursor: pointer;
    }
    .panel-caso-opcion:hover {
      border-color: var(--blue);
      background: #fafcfe;
    }
    .panel-caso-codigo {
      color: var(--ink);
      font-size: 12.5px;
      font-weight: 700;
    }
    .panel-caso-titulo {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .panel-caso-region {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }
    .panel-caso-elegido {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fbfcfd;
    }
    .panel-caso-elegido-copia {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
  `,
})
export class CompromisoPanelComponent {
  private readonly http = inject(HttpClient);
  readonly capacidades = inject(CapacidadesService);

  readonly compromiso = input<Compromiso | null>(null);

  readonly cerrado = output<void>();
  readonly actualizado = output<void>();
  readonly creado = output<void>();
  readonly anular = output<void>();

  readonly estadosCompromiso: readonly string[] = ESTADOS_COMPROMISO;
  readonly estadosHito: readonly string[] = ESTADOS_HITO;
  readonly tiposCompromiso: readonly string[] = TIPOS_COMPROMISO;
  readonly nivelesGobierno: readonly string[] = NIVELES_GOBIERNO;
  readonly clasificacionesAlcance = CLASIFICACIONES_ALCANCE;
  readonly formasVerbales = FORMAS_VERBALES;
  readonly etiquetaAsumidoMinistro = ETIQUETA_ASUMIDO_MINISTRO;
  /** Lecturas legibles de los vínculos nuevos; las plantillas no repiten reglas. */
  readonly etiquetaDemanda = etiquetaDemandaVinculada;
  readonly etiquetaPuntoFocal = etiquetaPuntoFocalDe;
  /** Texto de hito compartido con las demás vistas (`shared/hito-texto`). */
  readonly codigoHitoCorto = codigoHitoCorto;
  readonly etiquetaHito = etiquetaHitoDe;

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly editError = signal<string | null>(null);
  readonly formulario = signal<FormularioCompromiso>(formularioVacio());

  /** Búsqueda del caso en el alta; se confirma con `casoElegido`. */
  readonly busquedaCaso = signal('');
  readonly casoElegido = signal<Caso | null>(null);
  private temporizadorCaso?: ReturnType<typeof setTimeout>;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly destruccion = inject(DestroyRef);

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  readonly hitoNuevo = signal<FormularioHito>({
    descripcion: '',
    fecha: '',
    fechaReal: '',
    estado: 'Registrado',
    responsableTexto: '',
  });
  readonly hitoGuardando = signal(false);
  readonly hitoCambiando = signal<string | null>(null);
  readonly hitosError = signal<string | null>(null);

  /** Último compromiso cuyo historial se pintó; sirve para reiniciar la UI. */
  private ultimoCompromisoId = '';

  /** Hitos con el panel de adjuntos desplegado; se monta sólo al expandir. */
  readonly adjuntosHito = signal<ReadonlySet<string>>(new Set());
  readonly eventoTexto = signal('');
  readonly eventoGuardando = signal(false);
  readonly eventoError = signal<string | null>(null);

  private readonly recurso = consulta<DetalleCompromiso>({
    fuente: () => {
      const id = this.compromiso()?.id;
      return id ? urlApi(`/v1/commitments/${encodeURIComponent(id)}`) : null;
    },
    esquema: aDetalleCompromiso,
  });

  private readonly catalogoRecurso = consulta<CatalogosCompromiso>({
    fuente: () => (this.compromiso() !== null || this.editando() ? urlApi('/v1/catalogs') : null),
    esquema: aCatalogosCompromiso,
  });

  /** Casos para el alta; sólo se consulta en modo alta. */
  private readonly casosRecurso = consulta<Coleccion<Caso>>({
    fuente: () => {
      if (this.compromiso() !== null) return null;
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 8 }),
        q: this.busquedaCaso(),
        sort: 'recent',
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aCaso) };
    },
  });

  readonly casosEncontrados = computed(() => this.casosRecurso.valor()?.elementos ?? []);
  readonly estadoCasos = this.casosRecurso.estado;
  readonly errorCasos = this.casosRecurso.error;

  /**
   * Demandas del caso elegido en el alta. Se leen de `GET /v1/cases/{codigo}`,
   * que ya las trae: no hay endpoint propio y el cliente no los inventa.
   */
  private readonly demandasRecurso = consulta<readonly DemandaCaso[]>({
    fuente: () => {
      const codigo = this.casoElegido()?.codigo;
      if (!codigo || !this.modoAlta()) return null;
      return urlApi(`/v1/cases/${encodeURIComponent(codigo)}`);
    },
    esquema: (bruto) => aDetalleCaso(bruto).demandas,
  });

  readonly demandasCaso = computed(() => this.demandasRecurso.valor() ?? []);
  readonly estadoDemandas = this.demandasRecurso.estado;
  readonly errorDemandas = this.demandasRecurso.error;

  /** Texto con el que se consulta el directorio de usuarios del punto focal. */
  readonly puntoFocalConsulta = signal('');
  readonly puntoFocalAbierto = signal(false);
  private temporizadorPuntoFocal?: ReturnType<typeof setTimeout>;

  /**
   * Sugerencias del punto focal. No existe todavía un directorio legible por
   * todos los roles: `POST/PATCH /v1/commitments` acepta `puntoFocalUsuarioId`,
   * pero la única búsqueda de usuarios (`/v1/admin/usuarios`) exige ADMIN. Con
   * otro perfil el campo sigue siendo texto libre y no se lanza la petición.
   */
  private readonly usuariosRecurso = consulta<readonly SugerenciaUsuario[]>({
    fuente: () => {
      if (!this.formularioVisible() || !this.capacidades.esAdmin()) return null;
      const termino = this.puntoFocalConsulta().trim();
      if (termino.length < 2) return null;
      return urlConParametros(urlApi('/v1/admin/usuarios'), {
        q: termino,
        ...paramsDePagina({ pagina: 1, tamano: 8 }),
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return coleccion.elementos
        .map(aSugerenciaUsuario)
        .filter((usuario): usuario is SugerenciaUsuario => usuario !== null);
    },
  });

  readonly puntoFocalSugerencias = computed(() => this.usuariosRecurso.valor() ?? []);
  readonly puntoFocalListaVisible = computed(
    () => this.puntoFocalAbierto() && this.puntoFocalSugerencias().length > 0,
  );

  readonly detalle = this.recurso.valor;
  readonly estadoCarga = this.recurso.estado;
  readonly errorCarga = this.recurso.error;

  /**
   * Historia del compromiso: eventos de `core.compromiso_evento`, hitos con su
   * estado y adjuntos del compromiso y de sus hitos, en una sola respuesta.
   */
  private readonly historialRecurso = consulta<HistorialCompromiso>({
    fuente: () => {
      const id = this.compromiso()?.id;
      return id ? urlApi(`/v1/commitments/${encodeURIComponent(id)}/historial`) : null;
    },
    esquema: aHistorialCompromiso,
  });

  readonly historial = this.historialRecurso.valor;
  readonly estadoHistorial = this.historialRecurso.estado;
  readonly errorHistorial = this.historialRecurso.error;
  readonly eventosHistorial = computed(() => this.historial()?.eventos ?? []);
  readonly lineaHistorial = computed(() => this.historial()?.linea ?? []);

  readonly modoAlta = computed(() => this.compromiso() === null);
  readonly formularioVisible = computed(() => this.modoAlta() || this.editando());

  readonly cabecera = computed<Compromiso>(
    () => this.detalle()?.compromiso ?? this.compromiso() ?? COMPROMISO_VACIO,
  );

  readonly hitos = computed(() => this.cabecera().hitos);
  readonly proximoHito = computed(() => this.cabecera().proximoHito);
  readonly vencimiento = computed<ResolucionVencimiento>(() =>
    resolverVencimiento(this.cabecera()),
  );

  /** Semáforo del vencimiento efectivo (manual o derivado del próximo hito). */
  readonly situacion = computed<Situacion>(() => situacionDe(this.cabecera()));

  /** Fuente del compromiso: documento de origen y, si no hay, reunión. */
  readonly fuente = computed<FuenteCompromiso | null>(() =>
    fuenteDe(this.detalle()?.documento ?? null, this.detalle()?.reunion ?? null),
  );
  readonly fuenteTexto = computed(() => etiquetaFuente(this.fuente()));

  /**
   * Caso / espacio de diálogo como «código · título». Se prefiere el caso
   * resuelto por el detalle y, si no llega, el que ya trae la fila.
   */
  readonly casoTexto = computed<string>(() => {
    const caso = this.detalle()?.caso;
    const codigo = caso?.codigo ?? this.cabecera().casoCodigo;
    const titulo = caso?.titulo ?? this.cabecera().casoTitulo;
    if (codigo && titulo) return `${codigo} · ${titulo}`;
    return codigo ?? titulo ?? '—';
  });

  /** Estado resumido de los hitos para la fila «Estado de hitos / validación». */
  readonly hitosResumen = computed(() => avanceHitosDe(this.hitos()));

  /** Cuántos hitos traen validación; `null` cuando el detalle no la registra. */
  readonly validacionResumen = computed(() => resumenValidacionHitos(this.hitos()));

  /** Estado de cumplimiento derivado; la regla vive en `estadoCumplimientoDe`. */
  readonly cumplimiento = computed<EstadoCumplimiento>(() => estadoCumplimientoDe(this.cabecera()));

  /**
   * Explica por qué la etiqueta derivada no coincide con el estado registrado,
   * para que «No cumplido» no parezca un dato inventado.
   */
  readonly motivoCumplimiento = computed<string | null>(() => {
    const estado = this.cabecera().estado;
    if (this.cumplimiento() !== 'No cumplido' || this.cumplimiento() === estado) return null;
    if (this.cabecera().terminal || estado === 'Redefinido' || estado === 'Desestimado') {
      return `Estado terminal «${estado}»: no se cumplió.`;
    }
    return 'Todos los hitos están en «No cumplido».';
  });

  readonly puedeModificar = computed(() =>
    this.modoAlta()
      ? this.capacidades.puedeEditar()
      : this.capacidades.puedeModificar(this.cabecera().clasificacion),
  );

  /** Anular exige, además de escritura sobre la clasificación, el privilegio de anulación. */
  readonly puedeAnular = computed(
    () => !this.modoAlta() && this.capacidades.puedeEliminar() && this.puedeModificar(),
  );

  /**
   * Lectura legible de los criterios SMART: sólo se muestran cuando el dato es
   * un objeto plano de valores simples. Un objeto anidado o una lista no se
   * puede leer sin jerga, así que se oculta en vez de mostrar JSON crudo.
   */
  readonly criteriosLegibles = computed<readonly CriterioLegible[] | null>(() => {
    const valor = this.cabecera().criteriosSmart;
    if (valor === null || valor === undefined || typeof valor !== 'object') return null;
    if (Array.isArray(valor)) return null;

    const entradas = Object.entries(valor as Record<string, unknown>);
    if (entradas.length === 0) return null;

    const criterios: CriterioLegible[] = [];
    for (const [clave, dato] of entradas) {
      if (dato === null || dato === undefined || typeof dato === 'object') return null;
      criterios.push({
        clave: this.etiquetaCriterio(clave),
        valor: typeof dato === 'boolean' ? (dato ? 'Sí' : 'No') : String(dato),
      });
    }
    return criterios;
  });

  /**
   * Aviso visible mientras se edita: sin fecha manual y sin próximo hito del
   * que derivarla, el compromiso se guardará sin vencimiento. No se inventa
   * ninguna fecha; el aviso es la única barrera.
   */
  readonly avisoFecha = computed<string | null>(() => {
    if (!this.formularioVisible() || this.modoAlta()) return null;
    if (this.formulario().fechaVencimiento.trim()) return null;
    if (this.proximoHito()?.fecha) return null;
    return 'Sin fecha de vencimiento manual ni próximo hito con fecha: el compromiso se guardará sin vencimiento. Añada una fecha manual si desea fijarlo.';
  });

  readonly unidadesFormulario = computed<OpcionCatalogo[]>(() => {
    const base = this.catalogoRecurso.valor()?.unidades ?? [];
    const actual = this.formulario().unidad.trim();
    if (!actual || base.some((opcion) => opcion.valor === actual)) return base;
    return [{ valor: actual, etiqueta: actual }, ...base];
  });

  readonly alcancesFormulario = computed<OpcionCatalogo[]>(() => {
    const base = this.catalogoRecurso.valor()?.alcances ?? [];
    if (base.length > 0) return base;
    return ALCANCES.map((valor) => ({ valor, etiqueta: valor }));
  });

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus({ preventScroll: true }));

    // Al cambiar de compromiso se cierran los paneles de adjuntos por hito y se
    // limpia el borrador de evento; el recurso de historial ya se refresca por
    // la URL, así que aquí sólo se restablece la UI.
    effect(() => {
      const id = this.compromiso()?.id ?? '';
      if (id === this.ultimoCompromisoId) return;
      this.ultimoCompromisoId = id;
      this.adjuntosHito.set(new Set());
      this.eventoTexto.set('');
      this.eventoError.set(null);
    });

    // Escape cierra el panel aunque el foco esté dentro de un campo de texto.
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      this.cerrar();
    };
    document.addEventListener('keydown', alEscape);
    this.destruccion.onDestroy(() => {
      document.removeEventListener('keydown', alEscape);
      clearTimeout(this.temporizadorCaso);
      clearTimeout(this.temporizadorPuntoFocal);
      this.focoPrevio?.focus?.();
    });
  }

  cerrar(): void {
    // El panel se desmonta en el acto: la animación de salida se espera aquí,
    // mientras los datos siguen intactos.
    salirModal(this.panel()?.nativeElement, () => this.cerrado.emit());
  }

  /** En el alta cancela el panel; en edición sólo descarta el formulario. */
  cancelar(): void {
    if (this.modoAlta()) {
      this.cerrar();
      return;
    }
    this.cancelarEdicion();
  }

  buscarCaso(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.casoElegido.set(null);
    clearTimeout(this.temporizadorCaso);
    this.temporizadorCaso = setTimeout(() => this.busquedaCaso.set(valor), 300);
  }

  elegirCaso(caso: Caso): void {
    if (!caso.codigo) return;
    this.casoElegido.set(caso);
    this.busquedaCaso.set('');
    // La demanda pertenece al caso: al cambiarlo, la anterior deja de valer.
    this.formulario.update((actual) => ({ ...actual, demandaId: '' }));
    this.editError.set(null);
  }

  quitarCaso(): void {
    this.casoElegido.set(null);
    this.busquedaCaso.set('');
    this.formulario.update((actual) => ({ ...actual, demandaId: '' }));
  }

  /** Sugiere usuarios mientras se escribe y vuelve a texto libre al teclear. */
  alEscribirPuntoFocal(evento: Event): void {
    const valor = leerValor(evento);
    this.formulario.update((actual) => ({
      ...actual,
      puntoFocalUsuarioId: '',
      puntoFocalTexto: valor,
    }));
    this.puntoFocalAbierto.set(true);
    clearTimeout(this.temporizadorPuntoFocal);
    this.temporizadorPuntoFocal = setTimeout(() => this.puntoFocalConsulta.set(valor), 250);
  }

  abrirSugerenciasPuntoFocal(): void {
    if (this.formulario().puntoFocalTexto.trim().length >= 2) this.puntoFocalAbierto.set(true);
  }

  elegirPuntoFocal(usuario: SugerenciaUsuario): void {
    this.formulario.update((actual) => ({
      ...actual,
      puntoFocalUsuarioId: usuario.id,
      puntoFocalTexto: usuario.nombre,
    }));
    this.cerrarSugerenciasPuntoFocal();
  }

  quitarPuntoFocal(): void {
    this.formulario.update((actual) => ({
      ...actual,
      puntoFocalUsuarioId: '',
      puntoFocalTexto: '',
    }));
    this.cerrarSugerenciasPuntoFocal();
  }

  /** Cierra la lista y cancela la consulta pendiente (también al salir del campo). */
  cerrarSugerenciasPuntoFocal(): void {
    clearTimeout(this.temporizadorPuntoFocal);
    this.temporizadorPuntoFocal = undefined;
    this.puntoFocalConsulta.set('');
    this.puntoFocalAbierto.set(false);
  }

  /** Texto corto de una demanda del caso para el selector del alta. */
  etiquetaDemandaCaso(demanda: DemandaCaso): string {
    const textoDemanda = demanda.descripcion ?? demanda.problema ?? demanda.pedido;
    if (!textoDemanda) return 'Demanda sin descripción registrada';
    return textoDemanda.length > 110 ? `${textoDemanda.slice(0, 107)}…` : textoDemanda;
  }

  recargarDetalle(): void {
    this.recurso.recargar();
  }

  recargarHistorial(): void {
    this.historialRecurso.recargar();
  }

  /** Expande o contrae los adjuntos de un hito; el panel se monta bajo `@if`. */
  alternarAdjuntosHito(id: string): void {
    this.adjuntosHito.update((actual) => {
      const siguiente = new Set(actual);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  adjuntosHitoAbiertos(id: string): boolean {
    return this.adjuntosHito().has(id);
  }

  actualizarEventoTexto(evento: Event): void {
    this.eventoTexto.set((evento.target as HTMLTextAreaElement).value);
  }

  /**
   * `POST /v1/commitments/{id}/historial` con `{ tipo: 'nota', detalle }`.
   * Sólo se ofrece a quien puede modificar; la API vuelve a autorizar.
   */
  async registrarEvento(): Promise<void> {
    if (!this.puedeModificar()) {
      this.eventoError.set('No tiene permisos para registrar eventos en este compromiso.');
      return;
    }

    const texto = this.eventoTexto().trim();
    if (!texto) {
      this.eventoError.set('Escriba el detalle del evento.');
      return;
    }

    const id = this.cabecera().id;
    if (!id) {
      this.eventoError.set('El compromiso no tiene identificador.');
      return;
    }

    this.eventoGuardando.set(true);
    this.eventoError.set(null);

    try {
      await firstValueFrom(
        this.http.post<unknown>(urlApi(`/v1/commitments/${encodeURIComponent(id)}/historial`), {
          tipo: 'nota',
          detalle: { texto },
        }),
      );
      this.eventoTexto.set('');
      this.historialRecurso.recargar();
    } catch (fallo) {
      this.eventoError.set(this.mensajeDeError(fallo));
    } finally {
      this.eventoGuardando.set(false);
    }
  }

  /** Etiqueta legible de un slug de evento; el slug se conserva si no hay traducción. */
  etiquetaEvento(tipo: string): string {
    const etiquetas: Record<string, string> = {
      nota: 'Nota',
      cambio_estado: 'Cambio de estado',
      hito_creado: 'Hito registrado',
      hito_actualizado: 'Hito actualizado',
      adjunto: 'Adjunto',
    };
    return etiquetas[tipo] ?? tipo.replace(/[_-]+/g, ' ');
  }

  /** Sólo se pinta el texto declarado en `detalle.texto`; no se resume un JSON. */
  detalleEvento(evento: EventoCompromiso): string {
    const detalle = evento.detalle;
    if (detalle && typeof detalle === 'object' && !Array.isArray(detalle)) {
      const valor = (detalle as Record<string, unknown>)['texto'];
      if (typeof valor === 'string' && valor.trim()) return valor.trim();
    }
    if (typeof detalle === 'string' && detalle.trim()) return detalle.trim();
    return '';
  }

  fechaHoraTexto(valor: string | null | undefined): string {
    return formatearFechaHora(valor);
  }

  abrirEdicion(): void {
    if (this.modoAlta() || !this.puedeModificar()) return;
    this.formulario.set(formularioDe(this.cabecera()));
    this.editError.set(null);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
    this.editError.set(null);
  }

  actualizarTexto(campo: CampoTexto, evento: Event): void {
    const valor = leerValor(evento);
    this.formulario.update((actual) => {
      const siguiente = { ...actual };
      siguiente[campo] = valor;
      return siguiente;
    });
  }

  actualizarBooleano(campo: 'atiendeGenero' | 'asumidoMinistro', evento: Event): void {
    const marcado = (evento.target as HTMLInputElement).checked;
    this.formulario.update((actual) =>
      campo === 'atiendeGenero'
        ? { ...actual, atiendeGenero: marcado }
        : { ...actual, asumidoMinistro: marcado },
    );
  }

  actualizarHito(
    campo: 'descripcion' | 'fecha' | 'fechaReal' | 'responsableTexto',
    evento: Event,
  ): void {
    const valor = leerValor(evento);
    if (campo === 'descripcion') {
      this.hitoNuevo.update((actual) => ({ ...actual, descripcion: valor }));
      return;
    }
    if (campo === 'fecha') {
      this.hitoNuevo.update((actual) => ({ ...actual, fecha: valor }));
      return;
    }
    if (campo === 'fechaReal') {
      this.hitoNuevo.update((actual) => ({ ...actual, fechaReal: valor }));
      return;
    }
    this.hitoNuevo.update((actual) => ({ ...actual, responsableTexto: valor }));
  }

  /**
   * `Cumplido` exige fecha real: se precarga la de hoy al elegir el estado y el
   * usuario puede corregirla antes de guardar.
   */
  actualizarEstadoHitoNuevo(evento: Event): void {
    const valor = leerValor(evento);
    if (!this.esEstadoHito(valor)) return;
    this.hitoNuevo.update((actual) => ({
      ...actual,
      estado: valor,
      fechaReal: valor === 'Cumplido' && !actual.fechaReal ? hoyIso() : actual.fechaReal,
    }));
  }

  async guardar(): Promise<void> {
    if (!this.puedeModificar()) {
      this.editError.set(
        this.modoAlta()
          ? 'No tiene permisos para registrar compromisos.'
          : 'No tiene permisos para modificar este compromiso.',
      );
      return;
    }

    const form = this.formulario();
    const accion = form.accion.trim();
    if (!accion) {
      this.editError.set('La acción comprometida es obligatoria.');
      return;
    }

    if (this.modoAlta()) {
      const caso = this.casoElegido();
      if (!caso?.codigo) {
        this.editError.set('Seleccione el caso al que pertenece el compromiso.');
        return;
      }

      // La demanda es obligatoria cuando el caso tiene alguna. Si el recurso
      // falla o el caso no registra demandas, no se bloquea el alta.
      if (this.estadoDemandas() === 'cargando' || this.estadoDemandas() === 'inactivo') {
        this.editError.set('Cargando las demandas del caso; vuelva a intentarlo en un instante.');
        return;
      }
      if (this.demandasCaso().length > 0 && !form.demandaId) {
        this.editError.set('Seleccione la demanda que atiende el compromiso.');
        return;
      }
    } else {
      if (!form.unidad.trim()) {
        this.editError.set('La unidad responsable es obligatoria.');
        return;
      }

      if (!(ESTADOS_COMPROMISO as readonly string[]).includes(form.estado)) {
        this.editError.set('El estado del compromiso no es válido.');
        return;
      }

      if (!this.cabecera().id) {
        this.editError.set('El compromiso no tiene identificador.');
        return;
      }
    }

    if (!(TIPOS_COMPROMISO as readonly string[]).includes(form.tipo)) {
      this.editError.set('El tipo de compromiso no es válido.');
      return;
    }

    const criterios = this.parsearCriterios(form.criteriosSmart);
    if (!criterios.ok) {
      this.editError.set('Los criterios SMART deben ser un objeto JSON válido.');
      return;
    }

    this.guardando.set(true);
    this.editError.set(null);

    let creado = false;

    try {
      if (this.modoAlta()) {
        await firstValueFrom(
          this.http.post<unknown>(urlApi('/v1/commitments'), this.cuerpoAlta(criterios.valor)),
        );
        creado = true;
      } else {
        const id = this.cabecera().id;
        const cuerpo: Record<string, unknown> = {
          accion,
          tipo: form.tipo,
          clasificacionAlcance: form.clasificacionAlcance || null,
          formalVerbal: form.formalVerbal || null,
          asumidoMinistro: form.asumidoMinistro,
          estado: form.estado,
          unidad: form.unidad.trim(),
          nivelGobierno: form.nivelGobierno || null,
          alcance: form.alcance || null,
          atiendeGenero: form.atiendeGenero,
          criteriosSmart: criterios.valor,
          evidenciaUri: form.evidenciaUri.trim() || null,
          fechaVencimiento: form.fechaVencimiento.trim() || null,
          ...this.camposPuntoFocal(form),
        };

        if (form.fechaInicio.trim()) {
          cuerpo['fechaInicio'] = form.fechaInicio.trim();
        }

        await firstValueFrom(
          this.http.patch<unknown>(urlApi(`/v1/commitments/${encodeURIComponent(id)}`), cuerpo),
        );
        this.editando.set(false);
        this.recurso.recargar();
        this.historialRecurso.recargar();
        this.actualizado.emit();
      }
    } catch (fallo) {
      this.editError.set(this.modoAlta() ? aErrorApi(fallo).message : this.mensajeDeError(fallo));
    } finally {
      this.guardando.set(false);
    }

    if (creado) this.creado.emit();
  }

  /**
   * Cuerpo de `POST /api/v1/commitments`. El servidor exige `accion` y una
   * referencia de caso, genera el código y deriva el estado inicial
   * (`Por iniciar`), así que no se envía `estado`. Sólo viajan los campos con
   * valor y los que `createCommitment` lee de verdad.
   */
  private cuerpoAlta(criterios: unknown): Record<string, unknown> {
    const form = this.formulario();
    const caso = this.casoElegido();
    const cuerpo: Record<string, unknown> = {
      casoCode: caso?.codigo ?? '',
      accion: form.accion.trim(),
      tipo: form.tipo,
      atiendeGenero: form.atiendeGenero,
      asumidoMinistro: form.asumidoMinistro,
    };

    if (form.demandaId) cuerpo['demandaId'] = form.demandaId;

    const unidad = form.unidad.trim();
    if (unidad) cuerpo['unidad'] = unidad;
    if (form.clasificacionAlcance) cuerpo['clasificacionAlcance'] = form.clasificacionAlcance;
    if (form.formalVerbal) cuerpo['formalVerbal'] = form.formalVerbal;
    if (form.nivelGobierno) cuerpo['nivelGobierno'] = form.nivelGobierno;
    if (form.alcance) cuerpo['alcance'] = form.alcance;

    const evidenciaUri = form.evidenciaUri.trim();
    if (evidenciaUri) cuerpo['evidenciaUri'] = evidenciaUri;

    const fechaInicio = form.fechaInicio.trim();
    if (fechaInicio) cuerpo['fechaInicio'] = fechaInicio;

    const fechaVencimiento = form.fechaVencimiento.trim();
    if (fechaVencimiento) cuerpo['fechaVencimiento'] = fechaVencimiento;

    if (criterios !== null) cuerpo['criteriosSmart'] = criterios;

    // El punto focal viaja por una sola vía: cuenta o texto libre, nunca ambas.
    const usuarioId = form.puntoFocalUsuarioId.trim();
    const textoPuntoFocal = form.puntoFocalTexto.trim();
    if (usuarioId) cuerpo['puntoFocalUsuarioId'] = usuarioId;
    else if (textoPuntoFocal) cuerpo['puntoFocalTexto'] = textoPuntoFocal;

    return cuerpo;
  }

  /**
   * Campos del punto focal para el `PATCH`: se envía la vía elegida y se limpia
   * la contraria si el registro traía valor, para no dejar ambos poblados.
   */
  private camposPuntoFocal(form: FormularioCompromiso): Record<string, unknown> {
    const usuarioId = form.puntoFocalUsuarioId.trim();
    const textoLibre = form.puntoFocalTexto.trim();
    const actual = this.cabecera();

    if (usuarioId) {
      const cambios: Record<string, unknown> = { puntoFocalUsuarioId: usuarioId };
      if (actual.puntoFocalTexto) cambios['puntoFocalTexto'] = null;
      return cambios;
    }

    const cambios: Record<string, unknown> = { puntoFocalTexto: textoLibre || null };
    if (actual.puntoFocalUsuarioId) cambios['puntoFocalUsuarioId'] = null;
    return cambios;
  }

  async anadirHito(): Promise<void> {
    if (!this.puedeModificar()) {
      this.hitosError.set('No tiene permisos para modificar este compromiso.');
      return;
    }

    const form = this.hitoNuevo();
    const descripcion = form.descripcion.trim();
    if (!descripcion) {
      this.hitosError.set('La descripción del hito es obligatoria.');
      return;
    }

    if (form.estado === 'Cumplido' && !form.fechaReal.trim()) {
      this.hitosError.set('La fecha real es obligatoria para un hito cumplido.');
      return;
    }

    const id = this.cabecera().id;
    if (!id) {
      this.hitosError.set('El compromiso no tiene identificador.');
      return;
    }

    const cuerpo: Record<string, unknown> = {
      descripcion,
      estado: form.estado,
    };
    if (form.fecha.trim()) cuerpo['fecha'] = form.fecha.trim();
    if (form.fechaReal.trim()) cuerpo['fechaReal'] = form.fechaReal.trim();
    if (form.responsableTexto.trim()) {
      cuerpo['responsableTexto'] = form.responsableTexto.trim();
    }

    this.hitoGuardando.set(true);
    this.hitosError.set(null);

    try {
      await firstValueFrom(
        this.http.post<unknown>(urlApi(`/v1/commitments/${encodeURIComponent(id)}/hitos`), cuerpo),
      );
      this.hitoNuevo.set({
        descripcion: '',
        fecha: '',
        fechaReal: '',
        estado: 'Registrado',
        responsableTexto: '',
      });
      this.recurso.recargar();
      this.historialRecurso.recargar();
      this.actualizado.emit();
    } catch (fallo) {
      this.hitosError.set(this.mensajeDeError(fallo, 'Revise la fecha real del hito.'));
    } finally {
      this.hitoGuardando.set(false);
    }
  }

  async cambiarEstadoHito(hito: Hito, evento: Event): Promise<void> {
    const select = evento.target as HTMLSelectElement;
    const nuevo = select.value;

    if (!this.esEstadoHito(nuevo) || nuevo === hito.estado) return;

    if (!this.puedeModificar()) {
      select.value = hito.estado;
      this.hitosError.set('No tiene permisos para modificar este compromiso.');
      return;
    }

    const id = this.cabecera().id;
    if (!id) {
      select.value = hito.estado;
      this.hitosError.set('El compromiso no tiene identificador.');
      return;
    }

    this.hitoCambiando.set(hito.id);
    this.hitosError.set(null);

    try {
      await firstValueFrom(
        this.http.patch<unknown>(
          urlApi(`/v1/commitments/${encodeURIComponent(id)}/hitos/${encodeURIComponent(hito.id)}`),
          { estado: nuevo },
        ),
      );
      this.recurso.recargar();
      this.historialRecurso.recargar();
      this.actualizado.emit();
    } catch (fallo) {
      select.value = hito.estado;
      this.hitosError.set(this.mensajeDeError(fallo));
    } finally {
      this.hitoCambiando.set(null);
    }
  }

  async cambiarResponsableHito(hito: Hito, evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const nuevo = input.value.trim();
    const actual = (hito.responsableTexto ?? '').trim();

    if (nuevo === actual) return;

    if (!this.puedeModificar()) {
      input.value = actual;
      this.hitosError.set('No tiene permisos para modificar este compromiso.');
      return;
    }

    const id = this.cabecera().id;
    if (!id) {
      input.value = actual;
      this.hitosError.set('El compromiso no tiene identificador.');
      return;
    }

    this.hitoCambiando.set(hito.id);
    this.hitosError.set(null);

    try {
      await firstValueFrom(
        this.http.patch<unknown>(
          urlApi(`/v1/commitments/${encodeURIComponent(id)}/hitos/${encodeURIComponent(hito.id)}`),
          { responsableTexto: nuevo || null },
        ),
      );
      this.recurso.recargar();
      this.historialRecurso.recargar();
      this.actualizado.emit();
    } catch (fallo) {
      input.value = actual;
      this.hitosError.set(this.mensajeDeError(fallo));
    } finally {
      this.hitoCambiando.set(null);
    }
  }

  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  /**
   * Los códigos de hito son largos (`CS-..._COMP001_H001`); la línea de tiempo
   * muestra sólo el sufijo (`H001`) para no romper la lectura.
   */
  codigoHito(codigo: string | null | undefined): string {
    const limpio = (codigo ?? '').trim();
    if (!limpio) return 'Hito';
    const partes = limpio.split('_');
    const sufijo = partes[partes.length - 1] ?? limpio;
    return /^H\d+$/i.test(sufijo) ? sufijo.toUpperCase() : limpio;
  }

  /** «Regional» se muestra como GORE; el valor del catálogo no cambia. */
  nivelTexto(valor: string | null | undefined): string {
    return etiquetaNivelGobierno(valor ?? null);
  }

  /** Item 16: etiqueta legible de la clasificación de alcance. */
  clasificacionAlcanceTexto(valor: string | null | undefined): string {
    return etiquetaClasificacionAlcance(valor);
  }

  /** Item 16: etiqueta legible del carácter formal o verbal. */
  formalVerbalTexto(valor: string | null | undefined): string {
    return etiquetaFormalVerbal(valor);
  }

  esAlcanceConocido(valor: string): boolean {
    return this.alcancesFormulario().some((opcion) => opcion.valor === valor);
  }

  esEnlace(uri: string | null): boolean {
    return uri ? /^https?:\/\//i.test(uri) : false;
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrar();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /** El panel es modal: Tab y Shift+Tab ciclan dentro de él. */
  private atraparFoco(evento: KeyboardEvent): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const enfocables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );

    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;

    const activo = document.activeElement;

    if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
      return;
    }

    if (evento.shiftKey && (activo === primero || !panel.contains(activo))) {
      evento.preventDefault();
      ultimo.focus();
    }
  }

  private esEstadoHito(valor: string): valor is EstadoHito {
    return (ESTADOS_HITO as readonly string[]).includes(valor);
  }

  /** `plazo_entrega` / `plazoEntrega` → «Plazo entrega», sin jerga en la ficha. */
  private etiquetaCriterio(clave: string): string {
    const conEspacios = clave
      .replace(/[_-]+/g, ' ')
      .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
      .trim();
    if (!conEspacios) return clave;
    return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
  }

  private parsearCriterios(textoCrudo: string): ResultadoCriterios {
    const limpio = textoCrudo.trim();
    if (!limpio) return { ok: true, valor: null };

    try {
      const valor: unknown = JSON.parse(limpio);
      if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
        return { ok: false };
      }
      return { ok: true, valor };
    } catch {
      return { ok: false };
    }
  }

  private mensajeDeError(
    fallo: unknown,
    pista = 'Revise la unidad, el alcance y las fechas.',
  ): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) {
      return 'No tiene permisos para modificar este compromiso (403).';
    }
    if (error.estado === 422) {
      return `El servidor rechazó los datos (422): ${error.message} ${pista}`;
    }
    if (error.estado === 404) {
      return 'El compromiso ya no existe; actualice el listado.';
    }
    if (error.esNoAutorizado) {
      return 'La sesión expiró. Vuelva a iniciar sesión.';
    }
    return error.message;
  }
}
