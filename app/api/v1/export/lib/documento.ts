import { generarPdf, type TablaPdf } from "@/lib/export/pdf";
import { escribirXlsx, type HojaXlsx } from "@/lib/export/xlsx";

/**
 * Documentos oficiales imprimibles (anexos OAIPCS).
 *
 * Un solo módulo arma el HTML autocontenido (CSS embebido, sin CDN, sin
 * scripts), el PDF y el XLSX de los anexos. El estándar de forma es el de los
 * mockups de `docs/07_frontend/mockups`: membrete institucional con el escudo
 * del Perú, título centrado en mayúsculas, metadata con línea punteada y pie
 * «DOCUMENTO OFICIAL OAIPCS — SISTEMA AVISA PRODUCE» con fecha de Lima y usuario.
 *
 * Regla de dato ausente: en HTML una celda sin dato dice `—`; en PDF y XLSX
 * queda vacía. Nunca se rellena con un valor estimado.
 *
 * Este módulo vive bajo `app/api/v1/export/` porque es material de esa familia
 * de rutas; no es una ruta de Next (no hay `route.ts` aquí).
 */

export type Orientacion = "portrait" | "landscape";

export type ColumnaDocumento = {
  titulo: string;
  /** Peso relativo del ancho. Se reparte entre todas las columnas. */
  ancho?: number;
  alineacion?: "izquierda" | "centro" | "derecha";
  /** Marca celdas con formato especial (`codigo`, `fecha`, `numero`). */
  tipo?: string;
};

export type TablaDocumento = {
  /** Texto que se muestra si no hay filas. */
  vacia?: string;
  columnas: readonly ColumnaDocumento[];
  /** Cada celda es texto plano; el render la escapa. `null` → `—`. */
  filas: readonly (readonly (string | number | null | undefined)[])[];
};

export type BloqueDocumento =
  | { tipo: "parrafos"; titulo?: string; texto: string | null }
  | { tipo: "tabla"; titulo?: string; tabla: TablaDocumento }
  | {
      tipo: "definiciones";
      titulo?: string;
      items: readonly { etiqueta: string; valor: string | null | undefined }[];
    };

export type DocumentoAnexo = {
  /** Título oficial, en mayúsculas en la hoja. */
  titulo: string;
  subtitulo?: string | null;
  /** `Anexo N° 15`, usado en el pie y en el nombre del archivo. */
  referencia?: string;
  orientacion?: Orientacion;
  meta: readonly { etiqueta: string; valor: string | null | undefined }[];
  bloques: readonly BloqueDocumento[];
  /** Campos del formato oficial sin fuente en la base. */
  faltantes?: readonly string[];
  /** Notas de generación (no forman parte del formato oficial). */
  notas?: readonly string[];
};

export type ContextoDocumento = {
  usuario: string;
  cargo?: string | null;
  area?: string | null;
  generadoEn: Date;
};

/* ------------------------------------------------------------------------- *
 * Texto y fechas
 * ------------------------------------------------------------------------- */

const VACIOS = new Set(["", "null", "undefined", "nan"]);

/** Escapa todo texto que venga de la base antes de meterlo en HTML. */
export function escaparHtml(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texto limpio o `null`; los blancos y los «null» de texto no son dato. */
export function textoPlano(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).replace(/\s+/g, " ").trim();
  if (!texto || VACIOS.has(texto.toLowerCase())) return null;
  return texto;
}

/** Celda: el dato limpio o `—` cuando no hay fuente. */
export function celda(valor: unknown): string {
  return textoPlano(valor) ?? "—";
}

type PartesFecha = { dia: string; mes: string; anio: string };

const FORMATO_LIMA = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function partesEnLima(fecha: Date): (PartesFecha & { hora: string; minuto: string }) | null {
  if (Number.isNaN(fecha.getTime())) return null;
  const partes = FORMATO_LIMA.formatToParts(fecha);
  const leer = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";
  return {
    dia: leer("day"),
    mes: leer("month"),
    anio: leer("year"),
    hora: leer("hour"),
    minuto: leer("minute"),
  };
}

