import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import {
  campoMarcado,
  campoTexto,
  mensajeErrorAdmin,
  tamanoLegible,
  type ListaBlancaItem,
} from './administracion.modelos';
import { AdministracionService } from './administracion.service';

const MIME_RE = /^[a-z0-9][a-z0-9._+-]*\/[a-z0-9][a-z0-9._+-]*$/i;
const EXTENSION_RE = /^[a-z0-9]{1,16}$/i;

/**
 * Lista blanca de documentos.
 *
 * `core.documento_lista_blanca` define qué MIME se aceptan. El MIME es la clave
 * primaria: se edita el resto por PATCH con el MIME en el cuerpo porque contiene
 * «/» y no puede ser un segmento de ruta.
 *
 * El tamaño máximo no vive en esta tabla: es el límite absoluto del servidor
 * (20 MB, en `documents.ts`) y aquí sólo se publica para no inventarlo.
 */
@Component({
  selector: 'app-admin-lista-blanca-panel',
  imports: [IconoComponent],
  templateUrl: './lista-blanca-panel.component.html',
  styleUrl: './administracion.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListaBlancaPanelComponent {
  private readonly servicio = inject(AdministracionService);

  readonly cambio = output<void>();

  readonly items = signal<ListaBlancaItem[]>([]);
  readonly maximoBytes = signal(0);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly formAbierto = signal(false);
  readonly editandoMime = signal<string | null>(null);
  readonly fMime = signal('');
  readonly fExtension = signal('');
  readonly fActivo = signal(true);
  readonly fNota = signal('');
  readonly guardando = signal(false);
  readonly errorFormulario = signal<string | null>(null);

  readonly borrandoMime = signal<string | null>(null);
  readonly eliminando = signal(false);

  readonly limite = computed(() => tamanoLegible(this.maximoBytes()));

  /** Helpers expuestos a la plantilla. */
  readonly aTexto = campoTexto;
  readonly aMarcado = campoMarcado;

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const pagina = await this.servicio.listaBlanca();
      this.items.set(pagina.items);
      this.maximoBytes.set(pagina.maximoServidorBytes);
    } catch (fallo) {
      this.error.set(mensajeErrorAdmin(fallo, 'No se pudo cargar la lista blanca.'));
    } finally {
      this.cargando.set(false);
    }
  }

  abrirNuevo(): void {
    this.errorFormulario.set(null);
    this.editandoMime.set(null);
    this.fMime.set('');
    this.fExtension.set('');
    this.fActivo.set(true);
    this.fNota.set('');
    this.formAbierto.set(true);
  }

  editar(item: ListaBlancaItem): void {
    this.errorFormulario.set(null);
    this.borrandoMime.set(null);
    this.editandoMime.set(item.mime);
    this.fMime.set(item.mime);
    this.fExtension.set(item.extension ?? '');
    this.fActivo.set(item.activo);
    this.fNota.set(item.nota ?? '');
    this.formAbierto.set(true);
  }

  cerrarFormulario(): void {
    if (this.guardando()) return;
    this.formAbierto.set(false);
    this.editandoMime.set(null);
    this.errorFormulario.set(null);
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;

    const mime = this.fMime().trim().toLowerCase();
    const extension = this.fExtension().trim().replace(/^\./, '').toLowerCase();

    if (!MIME_RE.test(mime) || mime.length > 120) {
      this.errorFormulario.set(
        'El MIME debe tener la forma «tipo/subtipo», por ejemplo application/pdf.',
      );
      return;
    }
    if (extension && !EXTENSION_RE.test(extension)) {
      this.errorFormulario.set('La extensión admite hasta 16 caracteres alfanuméricos, sin punto.');
      return;
    }

    this.guardando.set(true);
    this.errorFormulario.set(null);
    try {
      const editando = this.editandoMime();
      if (editando !== null) {
        await this.servicio.actualizarListaBlanca(editando, {
          extension: extension || null,
          activo: this.fActivo(),
          nota: this.fNota().trim() || null,
        });
        this.aviso.set(`Tipo de archivo actualizado: ${editando}.`);
      } else {
        await this.servicio.crearListaBlanca({
          mime,
          extension: extension || null,
          activo: this.fActivo(),
          nota: this.fNota().trim() || null,
        });
        this.aviso.set(`Tipo de archivo agregado: ${mime}.`);
      }
      this.formAbierto.set(false);
      this.editandoMime.set(null);
      await this.cargar();
      this.cambio.emit();
    } catch (fallo) {
      this.errorFormulario.set(mensajeErrorAdmin(fallo, 'No se pudo guardar el tipo de archivo.'));
    } finally {
      this.guardando.set(false);
    }
  }

  async alternarActivo(item: ListaBlancaItem): Promise<void> {
    if (this.guardando()) return;

    this.guardando.set(true);
    this.error.set(null);
    try {
      await this.servicio.actualizarListaBlanca(item.mime, {
        extension: item.extension,
        activo: !item.activo,
        nota: item.nota,
      });
      this.aviso.set(
        item.activo
          ? `Tipo de archivo desactivado: ${item.mime}.`
          : `Tipo de archivo activado: ${item.mime}.`,
      );
      await this.cargar();
      this.cambio.emit();
    } catch (fallo) {
      this.error.set(mensajeErrorAdmin(fallo, 'No se pudo cambiar el estado del tipo de archivo.'));
    } finally {
      this.guardando.set(false);
    }
  }

  pedirEliminar(item: ListaBlancaItem): void {
    if (item.uso > 0) return;
    if (this.borrandoMime() !== item.mime) {
      this.borrandoMime.set(item.mime);
      return;
    }
    void this.eliminar(item);
  }

  async eliminar(item: ListaBlancaItem): Promise<void> {
    if (this.eliminando()) return;

    this.eliminando.set(true);
    this.error.set(null);
    try {
      await this.servicio.eliminarListaBlanca(item.mime);
      this.borrandoMime.set(null);
      this.aviso.set(`Tipo de archivo eliminado: ${item.mime}.`);
      await this.cargar();
      this.cambio.emit();
    } catch (fallo) {
      this.error.set(mensajeErrorAdmin(fallo, 'No se pudo eliminar el tipo de archivo.'));
    } finally {
      this.eliminando.set(false);
    }
  }
}
