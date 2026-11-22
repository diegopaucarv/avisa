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
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  ESTADOS_DOCUMENTO,
  aDetalleDocumento,
  claseEstado,
  etiquetaAnexo,
  formatearConfianza,
  formatearFecha,
  nombreArchivo,
  type DetalleDocumento,
  type Documento,
  type OpcionCatalogo,
  type PatchDocumento,
} from './documento.mapeo';

type BorradorDocumento = {
  titulo: string;
  tipo: string;
  fecha: string;
  estado: string;
  resumen: string;
  archivo: string;
  casoCode: string;
};

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
  `,
})
export class DocumentoPanelComponent {
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);
  private readonly destruccion = inject(DestroyRef);

  readonly documento = input.required<Documento>();
  /** Tipos de `GET /api/v1/catalogs`, para el formulario y su «Anexo N° X». */
  readonly tipos = input<readonly OpcionCatalogo[]>([]);

  readonly cerrado = output<void>();
  readonly actualizado = output<void>();
  readonly anular = output<void>();

  private readonly detalleRecurso = consulta<DetalleDocumento>({
    fuente: () => {
      const id = this.documento().id;
      return id ? urlApi(`/v1/documents/${encodeURIComponent(id)}`) : null;
    },
    esquema: aDetalleDocumento,
  });

  /** El detalle sólo se usa si corresponde al documento abierto. */
  private readonly detalle = computed<DetalleDocumento | null>(() => {
    const valor = this.detalleRecurso.valor();
    if (!valor) return null;
    return valor.documento.id === this.documento().id ? valor : null;
  });

  readonly cabecera = computed<Documento>(() => this.detalle()?.documento ?? this.documento());
  readonly fuentes = computed(() => this.detalle()?.fuentes ?? []);
  readonly errorDetalle = this.detalleRecurso.error;
  readonly cargandoDetalle = computed(
    () => this.detalleRecurso.estado() === 'cargando' && this.detalle() === null,
  );

  readonly puedeModificar = computed(() =>
    this.capacidades.puedeModificar(this.cabecera().clasificacion),
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

  /**
   * El estado de la ficha se edita en vocabulario de UI (`estadoUi`). Si el
   * registro guarda un texto heredado se añade como opción en vez de perderlo.
   */
  readonly estadoInicial = computed(() => this.cabecera().estadoUi);

  readonly opcionesEstado = computed<readonly string[]>(() => {
    const actual = this.estadoInicial();
    const conocidos: readonly string[] = ESTADOS_DOCUMENTO;
    if (!actual || conocidos.includes(actual)) return conocidos;
    return [...conocidos, actual];
  });

  readonly opcionesTipo = computed<readonly OpcionCatalogo[]>(() => {
    const base = this.tipos();
    const actual = this.cabecera().tipo;
    if (!actual || base.some((opcion) => opcion.valor === actual)) return base;

    return [
      {
        valor: actual,
        etiqueta: this.cabecera().tipoNombre ?? actual,
        anexoNumero: this.cabecera().anexoNumero,
      },
      ...base,
    ];
  });

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
        this.focoPrevio?.focus?.();
      });
    }

    // Al cambiar de documento abierto, el borrador anterior no se reutiliza.
    effect(() => {
      const id = this.documento().id;
      if (id === this.idAnterior) return;
      this.idAnterior = id;
      this.editando.set(false);
      this.borrador.set(null);
      this.errorGuardado.set(null);
      this.mensajeLocal.set(null);
      this.aviso.set(null);
    });
  }

  formatearFecha(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  formatearConfianza(valor: number | null): string {
    return formatearConfianza(valor);
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

  recargarDetalle(): void {
    this.detalleRecurso.recargar();
  }

  iniciarEdicion(): void {
    if (!this.puedeModificar()) return;

    const documento = this.cabecera();
    this.borrador.set({
      titulo: documento.titulo ?? '',
      tipo: documento.tipo ?? '',
      fecha: documento.fecha ?? '',
      estado: documento.estadoUi,
      resumen: documento.resumen ?? '',
      archivo: documento.archivo ?? '',
      casoCode: documento.casoCode ?? '',
    });
    this.mensajeLocal.set(null);
    this.errorGuardado.set(null);
    this.aviso.set(null);
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
    if (!borrador) return;

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

    if (borrador.estado !== this.estadoInicial()) {
      cambios.estado = borrador.estado.trim() || null;
    }

    if (Object.keys(cambios).length === 0) {
      this.mensajeLocal.set('No hay cambios que guardar.');
      return;
    }

    this.mensajeLocal.set(null);
    this.enviar(documento.id, cambios);
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