/**
 * `dd/mm/aaaa`. Una fecha sin hora (`YYYY-MM-DD`) se reformatea tal cual para
 * no correrla de día; un `timestamptz` se convierte a la hora de Lima, que es
 * la zona de registro del sistema.
 */
export function fechaDdMmAaaa(valor: string | Date | null | undefined): string {
  if (!valor) return "";
  if (valor instanceof Date) {
    const partes = partesEnLima(valor);
    return partes ? `${partes.dia}/${partes.mes}/${partes.anio}` : "";
  }

  const texto = valor.trim();
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (soloFecha) return `${soloFecha[3]}/${soloFecha[2]}/${soloFecha[1]}`;

  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return "";
  const partes = partesEnLima(fecha);
  return partes ? `${partes.dia}/${partes.mes}/${partes.anio}` : "";
}

/** Celda de fecha: `dd/mm/aaaa` o `—`. */
export function fechaCelda(valor: string | Date | null | undefined): string {
  return fechaDdMmAaaa(valor) || "—";
}

/** `dd/mm/aaaa HH:mm` en hora de Lima. */
export function fechaHoraLima(fecha: Date): string {
  const partes = partesEnLima(fecha);
  if (!partes) return "";
  return `${partes.dia}/${partes.mes}/${partes.anio} ${partes.hora}:${partes.minuto}`;
}

/** `aaaa-mm-dd` de hoy en Lima, para nombres de archivo estables. */
export function fechaArchivo(fecha: Date): string {
  const partes = partesEnLima(fecha);
  return partes ? `${partes.anio}-${partes.mes}-${partes.dia}` : fecha.toISOString().slice(0, 10);
}

/**
 * Quita emojis y símbolos decorativos. El generador de PDF usa Helvetica
 * WinAnsi y translitera a `?` cualquier carácter fuera de Latin-1, así que en
 * PDF se evita el ruido antes de llegar a él.
 */
export function sinEmojis(texto: string): string {
  return texto
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/[\u{2190}-\u{21FF}]/gu, "->")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Un `—` de HTML se convierte en `-` para PDF/XLSX (sin inventar dato). */
function textoParaPdf(valor: unknown): string {
  const texto = textoPlano(valor);
  if (!texto) return "";
  return sinEmojis(texto.replace(/\u2014/g, "-").replace(/\u2013/g, "-"));
}

/* ------------------------------------------------------------------------- *
 * HTML
 * ------------------------------------------------------------------------- */

