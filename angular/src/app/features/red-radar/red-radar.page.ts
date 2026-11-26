import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import { urlConParametros } from '../../core/http/coleccion';
import { consulta } from '../../core/http/consulta';
import { aErrorApi } from '../../core/http/errores';
import { CapacidadesService } from '../../core/permisos/capacidades.service';
import { IconoComponent } from '../../shared/ui/icono.component';
import { PaginacionComponent } from '../../shared/ui/paginacion.component';
import {
  TerritorioBuscadorComponent,
  type OpcionTerritorio,
} from '../../shared/ui/territorio-buscador.component';
import {
  CLASE_ESTADO,
  ETIQUETAS_ESTADO,
  OPCIONES_FILTRO,
  clasePrioridad as claseDePrioridad,
  esEstadoTriaje,
  etiquetaPrioridad as etiquetaDePrioridad,
  fechaDdMmAaaa,
  normalizarCola,
  normalizarDetalle,
  regionesDeCatalogo,
  type DetalleRedRadar,
  type EstadoTriaje,
  type FuenteCola,
  type SenalVista,
  type TriajeCambios,
} from './red-radar.mapeo';
import { RedRadarService } from './red-radar.service';

type Filtros = {
  estado: EstadoTriaje | 'todas';
  region: number | null;
  distrito: number | null;
  desde: string;
  hasta: string;
  q: string;
  pagina: number;
  tamano: number;
};

const TAMANOS = [25, 50, 100] as const;

const FILTROS_VACIOS: Filtros = {
  estado: 'todas',
  region: null,
  distrito: null,
  desde: '',
  hasta: '',
  q: '',
  pagina: 1,
  tamano: 25,
};

const FUENTE_SIN_DATOS: FuenteCola = { senalesRecibidas: null, conFuenteRadar: 0 };

