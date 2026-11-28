# Importación de la matriz de casos

Diseño de la importación de la matriz de conflictos del equipo hacia casos, demandas y actores.
Fuente de verdad del formato: `docs/05_datos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx`.
Referencias de código: `scripts/matriz/parser_matriz.py` (lector de escritorio) y el catálogo de
importaciones de Angular (`angular/src/app/features/importacion/`).

## 1. Estructura real del libro

### 1.1 Hojas

| Hoja | Rango usado | Encabezado | Papel |
|---|---|---|---|
| `CASOS OAIPCS - OPERATIVO` | 1000 × 27 (el alto es formato; los datos empiezan en la fila 3) | fila 1: bandas; fila 2: columnas | Fuente principal de casos, demandas y actores |
| `METADATOS CASOS` | 331 × 6 | fila 1 | Código, fecha de registro, sectorista y prioridad por caso |
| `Reporte de avance de casos punt` | 306 × 38 | fila 1 | Sólo `Sub Sector` (E) y `Problemática/Resumen de Caso` (G) como apoyo |
| `Seguimiento de Alertas` | 302 × 28 | fila 1 | Fuera de alcance de esta importación |

### 1.2 Particularidades de la hoja operativa

- **Dos filas de encabezado.** La fila 1 contiene bandas combinadas y la fila 2 los nombres
  reales de columna. El lector fija la primera fila de datos en la 3 (`parser_matriz.py:54`).
- **Bandas de la fila 1:** `IDENTIFICACIÓN` (A–D), `ANÁLISIS Y RIESGOS` (E–H),
  `ACTORES Y DEMANDAS` (I–L), `COMPROMISOS` (M–Q) e `HITOS (NO SE ACTUALIZARÁ)` (R–Y).
  Las columnas 26 y 27 no tienen encabezado y existen sólo por formato.
- **405 rangos combinados.** Sin expandirlos, la mayor parte de las filas parece vacía
  (`parser_matriz.py:9-10`; la expansión está en `parser_matriz.py:310-319`). Cada rango se
  rellena con el valor de su celda de origen.
- **Un caso es un bloque de filas.** Empieza donde la columna D (`Nombre de Caso`) tiene valor
  propio y termina antes del siguiente inicio (`parser_matriz.py:365-370` y `409-412`). El
  propio parser documenta 37 bloques reales frente a 130 si se segmentara por «D no vacía»
  (`parser_matriz.py:11-14`).
- **El eje fino es la fila.** Cada fila es un hito o una demanda sin hito; la demanda (K) va por
  fila y el compromiso (M) se combina y se expande (`parser_matriz.py:15-21`).
- **La última fila se calcula,** no se toma de `max_row`: se recorre la hoja y se conserva la
  última fila con algún valor en las 25 columnas (`parser_matriz.py:372-378`).
- **Metadatos alineados.** `METADATOS CASOS` empieza en la fila 2, se resuelve por nombre
  normalizado y se valida por posición (`parser_matriz.py:25-27` y `322-347`).

### 1.3 Columnas exactas (fila 2)

