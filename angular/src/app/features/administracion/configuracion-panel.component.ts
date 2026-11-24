import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import {
  campoTexto,
  fechaHoraDdMmAaaa,
  mensajeErrorAdmin,
  valorJson,
  type ConfiguracionItem,
} from './administracion.modelos';
import { AdministracionService } from './administracion.service';

const CLAVE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

/**
 * Parámetros del sistema (`core.configuracion`).
 *
 * El valor es `jsonb`: viaja como texto JSON y la API lo valida antes de
 * guardarlo. La auditoría registra la clave y la descripción, nunca el valor,
 * porque un parámetro puede contener un secreto.
 */
@Component({
  selector: 'app-admin-configuracion-panel',
  imports: [IconoComponent],
  templateUrl: './configuracion-panel.component.html',
  styleUrl: './administracion.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracionPanelComponent {
  private readonly servicio = inject(AdministracionService);

  readonly cambio = output<void>();

  readonly items = signal<ConfiguracionItem[]>([]);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly formAbierto = signal(false);
  readonly editandoClave = signal<string | null>(null);
  readonly fClave = signal('');
  readonly fValor = signal('null');
  readonly fDescripcion = signal('');
  readonly guardando = signal(false);
  readonly errorFormulario = signal<string | null>(null);

  /** Helpers expuestos a la plantilla. */
  readonly aTexto = campoTexto;
  readonly valor = valorJson;
  readonly fechaHora = fechaHoraDdMmAaaa;

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.servicio.configuracion());
    } catch (fallo) {
      this.error.set(
        mensajeErrorAdmin(fallo, 'No se pudo cargar la configuración.'),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  abrirNuevo(): void {
    this.errorFormulario.set(null);
    this.editandoClave.set(null);
    this.fClave.set('');
    this.fValor.set('null');
    this.fDescripcion.set('');
    this.formAbierto.set(true);
  }

  editar(item: ConfiguracionItem): void {
    this.errorFormulario.set(null);
    this.editandoClave.set(item.clave);
    this.fClave.set(item.clave);
    this.fValor.set(JSON.stringify(item.valor ?? null, null, 2));
    this.fDescripcion.set(item.descripcion ?? '');
    this.formAbierto.set(true);
  }

  cerrarFormulario(): void {
    if (this.guardando()) return;
    this.formAbierto.set(false);
    this.editandoClave.set(null);
    this.errorFormulario.set(null);
  }

  async guardar(): Promise<void> {
    if (this.guardando()) return;

    const clave = this.fClave().trim();
    if (!CLAVE_RE.test(clave)) {
      this.errorFormulario.set(
        'La clave admite hasta 80 caracteres y empieza por letra o número.',
      );
      return;
    }

    const valor = this.fValor();
    try {
      JSON.parse(valor);
    } catch {
      this.errorFormulario.set(
        'El valor debe ser JSON válido. Para texto, use comillas: "texto".',
      );
      return;
    }

    this.guardando.set(true);
    this.errorFormulario.set(null);
    try {
      await this.servicio.guardarConfiguracion(
        clave,
        valor,
        this.fDescripcion().trim() || null,
      );
      this.aviso.set(`Parámetro guardado: ${clave}.`);
      this.formAbierto.set(false);
      this.editandoClave.set(null);
      await this.cargar();
      this.cambio.emit();
    } catch (fallo) {
      this.errorFormulario.set(
        mensajeErrorAdmin(fallo, 'No se pudo guardar el parámetro.'),
      );
    } finally {
      this.guardando.set(false);
    }
  }
}
