# Matriz de diagnóstico del Excel frente al modelo AVISA

**Fecha de corte:** 23 nov 2026
**Fuente:** `docs/01_requisitos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (1).xlsx`, leída con `openpyxl` y `data_only=True`
**Contraste:** `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`, `docs/05_datos/diccionario_datos.csv`, `migration/41_matriz_equipo.sql`, `migration/42_reuniones_sin_caso.sql`, `migration/43_nudos_criticos_fieles.sql`, `scripts/matriz/parse_matriz.py`, `scripts/matriz/importar_matriz.py` y `scripts/matriz/salida/informe_importacion.json`
**Naturaleza:** lectura y conteo. No se modificó el libro, no se escribió en la base y no se tocó código.

Este documento mide una sola cosa: **qué columnas del Excel tienen un lugar donde vivir en el modelo AVISA y cuáles no**. No propone rediseñar el Excel ni el esquema; declara la brecha y su salida. El principio que gobierna todo el texto es el mismo del proyecto: **el dato ausente se declara, no se estima**. Por eso hay celdas marcadas como «sin destino» en lugar de forzadas a un catálogo, y fechas que quedan en texto en lugar de inventarse un día.

Los conteos de la columna «Celdas con dato» no vienen del encargo: se recalcularon celda por celda sobre el rango de datos y corrigen varias cifras del pedido inicial (ver «Cifras del encargo que no se confirman», al final).

**Tamaño real del libro, medido:**

| Hoja                              | Dimensiones declaradas | Última fila con dato | Registros útiles                                        |
| --------------------------------- | ---------------------- | -------------------- | ------------------------------------------------------- |
| `CASOS OAIPCS - OPERATIVO`        | 1 003 × 28             | 132                  | 37 bloques de caso (filas 3 a 132)                      |
| `Reporte de avance de casos punt` | 1 005 × 38             | 106                  | 32 bloques                                              |
| `Seguimiento de Alertas`          | 899 × 28               | 102                  | 101 alertas, 14 columnas útiles                         |
| `Seguimiento de Reuniones`        | 922 × 22               | 48                   | 46 reuniones, 13 columnas (encabezado en la fila 2)     |
| `METADATOS CASOS`                 | 1 002 × 6              | 131                  | 37 filas, no contiguas                                  |
| `Maestros`                        | 99 × 27                | 99                   | 19 listas de catálogo + 42 filas de espacios de diálogo |
| `DVPA`                            | 998 × 28               | 410                  | 408 filas de actores                                    |
| `DVMYPE-I`                        | 6 × 17                 | 6                    | 4 filas de marcadores                                   |

Las columnas 25 a 28 de la hoja principal, las 15 a 22 de Reuniones y las 15 a 28 de Alertas están fuera del rango con dato: son residuo de formato.

---

## Veredicto en una tabla

«Con destino» cuenta las columnas que tienen columna o tabla de destino en AVISA, **incluidas las que solo entran con matiz**.

| Bloque              | Columnas             | Celdas con dato | Con destino | %     | Brecha principal                                                        |
| ------------------- | -------------------- | --------------- | ----------- | ----- | ----------------------------------------------------------------------- |
| Identificación      | A–E (5)              | 182             | 5 / 5       | 100 % | `N°` no es clave: 3 bloques sin número y 1 número repetido              |
| Intervención        | J–R (9)              | 341             | 6 / 9       | 67 %  | Actores J/K: 68 celdas de texto libre sin clave de unión                |
| Hitos               | S–X (6)              | 525             | 6 / 6       | 100 % | Estado del hito: 47 «No cumplido» con dos grafías y sin catálogo previo |
| Análisis            | F–I (4)              | 128             | 3 / 4       | 75 %  | F: 36 celdas de narración cronológica sin columna en el modelo          |
| Seguimiento semanal | Reporte c22–c37 (16) | 254             | 16 / 16     | 100 % | Par 8 con rótulos descuadrados: 136 seguimientos frente a 118 nudos     |

Los cuatro primeros bloques suman **1 176 celdas** y cubren la hoja principal completa: 182 + 341 + 525 + 128 = 1 176. El quinto bloque vive en otra hoja (`Reporte de avance`), por eso no entra en esa suma.

La lectura corta: **estructura, hitos y seguimiento semanal tienen dónde caer; actores y narrativa no.** El 100 % de Hitos es engañoso y hay que leerlo con la brecha al lado: todas las columnas tienen columna de destino, pero el estado del hito y las fechas exigen vocabulario y formato que la base no tenía y que la migración 41 tuvo que crear.

---

## Cómo leer este diagnóstico

| Categoría                 | Definición                                                                                                                          | Columnas en la hoja principal                     | Nº  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --- |
| `Existe`                  | Hay columna o tabla de destino y el valor entra tal cual, sin traducción.                                                           | D, E, L, N, S, T                                  | 6   |
| `Existe con matiz`        | Hay destino, pero exige resolver un nombre, corregir una grafía, partir una celda o aceptar que el dato llega incompleto.           | A, B, C, G, I, M, P, Q, R, U, V, W                | 12  |
| `Sin destino`             | No hay columna ni tabla que lo reciba. El dato se declara y queda fuera o entra por captura manual.                                 | F, J, K, O                                        | 4   |
| `Colisión de vocabulario` | Hay destino, pero el encabezado del Excel dice una cosa y el contenido es otra; o el vocabulario del Excel no casa con el catálogo. | H, X                                              | 2   |
| `Error de origen`         | El dato está roto en el propio libro y no debe cargarse.                                                                            | ninguna (los 31 `#REF!` están en la hoja Reporte) | 0   |

24 columnas, 24 categorías asignadas. Tres advertencias de método:

1. **«Hay destino» no significa «se carga»**. `casos.descripcion_riesgo` existe en el esquema, pero el importador actual no la escribe: el dry-run la declara como dato sin destino. La columna «Destino en AVISA» describe **el modelo**, no el importador. Cuando difieren, se dice.
2. **Las migraciones 41, 42 y 43 están en estado PROPUESTA**, no ejecutadas (así lo declaran sus encabezados, con fecha 24 nov 2026). Todo destino marcado «nueva en 41» es un destino **previsto**: hoy no existe en la base viva, cuyo diccionario no las lista.
3. **No se inventan equivalencias de catálogo.** Donde el Excel trae un valor que el catálogo no tiene, se declara el valor y se deja la columna tipada en NULL.

---

## Hoja principal — columna por columna