function enteroPositivo(valor: string | null): number | null {
  if (!valor) return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function fechaIsoParam(valor: string | null): string {
  return valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : '';
}

function estadoParam(valor: string | null): EstadoTriaje | 'todas' {
  return esEstadoTriaje(valor) ? valor : 'todas';
}

function tamanoParam(valor: string | null): number {
  const numero = enteroPositivo(valor);
  return numero !== null && (TAMANOS as readonly number[]).includes(numero) ? numero : 25;
}

/**
 * Bandeja RED-RADAR · señales.
 *
 * Cola de alertas tempranas pendientes de triaje con el estado persistido en
 * `core.alerta_triaje`. No existe tabla de señales ni conector RED-RADAR: la
 * cola se alimenta de `core.alertas_tempranas` y el código mostrado es el de la
 * alerta, no el de una señal. Todo lo que la base no declara se muestra «—» o
 * «sin dato»; aquí no se rellena ningún hueco.
 *
 * El estado de la pantalla vive en la URL (`?estado&region&distrito&desde&
 * hasta&q&pagina&tamano`), igual que en el resto de listados: recargar conserva
 * el filtro y el enlace se puede compartir.
 */
@Component({
  selector: 'app-red-radar-page',
  imports: [IconoComponent, PaginacionComponent, TerritorioBuscadorComponent],
  templateUrl: './red-radar.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }

    code {
      padding: 0 3px;
      border-radius: 3px;
      background: color-mix(in srgb, var(--ink) 8%, var(--paper));
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.92em;
    }

    /* Encabezado ------------------------------------------------------ */
    .eyebrow {
      margin: 0 0 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .nota-fuente {
      margin: 0;
      padding: 9px 12px;
      border: 1px solid color-mix(in srgb, var(--amber) 32%, transparent);
      border-radius: 9px;
      background: var(--amber-pale);
      color: var(--ink-2);
      font-size: 11.5px;
      line-height: 1.55;
    }

    .nota-fuente b {
      color: var(--ink);
    }

    .rr-aviso,
    .rr-error {
      margin: 0;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.5;
    }

    .rr-aviso {
      border: 1px solid color-mix(in srgb, var(--green) 35%, transparent);
      background: var(--green-pale);
      color: var(--green);
    }

    .rr-error {
      border: 1px solid color-mix(in srgb, var(--red) 35%, transparent);
      background: var(--red-pale);
      color: var(--red);
    }

    /* Secciones ------------------------------------------------------- */
    .rr-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .section-head h2 {
      margin: 0 0 3px;
      color: var(--ink);
      font: 700 14px/1.35 var(--font-display);
    }

    .section-head p {
      margin: 0;
      max-width: 84ch;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.55;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      height: 26px;
      padding: 0 10px;
      border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
      border-radius: 999px;
      background: var(--blue-pale);
      color: var(--blue);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .badge.warn {
      border-color: color-mix(in srgb, var(--red) 35%, transparent);
      background: var(--red-pale);
      color: var(--red);
    }

    /* Estado de la fuente -------------------------------------------- */
    .src-cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .src-card {
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper);
    }

    .src-card .lab {
      display: block;
      color: var(--ink-2);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .src-card .val {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin: 4px 0 3px;
      color: var(--ink);
      font: 700 24px/1.1 var(--font-display);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.5px;
    }

    .src-card .val .sig {
      color: var(--muted);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0;
    }

    .src-card .ori {
      margin: 0;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.45;
    }

    .src-card .ori .sin {
      color: var(--red);
      font-weight: 700;
    }

    /* Panel, barra de filtros ---------------------------------------- */
    .panel {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper);
      overflow: hidden;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--ink) 3%, var(--paper));
    }

    .chip {
      padding: 5px 11px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--paper);
      color: var(--ink-2);
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }

    .chip:hover {
      border-color: color-mix(in srgb, var(--blue) 40%, var(--line));
    }

    .chip[aria-pressed='true'] {
      border-color: var(--blue);
      background: var(--blue-pale);
      color: var(--blue);
      font-weight: 600;
    }

    .count {
      margin-left: 5px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }

    .filtros {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--ink) 2%, var(--paper));
    }

    .filtro-campo {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 130px;
    }

    .filtro-campo > span {
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.03em;
    }

    .filtro-campo select,
    .filtro-campo input {
      height: 30px;
      padding: 4px 8px;
      border: 1px solid color-mix(in srgb, var(--ink) 16%, var(--paper));
      border-radius: 6px;
      background: var(--paper);
      color: var(--ink);
      font: inherit;
      font-size: 11.5px;
    }

    .filtro-campo select:focus-visible,
    .filtro-campo input:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 1px;
    }

    .filtro-territorio {
      flex: 1 1 220px;
      min-width: 200px;
    }

    .buscador {
      flex: 1 1 var(--search-ancho-min);
      min-width: var(--search-ancho-min);
    }

    .buscador-caja {
      position: relative;
      display: flex;
      align-items: center;
    }

    .buscador-caja app-icono {
      position: absolute;
      left: 9px;
      color: var(--muted);
      pointer-events: none;
    }

    /* Mismo alto y radio que la barra global: la caja es propia porque el
       icono va en absoluto, pero comparte el token. */
    .buscador-caja input {
      width: 100%;
      height: var(--search-alto);
      padding-left: 30px;
      border-radius: 6px;
      font-size: 13px;
    }

    .buscador-caja input:focus-visible {
      border-color: var(--blue);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 22%, transparent);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      padding: 6px 12px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--paper);
      color: var(--ink-2);
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--blue) 40%, var(--line));
      color: var(--ink);
    }

    .btn.primary {
      border-color: var(--blue);
      background: var(--blue);
      color: var(--paper);
    }

    .btn.primary:hover:not(:disabled) {
      border-color: var(--blue-dark);
      background: var(--blue-dark);
    }

    .btn:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .btn.limpiar {
      align-self: flex-end;
      height: 30px;
    }

    /* Tabla de la cola ----------------------------------------------- */
    .tabla-scroll {
      overflow-x: auto;
    }

    table.q {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }

    table.q caption {
      padding: 9px 12px;
      caption-side: top;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--ink) 3%, var(--paper));
      color: var(--muted);
      font-size: 10.5px;
      text-align: left;
    }

    table.q th {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      color: var(--ink-2);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-align: left;
      text-transform: uppercase;
      white-space: nowrap;
    }

    table.q td {
      padding: 10px;
      border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, var(--paper));
      vertical-align: top;
      line-height: 1.45;
    }

    table.q tbody tr {
      cursor: pointer;
    }

    table.q tbody tr:last-child td {
      border-bottom: 0;
    }

    table.q tbody tr:hover td {
      background: color-mix(in srgb, var(--ink) 4%, var(--paper));
    }

    table.q tbody tr.sel td {
      background: var(--blue-pale);
      box-shadow: inset 3px 0 0 var(--blue);
    }

    table.q tbody tr:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: -2px;
    }

    .code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10.5px;
      color: var(--ink);
    }

    .sub {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 10px;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      padding: 1px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--paper);
      font-size: 9.5px;
      font-weight: 600;
      white-space: nowrap;
    }

    .t-crit {
      border-color: color-mix(in srgb, var(--red) 40%, transparent);
      background: var(--red-pale);
      color: var(--red);
    }

    .t-alta,
    .t-pend {
      border-color: color-mix(in srgb, var(--amber) 45%, transparent);
      background: var(--amber-pale);
      color: var(--amber);
    }

    .t-media,
    .t-triage {
      border-color: color-mix(in srgb, var(--blue) 40%, transparent);
      background: var(--blue-pale);
      color: var(--blue);
    }

    .t-baja {
      border-color: var(--line);
      background: color-mix(in srgb, var(--ink) 6%, var(--paper));
      color: var(--muted);
    }

    .t-conv {
      border-color: color-mix(in srgb, var(--green) 40%, transparent);
      background: var(--green-pale);
      color: var(--green);
    }

    .t-desc,
    .t-dup {
      border-color: var(--line);
      background: color-mix(in srgb, var(--ink) 6%, var(--paper));
      color: var(--ink-2);
    }

    .motivo {
      display: block;
      margin-top: 3px;
      padding-top: 3px;
      border-top: 1px dotted color-mix(in srgb, var(--ink) 18%, var(--paper));
      color: var(--ink-2);
      font-size: 10px;
    }

    .motivo b {
      color: var(--ink);
    }

    .nd {
      color: var(--muted);
      font-style: italic;
    }

    .pie-tabla {
      display: flex;
      justify-content: flex-end;
      padding: 10px 12px;
      border-top: 1px solid var(--line);
      background: color-mix(in srgb, var(--ink) 2%, var(--paper));
    }

    /* Estado vacío / carga ------------------------------------------- */
    .empty-state {
      display: grid;
      grid-template-columns: 46px 1fr;
      gap: 14px;
      padding: 22px;
      border-top: 1px solid var(--line);
      background: color-mix(in srgb, var(--ink) 2%, var(--paper));
      text-align: left;
    }

    .empty-state .ico {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 46px;
      height: 46px;
      border-radius: 12px;
      background: var(--amber-pale);
      color: var(--amber);
    }

    .empty-state h3 {
      margin: 0 0 4px;
      color: var(--ink);
      font: 700 14px/1.4 var(--font-display);
    }

    .empty-state p {
      margin: 0 0 6px;
      color: var(--ink-2);
      font-size: 11.5px;
      line-height: 1.55;
    }

    .empty-state ul {
      margin: 0;
      padding-left: 18px;
      color: var(--ink-2);
      font-size: 11px;
      line-height: 1.55;
    }

    .vacio-panel {
      margin: 0;
      padding: 18px;
      border: 1px dashed color-mix(in srgb, var(--ink) 20%, var(--paper));
      border-radius: 10px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
    }

    /* Split cola + panel de triaje ---------------------------------- */
    .split {
      display: grid;
      grid-template-columns: 250px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .ctx {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper);
      overflow: hidden;
    }

    .ctx h3 {
      padding: 9px 12px;
      margin: 0;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--ink) 3%, var(--paper));
      color: var(--ink);
      font: 700 9px/1.3 var(--font-display);
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .ctx ul {
      margin: 0;
      padding: 6px;
      list-style: none;
    }

    .ctx li {
      margin: 0 0 4px;
    }

    .ctx button {
      display: block;
      width: 100%;
      padding: 7px 9px;
      border: 1px solid transparent;
      border-radius: 7px;
      background: transparent;
      color: var(--ink);
      font: inherit;
      font-size: 11px;
      text-align: left;
      cursor: pointer;
    }

    .ctx button:hover {
      background: color-mix(in srgb, var(--ink) 4%, var(--paper));
    }

    .ctx button[aria-current='true'] {
      border-color: var(--blue);
      background: var(--blue-pale);
      box-shadow: inset 3px 0 0 var(--blue);
    }

    .ctx button .cd {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
    }

    .ctx button .st {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 9.5px;
    }

    .drawer {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper);
      overflow: hidden;
    }

    .drawer-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 14px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--ink) 3%, var(--paper));
    }

    .drawer-head .t {
      color: var(--ink);
      font: 700 13px/1.3 var(--font-display);
    }

    .drawer-head .s {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
    }

    .drawer-acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }

    .x {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--paper);
      color: var(--muted);
      cursor: pointer;
    }

    .x:hover {
      color: var(--ink);
    }

    .drawer-body {
      padding: 12px 14px;
    }

    .block + .block {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }

    .block h3 {
      margin: 0 0 6px;
      color: var(--ink);
      font: 700 9px/1.3 var(--font-display);
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }

    .kv {
      display: grid;
      grid-template-columns: 132px minmax(0, 1fr);
      gap: 4px 12px;
      margin: 0;
      font-size: 11px;
      line-height: 1.45;
    }

    .kv dt {
      color: var(--muted);
    }

    .kv dd {
      margin: 0;
      color: var(--ink);
      overflow-wrap: anywhere;
    }

    .kv dd a {
      color: var(--blue);
    }

    .sub-inline {
      color: var(--muted);
    }

    .suggest {
      padding: 10px 12px;
      border: 1px solid color-mix(in srgb, var(--amber) 40%, transparent);
      border-radius: 8px;
      background: var(--amber-pale);
    }

    .tag-sug {
      display: inline-flex;
      align-items: center;
      padding: 1px 7px;
      margin-bottom: 6px;
      border: 1px solid color-mix(in srgb, var(--amber) 55%, transparent);
      border-radius: 999px;
      background: var(--paper);
      color: color-mix(in srgb, var(--amber) 72%, var(--ink));
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .suggest p {
      margin: 0 0 6px;
      color: color-mix(in srgb, var(--amber) 72%, var(--ink));
      font-size: 10.5px;
      line-height: 1.5;
    }

    .suggest ul {
      margin: 0;
      padding-left: 18px;
      color: color-mix(in srgb, var(--amber) 72%, var(--ink));
      font-size: 10.5px;
      line-height: 1.55;
    }

    .decisions {
      display: grid;
      gap: 10px;
    }

    .decision {
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: var(--paper);
    }

    .decision.on {
      border-color: var(--blue);
      box-shadow: inset 0 0 0 1px var(--blue);
    }

    .decision h4 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px;
      color: var(--ink);
      font-size: 11.5px;
    }

    .decision h4 .num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--blue);
      color: var(--paper);
      font-size: 9.5px;
      font-weight: 700;
    }

    .decision form {
      display: grid;
      gap: 8px;
    }

    .field {
      display: grid;
      gap: 3px;
    }

    .field label {
      color: var(--ink-2);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.03em;
    }

    .field .hint {
      color: var(--muted);
      font-size: 9.5px;
    }

    .field input,
    .field textarea {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid color-mix(in srgb, var(--ink) 18%, var(--paper));
      border-radius: 6px;
      background: var(--paper);
      color: var(--ink);
      font: inherit;
      font-size: 11px;
    }

    .field textarea {
      min-height: 52px;
      resize: vertical;
    }

    .field input:focus-visible,
    .field textarea:focus-visible {
      outline: 2px solid var(--blue);
      outline-offset: 1px;
    }

    .field input:disabled,
    .field textarea:disabled {
      opacity: 0.6;
    }

    .note-inline {
      margin: 8px 0 0;
      color: var(--ink-2);
      font-size: 10.5px;
      line-height: 1.5;
    }

    .note-inline b {
      color: var(--ink);
    }

    /* Qué falta ------------------------------------------------------ */
    .gap-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .gap-card {
      padding: 12px 14px;
      border: 1px solid color-mix(in srgb, var(--amber) 40%, transparent);
      border-radius: 10px;
      background: var(--amber-pale);
    }

    .gap-card .k {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      margin-bottom: 6px;
      border-radius: 50%;
      background: var(--amber);
      color: var(--paper);
      font-size: 10px;
      font-weight: 700;
    }

    .gap-card strong {
      display: block;
      margin-bottom: 4px;
      color: var(--ink);
      font-size: 12px;
    }

    .gap-card p {
      margin: 0 0 6px;
      color: var(--ink-2);
      font-size: 10.5px;
      line-height: 1.5;
    }

    .gap-card .item {
      color: color-mix(in srgb, var(--amber) 72%, var(--ink));
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .foot {
      margin: 0;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 10px;
      line-height: 1.5;
    }

    @media (max-width: 900px) {
      .src-cards,
      .gap-grid {
        grid-template-columns: 1fr;
      }

      .split {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class RedRadarPage {
  private readonly ruta = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly servicio = inject(RedRadarService);
  private readonly capacidades = inject(CapacidadesService);
  private readonly destruccion = inject(DestroyRef);

  readonly etiquetasEstado = ETIQUETAS_ESTADO;
  readonly clasesEstado = CLASE_ESTADO;
  readonly opcionesFiltro = OPCIONES_FILTRO;
  readonly clasePrioridad = claseDePrioridad;
  readonly etiquetaPrioridad = etiquetaDePrioridad;
  readonly fechaTriaje = fechaDdMmAaaa;

  readonly aviso = signal<string | null>(null);
  readonly errorAccion = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly seleccionado = signal<string | null>(null);

  readonly motivoDescarte = signal('');
  readonly codigoDuplicada = signal('');
  readonly motivoDuplicada = signal('');

  /** Distrito elegido en esta sesión, para que el buscador muestre su ruta. */
  readonly distritoElegido = signal<{ id: number; nombre: string; ruta: string } | null>(null);
  /** Cambia para recrear el buscador al limpiar el filtro territorial. */
  readonly generacionBuscador = signal(0);
  readonly generacionesBuscador = computed(() => [{ id: this.generacionBuscador() }]);

  private temporizadorBusqueda: ReturnType<typeof setTimeout> | null = null;

  /** Filtros normalizados desde la URL; lo desconocido cae en el valor por defecto. */
  private readonly parametros = toSignal(
    this.ruta.queryParamMap.pipe(
      map(
        (params): Filtros => ({
          estado: estadoParam(params.get('estado')),
          region: enteroPositivo(params.get('region')),
          distrito: enteroPositivo(params.get('distrito')),
          desde: fechaIsoParam(params.get('desde')),
          hasta: fechaIsoParam(params.get('hasta')),
          q: (params.get('q') ?? '').trim(),
          pagina: enteroPositivo(params.get('pagina')) ?? 1,
          tamano: tamanoParam(params.get('tamano')),
        }),
      ),
    ),
    { initialValue: FILTROS_VACIOS },
  );

  readonly filtros = this.parametros;

  private readonly recursoCola = consulta({
    fuente: () => {
      const filtros = this.filtros();
      return urlConParametros(urlApi('/v1/red-radar'), {
        estado: filtros.estado === 'todas' ? null : filtros.estado,
        region: filtros.region,
        distrito: filtros.distrito,
        desde: filtros.desde || null,
        hasta: filtros.hasta || null,
        q: filtros.q || null,
        pagina: filtros.pagina,
        tamano: filtros.tamano,
      });
    },
    esquema: normalizarCola,
  });

  private readonly recursoRegiones = consulta({
    fuente: () => urlApi('/v1/catalogs'),
    esquema: regionesDeCatalogo,
  });

  private readonly recursoDetalle = consulta<DetalleRedRadar | null>({
    fuente: () => {
      const codigo = this.seleccionado();
      return codigo ? urlApi(`/v1/red-radar/${encodeURIComponent(codigo)}`) : null;
    },
    esquema: normalizarDetalle,
  });

  readonly cola = this.recursoCola.valor;
  readonly elementos = computed(() => this.cola()?.elementos ?? []);
  readonly regiones = computed(() => this.recursoRegiones.valor() ?? []);
  readonly fuente = computed<FuenteCola>(() => this.cola()?.fuente ?? FUENTE_SIN_DATOS);

  readonly cargando = computed(
    () => this.recursoCola.estado() === 'cargando' || this.recursoCola.estado() === 'inactivo',
  );
  readonly error = computed(() => this.recursoCola.error()?.message ?? null);
  readonly sinRegistros = computed(() => (this.cola()?.total ?? 0) === 0);

  readonly hayFiltros = computed(() => {
    const filtros = this.filtros();
    return (
      filtros.estado !== 'todas' ||
      filtros.region !== null ||
      filtros.distrito !== null ||
      filtros.desde !== '' ||
      filtros.hasta !== '' ||
      filtros.q !== ''
    );
  });

  /** Evita pintar el detalle de la fila anterior mientras llega el nuevo. */
  readonly senalActual = computed<SenalVista | null>(() => {
    const codigo = this.seleccionado();
    if (!codigo) return null;
    const detalle = this.recursoDetalle.valor();
    if (detalle && detalle.senal.codigo === codigo) return detalle.senal;
    return this.elementos().find((senal) => senal.codigo === codigo) ?? null;
  });

  /**
   * Distrito ya elegido, para restaurar la etiqueta del buscador. Se resuelve
   * con la selección de esta sesión o con una fila de la cola; si el filtro no
   * está en la página actual, se deja vacío en vez de inventar un nombre.
   */
  readonly distritoInicial = computed<{ id: number; nombre: string; ruta?: string } | null>(() => {
    const id = this.filtros().distrito;
    if (id === null) return null;
    const elegido = this.distritoElegido();
    if (elegido && elegido.id === id) return elegido;
    const fila = this.elementos().find((senal) => senal.distritoId === id && senal.distrito);
    if (!fila || !fila.distrito) return null;
    return { id, nombre: fila.distrito, ruta: fila.distritoRuta ?? fila.distrito };
  });

  readonly puedeTriar = (senal: SenalVista): boolean =>
    this.capacidades.puedeModificar(senal.clasificacion);

  readonly motivoSinPermiso =
    'Este perfil no registra triaje sobre la alerta: se requiere permiso de escritura y una clasificación dentro del alcance.';

  constructor() {
    this.destruccion.onDestroy(() => {
      if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    });
  }

  /* ------------------------------------------------------------------ *
   * Helpers de plantilla
   * ------------------------------------------------------------------ */

  /** Contador de los chips; «—» mientras la cola no tenga conteos. */
  contar(valor: EstadoTriaje | 'todas'): string {
    const conteos = this.cola()?.conteos;
    if (!conteos) return '—';
    if (valor === 'todas') return String(conteos.total);
    return String(conteos[valor]);
  }

  esSeleccionada(senal: SenalVista): boolean {
    return this.seleccionado() === senal.codigo;
  }

  /* ------------------------------------------------------------------ *
   * Navegación (filtros en la URL)
   * ------------------------------------------------------------------ */

  private navegar(cambios: Record<string, string | number | null>): void {
    void this.router.navigate([], {
      relativeTo: this.ruta,
      queryParams: cambios,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  cambiarEstado(valor: EstadoTriaje | 'todas'): void {
    if (valor === this.filtros().estado) return;
    this.navegar({ estado: valor === 'todas' ? null : valor, pagina: null });
  }

  cambiarRegion(evento: Event): void {
    const id = enteroPositivo((evento.target as HTMLSelectElement).value);
    this.distritoElegido.set(null);
    this.generacionBuscador.update((generacion) => generacion + 1);
    this.navegar({ region: id, distrito: null, pagina: null });
  }

  elegirDistrito(opcion: OpcionTerritorio | null): void {
    if (!opcion || opcion.tipo !== 'distrito') {
      this.distritoElegido.set(null);
      this.navegar({ distrito: null, pagina: null });
      return;
    }
    this.distritoElegido.set({ id: opcion.id, nombre: opcion.nombre, ruta: opcion.ruta });
    this.navegar({ distrito: opcion.id, pagina: null });
  }

  alTeclearBusqueda(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      this.temporizadorBusqueda = null;
      // Sin `trim`: el valor se refleja en el `<input>`; el repositorio recorta.
      this.navegar({ q: valor || null, pagina: null });
    }, 350);
  }

  cambiarDesde(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.navegar({ desde: valor || null, pagina: null });
  }

  cambiarHasta(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.navegar({ hasta: valor || null, pagina: null });
  }

  cambiarPagina(pagina: number): void {
    this.navegar({ pagina });
  }

  cambiarTamano(tamano: number): void {
    if (!(TAMANOS as readonly number[]).includes(tamano)) return;
    this.navegar({ tamano, pagina: 1 });
  }

  limpiar(): void {
    if (this.temporizadorBusqueda) {
      clearTimeout(this.temporizadorBusqueda);
      this.temporizadorBusqueda = null;
    }
    this.distritoElegido.set(null);
    this.generacionBuscador.update((generacion) => generacion + 1);
    this.navegar({
      estado: null,
      region: null,
      distrito: null,
      desde: null,
      hasta: null,
      q: null,
      pagina: null,
    });
  }

  recargar(): void {
    this.recursoCola.recargar();
    this.recursoDetalle.recargar();
  }

  /* ------------------------------------------------------------------ *
   * Selección y triaje
   * ------------------------------------------------------------------ */

  seleccionar(senal: SenalVista): void {
    if (this.seleccionado() === senal.codigo) return;
    this.seleccionado.set(senal.codigo);
    this.limpiarFormularios();
  }

  cerrarPanel(): void {
    this.seleccionado.set(null);
  }

  private limpiarFormularios(): void {
    this.motivoDescarte.set('');
    this.codigoDuplicada.set('');
    this.motivoDuplicada.set('');
    this.aviso.set(null);
    this.errorAccion.set(null);
  }

  marcarEnTriage(): void {
    this.enviar({ estado: 'en_triage' }, 'Alerta marcada en triaje.');
  }

  confirmar(): void {
    this.enviar({ estado: 'confirmada' }, 'Alerta confirmada.');
  }

  descartar(evento: Event): void {
    evento.preventDefault();
    const motivo = this.motivoDescarte().trim();
    if (!motivo) {
      this.errorAccion.set('El motivo del descarte es obligatorio.');
      return;
    }
    this.enviar({ estado: 'descartada', motivo }, 'Alerta descartada con motivo.');
  }

  marcarDuplicada(evento: Event): void {
    evento.preventDefault();
    const motivo = this.motivoDuplicada().trim();
    if (!motivo) {
      this.errorAccion.set('El motivo de la duplicidad es obligatorio.');
      return;
    }
    const codigo = this.codigoDuplicada().trim();
    this.enviar(
      { estado: 'duplicada', motivo, duplicadaDeCodigo: codigo || undefined },
      'Alerta marcada como duplicada.',
    );
  }

  devolverPendiente(): void {
    this.enviar({ estado: 'pendiente' }, 'Alerta devuelta a pendiente.');
  }

  private enviar(cambios: TriajeCambios, mensaje: string): void {
    const senal = this.senalActual();
    if (!senal || this.guardando() || !this.puedeTriar(senal)) return;

    this.guardando.set(true);
    this.errorAccion.set(null);
    this.aviso.set(null);

    this.servicio.registrarTriaje(senal.codigo, cambios).subscribe({
      next: () => {
        this.guardando.set(false);
        this.motivoDescarte.set('');
        this.codigoDuplicada.set('');
        this.motivoDuplicada.set('');
        this.aviso.set(mensaje);
        this.recargar();
      },
      error: (fallo: unknown) => {
        this.guardando.set(false);
        this.errorAccion.set(aErrorApi(fallo).message);
      },
    });
  }
}