const CSS = `
  :root {
    --ink: #17283a;
    --ink-2: #33475b;
    --muted: #778797;
    --line: #e6ebef;
    --paper: #ffffff;
    --canvas: #f5f7f8;
    --blue: #2455a2;
    --blue-dark: #1d427f;
    --blue-pale: #eaf1fb;
    --teal: #397c79;
    --amber: #aa6a11;
    --amber-pale: #fff4e2;
    --red: #ad4d46;
    --red-pale: #fbeceb;
    --green: #34785b;
    --green-pale: #e9f5ef;
    --font-sans: "DM Sans", system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
    --font-mono: "SFMono-Regular", Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: var(--canvas);
    color: var(--ink-2);
    font-family: var(--font-sans);
    font-size: 9.5px;
    line-height: 1.35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .hoja {
    width: 1120px;
    max-width: 100%;
    margin: 18px auto;
    padding: 17mm 13mm 14mm;
    background: var(--paper);
    box-shadow: 0 4px 16px -2px rgba(15, 23, 42, .08), 0 2px 6px -2px rgba(15, 23, 42, .04);
  }

  .hoja--vertical { width: 760px; }

  /* Membrete institucional ------------------------------------------------ */
  .membrete {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 7px;
    border-bottom: 1px solid #cbd5e1;
  }
  .membrete-izq { display: flex; align-items: center; gap: 9px; }
  .escudo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: 1px solid #fecdd3;
    background: #fff1f2;
    padding: 2px;
  }
  .membrete-texto { display: flex; flex-direction: column; border-left: 1px solid #cbd5e1; padding-left: 7px; }
  .peru {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .05em;
    color: #be123c;
    line-height: 1.1;
  }
  .ministerio { font-size: 10px; font-weight: 600; color: var(--ink); line-height: 1.2; }
  .membrete-der { text-align: right; text-transform: uppercase; }
  .membrete-der span { display: block; }
  .membrete-der .oficina { font-size: 9.5px; font-weight: 700; letter-spacing: .03em; color: var(--ink); }
  .membrete-der .unidad { font-size: 9px; font-weight: 500; letter-spacing: -.01em; color: #475569; }

  /* Título ---------------------------------------------------------------- */
  .titulo-bloque { text-align: center; margin: 13px 0 10px; }
  .titulo {
    display: inline-block;
    margin: 0;
    padding-bottom: 2px;
    border-bottom: 2px solid #111827;
    font-family: var(--font-sans);
    font-size: 12.5px;
    font-weight: 800;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: #0f172a;
  }
  .subtitulo {
    margin: 6px 0 0;
    font-size: 9.5px;
    font-weight: 500;
    color: var(--muted);
  }

  /* Metadata -------------------------------------------------------------- */
  .meta {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px 18px;
    margin: 0 0 11px;
    padding: 0 2px;
  }
  .meta__item { display: flex; align-items: flex-end; gap: 5px; min-width: 0; }
  .meta__etq {
    flex: none;
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: .02em;
    color: var(--ink);
    text-transform: uppercase;
  }
  .meta__val {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 3px 1px;
    border-bottom: 1px dotted #94a3b8;
    font-size: 9px;
    font-weight: 400;
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }

  /* Bloques --------------------------------------------------------------- */
  .bloque { margin: 0 0 11px; }
  .bloque__titulo {
    margin: 0 0 5px;
    padding: 0 0 2px;
    border-bottom: 1px solid var(--line);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .prosa { margin: 0 0 5px; font-size: 9.5px; color: var(--ink-2); overflow-wrap: anywhere; }
  .prosa:last-child { margin-bottom: 0; }
  .prosa ul { margin: 2px 0 4px; padding-left: 15px; }
  .prosa li { margin: 0 0 2px; }

  .sin-dato { color: #94a3b8; font-style: italic; }
  .vacio { margin: 0; padding: 6px 8px; border: 1px dashed var(--line); color: #94a3b8; font-style: italic; }

  /* Tablas ---------------------------------------------------------------- */
  .tabla-marco { border: 1px solid #cbd5e1; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { background: var(--ink-2); }
  th {
    padding: 4px 5px;
    border: 1px solid #2a3c50;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: .03em;
    text-transform: uppercase;
    text-align: left;
    color: #fff;
    vertical-align: bottom;
  }
  td {
    padding: 4px 5px;
    border: 1px solid var(--line);
    font-size: 8.5px;
    color: var(--ink-2);
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  tbody tr { page-break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cen { text-align: center; }
  .celda-codigo { font-family: var(--font-mono); font-size: 8px; white-space: nowrap; }
  .celda-fecha { white-space: nowrap; }
  .estado-cumplido { color: var(--green); font-weight: 600; }
  .estado-alerta { color: var(--amber); font-weight: 600; }
  .estado-critico { color: var(--red); font-weight: 600; }

  .definiciones { display: grid; grid-template-columns: 190px minmax(0, 1fr); border-top: 1px solid var(--line); }
  .definiciones dt { margin: 0; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--line); font-size: 8.5px; font-weight: 700; color: var(--ink); text-transform: uppercase; letter-spacing: .02em; }
  .definiciones dd { margin: 0; padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 9px; color: var(--ink-2); overflow-wrap: anywhere; }

  /* Notas de generación --------------------------------------------------- */
  .notas {
    margin: 12px 0 0;
    padding: 8px 10px;
    border: 1px solid #f0d9b5;
    background: var(--amber-pale);
    color: #7c4a03;
    font-size: 8.5px;
  }
  .notas__titulo { margin: 0 0 3px; font-size: 8px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
  .notas ul { margin: 0; padding-left: 14px; }
  .notas li { margin: 0 0 2px; }

  /* Pie ------------------------------------------------------------------- */
  .pie {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 14px;
    padding-top: 5px;
    border-top: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 8px;
    color: var(--muted);
  }
  .pie__der { text-align: right; }

  @page { size: A4 landscape; margin: 11mm 10mm 14mm; }
  @page :first { margin-top: 9mm; }

  @media print {
    html, body { background: #fff; }
    .hoja {
      width: auto;
      max-width: none;
      margin: 0;
      padding: 0;
      box-shadow: none;
    }
    .pie { position: fixed; right: 0; bottom: 0; left: 0; margin-top: 0; background: #fff; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
`;

