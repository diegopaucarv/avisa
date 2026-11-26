import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { OrdenTabla } from '../../shared/ui/orden-tabla';
import {
  CeldaTablaDirectiva,
  TablaComponent,
  type ColumnaTabla,
  type OrdenColumna,
} from '../../shared/ui/tabla.component';
import {
  BOM,
  CABECERA_MATRIZ,
  construirFilas,
  generarCsv,
  leerCabecera,
  normalizarCodigo,
  parsearCsv,
  resolverFilas,
  type FilaPlan,
  type PlanPrevisualizacion,
  type RechazoPlan,
  type ResolucionLocal,
} from './matriz-csv';

/** Filas del plan y de los rechazos que se dibujan; el resto se cuenta. */
const LIMITE_VISIBLE = 100;

const MENSAJE_SIN_ESQUEMA =
  'La previsualización necesita el esquema de la matriz aplicado en la base (migración 41). ' +
  'Mientras falte, este panel no puede resolver las equivalencias Excel → caso.';

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** `GET /api/v1/matriz/mapeo` → código Excel normalizado → código de caso AVISA. */
function aMapaEquivalencias(bruto: unknown): ReadonlyMap<string, string> {
  const mapa = new Map<string, string>();
  const items = esRegistro(bruto) && Array.isArray(bruto['items']) ? bruto['items'] : [];

  for (const item of items) {
    if (!esRegistro(item)) continue;
    const codigoExcel = typeof item['codigoExcel'] === 'string' ? item['codigoExcel'] : '';
    const codigoCaso = typeof item['codigoCaso'] === 'string' ? item['codigoCaso'] : '';
    if (codigoExcel.trim() === '' || codigoCaso.trim() === '') continue;
    mapa.set(normalizarCodigo(codigoExcel), codigoCaso.trim());
  }

  return mapa;
}

/**
 * Panel de importación de la matriz del equipo.
 *
 * Pega o elige un CSV y pide `POST /api/v1/matriz/previsualizar`. La respuesta
 * es **sólo un plan**: este panel no escribe en la base. La aplicación
 * definitiva la ejecuta `scripts/matriz/importar_matriz.py --apply --confirmar`,
 * que es el mismo importador probado en dry-run.
 *
 * El chequeo local (`resolverFilas`) se muestra como orientación inmediata y no
 * sustituye al servidor: el plan con crear/actualizar y los motivos de rechazo
 * vienen del endpoint.
 */