Encabezados en la fila 2; la fila 1 son bandas de agrupación. Datos en las filas 3 a 132, en **37 bloques** de caso. La clave real es **la fila del bloque**, no la columna A.

| Col       | Encabezado                                | Qué contiene                                                                      | Destino en AVISA                                                                                  | Estado                  | Celdas con dato | Observación                                                                                                                                                                                                                        |
| --------- | ----------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A         | `N°`                                      | Número de caso, guardado como `float` (`1.0`)                                     | ninguno: no es clave                                                                              | Existe con matiz        | 34              | 3 bloques sin número (filas 118, 127, 132) y `15` repetido en 48 y 128; la 128 es el bloque duplicado. Falta el 32.                                                                                                                |
| B         | `Departamento`                            | Texto libre: uno o varios departamentos, o `Nacional`                             | `casos.region_principal_id` solo con coincidencia única                                           | Existe con matiz        | 37              | 19 grafías para 37 bloques. 28 de un solo departamento (`Ancash` sin tilde, `Lima Metropolitana`, `Lima Provincias`); 9 son listas con «/» o `Nacional`. Las listas no se reducen a una región: se declaran.                       |
| C         | `Sectorista`                              | Nombre de persona                                                                 | `core.usuarios` por nombre; no hay `casos.sectorista_*`                                           | Existe con matiz        | 37              | 5 personas: Ivan Ascurra 11, Peggy Contreras 11, Esteban Vidal 7, Karen Benito 5, Daniel Vela 3. No se resuelve por id.                                                                                                            |
| D         | `Prioridad de Atención`                   | Catálogo de 3 valores                                                             | `casos.prioridad_id` → `cat_prioridades_atencion` 1/2/3                                           | Existe                  | 37              | Moderado 20, Bajo 11, Urgente 6. Coincide nombre a nombre con el catálogo.                                                                                                                                                         |
| E         | `Nombre de Caso`                          | Texto largo                                                                       | `casos.nombre_caso`                                                                               | Existe                  | 37              | 37 de 37, incluidos los 3 bloques sin número y el duplicado.                                                                                                                                                                       |
| F         | `Narración Cronológica técnica social`    | Párrafo largo por caso                                                            | ninguna columna; candidata `core.caso_cronologia`                                                 | Sin destino             | 36              | La mayor brecha de texto del libro. `caso_cronologia` es 1:N (un hecho con fecha por fila): partir el párrafo exige descomponer a mano, no se puede automatizar sin inventar fechas. Falta en la fila 118.                         |
| G         | `Análisis de Caso`                        | Hipervínculo a carpeta de Google Drive; el rótulo dice «Análisis del Caso- Canva» | `casos.link_analisis_caso` (nueva en 41; sustituye a `link_reporte_pdf`)                          | Existe con matiz        | 32              | 32 enlaces, todos a **carpeta**, no a documento. Faltan en 118, 122, 124, 127 y 132. No pasa a `core.documentos`: no hay archivo ni tipo.                                                                                          |
| H         | `Timestamp de ultima actualización`       | En la práctica, un estado                                                         | `casos.estado_actualizacion` (nueva en 41)                                                        | Colisión de vocabulario | 33              | El encabezado promete una marca de tiempo y el contenido es un vocabulario: `No aplica` 26, `Pendiente` 6, `Actualizado ` 1 (con espacio final). 4 bloques sin dato.                                                               |
| I         | `Descripción del Riesgo Actual`           | Texto                                                                             | `casos.descripcion_riesgo`                                                                        | Existe con matiz        | 27              | Solo el texto: **el nivel** del riesgo actual no está aquí sino en Reporte c38. Faltan 10 celdas (43, 47, 48, 49, 60, 113, 118, 127, 128, 132). El importador actual no la escribe.                                                |
| J         | `Actores del Estado`                      | Texto libre con listas                                                            | `core.actores` + `core.casos_actores` existen, sin clave de unión                                 | Sin destino             | 34              | Nombres separados por comas o saltos de línea. Faltan en 118, 122 y 127. No hay identificador: unir exige captura manual.                                                                                                          |
| K         | `Actores Sociedad Civil`                  | Texto libre con listas                                                            | ídem J                                                                                            | Sin destino             | 34              | Misma carencia y mismas ausencias que J.                                                                                                                                                                                           |
| L         | `Demandas`                                | Celda con lista numerada de demandas                                              | `core.demandas.descripcion_demanda`                                                               | Existe                  | 23              | Una celda con varios puntos: el importador la parte en demandas (19 registros). La demanda del modelo pide desglose 3P, que el Excel no trae.                                                                                      |
| M         | `Temática`                                | Catálogo del equipo, 3 valores                                                    | `casos.tematica_equipo` (nueva en 41)                                                             | Existe con matiz        | 16              | `Ordenanamiento y acceso territorial` 7, `Gobernanza` 5, `Normatividad` 4. Decisión tomada: no se fuerza `cat_tematicas`, se guarda el texto del equipo.                                                                           |
| N         | `Acciones/Compromisos/Acuerdos`           | Lista de acciones                                                                 | `core.compromisos.accion_compromiso`                                                              | Existe                  | 56              | 56 celdas; varias acciones por caso. 4 son rechazadas por no tener fecha de inicio demostrable (filas 25, 26, 38, 42).                                                                                                             |
| O         | `Medios de Verificaciones`                | Texto operativo                                                                   | ninguna; candidata `hitos_compromiso.descripcion_evidencia`                                       | Sin destino             | 44              | Es una instrucción («Acción 1: Adjuntar…»), no un archivo ni una URI. 44 celdas; el importador cuenta 50 ocurrencias porque la celda se reparte entre compromisos.                                                                 |
| P         | `Área Responsable de Monitoreo de Acción` | Siglas separadas por «/»                                                          | `core.cat_unidades_organicas` por coincidencia; sin match, unidad del caso                        | Existe con matiz        | 55              | 16 grafías: FONDEPES 16, DGPA 7, DGAAMPA 7, DGPCHDI 4, DGSFS-PA 3, DGPARPA 3, DGA 2, IMARPE 2, `DIPFORPA / DGPA` 1, `DGPARP` 1. El catálogo legado escribe `DPFORPA` y no tiene `DGPARPA`: no se corrige el catálogo, se advierte. |
| Q         | `Punto Focal Monitoreo`                   | Persona, **por acción**                                                           | `compromisos.punto_focal_usuario_id` / `_texto` (migración 41 baja el focal de caso a compromiso) | Existe con matiz        | 48              | 16 personas, máximo Juan Carlos Cordova 8, Carlos Escobar 7, Jocabed Canchari 7. En la base el focal era **por caso**; el Excel es **por acción**: cambia la granularidad.                                                         |
| R         | `Documentos / Archivos / Otros`           | Texto libre                                                                       | `core.documentos` no puede recibirlo sin título ni tipo                                           | Sin destino             | 31              | Texto que menciona documentos, no identificadores. La migración 41 añade `documentos.autor_usuario_id` / `autor_texto`, pero no resuelve el alta sin título y tipo.                                                                |
| S         | `Hito`                                    | Etiqueta secuencial                                                               | `hitos_compromiso.codigo_hito`                                                                    | Existe                  | 111             | Hito 1: 44, Hito 2: 27, Hito 3: 23, Hito 4: 11, Hito 5: 5, Hito 6: 1.                                                                                                                                                              |
| T         | `Descripción del Hito`                    | Texto                                                                             | `hitos_compromiso.descripcion_hito`                                                               | Existe                  | 117             | Más descripciones que etiquetas: 8 descripciones sin etiqueta (68, 113, 118 a 123) y 2 etiquetas sin descripción (47, 49).                                                                                                         |
| U         | `Responsable del Hito`                    | Persona, área o tercero                                                           | `hitos_compromiso.responsable_usuario_id` / `responsable_texto` (migración 41, excluyentes)       | Existe con matiz        | 103             | 29 valores distintos: FONDEPES 28, COMPRAS A MYPERÚ 10, IMARPE 8, DIREPRO 7, DGPARPA 6; también terceros (PNP, MEF, MINEM) y listas con «/» que no son ni persona ni área única.                                                   |
| V         | `Fecha Planificada`                       | Fecha, a veces texto                                                              | `hitos_compromiso.fecha_vencimiento` + `fecha_vencimiento_texto`                                  | Existe con matiz        | 52              | 31 fechas tipadas y **21 celdas de texto** (`31.12.2025, 02, 03 y 05.01.2026`, `Indefinido`, `Depende de entrega de obra`, `-`). La fecha tipada queda NULL y el texto se conserva.                                                |
| W         | `Fecha Real`                              | Fecha, a veces texto                                                              | `hitos_compromiso.fecha_real` + `fecha_real_texto`                                                | Existe con matiz        | 33              | 20 fechas tipadas y **13 celdas de texto**. El dry-run declara 9 (lista 10 filas): cifra inestable, se reporta la del libro.                                                                                                       |
| X         | `Estado Actual`                           | Vocabulario de 4 valores                                                          | `hitos_compromiso.estado_id` → `cat_estados_hito`                                                 | Colisión de vocabulario | 109             | Cumplido 61, `No Cumplido` 45, `No cumplido` 2, Desestimado 1. En las 111 filas con etiqueta de hito: 59 / 41 / 2 / 1 y 8 vacías. La base no tenía «No cumplido»: la migración 41 crea el id 6.                                    |
| **Total** |                                           |                                                                                   |                                                                                                   |                         | **1 176**       |                                                                                                                                                                                                                                    |

