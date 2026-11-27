/**
 * Alertas tempranas · Reporte en texto y su lectura.
 *
 * El equipo redacta el reporte de alerta temprana como un informe de texto (a
 * veces en WhatsApp) antes de darlo de alta en AVISA. En lugar de teclear cada
 * sección, el formulario ofrece pegar el reporte completo y este módulo lo
 * reparte en los campos del borrador: título, situación, hechos, actores,
 * demandas, riesgos y acciones.
 *
 * La estructura es la que usa la oficina en `docs/plantilla-alerta-temprana.md`.
 * El lector es **puro y total**: nunca lanza, tolera markdown (`*`, `_`), tildes,
 * mayúsculas y emojis, reconoce la sección por su rótulo además del emoji y
 * descarta lo que no puede ubicar (no inventa datos). Si no reconoce ni una
 * sección ni el título, devuelve `null` para que la interfaz avise.
 */

import { VINETA, normalizar } from '../../shared/plantilla-texto';

/** Meses en tres letras, como se escriben en el reporte (`28.ABR.2026`). */
const MESES: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  sep: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

/** Un hecho del reporte: fecha ISO (`aaaa-mm-dd`) opcional + descripción. */
export type HechoPlantilla = { fecha: string | null; texto: string };

/** Una demanda inmediata: organización solicitante (puede ir vacía) + demanda. */
export type DemandaPlantilla = { organizacion: string; demanda: string };

/** Resultado de leer un reporte de alerta temprana. */
export type DatosPlantillaAlerta = {
  /** Título descriptivo, sin el prefijo «REPORTE DE ALERTA TEMPRANA |». */
  titulo: string | null;
  /** Fecha de emisión en ISO (`aaaa-mm-dd`) o `null` si no aparece. */
  fechaEmision: string | null;
  /** Hora `HH:MM` si el reporte la menciona. */
  hora: string | null;
  /** Ámbito tal cual se escribió («Local — Máncora», «Regional — Piura»…). */
  ambito: string | null;
  /** Líneas de «Situación actual». */
  situacionActual: string[];
  /** Hechos recientes en orden de aparición. */
  hechos: HechoPlantilla[];
  /** Actores clave, una línea cada uno. */
  actores: string[];
  /** Demandas inmediatas con su organización cuando el reporte la separa. */
  demandas: DemandaPlantilla[];
  /** Riesgos. */
  riesgos: string[];
  /** Acciones sugeridas (sin la frase «De considerarlo pertinente…»). */
  acciones: string[];
};

/**
 * Plantilla que la interfaz ofrece para copiar y completar. Reproduce la
 * estructura obligatoria del reporte de la oficina, con los emojis y el orden
 * exactos (cambiarlos rompe el reconocimiento de otras herramientas).
 */
export const PLANTILLA_ALERTA_TEMPRANA = `*🔔 REPORTE DE ALERTA TEMPRANA | [Título descriptivo: tema, actor principal, acción, ubicación]*
📅 _*Fecha de emisión*: [DD.MMM.AAAA] - [HH:MM hrs, solo si está mencionado]_
🌍 _*Ámbito*: [Local / Regional / Nacional + distrito o región]_

*🔍 1. SITUACIÓN ACTUAL*
- 2 a 4 líneas describiendo qué ocurre, quiénes están involucrados, qué demandan y posible evolución inmediata.
- Tono institucional, frío, factual. Nunca especulativo sin evidencia.

*🏗️ 2. HECHOS RECIENTES Y ACCIONES EN CURSO*
- DD.MMM.AAAA — Hecho concreto.
- Incluir números de oficio, RM, decretos y reuniones formales (2 a 5 viñetas, orden cronológico ascendente).

*👥 3. ACTORES CLAVE*
- Nombre completo — Cargo / Organización — Celular (si está disponible).

*📌 4. DEMANDAS INMEDIATAS*
- Exigencia explícita del actor.

*⚠️ RIESGOS*
- Escalada (paro, bloqueo, marcha), orden público o afectación sectorial.

*🧭 ACCIONES SUGERIDAS*
- De considerarlo pertinente, se sugiere: acción preventiva o articulación intersectorial.

📝 Notas para el editor:
- Datos faltantes o supuestos.`;

