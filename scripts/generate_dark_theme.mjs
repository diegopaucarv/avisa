// Genera app/theme-dark.generated.css a partir de app/globals.css.
//
// El proyecto declara casi todos sus colores como literales (521 usos), no como
// variables. En vez de reescribir 310 clases a mano, este script recorre las
// reglas y produce una capa `html[data-theme="dark"] …` que redefine cada
// superficie/texto/borde hacia su equivalente oscuro según luminosidad.
//
// Uso:  node scripts/generate_dark_theme.mjs
//       node scripts/generate_dark_theme.mjs --check   (falla si está desfasado)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "app", "globals.css");
const TARGET = path.join(ROOT, "app", "theme-dark.generated.css");
const SCOPE = 'html[data-theme="dark"]';

const REFINEMENTS = `/* ── Ajustes manuales del tema oscuro ─────────────────────────────
   Casos que la transformación automática no puede deducir: estados
   hover (en claro oscurecen, en oscuro deben aclarar), scrollbars y
   teselas del mapa.
   ─────────────────────────────────────────────────────────────── */

html[data-theme="dark"] .side-nav:hover,
html[data-theme="dark"] .theme-option:hover,
html[data-theme="dark"] .scope-option:hover,
html[data-theme="dark"] .case-table-row:hover,
html[data-theme="dark"] .work-row:hover,
html[data-theme="dark"] .linked-row:hover,
html[data-theme="dark"] .tab-button:hover,
html[data-theme="dark"] .button-secondary:hover,
html[data-theme="dark"] .button-light:hover,
html[data-theme="dark"] .sidebar-context:hover,
html[data-theme="dark"] .header-icon-button:hover,
html[data-theme="dark"] .icon-button:hover,
html[data-theme="dark"] .search-close:hover,
html[data-theme="dark"] .global-results > button:hover {
    background-color: rgba(255, 255, 255, 0.06);
}

html[data-theme="dark"] ::selection {
    background: rgba(109, 159, 224, 0.32);
}

html[data-theme="dark"] .sidebar-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.16);
}
html[data-theme="dark"] .sidebar-scroll:hover::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.28);
}

/* Las teselas de OpenStreetMap son imágenes claras: se invierten para el tema oscuro. */
html[data-theme="dark"] .leaflet-tile-pane {
    filter: invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.9) saturate(0.6);
}
html[data-theme="dark"] .leaflet-container {
    background: #0c1117;
}
html[data-theme="dark"] .leaflet-bar a,
html[data-theme="dark"] .leaflet-control-attribution {
    background: #191e25;
    color: #a8b2be;
    border-color: #2b333d;
}
html[data-theme="dark"] .leaflet-bar a:hover {
    background: #222a33;
}
html[data-theme="dark"] .leaflet-popup-content-wrapper,
html[data-theme="dark"] .leaflet-popup-tip {
    background: #191e25;
    color: #dbe3ec;
}`;

const TOKENS = `/* ─────────────────────────────────────────────────────────────────────────────
   AVISA · tema oscuro (AUTOGENERADO por scripts/generate_dark_theme.mjs)
   No editar a mano: vuelve a ejecutar el script.
   ───────────────────────────────────────────────────────────────────────────── */

html[data-theme="dark"] {
    color-scheme: dark;
    --ink: #e3e9f0;
    --ink-2: #c2cfdc;
    --muted: #94a4b4;
    --line: #262c33;
    --paper: #191e25;
    --canvas: #0c1117;
    --blue: #6d9fe0;
    --blue-dark: #4f7fc4;
    --blue-pale: #17273c;
    --teal: #5aa8a2;
    --amber: #d9a85f;
    --amber-pale: #2c2317;
    --red: #e59189;
    --red-pale: #2d1c1b;
    --green: #72bb96;
    --green-pale: #14261e;
}`;

/* ── utilidades de color ─────────────────────────────────────────────────── */

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function parseColor(token) {
  const value = token.trim();
  if (value.startsWith("#")) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((char) => char + char)
        .join("");
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    if (!/^[0-9a-f]+$/i.test(hex)) return null;
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (raw) =>
      raw.endsWith("%")
        ? (Number.parseFloat(raw) / 100) * 255
        : Number.parseFloat(raw);
    const r = channel(parts[0]);
    const g = channel(parts[1]);
    const b = channel(parts[2]);
    const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a };
  }
  return null;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 215, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue(hn + 1 / 3) * 255),
    g: Math.round(hue(hn) * 255),
    b: Math.round(hue(hn - 1 / 3) * 255),
  };
}

