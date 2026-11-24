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
import {
  aDetalleDocumento,
  claseEstado,
  etapaFlujo,
  etiquetaAnexo,
  formatearFecha,
  nombreArchivo,
  type AltaDocumento,
  type DetalleDocumento,
  type Documento,
  type OpcionCatalogo,
  type PatchDocumento,
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
  imports: [IconoComponent],
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

    .drawer-head h2 {
      margin: 0;
      color: #1c2a38;
      font: 700 16px/1.35 var(--font-display);
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
      font-size: 9px;
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
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .panel-datos dd {
      margin: 0;
      color: #465a6c;
      font-size: 10.5px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .panel-texto {
      margin: 8px 0 0;
      color: #52677a;
      font-size: 11px;
      line-height: 1.65;
      white-space: pre-line;
    }

    .panel-vacio {
      margin: 8px 0 0;
      color: #a0aab3;
      font-size: 10.5px;
      font-style: italic;
    }

    .panel-nota {
      margin: 0;
      color: #8d99a6;
      font-size: 10px;
      line-height: 1.5;
    }

    .panel-aviso {
      margin: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #edf6f0;
      color: #52806a;
      font-size: 10.5px;
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
      font-size: 10.5px;
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
      font-size: 10.5px;
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
      font-size: 10.5px;
    }

    .panel-fuentes small {
      color: #97a1aa;
      font-size: 9px;
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
      font-size: 10px;
      font-weight: 700;
    }

    .panel-caso-titulo {
      color: var(--muted);
      font-size: 9.5px;
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
        this.cerrado.emit();
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
    if (evento.target === evento.currentTarget) this.cerrado.emit();
  }

  alTecla(evento: KeyboardEvent): void {
    if (evento.key === 'Tab') this.atraparFoco(evento);
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