/** Secciones reconocidas por su rótulo (además del emoji). */
type SeccionAlerta = 'situacion' | 'hechos' | 'actores' | 'demandas' | 'riesgos' | 'acciones';

/**
 * Rótulos normalizados de cada sección. Se reconoce por prefijo para tolerar la
 * redacción completa de la plantilla («HECHOS RECIENTES Y ACCIONES EN CURSO»).
 * El orden importa: «hechos» va antes que «acciones» para que esa cabecera no se
 * confunda.
 */
const ETIQUETAS: readonly (readonly [string, SeccionAlerta])[] = [
  ['situacion actual', 'situacion'],
  ['hechos recientes', 'hechos'],
  ['actores clave', 'actores'],
  ['demandas inmediatas', 'demandas'],
  ['riesgos', 'riesgos'],
  ['acciones sugeridas', 'acciones'],
];

/** Quita el énfasis de markdown y el marcador de cita al inicio de línea. */
function sinMarkdown(texto: string): string {
  return texto
    .replace(/^\s*>\s?/, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

/**
 * Rótulo comparable: sin markdown, sin tildes, en minúsculas y sin los
 * caracteres iniciales que no son letras (emoji, `#`, numeración `1.`).
 */
function rotulo(linea: string): string {
  return normalizar(sinMarkdown(linea)).replace(/^[^a-z]+/, '').trim();
}

/** Número de mes a partir de `ABR`/`abril`/`4`. `0` si no se reconoce. */
function numeroDeMes(texto: string): number {
  if (/^\d+$/.test(texto)) return Number(texto);
  return MESES[texto.slice(0, 3).toLowerCase()] ?? 0;
}

/** `dd`, `mes`, `aaaa` → ISO `aaaa-mm-dd`; `null` si la fecha no es válida. */
function isoDesde(dia: number, mesTexto: string, anioTexto: string): string | null {
  const mes = numeroDeMes(mesTexto);
  let anio = Number(anioTexto);
  if (!Number.isFinite(anio)) return null;
  if (anio < 100) anio += 2000;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** `DD.MMM.AAAA`, `DD.MM.AAAA` o `DD/MM/AAAA` → ISO. `null` si no hay. */
function fechaIsoDe(texto: string): string | null {
  const coincide = /(\d{1,2})\s*[.\/-]\s*([A-Za-zÁÉÍÓÚáéíóú]{3,4}|\d{1,2})\s*[.\/-]\s*(\d{2,4})/.exec(
    texto,
  );
  if (!coincide) return null;
  return isoDesde(Number(coincide[1]), coincide[2], coincide[3]);
}

/** `HH:MM` presente en el texto, o `null`. */
function horaDe(texto: string): string | null {
  const coincide = /(\d{1,2}):(\d{2})/.exec(texto);
  if (!coincide) return null;
  const horas = Number(coincide[1]);
  const minutos = Number(coincide[2]);
  if (horas > 23 || minutos > 59) return null;
  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

/** `DD.MMM.AAAA — texto` → `{ fecha, texto }`; sin fecha, todo es texto. */
function partirHecho(contenido: string): HechoPlantilla {
  const coincide = /^(\d{1,2})\s*[.\/-]\s*([A-Za-zÁÉÍÓÚáéíóú]{3,4}|\d{1,2})\s*[.\/-]\s*(\d{2,4})\s*[-–—:]\s*(.*)$/.exec(
    contenido,
  );
  if (coincide) {
    const fecha = isoDesde(Number(coincide[1]), coincide[2], coincide[3]);
    if (fecha) return { fecha, texto: coincide[4].trim() };
  }
  return { fecha: null, texto: contenido };
}

/** Sección cuyo rótulo empieza con el texto dado, o `null`. */
function seccionDe(rot: string): SeccionAlerta | null {
  for (const [etiqueta, seccion] of ETIQUETAS) {
    if (rot.startsWith(etiqueta)) return seccion;
  }
  return null;
}

/**
 * Reporte de alerta temprana (texto) → datos del borrador.
 *
 * Reconoce el título, la fecha de emisión, el ámbito y las seis secciones. Bajo
 * «Demandas inmediatas», una línea sin viñeta se interpreta como subtítulo de
 * grupo (la organización) y se adjunta a las demandas que siguen.
 */
export function parsearPlantillaAlerta(texto: string | null | undefined): DatosPlantillaAlerta | null {
  const normalizado = typeof texto === 'string' ? texto.replace(/\r\n?/g, '\n') : '';
  if (normalizado.trim() === '') return null;

  let titulo: string | null = null;
  let fechaEmision: string | null = null;
  let hora: string | null = null;
  let ambito: string | null = null;
  let seccion: SeccionAlerta | null = null;
  let organizacion = '';
  let reconocidas = 0;

  const situacionActual: string[] = [];
  const hechos: HechoPlantilla[] = [];
  const actores: string[] = [];
  const demandas: DemandaPlantilla[] = [];
  const riesgos: string[] = [];
  const acciones: string[] = [];

  for (const linea of normalizado.split('\n')) {
    const limpio = sinMarkdown(linea);
    if (!limpio) continue;

    const rot = rotulo(linea);
    if (!rot) continue;

    // Todo lo que sigue a las notas del editor es comentario, no reporte.
    if (rot.includes('notas para el editor')) break;

    // Título: la primera línea que anuncia el reporte; el título va tras el `|`.
    if (!titulo && rot.includes('reporte de alerta temprana')) {
      const corte = limpio.indexOf('|');
      const valor = corte >= 0 ? limpio.slice(corte + 1) : limpio;
      const limpioTitulo = valor.replace(/[|]/g, '').trim();
      if (limpioTitulo) titulo = limpioTitulo;
      continue;
    }

    // Metadatos de cabecera.
    if (rot.startsWith('fecha de emision')) {
      fechaEmision = fechaIsoDe(limpio);
      hora = horaDe(limpio);
      continue;
    }
    if (rot.startsWith('ambito')) {
      const corte = limpio.indexOf(':');
      const valor = (corte >= 0 ? limpio.slice(corte + 1) : limpio).trim();
      if (valor) ambito = valor;
      continue;
    }

    // Encabezado de sección: es la única línea sin viñeta que se reconoce.
    const vineta = VINETA.exec(linea);
    if (!vineta) {
      const encontrada = seccionDe(rot);
      if (encontrada) {
        seccion = encontrada;
        reconocidas += 1;
        continue;
      }
      // Bajo demandas, un párrafo suelto es el subtítulo de un grupo de actores.
      if (seccion === 'demandas') {
        organizacion = limpio;
        continue;
      }
      // Párrafos sueltos en otras secciones se toman como contenido (la situación
      // y las acciones a veces se redactan sin viñetas).
      if (seccion) {
        agregarLinea(seccion, limpio);
        continue;
      }
      continue;
    }

    const contenido = sinMarkdown(vineta[1]);
    if (!contenido) continue;
    agregarLinea(seccion, contenido);
  }

  function agregarLinea(destino: SeccionAlerta | null, contenido: string): void {
    switch (destino) {
      case 'situacion':
        situacionActual.push(contenido);
        break;
      case 'hechos':
        hechos.push(partirHecho(contenido));
        break;
      case 'actores':
        actores.push(contenido);
        break;
      case 'demandas':
        demandas.push({ organizacion, demanda: contenido });
        break;
      case 'riesgos':
        riesgos.push(contenido);
        break;
      case 'acciones':
        acciones.push(contenido);
        break;
      default:
        break;
    }
  }

  // Sin título y sin ninguna sección reconocible no es un reporte de alerta.
  if (!titulo && reconocidas === 0) return null;

  return {
    titulo,
    fechaEmision,
    hora,
    ambito,
    situacionActual,
    hechos,
    actores,
    demandas,
    riesgos,
    acciones,
  };
}

/**
 * Ámbito en texto libre → alcance del select. `Local` se traduce a `Distrito`,
 * que es la granularidad que ofrece la interfaz para lo local.
 */
export function alcanceDesdeAmbito(ambito: string | null): 'Distrito' | 'Región' | 'Nacional' | null {
  if (!ambito) return null;
  const texto = normalizar(ambito);
  if (texto.includes('nacional')) return 'Nacional';
  if (texto.includes('region')) return 'Región';
  if (texto.includes('local') || texto.includes('distrito') || texto.includes('provincia')) {
    return 'Distrito';
  }
  return null;
}
