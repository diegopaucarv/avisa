import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';

import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  campoMarcado,
  campoTexto,
  etiquetaRol,
  fechaDdMmAaaa,
  mensajeErrorAdmin,
  type RolDisponible,
  type UsuarioAdmin,
} from './administracion.modelos';
import { AdministracionService } from './administracion.service';

const TAMANO_INICIAL = 25;

/**
 * Usuarios y roles.
 *
 * El listado sale de `core.usuarios` con sus roles vigentes y el último acceso
 * correcto. El alta existe porque la API hashea la clave con
 * `public.crypt`/`gen_salt`: la clave nunca se devuelve ni se muestra.
 *
 * Las acciones se confirman en línea (dos clics), no con `window.confirm`.
 */
@Component({
  selector: 'app-admin-usuarios-panel',
  imports: [IconoComponent, PaginacionComponent],
  templateUrl: './usuarios-panel.component.html',
  styleUrl: './administracion.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuariosPanelComponent {
  private readonly servicio = inject(AdministracionService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cambio = output<void>();

  readonly q = signal('');
  readonly pagina = signal(1);
  readonly tamano = signal(TAMANO_INICIAL);

  readonly usuarios = signal<UsuarioAdmin[]>([]);
  readonly total = signal(0);
  readonly rolesDisponibles = signal<RolDisponible[]>([]);

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly formAbierto = signal(false);
  readonly fNombre = signal('');
  readonly fDni = signal('');
  readonly fEmail = signal('');
  readonly fCargo = signal('');
  readonly fRol = signal('');
  readonly fClave = signal('');
  readonly fClave2 = signal('');
  readonly guardando = signal(false);
  readonly errorFormulario = signal<string | null>(null);

  readonly rolEditandoId = signal<string | null>(null);
  readonly rolElegido = signal('');
  readonly guardandoRol = signal(false);

  readonly estadoPendienteId = signal<string | null>(null);
  readonly guardandoEstado = signal(false);

  /** Helpers expuestos a la plantilla. */
  readonly etiquetaRol = etiquetaRol;
  readonly fecha = fechaDdMmAaaa;
  readonly aTexto = campoTexto;
  readonly aMarcado = campoMarcado;

  private turno = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.temporizador !== null) clearTimeout(this.temporizador);
    });
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const turno = ++this.turno;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const pagina = await this.servicio.usuarios(this.q(), this.pagina(), this.tamano());
      if (turno !== this.turno) return;
      this.usuarios.set(pagina.usuarios.elementos);
      this.total.set(pagina.usuarios.total);
      if (pagina.rolesDisponibles.length > 0) {
        this.rolesDisponibles.set(pagina.rolesDisponibles);
      }
    } catch (fallo) {
      if (turno !== this.turno) return;
      this.error.set(
        mensajeErrorAdmin(fallo, 'No se pudo cargar la lista de usuarios.'),
      );
    } finally {
      if (turno === this.turno) this.cargando.set(false);
    }
  }

  buscar(evento: Event): void {
    this.q.set(campoTexto(evento));
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.pagina.set(1);
      void this.cargar();
    }, 300);
  }

  cambiarPagina(pagina: number): void {
    this.pagina.set(pagina);
    void this.cargar();
  }

  cambiarTamano(tamano: number): void {
    this.tamano.set(tamano);
    this.pagina.set(1);
    void this.cargar();
  }

  abrirFormulario(): void {
    this.errorFormulario.set(null);
    this.fNombre.set('');
    this.fDni.set('');
    this.fEmail.set('');
    this.fCargo.set('');
    this.fRol.set(this.rolPorDefecto());
    this.fClave.set('');
    this.fClave2.set('');
    this.formAbierto.set(true);
  }

  cerrarFormulario(): void {
    if (this.guardando()) return;
    this.formAbierto.set(false);
    this.errorFormulario.set(null);
    this.limpiarCampos();
  }

  async guardarUsuario(): Promise<void> {
    if (this.guardando()) return;

    const nombre = this.fNombre().trim();
    const dni = this.fDni().trim();
    const clave = this.fClave();

    if (nombre.length < 3) {
      this.errorFormulario.set('El nombre debe tener al menos 3 caracteres.');
      return;
    }
    if (!/^\d{8,12}$/.test(dni)) {
      this.errorFormulario.set('El DNI debe tener entre 8 y 12 dígitos.');
      return;
    }
    if (clave.length < 8 || clave.length > 128) {
      this.errorFormulario.set('La clave debe tener entre 8 y 128 caracteres.');
      return;
    }
    if (clave !== this.fClave2()) {
      this.errorFormulario.set('Las dos claves no coinciden.');
      return;
    }
    if (!this.fRol()) {
      this.errorFormulario.set('Seleccione un rol.');
      return;
    }

    this.guardando.set(true);
    this.errorFormulario.set(null);
    try {
      await this.servicio.crearUsuario({
        nombre,
        dni,
        email: this.fEmail().trim() || null,
        cargo: this.fCargo().trim() || null,
        clave,
        rolCodigo: this.fRol(),
      });
      this.formAbierto.set(false);
      this.limpiarCampos();
      this.aviso.set(`Cuenta creada: ${nombre}.`);
      this.pagina.set(1);
      await this.cargar();
      this.cambio.emit();
    } catch (fallo) {
      this.errorFormulario.set(
        mensajeErrorAdmin(fallo, 'No se pudo crear la cuenta.'),
      );
    } finally {
      this.guardando.set(false);
    }
  }

  editarRol(usuario: UsuarioAdmin): void {
    this.estadoPendienteId.set(null);
    this.error.set(null);
    this.rolEditandoId.set(usuario.id);
    this.rolElegido.set(usuario.rolPrincipal ?? usuario.roles[0] ?? '');
  }

  cancelarRol(): void {
    this.rolEditandoId.set(null);
    this.rolElegido.set('');
  }

  async guardarRol(usuario: UsuarioAdmin): Promise<void> {
    const rol = this.rolElegido();
    if (!rol || this.guardandoRol()) return;

    this.guardandoRol.set(true);
    this.error.set(null);
    try {
      await this.servicio.cambiarRol(usuario.id, rol);
      this.rolEditandoId.set(null);
      this.aviso.set(`Rol de ${usuario.nombre} actualizado a ${etiquetaRol(rol)}.`);
      await this.cargar();
      this.cambio.emit();
    } catch (fallo) {
      this.error.set(mensajeErrorAdmin(fallo, 'No se pudo cambiar el rol.'));
    } finally {
      this.guardandoRol.set(false);
    }
  }

  /**
   * Activar es inmediato; desactivar pide un segundo clic porque deja la
   * cuenta sin acceso. La auto-desactivación la rechaza la API con 422.
   */
  alternarEstado(usuario: UsuarioAdmin): void {
    this.rolEditandoId.set(null);
    if (usuario.activo && this.estadoPendienteId() !== usuario.id) {
      this.estadoPendienteId.set(usuario.id);
      return;
    }
    void this.aplicarEstado(usuario, !usuario.activo);
  }

  cancelarEstado(): void {
    this.estadoPendienteId.set(null);
  }

  async aplicarEstado(usuario: UsuarioAdmin, activo: boolean): Promise<void> {
    if (this.guardandoEstado()) return;

    this.guardandoEstado.set(true);
    this.error.set(null);
    try {
      await this.servicio.cambiarEstado(usuario.id, activo);
      this.estadoPendienteId.set(null);
      this.aviso.set(
        activo
          ? `Cuenta activada: ${usuario.nombre}.`
          : `Cuenta desactivada: ${usuario.nombre}.`,
      );
      await this.cargar();
      this.cambio.emit();
    } catch (fallo) {
      this.error.set(mensajeErrorAdmin(fallo, 'No se pudo cambiar el estado.'));
    } finally {
      this.guardandoEstado.set(false);
    }
  }

  private rolPorDefecto(): string {
    const codigos = this.rolesDisponibles().map((rol) => rol.codigo);
    if (codigos.includes('sectorista')) return 'sectorista';
    return codigos[0] ?? '';
  }

  private limpiarCampos(): void {
    this.fNombre.set('');
    this.fDni.set('');
    this.fEmail.set('');
    this.fCargo.set('');
    this.fRol.set('');
    this.fClave.set('');
    this.fClave2.set('');
  }
}