function escudoSvg(): string {
  return `<span class="escudo"><svg viewBox="0 0 36 36" width="28" height="28" role="img" aria-label="Escudo del Perú"><rect fill="#DC2626" width="12" height="36"></rect><rect fill="#FFFFFF" width="12" height="36" x="12"></rect><rect fill="#DC2626" width="12" height="36" x="24"></rect><circle cx="18" cy="18" fill="#D97706" r="5"></circle></svg></span>`;
}

function membreteHtml(): string {
  return `<header class="membrete">
  <div class="membrete-izq">
    ${escudoSvg()}
    <div class="membrete-texto">
      <span class="peru">PERÚ</span>
      <span class="ministerio">Ministerio de la Producción</span>
    </div>
  </div>
  <div class="membrete-der">
    <span class="oficina">Oficina de Articulación Intergubernamental</span>
    <span class="unidad">y Prevención de Conflictos Sociales</span>
  </div>
</header>`;
}

const PATRON_VINETA = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Párrafos: respeta saltos de línea y convierte líneas con viñeta en lista. */
function prosaHtml(texto: string | null): string {
  const limpio = (texto ?? "").replace(/\r\n?/g, "\n").trim();
  if (!limpio) return `<p class="vacio sin-dato">sin dato</p>`;

  const parrafos = limpio
    .split(/\n{2,}/)
    .map((bloque) => bloque.trim())
    .filter(Boolean);
  const html: string[] = [];

  for (const parrafo of parrafos) {
    const lineas = parrafo
      .split("\n")
      .map((linea) => linea.trim())
      .filter(Boolean);
    const conVineta = lineas.length > 1 && lineas.every((linea) => PATRON_VINETA.test(linea));

    if (conVineta) {
      const items = lineas
        .map((linea) => `<li>${escaparHtml(linea.replace(PATRON_VINETA, ""))}</li>`)
        .join("");
      html.push(`<div class="prosa"><ul>${items}</ul></div>`);
      continue;
    }

    const cuerpo = lineas.map((linea) => escaparHtml(linea.replace(PATRON_VINETA, ""))).join("<br>");
    html.push(`<p class="prosa">${cuerpo}</p>`);
  }

  return html.join("");
}

function alineacionClase(columna: ColumnaDocumento): "num" | "cen" | "" {
  if (columna.alineacion === "derecha") return "num";
  if (columna.alineacion === "centro") return "cen";
  return "";
}

function celdaClase(columna: ColumnaDocumento, valor: string): string {
  if (valor === "—") return "sin-dato";
  if (columna.tipo === "codigo") return "celda-codigo";
  if (columna.tipo === "fecha") return "celda-fecha";
  return "";
}