Lecturas que conviene retener:

- **S/T/X no cuadran entre sí.** 111 etiquetas, 117 descripciones, 109 estados y 8 etiquetas sin estado. El bloque de hitos se llenó por filas independientes, no por registro.
- **P y Q son campos distintos en el Excel y en la base, al revés que en el Anexo 15.** El Anexo 15 usa «área responsable / punto focal» por caso; el Excel los separa y da un focal **por acción**.
- **`Maestros` sí tiene la tabla área → focal** (filas 25 a 42: `Area Responsable`, `Punto Focal`, `Confirmados`). Que el Excel no tenga clave de unión no significa que no exista una tabla de correspondencia: existe, pero es un cuadro auxiliar, no una FK.

---

## Reporte de avance — columna por columna

Encabezados en la fila 1; datos en las filas 2 a 106, en **32 bloques**. Un bloque (fila 105) no trae `N°`: es duplicado del caso 15, como la fila 128 de la hoja principal.

### Identificación (c1–c7)

| Col | Encabezado                     | Qué contiene                              | Destino en AVISA                                        | Estado           | Celdas con dato | Observación                                                                                                                                                                         |
| --- | ------------------------------ | ----------------------------------------- | ------------------------------------------------------- | ---------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `N°`                           | Número de bloque                          | ninguno: no es clave                                    | Existe con matiz | 31              | 1 bloque sin número (fila 105).                                                                                                                                                     |
| 2   | `Departamento`                 | Texto libre                               | `casos.region_principal_id` solo con coincidencia única | Existe con matiz | 32              | Misma regla que B de la hoja principal.                                                                                                                                             |
| 3   | `Alcance Geográfico`           | Catálogo de 5 valores                     | `casos.alcance_id` → `cat_alcances_geograficos`         | Existe con matiz | 32              | Centro 11, Norte 8, Nacional 7, Sur 3, Oriente 2 y **`Regional` 1**, valor que el catálogo no tiene: se declara y ese caso queda sin alcance tipado.                                |
| 4   | `Nombre de Caso`               | Texto largo                               | `casos.nombre_caso`                                     | Existe           | 32              | Debe coincidir con E de la hoja principal; es la vía de emparejamiento de bloques.                                                                                                  |
| 5   | `Sub Sector`                   | 2 valores                                 | `casos.subsector_id` → `cat_subsectores`                | Existe           | 31              | `Pesca y Acuicultura` 28, `Mype e Industria` 3. Diferencia solo de capitalización frente al catálogo (`MYPE e industria`).                                                          |
| 6   | `Temática del Caso`            | Catálogo del equipo, **otro** vocabulario | `casos.tematica_equipo` (nueva en 41)                   | Existe con matiz | 25              | `Recursos y Regulación` 12, `Infraestructura` 12, `Socio-Ambiental` 1. **No coincide con M de la hoja principal**: un mismo caso puede tener dos temáticas distintas según la hoja. |
| 7   | `Problemática/Resumen de Caso` | Párrafo                                   | ninguna columna propia                                  | Sin destino      | 30              | 30 celdas de resumen que no tienen dónde caer. No es `resumen_ejecutivo` (c21), que es otro campo.                                                                                  |

### Riesgo (c8–c9)

