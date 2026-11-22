import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { aDetalleCaso, ActorCaso, DemandaCaso, DetalleCaso, EventoCaso } from '../../dominio/mapeo';
import {
  AnularPanelComponent,
  ResultadoAnulacion,
  type ModoAnulacion,
} from '../../shared/ui/anular-panel.component';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { formatearFecha } from '../../shared/formato-fecha';
import { GlosarioComponent } from '../../shared/ui/glosario.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { etiquetaNivelGobierno } from '../compromisos/compromiso.mapeo';
import { COMPONENTES_CICLO } from './ciclo.contenido';
import { CuerpoDemanda, DemandaPanelComponent } from './demanda-panel.component';
import {
  CuerpoEvento,
  EventoPanelComponent,
  OpcionTipoHecho,
  aTiposHecho,
} from './evento-panel.component';
import { ExpedienteCompletitudComponent } from './expediente-completitud.component';
import { orientacionPorRiesgo } from './proximo-paso';
import { EnlaceRiel, RielRelacionesComponent } from './riel-relaciones.component';

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
    ExpedienteCompletitudComponent,
  ],
  templateUrl: './caso-detalle.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .timeline-edit {
      min-height: 26px;
      margin-top: 4px;
      padding: 0 10px;
      font-size: 10px;
    }

    .aviso-ok {
      color: #2f6f52;
      font-size: 11.5px;
    }

    .detail-hint {
      display: block;
      margin-top: 2px;
      font-size: 10.5px;
      font-weight: 400;
      color: #8d99a6;
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

    .pasos-riesgo {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 8px 0 0;
      padding-left: 16px;
      color: var(--ink-2);
      font-size: 10.5px;
      line-height: 1.6;
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
      font-size: 9.5px;
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

      .detail-section > .detail-hint {
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
  private readonly http = inject(HttpClient);
  private readonly capacidades = inject(CapacidadesService);
  private readonly plataforma = inject(PLATFORM_ID);

  readonly codigo = toSignal(this.ruta.paramMap.pipe(map((params) => params.get('codigo') ?? '')), {
    initialValue: '',
  });

  /** Componentes del ciclo de intervención sectorial, en el orden de la Guía. */
  readonly componentesCiclo = COMPONENTES_CICLO;

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

  /**
   * Tras anular, la API deja de devolver el caso: la política RLS de `SELECT`
   * esconde lo anulado. Se retiene la última ficha para poder mostrar el estado
   * y ofrecer la restauración sin inventar una papelera.
   */
  readonly snapshotAnulado = signal<DetalleCaso | null>(null);

  /** Ficha visible: la retenida tras anular o la que llega de la API. */
  readonly ficha = computed(() => this.snapshotAnulado() ?? this.detalle() ?? null);
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
   * Contadores del riel (item 67). Sólo lee lo que ya está en el detalle: no
   * lanza consultas adicionales por relación.
   */
  readonly enlacesRiel = computed<readonly EnlaceRiel[]>(() => {
    const ficha = this.ficha();
    if (!ficha) return [];
    return [
      {
        etiqueta: 'Actores',
        ancla: 'actores-caso',
        contador: ficha.actores.length,
        icono: 'actores',
      },
      {
        etiqueta: 'Hechos',
        ancla: 'eventos-caso',
        contador: ficha.eventos.length,
        icono: 'actividad',
      },
      {
        etiqueta: 'Demandas',
        ancla: 'demandas-caso',
        contador: ficha.demandas.length,
        icono: 'bandeja',
      },
      {
        etiqueta: 'Alertas',
        ancla: 'alertas-caso',
        contador: ficha.alertas.length,
        icono: 'alertas',
      },
      {
        etiqueta: 'Compromisos',
        ancla: 'compromisos-caso',
        contador: ficha.compromisos.length,
        icono: 'compromisos',
      },
      {
        etiqueta: 'Documentos',
        ancla: 'documentos-caso',
        contador: ficha.documentos.length,
        icono: 'documentos',
      },
      {
        etiqueta: 'Historial',
        ancla: 'historial-caso',
        contador: ficha.historial.length,
        icono: 'reloj',
      },
    ];
  });

  /** «Próximo paso» (item 19): orientación literal de la Tabla 3 de la Guía. */
  readonly orientacion = computed(() => orientacionPorRiesgo(this.caso()?.riesgo ?? 'Bajo'));

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

  readonly panelAnulacion = signal<ModoAnulacion | null>(null);
  readonly enviandoAnulacion = signal(false);
  readonly errorAnulacion = signal<string | null>(null);
  readonly avisoAnulacion = signal<string | null>(null);

  /** Hecho abierto en el panel; `null` significa alta. */
  readonly eventoEditado = signal<EventoCaso | null>(null);
  readonly panelHechoAbierto = signal(false);
  readonly guardandoEvento = signal(false);
  readonly errorEvento = signal<string | null>(null);

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
    this.recurso.recargar();
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

  /** Texto corto de la demanda para las etiquetas accesibles de la tabla. */
  referenciaDemanda(demanda: DemandaCaso): string {
    const texto = (demanda.problema ?? demanda.descripcion ?? '').trim();
    if (!texto) return 'sin problema';
    return texto.length > 60 ? `${texto.slice(0, 57)}…` : texto;
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

  /** Impresión de la ficha (item 42): usa la hoja `@media print` del componente. */
  imprimir(): void {
    if (!isPlatformBrowser(this.plataforma)) return;
    window.print();
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
          const actual = this.detalle();
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

  private mensajeDeErrorDemanda(fallo: unknown): string {
    const error = aErrorApi(fallo);
    if (error.esProhibido) return 'Su rol no permite modificar las demandas de este caso.';
    if (error.codigo === 'SIN_CAMBIOS') return 'No hay cambios que guardar.';
    if (error.codigo === 'INVALID_INPUT' || error.estado === 422) {
      return 'Datos inválidos: revise el problema (3P) y el estado de atención.';
    }
    return error.message;
  }
}
