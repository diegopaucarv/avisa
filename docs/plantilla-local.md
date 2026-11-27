# Plantilla de la ficha de un local

La tabla `core.locales` no tiene columnas para las **barreras de accesibilidad**
ni para la **ventilación** del local. Para no inventar datos en la base, esos
riesgos se custodian dentro del texto libre de `core.locales.recomendacion` con
una plantilla markdown estable. La SPA la interpreta con
`angular/src/app/features/directorio/local-notas.ts` (`parsearNotasLocal`).

## Plantilla

```markdown
## Evaluación

(texto libre de evaluación)

## Accesibilidad

- (barreras de acceso, escaleras, rampas, transporte)

## Ventilación

- (ventilación natural/forzada, aire acondicionado, aforo por ventilación)

## Otras observaciones

- (opcional)
```

Cada sección empieza con un encabezado markdown (`#`, `##` o `###`, con
mayúsculas o minúsculas). Después del encabezado, cada viñeta (`-`, `*` o `•`)
o línea suelta es un ítem de la lista. Las líneas vacías se ignoran.

La constante `PLANTILLA_LOCAL` del parser contiene exactamente este texto, para
ofrecerlo como punto de partida en la UI.

## Cómo lo interpreta la SPA

| Parte de la plantilla       | Campo de `NotasLocal`  | Qué pinta la ficha            |
| --------------------------- | ---------------------- | ----------------------------- |
| «Evaluación» (o el texto antes del primer encabezado) | `evaluacion` | Sección «Evaluación» |
| «Accesibilidad»             | `accesibilidad`        | Sección «Riesgos del local» (lista) |
| «Ventilación»               | `ventilacion`          | Sección «Riesgos del local» (lista) |
| «Otras observaciones»       | `otras`                | Reservado; no se pinta hoy    |

Si la evaluación está estructurada, la sección «Evaluación» muestra solo esa
parte y deja el texto completo en un desplegable «Ver texto completo», para no
perder nada de lo escrito.

## Texto legado (sin estructura)

El texto cargado antes de esta plantilla no tiene encabezados. En ese caso el
parser **no intenta adivinar**: todo el contenido va a `textoLibre`, las listas
quedan vacías y la ficha muestra el texto tal cual en «Evaluación». La sección
«Riesgos del local» aparece como «Sin riesgos registrados».

Por eso la plantilla es opcional: se puede escribir una evaluación libre sin
romper nada, y estructurarla más adelante cuando se conozcan los riesgos.