function claseEstado(valor: string): string {
  const normalizado = valor.toLowerCase();
  if (["cumplido", "cumplida", "atendida", "concluido"].includes(normalizado)) {
    return "estado-cumplido";
  }
  if (["vencido", "crítico", "critico", "crisis social"].includes(normalizado)) {
    return "estado-critico";
  }
  if (["en ejecución", "en ejecucion", "por vencer", "paralizado"].includes(normalizado)) {
    return "estado-alerta";
  }
  return "";
}

function tablaHtml(tabla: TablaDocumento, titulo?: string): string {
  const pesos = tabla.columnas.map((columna) =>
    columna.ancho && columna.ancho > 0 ? columna.ancho : 1,
  );
  const suma = pesos.reduce((total, peso) => total + peso, 0);
  const anchos = pesos.map((peso) => `${((peso / suma) * 100).toFixed(2)}%`);

  const colgroup = `<colgroup>${anchos.map((ancho) => `<col style="width:${ancho}">`).join("")}</colgroup>`;
  const cabeza = `<thead><tr>${tabla.columnas
    .map((columna) => {
      const clase = alineacionClase(columna);
      return `<th scope="col"${clase ? ` class="${clase}"` : ""}>${escaparHtml(columna.titulo)}</th>`;
    })
    .join("")}</tr></thead>`;

  let cuerpo: string;
  if (tabla.filas.length === 0) {
    const columnas = Math.max(1, tabla.columnas.length);
    cuerpo = `<tbody><tr><td colspan="${columnas}" class="sin-dato">${escaparHtml(
      tabla.vacia ?? "sin registros",
    )}</td></tr></tbody>`;
  } else {
    cuerpo = `<tbody>${tabla.filas
      .map((fila) => {
        const celdas = tabla.columnas
          .map((columna, indice) => {
            const valor = celda(fila[indice]);
            const clases = [celdaClase(columna, valor), claseEstado(valor)]
              .filter(Boolean)
              .join(" ");
            const alineacion = alineacionClase(columna);
            const atributo = [clases, alineacion]
              .filter(Boolean)
              .map((clase) => `class="${clase}"`)
              .join(" ");
            return `<td${atributo ? ` ${atributo}` : ""}>${
              valor === "—" ? "—" : escaparHtml(valor)
            }</td>`;
          })
          .join("");
        return `<tr>${celdas}</tr>`;
      })
      .join("")}</tbody>`;
  }

  return `<div class="bloque">
  ${titulo ? `<h2 class="bloque__titulo">${escaparHtml(titulo)}</h2>` : ""}
  <div class="tabla-marco"><table>${colgroup}${cabeza}${cuerpo}</table></div>
</div>`;
}

function definicionesHtml(
  items: readonly { etiqueta: string; valor: string | null | undefined }[],
  titulo?: string,
): string {
  const cuerpo = items
    .map((item) => {
      const valor = textoPlano(item.valor);
      return `<dt>${escaparHtml(item.etiqueta)}</dt><dd${
        valor ? "" : ' class="sin-dato"'
      }>${valor ? escaparHtml(valor) : "sin dato"}</dd>`;
    })
    .join("");

  return `<div class="bloque">
  ${titulo ? `<h2 class="bloque__titulo">${escaparHtml(titulo)}</h2>` : ""}
  <dl class="definiciones">${cuerpo}</dl>
</div>`;
}

function bloqueHtml(bloque: BloqueDocumento): string {
  if (bloque.tipo === "parrafos") {
    return `<div class="bloque">
  ${bloque.titulo ? `<h2 class="bloque__titulo">${escaparHtml(bloque.titulo)}</h2>` : ""}
  ${prosaHtml(bloque.texto)}
</div>`;
  }
  if (bloque.tipo === "definiciones") return definicionesHtml(bloque.items, bloque.titulo);
  return tablaHtml(bloque.tabla, bloque.titulo);
}

