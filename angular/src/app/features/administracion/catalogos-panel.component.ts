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
  capacidadesTexto,
  mensajeErrorAdmin,
  type CatalogoAdmin,
  type ValorCatalogo,
} from './administracion.modelos';
import { AdministracionService } from './administracion.service';

/**
 * Catálogos del sistema.
 *
 * `niveles_conflicto` es de sólo lectura porque su tabla rechaza la escritura
 * directa (procedimiento normativo). El resto se edita campo a campo y el
 * borrado se bloquea cuando el valor tiene uso o el catálogo está protegido.
 */
@Component({
  selector: 'app-admin-catalogos-panel',
  imports: [IconoComponent],
  templateUrl: './catalogos-panel.component.html',
  styleUrl: './administracion.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogosPanelComponent {
  private readonly servicio = inject(AdministracionService);

  readonly cambio = output<void>();

  readonly catalogos = signal<CatalogoAdmin[]>([]);
  readonly codigo = signal('niveles_conflicto');

  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly aviso = signal<string | null>(null);

  readonly editandoId = signal<number | null>(null);
  readonly draft = signal<Record<string, unknown>>({});
  readonly guardando = signal(false);

  readonly borrandoId = signal<number | null>(null);
  readonly eliminando = signal(false);

  readonly catalogoActual = computed<CatalogoAdmin | null>(
    () => this.catalogos().find((catalogo) => catalogo.codigo === this.codigo()) ?? null,
  );

  readonly catalogoEditable = computed(
    () => this.catalogoActual()?.editable ?? false,
  );

  readonly valorEditado = computed<ValorCatalogo | null>(() => {
    const id = this.editandoId();
    if (id === null) return null;
    return this.catalogoActual()?.valores.find((valor) => valor.id === id) ?? null;
  });

  readonly muestraOrden = computed(() => {
    const codigo = this.catalogoActual()?.codigo;
    return codigo === 'niveles_conflicto' || codigo === 'niveles_riesgo';
  });

  readonly muestraActivo = computed(
    () => this.catalogoActual()?.codigo === 'estados_caso',
  );

  readonly esRoles = computed(() => this.catalogoActual()?.codigo === 'roles');

  /** Helpers expuestos a la plantilla. */
  readonly capacidadesTexto = capacidadesTexto;
  readonly aTexto = campoTexto;
  readonly aMarcado = campoMarcado;

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const catalogos = await this.servicio.catalogos();
      this.catalogos.set(catalogos);
      if (
        catalogos.length > 0 &&
        !catalogos.some((catalogo) => catalogo.codigo === this.codigo())
      ) {
        this.codigo.set(catalogos[0].codigo);
      }
    } catch (fallo) {
      this.error.set(
        mensajeErrorAdmin(fallo, 'No se pudieron cargar los catálogos.'),
      );
    } finally {
      this.cargando.set(false);
    }
  }

  cambiarCatalogo(evento: Event): void {
    this.codigo.set(campoTexto(evento));
    this.editandoId.set(null);
    this.borrandoId.set(null);
    this.error.set(null);
    this.aviso.set(null);
  }

  /** `orden` sólo existe en niveles; el resto muestra la celda como «—». */
  aNumero(evento: Event): number {
    const valor = Number(campoTexto(evento));
    return Number.isFinite(valor) ? valor : 0;
  }

  editar(valor: ValorCatalogo): void {
    const catalogo = this.catalogoActual();
    if (!catalogo || !catalogo.editable) return;

    this.borrandoId.set(null);
    this.error.set(null);
    const borrador: Record<string, unknown> = {};
    if (catalogo.campos.includes('etiqueta')) borrador['etiqueta'] = valor.etiqueta;
    if (catalogo.campos.includes('orden')) borrador['orden'] = valor.orden ?? 0;
    if (catalogo.campos.includes('activo')) borrador['activo'] = valor.activo ?? true;
    if (catalogo.campos.includes('maxClasificacion')) {
      borrador['maxClasificacion'] = valor.maxClasificacion ?? 1;
    }
    if (catalogo.campos.includes('puedeCrear')) {
      borrador['puedeCrear'] = valor.puedeCrear ?? false;
    }
    if (catalogo.campos.includes('puedeEditar')) {
      borrador['puedeEditar'] = valor.puedeEditar ?? false;
    }
    if (catalogo.campos.includes('puedeEliminar')) {
      borrador['puedeEliminar'] = valor.puedeEliminar ?? false;
    }
    this.draft.set(borrador);
    this.editandoId.set(valor.id);
  }

  cancelarEdicion(): void {
    this.editandoId.set(null);
    this.draft.set({});
  }

  fijar(campo: string, valor: unknown): void {
    this.draft.update((actual) => ({ ...actual, [campo]: valor }));
  }

  draftTexto(campo: string): string {
    const valor = this.draft()[campo];
    return typeof valor === 'number'
      ? String(valor)
      : typeof valor === 'string'
        ? valor
        : '';
  }

  draftNumero(campo: string): number {
    const valor = this.draft()[campo];
    return typeof valor === 'number' ? valor : Number(valor) || 0;
  }

  draftBooleano(campo: string): boolean {
    return this.draft()[campo] === true;
  }

  async guardar(): Promise<void> {
    const catalogo = this.catalogoActual();
    const id = this.editandoId();
    if (!catalogo || id === null || this.guardando()) return;

    const cambios: Record<string, unknown> = {};
    for (const campo of catalogo.campos) {
      const valor = this.draft()[campo];
      if (campo === 'etiqueta') {
        const texto = String(valor ?? '').trim();
        if (texto.length < 2) {
          this.error.set('El nombre debe tener al menos 2 caracteres.');
          return;
        }
        cambios['etiqueta'] = texto;
      } else if (campo === 'orden') {
        const numero = Number(valor);
        if (!Number.isInteger(numero) || numero < 0) {
          this.error.set('El orden debe ser un entero no negativo.');
          return;
        }
        cambios['orden'] = numero;
      } else if (campo === 'maxClasificacion') {
        const numero = Number(valor);
        if (!Number.isInteger(numero) || numero < 1 || numero > 3) {
          this.error.set('La clasificación máxima va de 1 a 3.');
          return;
        }
        cambios['maxClasificacion'] = numero;
      } else {
        cambios[campo] = valor === true;
      }
    }

    if (
      catalogo.codigo === 'roles' &&
      cambios['puedeEliminar'] === true &&
      cambios['puedeEditar'] !== true
    ) {
      this.error.set('Un rol no puede eliminar sin poder editar.');
      return;
    }

    this.guardando.set(true);
    this.error.set(null);
    try {
      const actualizado = await this.servicio.actualizarCatalogo(
        catalogo.codigo,
        id,
        cambios,
      );
      this.catalogos.update((lista) =>
        lista.map((item) =>
          item.codigo === actualizado.codigo ? actualizado : item,
        ),
      );
      this.editandoId.set(null);
      this.draft.set({});
      this.aviso.set('Valor del catálogo actualizado.');
      this.cambio.emit();
    } catch (fallo) {
      this.error.set(
        mensajeErrorAdmin(fallo, 'No se pudo actualizar el valor.'),
      );
    } finally {
      this.guardando.set(false);
    }
  }

  posibleEliminar(valor: ValorCatalogo): boolean {
    const catalogo = this.catalogoActual();
    if (!catalogo) return false;
    return catalogo.permiteEliminar && catalogo.editable && valor.uso === 0;
  }

  motivoNoEliminar(valor: ValorCatalogo): string {
    const catalogo = this.catalogoActual();
    if (!catalogo) return '';
    if (!catalogo.editable) return 'Sólo lectura';
    if (!catalogo.permiteEliminar) {
      return 'Este catálogo no permite eliminar valores';
    }
    if (valor.uso > 0) {
      return `En uso por ${valor.uso} ${valor.uso === 1 ? 'registro' : 'registros'}`;
    }
    return '';
  }

  pedirEliminar(valor: ValorCatalogo): void {
    if (!this.posibleEliminar(valor)) return;
    if (this.borrandoId() !== valor.id) {
      this.borrandoId.set(valor.id);
      return;
    }
    void this.eliminar(valor);
  }

  async eliminar(valor: ValorCatalogo): Promise<void> {
    const catalogo = this.catalogoActual();
    if (!catalogo || this.eliminando()) return;

    this.eliminando.set(true);
    this.error.set(null);
    try {
      const actualizado = await this.servicio.eliminarCatalogo(
        catalogo.codigo,
        valor.id,
      );
      this.catalogos.update((lista) =>
        lista.map((item) =>
          item.codigo === actualizado.codigo ? actualizado : item,
        ),
      );
      this.borrandoId.set(null);
      this.editandoId.set(null);
      this.aviso.set(`Valor eliminado: ${valor.etiqueta}.`);
      this.cambio.emit();
    } catch (fallo) {
      this.error.set(mensajeErrorAdmin(fallo, 'No se pudo eliminar el valor.'));
    } finally {
      this.eliminando.set(false);
    }
  }
}