| Col | Encabezado exacto | Banda |
|---|---|---|
| A | `N°` | IDENTIFICACIÓN |
| B | `Región` | IDENTIFICACIÓN |
| C | `Sectorista` | IDENTIFICACIÓN |
| D | `Nombre de Caso` | IDENTIFICACIÓN |
| E | `Linea de tiempo` | ANÁLISIS Y RIESGOS |
| F | `Análisis de Caso (Nota 25NOV26: Solo a los que ya tienen y a los 8 casos prioritarios)` | ANÁLISIS Y RIESGOS |
| G | `Descripción del Riesgo Actual` | ANÁLISIS Y RIESGOS |
| H | `Riesgo` | ANÁLISIS Y RIESGOS |
| I | `Actores del Estado ` (con espacio final) | ACTORES Y DEMANDAS |
| J | `Actores Sociedad Civil ` (con espacio final) | ACTORES Y DEMANDAS |
| K | `Demandas` | ACTORES Y DEMANDAS |
| L | `Temática` | ACTORES Y DEMANDAS |
| M | `Acciones/Compromisos/Acuerdos \n\nValidar con Punto Focal` | COMPROMISOS |
| N | `Fuente del compromiso` | COMPROMISOS |
| O | `Área Responsable de Monitoreo de Acción` | COMPROMISOS |
| P | `Punto Focal Monitoreo` | COMPROMISOS |
| Q | `Status` | COMPROMISOS |
| R | `Hito` | HITOS |
| S | `Descripción del Hito (puntos de referencia que sirve para medir cuánto se ha avanza hacia el resultado final.)\nValidar con Punto Focal` | HITOS |
| T | `Responsable del Hito` | HITOS |
| U | `Fecha Planificada` | HITOS |
| V | `Fecha Real` | HITOS |
| W | `Estado Actual  (Nota 25NOV26: Referencial, lo que va a valer es el de la columna naranja)` | HITOS |
| X | `Medios de verificación` | HITOS |
| Y | `Documentos (relatoria, AM, etc.)` | HITOS |

Los encabezados se reconocen sin tildes, sin mayúsculas y con espacios colapsados
(`importacion.validar.ts:110-143`).

### 1.4 Hoja `METADATOS CASOS`

| Col | Encabezado | Uso |
|---|---|---|
| A | `Código de Caso` | Clave de conciliación con casos ya cargados (no se escribe como código nuevo) |
| B | `Fecha registro Caso` | Fecha de registro, no de inicio del conflicto |
| C | `Departamento` | Duplicado de la región; no se usa |
| D | `Sectorista` | No se importa (ver §2.2) |
| E | `Prioridad de Atención` | `prioridad` del caso; en el archivo aparece `Urgente` |
| F | `Nombre de Caso` | Conciliación por nombre normalizado |

## 2. Mapa columna de Excel → campo del sistema

Reglas del sistema: `titulo` y `region` son las únicas obligatorias
(`importacion.tipos.ts:53-68`); la validación de fila construye el payload en
`importacion.validar.ts:271-321`.

| Campo | Origen | ¿Obligatorio? | Regla de conversión |
|---|---|---|---|
| `titulo` | D `Nombre de Caso` | Sí | Texto recortado; es la etiqueta del caso y la clave de deduplicación |
| `region` | B `Región` | Sí | Una región por caso; se valida contra las 25 regiones y sus alias (`ubigeo.ts:53-102`) |
| `tematica` | L `Temática` | No | Temática canónica de la primera demanda del bloque. El catálogo de seis valores está en `parser_matriz.py:93-110`; el caso no la exige, la demanda sí |
| `subsector` | `Reporte de avance de casos punt` E `Sub Sector` | No | Sólo por cruce de nombre; no existe en la hoja operativa |
| `naturaleza` | — | No | No hay columna de origen. Se deja sin declarar |
| `riesgo` | H `Riesgo` | No | Catálogo `Bajo`, `Medio`, `Alto` (`mapeo.ts:93`); el archivo usa `Medio` |
| `conflictividad` | — | No | No hay columna de origen. Catálogo `Diferencia`, `Controversia`, `Conflicto social`, `Crisis social` (`modelos.ts:11`) |
| `prioridad` | `METADATOS CASOS` E | No | Catálogo `Urgente`, `Medio`, `Bajo` (`mapeo.ts:95-99`) |
| `fechaInicio` | `METADATOS CASOS` B | No | `AAAA-MM-DD`, `DD/MM/AAAA` o `DD-MM-AAAA` (`importacion.validar.ts:53-65`). Es fecha de registro: úsese sólo si el usuario lo decide (§7) |
| `resumen` | G `Descripción del Riesgo Actual` | No | Texto largo; recortar al límite de la ficha. Alternativa: `Reporte de avance…` G `Problemática/Resumen de Caso` |
| `demandas` | K `Demandas` | Sí en modo «casos con demandas» | Una demanda por fila. En plantilla plana se admiten `|`, `;` o salto de línea (`importacion.validar.ts:51`) |
| `demandas[].tematica` | L de la misma fila | Sí por demanda | Si falta, la demanda se rechaza porque la API la exige (`importacion.tipos.ts:223-225`) |
| Actores | I `Actores del Estado`, J `Actores Sociedad Civil` | No | Celdas compuestas: se separan por doble salto, `/` y coma de primer nivel (`parser_matriz.py:212-228`); se extraen nombre, cargo, institución y teléfono (`parser_matriz.py:231-273`) |
| Actor: `nombre` | Primera línea del bloque | Sí | Se descarta el bloque sin nombre |
| Actor: `cargo` | Línea que coincide con cargos conocidos | No | Lista en `parser_matriz.py:127-149` |
| Actor: `telefono` | Línea con `Cel:`, `Tel:` o formato de nueve dígitos | No | Se guardan sólo dígitos (`parser_matriz.py:238-246`) |
| Actor: organización | `Nombre - Asociación X` | No | Si el nombre contiene persona y entidad, se crea también la organización (`parser_matriz.py:285-292` y `520-535`) |
| Actor: `tipo` | Origen de la celda | No | I → actor público (`TIPO_ACTOR_PUBLICO`, `importacion.validar.ts:418`); J → tipo social del catálogo, por confirmar (§7) |
| Actor: `funcion`, `posicionamiento` | — | No | Sin origen en la matriz; quedan nulos |
| Código del caso | `METADATOS CASOS` A | No | Sólo clave de conciliación. El código definitivo lo emite la base (`importacion.tipos.ts:200-202`) |

