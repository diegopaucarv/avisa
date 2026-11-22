import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aDetalleCaso, DetalleCaso, EventoCaso } from '../../dominio/mapeo';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import {
  CuerpoEvento,
  EventoPanelComponent,
  OpcionTipoHecho,
  aTiposHecho,
} from './evento-panel.component';

@Component({
  selector: 'app-caso-detalle',
  imports: [RouterLink, IconoComponent, ExportarMenuComponent, EventoPanelComponent],
  templateUrl: './caso-detalle.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .timeline-edit {
      min-height: 26px;
      margin-top: 4px;
      padding: 0 10px;
      font-size: 10px;
    }
  `,
})
export class CasoDetallePage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);

  readonly codigo = toSignal(this.ruta.paramMap.pipe(map((params) => params.get('codigo') ?? '')), {
    initialValue: '',
  });

  private readonly recurso = consulta<DetalleCaso>({
    fuente: () => {
      const codigo = this.codigo();
      if (!codigo) return null;
      return urlApi(`/v1/cases/${encodeURIComponent(codigo)}`);
    },
    esquema: aDetalleCaso,
  });

  readonly detalle = this.recurso.valor;
  readonly estado = this.recurso.estado;
  readonly error = this.recurso.error;
  readonly caso = computed(() => this.detalle()?.caso);

  /** Mismo criterio que la ficha de alerta: el rol debe poder escribir el caso. */
  readonly puedeModificar = computed(() => {
    const caso = this.caso();
    return caso ? this.capacidades.puedeModificar(caso.clasificacion) : false;
  });

  /** Hecho abierto en el panel; `null` significa alta. */
  readonly eventoEditado = signal<EventoCaso | null>(null);
  readonly panelHechoAbierto = signal(false);
  readonly guardandoEvento = signal(false);
  readonly errorEvento = signal<string | null>(null);

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
    this.recurso.recargar();
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

  private mensajeDeError(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite modificar la cronología de este caso.';
    if (error.codigo === 'SIN_CAMBIOS') return 'No hay cambios que guardar.';
    return error.message;
  }
}