| Col | Encabezado                | Qué contiene        | Destino en AVISA                              | Estado                  | Celdas con dato | Observación                                                                                                               |
| --- | ------------------------- | ------------------- | --------------------------------------------- | ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 8   | `Descripción del Riesgo`  | Texto               | `casos.descripcion_riesgo`                    | Existe                  | 24              | Repite I de la hoja principal con otras palabras y menos cobertura.                                                       |
| 9   | `Nivel de Riesgo Inicial` | Escala de 4 valores | `casos.nivel_riesgo_inicial_id` (nueva en 41) | Colisión de vocabulario | 30              | Intermedio 19, Bajo 8, Inminente 2, Crítico 1. El catálogo tiene 3 niveles: la equivalencia exige ratificación de OAIPCS. |

### Intervención (c10–c13)

| Col | Encabezado                      | Qué contiene      | Destino en AVISA                                            | Estado           | Celdas con dato | Observación                           |
| --- | ------------------------------- | ----------------- | ----------------------------------------------------------- | ---------------- | --------------- | ------------------------------------- |
| 10  | `Acciones/Compromisos/Acuerdos` | Lista de acciones | `core.compromisos.accion_compromiso`                        | Existe           | 46              | Duplica N con menos filas.            |
| 11  | `Medios de Verificaciones`      | Texto operativo   | ninguna; candidata `hitos_compromiso.descripcion_evidencia` | Sin destino      | 18              | Igual que O: instrucción, no archivo. |
| 12  | `Área Responsable de Monitoreo` | Siglas            | `cat_unidades_organicas` con matiz                          | Existe con matiz | 45              | Misma tabla de grafías que P.         |
| 13  | `Punto Focal Monitoreo`         | Persona           | `compromisos.punto_focal_*`                                 | Existe con matiz | 44              | Misma granularidad por acción que Q.  |

### Hitos (c14–c20)

| Col | Encabezado             | Qué contiene            | Destino en AVISA                                     | Estado                  | Celdas con dato | Observación                                                                                                                                                                                 |
| --- | ---------------------- | ----------------------- | ---------------------------------------------------- | ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `Hito`                 | Etiqueta                | `hitos_compromiso.codigo_hito`                       | Existe                  | 100             | 100 etiquetas frente a 111 de la hoja principal: 11 hitos no llegan al Reporte.                                                                                                             |
| 15  | `Descripción del Hito` | Texto                   | `hitos_compromiso.descripcion_hito`                  | Existe                  | 98              | —                                                                                                                                                                                           |
| 16  | `Validación de Hito`   | Texto de validación     | `hitos_compromiso.validacion`                        | Existe                  | 101             | `Validado` 86 y 5 variantes para lo mismo: `Plan pendiente de aprobación` 6, `Validación Pendiente` 3, `Pendiente validacion` 3, `Por Validar` 2, `Validad` 1. Es texto libre, no catálogo. |
| 17  | `Responsable del Hito` | Persona, área o tercero | `hitos_compromiso.responsable_usuario_id` / `_texto` | Existe con matiz        | 99              | Igual que U.                                                                                                                                                                                |
| 18  | `Fecha Planificada`    | Fecha                   | `fecha_vencimiento` + texto                          | Existe con matiz        | 47              | —                                                                                                                                                                                           |
| 19  | `Fecha Real`           | Fecha                   | `fecha_real` + texto                                 | Existe con matiz        | 29              | —                                                                                                                                                                                           |
| 20  | `Estado Actual`        | Vocabulario             | `hitos_compromiso.estado_id`                         | Colisión de vocabulario | 103             | Cumplido 52, `No Cumplido` 50, Desestimado 1. Sin la grafía en minúscula: aquí el Excel es más consistente que X.                                                                           |

### Resumen (c21)

| Col | Encabezado                        | Qué contiene     | Destino en AVISA          | Estado          | Celdas con dato | Observación                                                                                                                                                                                                                               |
| --- | --------------------------------- | ---------------- | ------------------------- | --------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21  | `Resumen Ejecutivo al 17.02.2026` | Resumen del caso | `casos.resumen_ejecutivo` | Error de origen | 32              | **31 celdas con `#REF!`**. La única con texto real es la fila 105 (tiburón), justamente el bloque duplicado. No se carga: es un error del libro, no un dato. El dry-run registra 27 ocurrencias porque descarta los bloques no operables. |

### Seguimiento semanal (c22–c37)

Ocho pares `Nudos Críticos del …` / `Seguimiento del …`, del 01 al 09 de febrero de 2026 hasta el 29 de abril al 04 de mayo de 2026.

| Col | Encabezado (semana)                   | Qué contiene | Destino en AVISA                               | Estado           | Celdas con dato | Observación                                                                   |
| --- | ------------------------------------- | ------------ | ---------------------------------------------- | ---------------- | --------------- | ----------------------------------------------------------------------------- |
| 22  | Nudos del 01 al 09 feb 2026           | Texto        | `core.caso_nudo_critico.descripcion` (41 + 43) | Existe con matiz | 41              | —                                                                             |
| 23  | Seguimiento del 01 al 09 feb 2026     | Texto        | `core.caso_nudo_critico.seguimiento`           | Existe con matiz | 33              | —                                                                             |
| 24  | Nudos del 10 al 16 feb 2026           | Texto        | ídem                                           | Existe con matiz | 18              | —                                                                             |
| 25  | Seguimiento del 10 al 16 feb 2026     | Texto        | ídem                                           | Existe con matiz | 25              | —                                                                             |
| 26  | Nudos del 17 al 23 feb 2026           | Texto        | ídem                                           | Existe con matiz | 3               | —                                                                             |
| 27  | Seguimiento del 17 al 23 feb 2026     | Texto        | ídem                                           | Existe con matiz | 3               | —                                                                             |
| 28  | Nudos del 24 feb al 02 mar 2026       | Texto        | ídem                                           | Existe con matiz | 6               | —                                                                             |
| 29  | Seguimiento del 24 feb al 02 mar 2026 | Texto        | ídem                                           | Existe con matiz | 16              | —                                                                             |
| 30  | Nudos del 03 al 09 mar 2026           | Texto        | ídem                                           | Existe con matiz | 3               | —                                                                             |
| 31  | Seguimiento del 03 al 09 mar 2026     | Texto        | ídem                                           | Existe con matiz | 7               | —                                                                             |
| 32  | Nudos del 10 al 17 mar 2026           | Texto        | ídem                                           | Existe con matiz | 21              | —                                                                             |
| 33  | Seguimiento del 10 al 17 mar 2026     | Texto        | ídem                                           | Existe con matiz | 11              | —                                                                             |
| 34  | Nudos del 18 al 23 mar 2026           | Texto        | ídem                                           | Existe con matiz | 17              | —                                                                             |
| 35  | Seguimiento del 18 al 23 mar 2026     | Texto        | ídem                                           | Existe con matiz | 17              | —                                                                             |
| 36  | Nudos del **29 abr al 04 may** 2026   | Texto        | ídem                                           | Existe con matiz | 9               | **Par 8 descuadrado**: el nudo dice 29 abr–04 may y el seguimiento 04–11 may. |
| 37  | Seguimiento del **04 al 11 may** 2026 | Texto        | ídem                                           | Existe con matiz | 24              | No existe el par 04–11 may de nudos: la semana está incompleta en origen.     |

