import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta, type Consulta, type EstadoConsulta } from '../../core/http/consulta';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import { ThOrdenDirective } from '../../shared/ui/th-orden.directive';
import { aAlerta, type Alerta } from '../alertas/alerta.mapeo';
import { aColeccionDemandas, type ColeccionDemandas } from '../casos/demanda-sin-caso.mapeo';
import { aCompromiso, type Compromiso } from '../compromisos/compromiso.mapeo';
import {
  HORIZONTE_POR_VENCER_DIAS,
  aTotal,
  rangoPorVencer,
  rangoVencidos,
} from '../resumen/resumen.mapeo';
import {
  OPCIONES_TIPO,
  claseVencimiento,
  construirCola,
  filtrarColaPorTipo,
  normalizarFiltroTipo,
  type FiltroTipoCola,
  type ItemCola,
} from './bandeja.cola';

/**
 * Bandeja de trabajo.
 *
 * Una sola cola con lo que exige atención. Cada fuente conserva su consulta
 * paginada actual (alertas pendientes, compromisos vencidos o por vencer y
 * demandas sin caso); la cola mezcla esas filas ya cargadas, las ordena por
 * plazo/riesgo/revisión y las filtra por tipo. No repite la lógica de las
 * pantallas completas: sólo reutiliza sus mapeos.
 *
 * Quedan pendientes, sin simular: el tablero con mapa y matriz (ítem 111) y la
 * asignación, posposición, fecha límite y responsable (ítem 50).
 */