### 2.1 Columnas descartadas a propósito

| Columna | Motivo |
|---|---|
| A `N°` | Numeración de Excel; no es un identificador estable |
| C `Sectorista` | Es una persona, no la unidad responsable; no tiene campo equivalente en el alta |
| E `Linea de tiempo` | Cronología narrativa; pertenece a hechos, fuera del alta de casos |
| F `Análisis de Caso` | Texto de trabajo interno; no es el resumen de la ficha |
| M–Q (compromisos) | Los consume el importador de Anexo 15 / compromisos, no el de casos |
| R–Y (hitos) | La propia banda dice `NO SE ACTUALIZARÁ`; fuera de alcance |
| Código `CS-…` como dato nuevo | Nunca se importa como código; sólo sirve para conciliar (§6) |

## 3. Los tres modos

Los modos son alcances del mismo importador. El catálogo actual ya define `casos` y
`casos-demandas` (`importacion.tipos.ts:189-226`); «casos con actores» exige añadir un tipo y
endpoints de alta de actores y vínculos. Hoy el tipo `matriz` sólo delega y no aplica cambios
desde la interfaz (`importacion.tipos.ts:292-305`).

| Modo | Id propuesto | Crea | Reutiliza (dedupe) | No toca |
|---|---|---|---|---|
| Sólo casos | `casos` | Un caso por bloque con título, región, temática, riesgo, prioridad, fecha y resumen | Caso existente por `(título normalizado, regiones normalizadas)`; si coincide, se omite (`importacion.validar.ts:313`) | Demandas, actores, compromisos, hitos |
| Casos con demandas | `casos-demandas` | Caso + sus demandas de K, cada una con la temática de su fila | Caso existente como arriba; demanda existente por `(caso, texto normalizado)`; no se duplica | Actores, compromisos, hitos |
| Casos con actores | `casos-actores` | Caso + actores de I y J + organizaciones derivadas de `representa_a` + vínculo actor–caso | Caso existente; actor por nombre normalizado; organización por nombre normalizado (`parser_matriz.py:509-535`) | Demandas, compromisos, hitos |

Precisiones:

- **Dedupe por nombre normalizado.** Se aplica la misma normalización del parser: mayúsculas,
  sin tildes, sólo alfanuméricos y espacios colapsados (`parser_matriz.py:152-156`).
- **Duplicados dentro del archivo.** El primero manda; el segundo se rechaza con
  `DUPLICADO_EN_ARCHIVO` (`importacion.validar.ts:207-215`). El parser además marca
  `duplicado_de` cuando dos bloques comparten `caso_id` (`parser_matriz.py:394-405`).