Total del bloque: **254 celdas**, de las cuales 118 son nudos y 136 seguimientos. Esa asimetría de 18 celdas es la huella del descuadre: hay seguimiento sin nudo que declarar. El nudo no tiene clave propia en el Excel: se vincula por **posición** dentro del bloque, no por fila de hito, lo que obligó a la migración 43 a rehacer los índices únicos.

### Cierre (c38)

| Col | Encabezado               | Qué contiene        | Destino en AVISA        | Estado                  | Celdas con dato | Observación                                                                                                                    |
| --- | ------------------------ | ------------------- | ----------------------- | ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 38  | `Nivel de Riesgo Actual` | Escala de 4 valores | `casos.nivel_riesgo_id` | Colisión de vocabulario | 31              | Intermedio 14, Bajo 14, Inminente 2, Crítico 1. Es el **único** lugar del libro donde vive el nivel de riesgo actual del caso. |

---

## Alertas

`Seguimiento de Alertas`: 101 registros, 14 columnas con dato (15 a 28 vacías).

| Col | Encabezado                       | Destino en AVISA                   | Estado                  | Con dato | Observación                                                                                                                                    |
| --- | -------------------------------- | ---------------------------------- | ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Tipo`                           | `alertas_tempranas.fuente_tipo`    | Existe                  | 101      | REPORTE RAPIDO 49, ALERTA TEMPRANA 37, CLIMA SOCIAL 14, PLAN DE ACCIÓN RÁPIDA 1.                                                               |
| 2   | `Código de reporte`              | `codigo_legado`                    | Existe con matiz        | 50       | 49 códigos distintos: `AT-2026-18` se repite. Las 51 restantes reciben `MATRIZ-A####`.                                                         |
| 3   | `Código de caso de conflicto`    | `caso_id`                          | Sin destino             | 0        | **Vacía en las 101 filas.** Ninguna alerta está vinculada a un caso.                                                                           |
| 4   | `Responsable principal`          | `sectorista_usuario_id` por nombre | Existe con matiz        | 101      | André Jiménez 30, Esteban Vidal 28, Angeles Arenas 19, Peggy Contreras 16, Ivan Ascurra 8.                                                     |
| 5   | `Fecha`                          | `fecha_reporte`                    | Existe                  | 101      | —                                                                                                                                              |
| 6   | `Región`                         | `distrito_id` vía resolución       | Existe con matiz        | 100      | La resolución depende de Región + Provincia + Distrito.                                                                                        |
| 7   | `Provincia`                      | ídem                               | Existe con matiz        | 81       | —                                                                                                                                              |
| 8   | `Distrito`                       | ídem                               | Existe con matiz        | 76       | **25 alertas sin distrito resoluble**: el distrito queda NULL.                                                                                 |
| 9   | `Titulo`                         | `titulo`                           | Existe                  | 101      | —                                                                                                                                              |
| 10  | `Tipo de Alerta`                 | `fuente_descripcion`               | Colisión de vocabulario | 37       | Solo `REACTIVA` 16 y `PREVENTIVA` 21, y solo en las 37 alertas tempranas. `nivel_alerta_id` (4 niveles) no tiene equivalencia 1:1: queda NULL. |
| 11  | `Resumen ejecutivo`              | `situacion_actual`                 | Existe                  | 95       | —                                                                                                                                              |
| 12  | `Contenido`                      | `hechos_recientes`                 | Existe                  | 95       | —                                                                                                                                              |
| 13  | `Conclusiones y recomendaciones` | `acciones_oaipcs`                  | Existe                  | 91       | —                                                                                                                                              |
| 14  | `Documento`                      | ninguno                            | Sin destino             | 0        | Columna vacía.                                                                                                                                 |

Hallazgos duros: **0 de 101 alertas traen caso**, 25 no resuelven distrito, 51 no traen código, 16 ya existían en la base (el dry-run inserta 85 y omite 16 por `ya_existe`). Sin `caso_id`, la alerta entra como hecho suelto y el vínculo alerta–caso queda pendiente de captura.

## Reuniones

`Seguimiento de Reuniones`: 46 registros, 13 columnas, encabezado en la fila 2.

| Col | Encabezado              | Destino en AVISA               | Estado           | Con dato | Observación                                                                                                        |
| --- | ----------------------- | ------------------------------ | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `Tipo`                  | `reuniones_dialogo.programada` | Existe con matiz | 18       | Programado 16, No Programado 2. 28 sin tipo.                                                                       |
| 2   | `Código`                | `codigo_legado` generado       | Existe con matiz | 0        | **Vacía en las 46.** Se genera `MATRIZ-RR####`.                                                                    |
| 3   | `Sector`                | ninguno                        | Sin destino      | 18       | `Pesca y Acuicultura` 16, `Mypes e Industria` 2. La base escribe `MYPE e Industria`. El importador la descarta.    |
| 4   | `Responsable principal` | `responsable_usuario_id`       | Existe con matiz | 18       | Resolución por nombre.                                                                                             |
| 5   | `Fecha`                 | `fecha`                        | Existe con matiz | 46       | 2 con fecha en rango: `08-09/07/2026` (fila 33) y `16-17/07/2026` (fila 36). No se convierte: no se estima un día. |
| 6   | `Departamento`          | `region_texto`                 | Existe           | 46       | —                                                                                                                  |
| 7   | `Lugar`                 | `lugar`                        | Existe           | 18       | Solo en los 18 registros detallados.                                                                               |
| 8   | `Titulo`                | `titulo`                       | Existe           | 44       | 2 reuniones sin título.                                                                                            |
| 9   | `Asistencia`            | ninguno                        | Sin destino      | 46       | 16 verdadero / 30 falso.                                                                                           |
| 10  | `AM`                    | ninguno                        | Sin destino      | 46       | 3 verdadero.                                                                                                       |
| 11  | `RELATORIA`             | ninguno                        | Sin destino      | 46       | 7 verdadero.                                                                                                       |
| 12  | `PUBLICACIÓN / NOTA`    | ninguno                        | Sin destino      | 46       | 2 verdadero.                                                                                                       |
| 13  | `Documentos`            | ninguno                        | Sin destino      | 9        | Etiqueta de texto, no archivo.                                                                                     |

