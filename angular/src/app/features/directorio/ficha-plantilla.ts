/**
 * Directorio · Ficha ampliada: plantilla markdown y parser.
 *
 * La base no tiene columnas para varios datos de la ficha del actor (artes de
 * pesca, inscripción en PRODUCE, vigencia de poder, registros públicos, ámbito,
 * cantidad de afiliados, cantidad de organizaciones afiliadas, cargo público o
 * político, cercanía a PRODUCE, declaraciones en redes, edad, capacidad de
 * ordenar) ni para dirección, enlace de mapa, accesibilidad y ventilación de un
 * local. Mientras no existan migraciones, esos datos viven en el texto libre
 * (`core.actores.perfil_descripcion` para actores, `core.locales.recomendacion`
 * para locales) con el formato de `docs/plantilla-ficha-actor.md`.
 *
 * DECISIÓN DE REUTILIZACIÓN
 * -------------------------
 * `parsearNotasLocal()` (`local-notas.ts`) ya interpreta las secciones
 * `## Accesibilidad` y `## Ventilación` de la ficha del local. Duplicar aquí el
 * reconocimiento de encabezados y viñetas haría que ambas fichas divergieran en
 * cuanto cambie la plantilla. Por eso este parser **envuelve** a
 * `parsearNotasLocal()` para los riesgos del local y sólo añade la lectura de las
 * líneas `- Clave: valor` del resto de campos. La plantilla de accesibilidad y
 * ventilación es, literalmente, la misma (`PLANTILLA_LOCAL`).
 *
 * El parser es puro y total: nunca lanza, normaliza saltos de línea, descarta
 * viñetas sin `Clave: valor` y devuelve `null` (o `null` para las listas) en los
 * campos que no aparecen. Texto libre sin formato devuelve todo `null`.
 */

import {
  ENCABEZADO,
  VINETA,
  normalizar,
  normalizarClave,
  separarClaveValor,
  valorUtil,
} from '../../shared/plantilla-texto';
import { parsearNotasLocal, PLANTILLA_LOCAL } from './local-notas';

/** Datos que no tienen columna en la base y se leen de la ficha de texto. */
export type DatosFicha = {
  artesDePesca: string | null;
  inscripcionProduce: string | null;
  vigenciaPoder: string | null;
  registrosPublicos: string | null;
  ambito: string | null;
  cantidadAfiliados: string | null;
  cantidadOrganizacionesAfiliadas: string | null;
  capacidadOrdenar: string | null;
  cargoPublico: string | null;
  cercaniaProduce: string | null;
  declaracionesRedes: string | null;
  edad: string | null;
  direccion: string | null;
  enlaceMapa: string | null;
  /** Viñetas de «Accesibilidad»; `null` si la sección no aparece. */
  accesibilidad: string[] | null;
  /** Viñetas de «Ventilación»; `null` si la sección no aparece. */
  ventilacion: string[] | null;
};

/** Campos escalares (los que se asignan con una sola línea `Clave: valor`). */
type CampoEscalar = Exclude<keyof DatosFicha, 'accesibilidad' | 'ventilacion'>;

/**
 * Plantilla que se ofrece en la UI y se documenta en
 * `docs/plantilla-ficha-actor.md`. Las secciones de accesibilidad y ventilación
 * son las de `PLANTILLA_LOCAL` para no mantener dos formatos.
 */
export const PLANTILLA_FICHA = `## Organización e inscripción

- Artes de pesca: (redes, anzuelos, cerco, arrastre, trampa…)
- Inscripción en PRODUCE: (número de inscripción / registro)
- Vigencia de poder actual: (notaría, partida, fecha de vencimiento)
- Registros públicos: (partida registral, oficina registral, estado)
- Ámbito de acción: (distritos, provincias o regiones donde actúa)
- Cantidad de afiliados: (número de personas afiliadas)
- Cantidad de organizaciones afiliadas: (número de bases o gremios adheridos)
- Capacidad de ordenar: (sí/no; capacidad de convocar y ordenar, con listado)

## Perfil político y redes

- Cargo público o político: (cargo, entidad y período)
- Cercanía a PRODUCE: (vínculo declarado u observado con PRODUCE)
- Declaraciones en redes: (enlace o resumen de publicaciones)
- Edad: (años)

## Local

- Dirección: (dirección completa del local)
- Enlace de mapa: (URL de Google Maps u otro mapa)

${PLANTILLA_LOCAL}`;

/**
 * Alias aceptados por campo. Se comparan ya normalizados; sirven para tolerar
 * variantes de redacción sin inventar coincidencias por subcadena (una viñeta
 * libre con dos puntos no debe convertirse en dato).
 */