- **Ejecución recomendada del libro completo:** primero «casos con demandas» y después «casos
  con actores». La segunda pasada reutiliza los casos y no duplica demandas ni actores.
- **Modo 3 no crea demandas** aunque K tenga texto. Si se necesita todo, se ejecutan los dos
  modos; la idempotencia (§6) lo hace seguro.

## 4. Textos de interfaz

### 4.1 Encabezado

- Título: **«Importar matriz de casos»**
- Subtítulo: **«Cargue la matriz de conflictos del equipo. No se guarda nada hasta que confirme la previsualización.»**
- Aviso fijo: **«La hoja debe llamarse «CASOS OAIPCS - OPERATIVO». El sistema reconoce sus columnas por el encabezado de la fila 2.»**

### 4.2 Pasos numerados

1. **«Descargue la plantilla»** — «Descargue la plantilla y consérvela como referencia. Si ya tiene la matriz del equipo, puede usarla tal cual.»
2. **«Complete una fila por caso»** — «No cambie los nombres de las columnas. Un caso puede ocupar varias filas: sólo la primera lleva el nombre del caso.»
3. **«Arrastre el archivo»** — «Arrastre aquí el libro de Excel (.xlsx) o elija el archivo desde su equipo.»
4. **«Previsualice»** — «Revise qué casos, demandas y actores se crearán y cuáles se reutilizarán. Nada se guarda todavía.»
5. **«Confirme»** — «Si la previsualización es correcta, confirme la importación. Esta acción crea registros y no se puede deshacer en bloque.»

### 4.3 Botones

- `Descargar plantilla`
- `Elegir archivo`
- `Arrastrar aquí` (zona de carga)
- `Previsualizar`
- `Volver`
- `Confirmar importación`
- `Cancelar`

### 4.4 Previsualización

- Título: **«Previsualización»**
- Columnas: **«Fila»**, **«Caso»**, **«Región»**, **«Demandas»**, **«Actores»**, **«Estado»**
- Distintivos: **«Se creará»**, **«Se reutilizará»**, **«Rechazada»**
- Texto de cabecera: **«Se leerán N bloques de caso. Revise los rechazos antes de confirmar.»**
- Pie: **«Los cambios todavía no se han guardado.»**

### 4.5 Resumen final

- **«Se crearán N casos, M demandas y K actores. Se reutilizarán C casos, D demandas y A actores existentes. R filas serán rechazadas.»**
- Variante sin actores: **«Se crearán N casos y M demandas. Se reutilizarán C casos y D demandas existentes. R filas serán rechazadas.»**
- Si no hay rechazos: **«Se crearán N casos, M demandas y K actores. No hay filas rechazadas.»**

### 4.6 Éxito

- **«Importación completada. Se crearon N casos, M demandas y K actores.»**
- **«Puede revisar los casos en la lista de casos.»**

### 4.7 Éxito parcial

- **«Importación completada con observaciones. Se crearon N casos, M demandas y K actores; R filas no se pudieron importar.»**
- **«Descargue el detalle de los rechazos para corregirlos y vuelva a importar sólo esas filas.»**

### 4.8 Cancelación

- **«Importación cancelada. No se guardó ningún cambio.»**

## 5. Catálogo de errores

Severidad: **archivo** bloquea toda la carga; **fila** rechaza sólo esa fila; **aviso** no impide
continuar.