Hallazgos duros: **0 de 46 reuniones indican el caso** y no existe columna que lo permita; **28 registros traen solo fecha, departamento, título y los cuatro booleanos**. `reuniones_dialogo.caso_id` era NOT NULL, por eso la migración 42 lo hace nullable. De 46, entran 44 y se rechazan 2 por fecha en rango.

---

## Metadatos, Maestros, DVPA y DVMYPE-I

### `METADATOS CASOS`

6 columnas: `Código de Caso`, `Fecha registro Caso`, `Departamento`, `Sectorista`, `Prioridad de Atención`, `Nombre de Caso`. 37 filas, **no contiguas**: cada fila de metadatos corresponde al bloque `fila_principal − 1`, así que hay que alinear por lista de filas con dato y no por rango.

| Hallazgo                     | Cifra                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| Filas                        | 37                                                                   |
| Sin código de caso           | 6 (filas de metadatos 117, 121, 123, 126, 127, 131)                  |
| `Departamento` y `Prioridad` | coinciden 37 / 37 con la hoja principal                              |
| `Sectorista`                 | **discrepa en 27 de 37 bloques**                                     |
| `Fecha registro`             | 34 celdas contienen solo el año (`2020.0`), 2 fechas reales, 1 vacía |

El desacuerdo de sectorista no es de grafía: es de plantel. `METADATOS` reparte André Jiménez 14, Peggy Contreras 10, Iván Ascurra 10 y Esteban Vidal 3; la hoja principal no tiene a André y sí a Karen Benito y Daniel Vela. Son dos fuentes de verdad para el mismo campo. **No hay clave real**: la única unión posible es posicional, y 6 filas quedan fuera.

### `Maestros`

19 listas de catálogo (filas 1 a 46) y 42 filas de espacios de diálogo (filas 50 a 92 y 99). Las listas son:

`Tipo_Caso`, `Alcance Geográfico`, `Nivel de Riesgo`, `Estado Actual`, `Rol en Conflicto`, `Prioridad`, `Sub Sector`, `Sectorista`, `Riesgo`, `Fases`, `Temática`, `Estado del Caso`, `Prioridad del Sector`, `Impacto Social`, `Área Responsable`, `Punto Focal`, `Confirmados`, `Mesas de Conflictos`, `Actualización`.

Dos aportes que sí sirven:

- **`Area Responsable` → `Punto Focal`** (encabezado en la fila 25, 17 filas de datos entre 26 y 42): es la tabla de correspondencia área–focal que el modelo no tiene como FK y que resolvería parte de P y Q. Aporta también `Confirmados` y una columna `Mesas de Conflictos` con texto libre.
- **`Actualización`** (4 valores: `Actualizado `, `En proceso`, `Pendiente`, `No aplica`): es exactamente el CHECK que la migración 41 crea en `casos.estado_actualizacion`, con espacio final incluido en el origen.

El resto de listas (`Fases`, `Riesgo`, `Impacto Social`, `Prioridad del Sector`, `Rol en Conflicto`) no tiene contraparte en el modelo y no se usa en ninguna otra hoja: es vocabulario de trabajo, no de sistema.

### `DVPA`

Encabezado en la fila 2, 23 columnas, **408 filas** de actores. Cobertura real:

| Columna                                                  | Con dato    | Destino                                                                     |
| -------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| `N°`                                                     | 24          | ninguno: numeración esporádica                                              |
| `Fecha de registro`                                      | 95          | ninguno                                                                     |
| `Foto Referencial`                                       | 0           | —                                                                           |
| `Departamento`                                           | 398         | `core.actores` vía distrito                                                 |
| `Provincia`                                              | 142         | ídem                                                                        |
| `Distrito`                                               | 174         | ídem                                                                        |
| `Nombres y Apellidos`                                    | 218         | `core.actores.nombre_actual`                                                |
| `DNI`                                                    | 5           | `actor_datos_personales` (dato sensible)                                    |
| `Cargo en Organización`                                  | 116         | sin destino directo                                                         |
| `Nombre de Organización`                                 | 401         | `core.actores.nombre_actual`                                                |
| `Acrónimo / Siglas`                                      | 27          | sin destino                                                                 |
| `Teléfono / Celular`                                     | 134         | `actor_datos_personales.telefono_contacto`                                  |
| `Correo Electrónico`                                     | 8           | sin destino                                                                 |
| `N° registro en SUNARP`                                  | 0           | —                                                                           |
| `Recursos principales que extraen`                       | 5           | sin destino                                                                 |
| Embarcaciones, socios, naves agrupadas                   | 0           | —                                                                           |
| `Perfil de Incidencia`                                   | 24          | sin destino (DIALOGANTE 10, DISRUPTIVO 9, LEGITIMANTE 4, SIN INFORMACIÓN 1) |
| `Postura vs PRODUCE`                                     | 24          | parcial: `casos_actores.posicion` con otro vocabulario                      |
| `Cap. Movilización` / `Negociación` / `Influencia` (1–5) | 24 cada una | sin destino                                                                 |

Ninguna hoja del libro aporta la relación actor–caso: `DVPA` es un padrón, no una matriz. El vínculo con `core.casos_actores` no se puede inferir.

### `DVMYPE-I`

6 × 17, 4 filas, y las cuatro dicen `(Representante por registrar)`. **No aporta ningún campo nuevo al modelo**: es una plantilla vacía. No se importa.

---

## Catálogos que no casan

