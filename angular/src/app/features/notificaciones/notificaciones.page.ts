import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  TAMANO_PAGINA,
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { esRegistro, texto, type Registro } from '../../dominio/mapeo';
import { ExportarMenuComponent } from '../../shared/ui/exportar-menu.component';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';

/**
 * `GET /api/v1/notifications` devuelve `{items, total, page, pageSize,
 * generatedAt, pagina, tamanoPagina}` y cada aviso tiene exactamente los
 * campos de `lib/db/repos/notifications.ts`: `id`, `tipo`, `entidadTipo`,
 * `entidadId`, `venceEn`, `estado` y `createdAt`. No hay título, detalle ni
 * booleano de lectura.
 *
 * `estado` sí es una marca de lectura (`pendiente` | `enviada` | `leida` según
 * el CHECK de `core.notificaciones`): se pinta como leída sólo cuando vale
 * `leida`. No existe endpoint para cambiar ese estado, así que la pantalla no
 * ofrece «marcar como leída».
 *
 * `entidadId` es un UUID interno y ninguna ruta de la SPA lo acepta: el enlace
 * abre la sección del recurso, nunca una ficha concreta.
 */
export type Notificacion = {
  id: string;
  /** Código técnico del aviso (`regla_por_vencer`, …). */
  tipo: string;
  /** `tipo` legible, porque el modelo no trae título. */
  titulo: string;
  categoria: string;
  icono: string;
  entidadTipo: string | null;
  entidadId: string | null;
  venceEn: string | null;
  estado: string | null;
  leida: boolean;
  creadaEn: string | null;
  /** Sección relacionada; `null` cuando el recurso no tiene pantalla propia. */
  seccion: { ruta: string; etiqueta: string } | null;
};

type Categoria = {
  pista: string;
  etiqueta: string;
  icono: string;
  seccion: { ruta: string; etiqueta: string };
};

const CATEGORIAS: readonly Categoria[] = [
  {
    pista: 'alerta',
    etiqueta: 'Alerta',
    icono: 'alertas',
    seccion: { ruta: '/alertas', etiqueta: 'Alertas tempranas' },
  },
  {
    pista: 'compromiso',
    etiqueta: 'Compromiso',
    icono: 'compromisos',
    seccion: { ruta: '/compromisos', etiqueta: 'Compromisos' },
  },
  {
    pista: 'documento',
    etiqueta: 'Documento',
    icono: 'documentos',
    seccion: { ruta: '/documentos', etiqueta: 'Documentos' },
  },
  {
    pista: 'caso',
    etiqueta: 'Caso',
    icono: 'casos',
    seccion: { ruta: '/casos', etiqueta: 'Casos' },
  },
];

