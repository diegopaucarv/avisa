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
import { DomSanitizer, type SafeResourceUrl, type SafeUrl } from '@angular/platform-browser';

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
import { aCaso } from '../../dominio/mapeo';
import type { Caso } from '../../dominio/modelos';
import { IconoComponent } from '../../shared/ui/icono.component';
import { salirModal } from '../../shared/ui/modal-salida';
import { AdjuntosPanelComponent } from '../../shared/ui/adjuntos-panel.component';
import {
  ACEPTADOS_DOCUMENTO,
  DocumentoArchivoService,
  MAX_DOCUMENTO_BYTES,
} from './documento-archivo.service';
import {
  aDetalleDocumento,
  claseEstado,
  etapaFlujo,
  etiquetaAnexo,
  formatearFecha,
  formatearFechaHora,
  nombreArchivo,
  origenDeExtraccion,
  temasDeExtraccion,
  type AltaDocumento,
  type DetalleDocumento,
  type Documento,
  type EstadoExtraccion,
  type ExtraccionDocumento,
  type OpcionCatalogo,
  type PatchDocumento,
  type VersionDocumento,
} from './documento.mapeo';

type BorradorDocumento = {
  titulo: string;
  tipo: string;
  fecha: string;
  resumen: string;
  archivo: string;
  casoCode: string;
};

/** Campos del alta; el caso se elige con el buscador (`casoElegido`). */
type BorradorAlta = {
  titulo: string;
  tipo: string;
  fecha: string;
  resumen: string;
  archivo: string;
  urlLista: string;
  urlFoto: string;
};

type CampoAlta = keyof BorradorAlta;

function borradorAltaVacio(): BorradorAlta {
  return { titulo: '', tipo: '', fecha: '', resumen: '', archivo: '', urlLista: '', urlFoto: '' };
}

/** Estados de flujo que el repositorio acepta al validar o rechazar. */
type EstadoDecision = 'Validado' | 'Rechazado';

type CampoBorrador = keyof BorradorDocumento;

/** `undefined` = no cambió; `null` = se vació a propósito. */
function diferenciaTexto(valor: string, original: string | null): string | null | undefined {
  const limpio = valor.trim();
  if (limpio === (original ?? '').trim()) return undefined;
  return limpio ? limpio : null;
}

/**
 * Panel lateral derecho de un documento.
 *
 * Es la mitad «detalle» del maestro-detalle: el listado queda detrás y la ficha
 * se abre aquí, sin navegar. Es un diálogo modal (`role="dialog"`,
 * `aria-modal`), se cierra con Escape y devuelve el foco al elemento que lo
 * abrió; Tab y Shift+Tab ciclan dentro del panel.
 *
 * Carga `GET /api/v1/documents/:id` para enriquecer la fila (código legado y
 * fuentes de la evidencia) y, si el rol lo permite, edita con
 * `PATCH /api/v1/documents/:id` enviando sólo los campos que cambian.
 */