| Catálogo de `Maestros`  | Valores en el Excel                                                                                                                                                 | Valores en la base                                             | Decisión o pendiente                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Nivel de Riesgo`       | 4: `Bajo (inicial y sin protestas)`, `Intermedio (acciones públicas de protestas)`, `Inminente (Escala por decisión o hecho)`, `Crítico (violencia, bloqueos, etc)` | 3: Bajo, Moderado, Alto (`cat_niveles_riesgo` 1–3)             | La migración 41 propone renombrar Moderado → Intermedio y Alto → Inminente, y crear Crítico. **Pendiente de ratificación de OAIPCS**: el renombre cambia el significado de los casos históricos. |
| `Estado Actual` (hitos) | 3: `Cumplido`, `No Cumplido`, `Desestimado`                                                                                                                         | 5: Registrado, En ejecución, Paralizado, Cumplido, Desestimado | La base no tenía «No cumplido». La migración 41 lo crea con id 6. Los 3 valores del Excel entran; los 3 estados de proceso no existen en el origen: se declaran ausentes.                        |
| `Actualización` (caso)  | 4: `Actualizado `, `En proceso`, `Pendiente`, `No aplica`                                                                                                           | no existía                                                     | Columna nueva `casos.estado_actualizacion` con CHECK idéntico al vocabulario del Excel. Entra completo.                                                                                          |
| `Temática`              | Reporte c6: `Infraestructura`, `Recursos y Regulación`, `Socio-Ambiental`; hoja principal M: `Ordenanamiento y acceso territorial`, `Gobernanza`, `Normatividad`    | 6 (`cat_tematicas` 1 a 6)                                      | Decisión tomada: no se toca el catálogo. El texto del equipo va a `casos.tematica_equipo`.                                                                                                       |

Dos notas de precisión sobre esta tabla:

- **`cat_tematicas` tiene 6 filas** (ids 1 a 6): Infraestructura, Ordenamiento y acceso territorial, Normatividad, Distribución de beneficios, Gobernanza, Impactos de terceros. Verificado contra la base el 2026-11-24.
- **La colisión temática está cruzada entre las dos hojas.** La hoja principal (M) usa `Ordenanamiento y acceso territorial` (7 celdas), `Gobernanza` (5) y `Normatividad` (4): los tres existen en el catálogo, con ids **2, 5 y 3** respectivamente (el id 2 conserva la errata «Ordenanamiento» documentada en el propio catálogo). La hoja Reporte (c6) usa `Recursos y Regulación` (12), `Infraestructura` (12) y `Socio-Ambiental` (1): sólo `Infraestructura` casa con el catálogo (id 1). Es decir: **los valores huérfanos son los del Reporte, no los de la hoja principal**.

Otros desajustes menores, fuera de `Maestros`:

- `Alcance Geográfico`: el Excel trae `Regional` (1 celda, c3) y el catálogo tiene 1 a 5 (Norte, Centro, Sur, Oriente, Nacional). No se fuerza.
- `Sub Sector`: el catálogo escribe `MYPE e industria`; el Reporte `Mype e Industria` y Reuniones `Mypes e Industria`. Casa por insensible a mayúsculas; la tercera grafía se corrige al cargar.
- `Prioridad de Atención`: casa 1/2/3 sin traducción. Es el único catálogo limpio.

---

## Las 12 brechas

Ordenadas por impacto. «Celdas» es la cuenta de la hoja correspondiente.

1. **Narración cronológica (F).** El párrafo que explica el caso no tiene columna: `core.casos` no guarda narrativa y `core.caso_cronologia` es 1:N con una fecha por hecho. Afecta **36 celdas**. Salida: campo nuevo de texto en `casos` para el párrafo íntegro, y captura manual de la versión estructurada en `caso_cronologia`. No se parte el texto automáticamente.
2. **Actores en texto libre (J/K).** 68 celdas con nombres separados por comas, sin identificador, sin vínculo actor–caso en ninguna hoja. Salida: captura manual asistida contra `core.actores` y `core.casos_actores`; el texto original se conserva como nota declarada o se descarta.
3. **Problemática/Resumen de caso (c7 del Reporte).** 30 celdas de síntesis que no tienen columna propia; no deben confundirse con `resumen_ejecutivo`. Salida: campo nuevo `casos.problematica_resumen`.
4. **Medios de verificación (O / c11).** 44 celdas en la hoja principal (50 ocurrencias al desagregar por compromiso) y 18 en el Reporte. No son archivos: son instrucciones. Salida: usar `hitos_compromiso.descripcion_evidencia`, que ya existe en la base; no crear `core.documentos`.
5. **Documentos / Archivos / Otros (R).** 31 celdas de texto que mencionan documentos. `core.documentos` exige título y tipo. Salida: captura manual del alta documental; si no, campo de texto `casos.documentos_referencia`. Se descarta la idea de convertirlo en documento automáticamente.
6. **Desglose 3P de la demanda.** 23 celdas; el modelo exige `problema_3p` y `pedido_3p` como NOT NULL y el Excel trae un solo bloque numerado. Salida: cargar el texto íntegro en `problema_3p`, declarar propuesta y pedido ausentes y completarlos por captura manual. No se duplica el mismo texto en tres campos.
7. **Nivel de riesgo: 4 valores frente a 3.** 61 celdas (30 en c9 + 31 en c38). El catálogo no tiene «Intermedio», «Inminente» ni «Crítico». Salida: ampliar y renombrar el catálogo según la migración 41, **con ratificación de OAIPCS**; mientras tanto, el nivel queda NULL y el texto se conserva.
8. **Estado del hito.** 109 celdas en X y 103 en c20; 47 celdas dicen «No cumplido» con dos grafías y el catálogo no lo tenía. Salida: id 6 creado por la migración 41 y normalización de grafía al cargar. Los estados de proceso (Registrado, En ejecución, Paralizado) no existen en el origen: se declaran ausentes, no se infieren.
9. **Capacidades 1–5, perfil y postura (DVPA).** 24 filas × 5 columnas = 120 celdas. `core.actores` no tiene esas columnas; `casos_actores.posicion` usa otro vocabulario (Apoyo, Oposición, Neutral, No dialogante) y `nivel_influencia` va de 1 a 100. Salida: tabla nueva de perfilado de actores o campo de texto; **no reescalar 1–5 a 1–100 sin una regla aprobada**.
10. **Alertas sin caso.** 101 registros, 0 con código de caso; además 25 sin distrito resoluble y 51 sin código de reporte. Salida: `caso_id` NULL y vinculación manual posterior; `nivel_alerta_id` NULL porque REACTIVA/PREVENTIVA no son 4 niveles.
11. **Reuniones sin caso.** 46 registros, 0 con código, 28 sin tipo, sector ni responsable. Salida: `caso_id` nullable (migración 42), `tipo_id` NULL; los cuatro booleanos necesitan columnas nuevas o se descartan.
12. **Sectorista con dos planteles.** 74 celdas (37 en C + 37 en `METADATOS`), 27 discrepancias. Salida: definir la fuente de verdad —se propone la hoja principal— y resolver por nombre contra `core.usuarios`. Las discrepancias se registran; no se promedian ni se elige en silencio.

---

## Lo que sí entra completo

Sin decisión adicional, y con el importador en seco ya coherente:

- **37 nombres de caso** (E), incluidos los que después se descartan por otras razones.
- **37 prioridades** (D) a `prioridad_id` 1/2/3.
- **23 demandas** en 19 registros, 16 nuevas y 3 ya existentes.
- **56 acciones** en 49 compromisos propuestos: 41 insertados, 4 ya existentes y 4 rechazados.
- **111 etiquetas y 117 descripciones de hito** en 95 hitos propuestos: 87 insertados, 7 omitidos y 1 rechazado.
- **31 y 20 fechas tipadas** de planificación y ejecución (V y W).
- **32 enlaces de análisis** (G) a `link_analisis_caso`.
- **Alcance, subsector y validación de hito** (c3, c5, c16), salvo la celda `Regional`.
- **Estado de hito** (X, c20) con la grafía normalizada.
- **Nivel de riesgo actual** (c38) en cuanto el catálogo esté ratificado.
- **85 de 101 alertas**, con caso NULL declarado.
- **44 de 46 reuniones**, con caso NULL declarado.
- **146 nudos** de 184 propuestos (38 descartados: 24 repetidos idénticos, 12 de bloques no operables y 2 rechazados por `sin_numero_excel`).

---

## Lo que no se carga y por qué

| Qué                               | Cuánto                                              | Por qué                                                                                                                                       |
| --------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Bloques sin destino               | 3 (filas 20, 43, 49; N° 3, 13 y 16)                 | No tienen caso equivalente en la base: no figuran en el mapa de origen, así que no hay `casos.id` donde colgar demandas, compromisos ni hitos |
| Bloque duplicado                  | 1 (fila 128, N° 15 repetido)                        | Repite el bloque de la fila 48; se conserva la primera aparición                                                                              |
| Caso anulado                      | 1 (fila 64, N° 20)                                  | El caso equivalente en la base tiene `anulado_en` no nulo; el importador lo excluye salvo `--incluir-anulados`                                |
| Casos sin `reporte_avance`        | 5 (filas 118, 122, 124, 127, 132)                   | No tienen bloque en la hoja Reporte: sin riesgo actual, sin resumen y sin nudos                                                               |
| Etiquetas de hito sin descripción | 2 (filas 47 y 49)                                   | `descripcion_hito` es NOT NULL. Solo 1 llega al cargador; la de la fila 49 pertenece a un bloque sin destino                                  |
| Compromisos sin `fecha_inicio`    | 4 (filas 25, 26, 38, 42)                            | `fecha_inicio` es NOT NULL y no hay fecha demostrable; arrastran sus 4 hitos                                                                  |
| Reuniones con fecha en rango      | 2 (filas 33 y 36: `08-09/07/2026`, `16-17/07/2026`) | No se estima un día dentro del rango                                                                                                          |
| Celdas `#REF!`                    | 31 (c21)                                            | Error de origen. 27 llegan al cargador porque 4 pertenecen a bloques no operables                                                             |
| Fechas no tipadas                 | 21 en V y 13 en W                                   | Se guardan como texto; la fecha queda NULL. 3 de V y 1 de W son `dd.mm.aaaa` y sí se convierten                                               |
| Etiquetas de hito sin estado      | 8 (filas 10, 11, 47, 49, 73, 110, 111, 112)         | No se supone «Registrado» como estado real: se declara vacío                                                                                  |
| Enlaces de análisis ausentes      | 5 (filas 118, 122, 124, 127, 132)                   | No hay celda con hipervínculo                                                                                                                 |
| Descripciones de riesgo ausentes  | 10 celdas en I                                      | Vacías en origen                                                                                                                              |
| Alertas sin distrito              | 25                                                  | La terna Región/Provincia/Distrito no resuelve a un distrito único                                                                            |
| Alertas sin código de reporte     | 51                                                  | Se les asigna un código generado, no uno del origen                                                                                           |
| Sectorista divergente             | 27 de 37 bloques                                    | Dos planteles; se usa la hoja principal y se registra la discrepancia                                                                         |