function notasHtml(doc: DocumentoAnexo): string {
  const notas = [...(doc.faltantes ?? []), ...(doc.notas ?? [])].filter((nota) => textoPlano(nota));
  if (notas.length === 0) return "";
  return `<aside class="notas">
  <p class="notas__titulo">Nota de generación · campos sin fuente en la base</p>
  <ul>${notas.map((nota) => `<li>${escaparHtml(nota)}</li>`).join("")}</ul>
</aside>`;
}

/** Documento HTML autocontenido, sin CDN ni scripts. */
export function documentoHtml(doc: DocumentoAnexo, contexto: ContextoDocumento): string {
  const orientacion = doc.orientacion ?? "landscape";
  const meta = doc.meta
    .map((item) => {
      const valor = textoPlano(item.valor);
      return `<div class="meta__item"><span class="meta__etq">${escaparHtml(
        item.etiqueta,
      )}</span><span class="meta__val${valor ? "" : " sin-dato"}">${
        valor ? escaparHtml(valor) : "—"
      }</span></div>`;
    })
    .join("");

  const usuario = textoPlano(contexto.usuario) ?? "usuario no identificado";
  const pieDerecha = `${fechaHoraLima(contexto.generadoEn)} (Lima) · ${usuario}`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escaparHtml(doc.titulo)}${doc.referencia ? ` · ${escaparHtml(doc.referencia)}` : ""}</title>
<style>${CSS}${orientacion === "portrait" ? "\n  @page { size: A4 portrait; }" : ""}</style>
</head>
<body>
<article class="hoja${orientacion === "portrait" ? " hoja--vertical" : ""}">
  ${membreteHtml()}
  <div class="titulo-bloque">
    <h1 class="titulo">${escaparHtml(doc.titulo)}</h1>
    ${doc.subtitulo ? `<p class="subtitulo">${escaparHtml(doc.subtitulo)}</p>` : ""}
  </div>
  <div class="meta">${meta}</div>
  <main>${doc.bloques.map(bloqueHtml).join("\n")}</main>
  ${notasHtml(doc)}
  <footer class="pie">
    <div class="pie__izq">DOCUMENTO OFICIAL OAIPCS — SISTEMA AVISA PRODUCE</div>
    <div class="pie__der">${escaparHtml(pieDerecha)}</div>
  </footer>
