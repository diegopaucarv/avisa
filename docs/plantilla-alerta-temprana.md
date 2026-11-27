# Plantilla de reporte de alerta temprana

El reporte de alerta temprana se redacta antes de darlo de alta en AVISA. En el
formulario de alta y en «Modificar alerta» hay un bloque plegable **«Pegar
reporte completo»**: se pega el texto, se pulsa **Aplicar al formulario** y el
lector reparte el contenido en los campos del borrador (título, alcance, situación
actual, hechos, actores clave, demandas, riesgos y acciones sugeridas). El botón
**Copiar plantilla** copia el bloque de abajo para rellenarlo.

El lector vive en `angular/src/app/features/alertas/alerta-plantilla.ts`
(`parsearPlantillaAlerta`) y es **tolerante**: reconoce las secciones por su rótulo
además del emoji, admite tildes y mayúsculas, ignora el énfasis de markdown y no
inventa datos que no aparecen.

## Estructura obligatoria

```
*🔔 REPORTE DE ALERTA TEMPRANA | [Título descriptivo: tema, actor principal, acción, ubicación]*
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
- Datos faltantes o supuestos.
```

## Reglas de estilo

- Use siempre los emojis indicados, en ese orden, sin sustituirlos.
- Fechas en formato `DD.MMM.AAAA` (ej. `27.ABR.2026`).
- Nombres de normas con su numeración exacta (ej. `RM N° 000102-2026-PRODUCE`).
- Siglas con su significado la primera vez si no son evidentes (DPA, RNMTG, PNDP,
  AGREPESAR, DGPA, DGSFS, DVMPA).
- Lenguaje formal, neutro, sin adjetivos cargados ni juicios de valor.
- No invente datos. Si falta información clave, márquela entre corchetes:
  `[POR CONFIRMAR: nombre del dirigente]`.

## Cómo se lee cada parte

| Parte del reporte | Campo del borrador |
|---|---|
| Título (tras el `\|`) | Título |
| Ámbito (`Local`/`Regional`/`Nacional`) | Alcance (Distrito / Región / Nacional) |
| 1. Situación actual | Situación actual |
| 2. Hechos recientes (`DD.MMM.AAAA — hecho`) | Hechos (fecha + descripción) |
| 3. Actores clave | Actores clave |
| 4. Demandas inmediatas | Demandas (organización + demanda) |
| RIESGOS | Descripción del riesgo |
| ACCIONES SUGERIDAS | Acciones sugeridas |
| Notas para el editor | Se descarta |

Notas del lector:

- La **fecha de emisión** se usa para el registro; no es un campo de texto libre
  del formulario, así que no se vuelca, pero se reconoce al leer.
- Bajo **Demandas inmediatas**, una línea sin viñeta se interpreta como subtítulo
  de grupo (la organización) y se adjunta a las demandas que le siguen, que es
  como se guardan (`Organización: demanda`).
- Las **acciones sugeridas** conservan la frase «De considerarlo pertinente, se
  sugiere:» si va como línea propia.
- Todo lo que sigue a **Notas para el editor** se ignora.