### Cifras del encargo que no se confirman

Se contrastaron contra el libro. Estas no se sostienen:

| El encargo decía                                                       | Medido                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Hoja principal «1003 × 24 útiles»                                      | 1 003 × 28 declaradas; datos hasta la fila 132; 1 176 celdas con dato en 37 bloques                                                   |
| Reporte «1005 × 38» con 31 bloques                                     | Datos hasta la fila 106; **32 bloques** (31 con `N°`, 1 duplicado sin número)                                                         |
| M trae `Infraestructura` / `Recursos y Regulación` / `Socio-Ambiental` | Esos son los valores de **c6 del Reporte**. M trae `Ordenanamiento y acceso territorial` 7, `Gobernanza` 5, `Normatividad` 4          |
| `cat_tematicas` tiene 6 valores                                        | **Sin discrepancia: la base tiene 6** (ids 1 a 6). El «7» del primer borrador fue un error de lectura, corregido el 2026-11-24        |
| H contiene el estado `Actualizado`                                     | Contiene 3 estados: `No aplica` 26, `Pendiente` 6, `Actualizado ` 1                                                                   |
| METADATOS: 4 bloques sin código                                        | **6**                                                                                                                                 |
| 3 casos sin `reporte_avance`                                           | **5**                                                                                                                                 |
| 1 hito sin descripción                                                 | **2** etiquetas (filas 47 y 49), aunque solo 1 llega al cargador                                                                      |
| 21 valores de fecha no convertibles                                    | 21 en V **y 13 en W**                                                                                                                 |
| Solo `Infraestructura` coincide con el catálogo temático               | Los tres valores de M coinciden (`Ordenanamiento...` → id 2, `Gobernanza` → id 5, `Normatividad` → id 3): los huérfanos son los de c6 |
| El catálogo escribe `DPFORPA` (errata)                                 | Correcto, y además el Excel escribe `DGPARPA` (3) y `DGPARP` (1), que no existen en ningún catálogo                                   |

Se confirman, en cambio: los 3 bloques sin `N°` (118, 127 y 132), el duplicado del 15 en 48 y 128, los 3 bloques sin destino, el caso anulado, los 4 compromisos sin `fecha_inicio`, las 2 reuniones con fecha en rango, las 31 celdas con `#REF!`, las 101 alertas con la distribución 49/37/14/1 y 0 con caso, las 46 reuniones con 0 códigos, los 16 códigos de alerta preexistentes y las prioridades 1/2/3 con alcances 1 a 5.
