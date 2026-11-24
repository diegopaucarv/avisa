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
import { map } from 'rxjs';

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
  TramoEstadoCaso,
} from '../../dominio/mapeo';
import {
  AnularPanelComponent,
  ResultadoAnulacion,
  type ModoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { formatearFecha } from '../../shared/formato-fecha';
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
import { CuerpoDemanda, DemandaPanelComponent } from './demanda-panel.component';
import {
  CuerpoEvento,
  EventoPanelComponent,
  OpcionTipoHecho,
  aTiposHecho,
} from './evento-panel.component';
import { EnlaceRiel, RielRelacionesComponent } from './riel-relaciones.component';

/** Detalle del caso con las columnas nuevas de compromisos e hitos. */
type DetalleCasoConCompromisos = Omit<DetalleCasoConCierre, 'compromisos'> & {
  compromisos: CompromisoCasoConCaracteristicas[];
};

/** Hito aplanado de la ficha: `hitosDelCaso()` añade el código del compromiso. */
type HitoEnCaso = HitoCasoConResponsable & { compromiso: string };

/**
 * El mapeo compartido del caso descarta la clasificación, el carácter, la
 * bandera del Ministro y el responsable del hito; se recuperan del bruto sin
 * tocar `dominio/mapeo.ts`.
 */
function aDetalleCasoConCompromisos(bruto: unknown): DetalleCasoConCompromisos {
  const detalle = aDetalleCasoConCierre(bruto);
  return { ...detalle, compromisos: aCompromisosCaso(bruto, detalle.compromisos) };
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
    AnularPanelComponent,
    RielRelacionesComponent,
    ThOrdenDirective,
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

    /* Los botones de un hecho comparten fila y se ocultan al imprimir con
       la regla timeline-edit, que ya está fuera de la hoja de impresión. */
    .timeline-acciones {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .aviso-ok {
      color: #2f6f52;
      font-size: 13.5px;
    }

    .detail-hint {
      display: block;
      margin-top: 2px;
      font-size: 13px;
      font-weight: 400;
      color: #8d99a6;
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

    .timeline-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    /* Se anida para ganar a la regla del tema para párrafos del timeline. */
    .timeline-list li .timeline-actor {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 12px;
    }

    /* Se anida para ganar al white-space: nowrap de las celdas de la tabla. */
    .data-table td.celda-larga {
      min-width: 220px;
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

  /** Hitos de todos los acuerdos y compromisos del caso, aplanados. */
  readonly hitosDelCaso = computed(() =>
    (this.detalle()?.compromisos ?? []).flatMap((compromiso) =>
      compromiso.hitos.map((hito) => ({ ...hito, compromiso: compromiso.codigo })),
    ),
  );

  /* Orden local de cada tabla de la ficha (asc → desc → sin orden). */

  readonly ordenActores = new OrdenTabla<ActorCaso>();
  private readonly accesoresActores: Record<string, (actor: ActorCaso) => unknown> = {
    actor: (actor) => this.nombreActor(actor),
    correo: (actor) => actor.correo,
    tipo: (actor) => actor.tipo,
    funcion: (actor) => actor.funcion,
    posicionamiento: (actor) => actor.posicionamiento,
  };
  readonly filasActores = computed(() =>
    this.ordenActores.ordenar(this.ficha()?.actores ?? [], this.accesoresActores),
  );

  readonly ordenDemandas = new OrdenTabla<DemandaCaso>();
  private readonly accesoresDemandas: Record<string, (demanda: DemandaCaso) => unknown> = {
    problema: (demanda) => demanda.problema ?? demanda.descripcion,
    propuesta: (demanda) => demanda.propuesta,
    pedido: (demanda) => demanda.pedido,
    estado: (demanda) => demanda.estado,
    origen: (demanda) => demanda.documentoOrigenCodigo ?? demanda.documentoOrigenTitulo,
  };
  readonly filasDemandas = computed(() =>
    this.ordenDemandas.ordenar(this.ficha()?.demandas ?? [], this.accesoresDemandas),
  );

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
    compromiso: (hito) => hito.compromiso,
    hito: (hito) => hito.descripcion,
    fecha: (hito) => hito.fecha ?? hito.fechaTexto,
    estado: (hito) => hito.estado,
    responsable: (hito) => hito.responsableTexto,
  };
  readonly filasHitos = computed(() =>
    this.ordenHitos.ordenar(this.hitosDelCaso(), this.accesoresHitos),
  );

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
        etiqueta: 'Línea de tiempo',
        ancla: 'eventos-caso',
        contador: ficha.eventos.length,
        icono: 'actividad',
      },
      {
        etiqueta: 'Mapeo de actores',
        ancla: 'actores-caso',
        contador: ficha.actores.length,
        icono: 'actores',
      },
      {
        etiqueta: 'Caso de análisis (Canva)',
        ancla: 'analisis-caso',
        contador: null,
        icono: 'documentos',
        disponible: false,
        nota: 'El caso no guarda un tablero de Canva: no hay enlace que abrir.',
      },
      {
        etiqueta: 'Documentos vinculados',
        ancla: 'documentos-caso',
        contador: ficha.documentos.length,
        icono: 'documentos',
      },
    ];
  });

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
  readonly campos = CAMPOS_EDITABLES;
  readonly editando = signal<CampoEditable | null>(null);
  readonly borrador = signal('');
  readonly guardandoCampo = signal(false);
  readonly errorCampo = signal<string | null>(null);
  readonly avisoCampo = signal<string | null>(null);

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

  /** Hecho cuya validación se está enviando; `null` si no hay envío en curso. */
  readonly validandoEvento = signal<string | null>(null);
  readonly errorValidacion = signal<string | null>(null);
  readonly avisoValidacion = signal<string | null>(null);

  /** Demanda abierta en el panel; `null` significa alta. */
  readonly demandaEditada = signal<DemandaCaso | null>(null);
  readonly panelDemandaAbierto = signal(false);
  readonly guardandoDemanda = signal(false);
  readonly errorDemanda = signal<string | null>(null);
  readonly avisoDemanda = signal<string | null>(null);

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

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  recargar(): void {
    this.detalleActualizado.set(null);
    this.recurso.recargar();
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
    if (!this.puedeModificar()) return;
    this.errorCampo.set(null);
    this.avisoCampo.set(null);
    this.borrador.set(this.valoresCaso()[campo]);
    this.editando.set(campo);
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

  /** Fecha de inicio del caso en `dd/mm/aaaa`; `—` cuando no está registrada. */
  fechaTexto(valor: string | null | undefined): string {
    return formatearFecha(valor) || '—';
  }

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
    const texto = (demanda.problema ?? demanda.descripcion ?? '').trim();
    if (!texto) return 'sin problema';
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
   * `core.actores` sólo guarda `nombre_actual` y la API no expone organización
   * ni teléfono en el actor del caso, así que esos dos huecos se escriben con un
   * guion: el dato ausente se declara, no se rellena.
   */
  private lineaWhatsApp(actor: ActorCaso): string {
    const campos = [this.nombreActor(actor), '—', '—', actor.correo || '—'];
    return `- ${campos.join(' - ')}`;
  }

  async copiarActoresWhatsApp(actores: readonly ActorCaso[]): Promise<void> {
    this.avisoActores.set(null);
    if (actores.length === 0) return;

    const texto = actores.map((actor) => this.lineaWhatsApp(actor)).join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      this.avisoActores.set(
        `Se copiaron ${actores.length} actores con el formato de WhatsApp. La organización y el teléfono no llegan todavía por la API: se copian como «—».`,
      );
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
      ['Actor', 'Tipo', 'Función', 'Posicionamiento', 'Correo'].map(escapar).join(';'),
      ...actores.map((actor) =>
        [this.nombreActor(actor), actor.tipo, actor.funcion, actor.posicionamiento, actor.correo]
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

  /**
   * `PATCH /v1/cases/{codigo}/events/{id}` con `{ validado }`.
   *
   * La validación es un acto humano explícito: se alterna sobre el valor actual
   * del hecho y nunca se deduce al registrar. El servidor audita el cambio.
   */
  alternarValidacion(evento: EventoCaso): void {
    const codigo = this.codigo();
    if (!codigo || !this.puedeModificar() || this.validandoEvento() !== null) return;

    const url = urlApi(
      `/v1/cases/${encodeURIComponent(codigo)}/events/${encodeURIComponent(evento.id)}`,
    );
    const validado = !evento.validado;

    this.validandoEvento.set(evento.id);
    this.errorValidacion.set(null);
    this.avisoValidacion.set(null);

    this.http.patch<unknown>(url, { validado }).subscribe({
      next: () => {
        this.validandoEvento.set(null);
        this.recargar();
        this.avisoValidacion.set(validado ? 'Hecho validado.' : 'Validación retirada.');
      },
      error: (fallo: unknown) => {
        this.validandoEvento.set(null);
        this.errorValidacion.set(this.mensajeDeErrorValidacion(fallo));
      },
    });
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
      this.confirmandoArchivo.set(null);
      this.errorCampo.set(null);
      this.errorArchivo.set(null);
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

  editarDemanda(demanda: DemandaCaso): void {
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

  private mensajeDeErrorValidacion(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite validar hechos en este caso.';
    return error.message;
  }

  private mensajeDeErrorDemanda(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite modificar las demandas de este caso.';
    if (error.codigo === 'SIN_CAMBIOS') return 'No hay cambios que guardar.';
    if (error.codigo === 'INVALID_INPUT' || error.estado === 422) {
      return 'Datos inválidos: revise el problema (3P) y el estado de atención.';
    }
    return error.message;
  }

  private mensajeDeErrorCampo(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite modificar este caso.';
    if (error.codigo === 'SIN_CAMBIOS') return 'No hay cambios que guardar.';
    return error.message;
  }

  private mensajeDeErrorArchivo(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite cambiar el estado de este caso.';
    return error.message;
  }
}