const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

function formatColor({ h, s, l }, a) {
  const { r, g, b } = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
  if (a >= 0.999) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return `rgba(${clamp(Math.round(r), 0, 255)}, ${clamp(Math.round(g), 0, 255)}, ${clamp(Math.round(b), 0, 255)}, ${Number(a.toFixed(2))})`;
}

/* ── transformación de un color según la propiedad CSS ──────────────────── */

function darken(token, prop, ringShadow = false) {
  const rgb = parseColor(token);
  if (!rgb) return token;

  const { h, l } = rgbToHsl(rgb);
  const alpha = rgb.a;
  // Croma real (max - min): mide cuánto color hay, a diferencia de la
  // saturación HSL que exagera los tonos oscuros casi neutros.
  const chroma =
    (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;

  const isShadow = /shadow/.test(prop);
  const isBackground =
    prop === "background" ||
    prop === "background-color" ||
    prop === "background-image";
  const isBorder = /border|outline/.test(prop);
  const isText =
    prop === "color" ||
    prop === "fill" ||
    prop === "stroke" ||
    prop === "caret-color" ||
    prop === "text-decoration-color" ||
    prop === "-webkit-text-fill-color";

  if (isShadow && !ringShadow) {
    // Las sombras claras sobre fondo oscuro no se ven: se fuerzan a negro.
    return formatColor({ h: 0, s: 0, l: 0 }, clamp((alpha || 1) * 1.7, 0.25, 0.9));
  }

  if (isBackground) {
    // Superficies ya oscuras (botones, velos, scrims): se conservan.
    if (l <= 0.6) return token;
    // Velos translúcidos claros: se conservan para que sigan "iluminando" el fondo.
    if (alpha < 0.6) return token;

    if (chroma < 0.04) {
      // Blanco y grises de la UI → superficies oscuras por niveles de elevación.
      // Blanco puro (tarjetas, header, sidebar) queda como el nivel más alto.
      const nl =
        l >= 0.985
          ? 0.122
          : l >= 0.95
            ? 0.106
            : l >= 0.9
              ? 0.088
              : 0.074;
      return formatColor({ h: 215, s: 0.2, l: nl }, alpha);
    }
    // Tinte pálido (chips, badges, filas resaltadas, avisos) → mismo tono, profundo.
    const nl = clamp(0.11 + (1 - l) * 0.4, 0.11, 0.24);
    return formatColor(
      { h, s: clamp(chroma * 3, 0.09, 0.5), l: nl },
      alpha,
    );
  }

  if (isBorder || (isShadow && ringShadow)) {
    if (l <= 0.6) return token;
    if (alpha < 0.6) return token;
    if (prop.startsWith("outline")) {
      // Anillos de foco: deben seguir destacando sobre el fondo oscuro.
      if (l >= 0.5) return token;
      return formatColor(
        { h, s: clamp(chroma * 1.6, 0.2, 0.6), l: clamp(l + 0.32, 0.6, 0.8) },
        alpha,
      );
    }
    if (chroma < 0.035) {
      // Gris claro → separador apenas visible sobre superficies oscuras.
      return formatColor(
        { h: 215, s: 0.14, l: clamp(0.16 + (1 - l) * 0.12, 0.15, 0.24) },
        alpha,
      );
    }
    // Borde de acento (selección, aviso) → mismo tono, mucho más profundo.
    return formatColor(
      { h, s: clamp(chroma * 1.5, 0.07, 0.38), l: clamp(0.18 + (1 - l) * 0.1, 0.16, 0.3) },
      alpha,
    );
  }

  if (isText) {
    if (l >= 0.6) {
      // Texto ya claro (incluye #fff sobre botones) se conserva.
      return token;
    }
    // Escala invertida conservando el orden (jerarquía tipográfica). El tono
    // solo aporta un matiz: la croma real evita que la tinta oscura se vuelva
    // "azul saturado" al aclararla.
    const nl = clamp(0.95 - (l - 0.1) * 0.8, 0.55, 0.95);
    return formatColor(
      { h, s: chroma < 0.03 ? 0.06 : clamp(chroma * 1.4, 0.06, 0.45), l: nl },
      alpha,
    );
  }

  return token;
}

/* ── parser de CSS ──────────────────────────────────────────────────────── */

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|hsla?\([^()]*\)/g;

function transformValue(prop, value) {
  // Las "sombras de anillo" (0 0 0 1px … / inset …) se usan como bordes: no van a negro.
  const ringShadow =
    /shadow/.test(prop) &&
    (/\binset\b/.test(value) || /\b0\s+0\s+0\s+[0-9]/.test(value));
  return value.replace(COLOR_RE, (token) => darken(token, prop, ringShadow));
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function transformDeclarations(body) {
  const declarations = [];
  for (const raw of splitTopLevel(body, ";")) {
    const declaration = raw.trim();
    if (!declaration) continue;
    const colon = declaration.indexOf(":");
    if (colon < 1) continue;
    const prop = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (!value || prop.startsWith("--")) continue;
    const nextValue = transformValue(prop, value);
    if (nextValue === value) continue;
    declarations.push(`${prop}: ${nextValue}`);
  }
  return declarations.join(";\n    ");
}

function scopeSelector(selector) {
  const clean = selector.replace(/\s+/g, " ").trim();
  if (!clean || clean === ":root" || clean.startsWith(":root")) return null;
  if (clean === "html") return SCOPE;
  if (clean.startsWith("html")) return clean.replace(/^html/, SCOPE);
  return `${SCOPE} ${clean}`;
}

const SKIP_AT_RULES = /^@(keyframes|-webkit-keyframes|font-face|property|page|charset|counter-style|font-feature-values)/i;
const NESTED_AT_RULES = /^@(media|supports|container|layer|document|scope)/i;

function parseRules(css, out) {
  let index = 0;
  let start = 0;

  while (index < css.length) {
    const char = css[index];

    if (char === "{") {
      const prelude = css.slice(start, index).trim();
      let depth = 1;
      let cursor = index + 1;
      let quote = null;
      while (cursor < css.length && depth > 0) {
        const current = css[cursor];
        if (quote) {
          if (current === quote && css[cursor - 1] !== "\\") quote = null;
        } else if (current === '"' || current === "'") {
          quote = current;
        } else if (current === "{") depth++;
        else if (current === "}") depth--;
        cursor++;
      }
      const body = css.slice(index + 1, cursor - 1);
      handleBlock(prelude, body, out);
      index = cursor;
      start = cursor;
      continue;
    }

    if (char === ";") {
      start = index + 1;
    }
    index++;
  }
}

function handleBlock(prelude, body, out) {
  if (!prelude) return;

  if (prelude.startsWith("@")) {
    if (!NESTED_AT_RULES.test(prelude)) {
      // @keyframes/​@font-face/​@media print: se dejan fuera del tema oscuro.
      return;
    }
    if (/^@media\s*print/i.test(prelude)) return;
    const inner = [];
    parseRules(body, inner);
    if (inner.length) out.push(`${prelude} {\n${inner.join("\n")}\n}`);
    return;
  }

  const declarations = transformDeclarations(body);
  if (!declarations) return;

  const selectors = splitTopLevel(prelude, ",")
    .map(scopeSelector)
    .filter(Boolean);
  if (!selectors.length) return;

  out.push(`${selectors.join(",\n")} {\n    ${declarations};\n}`);
}

/* ── main ───────────────────────────────────────────────────────────────── */

const source = fs.readFileSync(SOURCE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [];
parseRules(source, rules);

const output = `${TOKENS}\n\n${rules.join("\n")}\n\n${REFINEMENTS}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : "";
  if (current !== output) {
    console.error("theme-dark.generated.css está desfasado: ejecuta node scripts/generate_dark_theme.mjs");
    process.exit(1);
  }
  console.log(`OK · ${rules.length} reglas oscuras`);
} else {
  fs.writeFileSync(TARGET, output);
  console.log(`Generado ${path.relative(ROOT, TARGET)} · ${rules.length} reglas · ${(output.length / 1024).toFixed(1)} KB`);
}
