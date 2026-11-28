import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';

import { urlApi } from '../../core/config/entorno';
import { hoyIso } from '../../core/fecha/zona-horaria';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { IconoComponent } from '../../shared/ui/icono.component';

import {
  aRespuestaAnexos,
  descargarBlob,
  esFormatoAnexo,
  extensionDe,
  pedirAnexo,
  type AnexoDisponible,
  type FormatoAnexo,
  type RespuestaAnexos,
} from './exportaciones.descargas';

type VistaPrevia = {
  numero: string;
  nombre: string;
  url: string;
  seguro: SafeResourceUrl;
};

const FORMATOS: readonly FormatoAnexo[] = ['html', 'pdf', 'xlsx', 'json'];

/**
 * Galería de exportaciones: vistas previas imprimibles y descargas de anexos.
 *
 * Lista los anexos que el servidor puede generar para este usuario (con su
 * disponibilidad y los campos que faltan), deja elegir formato y rango de fechas
 * y previsualiza el HTML en un `iframe`. La sesión es una cookie `HttpOnly`, así
 * que todo pasa por `fetch` + `Blob`; nunca se enlaza la API directamente.
 *
 * Regla de producto: un anexo sin datos no se muestra como completo. Si el
 * servidor responde 422, se muestra el `detail` con los faltantes.
 *
 * No se cablea en `app.routes.ts` (lo hace el orquestador).
 */
@Component({
  selector: 'app-exportaciones-page',
  imports: [IconoComponent],
  templateUrl: './exportaciones.page.html',
  styleUrl: './exportaciones.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cerrarPrevisualizacion()',
  },
})
export class ExportacionesPage {
  private readonly sanitizador = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  private readonly catalogo = consulta<RespuestaAnexos>({
    fuente: () => urlApi('/v1/export/anexos'),
    esquema: aRespuestaAnexos,
  });

  readonly formatos = FORMATOS;

  readonly anexos = computed(() => this.catalogo.valor()?.anexos ?? []);
  readonly cargando = computed(
    () => this.catalogo.estado() === 'inactivo' || this.catalogo.estado() === 'cargando',
  );
  readonly errorCarga = computed(() => this.catalogo.error()?.message ?? null);

  readonly formato = signal<FormatoAnexo>('html');
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly codigo = signal('');
  readonly estadoHito = signal('');

  readonly seleccionado = signal<AnexoDisponible | null>(null);
  readonly ocupado = signal<string | null>(null);
  readonly errorAccion = signal<string | null>(null);
  readonly previsualizacion = signal<VistaPrevia | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => this.liberarVista());
  }

  recargar(): void {
    this.catalogo.recargar();
  }

  cambiarFormato(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    if (esFormatoAnexo(valor)) this.formato.set(valor);
  }

  /** Rótulo legible del selector de formato. */
  etiquetaFormato(formato: FormatoAnexo): string {
    switch (formato) {
      case 'xlsx':
        return 'Excel (XLSX)';
      case 'html':
        return 'HTML (imprimible)';
      case 'pdf':
        return 'PDF';
      case 'json':
        return 'JSON';
      default:
        return 'Texto';
    }
  }

  actualizarDesde(evento: Event): void {
    this.desde.set((evento.target as HTMLInputElement).value);
  }

  actualizarHasta(evento: Event): void {
    this.hasta.set((evento.target as HTMLInputElement).value);
  }

  actualizarCodigo(evento: Event): void {
    this.codigo.set((evento.target as HTMLInputElement).value);
  }

  actualizarEstado(evento: Event): void {
    this.estadoHito.set((evento.target as HTMLSelectElement).value);
  }

  seleccionar(anexo: AnexoDisponible): void {
    this.seleccionado.set(anexo);
    this.errorAccion.set(null);
  }

  /** El formato elegido está admitido por ese anexo. */
  soportaFormato(anexo: AnexoDisponible): boolean {
    return anexo.formatos.includes(this.formato());
  }

  /** Sólo el HTML se puede previsualizar en el `iframe`. */
  puedePrevisualizar(anexo: AnexoDisponible): boolean {
    return anexo.disponible && anexo.formatos.includes('html');
  }

  async previsualizar(anexo: AnexoDisponible): Promise<void> {
    if (!this.puedePrevisualizar(anexo)) return;

    this.ocupado.set(anexo.numero);
    this.errorAccion.set(null);
    this.seleccionado.set(anexo);

    try {
      const { blob, nombre } = await pedirAnexo(
        this.urlDe(anexo, 'html'),
        'html',
        this.nombreSugerido(anexo, 'html'),
      );
      const url = URL.createObjectURL(blob);
      this.liberarVista();
      this.previsualizacion.set({
        numero: anexo.numero,
        nombre,
        url,
        seguro: this.sanitizador.bypassSecurityTrustResourceUrl(url),
      });
    } catch (error) {
      this.errorAccion.set(aErrorApi(error, 'No se pudo generar la vista previa.').message);
    } finally {
      this.ocupado.set(null);
    }
  }

  abrirEnPestana(): void {
    const vista = this.previsualizacion();
    if (vista) window.open(vista.url, '_blank', 'noopener');
  }

  async descargar(anexo: AnexoDisponible): Promise<void> {
    if (!anexo.disponible) return;

    const formato = this.formato();
    if (!anexo.formatos.includes(formato)) {
      this.errorAccion.set(
        `El ${anexo.referencia} no admite el formato «${formato}». Use: ${anexo.formatos.join(', ')}.`,
      );
      return;
    }

    this.ocupado.set(anexo.numero);
    this.errorAccion.set(null);
    this.seleccionado.set(anexo);

    try {
      const { blob, nombre } = await pedirAnexo(
        this.urlDe(anexo, formato),
        formato,
        this.nombreSugerido(anexo, formato),
      );
      descargarBlob(blob, nombre);
    } catch (error) {
      this.errorAccion.set(aErrorApi(error, 'No se pudo descargar el anexo.').message);
    } finally {
      this.ocupado.set(null);
    }
  }

  cerrarPrevisualizacion(): void {
    this.liberarVista();
  }

  /** URL del endpoint con el formato, el rango de fechas y el código vigentes. */
  private urlDe(anexo: AnexoDisponible, formato: FormatoAnexo): string {
    const parametros = new URLSearchParams({ formato });

    const desde = this.desde().trim();
    const hasta = this.hasta().trim();
    const codigo = this.codigo().trim();
    const estado = this.estadoHito().trim();

    if (desde) parametros.set('desde', desde);
    if (hasta) parametros.set('hasta', hasta);

    if (anexo.numero === '14') {
      if (codigo) parametros.set('caso', codigo);
      if (estado) parametros.set('estado', estado);
    } else if (anexo.numero === '15') {
      if (codigo) parametros.set('q', codigo);
    } else if (codigo) {
      parametros.set('codigo', codigo);
    }

    return `${urlApi(anexo.ruta)}?${parametros.toString()}`;
  }

  private nombreSugerido(anexo: AnexoDisponible, formato: FormatoAnexo): string {
    const fecha = hoyIso();
    return `avisa_anexo_${anexo.numero}_${fecha}.${extensionDe(formato)}`;
  }

  private liberarVista(): void {
    const vista = this.previsualizacion();
    if (vista) {
      URL.revokeObjectURL(vista.url);
      this.previsualizacion.set(null);
    }
  }
}