@Component({
  selector: 'app-documento-panel',
  imports: [IconoComponent, AdjuntosPanelComponent],
  templateUrl: './documento-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: contents;
    }

    /* El drawer global mide 600 px; la ficha necesita algo más de aire. */
    .drawer {
      width: min(640px, 100%);
    }

    .panel-cabecera {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .panel-codigo {
      margin: 0;
      color: #8a98a5;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    .panel-badges {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }

    .panel-tipo {
      background: #eef3fa;
      color: #4a6b93;
    }

    .panel-anexo {
      background: #f0f3f5;
      color: #657684;
    }

    .panel-validado {
      background: #edf6f0;
      color: #52806a;
    }

    .panel-cuerpo {
      gap: 16px;
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

    .panel-datos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 16px;
      margin: 10px 0 0;
    }

    .panel-datos > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .panel-datos dt {
      color: #97a1aa;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .panel-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .panel-texto {
      margin: 8px 0 0;
      color: #52677a;
      font-size: 13px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .panel-vacio {
      margin: 8px 0 0;
      color: #a0aab3;
      font-size: 13px;
      font-style: italic;
    }

    .panel-nota {
      margin: 0;
      color: #8d99a6;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .panel-aviso {
      margin: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #edf6f0;
      color: #52806a;
      font-size: 13px;
    }

    .panel-error {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid #f0d9d5;
      border-radius: 6px;
      background: #fdf6f5;
      color: #a3402f;
      font-size: 13px;
    }

    .panel-error p {
      margin: 0;
    }

    .panel-formulario {
      display: flex;
      flex-direction: column;
      gap: 11px;
      padding-top: 12px;
      border-top: 1px solid #eef2f6;
    }

    .panel-formulario .form-textarea {
      min-height: 68px;
    }

    .panel-formulario-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .panel-acciones-estado {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .panel-confirmacion {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border: 1px solid #f3e0c2;
      border-radius: 6px;
      background: #fdf8ef;
      color: #7a5a24;
      font-size: 13px;
    }

    .panel-confirmacion p {
      margin: 0;
      line-height: 1.5;
    }

    .panel-fuentes {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
    }

    .panel-fuentes li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 10px;
      border-left: 2px solid #dbe7f4;
    }

    .panel-fuentes strong {
      color: #465a6c;
      font-size: 13px;
    }

    .panel-fuentes small {
      color: #97a1aa;
      font-size: 12px;
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

    /* ── Archivo, visor, versiones y extracciones ──────────────── */

    .panel-acciones-archivo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 10px 0 6px;
    }

    .subir-archivo {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 0 10px;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 8px;
      background: var(--paper, #fff);
      color: var(--blue-dark, #1d427f);
      font: 600 12.5px/1 var(--font-body, system-ui);
      cursor: pointer;
    }

    .subir-archivo:hover {
      background: var(--blue-pale, #eaf1fb);
    }

    .subir-archivo:focus-within {
      outline: 2px solid var(--blue, #2455a2);
      outline-offset: 1px;
    }

    .subir-archivo input[type='file'] {
      max-width: 210px;
      font-size: 12px;
    }

    .mono {
      color: #5c7285;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
    }

    .visor {
      margin-top: 10px;
      overflow: hidden;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 10px;
      background: var(--canvas, #f5f7f8);
    }

    .visor-marco {
      display: block;
      width: 100%;
      height: 520px;
      border: 0;
      background: #fff;
    }

    .visor-imagen {
      display: block;
      max-width: 100%;
      margin: 0 auto;
      padding: 8px;
    }

    .visor-texto {
      max-height: 380px;
      margin: 0;
      padding: 12px 14px;
      overflow: auto;
      color: var(--ink-2, #33475b);
      font:
        12px/1.5 ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .visor-texto.extracto {
      margin-top: 6px;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 8px;
      background: #fbfcfd;
    }

    .flag {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      padding: 7px 10px;
      border: 1px solid #f3e0c2;
      border-radius: 7px;
      background: var(--amber-pale, #fff4e2);
      color: var(--amber, #aa6a11);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.45;
    }

    .flag::before {
      content: '⚑';
      font-size: 13px;
      line-height: 1.25;
    }

    .flag-info {
      border-color: #cddcef;
      background: var(--blue-pale, #eaf1fb);
      color: var(--blue, #2455a2);
    }

    .flag-mini {
      display: inline-flex;
      padding: 2px 6px;
      font-size: 10.5px;
      font-weight: 600;
    }

    .docs {
      width: 100%;
      margin-top: 8px;
      border-collapse: collapse;
    }

    .docs th {
      padding: 4px 8px 4px 0;
      border-bottom: 1px solid var(--line, #e6ebef);
      color: #97a1aa;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-align: left;
      text-transform: uppercase;
    }

    .docs td {
      padding: 6px 8px 6px 0;
      border-bottom: 1px solid #f1f3f5;
      color: var(--ink-2, #33475b);
      font-size: 12px;
      line-height: 1.45;
      vertical-align: top;
    }

    .docs tr:last-child td {
      border-bottom: 0;
    }

    .docs .tipo {
      display: inline-flex;
      align-items: center;
      min-height: 18px;
      padding: 0 6px;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 4px;
      background: #f7f9fa;
      color: #6d8296;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .docs .fecha {
      color: var(--muted, #778797);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .docs .doc-link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--blue, #2455a2);
      font: 600 12px/1.4 var(--font-body, system-ui);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
    }

    .docs .doc-link:hover {
      text-decoration: underline;
    }

    .docs .doc-link:focus-visible {
      outline: 2px solid var(--blue, #2455a2);
      outline-offset: 1px;
    }

    .grupo-titulo {
      margin: 10px 0 4px;
      color: var(--ink, #17283a);
      font: 700 13px/1.2 var(--font-display, system-ui);
    }

    .extraccion-bloque + .extraccion-bloque {
      margin-top: 12px;
    }

    .panel-datos-linea {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 4px 0;
    }

    .chips-temas {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      min-height: 19px;
      padding: 0 8px;
      border: 1px solid var(--line, #e6ebef);
      border-radius: 999px;
      background: #f7f9fa;
      color: var(--muted, #778797);
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .chip-tema {
      background: var(--paper, #fff);
      color: var(--ink-2, #33475b);
      font-weight: 600;
      letter-spacing: 0;
      text-transform: none;
    }

    .chip-listo {
      border-color: #cbe6d8;
      background: #eef7f2;
      color: var(--green, #34785b);
    }

    .chip-error {
      border-color: #f0d2cf;
      background: var(--red-pale, #fbeceb);
      color: var(--red, #ad4d46);
    }

    .chip-no_disponible,
    .chip-pendiente,
    .chip-en_proceso {
      border-color: #f3e0c2;
      background: var(--amber-pale, #fff4e2);
      color: var(--amber, #aa6a11);
    }
  `,
})
export class DocumentoPanelComponent {
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);
  private readonly destruccion = inject(DestroyRef);

  /** `null` abre el panel en modo alta; con documento, muestra la ficha de siempre. */
  readonly documento = input<Documento | null>(null);
  /** Tipos de `GET /api/v1/catalogs`, para el formulario y su «Anexo N° X». */
  readonly tipos = input<readonly OpcionCatalogo[]>([]);

  readonly cerrado = output<void>();
  readonly actualizado = output<void>();
  readonly anular = output<void>();
  /** Alta correcta: el contenedor cierra el panel, recarga y avisa. */
  readonly creado = output<Documento>();

  private readonly detalleRecurso = consulta<DetalleDocumento>({
    fuente: () => {
      const id = this.documento()?.id;
      return id ? urlApi(`/v1/documents/${encodeURIComponent(id)}`) : null;
    },
    esquema: aDetalleDocumento,
  });

  /** El detalle sólo se usa si corresponde al documento abierto. */
  private readonly detalle = computed<DetalleDocumento | null>(() => {
    const valor = this.detalleRecurso.valor();
    const id = this.documento()?.id;
    if (!valor || !id) return null;
    return valor.documento.id === id ? valor : null;
  });

  readonly modoAlta = computed(() => this.documento() === null);
  readonly cabecera = computed<Documento | null>(
    () => this.detalle()?.documento ?? this.documento(),
  );
  readonly fuentes = computed(() => this.detalle()?.fuentes ?? []);

  /** Etapa de flujo derivada del estado (ver `etapaFlujo`). */
  readonly etapa = computed(() => {
    const documento = this.cabecera();
    return documento ? etapaFlujo(documento) : 'Sin etapa';
  });
  readonly errorDetalle = this.detalleRecurso.error;
  readonly cargandoDetalle = computed(
    () => this.detalleRecurso.estado() === 'cargando' && this.detalle() === null,
  );

  readonly puedeModificar = computed(() =>
    this.capacidades.puedeModificar(this.cabecera()?.clasificacion ?? 1),
  );

  /** Anular exige, además de escritura sobre la clasificación, el privilegio de anulación. */
  readonly puedeAnular = computed(() => this.capacidades.puedeEliminar() && this.puedeModificar());

  readonly editando = signal(false);
  readonly guardando = signal(false);
  readonly borrador = signal<BorradorDocumento | null>(null);
  readonly errorGuardado = signal<string | null>(null);
  readonly mensajeLocal = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly formulario = computed(() => (this.editando() ? this.borrador() : null));

  readonly borradorAlta = signal<BorradorAlta>(borradorAltaVacio());
  readonly busquedaCaso = signal('');
  readonly casoElegido = signal<Caso | null>(null);
  private temporizadorCaso?: ReturnType<typeof setTimeout>;

  /**
   * Validar / Rechazar no pasan por el formulario: son acciones explícitas
   * sobre el estado de flujo del documento (`PATCH /api/v1/documents/:id`).
   */
  readonly estadoPendiente = signal<EstadoDecision | null>(null);
  readonly guardandoEstado = signal(false);
  readonly errorEstado = signal<string | null>(null);
  readonly avisoEstado = signal<string | null>(null);

  /* -------- Archivo binario, visor, versiones y extracciones -------- */

  private readonly archivoServicio = inject(DocumentoArchivoService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly aceptadosArchivo = ACEPTADOS_DOCUMENTO;

  readonly subiendoArchivo = signal(false);
  readonly errorArchivo = signal<string | null>(null);
  readonly avisoArchivo = signal<string | null>(null);

  /** `null` = visor cerrado; `otro` = hay archivo pero no se previsualiza. */
  readonly tipoVisor = signal<'pdf' | 'imagen' | 'texto' | 'otro' | null>(null);
  readonly cargandoVisor = signal(false);
  readonly urlIframe = signal<SafeResourceUrl | null>(null);
  readonly urlImagen = signal<SafeUrl | null>(null);
  readonly textoVisor = signal<string | null>(null);
  private urlObjeto: string | null = null;
  private tokenVisor = 0;

  readonly versiones = signal<readonly VersionDocumento[]>([]);
  readonly cargandoVersiones = signal(false);
  readonly errorVersiones = signal<string | null>(null);
  readonly errorDescargaVersion = signal<string | null>(null);
  private suscripcionVersiones?: { unsubscribe: () => void };

  readonly extracciones = signal<readonly ExtraccionDocumento[]>([]);
  readonly cargandoExtracciones = signal(false);
  readonly errorExtraccion = signal<string | null>(null);
  readonly avisoExtraccion = signal<string | null>(null);
  readonly ejecutandoExtraccion = signal<'ocr' | 'temas' | null>(null);
  private suscripcionExtracciones?: { unsubscribe: () => void };

  readonly extraccionOcr = computed(
    () => this.extracciones().find((item) => item.tipo === 'ocr') ?? null,
  );
  readonly extraccionTemas = computed(
    () => this.extracciones().find((item) => item.tipo === 'temas') ?? null,
  );
  readonly temasClave = computed(() => temasDeExtraccion(this.extraccionTemas()));
  readonly origenTemas = computed(() => origenDeExtraccion(this.extraccionTemas()));

  readonly opcionesTipo = computed<readonly OpcionCatalogo[]>(() => {
    const base = this.tipos();
    const actual = this.cabecera()?.tipo ?? null;
    if (!actual || base.some((opcion) => opcion.valor === actual)) return base;

    return [
      {
        valor: actual,
        etiqueta: this.cabecera()?.tipoNombre ?? actual,
        anexoNumero: this.cabecera()?.anexoNumero ?? null,
      },
      ...base,
    ];
  });

  /**
   * Casos para el alta: sólo se consulta en modo alta y con un término escrito.
   * `GET /api/v1/cases?q=` busca por código, título y resumen.
   */
  private readonly casosRecurso = consulta<Coleccion<Caso>>({
    fuente: () => {
      if (!this.modoAlta()) return null;
      const q = this.busquedaCaso().trim();
      if (!q) return null;
      return urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 6 }),
        q,
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

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Elemento que tenía el foco al abrir, para devolvérselo al cerrar. */
  private readonly focoPrevio =
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  private idAnterior: string | null = null;

  constructor() {
    afterNextRender(() => this.panel()?.nativeElement.focus());

    if (typeof document !== 'undefined') {
      // Escape cierra el panel aunque el foco se haya ido a un bloque de texto.
      const alEscape = (evento: KeyboardEvent): void => {
        if (evento.key !== 'Escape') return;
        evento.preventDefault();
        this.cerrarConSalida();
      };
      document.addEventListener('keydown', alEscape);
      this.destruccion.onDestroy(() => {
        document.removeEventListener('keydown', alEscape);
        clearTimeout(this.temporizadorCaso);
        this.focoPrevio?.focus?.();
      });
    }

    // Al cambiar de documento abierto, el borrador anterior no se reutiliza.
    effect(() => {
      const id = this.documento()?.id ?? null;
      if (id === this.idAnterior) return;
      this.idAnterior = id;
      this.editando.set(false);
      this.borrador.set(null);
      this.errorGuardado.set(null);
      this.mensajeLocal.set(null);
      this.aviso.set(null);
      this.estadoPendiente.set(null);
      this.errorEstado.set(null);
      this.avisoEstado.set(null);
      this.borradorAlta.set(borradorAltaVacio());
      this.busquedaCaso.set('');
      this.casoElegido.set(null);

      this.limpiarVisor();
      this.errorArchivo.set(null);
      this.avisoArchivo.set(null);
      this.subiendoArchivo.set(false);

      this.versiones.set([]);
      this.errorVersiones.set(null);
      this.errorDescargaVersion.set(null);
      this.cargandoVersiones.set(false);

      this.extracciones.set([]);
      this.errorExtraccion.set(null);
      this.avisoExtraccion.set(null);
      this.ejecutandoExtraccion.set(null);
      this.cargandoExtracciones.set(false);

      if (id) {
        this.cargarVersiones(id);
        this.cargarExtracciones(id);
      }
    });

    // El visor usa un object URL: hay que revocarlo al cerrar el panel.
    this.destruccion.onDestroy(() => {
      this.suscripcionVersiones?.unsubscribe();
      this.suscripcionExtracciones?.unsubscribe();
      if (this.urlObjeto) {
        URL.revokeObjectURL(this.urlObjeto);
        this.urlObjeto = null;
      }
    });
  }

  formatearFecha(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  claseEstado(estado: string | null): string {
    return claseEstado(estado);
  }

  etiquetaAnexo(anexoNumero: number): string {
    return etiquetaAnexo(anexoNumero);
  }

  nombreArchivo(valor: string | null): string {
    return nombreArchivo(valor);
  }

  esEnlace(valor: string | null): boolean {
    return valor ? /^https?:\/\//i.test(valor) : false;
  }

  /** Debounce de ~300 ms para el buscador de casos del alta. */
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
  }

  quitarCaso(): void {
    this.casoElegido.set(null);
    this.busquedaCaso.set('');
    clearTimeout(this.temporizadorCaso);
  }

  campoAlta(clave: CampoAlta, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    this.borradorAlta.update((actual) => ({ ...actual, [clave]: objetivo.value }));
  }

  alEnviarAlta(evento: Event): void {
    evento.preventDefault();
    this.registrarDocumento();
  }

  /**
   * `POST /api/v1/documents`: registra metadatos y enlace, sin subir archivos.
   * Sólo viajan las claves que lee `createDocument`; los opcionales vacíos se
   * omiten porque el repositorio rechaza la cadena vacía (422).
   */
  registrarDocumento(): void {
    if (this.guardando()) return;

    if (!this.capacidades.puedeEditar()) {
      this.errorGuardado.set('Su rol no permite registrar documentos.');
      return;
    }

    const borrador = this.borradorAlta();
    const titulo = borrador.titulo.trim();
    if (!titulo) {
      this.mensajeLocal.set('El título es obligatorio.');
      return;
    }

    const tipo = borrador.tipo.trim();
    if (!tipo) {
      this.mensajeLocal.set('El tipo es obligatorio; elija uno del catálogo.');
      return;
    }

    const cuerpo: AltaDocumento = { titulo, tipo };

    const casoCode = this.casoElegido()?.codigo ?? '';
    if (casoCode) cuerpo.casoCode = casoCode;
    if (borrador.fecha) cuerpo.fecha = borrador.fecha;

    const resumen = borrador.resumen.trim();
    if (resumen) cuerpo.resumen = resumen;

    const archivo = borrador.archivo.trim();
    if (archivo) cuerpo.archivo = archivo;

    const urlLista = borrador.urlLista.trim();
    if (urlLista) cuerpo.urlLista = urlLista;

    const urlFoto = borrador.urlFoto.trim();
    if (urlFoto) cuerpo.urlFoto = urlFoto;

    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.mensajeLocal.set(null);

    this.http.post<unknown>(urlApi('/v1/documents'), cuerpo).subscribe({
      next: (bruto) => {
        this.guardando.set(false);
        this.creado.emit(aDetalleDocumento(bruto).documento);
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorGuardado.set(aErrorApi(fallo).message);
      },
    });
  }

  recargarDetalle(): void {
    this.detalleRecurso.recargar();
  }

  iniciarEdicion(): void {
    if (!this.puedeModificar()) return;

    const documento = this.cabecera();
    if (!documento) return;
    this.borrador.set({
      titulo: documento.titulo ?? '',
      tipo: documento.tipo ?? '',
      fecha: documento.fecha ?? '',
      resumen: documento.resumen ?? '',
      archivo: documento.archivo ?? '',
      casoCode: documento.casoCode ?? '',
    });
    this.mensajeLocal.set(null);
    this.errorGuardado.set(null);
    this.aviso.set(null);
    this.estadoPendiente.set(null);
    this.errorEstado.set(null);
    this.editando.set(true);
  }

  cancelarEdicion(): void {
    this.editando.set(false);
    this.borrador.set(null);
    this.mensajeLocal.set(null);
  }

  campo(clave: CampoBorrador, evento: Event): void {
    const objetivo = evento.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    this.borrador.update((actual) => (actual ? { ...actual, [clave]: objetivo.value } : actual));
  }

  alEnviarFormulario(evento: Event): void {
    evento.preventDefault();
    this.guardarCambios();
  }

  guardarCambios(): void {
    const documento = this.cabecera();
    const borrador = this.borrador();
    if (!documento || !borrador) return;

    if (!this.puedeModificar()) {
      this.errorGuardado.set('Su rol no permite modificar este documento.');
      return;
    }

    const titulo = borrador.titulo.trim();
    if (!titulo) {
      this.mensajeLocal.set('El título es obligatorio.');
      return;
    }

    // `updateDocument` rechaza `fecha: null`: no se puede dejar vacía.
    if (!borrador.fecha) {
      this.mensajeLocal.set('La fecha es obligatoria (AAAA-MM-DD).');
      return;
    }

    const cambios: PatchDocumento = {};

    if (titulo !== (documento.titulo ?? '').trim()) cambios.titulo = titulo;

    const tipo = borrador.tipo.trim();
    if (tipo !== (documento.tipo ?? '')) {
      // `updateDocument` no admite `tipo: null`: no se puede dejar vacío.
      if (!tipo) {
        this.mensajeLocal.set('El tipo es obligatorio; elija uno del catálogo.');
        return;
      }
      cambios.tipo = tipo;
    }

    if (borrador.fecha !== (documento.fecha ?? '')) cambios.fecha = borrador.fecha;

    const resumen = diferenciaTexto(borrador.resumen, documento.resumen);
    if (resumen !== undefined) cambios.resumen = resumen;

    const archivo = diferenciaTexto(borrador.archivo, documento.archivo);
    if (archivo !== undefined) cambios.archivo = archivo;

    const casoCode = diferenciaTexto(borrador.casoCode, documento.casoCode);
    if (casoCode !== undefined) cambios.casoCode = casoCode;

    if (Object.keys(cambios).length === 0) {
      this.mensajeLocal.set('No hay cambios que guardar.');
      return;
    }

    this.mensajeLocal.set(null);
    this.enviar(documento.id, cambios);
  }

  /** Abre la confirmación de validación o rechazo; nunca envía directo. */
  pedirCambioEstado(objetivo: EstadoDecision): void {
    if (!this.puedeModificar() || this.guardandoEstado()) return;
    this.errorEstado.set(null);
    this.avisoEstado.set(null);
    this.estadoPendiente.set(objetivo);
  }

  cancelarCambioEstado(): void {
    if (this.guardandoEstado()) return;
    this.estadoPendiente.set(null);
  }

  /**
   * `PATCH /api/v1/documents/:id` con `{ estado }`: el repositorio sólo acepta
   * los estados de `ESTADOS_DOCUMENTO` y no recibe motivo para este cambio. El
   * indicador `es_validado_humano` no es escribible por la API y no se toca.
   */
  confirmarCambioEstado(): void {
    const objetivo = this.estadoPendiente();
    const documento = this.cabecera();
    if (!objetivo || !documento) return;

    if (!documento.id) {
      this.errorEstado.set('El documento no tiene identificador.');
      return;
    }

    if (!this.puedeModificar()) {
      this.errorEstado.set('Su rol no permite modificar este documento.');
      return;
    }

    this.guardandoEstado.set(true);
    this.errorEstado.set(null);

    this.http
      .patch<unknown>(urlApi(`/v1/documents/${encodeURIComponent(documento.id)}`), {
        estado: objetivo,
      })
      .subscribe({
        next: () => {
          this.guardandoEstado.set(false);
          this.estadoPendiente.set(null);
          this.avisoEstado.set(`El documento quedó como «${objetivo}».`);
          this.detalleRecurso.recargar();
          this.actualizado.emit();
        },
        error: (fallo: unknown) => {
          this.guardandoEstado.set(false);
          this.errorEstado.set(this.mensajeDeError(fallo));
        },
      });
  }

  alFondo(evento: MouseEvent): void {
    if (evento.target === evento.currentTarget) this.cerrarConSalida();
  }

  /** Cierra con la animación de salida y luego avisa al contenedor. */
  cerrarConSalida(): void {
    salirModal(this.panel()?.nativeElement, () => this.cerrado.emit());
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
  }

  /* -------- Archivo binario: visor, versiones y extracciones -------- */

  /** Cierra el visor y revoca el object URL vigente. */
  limpiarVisor(): void {
    this.tokenVisor += 1;
    if (this.urlObjeto) {
      URL.revokeObjectURL(this.urlObjeto);
      this.urlObjeto = null;
    }
    this.tipoVisor.set(null);
    this.urlIframe.set(null);
    this.urlImagen.set(null);
    this.textoVisor.set(null);
    this.cargandoVisor.set(false);
  }

  /**
   * Abre o cierra el visor del archivo vigente. El binario se pide con `fetch`
   * (cookie `HttpOnly`) y nunca se cachea: cada apertura revalida.
   */
  async verArchivo(): Promise<void> {
    if (this.tipoVisor() !== null) {
      this.limpiarVisor();
      return;
    }

    const documento = this.cabecera();
    if (!documento || !documento.tieneArchivo) return;

    this.limpiarVisor();
    const token = this.tokenVisor;
    this.errorArchivo.set(null);
    this.cargandoVisor.set(true);

    try {
      const blob = await this.archivoServicio.blobActual(documento.id);
      if (token !== this.tokenVisor) return;

      const mime = (blob.type || documento.mime || '').toLowerCase();

      if (mime.startsWith('image/')) {
        const objeto = URL.createObjectURL(blob);
        this.urlObjeto = objeto;
        this.urlImagen.set(this.sanitizer.bypassSecurityTrustUrl(objeto));
        this.tipoVisor.set('imagen');
        return;
      }

      if (mime === 'application/pdf') {
        const objeto = URL.createObjectURL(blob);
        this.urlObjeto = objeto;
        this.urlIframe.set(this.sanitizer.bypassSecurityTrustResourceUrl(objeto));
        this.tipoVisor.set('pdf');
        return;
      }

      if (mime.startsWith('text/') || mime === 'application/csv') {
        const texto = await blob.text();
        if (token !== this.tokenVisor) return;
        this.textoVisor.set(texto.slice(0, 20_000));
        this.tipoVisor.set('texto');
        return;
      }

      this.tipoVisor.set('otro');
    } catch (fallo) {
      if (token !== this.tokenVisor) return;
      this.errorArchivo.set(aErrorApi(fallo, 'No se pudo abrir el archivo del documento.').message);
    } finally {
      if (token === this.tokenVisor) this.cargandoVisor.set(false);
    }
  }

  /**
   * Sube o reemplaza el binario. El servidor valida contra la lista blanca y
   * versiona el archivo anterior; aquí sólo se evita enviar más de 20 MB.
   */
  alSeleccionarArchivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0] ?? null;
    entrada.value = '';

    const documento = this.cabecera();
    if (!archivo || !documento) return;

    this.errorArchivo.set(null);
    this.avisoArchivo.set(null);

    if (archivo.size > MAX_DOCUMENTO_BYTES) {
      this.errorArchivo.set('El archivo supera el máximo de 20 MB.');
      return;
    }

    this.subiendoArchivo.set(true);
    this.archivoServicio.subir(documento.id, archivo).subscribe({
      next: () => {
        this.subiendoArchivo.set(false);
        this.avisoArchivo.set('Archivo actualizado. La versión anterior quedó en el historial.');
        this.detalleRecurso.recargar();
        this.cargarVersiones(documento.id);
        this.cargarExtracciones(documento.id);
        this.actualizado.emit();
        // Si el visor estaba abierto, se reabre con el binario nuevo.
        if (this.tipoVisor() !== null) {
          this.limpiarVisor();
          void this.verArchivo();
        }
      },
      error: (fallo: unknown) => {
        this.subiendoArchivo.set(false);
        this.errorArchivo.set(aErrorApi(fallo, 'No se pudo subir el archivo.').message);
      },
    });
  }

  async descargarActual(): Promise<void> {
    const documento = this.cabecera();
    if (!documento) return;
    this.errorArchivo.set(null);
    try {
      await this.archivoServicio.descargarActual(documento.id, this.nombreDescarga(documento));
    } catch (fallo) {
      this.errorArchivo.set(aErrorApi(fallo, 'No se pudo descargar el archivo.').message);
    }
  }

  async descargarVersion(version: VersionDocumento): Promise<void> {
    const documento = this.cabecera();
    if (!documento) return;
    this.errorDescargaVersion.set(null);
    try {
      await this.archivoServicio.descargarVersion(
        documento.id,
        version.numero,
        this.nombreDescarga(documento, version.numero),
      );
    } catch (fallo) {
      this.errorDescargaVersion.set(aErrorApi(fallo, 'No se pudo descargar la versión.').message);
    }
  }

  reintentarVersiones(): void {
    const documento = this.cabecera();
    if (documento) this.cargarVersiones(documento.id);
  }

  reintentarExtracciones(): void {
    const documento = this.cabecera();
    if (documento) this.cargarExtracciones(documento.id);
  }

  /** `POST /api/v1/documents/:id/extraccion` con `{ tipo }`. */
  ejecutarExtraccion(tipo: 'ocr' | 'temas'): void {
    const documento = this.cabecera();
    if (!documento || this.ejecutandoExtraccion() !== null) return;

    if (!this.puedeModificar()) {
      this.errorExtraccion.set('Su rol no permite ejecutar extracciones.');
      return;
    }

    this.ejecutandoExtraccion.set(tipo);
    this.errorExtraccion.set(null);
    this.avisoExtraccion.set(null);

    this.archivoServicio.extraer(documento.id, tipo).subscribe({
      next: (item) => {
        this.ejecutandoExtraccion.set(null);
        this.extracciones.update((lista) => [
          item,
          ...lista.filter((actual) => actual.tipo !== item.tipo),
        ]);
        this.avisoExtraccion.set(this.mensajeExtraccion(item));
      },
      error: (fallo: unknown) => {
        this.ejecutandoExtraccion.set(null);
        this.errorExtraccion.set(aErrorApi(fallo, 'No se pudo ejecutar la extracción.').message);
      },
    });
  }

  tamano(bytes: number | null): string {
    if (bytes === null) return 'sin declarar';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
      const kb = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(bytes / 1024);
      return `${kb} kB`;
    }
    const mb = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(
      bytes / (1024 * 1024),
    );
    return `${mb} MB`;
  }

  hashCorto(hash: string | null): string {
    if (!hash) return 'sin hash';
    return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
  }

  fechaHora(valor: string | null): string {
    return formatearFechaHora(valor);
  }

  etiquetaEstadoExtraccion(estado: EstadoExtraccion): string {
    switch (estado) {
      case 'listo':
        return 'Listo';
      case 'en_proceso':
        return 'En proceso';
      case 'pendiente':
        return 'Pendiente';
      case 'error':
        return 'Error';
      case 'no_disponible':
        return 'No disponible';
      default:
        return estado;
    }
  }

  claseExtraccion(estado: EstadoExtraccion): string {
    return `chip-${estado}`;
  }

  nombreDescarga(documento: Documento, numero?: number): string {
    const base =
      (documento.titulo || documento.codigo || 'documento')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'documento';
    return numero ? `${base} (v${numero})` : base;
  }

  private mensajeExtraccion(item: ExtraccionDocumento): string {
    if (item.estado === 'listo') {
      return item.tipo === 'ocr'
        ? `OCR completado con el motor «${item.modelo ?? 'externo'}».`
        : `Temas calculados por frecuencia local (${item.modelo ?? 'frecuencia-local'}).`;
    }
    if (item.estado === 'no_disponible') {
      return item.error ?? 'La extracción no está disponible.';
    }
    return item.error ?? 'La extracción no terminó correctamente.';
  }

  private cargarVersiones(id: string): void {
    if (!id) return;
    this.suscripcionVersiones?.unsubscribe();
    this.cargandoVersiones.set(true);
    this.errorVersiones.set(null);
    this.errorDescargaVersion.set(null);

    this.suscripcionVersiones = this.archivoServicio.listarVersiones(id).subscribe({
      next: (items) => {
        this.versiones.set(items);
        this.cargandoVersiones.set(false);
      },
      error: (fallo: unknown) => {
        this.versiones.set([]);
        this.errorVersiones.set(aErrorApi(fallo, 'No se pudieron cargar las versiones.').message);
        this.cargandoVersiones.set(false);
      },
    });
  }

  private cargarExtracciones(id: string): void {
    if (!id) return;
    this.suscripcionExtracciones?.unsubscribe();
    this.cargandoExtracciones.set(true);
    this.errorExtraccion.set(null);

    this.suscripcionExtracciones = this.archivoServicio.listarExtracciones(id).subscribe({
      next: (items) => {
        this.extracciones.set(items);
        this.cargandoExtracciones.set(false);
      },
      error: (fallo: unknown) => {
        this.extracciones.set([]);
        this.errorExtraccion.set(
          aErrorApi(fallo, 'No se pudo cargar el estado de las extracciones.').message,
        );
        this.cargandoExtracciones.set(false);
      },
    });
  }

  private enviar(id: string, cambios: PatchDocumento): void {
    if (!id) {
      this.errorGuardado.set('El documento no tiene identificador.');
      return;
    }

    this.guardando.set(true);
    this.errorGuardado.set(null);
    this.aviso.set(null);

    this.http.patch<unknown>(urlApi(`/v1/documents/${encodeURIComponent(id)}`), cambios).subscribe({
      next: () => {
        this.guardando.set(false);
        this.editando.set(false);
        this.borrador.set(null);
        this.aviso.set('Cambios guardados.');
        this.detalleRecurso.recargar();
        this.actualizado.emit();
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorGuardado.set(this.mensajeDeError(fallo));
      },
    });
  }

  private mensajeDeError(fallo: unknown): string {
    const error = aErrorApi(fallo);

    if (error.esProhibido) {
      return 'Su rol no permite modificar este documento (403). No se guardó ningún cambio.';
    }

    if (error.estado === 422) {
      return `El servidor rechazó los datos (422): ${error.message} Revise el título, la fecha (AAAA-MM-DD), el tipo y que el caso indicado exista.`;
    }

    if (error.estado === 404) {
      return 'El documento ya no existe; actualice el listado.';
    }

    if (error.esNoAutorizado) {
      return 'La sesión expiró. Vuelva a iniciar sesión.';
    }

    return error.message;
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
}