| Código interno | Severidad | Mensaje exacto al usuario | Qué debe hacer |
|---|---|---|---|
| `ARCHIVO_NO_EXCEL` | archivo | «El archivo no es un libro de Excel (.xlsx). En Excel use «Archivo → Guardar como → Libro de Excel (.xlsx)» y vuelva a intentarlo.» | Guardar como `.xlsx` y volver a elegir el archivo |
| `HOJA_NO_ENCONTRADA` | archivo | «No se encontró la hoja «CASOS OAIPCS - OPERATIVO». El archivo debe ser la matriz del equipo, sin cambiar el nombre de la hoja.» | Usar el libro original o renombrar la hoja |
| `ENCABEZADO_FALTANTE` | archivo | «Faltan columnas obligatorias: «Nombre de Caso», «Región». La fila 2 debe contener: «N°», «Región», «Sectorista», «Nombre de Caso», «Linea de tiempo», «Análisis de Caso», «Descripción del Riesgo Actual», «Riesgo», «Actores del Estado», «Actores Sociedad Civil», «Demandas», «Temática», «Acciones/Compromisos/Acuerdos», «Fuente del compromiso», «Área Responsable de Monitoreo de Acción», «Punto Focal Monitoreo», «Status», «Hito», «Descripción del Hito», «Responsable del Hito», «Fecha Planificada», «Fecha Real», «Estado Actual», «Medios de verificación», «Documentos».» | Restaurar los encabezados de la fila 2; no fusionar ni mover columnas |
| `FILA_SIN_TITULO` | fila | «La fila N no tiene «Nombre de Caso». Cada bloque debe empezar con el nombre del caso.» | Completar D en la primera fila del bloque o eliminar el bloque |
| `REGION_NO_RECONOCIDA` | fila | «La región «X» de la fila N no está en el catálogo. Use una de las 25 regiones: Amazonas, Áncash, Apurímac, Arequipa, Ayacucho, Cajamarca, Callao, Cusco, Huancavelica, Huánuco, Ica, Junín, La Libertad, Lambayeque, Lima, Loreto, Madre de Dios, Moquegua, Pasco, Piura, Puno, San Martín, Tacna, Tumbes, Ucayali.» | Corregir B. Se aceptan además `Callao`, `Lima Metropolitana` y `Lima Provincias` como alias (`ubigeo.ts:96-102`) |
| `RIESGO_FUERA_CATALOGO` | fila | «El riesgo «X» de la fila N no está en el catálogo. Valores admitidos: Bajo, Medio, Alto.» | Reemplazar por uno de los tres valores |
| `CONFLICTIVIDAD_FUERA_CATALOGO` | fila | «La conflictividad «X» de la fila N no está en el catálogo. Valores admitidos: Diferencia, Controversia, Conflicto social, Crisis social.» | Reemplazar por uno de los cuatro valores |
| `TEMATICA_FUERA_CATALOGO` | fila | «La temática «X» de la fila N no está en el catálogo. Valores admitidos: Infraestructura, Ordenamiento y acceso territorial, Normatividad, Distribución de beneficios, Gobernanza, Impactos de terceros.» | Corregir L. La errata `ordenanamiento` se corrige sola (`parser_matriz.py:303-307`) |
| `DEMANDA_SIN_TEMATICA` | fila | «La demanda «X» de la fila N no tiene temática. Asigne una de las seis temáticas del catálogo o la demanda no se creará.» | Completar L en la misma fila de K |
| `ACTOR_SIN_TIPO` | fila | «El actor «X» de la fila N no tiene tipo. Indique un tipo del catálogo de actores o el actor no se creará.» | Completar el tipo; en I/J se deduce del origen, pero debe existir en el catálogo |
| `FECHA_INVALIDA` | fila | ««X» no es una fecha válida en «Fecha de inicio». Use AAAA-MM-DD, DD/MM/AAAA o DD-MM-AAAA.» | Corregir la fecha; el formato se valida en `importacion.validar.ts:53-65` |
| `DUPLICADO_EN_ARCHIVO` | fila | ««X» ya aparece en una fila anterior de este archivo.» | Dejar una sola aparición; la primera se conserva |
| `CASO_YA_EXISTENTE` | aviso | «El caso «X» ya existe en el sistema (código CS-…). Se reutilizará y no se creará otro.» | Nada; si no debía reutilizarse, cambiar el título o la región |
| `LIMITE_FILAS` | archivo | «El archivo supera el límite de 400 filas por tanda.» | Dividir el libro en tandas de hasta 400 filas (`importacion.validar.ts:19` y `186-194`) |