const ALIAS: Record<CampoEscalar, readonly string[]> = {
  artesDePesca: ['artes de pesca', 'artes de pesca relacionadas', 'artes', 'artes y aparejos'],
  inscripcionProduce: [
    'inscripcion en produce',
    'inscripcion produce',
    'registro produce',
    'inscripcion en el registro de produce',
  ],
  vigenciaPoder: ['vigencia de poder', 'vigencia de poder actual', 'poder vigente'],
  registrosPublicos: ['registros publicos', 'registro publico', 'partida registral'],
  ambito: ['ambito', 'ambito de accion', 'ambito de actuacion', 'ambito de accion territorial'],
  cantidadAfiliados: [
    'cantidad de afiliados',
    'cantidad afiliados',
    'numero de afiliados',
    'afiliados',
  ],
  cantidadOrganizacionesAfiliadas: [
    'cantidad de organizaciones afiliadas',
    'cantidad organizaciones afiliadas',
    'numero de organizaciones afiliadas',
    'organizaciones afiliadas',
  ],
  capacidadOrdenar: [
    'capacidad de ordenar',
    'capacidad de convocatoria',
    'capacidad de movilizacion',
    'capacidad de ordenar y adjuntar',
    'capacidad de ordenar y adjuntar listado',
  ],
  cargoPublico: [
    'cargo publico o politico',
    'cargo publico',
    'cargo politico',
    'cargo publico o politico actual',
  ],
  cercaniaProduce: [
    'cercania a produce',
    'cercania produce',
    'vinculo con produce',
    'relacion con produce',
  ],
  declaracionesRedes: [
    'declaraciones en redes',
    'declaracion en redes',
    'declaraciones publicas en redes',
    'redes sociales',
  ],
  edad: ['edad', 'edad en anos'],
  direccion: ['direccion', 'direccion del local'],
  enlaceMapa: [
    'enlace de mapa',
    'enlace del mapa',
    'enlace maps',
    'ubicacion en maps',
    'enlace de ubicacion',
    'mapa',
  ],
};

/** Claves de riesgo escritas como `Clave: valor` fuera de su sección. */
const CLAVES_DE_RIESGO: Record<string, 'accesibilidad' | 'ventilacion'> = {
  accesibilidad: 'accesibilidad',
  ventilacion: 'ventilacion',
};

/** Clave normalizada → campo escalar, construido una sola vez. */
const CAMPOS: Record<string, CampoEscalar> = (() => {
  const mapa: Record<string, CampoEscalar> = {};
  for (const [campo, alias] of Object.entries(ALIAS)) {
    for (const clave of alias) mapa[normalizarClave(clave)] = campo as CampoEscalar;
  }
  return mapa;
})();

/** Objeto con todos los campos ausentes (`null`), base del resultado. */
function vacia(): DatosFicha {
  return {
    artesDePesca: null,
    inscripcionProduce: null,
    vigenciaPoder: null,
    registrosPublicos: null,
    ambito: null,
    cantidadAfiliados: null,
    cantidadOrganizacionesAfiliadas: null,
    capacidadOrdenar: null,
    cargoPublico: null,
    cercaniaProduce: null,
    declaracionesRedes: null,
    edad: null,
    direccion: null,
    enlaceMapa: null,
    accesibilidad: null,
    ventilacion: null,
  };
}

/** `## Accesibilidad` / `## Ventilación` abren una sección de viñetas-values. */
function esSeccionDeRiesgos(titulo: string): boolean {
  const texto = normalizar(titulo);
  // `local-notas` reconoce además «acceso»; se replica para no leer sus
  // viñetas como pares clave:valor.
  return (
    texto.includes('accesibilidad') || texto.includes('acceso') || texto.includes('ventilacion')
  );
}

/**
 * Texto libre de la ficha (actor o local) → datos complementarios.
 *
 * Reutiliza `parsearNotasLocal()` para accesibilidad y ventilación y lee el
 * resto de líneas `- Clave: valor`. Tolera encabezados desconocidos, viñetas sin
 * dos puntos y texto libre: en ese caso los campos quedan en `null`.
 */
export function parsearFicha(descripcion: string | null | undefined): DatosFicha {
  const normalizado = typeof descripcion === 'string' ? descripcion.replace(/\r\n?/g, '\n') : '';
  const resultado = vacia();
  if (normalizado.trim() === '') return resultado;

  // Las notas del local ya saben leer las secciones de riesgos con viñetas.
  const notas = parsearNotasLocal(normalizado);
  if (notas.accesibilidad.length > 0) resultado.accesibilidad = [...notas.accesibilidad];
  if (notas.ventilacion.length > 0) resultado.ventilacion = [...notas.ventilacion];

  // Dentro de una sección de riesgos las viñetas son valores, no pares clave:valor.
  let enSeccionDeRiesgos = false;

  for (const linea of normalizado.split('\n')) {
    const encabezado = ENCABEZADO.exec(linea);
    if (encabezado) {
      enSeccionDeRiesgos = esSeccionDeRiesgos(encabezado[1].replace(/\s*#+\s*$/, ''));
      continue;
    }
    if (enSeccionDeRiesgos) continue;

    const vineta = VINETA.exec(linea);
    if (!vineta) continue;

    const par = separarClaveValor(vineta[1]);
    if (!par) continue;

    const clave = normalizarClave(par.clave);
    const valor = valorUtil(par.valor);
    if (!valor) continue;

    // Fuera de su sección, `- Accesibilidad: rampa` también es una viñeta de riesgo.
    const riesgo = CLAVES_DE_RIESGO[clave];
    if (riesgo) {
      (resultado[riesgo] ??= []).push(valor);
      continue;
    }

    const campo = CAMPOS[clave];
    if (!campo) continue;

    resultado[campo] = valor;
  }

  return resultado;
}