@Component({
  selector: 'app-bandeja',
  imports: [RouterLink, IconoComponent, ExportarMenuComponent, ThOrdenDirective],
  templateUrl: './bandeja.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .view-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 100%;
      max-width: 1420px;
      margin: 0 auto;
      padding: 27px 34px 50px;
      box-sizing: border-box;
    }

    .view-head {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .cola-filtros {
      flex-wrap: wrap;
    }

    .tablero-bandeja {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .tablero-bandeja .stat-copy > strong.sin-dato {
      font-size: 14px;
      line-height: 1.3;
    }

    .cola-filtros b {
      margin-left: 5px;
      font-variant-numeric: tabular-nums;
      opacity: 0.72;
    }

    .cola-nota {
      margin: -4px 0 0;
      color: #8b97a2;
      font-size: 12.5px;
      line-height: 1.55;
    }

    .cola-panel {
      padding: 17px;
    }

    .cola-titulo {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .cola-titulo app-icono {
      color: #5b7290;
    }

    .cola-contadores {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .cola-contador {
      display: flex;
      align-items: baseline;
      gap: 5px;
      padding: 6px 9px;
      border: 1px solid #e6ebef;
      border-radius: 8px;
      background: #fafbfc;
      color: #7b8896;
      font-size: 12px;
      white-space: nowrap;
    }

    .cola-contador strong {
      color: #1a2b3e;
      font: 700 14.5px/1.2 var(--font-display);
    }

    .cola-tabla {
      min-width: 880px;
    }

    .cola-tabla td {
      white-space: normal;
      vertical-align: middle;
    }

    .cola-tabla td:first-child {
      min-width: 0;
    }

    .cola-tabla td:nth-child(3) {
      min-width: 220px;
    }

    .cola-plazo {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 3px;
    }

    .cola-fecha {
      color: #99a3aa;
      font-size: 12px;
    }

    .cola-registro strong {
      display: block;
      color: #465a6c;
      font-size: 12px;
      font-weight: 600;
    }

    .cola-registro small {
      display: block;
      margin-top: 3px;
      color: #99a3aa;
      font-size: 12px;
    }

    .tipo-tag {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .tipo-alerta {
      background: #eef3fa;
      color: #4a6b93;
    }

    .tipo-compromiso {
      background: #fff4e6;
      color: #9d702e;
    }

    .tipo-demanda {
      background: #f0f2f4;
      color: #75818b;
    }

    .cola-nota-fuente {
      margin: 10px 0 0;
      color: #8b5a54;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .cola-cargando {
      margin: 10px 0 0;
      color: #909ba4;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .cola-pie {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 12px;
    }

    .cola-totales {
      margin: 0;
      color: #9aa5ae;
      font-size: 12px;
      line-height: 1.6;
    }

    .cola-totales strong {
      color: #66757f;
    }

    .cola-enlaces {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
    }

    .cola-pendiente {
      margin: 12px 0 0;
      padding: 9px 11px;
      border: 1px dashed #dce3e8;
      border-radius: 8px;
      color: #8b97a2;
      font-size: 12px;
      line-height: 1.55;
    }

    .cola-aviso {
      margin: 0 0 12px;
      padding: 8px 11px;
      border: 1px solid #ecdcb5;
      border-radius: 8px;
      background: #fdf8ec;
      color: #7c6427;
      font-size: 12px;
      line-height: 1.55;
    }

    @media (max-width: 980px) {
      .tablero-bandeja {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 520px) {
      .tablero-bandeja {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .view-body {
        padding: 18px 16px 40px;
      }

      .cola-panel {
        padding: 14px;
      }
    }
  `,
})
export class BandejaPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly opcionesTipo = OPCIONES_TIPO;
  readonly horizonteDias = HORIZONTE_POR_VENCER_DIAS;

  readonly etiquetasTipo: Record<ItemCola['tipo'], string> = {
    alerta: 'Alerta',
    compromiso: 'Compromiso',
    demanda: 'Demanda',
  };

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** `?tipo=` de la URL; cualquier variante desconocida cae en `todos`. */
  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({ tipo: normalizarFiltroTipo(params.get('tipo')) })),
    ),
    { initialValue: { tipo: 'todos' as FiltroTipoCola } },
  );

  readonly filtroTipo = computed(() => this.parametros().tipo);

  /** Referencia de «hoy» para vencer/por vencer; se fija al abrir la pantalla. */
  private readonly hoy = computed(() => new Date());

  /* ------------------------------------------------------------------ *
   * Alertas pendientes
   * ------------------------------------------------------------------ */

  private readonly recursoAlertas = consulta<Coleccion<Alerta>>({
    fuente: () =>
      urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: 1, tamano: 5 }),
        estado: 'Pendiente de revisión',
        sort: 'recent',
      }),
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aAlerta) };
    },
  });

  readonly alertas = computed(() => this.recursoAlertas.valor()?.elementos ?? []);
  readonly totalAlertas = computed(() => this.recursoAlertas.valor()?.total ?? 0);
  readonly estadoAlertas = this.recursoAlertas.estado;
  readonly errorAlertas = this.recursoAlertas.error;

  /* ------------------------------------------------------------------ *
   * Compromisos vencidos o por vencer
   * ------------------------------------------------------------------ */

  /**
   * Contador de vencidos: `vencimiento_hasta` ayer, sin `desde`, y sin estados
   * terminales. El `total` del sobre es la cifra exacta; no se traen filas.
   */
  private readonly kpiVencidos = consulta<number>({
    fuente: () => {
      const { hasta } = rangoVencidos();
      return urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        excluir_terminales: 'true',
        vencimiento_hasta: hasta,
      });
    },
    esquema: aTotal,
  });

  /** Contador de «por vencer»: hoy y los próximos `horizonteDias`, inclusive. */
  private readonly kpiPorVencer = consulta<number>({
    fuente: () => {
      const rango = rangoPorVencer();
      return urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        excluir_terminales: 'true',
        vencimiento_desde: rango.desde,
        vencimiento_hasta: rango.hasta,
      });
    },
    esquema: aTotal,
  });

  /**
   * Cola de compromisos: todo lo que vence hasta hoy + horizonte, sin `desde`
   * y sin estados terminales. El servidor ordena por vencimiento efectivo
   * ascendente, así que la primera página trae los plazos más próximos.
   */
  private readonly recursoCompromisos = consulta<Coleccion<Compromiso>>({
    fuente: () => {
      const { hasta } = rangoPorVencer();
      return urlConParametros(urlApi('/v1/commitments'), {
        ...paramsDePagina({ pagina: 1, tamano: 5 }),
        excluir_terminales: 'true',
        vencimiento_hasta: hasta,
      });
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aCompromiso) };
    },
  });

  readonly compromisos = computed(() => this.recursoCompromisos.valor()?.elementos ?? []);
  readonly totalCompromisos = computed(() => this.recursoCompromisos.valor()?.total ?? 0);
  readonly estadoCompromisos = this.recursoCompromisos.estado;
  readonly errorCompromisos = this.recursoCompromisos.error;

  readonly textoVencidos = computed(() => this.textoTotal(this.kpiVencidos));
  readonly textoPorVencer = computed(() => this.textoTotal(this.kpiPorVencer));

  /* ------------------------------------------------------------------ *
   * Demandas sin caso
   * ------------------------------------------------------------------ */

  private readonly recursoDemandas = consulta<ColeccionDemandas>({
    fuente: () =>
      urlConParametros(urlApi('/v1/demandas'), {
        ...paramsDePagina({ pagina: 1, tamano: 5 }),
        sinCaso: 'true',
        sort: 'recent',
      }),
    esquema: aColeccionDemandas,
  });

  readonly demandas = computed(() => this.recursoDemandas.valor()?.elementos ?? []);
  readonly totalDemandas = computed(() => this.recursoDemandas.valor()?.sinCasoTotal ?? 0);
  readonly estadoDemandas = this.recursoDemandas.estado;
  readonly errorDemandas = this.recursoDemandas.error;

  /* ------------------------------------------------------------------ *
   * Cola única
   * ------------------------------------------------------------------ */

  /** Filas cargadas de las tres fuentes, ordenadas y recortadas por `?tipo=`. */
  readonly cola = computed(() =>
    filtrarColaPorTipo(
      construirCola(
        {
          alertas: this.alertas(),
          compromisos: this.compromisos(),
          demandas: this.demandas(),
        },
        this.hoy(),
      ),
      this.filtroTipo(),
    ),
  );

  /** Orden local de la tabla de la cola. */
  readonly orden = new OrdenTabla<ItemCola>();

  private readonly accesoresCola: Record<string, (item: ItemCola) => unknown> = {
    plazo: (item) => item.fecha,
    tipo: (item) => item.tipo,
    registro: (item) => item.titulo,
    caso: (item) => item.caso,
    territorio: (item) => item.territorio,
    riesgo: (item) => item.riesgo,
    revision: (item) => item.revisionPendiente,
  };

  readonly filasVisibles = computed(() => this.orden.ordenar(this.cola(), this.accesoresCola));

  readonly cargando = computed(() =>
    [this.estadoAlertas(), this.estadoCompromisos(), this.estadoDemandas()].some(
      (estado) => estado === 'cargando' || estado === 'inactivo',
    ),
  );

  readonly fuentesConError = computed(() => {
    const fuentes: string[] = [];
    if (this.estadoAlertas() === 'error') fuentes.push('alertas');
    if (this.estadoCompromisos() === 'error') fuentes.push('compromisos');
    if (this.estadoDemandas() === 'error') fuentes.push('demandas');
    return fuentes;
  });

  readonly errorTotal = computed(() => this.fuentesConError().length === 3);

  readonly hayErrorParcial = computed(() => {
    const total = this.fuentesConError().length;
    return total > 0 && total < 3;
  });

  readonly mensajeError = computed(() => {
    const mensajes = [
      this.errorAlertas()?.message,
      this.errorCompromisos()?.message,
      this.errorDemandas()?.message,
    ].filter((mensaje): mensaje is string => !!mensaje);
    return mensajes[0] ?? 'No se pudo cargar la bandeja.';
  });

  /**
   * Totales por fuente: son del servidor, no de las filas visibles. Mientras
   * una fuente no responde se declara «…» o «No disponible», sin estimar.
   */
  readonly textos = computed(() => {
    const alertas = this.textoFuente(
      this.estadoAlertas(),
      this.recursoAlertas.valor() !== undefined,
      this.totalAlertas(),
    );
    const compromisos = this.textoFuente(
      this.estadoCompromisos(),
      this.recursoCompromisos.valor() !== undefined,
      this.totalCompromisos(),
    );
    const demandas = this.textoFuente(
      this.estadoDemandas(),
      this.recursoDemandas.valor() !== undefined,
      this.totalDemandas(),
    );

    const todosCargados =
      this.recursoAlertas.valor() !== undefined &&
      this.recursoCompromisos.valor() !== undefined &&
      this.recursoDemandas.valor() !== undefined;

    const todos = this.fuentesConError().length
      ? 'No disponible'
      : todosCargados
        ? String(this.totalAlertas() + this.totalCompromisos() + this.totalDemandas())
        : '…';

    return { alertas, compromisos, demandas, todos };
  });

  /**
   * Tablero de cabecera: sólo cifras ya declaradas por cada fuente. Mientras la
   * consulta carga se muestra «…» y si falla, «No disponible»; nunca un cero
   * que no se pueda sostener.
   */
  readonly tablero = computed(
    () =>
      [
        {
          etiqueta: 'Alertas pendientes',
          valor: this.textoFuente(
            this.estadoAlertas(),
            this.recursoAlertas.valor() !== undefined,
            this.totalAlertas(),
          ),
          detalle: 'En revisión',
          icono: 'alertas',
          tono: '',
        },
        {
          etiqueta: 'Compromisos vencidos',
          valor: this.textoVencidos(),
          detalle: 'Plazo cumplido',
          icono: 'compromisos',
          tono: 'red',
        },
        {
          etiqueta: 'Compromisos por vencer',
          valor: this.textoPorVencer(),
          detalle: `Próximos ${this.horizonteDias} días`,
          icono: 'reloj',
          tono: 'amber',
        },
        {
          etiqueta: 'Demandas sin caso',
          valor: this.textoFuente(
            this.estadoDemandas(),
            this.recursoDemandas.valor() !== undefined,
            this.totalDemandas(),
          ),
          detalle: 'Sin caso vinculado',
          icono: 'casos',
          tono: '',
        },
      ] as const,
  );

  /* ------------------------------------------------------------------ *
   * Helpers de plantilla
   * ------------------------------------------------------------------ */

  /** Texto del contador de una fuente: «…» mientras carga, «No disponible» si falló. */
  private textoFuente(estado: EstadoConsulta, cargado: boolean, valor: number): string {
    if (estado === 'error') return 'No disponible';
    if (!cargado) return '…';
    return String(valor);
  }

  /** Texto del KPI: «…» mientras carga, «No disponible» si falló. */
  private textoTotal(recurso: Consulta<number>): string {
    if (recurso.estado() === 'error') return 'No disponible';
    const valor = recurso.valor();
    return valor === undefined ? '…' : String(valor);
  }

  textoDe(filtro: FiltroTipoCola): string {
    const textos = this.textos();
    switch (filtro) {
      case 'alertas':
        return textos.alertas;
      case 'compromisos':
        return textos.compromisos;
      case 'demandas':
        return textos.demandas;
      default:
        return textos.todos;
    }
  }

  clasePlazo(item: ItemCola): string {
    return claseVencimiento(item, this.hoy());
  }

  etiquetaPlazo(item: ItemCola): string {
    switch (this.clasePlazo(item)) {
      case 'due-vencido':
        return 'Vencido';
      case 'due-por-vencer':
        return 'Por vencer';
      case 'due-en-plazo':
        return 'En plazo';
      default:
        return 'Sin fecha';
    }
  }

  /** Persiste el filtro en `?tipo=`, sin recargar la pantalla. */
  cambiarTipo(tipo: FiltroTipoCola): void {
    if (tipo === this.filtroTipo()) return;
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: { tipo },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  recargar(): void {
    this.recursoAlertas.recargar();
    this.kpiVencidos.recargar();
    this.kpiPorVencer.recargar();
    this.recursoCompromisos.recargar();
    this.recursoDemandas.recargar();
  }
}