`CASO_YA_EXISTENTE` es aviso, no rechazo: el caso se reutiliza y, según el modo, se le añaden
demandas o actores que falten.

## 6. Salvaguardas

1. **Máximo de filas.** 400 filas por tanda (`importacion.validar.ts:19`). El excedente se
   rechaza con `LIMITE_FILAS` y la previsualización se marca como truncada
   (`importacion.validar.ts:186-194` y `220`).
2. **Dos fases.** «Previsualizar» no escribe: sólo valida, concilia y resume. «Confirmar» es la
   única acción que crea registros. Si se cancela, no hay cambios.
3. **Transacción por fila.** Cada bloque se crea en una transacción: caso, luego demandas,
   luego actores y vínculos. Si falla un bloque, se revierte ese bloque y se continúa; lo ya
   creado no se borra. El servicio ya reporta el error por fila (`importacion.service.ts:190-195`).
4. **Resumen de fallidas.** Al terminar se muestra el conteo y se ofrece el detalle descargable
   con `fila`, `caso`, `código` y `mensaje`.
5. **Reintento idempotente.** Reimportar el mismo archivo no duplica: los casos se concilian por
   `(título normalizado, regiones normalizadas)`; las demandas por `(caso, texto normalizado)`;
   los actores y organizaciones por nombre normalizado. Lo existente se reutiliza y sólo se
   crean los faltantes.
6. **Evitar duplicados al reimportar.** Antes de crear un caso se busca, en este orden:
   (a) código `CS-…` de `METADATOS CASOS`; (b) nombre normalizado en `METADATOS CASOS`;
   (c) título y región en el sistema. Si cualquiera coincide, el caso se reutiliza
   (`parser_matriz.py:322-347` y `553-568`).
7. **No se sobrescribe ni se borra.** La importación sólo crea registros y vínculos faltantes;
   nunca actualiza el texto de un caso, una demanda o un actor existente ni elimina filas.
8. **Bloqueo temprano.** Si falta la hoja o una columna obligatoria, no se procesa ninguna
   fila: la validación de cabecera se ejecuta antes que la de filas
   (`importacion.validar.ts:164-181`).
9. **Celdas combinadas.** Se expanden antes de leer; sin eso, la mayor parte de la hoja parece
   vacía (`parser_matriz.py:9-10` y `310-319`). La expansión no altera el archivo original.
10. **Normalización única.** Títulos, nombres, regiones y temáticas se comparan con la misma
    función de normalización (`parser_matriz.py:152-156`), para que «Áncash» y «ANCASH» no
    generen duplicados.

## 7. Decisiones pendientes

1. **Naturaleza y conflictividad.** No existen columnas de origen. ¿Se dejan sin declarar
   (`null`) o se exige completarlas después en la ficha?
2. **Fecha de inicio.** `METADATOS CASOS` B es «Fecha registro Caso», no el inicio del
   conflicto. ¿Se usa como `fechaInicio`, se deja vacía o se pide una columna nueva?
3. **Riesgo fuera de catálogo.** La hoja `Reporte de avance…` trae valores como
   `Intermedio (acciones públicas de protestas)` y el sistema sólo admite `Bajo`, `Medio` y
   `Alto`. ¿Se mapea, se rechaza o se deja sin declarar?
4. **Subsector y resumen.** ¿Se toma `Sub Sector` de `Reporte de avance…` por cruce de nombre?
   ¿El resumen sale de G de la hoja operativa o de G de `Reporte de avance…`?
5. **Guardado de actores.** Confirmar qué tipo del catálogo corresponde a «Sociedad civil» y si
   las organizaciones derivadas de `Nombre - Asociación X` deben crearse siempre.
6. **Política de reimportación.** ¿Omitir en silencio los casos existentes, avisar en la
   previsualización o rechazarlos? La propuesta es avisar y reutilizar.
7. **Ejecutor.** Hoy la matriz está marcada como `delegar` y no se aplica desde la interfaz
   (`importacion.tipos.ts:292-305`). ¿Se habilita la ejecución desde la web o se mantiene el
   importador de escritorio con confirmación?
