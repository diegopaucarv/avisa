# Plantilla de ficha ampliada (actor y contacto/local)

La base de datos no tiene columnas para varios datos del actor (artes de pesca,
inscripción en PRODUCE, vigencia de poder, registros públicos, ámbito, cantidad
de afiliados, cantidad de organizaciones afiliadas, cargo público o político,
cercanía a PRODUCE, declaraciones en redes, edad, capacidad de ordenar) ni para
la dirección, el enlace de mapa, la accesibilidad y la ventilación de un local.
Hasta que existan migraciones, esos datos se escriben **en el texto libre** de
la ficha y el frontend los interpreta con `parsearFicha()`.

- **Actor**: pegue el bloque en «Descripción del perfil» (`perfil_descripcion`).
- **Contacto / local**: pegue el bloque en «Evaluación» (`recomendacion`).

El formato es tolerante a faltantes: **cada línea es opcional**. Si un dato no
se conoce, omita la línea completa (no escriba «sin dato» ni «—»). El parser
ignora encabezados desconocidos, viñetas sin `Clave: valor` y texto libre, y
devuelve `null` en los campos que no aparecen. Los valores pueden contener `:`
o `-` sin problema: sólo el primer `:` separa la clave del valor.

## Organización e inscripción

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

## Accesibilidad

- (barreras de acceso, escaleras, rampas, transporte)

## Ventilación

- (ventilación natural/forzada, aire acondicionado, aforo por ventilación)

## Notas de uso

- Las secciones `## Accesibilidad` y `## Ventilación` usan **viñetas de valores**
  (una por línea). Son las mismas secciones que ya interpreta la ficha del local
  con `parsearNotasLocal()`, por lo que se reutilizan tal cual.
- Si un dato se escribe como `- Accesibilidad: rampa` dentro de otra sección, el
  parser lo agrega igualmente a la lista de accesibilidad.
- La capacidad de ordenar se acompaña de un **listado** (nombres y cargos), no
  de fichas individuales.