</article>
</body>
</html>`;
}

/* ------------------------------------------------------------------------- *
 * PDF y XLSX
 * ------------------------------------------------------------------------- */

function tablaPdfDesde(bloque: BloqueDocumento): TablaPdf | null {
  if (bloque.tipo === "parrafos") {
    const lineas = (bloque.texto ?? "")
      .replace(/\r\n?/g, "\n")
      .split(/\n{2,}/)
      .map((linea) => textoParaPdf(linea))
      .filter(Boolean);
    return {
      titulo: bloque.titulo,
      columnas: [{ titulo: "Detalle" }],
      filas: lineas.length > 0 ? lineas.map((linea) => [linea]) : [["sin dato"]],
    };
  }

  if (bloque.tipo === "definiciones") {
    return {
      titulo: bloque.titulo,
      columnas: [
        { titulo: "Campo", ancho: 3 },
        { titulo: "Valor", ancho: 7 },
      ],
      filas: bloque.items.map((item) => [textoParaPdf(item.etiqueta), textoParaPdf(item.valor)]),
    };
  }

  return {
    titulo: bloque.titulo,
    columnas: bloque.tabla.columnas.map((columna) => ({
      titulo: textoParaPdf(columna.titulo),
      ancho: columna.ancho && columna.ancho > 0 ? columna.ancho : 1,
    })),
    filas:
      bloque.tabla.filas.length > 0
        ? bloque.tabla.filas.map((fila) =>
            bloque.tabla.columnas.map((_, indice) => textoParaPdf(fila[indice])),
          )
        : [[bloque.tabla.vacia ?? "sin registros"]],
  };
}

/**
 * PDF con el generador propio del proyecto. Es A4 vertical fijo (el módulo
 * `lib/export/pdf.ts` no admite orientación); las tablas anchas se parten por
 * columna. Las celdas `—` salen como `-`.
 */
export function documentoPdf(doc: DocumentoAnexo, contexto: ContextoDocumento): Uint8Array {
  const meta: TablaPdf = {
    columnas: [
      { titulo: "Campo", ancho: 3 },
      { titulo: "Valor", ancho: 7 },
    ],
    filas: doc.meta.map((item) => [textoParaPdf(item.etiqueta), textoParaPdf(item.valor)]),
  };

  const tablas: TablaPdf[] = [meta];
  for (const bloque of doc.bloques) {
    const tabla = tablaPdfDesde(bloque);
    if (tabla) tablas.push(tabla);
  }

  const avisos = [...(doc.faltantes ?? []), ...(doc.notas ?? [])]
    .map((nota) => textoParaPdf(nota))
    .filter(Boolean);
  if (avisos.length > 0) {
    tablas.push({
      titulo: "Campos sin fuente",
      columnas: [{ titulo: "Detalle" }],
      filas: avisos.map((aviso) => [aviso]),
    });
  }

  return generarPdf({
    titulo: `${doc.referencia ? `${doc.referencia} · ` : ""}${doc.titulo}`,
    subtitulo: doc.subtitulo ?? undefined,
    generadoEn: contexto.generadoEn,
    tablas,
  });
}

/** Hoja XLSX de una tabla de documento. Celda sin dato queda vacía. */
export function tablaAExcel(tabla: TablaDocumento, nombre: string): HojaXlsx {
  const columnas = tabla.columnas.map((columna) => columna.titulo);
  const filas = tabla.filas.map((fila) => {
    const registro: Record<string, unknown> = {};
    tabla.columnas.forEach((columna, indice) => {
      registro[columna.titulo] = textoPlano(fila[indice]) ?? "";
    });
    return registro;
  });
  return { nombre, columnas, filas };
}

export function documentoXlsx(hojas: readonly HojaXlsx[]): Uint8Array {
  return escribirXlsx(hojas);
}

/* ------------------------------------------------------------------------- *
 * Respuestas HTTP
 * ------------------------------------------------------------------------- */

function disposicion(nombre: string, descarga: boolean): string {
  const tipo = descarga ? "attachment" : "inline";
  const ascii = nombre.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

function respuesta(
  cuerpo: string | Uint8Array,
  tipo: string,
  nombre: string,
  descarga: boolean,
): Response {
  return new Response(cuerpo as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": tipo,
      "Content-Disposition": disposicion(nombre, descarga),
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** HTML siempre `inline` salvo `descarga=true`, para previsualizar en iframe. */
export function respuestaHtml(html: string, nombre: string, descarga = false): Response {
  return respuesta(html, "text/html; charset=utf-8", nombre, descarga);
}

export function respuestaPdf(bytes: Uint8Array, nombre: string, descarga = true): Response {
  return respuesta(bytes, "application/pdf", nombre, descarga);
}

export function respuestaXlsx(bytes: Uint8Array, nombre: string, descarga = true): Response {
  return respuesta(
    bytes,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    nombre,
    descarga,
  );
}

export function respuestaTexto(texto: string, nombre: string, descarga = false): Response {
  return respuesta(texto, "text/plain; charset=utf-8", nombre, descarga);
}

/** Aviso legible cuando el formato pedido no está disponible para la ruta. */
export function respuestaErrorHtml(mensaje: string, generadoEn: Date): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>AVISA</title><style>body{margin:0;padding:32px;background:#f5f7f8;color:#33475b;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif}p{max-width:640px;margin:0 auto;padding:18px 20px;border:1px solid #e6ebef;background:#fff;font-size:13px;line-height:1.5}</style></head><body><p>${escaparHtml(
    mensaje,
  )}<br><br><span style="color:#778797;font-size:11px">Generado el ${escaparHtml(
    fechaHoraLima(generadoEn),
  )} (Lima).</span></p></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