@Component({
  selector: 'app-matriz-importar',
  imports: [TablaComponent, CeldaTablaDirectiva],
  templateUrl: './matriz-importar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .importar {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 16px;
      padding: 14px;
    }
    .importar textarea {
      width: 100%;
      min-height: 120px;
      padding: 8px 10px;
      border: 1px solid #e0e5e9;
      border-radius: 6px;
      font-family: var(--font-mono, monospace);
      font-size: 13px;
      line-height: 1.5;
      resize: vertical;
    }
    .importar-acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .importar-archivo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #8d99a6;
    }
    .importar-resumen {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      margin: 0;
      font-size: 13px;
      color: #5f7180;
    }
    .importar-resumen b {
      color: #33465a;
    }
    .importar-subtitulo {
      margin: 12px 0 6px;
      font-size: 13px;
      font-weight: 700;
      color: #465a6c;
    }
    .importar-mensaje {
      margin: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #f6f8fa;
      color: #5f7180;
      font-size: 13px;
      line-height: 1.5;
    }
    /* Las dos tablas del panel respetan el salto de línea y la alineación alta. */
    :host ::ng-deep app-tabla .tabla tbody td {
      white-space: normal;
      vertical-align: top;
    }
    /* El resumen sigue en el DOM para lectores de pantalla, sin pintarse. */
    :host ::ng-deep app-tabla .tabla-resumen {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
    .matriz-codigos {
      display: block;
      margin-top: 2px;
      font-size: 0.72rem;
      opacity: 0.7;
    }
  `,
})
export class MatrizImportarComponent {
  private readonly http = inject(HttpClient);

  /** Equivalencias publicadas; si el esquema falta, el mapa queda vacío. */
  private readonly mapeo = consulta<ReadonlyMap<string, string>>({
    fuente: () => urlApi('/v1/matriz/mapeo'),
    esquema: aMapaEquivalencias,
  });

  readonly mapaCargado = computed(() => this.mapeo.estado() === 'listo');

  readonly texto = signal('');
  readonly nombreArchivo = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly plan = signal<PlanPrevisualizacion | null>(null);
  readonly error = signal<string | null>(null);
  readonly errorCodigo = signal<string | null>(null);
  readonly local = signal<ResolucionLocal | null>(null);

  readonly filasPlan = computed<readonly FilaPlan[]>(() => {
    const actual = this.plan();
    if (!actual) return [];
    return [...actual.crear, ...actual.actualizar];
  });

  readonly ordenPlan = new OrdenTabla<FilaPlan>();

  /** Columnas del plan, en el orden del CSV de entrada. */
  readonly columnasPlan: readonly ColumnaTabla[] = [
    { clave: 'fila', titulo: 'Fila', ordenable: true },
    { clave: 'caso', titulo: 'Caso', ordenable: true },
    { clave: 'codigoExcel', titulo: 'Código Excel', ordenable: true },
    { clave: 'accion', titulo: 'Acción / compromiso', ordenable: true },
    { clave: 'hito', titulo: 'Hito', ordenable: true },
    { clave: 'resultado', titulo: 'Resultado', ordenable: true },
  ];

  readonly ordenPlanTabla = computed<OrdenColumna | null>(() => {
    const clave = this.ordenPlan.columna();
    return clave ? { clave, direccion: this.ordenPlan.direccion() } : null;
  });

  alCambiarOrdenPlan(cambio: OrdenColumna | null): void {
    const clave = cambio?.clave ?? this.ordenPlan.columna();
    if (clave) this.ordenPlan.alternar(clave);
  }

  private readonly accesoresPlan: Record<string, (fila: FilaPlan) => unknown> = {
    fila: (fila) => fila.fila,
    caso: (fila) => fila.codigoCaso,
    codigoExcel: (fila) => fila.codigoExcel,
    accion: (fila) => fila.accion,
    hito: (fila) => fila.hito,
    resultado: (fila) => fila.accionPlan,
  };

  readonly filasPlanVisibles = computed(() =>
    this.ordenPlan.ordenar(this.filasPlan().slice(0, LIMITE_VISIBLE), this.accesoresPlan),
  );
  readonly planRestantes = computed(() => Math.max(0, this.filasPlan().length - LIMITE_VISIBLE));

  readonly ordenRechazos = new OrdenTabla<RechazoPlan>();

  /** Columnas de los rechazos. */
  readonly columnasRechazos: readonly ColumnaTabla[] = [
    { clave: 'fila', titulo: 'Fila', ordenable: true },
    { clave: 'codigo', titulo: 'Código', ordenable: true },
    { clave: 'motivo', titulo: 'Motivo', ordenable: true },
    { clave: 'codigoExcel', titulo: 'Código Excel', ordenable: true },
    { clave: 'codigoCaso', titulo: 'Código de caso', ordenable: true },
    { clave: 'detalle', titulo: 'Detalle', ordenable: true },
  ];

  readonly ordenRechazosTabla = computed<OrdenColumna | null>(() => {
    const clave = this.ordenRechazos.columna();
    return clave ? { clave, direccion: this.ordenRechazos.direccion() } : null;
  });

  alCambiarOrdenRechazos(cambio: OrdenColumna | null): void {
    const clave = cambio?.clave ?? this.ordenRechazos.columna();
    if (clave) this.ordenRechazos.alternar(clave);
  }

  private readonly accesoresRechazos: Record<string, (fila: RechazoPlan) => unknown> = {
    fila: (fila) => fila.fila,
    codigo: (fila) => fila.codigo,
    motivo: (fila) => fila.motivo,
    codigoExcel: (fila) => fila.codigoExcel,
    codigoCaso: (fila) => fila.codigoCaso,
    detalle: (fila) => fila.detalle,
  };

  readonly rechazosVisibles = computed(() =>
    this.ordenRechazos.ordenar(
      (this.plan()?.rechazadas ?? []).slice(0, LIMITE_VISIBLE),
      this.accesoresRechazos,
    ),
  );

  readonly rechazosRestantes = computed(() =>
    Math.max(0, (this.plan()?.rechazadas.length ?? 0) - LIMITE_VISIBLE),
  );

  readonly sinEsquema = computed(() => this.errorCodigo() === 'ESQUEMA_PENDIENTE');

  readonly columnasReconocidas = computed(() =>
    Object.entries(this.plan()?.columnasReconocidas ?? {}).map(([campo, rotulo]) => ({
      campo,
      rotulo,
    })),
  );

  readonly columnasIgnoradas = computed(() => this.plan()?.columnasIgnoradas ?? []);

  escribir(evento: Event): void {
    this.texto.set((evento.target as HTMLTextAreaElement).value);
  }

  async alElegirArchivo(evento: Event): Promise<void> {
    const entrada = evento.target as HTMLInputElement;
    const archivo = entrada.files?.[0];
    if (!archivo) return;

    this.error.set(null);
    this.errorCodigo.set(null);
    try {
      const contenido = await archivo.text();
      this.texto.set(contenido);
      this.nombreArchivo.set(archivo.name);
    } catch {
      this.error.set('No se pudo leer el archivo seleccionado.');
      this.errorCodigo.set('ARCHIVO_ILEGIBLE');
    } finally {
      // Permite volver a elegir el mismo archivo.
      entrada.value = '';
    }
  }

  limpiar(): void {
    this.texto.set('');
    this.nombreArchivo.set(null);
    this.plan.set(null);
    this.local.set(null);
    this.error.set(null);
    this.errorCodigo.set(null);
  }

  async previsualizar(): Promise<void> {
    if (this.enviando()) return;

    const csv = this.texto().trim();
    if (csv === '') {
      this.error.set('Pegue el contenido del CSV o elija un archivo antes de previsualizar.');
      this.errorCodigo.set('SIN_CONTENIDO');
      return;
    }

    // Chequeo local: corta cabeceras irreconocibles sin gastar una petición y
    // deja un conteo inmediato mientras responde el servidor.
    const registros = parsearCsv(csv);
    if (registros.length === 0) {
      this.error.set('El CSV está vacío: no hay cabecera ni filas.');
      this.errorCodigo.set('SIN_CONTENIDO');
      return;
    }
    const [cabecera, ...resto] = registros;
    const leida = leerCabecera(cabecera ?? []);
    if (leida.reconocidas === 0) {
      this.error.set(
        'No se reconoció ninguna columna de la cabecera. Use la plantilla del formato del equipo (A..W).',
      );
      this.errorCodigo.set('CABECERA_NO_RECONOCIDA');
      return;
    }

    const filas = construirFilas(resto, leida);
    this.local.set(
      resolverFilas(
        filas,
        this.mapaCargado() ? { mapa: this.mapeo.valor() ?? new Map<string, string>() } : {},
      ),
    );

    this.enviando.set(true);
    this.error.set(null);
    this.errorCodigo.set(null);
    this.plan.set(null);

    try {
      const respuesta = await firstValueFrom(
        this.http.post<PlanPrevisualizacion>(urlApi('/v1/matriz/previsualizar'), { csv }),
      );
      this.plan.set(respuesta);
    } catch (fallo) {
      const api = aErrorApi(fallo, 'No se pudo previsualizar el CSV.');
      this.error.set(api.codigo === 'ESQUEMA_PENDIENTE' ? MENSAJE_SIN_ESQUEMA : api.message);
      this.errorCodigo.set(api.codigo);
    } finally {
      this.enviando.set(false);
    }
  }

  /** Plantilla vacía con la cabecera A..W y BOM, para llenarla fuera. */
  descargarPlantilla(): void {
    const contenido = BOM + generarCsv(CABECERA_MATRIZ, []);
    const archivo = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const objeto = URL.createObjectURL(archivo);
    const enlace = document.createElement('a');
    enlace.href = objeto;
    enlace.download = 'avisa_matriz_plantilla.csv';
    enlace.rel = 'noopener';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(objeto), 0);
  }
}
