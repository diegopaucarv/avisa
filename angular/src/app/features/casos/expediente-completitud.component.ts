import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { CompletitudCaso } from '../../dominio/mapeo';

type MarcoSituacional = NonNullable<CompletitudCaso['marcoSituacional']>;

export type CriterioExpediente = {
  clave: string;
  etiqueta: string;
  /** Id de la sección que completaría el faltante; `null` si no hay sección. */
  ancla: string | null;
  cumplido: boolean;
  detalle: string;
};

const CRITERIOS_MARCO: readonly { clave: keyof MarcoSituacional; etiqueta: string }[] = [
  { clave: 'consistencia', etiqueta: 'consistencia' },
  { clave: 'correspondencia', etiqueta: 'correspondencia' },
  { clave: 'coherenciaContextual', etiqueta: 'coherencia contextual' },
  { clave: 'saturacion', etiqueta: 'saturación' },
  { clave: 'trazabilidad', etiqueta: 'trazabilidad' },
];

function plural(cantidad: number, singular: string, plurales: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plurales}`;
}

function marcoDe(marco: CompletitudCaso['marcoSituacional']): {
  cumplido: boolean;
  detalle: string;
} {
  if (!marco) return { cumplido: false, detalle: 'Sin marco situacional' };

  const pendientes = CRITERIOS_MARCO.filter((criterio) => !marco[criterio.clave]).map(
    (criterio) => criterio.etiqueta,
  );
  if (pendientes.length === 0) {
    return { cumplido: true, detalle: 'Los cinco criterios de robustez se cumplen' };
  }
  return { cumplido: false, detalle: `Faltan: ${pendientes.join(', ')}` };
}

/**
 * Criterios del item 68 a partir de los conteos que ya llegan en el detalle.
 *
 * No se calcula ningún porcentaje ni puntuación y ningún faltante bloquea el
 * registro: sólo se declara qué dimensión está cubierta. «Cumplido» exige el
 * dato completo (por ejemplo, todos los actores con tipo y función); los
 * conteos parciales se muestran en el detalle.
 */
export function criteriosExpediente(completitud: CompletitudCaso): CriterioExpediente[] {
  const marco = marcoDe(completitud.marcoSituacional);
  const geografia = completitud.geografia;
  const detalleGeografia = geografia.tieneGeografia
    ? [
        plural(geografia.regiones, 'región', 'regiones'),
        geografia.distrito ? `distrito: ${geografia.distrito}` : null,
      ]
        .filter((parte): parte is string => parte !== null)
        .join(' · ')
    : 'Sin región ni distrito';

  return [
    {
      clave: 'hechos',
      etiqueta: 'Hechos',
      ancla: 'eventos-caso',
      cumplido: completitud.hechos.total > 0,
      detalle:
        completitud.hechos.total === 0
          ? 'Sin hechos registrados'
          : `${completitud.hechos.validados} de ${completitud.hechos.total} validados`,
    },
    {
      clave: 'actores',
      etiqueta: 'Actores con tipo y función',
      ancla: 'actores-caso',
      cumplido:
        completitud.actores.total > 0 &&
        completitud.actores.conTipoYFuncion >= completitud.actores.total,
      detalle:
        completitud.actores.total === 0
          ? 'Sin actores registrados'
          : `${completitud.actores.conTipoYFuncion} de ${completitud.actores.total} con tipo y función`,
    },
    {
      clave: 'demandas',
      etiqueta: 'Demandas con 3P completos',
      ancla: 'demandas-caso',
      cumplido:
        completitud.demandas.total > 0 &&
        completitud.demandas.con3PCompletos >= completitud.demandas.total,
      detalle:
        completitud.demandas.total === 0
          ? 'Sin demandas registradas'
          : `${completitud.demandas.con3PCompletos} de ${completitud.demandas.total} con 3P completos`,
    },
    {
      clave: 'geografia',
      etiqueta: 'Geografía',
      ancla: 'datos-caso',
      cumplido: geografia.tieneGeografia,
      detalle: detalleGeografia,
    },
    {
      clave: 'marco',
      etiqueta: 'Marco situacional',
      // La ficha todavía no tiene sección de marco situacional: se lista el
      // faltante sin enlace en lugar de apuntar a un destino que no existe.
      ancla: null,
      cumplido: marco.cumplido,
      detalle: marco.detalle,
    },
  ];
}

/**
 * Tarjeta de completitud del expediente (item 68).
 *
 * «Expediente: X de 5» cuenta criterios cubiertos con cinco dimensiones ya
 * persistidas y lista lo que falta con un salto a la sección correspondiente.
 */
@Component({
  selector: 'app-expediente-completitud',
  imports: [RouterLink],
  templateUrl: './expediente-completitud.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    .expediente {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
    }

    .expediente-cabecera {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .expediente-cabecera h2 {
      margin: 0;
      color: var(--ink);
      font: 700 11px var(--font-display);
    }

    .exp-completo {
      background: var(--green-pale);
      color: var(--green);
    }

    .exp-incompleto {
      background: var(--amber-pale);
      color: var(--amber);
    }

    .expediente-lista,
    .expediente-falta ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .expediente-lista {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .expediente-item {
      display: flex;
      align-items: flex-start;
      gap: 7px;
    }

    .expediente-marca {
      flex: none;
      width: 12px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      text-align: center;
    }

    .expediente-item--cumplido .expediente-marca {
      color: var(--green);
    }

    .expediente-texto {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .expediente-texto strong {
      color: var(--ink-2);
      font-size: 10px;
      font-weight: 600;
    }

    .expediente-texto small {
      color: var(--muted);
      font-size: 9px;
      line-height: 1.4;
    }

    .expediente-falta {
      padding-top: 9px;
      border-top: 1px solid var(--line);
    }

    .expediente-falta-titulo {
      display: block;
      color: var(--muted);
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .expediente-falta ul {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-top: 5px;
    }

    .expediente-falta a,
    .expediente-falta span {
      color: var(--ink-2);
      font-size: 10px;
      text-decoration: none;
    }

    .expediente-falta a {
      color: var(--blue);
    }

    .expediente-falta a:hover {
      text-decoration: underline;
    }

    .expediente-ok {
      margin: 0;
      color: var(--green);
      font-size: 10px;
    }

    .expediente-nota {
      margin: 0;
      color: var(--muted);
      font-size: 8.5px;
      line-height: 1.45;
    }
  `,
})
export class ExpedienteCompletitudComponent {
  readonly completitud = input.required<CompletitudCaso | null>();

  readonly criterios = computed<readonly CriterioExpediente[]>(() => {
    const completitud = this.completitud();
    return completitud ? criteriosExpediente(completitud) : [];
  });

  readonly cumplidos = computed(
    () => this.criterios().filter((criterio) => criterio.cumplido).length,
  );

  readonly faltantes = computed(() => this.criterios().filter((criterio) => !criterio.cumplido));
}
