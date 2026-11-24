import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { urlApi } from '../../core/config/entorno';
import {
  paramsDePagina,
  normalizarColeccion,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta, type Consulta } from '../../core/http/consulta';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { aAlerta, formatearPlazo, type Alerta } from '../alertas/alerta.mapeo';
import {
  aCompromiso,
  formatearFecha,
  formatearFechaHora,
  resolverVencimiento,
  situacionDe,
  type Compromiso,
  type ResolucionVencimiento,
  type Situacion,
} from '../compromisos/compromiso.mapeo';
import {
  ETAPAS_RESUMEN,
  HORIZONTE_POR_VENCER_DIAS,
  aMarcaMasReciente,
  aResumenCompromisos,
  aSinCasoTotal,
  aTotal,
  rangoPorVencer,
  rangoVencidos,
  type EtapaClave,
  type ResumenCompromisos,
} from './resumen.mapeo';

/**
 * Tono de una métrica: `normal` con dato, `pendiente` mientras carga, `error`
 * si su consulta falló y `ausente` cuando la base no registra el dato (se
 * declara «—», nunca con un cero).
 */
type TonoMetrica = 'normal' | 'pendiente' | 'error' | 'ausente';

type Metrica = {
  clave: string;
  etiqueta: string;
  valor: string;
  /** Contexto de la cifra (fuente o definición), si aporta. */
  detalle: string | null;
  /** Advertencia de dato ausente o incompleto. */
  nota: string | null;
  tono: TonoMetrica;
  /** Repartos y ratios: valor tipográficamente más pequeño. */
  compacta: boolean;
};

type Etapa = {
  clave: string;
  id: string;
  titulo: string;
  numero: number;
  resumen: string;
  metricas: Metrica[];
  acciones: AccionEtapa[];
};

/** Acceso de una etapa: botón que navega al destino real de la app. */
type AccionEtapa = { texto: string; ruta: string };

/** Marca de sincronización de una fuente, ya resuelta para la plantilla. */
type MarcaFuente = {
  clave: string;
  etiqueta: string;
  texto: string;
  tono: TonoMetrica;
};

/**
 * Resumen operativo.
 *
 * Ordena la portada en las tres etapas de la operación —Prevención, Gestión y
 * Seguimiento—, cada una con sus indicadores y sus botones de acceso a los
 * destinos reales. Arriba, un bloque compacto declara la marca de
 * sincronización más reciente que expone cada fuente. Cada métrica tiene su
 * propia consulta, de modo que un endpoint caído sólo marca «No disponible» en
 * su fila. Nada que la API no reporte se completa con ceros ni con datos de
 * ejemplo: lo inexistente se declara «sin dato» o «—».
 */
