# Plantilla de reporte de clima social

El reporte mensual de clima social se redacta primero como texto y luego se carga
en AVISA. Este documento fija la plantilla de redacción y el formato que reconoce
el lector `parsearPlantillaClimaSocial`
(`angular/src/app/features/clima-social/clima-social-plantilla.ts`), que reparte
el texto en las mismas cinco secciones que muestra la vista de clima social
(`clima-social.mapeo.ts` → `SECCIONES`).

> **Estado:** el módulo y el lector están listos, pero **aún no hay formulario de
> creación** de reporte en la interfaz (la vista es de consulta). Cuando se añada,
> el formulario debe ofrecer este bloque para copiar y pegar el reporte, igual que
> en las alertas tempranas.

## Plantilla

```
## Resumen ejecutivo
(párrafo de 3 a 5 líneas con la situación del mes y la alerta clave)

## Actores
- Nombre — Cargo / Organización (rol activo en el período)

## Clima social y hechos recientes
- DD.MMM.AAAA — Hecho concreto del período.

## Demandas locales
- Exigencia explícita de los actores.

## Foco PRODUCE
- Oportunidad de intervención o acción prevista.
```

## Secciones y alias aceptados

El lector reconoce cada sección por su encabezado (`## Título`) o por una línea
sin viñeta que empiece con el rótulo o un alias. Tolera tildes, mayúsculas y
numeración.

| Sección | Alias reconocidos |
|---|---|
| Resumen ejecutivo | `resumen ejecutivo`, `resumen`, `contexto rápido`, `alerta clave` |
| Actores | `actores`, `actores clave` |
| Clima social y hechos recientes | `clima social y hechos recientes`, `clima social`, `clima`, `hechos recientes`, `hechos`, `focos de tensión` |
| Demandas locales | `demandas locales`, `demandas` |
| Foco PRODUCE | `foco produce`, `foco`, `oportunidades`, `acciones previstas` |

Los alias replican los que reconoce `PATRON_SECCION` en `clima-social.mapeo.ts`,
para que un texto pegado aquí y un documento del legado se lean igual.

## Notas de uso

- Cada sección admite **párrafos** y **viñetas** mezclados; el lector devuelve una
  lista de líneas por sección.
- Todo lo anterior a la primera sección reconocida se descarta.
- Si no se reconoce ninguna sección, el lector devuelve `null` (no inventa
  contenido).
- Las fechas de los hechos siguen el formato compacto de la SPA (`DD.MMM.AAAA`).