/** `regla_por_vencer` → `Regla por vencer`; no hay título en el modelo. */
function humanizar(valor: string): string {
  const frase = valor.replace(/_/g, ' ').trim();
  if (!frase) return 'Notificación';
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

function estadoClave(valor: string | null): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function etiquetaEstado(valor: string | null): string {
  switch (estadoClave(valor)) {
    case 'leida':
      return 'Leída';
    case 'enviada':
      return 'Enviada';
    case 'pendiente':
      return 'Pendiente';
    default:
      return valor?.trim() ? humanizar(valor) : 'Sin estado';
  }
}

function claseEstado(valor: string | null): string {
  switch (estadoClave(valor)) {
    case 'leida':
      return 'state-approved';
    case 'pendiente':
      return 'state-pending';
    default:
      return 'state-dismissed';
  }
}

/** Un elemento de `items[]`. */
export function aNotificacion(bruto: unknown): Notificacion {
  const registro: Registro = esRegistro(bruto) ? bruto : {};
  const tipo = texto(registro, ['tipo']) ?? '';
  const entidadTipo = texto(registro, ['entidadTipo', 'entidad_tipo']);
  const pista = `${entidadTipo ?? ''} ${tipo}`.toLowerCase();
  const categoria = CATEGORIAS.find((opcion) => pista.includes(opcion.pista)) ?? null;
  const estado = texto(registro, ['estado']);

  return {
    id: texto(registro, ['id']) ?? '',
    tipo,
    titulo: humanizar(tipo),
    categoria: categoria?.etiqueta ?? 'Sistema',
    icono: categoria?.icono ?? 'campana',
    entidadTipo,
    entidadId: texto(registro, ['entidadId', 'entidad_id']),
    venceEn: texto(registro, ['venceEn', 'vence_en']),
    estado,
    leida: estadoClave(estado) === 'leida',
    creadaEn: texto(registro, ['createdAt', 'created_at']),
    seccion: categoria ? categoria.seccion : null,
  };
}

/** `YYYY-MM-DD` (o ISO completo) → `DD/MM/YYYY`, sin depender del locale. */
export function formatearFecha(valor: string | null | undefined): string {
  if (!valor) return '—';

  const partes = valor.slice(0, 10).split('-');
  if (partes.length !== 3) return valor;

  const [anio, mes, dia] = partes;
  if (!anio || !mes || !dia) return valor;

  return `${dia}/${mes}/${anio}`;
}

type FiltrosNotificaciones = {
  pagina: number;
  tamano: number;
};

const FILTROS_INICIALES: FiltrosNotificaciones = {
  pagina: 1,
  tamano: TAMANO_PAGINA,
};

/**
 * Bandeja de notificaciones.
 *
 * Listado paginado en servidor. La tabla `core.notificaciones` está vacía hoy:
 * el estado vacío es honesto y no se rellenan filas de ejemplo. Las no leídas
 * se marcan con el campo `estado`, sin ofrecer una acción que la API no tiene.
 */
@Component({
  selector: 'app-notificaciones',
  imports: [RouterLink, IconoComponent, PaginacionComponent, ExportarMenuComponent],
  templateUrl: './notificaciones.page.html',
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

    .view-head h1 {
      margin: 0;
      color: #1a2b3e;
      font: 700 22px/1.3 var(--font-display);
      letter-spacing: -0.65px;
    }

    .view-subtitle {
      max-width: 760px;
      margin: 6px 0 0;
      color: #7b8896;
      font-size: 11px;
      line-height: 1.6;
    }

    .notificacion {
      display: flex;
      align-items: flex-start;
      gap: 9px;
    }

    .notificacion-icono {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      flex: none;
      border-radius: 50%;
      background: #eef3f7;
      color: #5f7690;
    }

    .notificacion-texto {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .data-table tr.sin-leer td {
      background: #fbfdff;
    }

    .data-table tr.sin-leer td:first-child {
      box-shadow: inset 3px 0 0 #4f7fc4;
    }

    .data-table tr.sin-leer .notificacion-texto strong {
      color: #1f3850;
      font-weight: 700;
    }

    .sin-dato {
      color: #a0aab3;
      font-style: italic;
    }

    .notificaciones-nota {
      margin: 0;
      color: #8b97a2;
      font-size: 9px;
      line-height: 1.55;
    }

    @media (max-width: 720px) {
      .view-body {
        padding: 18px 16px 40px;
      }
    }
  `,
})
export class NotificacionesPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map((params) => ({
        pagina: Math.max(1, Number(params.get('pagina') ?? '1') || 1),
        tamano: Math.max(1, Number(params.get('tamano') ?? String(TAMANO_PAGINA)) || TAMANO_PAGINA),
      })),
    ),
    { initialValue: FILTROS_INICIALES },
  );

  readonly filtros = computed(() => this.parametros());

  private readonly listado = consulta<Coleccion<Notificacion>>({
    fuente: () => {
      const { pagina, tamano } = this.parametros();
      return urlConParametros(urlApi('/v1/notifications'), paramsDePagina({ pagina, tamano }));
    },
    esquema: (bruto) => {
      const coleccion = normalizarColeccion<unknown>(bruto);
      return { ...coleccion, elementos: coleccion.elementos.map(aNotificacion) };
    },
  });

  readonly notificaciones = computed(() => this.listado.valor()?.elementos ?? []);
  readonly total = computed(() => this.listado.valor()?.total ?? 0);
  readonly sinLeerEnPagina = computed(
    () => this.notificaciones().filter((notificacion) => !notificacion.leida).length,
  );
  readonly estadoListado = this.listado.estado;
  readonly errorListado = this.listado.error;

  /** Último fallo del botón de exportación; vacío si no hubo. */
  readonly exportarError = signal<string | null>(null);

  /** Leyenda de la tabla; se arma aquí para no partir `@if` dentro de `<caption>`. */
  readonly resumenTabla = computed(() => {
    const partes = [`Total: ${this.total()}`];
    const sinLeer = this.sinLeerEnPagina();
    if (sinLeer > 0) partes.push(`${sinLeer} sin leer en esta página`);
    partes.push('orden del servidor, más recientes primero');
    return `${partes.join(' · ')}.`;
  });

  fecha(valor: string | null): string {
    return formatearFecha(valor);
  }

  estadoEtiqueta(valor: string | null): string {
    return etiquetaEstado(valor);
  }

  estadoClase(valor: string | null): string {
    return claseEstado(valor);
  }

  cambiarPagina(pagina: number): void {
    void this.actualizar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    void this.actualizar({ tamano, pagina: 1 });
  }

  recargar(): void {
    this.listado.recargar();
  }

  alFallarExportacion(mensaje: string): void {
    this.exportarError.set(mensaje);
  }

  private actualizar(cambios: Partial<FiltrosNotificaciones>): void {
    const siguiente = { ...this.parametros(), ...cambios };

    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: {
        pagina: siguiente.pagina > 1 ? siguiente.pagina : null,
        tamano: siguiente.tamano !== TAMANO_PAGINA ? siguiente.tamano : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