@Component({
  selector: 'app-resumen',
  imports: [RouterLink, IconoComponent, ExportarMenuComponent],
  templateUrl: './resumen.page.html',
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

    /* ------- Tres etapas ------- */

    .dims {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 13px;
    }

    .dim {
      display: flex;
      flex-direction: column;
      padding: 17px;
    }

    .dim-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .dim-head h2 {
      margin: 0;
      color: #1a2b3e;
      font: 700 16px/1.3 var(--font-display);
      letter-spacing: -0.2px;
    }

    .dim-num {
      flex: none;
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      background: #eef2f6;
      color: #7b8896;
      font-size: 12.5px;
      font-weight: 700;
    }

    .dim-sub {
      margin: 6px 0 0;
      color: #8a96a0;
      font-size: 12.5px;
      line-height: 1.55;
    }

    .metric {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-top: 13px;
      padding-top: 13px;
      border-top: 1px solid #eef1f3;
    }

    .dim-sub + .metric {
      border-top: 0;
      padding-top: 0;
    }

    .metric-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .metric-top b {
      color: #5a6b7a;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.45;
    }

    .metric-val {
      flex: none;
      color: #1a2b3e;
      font: 700 20px/1.15 var(--font-display);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .metric-val.compacta {
      font-size: 13px;
      line-height: 1.35;
    }

    .metric-val.sin-dato {
      color: #8b97a2;
      font-size: 13px;
      font-weight: 600;
    }

    .metric-detalle {
      margin: 0;
      color: #9aa5ae;
      font-size: 12px;
      line-height: 1.5;
    }

    .metric-nota {
      margin: 0;
      color: #8b5a54;
      font-size: 12px;
      line-height: 1.55;
    }

    .metric-ausente .metric-top b {
      color: #8b97a2;
    }

    .dim-acciones {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
      padding-top: 13px;
      border-top: 1px solid #eef1f3;
    }

    /* ------- Última sincronización ------- */

    .sync {
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    .sync h2 {
      margin: 0;
      color: #1a2b3e;
      font: 700 14.5px var(--font-display);
      letter-spacing: -0.15px;
    }

    .sync-lista {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .sync-item {
      flex: 1 1 130px;
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 6px 10px;
      border: 1px solid #e6ebef;
      border-radius: 8px;
      background: #fafbfc;
    }

    .sync-fuente {
      color: #7b8896;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }

    .sync-marca {
      color: #1a2b3e;
      font-size: 13px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .sync-marca.sync-sin-dato {
      color: #8b97a2;
      font-weight: 600;
    }

    .sync-nota {
      margin: 0;
      color: #9aa5ae;
      font-size: 12px;
      line-height: 1.5;
    }

    /* ------- Colas de trabajo ------- */

    .panel {
      padding: 17px;
    }

    .tarea-lista {
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
    }

    .tarea {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 0;
      border-top: 1px solid #f0f2f4;
    }

    .tarea:first-child {
      border-top: 0;
      padding-top: 4px;
    }

    .tarea-principal {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .tarea-titulo {
      color: #33465a;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.45;
    }

    .tarea-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      color: #8b97a2;
      font-size: 12px;
    }

    .tarea-codigo {
      flex: none;
      color: #7f8c98;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .panel-nota,
    .panel-vacio {
      margin: 10px 0 0;
      font-size: 12.5px;
      line-height: 1.5;
    }

    .panel-nota {
      color: #8b5a54;
    }

    .panel-vacio {
      color: #909ba4;
    }

    .panel-pie {
      margin: 9px 0 0;
      color: #9aa5ae;
      font-size: 12px;
      line-height: 1.5;
    }

    .contadores-compromisos {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }

    .contador {
      flex: 1 1 120px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 9px 11px;
      border: 1px solid #e6ebef;
      border-radius: 8px;
      background: #fafbfc;
    }

    .contador-etiqueta {
      color: #7b8896;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }

    .contador-valor {
      color: #1a2b3e;
      font: 700 18px/1.2 var(--font-display);
    }

    .contador-valor.contador-sin-dato {
      color: #8b97a2;
      font-size: 13px;
      font-weight: 600;
    }

    @media (max-width: 1000px) {
      .dims {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .view-body {
        padding: 18px 16px 40px;
      }
      .overview-grid {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class ResumenPage {
  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /* ------------------------------------------------------------------ *
   * Prevención: alertas y demandas pendientes de vincular
   * ------------------------------------------------------------------ */

  private readonly kpiAlertasRegistradas = consulta<number>({
    fuente: () => urlConParametros(urlApi('/v1/alerts'), paramsDePagina({ pagina: 1, tamano: 1 })),
    esquema: aTotal,
  });

  private readonly kpiAlertas = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        estado: 'Pendiente de revisión',
      }),
    esquema: aTotal,
  });

  private readonly kpiDemandas = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/demandas'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        sinCaso: 'true',
      }),
    esquema: aSinCasoTotal,
  });

  /* ------------------------------------------------------------------ *
   * Gestión: casos vigentes, nivel de conflictividad y riesgo
   * ------------------------------------------------------------------ */

  private readonly kpiCasosVigentes = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        abiertos: 'true',
      }),
    esquema: aTotal,
  });

  /**
   * Cuatro consultas pequeñas, una por nivel del catálogo. El reparto se arma
   * con sus totales; si cualquiera falla, el grupo completo queda «No
   * disponible» en vez de publicar una suma parcial.
   */
  private readonly kpiNivelDiferencia = this.kpiNivel('Diferencia');
  private readonly kpiNivelControversia = this.kpiNivel('Controversia');
  private readonly kpiNivelConflictoSocial = this.kpiNivel('Conflicto social');
  private readonly kpiNivelCrisisSocial = this.kpiNivel('Crisis social');

  private readonly kpiRiesgoAlto = consulta<number>({
    fuente: () =>
      urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        abiertos: 'true',
        riesgo: 'Alto',
      }),
    esquema: aTotal,
  });

  /* ------------------------------------------------------------------ *
   * Seguimiento de compromisos: agregado de hitos y plazos
   * ------------------------------------------------------------------ */

  /**
   * `GET /v1/commitments/resumen`. El mapeador devuelve `null` si el cuerpo no
   * cumple el contrato; la consulta lo conserva como «No disponible» sin tocar
   * al resto de la página.
   */
  private readonly resumenCompromisos = consulta<ResumenCompromisos | null>({
    fuente: () => urlApi('/v1/commitments/resumen'),
    esquema: aResumenCompromisos,
  });

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

  /* ------------------------------------------------------------------ *
   * Última sincronización por fuente
   * ------------------------------------------------------------------ */

  /**
   * Casos es la única fuente que publica una marca de fila (`updatedAt`, desde
   * `core.casos.fecha_ultima_actualizacion`). Se pide la página más amplia que
   * admite la API para tomar el máximo real del listado, no la marca de una
   * fila cualquiera.
   */
  private readonly syncCasos = consulta<string | null>({
    fuente: () =>
      urlConParametros(urlApi('/v1/cases'), {
        ...paramsDePagina({ pagina: 1, tamano: 100 }),
        sort: 'recent',
      }),
    esquema: aMarcaMasReciente,
  });

  /**
   * Alertas, compromisos, documentos y territorio no exponen `updated_at` ni
   * `created_at` en su contrato actual. Se consulta una fila: si el contrato
   * cambia, el mapeador ya leería la marca; hoy devuelve `null` y el bloque
   * declara «sin dato».
   */
  private readonly syncAlertas = consulta<string | null>({
    fuente: () => urlConParametros(urlApi('/v1/alerts'), paramsDePagina({ pagina: 1, tamano: 1 })),
    esquema: aMarcaMasReciente,
  });

  private readonly syncCompromisos = consulta<string | null>({
    fuente: () =>
      urlConParametros(urlApi('/v1/commitments'), paramsDePagina({ pagina: 1, tamano: 1 })),
    esquema: aMarcaMasReciente,
  });

  private readonly syncDocumentos = consulta<string | null>({
    fuente: () =>
      urlConParametros(urlApi('/v1/documents'), paramsDePagina({ pagina: 1, tamano: 1 })),
    esquema: aMarcaMasReciente,
  });

  private readonly syncTerritorio = consulta<string | null>({
    fuente: () =>
      urlConParametros(urlApi('/v1/territorio'), {
        ...paramsDePagina({ pagina: 1, tamano: 1 }),
        recurso: 'distritos',
      }),
    esquema: aMarcaMasReciente,
  });

  readonly sincronizacion = computed<MarcaFuente[]>(() => [
    this.marcaFuente('casos', 'Casos', this.syncCasos),
    this.marcaFuente('alertas', 'Alertas', this.syncAlertas),
    this.marcaFuente('compromisos', 'Compromisos', this.syncCompromisos),
    this.marcaFuente('documentos', 'Documentos', this.syncDocumentos),
    this.marcaFuente('territorio', 'Territorio', this.syncTerritorio),
  ]);

  /* ------------------------------------------------------------------ *
   * Etapas: Prevención · Gestión · Seguimiento
   * ------------------------------------------------------------------ */

  readonly etapas = computed<Etapa[]>(() => {
    const contenido: Record<EtapaClave, Omit<Etapa, 'clave' | 'titulo' | 'numero'>> = {
      prevencion: {
        id: 'dim-prevencion',
        resumen:
          'Acciones preventivas previstas y alertas tempranas: lo que se anticipa antes de que el conflicto se exteriorice.',
        metricas: [
          this.metricaTotal(
            'alertas-registradas',
            'Alertas registradas',
            'Alertas tempranas vigentes',
            this.kpiAlertasRegistradas,
          ),
          this.metricaTotal(
            'alertas-por-atender',
            'Alertas por atender',
            'Pendientes de revisión',
            this.kpiAlertas,
          ),
          this.metricaTotal(
            'demandas-sin-caso',
            'Demandas sin caso',
            'Pendientes de vincular',
            this.kpiDemandas,
          ),
          this.metricaAusente(
            'acciones-preventivas',
            'Acciones preventivas previstas',
            'Sin dato: la base no registra acciones preventivas.',
          ),
        ],
        acciones: [
          { texto: 'Alertas tempranas', ruta: '/alertas' },
          { texto: 'Clima social', ruta: '/clima-social' },
          { texto: 'Reuniones', ruta: '/reuniones' },
        ],
      },
      gestion: {
        id: 'dim-gestion',
        resumen: 'Intervenciones y planes de acción sobre los conflictos ya manifiestos.',
        metricas: [
          this.metricaTotal(
            'casos-vigentes',
            'Casos vigentes',
            'Casos abiertos',
            this.kpiCasosVigentes,
          ),
          this.metricaNivel(),
          this.metricaTotal(
            'riesgo-alto',
            'Casos con riesgo alto',
            'Riesgo Alto',
            this.kpiRiesgoAlto,
          ),
          this.metricaAusente(
            'planes-accion',
            'Planes de acción e intervenciones',
            'Sin dato: la base no tiene tabla de planes de acción.',
          ),
        ],
        acciones: [
          { texto: 'Casos', ruta: '/casos' },
          { texto: 'Bandeja de trabajo', ruta: '/bandeja' },
          { texto: 'Compromisos', ruta: '/compromisos' },
        ],
      },
      seguimiento: {
        id: 'dim-seguimiento',
        resumen:
          'Cumplimiento de lo asumido en mesas de diálogo: qué se pactó, en qué hito se mide y qué plazo lo hace exigible.',
        metricas: [
          this.metricaResumen(
            'compromisos-registrados',
            'Compromisos registrados',
            'Compromisos en la base',
            (resumen) => String(resumen.compromisos),
          ),
          this.metricaResumen(
            'hitos-registrados',
            'Hitos registrados',
            'Hitos de compromiso en la base',
            (resumen) => String(resumen.hitos),
          ),
          this.metricaResumen(
            'compromisos-con-plazo',
            'Compromisos con plazo calculable',
            'Compromisos con al menos un hito con fecha',
            (resumen) => `${resumen.compromisosConPlazo} de ${resumen.compromisos}`,
            { compacta: true },
          ),
          this.metricaResumen(
            'hitos-con-fecha',
            'Hitos con fecha de vencimiento',
            'Hitos que registran fecha de vencimiento',
            (resumen) => `${resumen.hitosConFecha} de ${resumen.hitos}`,
            { compacta: true },
          ),
          this.metricaResumen(
            'cumplimiento',
            'Cumplimiento agregado',
            'Hitos con fecha cumplidos sobre hitos con fecha',
            (resumen) =>
              `${resumen.hitosCumplidosConFecha} de ${resumen.hitosConFecha} hitos con fecha cumplido`,
            { compacta: true },
          ),
        ],
        acciones: [
          { texto: 'Reporte de actividad', ruta: '/reportes' },
          { texto: 'Documentos', ruta: '/documentos' },
          { texto: 'Resumen de Dirección', ruta: '/direccion' },
        ],
      },
    };

    return ETAPAS_RESUMEN.map((etapa) => ({ ...etapa, ...contenido[etapa.clave] }));
  });

  /* ------------------------------------------------------------------ *
   * Colas de trabajo (mismas consultas de siempre)
   * ------------------------------------------------------------------ */

  private readonly recursoAlertas = consulta<Coleccion<Alerta>>({
    fuente: () =>
      urlConParametros(urlApi('/v1/alerts'), {
        ...paramsDePagina({ pagina: 1, tamano: 5 }),
        sort: 'recent',
      }),
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aAlerta) };
    },
  });

  readonly alertas = computed(() => this.recursoAlertas.valor()?.elementos ?? []);
  readonly estadoAlertas = this.recursoAlertas.estado;
  readonly errorAlertas = this.recursoAlertas.error;

  /** Días del horizonte que anuncia el bloque y que se envía al servidor. */
  readonly horizonteDias = HORIZONTE_POR_VENCER_DIAS;

  /**
   * Cola combinada: todo lo que vence hasta hoy + horizonte, sin `desde` y sin
   * estados terminales. El servidor ordena por vencimiento efectivo ascendente,
   * así que los vencidos salen primero; el `total` del sobre es el tamaño del
   * conjunto y la página trae sólo las cinco filas más próximas.
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
  readonly estadoVencidos = this.kpiVencidos.estado;
  readonly estadoPorVencer = this.kpiPorVencer.estado;

  /* ------------------------------------------------------------------ *
   * Helpers de plantilla
   * ------------------------------------------------------------------ */

  fecha(valor: string | null | undefined): string {
    return formatearFecha(valor);
  }

  plazo(horas: number | null): string {
    return formatearPlazo(horas);
  }

  situacion(compromiso: Compromiso): Situacion {
    return situacionDe(compromiso);
  }

  vencimiento(compromiso: Compromiso): ResolucionVencimiento {
    return resolverVencimiento(compromiso);
  }

  /** Rol accesible del valor: `status` al cargar, `alert` al fallar. */
  rolDe(tono: TonoMetrica): 'status' | 'alert' | null {
    if (tono === 'pendiente') return 'status';
    if (tono === 'error') return 'alert';
    return null;
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  recargar(): void {
    this.kpiAlertasRegistradas.recargar();
    this.kpiAlertas.recargar();
    this.kpiDemandas.recargar();
    this.kpiCasosVigentes.recargar();
    this.kpiNivelDiferencia.recargar();
    this.kpiNivelControversia.recargar();
    this.kpiNivelConflictoSocial.recargar();
    this.kpiNivelCrisisSocial.recargar();
    this.kpiRiesgoAlto.recargar();
    this.resumenCompromisos.recargar();
    this.kpiVencidos.recargar();
    this.kpiPorVencer.recargar();
    this.recursoAlertas.recargar();
    this.recursoCompromisos.recargar();
    this.syncCasos.recargar();
    this.syncAlertas.recargar();
    this.syncCompromisos.recargar();
    this.syncDocumentos.recargar();
    this.syncTerritorio.recargar();
  }

  /**
   * Estado de una fuente de sincronización: «…» mientras carga, «No disponible»
   * si su consulta falló y «sin dato» cuando la colección no expone marca.
   */
  private marcaFuente(
    clave: string,
    etiqueta: string,
    recurso: Consulta<string | null>,
  ): MarcaFuente {
    const estado = recurso.estado();
    if (estado === 'error') return { clave, etiqueta, texto: 'No disponible', tono: 'error' };
    if (estado === 'cargando' || estado === 'inactivo') {
      return { clave, etiqueta, texto: '…', tono: 'pendiente' };
    }

    const marca = recurso.valor();
    if (!marca) return { clave, etiqueta, texto: 'sin dato', tono: 'ausente' };

    return { clave, etiqueta, texto: formatearFechaHora(marca), tono: 'normal' };
  }

  /** Texto del contador: «…» mientras carga, «No disponible» si falló. */
  private textoTotal(recurso: Consulta<number>): string {
    if (recurso.estado() === 'error') return 'No disponible';
    const valor = recurso.valor();
    return valor === undefined ? '…' : String(valor);
  }

  /** Consulta de un nivel de conflictividad: sólo interesa el `total`. */
  private kpiNivel(codigo: string): Consulta<number> {
    return consulta<number>({
      fuente: () =>
        urlConParametros(urlApi('/v1/cases'), {
          ...paramsDePagina({ pagina: 1, tamano: 1 }),
          abiertos: 'true',
          nivel: codigo,
        }),
      esquema: aTotal,
    });
  }

  private metricaTotal(
    clave: string,
    etiqueta: string,
    detalle: string | null,
    recurso: Consulta<number>,
  ): Metrica {
    const estado = recurso.estado();
    if (estado === 'error') {
      return this.metricaCon('error', clave, etiqueta, 'No disponible', detalle, null);
    }

    const valor = recurso.valor();
    if (valor === undefined) {
      return this.metricaCon('pendiente', clave, etiqueta, '…', detalle, null);
    }

    return this.metricaCon('normal', clave, etiqueta, String(valor), detalle, null);
  }

  private metricaAusente(clave: string, etiqueta: string, nota: string): Metrica {
    return this.metricaCon('ausente', clave, etiqueta, '—', null, nota);
  }

  private metricaResumen(
    clave: string,
    etiqueta: string,
    detalle: string | null,
    seleccion: (resumen: ResumenCompromisos) => string,
    opciones: { compacta?: boolean; nota?: string } = {},
  ): Metrica {
    const estado = this.resumenCompromisos.estado();
    if (estado === 'error') {
      return this.metricaCon(
        'error',
        clave,
        etiqueta,
        'No disponible',
        detalle,
        null,
        opciones.compacta,
      );
    }

    const resumen = this.resumenCompromisos.valor();
    if (resumen === undefined) {
      return this.metricaCon('pendiente', clave, etiqueta, '…', detalle, null, opciones.compacta);
    }

    if (resumen === null) {
      return this.metricaCon(
        'error',
        clave,
        etiqueta,
        'No disponible',
        detalle,
        null,
        opciones.compacta,
      );
    }

    return this.metricaCon(
      'normal',
      clave,
      etiqueta,
      seleccion(resumen),
      detalle,
      opciones.nota ?? null,
      opciones.compacta,
    );
  }

  /**
   * Nivel de conflictividad: latente = Diferencia + Controversia; manifiesto =
   * Conflicto social + Crisis social. Si las cuatro consultas responden, el
   * remanente frente a los casos vigentes se declara «sin nivel declarado».
   * Cualquier fallo deja el grupo entero como «No disponible».
   */
  private metricaNivel(): Metrica {
    const clave = 'nivel-conflictividad';
    const etiqueta = 'Nivel de conflictividad';
    const detalle =
      'latente = Diferencia + Controversia · manifiesto = Conflicto social + Crisis social';

    const recursos = [
      this.kpiNivelDiferencia,
      this.kpiNivelControversia,
      this.kpiNivelConflictoSocial,
      this.kpiNivelCrisisSocial,
    ];

    if (recursos.some((recurso) => recurso.estado() === 'error')) {
      return this.metricaCon(
        'error',
        clave,
        etiqueta,
        'No disponible',
        detalle,
        'Sin dato: no se pudo consultar el reparto por nivel.',
        true,
      );
    }

    const diferencia = this.kpiNivelDiferencia.valor();
    const controversia = this.kpiNivelControversia.valor();
    const conflictoSocial = this.kpiNivelConflictoSocial.valor();
    const crisisSocial = this.kpiNivelCrisisSocial.valor();

    if (
      diferencia === undefined ||
      controversia === undefined ||
      conflictoSocial === undefined ||
      crisisSocial === undefined
    ) {
      return this.metricaCon('pendiente', clave, etiqueta, '…', detalle, null, true);
    }

    const latente = diferencia + controversia;
    const manifiesto = conflictoSocial + crisisSocial;

    const vigentes = this.kpiCasosVigentes.valor();
    const sinNivel = typeof vigentes === 'number' ? vigentes - (latente + manifiesto) : 0;
    const nota =
      sinNivel > 0 ? `${sinNivel} ${sinNivel === 1 ? 'caso' : 'casos'} sin nivel declarado.` : null;

    return this.metricaCon(
      'normal',
      clave,
      etiqueta,
      `${latente} latentes · ${manifiesto} manifiestos`,
      detalle,
      nota,
      true,
    );
  }

  private metricaCon(
    tono: TonoMetrica,
    clave: string,
    etiqueta: string,
    valor: string,
    detalle: string | null,
    nota: string | null,
    compacta = false,
  ): Metrica {
    return { clave, etiqueta, valor, detalle, nota, tono, compacta };
  }
}
