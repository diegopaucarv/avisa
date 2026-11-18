# Diccionario de datos — AVISA / SIPRECS

Generado el 2026-11-18 desde la base viva con `migration/generar_diccionario.py` [9]. No se edita a mano: se regenera.

## 1. Qué es este documento

Es el diccionario único del sistema. Describe, con el mismo formato, las dos capas que hoy conviven en la base: el **sistema anterior** (87 tablas con columnas posicionales) y el **modelo v10** (255 tablas lógicas en 26 esquemas, de los cuales uno solo contiene vistas, más 30 objetos derivados).

Para cada tabla dice qué guarda, cuántas filas y columnas tiene, cuáles son sus claves y relaciones, y qué significa cada columna. Para el sistema anterior añade el destino que tiene en v10, de modo que un mismo documento sirve para leer el pasado y el presente.

Es el entregable 1.1 del plan del producto mínimo [6]: el inventario que cualquier lectura posterior del sistema debe consultar antes de escribir código.

Tres cosas que este documento **no** es:

- No es el documento de cambios entre versiones. Ese es el documento padre [4], que explica qué se conserva y qué cambia, con su estadística comparada.
- No es el diseño del modelo. Ese es `AVISA_PRODUCE_v10.md` [5]; aquí solo se describe lo que existe hoy en la base.
- No repite el mapa columna a columna del sistema anterior. Ese detalle vive en el análisis de portabilidad, §3 [2], y aquí solo se resume.

### Cifras de esta edición

| Dimensión | Sistema anterior | Modelo v10 |
| --- | --: | --: |
| Tablas lógicas | 87 | 255 |
| Particiones de tabla | 0 | 24 |
| Tablas físicas | 87 | 279 |
| Columnas (sin particiones) | 807 | 2 036 |
| Columnas (con particiones) | 807 | 2 366 |
| Filas | 4 729 | 12 257 |
| Objetos derivados (vistas y matviews) | 0 | 30 |

El total de columnas que recorre este diccionario es 3 173: 2 366 del modelo v10 contando sus particiones, más 807 del sistema anterior. De ellas, 2 036 tienen comentario en la propia base y 197 tienen significado documentado por curaduría; el resto aparece con `—`.

## 2. Cómo se generó y cómo se regenera

```
python migration/generar_diccionario.py
```

El script lee la base, escribe `docs/DICCIONARIO_DATOS.md` y `docs/diccionario_datos.csv`, y no modifica nada en la base. Necesita la base local levantada; cómo hacerlo y con qué credenciales está en el manual de entorno [8].

De dónde sale cada dato:

- **Estructura**: tablas, columnas, tipos, nulabilidad, valores por defecto, claves primarias, ajenas, únicas e índices salen del catálogo del motor (`pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`).
- **Filas**: se cuentan con `count(*)` al generar. No se usan estimaciones, porque la base las tenía desactualizadas.
- **Clasificación**: entrada, proceso, salida o transversal sale de BRECHA §12.1–12.6 [1]; las tablas que no aparecen allí se marcan como sin clasificar, y las vistas se marcan como salida por una regla explícita.
- **Propósito**: 255 de las 255 tablas del modelo v10 tienen comentario de tabla en la base, escrito por el parche de comentarios [12]; las del sistema anterior y las vistas vienen de tres módulos de curaduría escritos a partir de las columnas y las claves de cada tabla [10].
- **Descripciones de columna**: 2 036 columnas del modelo v10 llevan comentario propio en la base [12]. Las particiones heredan la descripción de su tabla padre (330 columnas), porque PostgreSQL no propaga los comentarios a las particiones. Del sistema anterior se documentan las columnas que la migración consume de forma directa; las otras 610 celdas quedan en `—`.

**Regla de honestidad**: ningún texto se deduce del nombre de la columna. `—` significa «sin descripción documentada», no «sin significado». Se prefiere un hueco visible a una glosa inventada.

El CSV es la versión para máquina: una fila por columna, con la misma información y sin texto de relleno. Es lo que se importa a un catálogo o se cruza con otro inventario.

## 3. Cómo leer una ficha

Cada tabla tiene un encabezado con su nombre completo y una línea de metadatos: clasificación, filas, columnas, clave primaria, número de relaciones e índices. Debajo, una frase con el propósito, y una tabla con las columnas. Las vistas y matviews (§6) tienen ficha más corta: propósito, filas y objetos que leen.

### Clasificación

| Clase | Nombre | Qué agrupa |
| --- | --- | --- |
| **I** | Entrada | Donde aterriza el dato del mundo. |
| **P** | Proceso | Intermedios de extracción, pauta y síntesis, con su trazabilidad. |
| **O** | Salida | Se deriva de datos ya presentes; reproducible con la misma base. |
| **INF** | Transversal | No es contenido: catálogos, parámetros, geografía, integraciones. |
| **X** | Archivo | No participa del flujo; se conserva por auditoría. |

En la ficha aparece la sigla, el nombre y la sección del BRECHA de donde sale, por ejemplo `I · Entrada (§12.1)`. Cuando la tabla no está en esa clasificación dice «Sin clasificar».

### Columna «Clave»

`PK` es la clave primaria; `FK → esquema.tabla` es una clave ajena y `FK → esquema.tabla(columna)` indica que el nombre de la columna de destino es distinto; `UQ` es una restricción de unicidad. Una columna puede acumular varias marcas.

Las claves únicas compuestas no caben en una celda y se anotan al pie de la tabla de columnas.

### Otras convenciones

- `Nulo`: `sí` cuando la columna admite nulos; `no` cuando está declarada como obligatoria.
- `—`: dato no disponible o no documentado. Nunca es un cero.
- `Particionada en N`: la tabla física se reparte en N particiones; las particiones no tienen ficha propia para no repetir la misma estructura.
- El esquema `public` no aparece: contiene tres objetos de la extensión PostGIS, ajenos al dominio.
- «Clase declarada» y «Clase en v10» solo existen en el sistema anterior: la primera es la clasificación histórica y la segunda la que quedó vigente tras la migración.
- Las columnas que terminan en `_cifrado` o `_hmac` guardan un dato personal protegido: la primera el valor cifrado y la segunda una huella que permite buscarlo y detectar duplicados sin descifrarlo. El esquema de protección se describe en el parche de seguridad de nivel alto [7].

## 4. Panorama

Las cifras de esta sección salen de la base en el momento de generar el documento y coinciden con las del CSV.

### 4.1 Tablas por esquema

| Esquema | Qué contiene | Tablas | Columnas | Filas | Clases |
| --- | --- | --: | --: | --: | --- |
| `agent` | Trazas de los agentes de IA: sesiones, pauta, llamadas al modelo, prompts y retroalimentación. | 11 | 94 | 5 | P |
| `analisis` | Planes de análisis y sus pasos: el puente entre el dato crudo y la pauta que se ejecuta. | 4 | 29 | 14 | P |
| `audit` | Registro inmutable de accesos y operaciones sobre datos personales. | 1 | 8 | 2 241 | INF |
| `avisa` | Entrada cruda: mensajes y adjuntos recibidos antes de validarse, más la cola de rechazos. | 2 | 19 | 0 | I |
| `chat` | Historial de conversación con el asistente, versionado por ramas y confirmaciones. | 14 | 148 | 0 | P |
| `community` | Módulo de expansión sobre organización comunitaria; hoy solo catálogos. | 1 | 10 | 0 | INF |
| `config` | Parámetros, aplicaciones, librerías, registro de esquemas y transiciones de estado. | 6 | 51 | 64 | INF, P |
| `consultation` | Módulo de expansión para consultas a actores; sin uso todavía. | 4 | 26 | 0 | INF |
| `core` | El dominio: casos, alertas, demandas, actores, documentos, compromisos y territorio. | 96 | 772 | 6 664 | I, INF, O, P |
| `ctx` | Contexto sistémico: variables externas, dominios y observaciones que condicionan el análisis. | 10 | 61 | 28 | I, P |
| `domain` | Módulo de expansión con artefactos de dominio; sin uso todavía. | 4 | 47 | 15 | INF |
| `economic` | Módulo de expansión económica; sin uso todavía. | 3 | 25 | 0 | INF |
| `forecast` | Módulo de expansión de pronóstico; sin uso todavía. | 3 | 26 | 0 | INF |
| `impact` | Módulo de expansión de evaluación de impacto; sin uso todavía. | 5 | 40 | 0 | INF |
| `ind` | Indicadores, plantillas de salida y sus espacios: la capa que produce cuadros de mando. | 9 | 87 | 3 | O |
| `kag` | Grafo de conocimiento: nodos, aristas, comunidades e hipótesis; hoy proyecta actores. | 30 | 205 | 3 187 | P |
| `lex` | Léxico del dominio: términos y sus variantes para el análisis de lenguaje. | 11 | 67 | 0 | INF |
| `model` | Fichas de los modelos que usa el sistema, con versión, uso y límites. | 1 | 18 | 12 | INF |
| `mype` | Módulo de expansión para mypes; sin uso todavía. | 1 | 17 | 0 | INF |
| `pesca` | Módulo de expansión pesquero; sin uso todavía. | 2 | 23 | 0 | INF |
| `policy` | Reglas de negocio y tipos de regla, con su vigencia. | 8 | 55 | 15 | INF |
| `proteccion` | Módulo de expansión de protección social; sin uso todavía. | 1 | 11 | 0 | INF |
| `qda` | Codificación cualitativa: proyectos, códigos, segmentos y libro de códigos. | 10 | 79 | 0 | P |
| `staging` | Aterrizaje temporal de importaciones externas antes de validarlas. | 2 | 18 | 0 | I |
| `territorio` | Módulo de expansión territorial; sin uso todavía. | 16 | 100 | 9 | INF |
| **Total modelo** | 25 esquemas | **255** | **2 036** | **12 257** | — |
| `legacy` | Sistema anterior, conservado como archivo | 87 | 807 | 4 729 | X |

El modelo tiene 279 tablas físicas: 255 lógicas y 24 particiones que reparten cuatro tablas del dominio: `agent.llm_call` (6), `agent.run_log` (6), `avisa.raw_ingest` (6), `ctx.observaciones` (6). Las fichas son de la tabla lógica, porque la partición repite su estructura; el CSV sí las incluye fila a fila.

Las cifras de esta sección se cuentan por tabla y no por línea del inventario del BRECHA §12: allí se agrupan filas («`core.cat_*` (38 distintas, 41 tablas)», «y 10 más») y se suman las vistas a la salida. Por eso los totales difieren de los 31 / 78 / 24 / 54 que declara ese capítulo, aunque la clase de cada tabla sea la misma.

### 4.2 Tablas por clasificación

| Clase | Qué significa | Tablas v10 | Columnas | Filas |
| --- | --- | --: | --: | --: |
| **I · Entrada** | Donde aterriza el dato del mundo. | 32 | 417 | 3 977 |
| **P · Proceso** | Intermedios de extracción, pauta y síntesis, con su trazabilidad. | 102 | 790 | 3 406 |
| **O · Salida** | Se deriva de datos ya presentes; reproducible con la misma base. | 14 | 132 | 914 |
| **INF · Transversal** | No es contenido: catálogos, parámetros, geografía, integraciones. | 104 | 677 | 3 434 |
| **Sin clasificar** | No aparece en BRECHA §12 y no es vista derivada | 3 | 20 | 526 |
| **X · Archivo** | Sistema anterior completo | 87 | 807 | 4 729 |

Tablas sin clasificar: `core.cronologia_vinculos`, `core.entidades`, `core.migracion_conflicto`. Ninguna aparece en el inventario del BRECHA §12: `core.entidades` recibe claves ajenas desde dos tablas de entrada y `core.migracion_conflicto` es una tabla de control de la propia migración.

### 4.3 Vistas y vistas materializadas

Resumen por esquema; las fichas de cada objeto están en §6.

| Esquema | Objetos | Vistas | Matviews | Columnas | Filas |
| --- | --: | --: | --: | --: | --: |
| `analytics` | 22 | 17 | 5 | 172 | 1 459 |
| `core` | 2 | 2 | 0 | 13 | 847 |
| `lex` | 1 | 1 | 0 | 6 | 0 |
| `mype` | 3 | 2 | 1 | 32 | 0 |
| `pesca` | 1 | 1 | 0 | 7 | 0 |
| `territorio` | 1 | 1 | 0 | 6 | 0 |
| **Total** | **30** | **24** | **6** | **236** | **2 306** |

## 5. Modelo v10

Las tablas lógicas del modelo, agrupadas por esquema. Dentro de cada esquema van en orden alfabético.

### 5.1 `agent`

Trazas de los agentes de IA: sesiones, pauta, llamadas al modelo, prompts y retroalimentación.

11 tablas · 94 columnas · 5 filas.

#### `agent.cat_detalle_schema`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 1 · **Columnas:** 4 · **Clave primaria:** `version` · **Relaciones:** 0 · **Índices:** 1

Esquemas JSON versionados que fijan la estructura del detalle de cada corrida de agente, para validar lo que registra la bitácora.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `version` | smallint | no | PK | Versión del esquema JSON que fija la estructura del detalle de una corrida |
| 2 | `agente` | character varying(40) | sí | — | Agente cuyo detalle de corrida valida este esquema JSON versionado |
| 3 | `esquema_json` | jsonb | no | — | Definición JSON que fija qué campos admite el detalle de la corrida |
| 4 | `vigente_desde` | date | no | — | Fecha desde la que rige esta versión del esquema de detalle |

#### `agent.feedback_log`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Corrección humana sobre la salida de un agente, con su justificación y el revisor que la emitió, para medir y ajustar su desempeño.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `ts` | timestamp with time zone | no | — | Momento en que se emitió la corrección humana sobre la salida del agente |
| 3 | `agente` | character varying(30) | no | — | Agente cuya salida fue corregida por el revisor |
| 4 | `input_ref` | jsonb | sí | — | Referencia al insumo que recibió el agente antes de producir la salida |
| 5 | `output_agente` | jsonb | sí | — | Salida original del agente que el revisor evaluó y corrigió |
| 6 | `correccion_humano` | jsonb | sí | — | Versión corregida por la persona que reemplaza la salida del agente |
| 7 | `justificacion` | text | sí | — | Motivo que el revisor expone para respaldar la corrección aplicada |
| 8 | `revisado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que emitió la corrección y respalda la revisión de la salida |

#### `agent.lessons_learned`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 1

Lección derivada de un error del agente, con el patrón detectado y un ejemplo, aprobada para incorporarse a sus plantillas de prompt.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `agente_destino` | character varying(30) | no | — | Agente al que se aplicará la lección en sus próximas plantillas |
| 3 | `tipo_error` | character varying(60) | sí | — | Categoría del error detectado que originó la lección aprendida |
| 4 | `patron` | text | no | — | Descripción del patrón de error que la lección busca evitar en adelante |
| 5 | `ejemplo_json` | jsonb | sí | — | Ejemplo concreto del error, guardado en JSON para ilustrar el patrón |
| 6 | `feedback_id` | uuid | sí | FK → agent.feedback_log(id) | Corrección humana de la que se deriva esta lección |
| 7 | `activo` | boolean | no | — | Indica si la lección ya se incorporó a las plantillas del agente |
| 8 | `aprobado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que aprobó la incorporación de la lección a las plantillas |
| 9 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `agent.llm_call`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 15 · **Clave primaria:** `id`, `ts` · **Relaciones:** 2 · **Índices:** 3 · **Particionada en:** 6

Registro de cada llamada a un modelo de lenguaje: modelo, versión, tokens, latencia, hash del prompt y veredicto de los guardrails.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `run_id` | uuid | sí | — | Ejecución del agente a la que pertenece la llamada, para agrupar su costo y su latencia |
| 3 | `ts` | timestamp with time zone | no | PK | Momento en que se hizo la llamada al modelo, parte de su clave de partición |
| 4 | `modelo` | character varying(80) | no | — | Nombre del modelo de lenguaje invocado en esta llamada |
| 5 | `version_modelo` | character varying(40) | no | — | Versión exacta del modelo que respondió, necesaria para reproducir la salida |
| 6 | `destino` | character varying(5) | no | — | Destino de ejecución indicado con un código corto, según dónde corre el modelo |
| 7 | `temperatura` | numeric(3,2) | sí | — | Temperatura usada al generar la respuesta, que fija su grado de variabilidad |
| 8 | `prompt_hash` | character(64) | no | — | Huella del prompt enviado, para detectar cambios sin guardar el texto completo |
| 9 | `version_plantilla_prompt` | character varying(40) | sí | — | Versión de la plantilla de prompt aplicada, para rastrear el origen del texto |
| 10 | `policy_snapshot_id` | uuid | sí | FK → policy.snapshot(id) | Instantánea de política vigente en la llamada, que fija sus reglas y límites |
| 11 | `tokens_in` | integer | sí | — | Cantidad de tokens consumidos por el prompt enviado al modelo |
| 12 | `tokens_out` | integer | sí | — | Cantidad de tokens producidos por el modelo en su respuesta |
| 13 | `latencia_ms` | integer | sí | — | Tiempo de respuesta de la llamada al modelo, medido en milisegundos |
| 14 | `veredicto_guardrails` | jsonb | sí | — | Resultado de los filtros de seguridad aplicados al prompt y a la respuesta |
| 15 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `agent.llm_call_fragmento`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `call_id`, `call_ts`, `fragmento_id` · **Relaciones:** 3 · **Índices:** 2

Vínculo entre una llamada al modelo y los fragmentos documentales que recuperó, con su posición y sus puntajes de fusión y reordenamiento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `call_id` | uuid | no | PK, FK → agent.llm_call_202611(id), agent.llm_call_default(id), agent.llm_call_202703(id), agent.llm_call_202702(id), agent.llm_call_202701(id), agent.llm_call_202612(id), agent.llm_call(id) | Llamada al modelo que recuperó el fragmento documental |
| 2 | `call_ts` | timestamp with time zone | no | PK, FK → agent.llm_call_202611(ts), agent.llm_call_default(ts), agent.llm_call_202703(ts), agent.llm_call_202702(ts), agent.llm_call_202701(ts), agent.llm_call_202612(ts), agent.llm_call(ts) | Momento de la llamada, que con su identificador completa la clave del vínculo |
| 3 | `fragmento_id` | uuid | no | PK, FK → kag.documento_fragmento(id) | Fragmento documental recuperado como insumo de la llamada |
| 4 | `rank_rrf` | integer | sí | — | Posición que el fragmento ocupó tras fusionar los resultados de búsqueda |
| 5 | `score_rrf` | numeric | sí | — | Puntaje de fusión del fragmento, que pondera sus apariciones en cada búsqueda |
| 6 | `score_rerank` | numeric | sí | — | Puntaje del reordenamiento final del fragmento dentro de la lista recuperada |

#### `agent.modelo_registro`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Padrón de modelos autorizados, con versión, hash de pesos, destinos permitidos y estado, para saber qué modelo puede operar cada consulta.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `modelo` | character varying(80) | no | — | Nombre del modelo autorizado a operar en el sistema |
| 3 | `version` | character varying(40) | no | — | Versión del modelo autorizado que queda bajo control de cambios |
| 4 | `hash_pesos` | character(64) | sí | — | Huella de los pesos del modelo, para verificar que no se alteraron |
| 5 | `alta` | date | no | — | Fecha en que el modelo se incorporó al padrón de modelos autorizados |
| 6 | `destinos_permitidos` | jsonb | no | — | Lista de destinos donde puede ejecutarse el modelo, en formato JSON |
| 7 | `estado` | character varying(10) | no | — | Situación del modelo en el padrón, como activo o retirado |

Claves únicas compuestas: `modelo`, `version`.

#### `agent.plantilla_prompt`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 4 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Plantilla de prompt versionada por agente, con su prompt de sistema, ejemplos y esquema de salida, para auditar una respuesta contra su origen.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(20) | no | — | Código corto que identifica la plantilla entre las de su mismo agente |
| 3 | `version` | character varying(20) | no | — | Versión de la plantilla, que permite comparar lo generado con cada una |
| 4 | `hash_prompt` | character(64) | no | — | Huella del prompt de sistema, para comprobar que la respuesta provino de él |
| 5 | `system_prompt` | text | no | — | Texto del prompt de sistema que orienta el comportamiento del agente |
| 6 | `few_shot_json` | jsonb | no | — | Ejemplos de entrada y salida incluidos en el prompt para guiar al agente |
| 7 | `output_schema_id` | character varying(60) | no | — | Identificador del esquema que debe cumplir la salida esperada del agente |
| 8 | `vigente_desde` | timestamp with time zone | no | — | Momento desde el que la plantilla puede usarse en producción |
| 9 | `vigente_hasta` | timestamp with time zone | sí | — | Momento en que la plantilla deja de usarse, vacío mientras siga vigente |
| 10 | `supersedes_id` | uuid | sí | FK → agent.plantilla_prompt(id) | Versión anterior de la plantilla que esta reemplaza |
| 11 | `activo` | boolean | no | — | Indica si la plantilla está habilitada para generar prompts |

Claves únicas compuestas: `codigo`, `version`.

#### `agent.run_log`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 13 · **Clave primaria:** `id`, `ts` · **Relaciones:** 0 · **Índices:** 2 · **Particionada en:** 6

Bitácora encadenada por hash de las decisiones de cada agente, con confianza, insumos y detalle, para probar que un resultado no fue alterado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `ts` | timestamp with time zone | no | PK | Momento en que el agente tomó la decisión, parte de la clave de la bitácora |
| 3 | `query_id` | uuid | sí | — | Consulta o solicitud que originó la decisión registrada por el agente |
| 4 | `usuario_id` | uuid | sí | — | Usuario en cuyo nombre actuó el agente durante la ejecución |
| 5 | `rol` | character varying(30) | sí | — | Rol del usuario con el que se ejecutó el agente, base de sus permisos |
| 6 | `agente` | character varying(30) | no | — | Agente que tomó la decisión consignada en la bitácora |
| 7 | `decision` | character varying(30) | sí | — | Tipo de decisión adoptada por el agente para atender la consulta |
| 8 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 9 | `input_hash` | character(64) | sí | — | Huella de los insumos usados por el agente, para verificar su integridad |
| 10 | `detalle` | jsonb | sí | — | Detalle de la decisión en JSON, con los datos que la sustentan |
| 11 | `prev_hash` | character(64) | sí | — | Hash de la entrada anterior de la cadena, que enlaza la bitácora |
| 12 | `hash` | character(64) | sí | — | Hash de esta entrada, que sella su contenido y encadena la siguiente |
| 13 | `detalle_schema_version` | smallint | sí | — | Versión del esquema JSON que estructura el detalle de la decisión |

#### `agent.sesion`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Sesión de un usuario con el agente, ligada a un plan de análisis; se conserva mientras se migra a la conversación versionada del esquema chat.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `usuario_id` | uuid | no | FK → core.usuarios(id) | Usuario que sostiene la sesión con el agente |
| 3 | `plan_id` | uuid | sí | FK → analisis.plan(id) | Plan de análisis al que se vincula la sesión del usuario |
| 4 | `estado` | character varying(10) | no | — | Situación de la sesión, como abierta o cerrada |
| 5 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 6 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `agent.sesion_paso`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `sesion_id`, `n` · **Relaciones:** 1 · **Índices:** 1

Paso de una sesión con el agente, con su tipo, contenido y momento, como registro lineal previo al esquema de conversación versionada.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `sesion_id` | uuid | no | PK, FK → agent.sesion(id) | Sesión a la que pertenece el paso registrado |
| 2 | `n` | integer | no | PK | Número de orden del paso dentro de la sesión |
| 3 | `tipo` | character varying(25) | no | — | Tipo de paso, como mensaje, consulta o respuesta del agente |
| 4 | `contenido` | jsonb | no | — | Contenido del paso en JSON, según lo que exija su tipo |
| 5 | `ts` | timestamp with time zone | no | — | Momento en que ocurrió el paso dentro de la sesión |

#### `agent.synthetic_test_cases`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Caso de prueba sintético generado desde un caso semilla, con la variación aplicada, la entrada, el resultado esperado y la exactitud obtenida.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_semilla_id` | uuid | no | FK → core.casos(id) | Caso real del que se derivó este caso de prueba sintético |
| 3 | `variacion` | character varying(20) | no | — | Tipo de variación aplicada al caso semilla para generar la prueba |
| 4 | `campo_modificado` | character varying(80) | no | — | Campo del caso semilla que se alteró al construir la variación |
| 5 | `entrada` | jsonb | no | — | Entrada sintética enviada al agente durante la prueba |
| 6 | `esperado` | jsonb | no | — | Resultado que el agente debería producir para esta entrada |
| 7 | `resultado` | jsonb | sí | — | Resultado que el agente produjo efectivamente al ejecutar la prueba |
| 8 | `exactitud` | numeric(4,3) | sí | — | Proporción de acierto del resultado frente al esperado, entre 0 y 1 |
| 9 | `valido` | boolean | no | — | Indica si el caso de prueba se considera utilizable en la medición |
| 10 | `ejecutado_en` | timestamp with time zone | no | — | Momento en que se ejecutó el caso de prueba contra el agente |

### 5.2 `analisis`

Planes de análisis y sus pasos: el puente entre el dato crudo y la pauta que se ejecuta.

4 tablas · 29 columnas · 14 filas.

#### `analisis.cat_herramientas`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 7 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de herramientas externas que puede ejecutar un paso de análisis: MAXQDA, ATLAS.ti, NVivo, IRaMuTeQ, R, Excel u otra.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(30) | no | UQ | Código estable de la herramienta, para referenciarla sin depender del nombre |
| 3 | `nombre` | character varying(80) | no | — | Nombre de la herramienta externa que puede ejecutar un paso de análisis |

#### `analisis.plan`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 5

Plan de análisis dirigido sobre un caso: pregunta, tipo, pauta propuesta, versión y responsables de crearlo y aprobarlo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso de conflictividad sobre el que se dirige el plan de análisis |
| 3 | `pregunta` | text | no | — | Pregunta que el plan busca responder con el análisis propuesto |
| 4 | `tipo` | character varying(12) | no | — | Tipo de análisis planteado, que condiciona los pasos y las herramientas |
| 5 | `estado` | character varying(25) | no | — | Situación del plan, como borrador, aprobado o cerrado |
| 6 | `pauta` | jsonb | sí | — | Pauta de análisis propuesta, con los lineamientos que guían los pasos |
| 7 | `version` | integer | no | — | Número de versión del plan, que aumenta con cada ajuste aprobado |
| 8 | `creado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que formuló el plan de análisis |
| 9 | `aprobado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que aprobó el plan y habilita su ejecución |
| 10 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 11 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `analisis.plan_paso`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 5

Paso de un plan de análisis con su instrucción, herramienta, entregable esperado, punto de ingesta y dependencia respecto de otro paso.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `plan_id` | uuid | no | FK → analisis.plan(id) | Plan de análisis al que pertenece el paso |
| 3 | `orden` | smallint | no | — | Posición del paso dentro de la secuencia del plan |
| 4 | `tipo_paso` | character varying(40) | no | — | Naturaleza del paso, como extracción, análisis o validación |
| 5 | `instruccion` | text | no | — | Indicación que debe seguir quien ejecuta el paso del plan |
| 6 | `herramienta_id` | smallint | sí | FK → analisis.cat_herramientas(id) | Herramienta externa prevista para ejecutar el paso |
| 7 | `entregable_esperado` | character varying(5) | sí | — | Formato en que debe entregarse el resultado del paso, de forma abreviada |
| 8 | `punto_ingesta_id` | smallint | sí | FK → analisis.punto_ingesta(id) | Punto de ingesta por donde se cargan al modelo los datos del paso |
| 9 | `depende_de` | uuid | sí | FK → analisis.plan_paso(id) | Paso previo que debe completarse antes de ejecutar este |
| 10 | `estado` | character varying(12) | no | — | Situación del paso, como pendiente, en curso o terminado |

Claves únicas compuestas: `plan_id`, `orden`.

#### `analisis.punto_ingesta`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 7 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de puntos de ingreso manual de datos, con su esquema de validación y el destino donde se cargan en el modelo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | UQ | Código estable del punto de ingesta, usado para referenciarlo |
| 3 | `descripcion` | text | no | — | Descripción del punto de ingesta y de los datos que admite |
| 4 | `esquema_validacion` | jsonb | sí | — | Reglas de validación en JSON que deben cumplir los datos cargados |
| 5 | `destino` | character varying(5) | no | — | Destino del modelo donde quedan cargados los datos ingresados |

### 5.3 `audit`

Registro inmutable de accesos y operaciones sobre datos personales.

1 tabla · 8 columnas · 2 241 filas.

#### `audit.datos_personales_acceso`

**Clasificación:** INF · Transversal (§12 (encabezado)) · **Filas:** 2 241 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 4

Bitácora inmutable de acceso y escritura sobre datos personales de actores, exigida por la Ley 29733: no se corrige, se amplía con una fila nueva.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | bigint | no | PK | Identificador interno del evento registrado en la bitácora |
| 2 | `ocurrido_en` | timestamp with time zone | no | — | Momento exacto en que ocurrió el acceso o la escritura auditada |
| 3 | `usuario` | text | no | — | Usuario de la sesión que ejecutó el acceso; se toma de la conexión y no del propietario del objeto, porque el propietario no diría quién accedió |
| 4 | `operacion` | text | no | — | Tipo de operación registrada: consulta, alta, modificación o baja del dato |
| 5 | `actor_uid` | uuid | sí | — | Usuario o agente que ejecutó la operación sobre los datos personales |
| 6 | `motivo` | text | sí | — | Justificación declarada por quien accedió al dato personal auditado |
| 7 | `filas_afectadas` | integer | no | — | Cantidad de filas alcanzadas por la operación registrada |
| 8 | `contexto` | jsonb | no | — | Detalle de la operación registrada: origen, columnas modificadas y resultado |

### 5.4 `avisa`

Entrada cruda: mensajes y adjuntos recibidos antes de validarse, más la cola de rechazos.

2 tablas · 19 columnas · 0 filas.

#### `avisa.raw_ingest`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 0 · **Columnas:** 14 · **Clave primaria:** `id`, `received_at` · **Relaciones:** 2 · **Índices:** 2 · **Particionada en:** 6

Mensaje crudo recibido por un canal de entrada, con su huella de origen, contenido, versión del extractor y confianza, antes de hacerse registro del modelo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `received_at` | timestamp with time zone | no | PK | Momento en que el canal de ingesta recibió el mensaje crudo |
| 3 | `fuente` | character varying(30) | no | — | Canal o sistema por el que llegó el mensaje crudo |
| 4 | `sender_hmac` | character(64) | no | — | Firma HMAC del remitente, usada para verificar que el origen es legítimo |
| 5 | `raw_text` | text | sí | — | Contenido textual original del mensaje, tal como llegó sin normalizar |
| 6 | `audio_uri` | character varying(500) | sí | — | Ubicación del audio cuando el mensaje se recibió como nota de voz |
| 7 | `payload_json` | jsonb | sí | — | Cuerpo estructurado original del mensaje, antes de interpretarse |
| 8 | `schema_version` | character varying(10) | sí | — | Versión del esquema de captura con que se interpreta el mensaje |
| 9 | `extractor_version` | character varying(30) | sí | — | Versión del extractor que procesó el mensaje, para reproducir su lectura |
| 10 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 11 | `estado` | character varying(12) | no | — | Situación del mensaje en la cola de ingesta, por defecto pendiente |
| 12 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso al que se vincula el mensaje desde su recepción, si ya se conoce |
| 13 | `tipo_registro` | character varying(20) | no | — | Clase de registro que el mensaje representa, por defecto evento |
| 14 | `policy_snapshot_id` | uuid | sí | FK → policy.snapshot(id) | Foto de las políticas vigentes al momento de recibir el mensaje |

#### `avisa.raw_ingest_rejected`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 2

Mensaje crudo descartado por el canal de ingesta, con el error que motivó el rechazo, para reprocesarlo o explicar por qué no ingresó.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `raw_id` | uuid | no | FK → avisa.raw_ingest_202703(id), avisa.raw_ingest_202611(id), avisa.raw_ingest_default(id), avisa.raw_ingest(id), avisa.raw_ingest_202612(id), avisa.raw_ingest_202702(id), avisa.raw_ingest_202701(id) | Mensaje crudo descartado, buscado en la partición donde ingresó |
| 3 | `raw_received_at` | timestamp with time zone | no | FK → avisa.raw_ingest_202703(received_at), avisa.raw_ingest_202611(received_at), avisa.raw_ingest_default(received_at), avisa.raw_ingest(received_at), avisa.raw_ingest_202612(received_at), avisa.raw_ingest_202702(received_at), avisa.raw_ingest_202701(received_at) | Momento en que se recibió el mensaje descartado, junto con su identificador |
| 4 | `error_json` | jsonb | no | — | Detalle estructurado del error que motivó el rechazo del mensaje |
| 5 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

### 5.5 `chat`

Historial de conversación con el asistente, versionado por ramas y confirmaciones.

14 tablas · 148 columnas · 0 filas.

#### `chat.blame`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 4

Atribución de cada afirmación a su turno y commit de origen, incluida la herencia cuando el texto proviene de una versión anterior.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `commit_id` | uuid | no | FK → chat.commit(id) | Commit en el que se ubica la afirmación atribuida |
| 3 | `turno_id` | uuid | no | FK → chat.turno(id) | Turno del commit que contiene la afirmación atribuida |
| 4 | `afirmacion_hash` | character(64) | no | — | Huella de la afirmación, para seguirla entre versiones de la conversación |
| 5 | `origen_turno_id` | uuid | no | FK → chat.turno(id) | Turno original donde la afirmación apareció por primera vez |
| 6 | `origen_commit_id` | uuid | no | FK → chat.commit(id) | Commit original en el que se introdujo la afirmación |
| 7 | `autor_original` | uuid | sí | — | Usuario que produjo originalmente la afirmación heredada |
| 8 | `timestamp_original` | timestamp with time zone | sí | — | Momento en que se introdujo originalmente la afirmación |
| 9 | `es_herencia` | boolean | no | — | Indica si la afirmación proviene de una versión anterior sin cambios |

#### `chat.blob`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `hash` · **Relaciones:** 1 · **Índices:** 2

Contenido de conversación deduplicado por hash, con recuento de referencias para liberar el espacio cuando deja de usarse.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `hash` | character(64) | no | PK | Huella que identifica el contenido y evita guardar copias duplicadas |
| 2 | `contenido` | text | sí | — | Texto del contenido de conversación guardado en el almacén |
| 3 | `contenido_binario` | bytea | sí | — | Contenido binario almacenado cuando el material no es texto plano |
| 4 | `tipo_contenido` | character varying(80) | sí | — | Tipo de medio del contenido, según el formato en que se guardó |
| 5 | `tamano_bytes` | bigint | no | — | Tamaño del contenido en bytes, usado para controlar el espacio ocupado |
| 6 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 7 | `creado_en` | timestamp with time zone | no | — | Momento en que se guardó el contenido en el almacén |
| 8 | `ref_count` | integer | no | — | Cantidad de referencias activas, que al llegar a cero permite liberar el espacio |

#### `chat.cherry_pick`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 1

Traslado de un commit desde una rama hacia otra, con el resultado de la operación y los conflictos que debieron resolverse.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `commit_origen_id` | uuid | no | FK → chat.commit(id) | Commit que se traslada desde su rama original |
| 3 | `commit_destino_id` | uuid | no | FK → chat.commit(id) | Commit resultante de aplicar el traslado en la rama de destino |
| 4 | `rama_destino_id` | uuid | no | FK → chat.rama(id) | Rama que recibe el commit trasladado |
| 5 | `aplicado_por` | uuid | no | FK → core.usuarios(id) | Usuario que ejecutó el traslado del commit |
| 6 | `aplicado_en` | timestamp with time zone | no | — | Momento en que se aplicó el traslado del commit |
| 7 | `estado` | character varying(15) | no | — | Resultado del traslado, como aplicado o con conflictos |
| 8 | `conflictos_json` | jsonb | sí | — | Conflictos surgidos al aplicar el commit, con su detalle en JSON |

#### `chat.commit`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 23 · **Clave primaria:** `id` · **Relaciones:** 6 · **Índices:** 7

Versión cerrada de una conversación: árbol de turnos y configuración exacta con que se produjo, es decir modelo, parámetros, librerías y política.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `repositorio_id` | uuid | no | FK → chat.repositorio(id) | Repositorio de conversación al que pertenece la versión cerrada |
| 3 | `hash` | character(64) | no | UQ | Huella única del commit, que lo identifica en el historial |
| 4 | `parent_ids` | uuid[] | no | — | Commits padre de los que deriva esta versión de la conversación |
| 5 | `tree_hash` | character(64) | no | — | Huella del árbol de turnos que compone esta versión de la conversación |
| 6 | `autor_tipo` | character varying(10) | no | — | Naturaleza del autor del commit, como persona o agente |
| 7 | `autor_id` | uuid | no | — | Usuario o agente que produjo la versión de la conversación |
| 8 | `mensaje` | text | no | — | Mensaje que describe el cambio introducido con este commit |
| 9 | `timestamp` | timestamp with time zone | no | — | Momento en que se cerró la versión de la conversación |
| 10 | `modelo_card_id` | uuid | no | FK → model.model_card(id) | Modelo usado al producir la conversación, tomado del catálogo de modelos |
| 11 | `parametros_snapshot` | jsonb | no | — | Parámetros de generación vigentes al crear el commit, guardados en JSON |
| 12 | `parametros_hash` | character(64) | no | — | Huella de los parámetros, para comprobar que no variaron después |
| 13 | `librerias_snapshot` | jsonb | no | — | Librerías y versiones usadas al generar la conversación, en JSON |
| 14 | `librerias_hash` | character(64) | no | — | Huella de las librerías, para comprobar que el entorno se mantuvo |
| 15 | `aplicacion_id` | uuid | no | FK → config.aplicacion(id) | Aplicación desde la que se produjo el commit |
| 16 | `politica_snapshot_id` | uuid | no | FK → policy.snapshot(id) | Instantánea de política aplicable a esta versión de la conversación |
| 17 | `artefacto_id` | uuid | sí | FK → domain.artefacto(id) | Artefacto del dominio generado a partir de esta versión de la conversación |
| 18 | `es_merge` | boolean | no | — | Indica si el commit resultó de fusionar dos ramas |
| 19 | `es_revert` | boolean | no | — | Indica si el commit deshace otro commit anterior |
| 20 | `es_amend` | boolean | no | — | Indica si el commit reemplaza una versión previa con enmiendas |
| 21 | `es_cherry_pick` | boolean | no | — | Indica si el commit proviene de un traslado desde otra rama |
| 22 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 23 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |

#### `chat.diff`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 2

Comparación calculada entre dos versiones de una conversación, con el tipo de diferencia detectada y su detalle.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `commit_a_id` | uuid | no | FK → chat.commit(id) | Commit tomado como versión de referencia en la comparación |
| 3 | `commit_b_id` | uuid | no | FK → chat.commit(id) | Commit comparado contra el tomado como referencia |
| 4 | `tipo_diff` | character varying(30) | no | — | Tipo de diferencia detectada entre ambas versiones de la conversación |
| 5 | `detalle_json` | jsonb | no | — | Detalle de las diferencias encontradas, guardado en JSON |
| 6 | `calculado_en` | timestamp with time zone | no | — | Momento en que se calculó la comparación entre los dos commits |

Claves únicas compuestas: `commit_a_id`, `commit_b_id`, `tipo_diff`.

#### `chat.hook`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Regla automática que se ejecuta ante un evento del repositorio de conversación, con su código, lenguaje y orden de aplicación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `repositorio_id` | uuid | no | FK → chat.repositorio(id) | Repositorio cuyos eventos disparan la regla automática |
| 3 | `evento` | character varying(20) | no | — | Evento del repositorio que activa la regla, como confirmar o fusionar |
| 4 | `codigo` | character varying(80) | no | — | Código que identifica la regla dentro del repositorio |
| 5 | `lenguaje` | character varying(20) | no | — | Lenguaje en que está escrita la regla que se ejecutará |
| 6 | `contenido` | text | no | — | Código de la regla que el repositorio ejecuta ante el evento |
| 7 | `activo` | boolean | no | — | Indica si la regla está habilitada para ejecutarse |
| 8 | `orden` | integer | no | — | Orden de aplicación de la regla frente a las demás del mismo evento |

Claves únicas compuestas: `repositorio_id`, `evento`, `codigo`.

#### `chat.merge`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `commit_id` · **Relaciones:** 4 · **Índices:** 1

Fusión de dos ramas de conversación, con su base común, la estrategia aplicada y los conflictos resueltos.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `commit_id` | uuid | no | PK, FK → chat.commit(id) | Commit resultante de la fusión de las dos ramas |
| 2 | `rama_origen_id` | uuid | no | FK → chat.rama(id) | Rama cuyos cambios se incorporan en la fusión |
| 3 | `rama_destino_id` | uuid | no | FK → chat.rama(id) | Rama que recibe los cambios durante la fusión |
| 4 | `merge_base_id` | uuid | no | FK → chat.commit(id) | Commit común a ambas ramas desde el que se calcula la fusión |
| 5 | `estrategia` | character varying(15) | no | — | Estrategia aplicada para resolver la fusión de las ramas |
| 6 | `conflictos_resueltos` | integer | no | — | Cantidad de conflictos resueltos durante la fusión |
| 7 | `conflictos_json` | jsonb | sí | — | Detalle de los conflictos resueltos, con su resolución en JSON |

#### `chat.rama`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 3

Rama de un repositorio de conversación: puntero a un commit que permite explorar hipótesis en paralelo y fusionarlas después.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `repositorio_id` | uuid | no | FK → chat.repositorio(id) | Repositorio al que pertenece la rama |
| 3 | `nombre` | character varying(120) | no | — | Nombre con que se identifica la rama dentro del repositorio |
| 4 | `head_commit_id` | uuid | no | FK → chat.commit(id) | Commit al que apunta la rama como su versión más reciente |
| 5 | `rama_padre_id` | uuid | sí | FK → chat.rama(id) | Rama de la que se desprendió esta para explorar otra hipótesis |
| 6 | `protegida` | boolean | no | — | Indica si la rama no admite cambios directos sin revisión |
| 7 | `descripcion` | text | sí | — | Propósito de la rama, para explicar la hipótesis que explora |
| 8 | `creado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que creó la rama para explorar una hipótesis en paralelo |
| 9 | `creado_en` | timestamp with time zone | no | — | Momento en que se creó la rama |
| 10 | `estado` | character varying(15) | no | — | Situación de la rama, como activa, fusionada o archivada |

Claves únicas compuestas: `repositorio_id`, `nombre`.

#### `chat.ref`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Referencia con nombre sobre un commit, como una rama publicada o una etiqueta, con su mensaje y su fecha de marcado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `repositorio_id` | uuid | no | FK → chat.repositorio(id) | Repositorio en el que se define la referencia |
| 3 | `nombre` | character varying(255) | no | — | Nombre de la referencia, como el de una rama publicada o una etiqueta |
| 4 | `tipo` | character varying(15) | no | — | Clase de referencia, como rama publicada o etiqueta |
| 5 | `commit_id` | uuid | no | FK → chat.commit(id) | Commit al que apunta la referencia |
| 6 | `tag_message` | text | sí | — | Mensaje explicativo asociado a la etiqueta marcada |
| 7 | `tag_autor_id` | uuid | sí | FK → core.usuarios(id) | Usuario que marcó la etiqueta sobre el commit |
| 8 | `tag_fecha` | timestamp with time zone | sí | — | Momento en que se marcó la etiqueta |
| 9 | `vigente` | boolean | no | — | Indica si la referencia sigue apuntando al commit actual |
| 10 | `creado_en` | timestamp with time zone | no | — | Momento en que se creó la referencia |

Claves únicas compuestas: `repositorio_id`, `nombre`.

#### `chat.reflog`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Rastro de los movimientos de las referencias de un repositorio, con el commit anterior y el nuevo, para reconstruir qué cambió y quién lo hizo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `repositorio_id` | uuid | no | FK → chat.repositorio(id) | Repositorio cuyas referencias se registran en este rastro |
| 3 | `ref` | character varying(255) | no | — | Nombre de la referencia que cambió de posición |
| 4 | `old_commit_id` | uuid | sí | — | Commit al que apuntaba la referencia antes del movimiento |
| 5 | `new_commit_id` | uuid | no | — | Commit al que apunta la referencia después del movimiento |
| 6 | `autor_id` | uuid | no | FK → core.usuarios(id) | Usuario que provocó el movimiento de la referencia |
| 7 | `timestamp` | timestamp with time zone | no | — | Momento en que ocurrió el movimiento de la referencia |
| 8 | `mensaje` | text | sí | — | Motivo del movimiento de la referencia |
| 9 | `operacion` | character varying(20) | no | — | Acción registrada sobre la referencia, como creación, avance o borrado |

#### `chat.remote`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 2

Repositorio remoto con el que se sincroniza una conversación versionada, con su ubicación, credencial y último intercambio.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `repositorio_id` | uuid | no | FK → chat.repositorio(id) | Repositorio local que se sincroniza con este remoto |
| 3 | `nombre` | character varying(80) | no | — | Nombre con que se identifica el remoto, como origin |
| 4 | `url` | character varying(500) | no | — | Ubicación del repositorio remoto con el que se sincroniza |
| 5 | `tipo` | character varying(15) | no | — | Tipo de remoto, que determina el protocolo de sincronización |
| 6 | `credencial_ref` | character varying(100) | sí | — | Referencia a la credencial usada para autenticarse, sin guardarla aquí |
| 7 | `ultima_sincronizacion` | timestamp with time zone | sí | — | Momento del último intercambio de cambios con el remoto |
| 8 | `estado` | character varying(15) | no | — | Situación del remoto, como activo o deshabilitado |
| 9 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

Claves únicas compuestas: `repositorio_id`, `nombre`.

#### `chat.repositorio`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 13 · **Clave primaria:** `id` · **Relaciones:** 6 · **Índices:** 5

Repositorio de una conversación con IA, por caso, actor, territorio o libre, con su rama por defecto y su nivel de clasificación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(80) | no | UQ | Código único con que se identifica el repositorio |
| 3 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso al que se adscribe la conversación, cuando el repositorio es por caso |
| 4 | `sujeto_actor_uid` | uuid | sí | FK → core.actores(actor_uid) | Actor sobre el que trata la conversación, cuando el repositorio es por actor |
| 5 | `territorio_lugar_id` | uuid | sí | FK → territorio.lugares(id) | Territorio de referencia, cuando el repositorio se organiza por territorio |
| 6 | `tipo` | character varying(20) | no | — | Criterio con que se organiza el repositorio: caso, actor, territorio o libre |
| 7 | `descripcion` | text | sí | — | Descripción del contenido y el alcance del repositorio |
| 8 | `default_branch_id` | uuid | sí | FK → chat.rama(id) | Rama que se adopta por defecto al abrir el repositorio |
| 9 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 10 | `estado` | character varying(15) | no | — | Situación del repositorio, como activo o archivado |
| 11 | `creado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que creó el repositorio |
| 12 | `creado_en` | timestamp with time zone | no | — | Momento en que se creó el repositorio |
| 13 | `archivado_en` | timestamp with time zone | sí | — | Momento en que se archivó el repositorio, vacío mientras siga activo |

#### `chat.stash`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 1

Conjunto de turnos guardados aparte sin confirmar, para retomarlos después en su rama de origen.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `repositorio_id` | uuid | no | FK → chat.repositorio(id) | Repositorio en el que se guardan aparte los turnos sin confirmar |
| 3 | `mensaje` | text | no | — | Mensaje que describe lo que contiene el conjunto guardado |
| 4 | `tree_hash` | character(64) | no | — | Huella del árbol de turnos guardados, para compararlo con su origen |
| 5 | `turnos_json` | jsonb | no | — | Turnos guardados aparte, sin confirmar, en formato JSON |
| 6 | `rama_origen_id` | uuid | no | FK → chat.rama(id) | Rama de la que se retiraron los turnos y donde pueden retomarse |
| 7 | `creado_por` | uuid | no | FK → core.usuarios(id) | Usuario que guardó aparte el conjunto de turnos |
| 8 | `creado_en` | timestamp with time zone | no | — | Momento en que se guardó aparte el conjunto de turnos |
| 9 | `aplicado` | boolean | no | — | Indica si el conjunto guardado ya se reincorporó a su rama |
| 10 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `chat.turno`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 18 · **Clave primaria:** `id` · **Relaciones:** 5 · **Índices:** 5

Turno de una conversación con su rol, contenido, modelo, agente y consumo, con hash propio para comparar y atribuir afirmaciones.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `commit_id` | uuid | no | FK → chat.commit(id) | Commit en el que queda fijado el turno |
| 3 | `orden` | integer | no | — | Posición del turno dentro del árbol de la conversación |
| 4 | `rol` | character varying(10) | no | — | Papel del turno en la conversación, como usuario, asistente o sistema |
| 5 | `contenido` | text | sí | — | Texto del turno tal como se mostró en la conversación |
| 6 | `contenido_json` | jsonb | sí | — | Estructura del turno en JSON, cuando incluye partes o adjuntos |
| 7 | `hash` | character(64) | no | — | Huella del turno, para comparar versiones y atribuir afirmaciones |
| 8 | `blob_ref` | character(64) | sí | FK → chat.blob(hash) | Contenido deduplicado del turno, cuando el texto se guarda aparte |
| 9 | `tool_calls` | jsonb | sí | — | Llamadas a herramientas que el modelo invocó en este turno |
| 10 | `tokens_in` | integer | sí | — | Tokens consumidos por el contexto enviado al modelo en este turno |
| 11 | `tokens_out` | integer | sí | — | Tokens producidos por el modelo como respuesta en este turno |
| 12 | `latencia_ms` | integer | sí | — | Tiempo que tardó en producirse el turno, en milisegundos |
| 13 | `modelo_id` | uuid | sí | FK → model.model_card(id) | Modelo que generó el turno, según el catálogo de modelos |
| 14 | `agente` | character varying(30) | sí | — | Agente que condujo el turno cuando la respuesta no fue directa |
| 15 | `llm_call_id` | uuid | sí | — | Llamada al modelo que produjo este turno, para cruzar costo y latencia |
| 16 | `politica_snapshot_id` | uuid | sí | FK → policy.snapshot(id) | Instantánea de política vigente al producir el turno |
| 17 | `atributos` | jsonb | sí | — | Atributos adicionales del turno, guardados como JSON libre |
| 18 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

Claves únicas compuestas: `commit_id`, `orden`.

### 5.6 `community`

Módulo de expansión sobre organización comunitaria; hoy solo catálogos.

1 tabla · 10 columnas · 0 filas.

#### `community.encuestas_percepcion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 1

Encuesta de percepción aplicada en una caleta: satisfacción, confianza institucional, seguridad y servicios, con consentimiento y encuestador.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caleta_id` | uuid | no | FK → territorio.caleta_detalle(lugar_id) | Caleta donde se aplicó la encuesta de percepción |
| 3 | `fecha` | date | no | — | Fecha en que se levantó la encuesta en la caleta |
| 4 | `consentimiento` | boolean | no | — | Indica si la persona encuestada otorgó consentimiento informado |
| 5 | `satisfaccion_likert` | smallint | sí | — | Puntaje de satisfacción declarada, en escala Likert |
| 6 | `confianza_institucional_likert` | smallint | sí | — | Puntaje de confianza declarada hacia las instituciones públicas |
| 7 | `percepcion_seguridad_likert` | smallint | sí | — | Puntaje de percepción de seguridad en la caleta y su entorno |
| 8 | `percepcion_servicios_likert` | smallint | sí | — | Puntaje de percepción sobre la calidad de los servicios disponibles |
| 9 | `comentario_texto` | text | sí | — | Comentario libre de la persona encuestada sobre su percepción |
| 10 | `encuestador_id` | uuid | sí | FK → core.usuarios(id) | Usuario que aplicó la encuesta y registró las respuestas |

### 5.7 `config`

Parámetros, aplicaciones, librerías, registro de esquemas y transiciones de estado.

6 tablas · 51 columnas · 64 filas.

#### `config.a2_transiciones`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 10 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Máquina de estados del agente generador de pautas: estado de origen, estado de destino, evento que dispara el cambio y condición de guarda.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `estado_desde` | character varying(30) | no | — | Estado del agente desde el cual se evalúa la transición |
| 3 | `estado_hasta` | character varying(30) | no | — | Estado al que pasa el agente cuando se cumple la condición |
| 4 | `evento` | character varying(40) | no | — | Evento que dispara la evaluación del cambio de estado |
| 5 | `guard_sql` | text | sí | — | Condición SQL que debe cumplirse para que la transición ocurra |
| 6 | `severidad` | character varying(10) | no | — | Gravedad del incumplimiento de la guarda, por defecto bloqueante |

Claves únicas compuestas: `estado_desde`, `estado_hasta`, `evento`.

#### `config.aplicacion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Aplicación registrada del ecosistema, con su tipo, configuración, modelo y librerías, para reproducir lo que ejecutó cada proceso.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(60) | no | UQ | Código único que identifica la aplicación dentro del ecosistema |
| 3 | `nombre` | character varying(120) | no | — | Nombre legible de la aplicación registrada |
| 4 | `tipo` | character varying(12) | no | — | Clase de aplicación según su función en el ecosistema |
| 5 | `modelo_card_id` | uuid | sí | FK → model.model_card(id) | Ficha del modelo que la aplicación declara usar |
| 6 | `libreria_ids` | uuid[] | no | — | Librerías que la aplicación requiere para ejecutarse |
| 7 | `config` | jsonb | no | — | Parámetros de configuración con que se ejecuta la aplicación |
| 8 | `estado` | character varying(12) | no | — | Situación de la aplicación, por defecto propuesta |
| 9 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `config.guardrail_contract`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 25 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Contrato de prueba de un guardrail: qué entrada lo dispara, qué salida se espera y qué caso negativo no debe activarlo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `guardrail` | character varying(10) | no | UQ | Guardrail al que pertenece este contrato de prueba, uno por guardrail |
| 3 | `input_dispara` | jsonb | no | — | Entrada de ejemplo que debe activar el guardrail |
| 4 | `input_no_dispara` | jsonb | no | — | Entrada de ejemplo que no debe activar el guardrail |
| 5 | `output_esperado_dispara` | jsonb | no | — | Salida esperada cuando la entrada activa el guardrail |
| 6 | `output_esperado_no_dispara` | jsonb | no | — | Salida esperada cuando la entrada no activa el guardrail |
| 7 | `severidad` | character varying(10) | no | — | Gravedad asignada al incumplimiento del contrato de prueba |

#### `config.libreria`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 6 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Librería de software registrada con su versión, licencia, dependencias y parámetros por defecto, para fijar el entorno de ejecución.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(60) | no | — | Código que identifica la librería en el catálogo de entorno |
| 3 | `nombre` | character varying(120) | no | — | Nombre de la librería de software registrada |
| 4 | `version` | character varying(30) | no | — | Versión exacta de la librería, para fijar el entorno de ejecución |
| 5 | `tipo` | character varying(20) | no | — | Familia o clase de la librería según su uso previsto |
| 6 | `licencia` | character varying(40) | sí | — | Licencia con que se distribuye la librería registrada |
| 7 | `hardware_requerido` | character varying(10) | sí | — | Tipo de hardware que la librería exige para funcionar |
| 8 | `dependencias` | jsonb | no | — | Librerías de las que depende, con su versión requerida |
| 9 | `parametros_default` | jsonb | no | — | Parámetros por defecto con que se inicializa la librería |
| 10 | `estado` | character varying(10) | no | — | Situación de la librería en el catálogo, por defecto activa |
| 11 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

Claves únicas compuestas: `codigo`, `version`.

#### `config.parametro`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 17 · **Columnas:** 12 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 3

Parámetro operativo con su valor vigente, unidad y norma de origen, versionado para que un umbral no dependa del código.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(80) | no | — | Código del parámetro operativo, usado en lugar de umbrales fijos en el código |
| 3 | `valor` | jsonb | no | — | Valor vigente del parámetro, guardado como JSON para admitir formas distintas |
| 4 | `tipo` | character varying(10) | no | — | Tipo de dato del valor, para validarlo e interpretarlo |
| 5 | `unidad` | character varying(30) | sí | — | Unidad de medida del valor con la que debe leerse el parámetro |
| 6 | `descripcion` | text | sí | — | Explicación de qué controla el parámetro y cómo debe usarse |
| 7 | `fuente_normativa_id` | uuid | sí | FK → policy.regla(id) | Norma o regla que fija el valor del parámetro |
| 8 | `valid_from` | timestamp with time zone | no | — | Momento desde el que rige el valor del parámetro |
| 9 | `valid_to` | timestamp with time zone | sí | — | Momento en que deja de regir el valor, vacío mientras siga vigente |
| 10 | `supersedes_id` | uuid | sí | FK → config.parametro(id) | Versión anterior del parámetro que este valor reemplaza |
| 11 | `aprobado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que aprobó el valor vigente del parámetro |
| 12 | `aprobado_en` | timestamp with time zone | sí | — | Momento en que se aprobó el valor vigente del parámetro |

#### `config.schema_registry`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 2 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Registro de versiones de los esquemas de extracción por tipo de registro, con su vigencia, para que un cambio de esquema no rompa el histórico.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | — | Código del tipo de registro cuyo esquema de extracción se versiona |
| 3 | `version` | character varying(20) | no | — | Versión del esquema de extracción, para no romper el histórico |
| 4 | `esquema_json` | jsonb | no | — | Estructura esperada del registro, con sus campos y restricciones |
| 5 | `vigente_desde` | date | no | — | Fecha desde la que la versión del esquema es válida |
| 6 | `vigente_hasta` | date | sí | — | Fecha en que la versión deja de aplicarse, vacía si sigue vigente |

Claves únicas compuestas: `codigo`, `version`.

### 5.8 `consultation`

Módulo de expansión para consultas a actores; sin uso todavía.

4 tablas · 26 columnas · 0 filas.

#### `consultation.actores`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 3 · **Clave primaria:** `proceso_id`, `actor_id` · **Relaciones:** 2 · **Índices:** 1

Participación de un actor en un proceso de consulta previa, con el rol que cumple en esa consulta y su vinculación con el padrón general.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `proceso_id` | uuid | no | PK, FK → consultation.procesos(id) | Proceso de consulta previa en el que participa el actor |
| 2 | `actor_id` | uuid | no | PK, FK → core.actores(actor_uid) | Actor del padrón general vinculado a la consulta previa |
| 3 | `rol_en_consulta` | character varying(50) | sí | — | Rol que cumple el actor dentro de ese proceso de consulta |

#### `consultation.etapas`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Etapa de un proceso de consulta previa, con sus fechas de inicio y fin, el documento de evidencia y las observaciones del caso.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `proceso_id` | uuid | no | FK → consultation.procesos(id) | Proceso de consulta previa al que pertenece la etapa |
| 3 | `tipo_etapa` | character varying(50) | no | — | Tipo de etapa del proceso, como publicación, diálogo o cierre |
| 4 | `fecha_inicio` | date | sí | — | Fecha en que comenzó la etapa de la consulta |
| 5 | `fecha_fin` | date | sí | — | Fecha en que concluyó la etapa, si ya finalizó |
| 6 | `documento_evidencia_url` | character varying(500) | sí | — | Enlace al documento que respalda el cumplimiento de la etapa |
| 7 | `observaciones` | text | sí | — | Notas del caso sobre el desarrollo de la etapa de consulta |

#### `consultation.procesos`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Proceso de consulta previa asociado a un caso, con el pueblo indígena involucrado, su fase actual y su estado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso que da origen y contexto al proceso de consulta previa |
| 3 | `pueblo_indigena` | character varying(255) | no | — | Pueblo indígena involucrado y consultado en el proceso |
| 4 | `fase_actual` | character varying(50) | no | — | Fase del proceso de consulta en la que se encuentra el caso |
| 5 | `fecha_inicio` | date | no | — | Fecha en que se inició formalmente el proceso de consulta |
| 6 | `fecha_estimada_cierre` | date | sí | — | Fecha prevista para cerrar el proceso de consulta previa |
| 7 | `estado` | character varying(30) | no | — | Situación administrativa del proceso, como abierto o concluido |
| 8 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 9 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 10 | `nivel_clasificacion` | character varying(20) | no | — | Nivel de clasificación de la consulta, expresado como etiqueta: Público, Reservado o Confidencial |

#### `consultation.resultados`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Resultado o acuerdo alcanzado en un proceso de consulta, con su tipo, descripción, fecha y documento de respaldo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `proceso_id` | uuid | no | FK → consultation.procesos(id) | Proceso de consulta previa en el que se alcanzó el resultado |
| 3 | `tipo_resultado` | character varying(50) | no | — | Naturaleza del resultado, como acuerdo, desacuerdo o acta |
| 4 | `descripcion` | text | no | — | Detalle del acuerdo o resultado alcanzado en la consulta |
| 5 | `documento_url` | character varying(500) | sí | — | Enlace al documento que respalda el resultado registrado |
| 6 | `fecha` | date | no | — | Fecha en que se alcanzó o suscribió el resultado |

### 5.9 `core`

El dominio: casos, alertas, demandas, actores, documentos, compromisos y territorio.

96 tablas · 772 columnas · 6 664 filas.

#### `core.actor_datos_personales`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 847 · **Columnas:** 16 · **Clave primaria:** `actor_uid` · **Relaciones:** 2 · **Índices:** 2

Datos personales del actor cifrados con AES-256 y su HMAC de búsqueda, con base legal y consentimiento, separados del padrón por privacidad.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor al que pertenecen estos datos personales, en relación uno a uno |
| 2 | `telefono_contacto` | character varying(50) | sí | — | Teléfono de contacto del actor, guardado cifrado para proteger su identidad |
| 3 | `genero` | character varying(30) | sí | — | Género declarado por el actor, usado para desagregar el análisis por sexo |
| 4 | `autoidentificacion_etnica` | character varying(100) | sí | — | Pertenencia étnica autodeclarada por el actor para el enfoque intercultural |
| 5 | `base_legal` | character varying(100) | sí | — | Fundamento legal que autoriza el tratamiento y conservación de estos datos |
| 6 | `fecha_consentimiento` | date | sí | — | Fecha en que el actor otorgó su consentimiento para el uso de sus datos |
| 7 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 8 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 9 | `dni` | character varying(12) | sí | — | Documento nacional de identidad del actor, cifrado para limitar su exposición |
| 10 | `email` | character varying(255) | sí | — | Correo electrónico del actor para notificaciones y coordinaciones |
| 11 | `telefono_alt` | character varying(50) | sí | — | Teléfono alternativo del actor, cifrado igual que el número principal |
| 12 | `telefono_raw` | character varying(50) | sí | — | Teléfono tal como se capturó en el legado, antes de normalizarse |
| 13 | `dni_cifrado` | bytea | sí | — | DNI cifrado con AES-256 mediante pgp_sym_encrypt; la clave se guarda fuera de la base |
| 14 | `email_cifrado` | bytea | sí | — | Correo electrónico cifrado con AES-256 mediante pgp_sym_encrypt; la clave se guarda fuera de la base |
| 15 | `telefono_cifrado` | bytea | sí | — | Teléfono cifrado con AES-256; guarda el número normalizado cuando existe y, si la fila solo traía el texto original, ese valor |
| 16 | `dni_hmac` | bytea | sí | — | Huella HMAC-SHA256 del DNI con la misma clave: permite buscar y detectar duplicados sin descifrar nada. No es única a propósito, porque la fuente repite DNI |

#### `core.actor_membresia`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 292 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Pertenencia de una persona a una organización, con el cargo que ejerce y el período de vigencia del vínculo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `persona_uid` | uuid | no | FK → core.actores(actor_uid) | Persona que ocupa el cargo dentro de la organización |
| 3 | `organizacion_uid` | uuid | no | FK → core.actores(actor_uid) | Organización a la que pertenece la persona en este vínculo |
| 4 | `cargo` | character varying(100) | sí | — | Cargo o función que la persona ejerce en la organización |
| 5 | `valid_from` | date | sí | — | Fecha desde la que rige la pertenencia registrada |
| 6 | `valid_to` | date | sí | — | Fecha en que termina la pertenencia, vacía mientras siga vigente |

#### `core.actores`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 1 160 · **Columnas:** 26 · **Clave primaria:** `actor_uid` · **Relaciones:** 8 · **Índices:** 2

Sujeto individual o colectivo que participa en la conflictividad —dirigente, gremio, autoridad o empresa— con su tipo, rol, perfil y distrito de referencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `actor_uid` | uuid | no | PK | Identificador único del actor, usado como referencia en todo el sistema |
| 2 | `nombre_actual` | character varying(255) | no | — | Denominación vigente del actor, la que se muestra en fichas y reportes |
| 3 | `fecha_ultimo_cambio_nombre` | date | sí | — | Fecha del último cambio de denominación registrado para el actor |
| 4 | `naturaleza` | character varying(12) | no | — | Define si el actor es una persona individual o una organización |
| 5 | `tipo_actor_id` | integer | no | FK → core.cat_tipos_actor(id) | Tipo de actor según el catálogo: del Estado, sociedad civil o privado |
| 6 | `rol_actor_id` | integer | no | FK → core.cat_roles_actor(id) | Rol que el actor cumple en el conflicto según el catálogo de roles |
| 7 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 8 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 9 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que dio de alta el registro del actor |
| 10 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la última modificación del registro |
| 11 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 12 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 13 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 14 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 15 | `email_contacto` | character varying(255) | sí | — | Correo institucional o personal con el que se contacta al actor |
| 16 | `cargo_actual` | character varying(150) | sí | — | Cargo que la persona ejerce actualmente, cuando el actor es individual |
| 17 | `nivel_gobierno` | character varying(15) | sí | — | Nivel de gobierno al que pertenece el actor: nacional, regional o local |
| 18 | `categoria` | character varying(40) | sí | — | Campo conservado del legado que agrupa actores por categoría, sin uso definido |
| 19 | `perfil_id` | smallint | sí | FK → core.cat_perfiles_actor(id) | Perfil de comportamiento del actor según su disposición al diálogo |
| 20 | `rol_funcional_id` | smallint | sí | FK → core.cat_roles_funcionales(id) | Rol funcional del actor en el análisis: decisor, proveedor de evidencia u otro |
| 21 | `distrito_id` | integer | sí | FK → core.distritos(id) | Distrito de referencia del actor para la desagregación territorial |
| 22 | `foto_url` | character varying(500) | sí | — | Enlace a la fotografía o logotipo con que se identifica al actor |
| 23 | `activo` | boolean | no | — | Indica si el actor sigue vigente en el padrón y puede asociarse a casos |
| 24 | `perfil_descripcion` | text | sí | — | Texto libre que amplía o justifica el perfil asignado al actor |
| 25 | `abreviatura` | character varying(150) | sí | — | Forma corta del nombre usada en listados y etiquetas de la interfaz |
| 26 | `codigo_legado` | character varying(50) | sí | UQ | Código con el que el actor se identificaba en el sistema anterior |

#### `core.acuerdo_ospa_sni`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 15 · **Clave primaria:** `id` · **Relaciones:** 5 · **Índices:** 5

Acuerdo entre una organización social de pescadores artesanales y una planta, con volumen y precio comprometidos y su grado de cumplimiento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `ospa_actor_uid` | uuid | no | FK → core.actores(actor_uid) | Organización social de pescadores artesanales que suscribe el acuerdo |
| 3 | `planta_actor_uid` | uuid | no | FK → core.actores(actor_uid) | Planta pesquera con la que se pactan el volumen y el precio |
| 4 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso de conflictividad al que se asocia este acuerdo |
| 5 | `fecha_suscripcion` | date | no | — | Fecha en que las partes suscribieron el acuerdo |
| 6 | `vigencia_hasta` | date | sí | — | Fecha hasta la que el acuerdo mantiene su vigencia |
| 7 | `volumen_comprometido_tn` | numeric(12,2) | sí | — | Volumen de pesca comprometido por las partes, en toneladas |
| 8 | `volumen_entregado_tn` | numeric(12,2) | sí | — | Volumen realmente entregado en toneladas, base del cálculo de cumplimiento |
| 9 | `precio_acordado_sol_kg` | numeric(10,2) | sí | — | Precio por kilogramo pactado en el acuerdo, expresado en soles |
| 10 | `precio_efectivo_sol_kg` | numeric(10,2) | sí | — | Precio por kilogramo realmente pagado, expresado en soles |
| 11 | `estado` | character varying(15) | no | — | Situación del acuerdo respecto de su cumplimiento, registrada como texto |
| 12 | `fuente_documento_id` | uuid | sí | FK → kag.documento_fuente(id) | Documento que respalda el acuerdo en el repositorio documental |
| 13 | `denominador_conocido` | boolean | no | — | Indica si se conoce el universo total con el que se mide el cumplimiento |
| 14 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 15 | `notas` | text | sí | — | Observaciones libres sobre la suscripción, ejecución o incumplimiento del acuerdo |

#### `core.alerta_especies`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 30 · **Columnas:** 2 · **Clave primaria:** `alerta_id`, `especie_id` · **Relaciones:** 2 · **Índices:** 1

Especies involucradas en una alerta temprana, como vínculo entre la alerta y el catálogo de especies del sector.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `alerta_id` | uuid | no | PK, FK → core.alertas_tempranas(id) | Alerta temprana a la que se vincula la especie |
| 2 | `especie_id` | smallint | no | PK, FK → core.cat_especies(id) | Especie involucrada en la alerta, tomada del catálogo de especies |

#### `core.alertas_actores`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 161 · **Columnas:** 2 · **Clave primaria:** `alerta_id`, `actor_id` · **Relaciones:** 2 · **Índices:** 2

Actores implicados en una alerta temprana, como vínculo entre la alerta y el padrón de actores.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `alerta_id` | uuid | no | PK, FK → core.alertas_tempranas(id) | Alerta temprana en la que participa el actor |
| 2 | `actor_id` | uuid | no | PK, FK → core.actores(actor_uid) | Actor implicado en la alerta temprana registrada |

#### `core.alertas_tempranas`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 83 · **Columnas:** 33 · **Clave primaria:** `id` · **Relaciones:** 10 · **Índices:** 4

Alerta temprana sobre un caso: situación actual, riesgos, acciones sugeridas, nivel, prioridad y plazos de atención y remisión.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo_alerta` | character varying(50) | no | UQ | Código único con el que se identifica la alerta en el sistema |
| 3 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso de conflictividad sobre el que se emite la alerta |
| 4 | `prioridad_id` | smallint | sí | FK → core.cat_prioridades_alerta(id) | Prioridad de la alerta, que determina el plazo de respuesta |
| 5 | `fecha_reporte` | date | no | — | Fecha en que se reportó la alerta |
| 6 | `situacion_actual` | text | sí | — | Relato del estado del conflicto al momento de emitir la alerta |
| 7 | `riesgos_json` | jsonb | sí | — | Listado estructurado de riesgos identificados en la situación analizada |
| 8 | `acciones_sugeridas_json` | jsonb | sí | — | Acciones propuestas para atender la alerta, guardadas como estructura |
| 9 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 10 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 11 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró la alerta |
| 12 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la última modificación del registro |
| 13 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 14 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 15 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 16 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 17 | `titulo` | character varying(500) | sí | — | Título breve que resume el motivo de la alerta |
| 18 | `nivel_alerta_id` | smallint | sí | FK → core.cat_niveles_alerta(id) | Nivel de gravedad de la alerta según el catálogo de niveles |
| 19 | `descripcion_riesgo` | text | sí | — | Explicación del riesgo que motiva la alerta y de sus posibles efectos |
| 20 | `hechos_recientes` | text | sí | — | Relato de los hechos ocurridos poco antes de emitirse la alerta |
| 21 | `acciones_oaipcs` | text | sí | — | Acciones desplegadas por la oficina de prevención de conflictos ante la alerta |
| 22 | `paso_actual` | smallint | sí | — | Número del paso del flujo operativo en que se encuentra la alerta |
| 23 | `fecha_validacion` | date | sí | — | Fecha en que un analista validó la alerta |
| 24 | `fecha_remision` | date | sí | — | Fecha en que la alerta se remitió al área competente |
| 25 | `estado_legado` | character varying(40) | sí | — | Estado de la alerta tal como figuraba en el sistema anterior |
| 26 | `fuente_tipo` | character varying(120) | sí | — | Clase de fuente que originó la alerta, por ejemplo un reporte o una nota |
| 27 | `fuente_descripcion` | text | sí | — | Detalle de la fuente que originó la alerta |
| 28 | `fuente_url` | character varying(500) | sí | — | Enlace a la fuente externa o al documento que sustenta la alerta |
| 29 | `distrito_id` | integer | sí | FK → core.distritos(id) | Distrito en el que se ubica la alerta |
| 30 | `sectorista_usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario responsable de dar seguimiento a la alerta |
| 31 | `mesa_id` | uuid | sí | FK → core.mesas_dialogo(id) | Mesa de diálogo vinculada a la alerta, si existe |
| 32 | `codigo_legado` | character varying(50) | sí | UQ | Código de la alerta en el sistema anterior, conservado para trazabilidad |
| 33 | `subsector_id` | integer | sí | FK → core.cat_subsectores(id) | Subsector al que pertenece la alerta registrada |

#### `core.cambio_normativo`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 14 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 2

Solicitud de cambio sobre datos normativos, con el antes y el después de la fila, la norma que lo respalda y su aprobación o reversión.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tabla_objetivo` | character varying(60) | no | — | Tabla de datos normativos sobre la que se solicita el cambio |
| 3 | `accion` | character varying(10) | no | — | Operación solicitada sobre la fila: alta, edición o baja |
| 4 | `fila_id` | smallint | sí | — | Identificador de la fila afectada dentro de la tabla objetivo |
| 5 | `payload_antes` | jsonb | sí | — | Contenido de la fila antes del cambio, guardado como estructura |
| 6 | `payload_despues` | jsonb | no | — | Contenido propuesto de la fila después del cambio |
| 7 | `norma_referencia` | character varying(120) | no | — | Norma que respalda el cambio solicitado sobre los datos |
| 8 | `solicitado_por` | uuid | no | FK → core.usuarios(id) | Usuario que presenta la solicitud de cambio |
| 9 | `aprobado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que aprueba la solicitud de cambio |
| 10 | `aprobado_en` | timestamp with time zone | sí | — | Momento en que se aprobó la solicitud |
| 11 | `aplicado_en` | timestamp with time zone | sí | — | Momento en que el cambio se aplicó efectivamente a los datos |
| 12 | `revertido_en` | timestamp with time zone | sí | — | Momento en que el cambio aplicado fue revertido |
| 13 | `revertido_por` | uuid | sí | FK → core.usuarios(id) | Usuario que dispuso la reversión del cambio |
| 14 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `core.capacidad_campo`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 3 · **Clave primaria:** `usuario_id`, `mes` · **Relaciones:** 1 · **Índices:** 1

Horas de campo disponibles de cada usuario en un mes, para planificar la recolección y estimar el esfuerzo de cerrar brechas de información.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `usuario_id` | uuid | no | PK, FK → core.usuarios(id) | Usuario al que corresponde la capacidad de campo registrada |
| 2 | `mes` | date | no | PK | Mes, guardado como fecha, al que corresponde la capacidad de campo |
| 3 | `horas_disponibles` | numeric(6,1) | no | — | Horas de campo con las que cuenta el usuario en el mes |

#### `core.capacitacion_participantes`

**Clasificación:** I · Entrada (§12.1 (fila de capacitaciones)) · **Filas:** 9 · **Columnas:** 4 · **Clave primaria:** `capacitacion_id`, `actor_uid` · **Relaciones:** 2 · **Índices:** 1

Inscripción y culminación de un actor en una capacitación, como vínculo entre la actividad formativa y el padrón de actores.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `capacitacion_id` | uuid | no | PK, FK → core.capacitaciones(id) | Capacitación en la que se inscribe el actor |
| 2 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor inscrito en la actividad de capacitación |
| 3 | `inscrito` | boolean | no | — | Indica si el actor quedó inscrito en la capacitación |
| 4 | `culmino` | boolean | no | — | Indica si el actor completó la capacitación |

#### `core.capacitaciones`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 1 · **Columnas:** 16 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 2

Actividad de capacitación realizada, con su tipo, modalidad, lugar, fechas, duración, estado y material de respaldo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(50) | no | UQ | Código único con el que se identifica la capacitación |
| 3 | `tipo_id` | smallint | sí | FK → core.cat_tipos_capacitacion(id) | Tipo de capacitación según el catálogo: taller, curso, charla u otro |
| 4 | `titulo` | character varying(255) | no | — | Título con el que se presenta la capacitación |
| 5 | `objetivo` | text | sí | — | Objetivo o resultado esperado de la actividad formativa |
| 6 | `lugar` | character varying(255) | sí | — | Nombre del lugar donde se realizó la capacitación |
| 7 | `distrito_id` | integer | sí | FK → core.distritos(id) | Distrito donde se desarrolló la capacitación |
| 8 | `modalidad` | character varying(40) | sí | — | Modalidad en que se dictó: presencial, virtual o mixta |
| 9 | `fecha_inicio` | date | sí | — | Fecha de inicio de la capacitación |
| 10 | `fecha_fin` | date | sí | — | Fecha de término de la capacitación |
| 11 | `duracion` | character varying(60) | sí | — | Duración de la actividad tal como se registró, en texto libre |
| 12 | `url_documento` | character varying(500) | sí | — | Enlace al material o informe que respalda la capacitación |
| 13 | `estado` | character varying(40) | sí | — | Situación de la capacitación: programada, realizada, cancelada u otra |
| 14 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 15 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 16 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `core.caso_cronologia`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 80 · **Columnas:** 20 · **Clave primaria:** `id` · **Relaciones:** 7 · **Índices:** 4

Hecho relevante de la historia de un caso, con su fecha, descripción, tipo, actor involucrado y carácter verificable o crítico.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso al que pertenece el hecho de la cronología |
| 3 | `fecha_evento` | date | no | — | Fecha en que ocurrió el hecho relatado |
| 4 | `descripcion_hecho` | text | no | — | Relato del hecho ocurrido en la historia del caso |
| 5 | `es_hecho_verificable` | boolean | no | — | Indica si el hecho puede contrastarse con una fuente o evidencia |
| 6 | `actor_uid` | uuid | sí | FK → core.actores | Actor involucrado en el hecho de la cronología |
| 7 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 8 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 9 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró el hecho en la cronología |
| 10 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la última modificación del registro |
| 11 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 12 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 13 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 14 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 15 | `tipo_hecho_id` | smallint | sí | FK → core.cat_tipos_hecho(id) | Tipo de hecho según el catálogo: bloqueo, comunicado, reunión u otro |
| 16 | `es_hecho_critico` | boolean | no | — | Indica si el hecho se considera crítico para la evolución del caso |
| 17 | `sectorista_usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario que registró el hecho o le dio seguimiento |
| 18 | `link_evidencia` | character varying(500) | sí | — | Enlace al documento o archivo que respalda el hecho |
| 19 | `tipo_evidencia_legado` | character varying(80) | sí | — | Tipo de evidencia tal como se anotó en el sistema anterior |
| 20 | `codigo_legado` | character varying(50) | sí | UQ | Código del hecho en el sistema anterior, útil para trazabilidad |

#### `core.caso_distritos`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 23 · **Columnas:** 2 · **Clave primaria:** `caso_id`, `distrito_id` · **Relaciones:** 2 · **Índices:** 2

Distritos alcanzados por un caso, como vínculo entre el expediente y la división territorial distrital.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `caso_id` | uuid | no | PK, FK → core.casos(id) | Caso que alcanza al distrito registrado |
| 2 | `distrito_id` | integer | no | PK, FK → core.distritos(id) | Distrito alcanzado por el caso, dentro de su alcance territorial |

#### `core.caso_estado_historial`

**Clasificación:** O · Salida (§12.3) · **Filas:** 35 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 6 · **Índices:** 3

Tramo de vigencia del estado, nivel de conflicto y nivel de riesgo de un caso, con el motivo y el usuario que provocó el cambio.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso cuyo estado se registra en este tramo de vigencia |
| 3 | `nivel_conflicto_id` | smallint | sí | FK → core.cat_niveles_conflicto(id) | Nivel de conflicto vigente durante el tramo registrado |
| 4 | `nivel_riesgo_id` | smallint | no | FK → core.cat_niveles_riesgo(id) | Nivel de riesgo vigente durante el tramo registrado |
| 5 | `estado_id` | smallint | no | FK → core.cat_estados_caso(id) | Estado del caso vigente durante el tramo registrado |
| 6 | `desde` | timestamp with time zone | no | — | Momento en que empieza a regir el tramo registrado |
| 7 | `hasta` | timestamp with time zone | sí | — | Momento en que termina el tramo, vacío si sigue vigente |
| 8 | `motivo` | text | sí | — | Motivo del cambio de estado, nivel de conflicto o riesgo |
| 9 | `usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario que provocó el cambio registrado |
| 10 | `tipo_cambio_id` | smallint | sí | FK → core.cat_tipos_cambio_caso(id) | Tipo de cambio aplicado al caso según el catálogo |
| 11 | `codigo_legado` | character varying(50) | sí | UQ | Código del registro histórico en el sistema anterior |

#### `core.caso_factores`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `caso_id`, `factor_id`, `desde` · **Relaciones:** 2 · **Índices:** 1

Factores de contexto que inciden en un caso —climático, sanitario, exportador o social— con su período de vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `caso_id` | uuid | no | PK, FK → core.casos(id) | Caso al que se asocia el factor de contexto |
| 2 | `factor_id` | smallint | no | PK, FK → core.cat_factores_contexto(id) | Factor de contexto que incide en el caso |
| 3 | `desde` | date | no | PK | Fecha desde la que el factor se considera vigente en el caso |
| 4 | `hasta` | date | sí | — | Fecha en que el factor deja de aplicar al caso |

#### `core.caso_lugares`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `caso_id`, `lugar_id` · **Relaciones:** 2 · **Índices:** 2

Lugares vinculados a un caso, como cruce entre el expediente y el registro territorial de lugares.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `caso_id` | uuid | no | PK, FK → core.casos(id) | Caso al que se vincula el lugar |
| 2 | `lugar_id` | uuid | no | PK, FK → territorio.lugares(id) | Lugar del registro territorial vinculado al caso |

#### `core.caso_regiones`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 81 · **Columnas:** 3 · **Clave primaria:** `caso_id`, `region_id` · **Relaciones:** 2 · **Índices:** 2

Regiones alcanzadas por un caso y una marca que indica cuál de ellas se considera la principal.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `caso_id` | uuid | no | PK, FK → core.casos(id) | Caso que alcanza a la región por su alcance territorial |
| 2 | `region_id` | integer | no | PK, FK → core.regiones(id) | Región alcanzada por el caso en la desagregación territorial |
| 3 | `es_principal` | boolean | no | — | Indica si esa región es la principal del caso |

#### `core.casos`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 35 · **Columnas:** 40 · **Clave primaria:** `id` · **Relaciones:** 17 · **Índices:** 5

Expediente de conflictividad social: entidad, subsector, temática, niveles de conflicto y riesgo, estado y porcentaje de avance de la intervención.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `entidad_id` | smallint | no | FK → core.entidades(id) | Entidad del Estado que interviene en el caso |
| 3 | `codigo_caso` | character varying(50) | no | UQ | Código único con el que se identifica el expediente del caso |
| 4 | `nombre_caso` | character varying(255) | no | — | Denominación con la que se conoce el caso en reportes e interfaz |
| 5 | `distrito_principal_id` | integer | sí | FK → core.distritos(id) | Distrito principal donde se sitúa el conflicto |
| 6 | `alcance_id` | smallint | sí | FK → core.cat_alcances_geograficos(id) | Alcance geográfico del caso: norte, centro, sur, oriente o nacional |
| 7 | `subsector_id` | integer | no | FK → core.cat_subsectores(id) | Subsector del sector al que pertenece el caso |
| 8 | `tematica_id` | integer | no | FK → core.cat_tematicas(id) | Temática que clasifica el origen del conflicto |
| 9 | `unidad_responsable_id` | integer | no | FK → core.cat_unidades_organicas(id) | Unidad orgánica responsable de atender el caso |
| 10 | `punto_focal_usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario que actúa como punto focal del caso |
| 11 | `nivel_conflicto_id` | smallint | sí | FK → core.cat_niveles_conflicto(id) | Nivel de conflictividad social asignado al caso |
| 12 | `nivel_riesgo_id` | smallint | no | FK → core.cat_niveles_riesgo(id) | Nivel de riesgo asignado al caso |
| 13 | `prioridad_id` | smallint | sí | FK → core.cat_prioridades_atencion(id) | Prioridad de atención del caso |
| 14 | `estado_id` | smallint | no | FK → core.cat_estados_caso(id) | Estado del ciclo de vida del caso |
| 15 | `descripcion_riesgo` | text | sí | — | Explicación del riesgo asociado al caso |
| 16 | `latitud` | numeric(10,7) | sí | — | Latitud del punto que ubica geográficamente el caso |
| 17 | `longitud` | numeric(10,7) | sí | — | Longitud del punto que ubica geográficamente el caso |
| 18 | `fecha_inicio` | date | sí | — | Fecha de apertura del expediente del caso |
| 19 | `fecha_cierre` | date | sí | — | Fecha de cierre del caso, vacía si sigue abierto |
| 20 | `fecha_ultima_actualizacion` | timestamp with time zone | no | — | Momento de la última actualización de los datos del caso |
| 21 | `fuente_original` | character varying(30) | sí | — | Origen del registro del caso, por ejemplo carga inicial o alta manual |
| 22 | `es_seed_historico` | boolean | no | — | Indica si el caso proviene de la carga histórica inicial |
| 23 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 24 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 25 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que dio de alta el caso |
| 26 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la última modificación del registro |
| 27 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 28 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 29 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 30 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 31 | `ciclo_intervencion_id` | smallint | sí | FK → core.cat_ciclos_intervencion(id) | Ciclo de intervención en que se encuentra el caso |
| 32 | `pct_avance` | numeric(5,2) | sí | — | Porcentaje de avance de la intervención sobre el caso |
| 33 | `resumen_ejecutivo` | text | sí | — | Síntesis del caso para lectura rápida y reportes |
| 34 | `region_principal_id` | integer | sí | FK → core.regiones(id) | Región principal del caso en la desagregación territorial |
| 35 | `provincia_principal_id` | integer | sí | FK → core.provincias(id) | Provincia principal del caso en la desagregación territorial |
| 36 | `fecha_reapertura` | date | sí | — | Fecha en que el caso se reabrió tras un cierre |
| 37 | `n_reaperturas` | smallint | no | — | Cantidad de veces que el caso se ha reabierto |
| 38 | `motivo_cierre` | text | sí | — | Razón por la que se cerró el caso |
| 39 | `link_reporte_pdf` | character varying(500) | sí | — | Enlace al reporte en PDF generado para el caso |
| 40 | `codigo_legado` | character varying(50) | sí | UQ | Código del caso en el sistema anterior |

#### `core.casos_actores`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 60 · **Columnas:** 4 · **Clave primaria:** `caso_id`, `actor_id` · **Relaciones:** 2 · **Índices:** 2

Vínculo de un actor con un caso, con su nivel de influencia y la posición que adopta frente al conflicto.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `caso_id` | uuid | no | PK, FK → core.casos(id) | Caso en el que participa el actor |
| 2 | `actor_id` | uuid | no | PK, FK → core.actores(actor_uid) | Actor vinculado al caso dentro del padrón |
| 3 | `nivel_influencia` | smallint | no | — | Grado de influencia del actor en el desarrollo del caso, de 0 a 100 |
| 4 | `posicion` | character varying(20) | no | — | Postura del actor frente al conflicto: a favor, en contra o neutral |

#### `core.cat_alcances_geograficos`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 5 · **Columnas:** 2 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de alcances geográficos de un caso o compromiso: norte, centro, sur, oriente o nacional.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(20) | no | UQ | Código corto del alcance geográfico, usado en validaciones y cruces |

#### `core.cat_ciclos_intervencion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de ciclos de intervención: prevención, intervención y tratamiento, seguimiento y gestión del conocimiento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(80) | no | UQ | Nombre del ciclo: prevención, intervención, seguimiento u otro |
| 3 | `codigo_legado` | character varying(50) | sí | UQ | Código del ciclo en el sistema anterior |

#### `core.cat_clasificacion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 3 · **Columnas:** 2 · **Clave primaria:** `nivel` · **Relaciones:** 0 · **Índices:** 2

Catálogo de niveles de clasificación de la información: público, reservado y confidencial, que gobierna el acceso por fila.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `nivel` | smallint | no | PK | Número del nivel de acceso: 1 público, 2 reservado, 3 confidencial |
| 2 | `nombre` | character varying(20) | no | UQ | Etiqueta del nivel de acceso que se muestra en la interfaz |

#### `core.cat_especies`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 39 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de especies pesqueras y acuícolas con nombre común, nombre científico, familia, grupo biológico y ámbito.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre_comun` | character varying(80) | no | UQ | Nombre común de la especie, usado en fichas y reportes |
| 3 | `nombre_cientifico` | character varying(120) | sí | — | Nombre científico de la especie usado en registros técnicos |
| 4 | `familia` | character varying(100) | sí | — | Familia biológica a la que pertenece la especie |
| 5 | `grupo_biologico` | character varying(80) | sí | — | Grupo biológico de la especie, por ejemplo peces o moluscos |
| 6 | `ambito` | character varying(30) | sí | — | Ámbito de la especie: marino, continental o acuícola |
| 7 | `codigo_legado` | character varying(50) | sí | UQ | Código de la especie en el sistema anterior |
| 8 | `nombre_cientifico_legado` | character varying(120) | sí | — | Nombre científico tal como se registró en el legado |

#### `core.cat_estados_caso`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de estados del ciclo de vida de un caso: activo, en seguimiento, resuelto o archivado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(20) | no | UQ | Código del estado del caso: activo, en seguimiento, resuelto o archivado |
| 3 | `es_activo` | boolean | no | — | Indica si el estado está habilitado para asignarse a casos |

#### `core.cat_estados_compromiso`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 5 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de estados de un compromiso, agrupados en abiertos y cerrados, con marca de si son terminales.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(20) | no | UQ | Código del estado del compromiso usado en las reglas del flujo |
| 3 | `categoria` | character varying(10) | no | — | Grupo al que pertenece el estado: abierto o cerrado |
| 4 | `es_terminal` | boolean | no | — | Indica si el estado cierra el ciclo del compromiso |

#### `core.cat_estados_hito`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 5 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de estados de un hito de compromiso: registrado, en ejecución, paralizado, cumplido o desestimado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(20) | no | UQ | Código del estado del hito: registrado, en ejecución, cumplido u otro |
| 3 | `es_terminal` | boolean | no | — | Indica si el estado cierra el ciclo del hito |

#### `core.cat_estados_integracion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 8 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de estados del envío hacia un sistema externo: pendiente de aprobación, aprobado, enviado, confirmado o fallido.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(30) | no | UQ | Código del estado del envío hacia el sistema externo |
| 3 | `es_terminal` | boolean | no | — | Indica si el estado cierra el ciclo del envío externo |

#### `core.cat_factores_contexto`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 5 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de factores de contexto que pueden explicar un caso: climático, exportador, geopolítico, sanitario o de vulnerabilidad social.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(30) | no | UQ | Código del factor de contexto: climático, sanitario, exportador u otro |
| 3 | `nombre` | character varying(80) | no | — | Denominación del factor, mostrada en fichas y reportes |

#### `core.cat_mapeo_estado_externo`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 3 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Equivalencia entre el estado local de un compromiso y el estado que espera un sistema externo, como SESIGUE.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `sistema_destino` | character varying(100) | no | — | Sistema externo al que se envía el estado, como SESIGUE |
| 3 | `estado_local` | character varying(60) | no | — | Estado del compromiso en el sistema local |
| 4 | `estado_externo` | character varying(60) | no | — | Estado equivalente que espera el sistema externo |

Claves únicas compuestas: `sistema_destino`, `estado_local`.

#### `core.cat_niveles_alerta`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de niveles de alerta con su plazo de atención y su carácter reactivo o preventivo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(60) | no | UQ | Denominación del nivel de alerta mostrada en alertas y reportes |
| 3 | `descripcion` | text | sí | — | Explicación del alcance y las implicancias del nivel de alerta |
| 4 | `categoria` | character varying(20) | sí | — | Carácter del nivel de alerta: reactivo o preventivo |
| 5 | `sla_horas` | smallint | sí | — | Plazo de atención del nivel de alerta, expresado en horas |
| 6 | `codigo_legado` | character varying(50) | sí | UQ | Código del nivel de alerta en el sistema anterior |

#### `core.cat_niveles_conflicto`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de niveles de conflictividad social, de la diferencia a la crisis social, con su orden de gravedad.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(30) | no | UQ | Código del nivel de conflictividad social |
| 3 | `nombre` | character varying(50) | no | — | Denominación del nivel, de la diferencia a la crisis social |
| 4 | `orden` | smallint | no | — | Posición del nivel en la escala de gravedad, para comparar y ordenar |

#### `core.cat_niveles_riesgo`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 3 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de niveles de riesgo del caso —bajo, moderado o alto— con su orden para comparar y escalar.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(20) | no | UQ | Código del nivel de riesgo: bajo, moderado o alto |
| 3 | `orden` | smallint | no | — | Posición del nivel en la escala de riesgo, para comparar y escalar |

#### `core.cat_perfiles_actor`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 3 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de perfiles de comportamiento del actor —dialogante, legitimante o disruptivo— según su disposición al diálogo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(40) | no | UQ | Denominación del perfil: dialogante, legitimante o disruptivo |
| 3 | `codigo_legado` | character varying(50) | sí | UQ | Código del perfil en el sistema anterior |

#### `core.cat_pip_etapas`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 12 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Catálogo de etapas del ciclo de inversión pública, numeradas y ordenadas dentro de cada fase del proyecto.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `fase_id` | smallint | no | FK → core.cat_pip_fases(id) | Fase del ciclo de inversión a la que pertenece la etapa |
| 3 | `numero` | smallint | no | — | Número de orden de la etapa dentro de su fase |
| 4 | `nombre` | character varying(120) | no | — | Denominación de la etapa del ciclo de inversión pública |

Claves únicas compuestas: `fase_id`, `numero`.

#### `core.cat_pip_fases`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 6 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de fases del ciclo de inversión pública: programación, preinversión, inversión, ejecución y funcionamiento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(30) | no | UQ | Denominación de la fase: programación, preinversión, inversión u otra |
| 3 | `orden` | smallint | no | — | Posición de la fase dentro del ciclo de inversión pública |

#### `core.cat_prioridades_alerta`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de prioridades de alerta, con su plazo de respuesta: crítica inmediata, urgente, temprana o seguimiento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(30) | no | UQ | Código de la prioridad, asociado a su plazo de respuesta |
| 3 | `sla_horas` | smallint | sí | — | Plazo de respuesta de la prioridad, expresado en horas |

#### `core.cat_prioridades_atencion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 3 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de prioridades de atención de un caso —urgente, moderado o bajo— con su orden de atención.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(20) | no | UQ | Código de la prioridad de atención del caso |
| 3 | `orden` | smallint | no | — | Posición de la prioridad en la escala de atención |

#### `core.cat_roles_actor`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 7 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de roles del actor en el conflicto: principal, secundario, tercero, proveedor, exportador o inspector.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | integer | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(50) | no | UQ | Denominación del rol del actor en el conflicto |
| 3 | `codigo_legado` | character varying(50) | sí | UQ | Código del rol en el sistema anterior |

#### `core.cat_roles_funcionales`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de roles funcionales del actor en el análisis: decisor, proveedor de evidencia, implementador o articulador territorial.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(80) | no | UQ | Denominación del rol funcional del actor en el análisis |
| 3 | `descripcion` | text | sí | — | Explicación de las funciones que implica el rol funcional |
| 4 | `codigo_legado` | character varying(50) | sí | UQ | Código del rol funcional en el sistema anterior |

#### `core.cat_subsectores`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 3 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de subsectores del sector: pesca y acuicultura, MYPE e industria, y gestión y prevención de conflictos.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | integer | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(100) | no | UQ | Denominación del subsector dentro del catálogo del sector |
| 3 | `codigo_legado` | character varying(50) | sí | UQ | Código del subsector en el sistema anterior |
| 4 | `id_area_legado` | character varying(20) | sí | — | Identificador del área en el sistema anterior, conservado para cruces |

#### `core.cat_tematicas`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 7 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de temáticas que clasifican el origen del conflicto, de infraestructura a impactos de terceros, con su definición.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | integer | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(100) | no | UQ | Denominación de la temática que clasifica el origen del conflicto |
| 3 | `descripcion` | text | sí | — | Definición de la temática y de los conflictos que agrupa |
| 4 | `descripcion_legado` | text | sí | — | Definición de la temática tal como estaba redactada en el legado |
| 5 | `codigo_legado` | character varying(50) | sí | UQ | Código de la temática en el sistema anterior |
| 6 | `nota_calidad` | text | sí | — | Observación sobre la calidad o consistencia de los datos de la temática |

#### `core.cat_tipos_actor`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 7 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de tipos de actor: del Estado, de la sociedad civil o privado, más los tipos propios de los módulos sectoriales.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | integer | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(50) | no | UQ | Denominación del tipo de actor: del Estado, sociedad civil o privado |
| 3 | `codigo_legado` | character varying(50) | sí | UQ | Código del tipo de actor en el sistema anterior |

#### `core.cat_tipos_cambio_caso`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 6 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de tipos de cambio de un caso: escalada, desescalada, cierre, reapertura, desestimación o cambio de fase.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(60) | no | UQ | Denominación del tipo de cambio aplicable al caso |
| 3 | `descripcion` | text | sí | — | Explicación de en qué consiste el tipo de cambio del caso |
| 4 | `codigo_legado` | character varying(50) | sí | UQ | Código del tipo de cambio en el sistema anterior |

#### `core.cat_tipos_capacitacion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 2 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de tipos de capacitación impartida al público objetivo: taller, curso, charla o asistencia técnica.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(60) | no | UQ | Denominación del tipo de capacitación: taller, curso, charla u otro |

#### `core.cat_tipos_documento`

**Clasificación:** O · Salida (§12.3) · **Filas:** 15 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de tipos de documento, con el anexo de la Guía que lo origina y el esquema esperado de su contenido.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | UQ | Código del tipo de documento usado en documentos y plantillas |
| 3 | `nombre` | character varying(120) | no | — | Denominación del tipo de documento del expediente |
| 4 | `anexo_numero` | smallint | sí | — | Número del anexo de la Guía que origina este tipo de documento |
| 5 | `esquema_json` | jsonb | sí | — | Estructura esperada del contenido de los documentos de este tipo |

#### `core.cat_tipos_espacio_dialogo`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 7 · **Columnas:** 2 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de tipos de espacio de diálogo: mesa formalizada, comisión sectorial o multisectorial y grupo de trabajo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(120) | no | UQ | Denominación del tipo de espacio de diálogo |

#### `core.cat_tipos_fuente_integracion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 21 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de fuentes externas con las que se integra el sistema: SESIGUE, IMARPE, OEFA, SUNAT, VUCE, entre otras.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | UQ | Código de la fuente externa con la que se integra el sistema |
| 3 | `nombre` | character varying(120) | no | — | Denominación de la fuente externa, como SESIGUE, IMARPE u OEFA |

#### `core.cat_tipos_hecho`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 9 · **Columnas:** 2 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de tipos de hecho que se registran en la cronología de un caso, como bloqueo, comunicado o reunión técnica.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(80) | no | UQ | Denominación del tipo de hecho, como bloqueo o comunicado |

#### `core.cat_tipos_organizacion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 7 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Catálogo de formas organizativas: asociación, sindicato, cooperativa, comité, federación o gremio no formalizado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(100) | no | UQ | Denominación de la forma organizativa, como asociación o sindicato |
| 3 | `codigo_legado` | character varying(50) | sí | UQ | Código de la forma organizativa en el sistema anterior |

#### `core.cat_tipos_reunion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 4 · **Columnas:** 2 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de tipos de reunión de diálogo: asistencia técnica, preparatoria, ordinaria plenaria u otra.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | UQ | Código del tipo de reunión de diálogo |

#### `core.cat_unidades_organicas`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 66 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 4

Catálogo jerárquico de unidades orgánicas de cada entidad, con siglas y unidad padre, para asignar responsabilidades.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | integer | no | PK | Identificador interno de la fila |
| 2 | `entidad_id` | smallint | no | FK → core.entidades(id) | Entidad del Estado a la que pertenece la unidad orgánica |
| 3 | `siglas` | character varying(20) | no | — | Siglas con las que se identifica la unidad orgánica |
| 4 | `nombre_completo` | character varying(255) | no | — | Denominación completa de la unidad orgánica |
| 5 | `padre_id` | integer | sí | FK → core.cat_unidades_organicas(id) | Unidad orgánica de la que depende esta, para armar la jerarquía |
| 6 | `codigo_legado_area` | character varying(20) | sí | UQ | Código del área en el sistema anterior |
| 7 | `codigo_legado_unidad` | character varying(20) | sí | UQ | Código de la unidad en el sistema anterior |
| 8 | `estado` | character varying(20) | sí | — | Situación de la unidad orgánica, por ejemplo vigente o inactiva |

Claves únicas compuestas: `entidad_id`, `siglas`.

#### `core.compromiso_colaboradores`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `compromiso_id`, `actor_uid` · **Relaciones:** 2 · **Índices:** 2

Actores que colaboran en la ejecución de un compromiso, como vínculo entre el compromiso y el padrón de actores.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `compromiso_id` | uuid | no | PK, FK → core.compromisos(id) | Compromiso en cuya ejecución colabora el actor |
| 2 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor que colabora en la ejecución del compromiso |

#### `core.compromiso_distritos`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `compromiso_id`, `distrito_id` · **Relaciones:** 2 · **Índices:** 2

Distritos donde aplica un compromiso, como vínculo entre el compromiso y la división territorial distrital.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `compromiso_id` | uuid | no | PK, FK → core.compromisos(id) | Compromiso al que se asocia el distrito |
| 2 | `distrito_id` | integer | no | PK, FK → core.distritos(id) | Distrito donde aplica el compromiso |

#### `core.compromiso_pip`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 11 · **Clave primaria:** `compromiso_id` · **Relaciones:** 2 · **Índices:** 1

Proyecto de inversión pública asociado a un compromiso, con su código, monto total, presupuesto y avance de ejecución.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `compromiso_id` | uuid | no | PK, FK → core.compromisos(id) | Compromiso al que se asocia el proyecto de inversión |
| 2 | `codigo_snip` | character varying(50) | sí | — | Código SNIP del proyecto de inversión pública |
| 3 | `codigo_unificado` | character varying(50) | sí | — | Código unificado con el que se identifica el proyecto |
| 4 | `denominacion` | text | sí | — | Denominación oficial del proyecto de inversión |
| 5 | `unidad_formuladora` | character varying(255) | sí | — | Unidad que formuló el proyecto de inversión |
| 6 | `unidad_ejecutora` | character varying(255) | sí | — | Unidad que ejecuta el proyecto de inversión |
| 7 | `etapa_id` | smallint | sí | FK → core.cat_pip_etapas(id) | Etapa del ciclo de inversión en que se encuentra el proyecto |
| 8 | `monto_total` | numeric(15,2) | sí | — | Monto total del proyecto de inversión, expresado en soles |
| 9 | `pim` | numeric(15,2) | sí | — | Presupuesto institucional modificado vigente para el proyecto |
| 10 | `devengado` | numeric(15,2) | sí | — | Monto devengado del proyecto en el período consultado |
| 11 | `devengado_acumulado` | numeric(15,2) | sí | — | Monto devengado acumulado del proyecto a la fecha de corte |

#### `core.compromisos`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 8 · **Columnas:** 25 · **Clave primaria:** `id` · **Relaciones:** 11 · **Índices:** 6

Acuerdo asumido en una reunión de diálogo, con su acción, responsable, plazo, estado y criterios de verificación del cumplimiento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo_compromiso` | character varying(60) | no | UQ | Código único con el que se identifica el compromiso |
| 3 | `caso_id` | uuid | no | FK → core.casos(id) | Caso en cuyo marco se asumió el compromiso |
| 4 | `reunion_id` | uuid | sí | FK → core.reuniones_dialogo(id) | Reunión de diálogo en la que se asumió el compromiso |
| 5 | `documento_origen_id` | uuid | sí | FK → core.documentos(id) | Documento del que proviene el compromiso, como un acta |
| 6 | `unidad_responsable_id` | integer | no | FK → core.cat_unidades_organicas(id) | Unidad orgánica responsable de cumplir el compromiso |
| 7 | `alcance_id` | smallint | sí | FK → core.cat_alcances_geograficos(id) | Alcance geográfico del compromiso asumido |
| 8 | `tematica_id` | integer | sí | FK → core.cat_tematicas(id) | Temática a la que responde el compromiso |
| 9 | `fecha_inicio` | date | no | — | Fecha desde la que rige el compromiso |
| 10 | `accion_compromiso` | text | no | — | Acción concreta que el responsable se comprometió a ejecutar |
| 11 | `tipo_compromiso` | character varying(10) | no | — | Clase de compromiso asumido, codificada en pocos caracteres |
| 12 | `nivel_gobierno` | character varying(15) | sí | — | Nivel de gobierno del responsable: nacional, regional o local |
| 13 | `estado_id` | smallint | no | FK → core.cat_estados_compromiso(id) | Estado de cumplimiento del compromiso según el catálogo |
| 14 | `redefinido_de_id` | uuid | sí | FK → core.compromisos(id), UQ | Compromiso anterior que este reemplaza o redefine |
| 15 | `evidencia_cumplimiento_uri` | character varying(500) | sí | — | Enlace a la evidencia que acredita el cumplimiento del compromiso |
| 16 | `atiende_brecha_genero` | boolean | no | — | Indica si el compromiso atiende una brecha de género |
| 17 | `criterios_smart` | jsonb | sí | — | Criterios de verificación del compromiso guardados como estructura |
| 18 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 19 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 20 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró el compromiso |
| 21 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la última modificación del registro |
| 22 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 23 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 24 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 25 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `core.cronologia_vinculos`

**Clasificación:** Sin clasificar · **Filas:** 5 · **Columnas:** 3 · **Clave primaria:** — · **Relaciones:** 3 · **Índices:** 3

Cruce de un hecho de la cronología con la alerta o el documento que lo respalda o lo origina.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `cronologia_id` | uuid | no | FK → core.caso_cronologia(id) | Hecho de la cronología que se vincula con otros registros |
| 2 | `alerta_id` | uuid | sí | FK → core.alertas_tempranas(id) | Alerta temprana relacionada con el hecho |
| 3 | `documento_id` | uuid | sí | FK → core.documentos(id) | Documento que respalda o da origen al hecho |

#### `core.demandas`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 325 · **Columnas:** 26 · **Clave primaria:** `id` · **Relaciones:** 7 · **Índices:** 5

Demanda planteada por los actores, desagregada en problema, propuesta y pedido, con su estado de atención y su sustento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso en el que se plantea la demanda |
| 3 | `problema_3p` | text | sí | — | Problema que los actores identifican como origen de la demanda |
| 4 | `propuesta_3p` | text | sí | — | Propuesta que los actores plantean para atender el problema |
| 5 | `pedido_3p` | text | sí | — | Pedido concreto que los actores dirigen a la entidad |
| 6 | `estado_atencion` | character varying(20) | no | — | Situación de atención de la demanda |
| 7 | `motivo_no_atencion` | text | sí | — | Razón por la que la demanda no fue atendida |
| 8 | `fecha_vencimiento_respuesta` | date | sí | — | Fecha límite para responder la demanda |
| 9 | `afecta_diferenciadamente_mujeres` | boolean | no | — | Indica si la demanda afecta de manera distinta a las mujeres |
| 10 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 11 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 12 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró la demanda |
| 13 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la última modificación del registro |
| 14 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 15 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 16 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 17 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 18 | `descripcion_demanda` | text | sí | — | Descripción ampliada del contenido de la demanda |
| 19 | `alerta_id` | uuid | sí | FK → core.alertas_tempranas(id) | Alerta temprana en la que se originó la demanda |
| 20 | `tematica_id` | integer | sí | FK → core.cat_tematicas(id) | Temática a la que se asocia la demanda |
| 21 | `fecha_registro` | date | sí | — | Fecha en que la demanda quedó registrada |
| 22 | `tipo_evidencia_legado` | character varying(80) | sí | — | Tipo de evidencia tal como se anotó en el sistema anterior |
| 23 | `referencia_evidencia_legado` | character varying(255) | sí | — | Referencia de la evidencia conservada del sistema anterior |
| 24 | `codigo_legado` | character varying(50) | sí | UQ | Código de la demanda en el sistema anterior |
| 25 | `documento_origen_id` | uuid | sí | FK → core.documentos(id) | Documento del que proviene la demanda |
| 26 | `codigo_padre_legado` | character varying(50) | sí | — | Código del registro padre en el legado, para reconstruir jerarquías |

#### `core.demandas_actores`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 98 · **Columnas:** 3 · **Clave primaria:** `demanda_id`, `actor_id` · **Relaciones:** 2 · **Índices:** 2

Actores que plantean o respaldan una demanda, con el rol que cumplen en cada una de ellas.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `demanda_id` | uuid | no | PK, FK → core.demandas(id) | Demanda que el actor plantea o respalda |
| 2 | `actor_id` | uuid | no | PK, FK → core.actores(actor_uid) | Actor que plantea o respalda la demanda |
| 3 | `rol_en_demanda` | character varying(20) | no | — | Rol del actor en esa demanda, por ejemplo promotor o adherente |

#### `core.demandas_evidencias`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 77 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Evidencia incorporada a una demanda, con su tipo de fuente, su referencia y el archivo adjunto que la sustenta.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `demanda_id` | uuid | no | FK → core.demandas(id) | Demanda a la que se incorpora la evidencia |
| 3 | `fuente_tipo` | character varying(20) | no | — | Clase de fuente de la evidencia, por ejemplo documento o enlace |
| 4 | `url_referencia` | character varying(500) | sí | — | Enlace de referencia donde se puede consultar la evidencia |
| 5 | `archivo_adjunto_url` | character varying(500) | sí | — | Enlace al archivo adjunto que sustenta la evidencia |
| 6 | `fecha_incorporacion` | date | no | — | Fecha en que la evidencia se incorporó a la demanda |

#### `core.derivaciones_alerta`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Derivación de una alerta al área competente, con la fecha de envío, el plazo de respuesta y la fecha de atención.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `alerta_id` | uuid | no | FK → core.alertas_tempranas(id) | Alerta que se deriva al área competente |
| 3 | `area_destino_id` | integer | no | FK → core.cat_unidades_organicas(id) | Unidad orgánica a la que se deriva la alerta |
| 4 | `fecha_derivacion` | timestamp with time zone | no | — | Momento en que se envió la derivación |
| 5 | `fecha_limite` | timestamp with time zone | sí | — | Plazo máximo para atender la derivación |
| 6 | `fecha_atencion` | timestamp with time zone | sí | — | Momento en que el área atendió la derivación |
| 7 | `estado_atencion` | character varying(20) | no | — | Situación de atención de la derivación |

#### `core.distritos`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 698 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 4

División distrital con su código de ubigeo y su provincia, base de toda desagregación territorial del sistema.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | integer | no | PK | Identificador interno de la fila |
| 2 | `provincia_id` | integer | no | FK → core.provincias(id) | Provincia a la que pertenece el distrito |
| 3 | `ubigeo` | character(6) | no | UQ | Código de ubigeo del distrito, base de los cruces territoriales |
| 4 | `nombre` | character varying(100) | no | — | Denominación del distrito en los selectores territoriales |

Claves únicas compuestas: `provincia_id`, `nombre`.

#### `core.documento_actores`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `documento_id`, `actor_uid` · **Relaciones:** 2 · **Índices:** 1

Actor mencionado o vinculado a un documento, con el rol que cumple y si es su sujeto principal.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `documento_id` | uuid | no | PK, FK → core.documentos(id) | Documento en el que se menciona o vincula el actor |
| 2 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor mencionado en el documento o vinculado a él |
| 3 | `rol` | character varying(40) | sí | — | Papel del actor en el documento, por ejemplo firmante o mencionado |
| 4 | `es_principal` | boolean | no | — | Indica si el actor es el sujeto principal del documento |

#### `core.documentos`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 153 · **Columnas:** 24 · **Clave primaria:** `id` · **Relaciones:** 8 · **Índices:** 5

Documento del expediente —reporte, acta, informe, argumentario o relatoría— con su tipo, fecha, resumen y archivo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo_id` | smallint | no | FK → core.cat_tipos_documento(id) | Tipo de documento según el catálogo de tipos |
| 3 | `codigo` | character varying(60) | sí | UQ | Código único con el que se identifica el documento |
| 4 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso al que pertenece el documento |
| 5 | `reunion_id` | uuid | sí | FK → core.reuniones_dialogo(id) | Reunión de diálogo a la que se asocia el documento |
| 6 | `titulo` | character varying(255) | no | — | Título del documento, visible en el listado del expediente |
| 7 | `fecha` | date | no | — | Fecha del documento o de su emisión |
| 8 | `resumen_ejecutivo` | text | sí | — | Síntesis del contenido del documento |
| 9 | `contenido_json` | jsonb | no | — | Contenido estructurado del documento según su tipo |
| 10 | `url_pdf` | character varying(500) | sí | — | Enlace al archivo PDF del documento |
| 11 | `responsable_usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario responsable de elaborar o mantener el documento |
| 12 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 13 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 14 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró el documento |
| 15 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la última modificación del registro |
| 16 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 17 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 18 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 19 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 20 | `codigo_legado` | character varying(50) | sí | UQ | Código del documento en el sistema anterior |
| 21 | `estado` | character varying(40) | sí | — | Situación del documento, por ejemplo borrador o aprobado |
| 22 | `distrito_id` | integer | sí | FK → core.distritos(id) | Distrito al que se refiere el documento |
| 23 | `url_lista` | character varying(500) | sí | — | Enlace al listado o índice asociado al documento |
| 24 | `url_foto` | character varying(500) | sí | — | Enlace a la fotografía vinculada al documento |

#### `core.entidades`

**Clasificación:** Sin clasificar · **Filas:** 23 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Entidad del Estado con la que se relaciona el sistema, con sus siglas, su nivel y su estado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `siglas` | character varying(20) | no | UQ | Siglas con las que se identifica la entidad del Estado |
| 3 | `nombre` | character varying(255) | no | — | Denominación completa y oficial de la entidad |
| 4 | `codigo_legado` | character varying(20) | sí | — | Código de la entidad en el sistema anterior |
| 5 | `nivel` | character varying(15) | sí | — | Nivel de gobierno de la entidad: nacional, regional o local |
| 6 | `estado` | character varying(20) | sí | — | Situación de la entidad, por ejemplo vigente o inactiva |

#### `core.envios_comunicacion`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 17 · **Columnas:** 12 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Envío de comunicaciones y oficios, con su canal, remitente, destinatario, documento adjunto y resultado de la entrega.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(50) | sí | UQ | Código único con el que se identifica el envío |
| 3 | `fecha_envio` | timestamp with time zone | no | — | Momento en que se realizó el envío |
| 4 | `canal` | character varying(20) | no | — | Canal usado para el envío, como correo o mesa de partes |
| 5 | `entidad_tipo` | character varying(30) | sí | — | Tipo de registro al que se asocia el envío |
| 6 | `entidad_id` | uuid | sí | — | Identificador del registro al que se asocia el envío |
| 7 | `remitente_usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario que remitió la comunicación |
| 8 | `rol_remitente` | character varying(60) | sí | — | Rol con el que actuó el remitente del envío |
| 9 | `destinatario_texto` | text | sí | — | Destinatario del envío tal como se consignó |
| 10 | `url_pdf` | character varying(500) | sí | — | Enlace al PDF del oficio o comunicación enviada |
| 11 | `resultado` | character varying(255) | sí | — | Resultado de la entrega de la comunicación |
| 12 | `observacion` | text | sí | — | Observaciones sobre el envío o sobre su resultado |

#### `core.feature_flags`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 9 · **Columnas:** 6 · **Clave primaria:** `codigo` · **Relaciones:** 1 · **Índices:** 1

Interruptor de funcionalidad del sistema, con su estado, quién lo activó y metadatos de control.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `codigo` | character varying(40) | no | PK | Clave única que identifica el interruptor de funcionalidad |
| 2 | `descripcion` | text | no | — | Descripción de la funcionalidad que controla el interruptor |
| 3 | `activo` | boolean | no | — | Indica si la funcionalidad está habilitada en el sistema |
| 4 | `activado_en` | timestamp with time zone | sí | — | Momento en que se cambió el estado del interruptor |
| 5 | `activado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que cambió el estado del interruptor |
| 6 | `metadata_json` | jsonb | sí | — | Datos adicionales de control del interruptor, en estructura libre |

#### `core.flujo_definicion`

**Clasificación:** INF · Transversal (§12 (encabezado)) · **Filas:** 7 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Paso del flujo operativo por tipo de trámite —caso o reporte—, con su orden, estado resultante y rol responsable.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo_flujo` | character varying(10) | no | — | Tipo de flujo: caso, para el ciclo de vida de un caso, o reporte, para el de un reporte o una alerta |
| 3 | `orden` | smallint | no | — | Posición del paso dentro del flujo operativo |
| 4 | `nombre` | character varying(120) | no | — | Denominación del paso del flujo mostrada en la interfaz |
| 5 | `estado_resultante` | character varying(60) | no | — | Estado al que lleva el paso, con el vocabulario del sistema anterior (Activo, Remitido, Atendido, Registrado, Cerrado, Reaperturado). No es clave ajena a core.flujo_estado porque los dos vocabularios no coinciden y emparejarlos sería inventar la equivalencia |
| 6 | `rol_responsable` | character varying(120) | sí | — | Rol que debe ejecutar el paso del flujo |
| 7 | `descripcion` | text | sí | — | Descripción de lo que se hace en el paso del flujo |
| 8 | `codigo_legado` | character varying(60) | no | UQ | Identificador del paso en el sistema anterior: DPP-<n> si viene de dim_paso_proceso y DPPC-<n> si viene de dim_paso_proceso_caso |
| 9 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 10 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |

Claves únicas compuestas: `tipo_flujo`, `orden`.

#### `core.flujo_estado`

**Clasificación:** INF · Transversal (§12 (encabezado)) · **Filas:** 5 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de estados posibles de un paso del flujo operativo, con su color y marca de estado final.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(20) | no | UQ | Código de negocio heredado del sistema anterior (EST-01 a EST-05) |
| 3 | `nombre` | character varying(60) | no | — | Denominación del estado del flujo operativo |
| 4 | `color_hex` | character varying(7) | no | — | Color con que se muestra el estado en la interfaz, en hexadecimal |
| 5 | `es_final` | boolean | no | — | Indica si el paso queda en este estado y ya no admite avance; en el sistema anterior corresponde a Completado y Omitido |
| 6 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 7 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |

#### `core.fuentes_evidencia`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Fuente que respalda un hecho de la cronología, con su tipo, su referencia y su nivel de confiabilidad.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `cronologia_id` | uuid | no | FK → core.caso_cronologia(id) | Hecho de la cronología al que respalda la fuente |
| 3 | `tipo_fuente` | character varying(20) | no | — | Clase de fuente, por ejemplo documento, enlace o testimonio |
| 4 | `url_referencia` | character varying(500) | sí | — | Enlace donde se puede consultar la fuente |
| 5 | `nivel_confiabilidad` | character varying(10) | no | — | Grado de confiabilidad asignado a la fuente |

#### `core.hitos_compromiso`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 12 · **Columnas:** 12 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Hito de avance de un compromiso, con su fecha de vencimiento, estado, fecha real y evidencia de cumplimiento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `compromiso_id` | uuid | no | FK → core.compromisos(id) | Compromiso al que pertenece el hito |
| 3 | `codigo_hito` | character varying(70) | no | UQ | Código único con el que se identifica el hito |
| 4 | `descripcion_hito` | text | no | — | Descripción del avance o entregable que representa el hito |
| 5 | `fecha_vencimiento` | date | sí | — | Fecha en que el hito debe cumplirse |
| 6 | `estado_id` | smallint | no | FK → core.cat_estados_hito(id) | Estado del hito según el catálogo |
| 7 | `fecha_real` | date | sí | — | Fecha en que el hito se cumplió efectivamente |
| 8 | `validacion` | character varying(20) | sí | — | Resultado de la validación del cumplimiento del hito |
| 9 | `descripcion_evidencia` | text | sí | — | Detalle de la evidencia que acredita el cumplimiento del hito |
| 10 | `link_evidencia` | character varying(500) | sí | — | Enlace a la evidencia de cumplimiento del hito |
| 11 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 12 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `core.hitos_compromiso_estado_historico`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 2

Corte histórico del estado de un hito de compromiso, con la observación y la fecha en que se registró.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `hito_id` | uuid | no | FK → core.hitos_compromiso(id) | Hito cuyo estado se registra en este corte |
| 3 | `fecha_corte` | date | no | — | Fecha a la que corresponde el corte de estado |
| 4 | `estado_id` | smallint | no | FK → core.cat_estados_hito(id) | Estado del hito en la fecha de corte |
| 5 | `observacion` | text | sí | — | Observación que explica el estado registrado en el corte |
| 6 | `registrado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que registró el corte de estado |
| 7 | `registrado_en` | timestamp with time zone | no | — | Momento en que se grabó el corte de estado |

Claves únicas compuestas: `hito_id`, `fecha_corte`.

#### `core.integraciones`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 20 · **Columnas:** 13 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Intercambio configurado con un sistema externo, con su origen, destino, tipo de sincronización y estado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `sistema_origen` | character varying(100) | no | — | Sistema desde el que se origina el intercambio |
| 3 | `sistema_destino` | character varying(100) | no | — | Sistema hacia el que se dirige el intercambio |
| 4 | `entidad_origen_tipo` | character varying(50) | no | — | Tipo de entidad que se envía desde el sistema de origen |
| 5 | `entidad_origen_id` | uuid | no | — | Identificador del registro que se envía |
| 6 | `entidad_destino_ref` | character varying(100) | sí | — | Referencia del registro en el sistema de destino |
| 7 | `tipo_sync` | character varying(5) | no | — | Sentido del intercambio, codificado en pocos caracteres |
| 8 | `estado` | character varying(15) | no | — | Estado del intercambio con el sistema externo |
| 9 | `workflow_state` | character varying(50) | sí | — | Estado del trámite en el sistema externo, en texto libre; no debe confundirse con el estado de transporte del mensaje, que vive en core.outbox_integracion |
| 10 | `ultima_sincronizacion` | timestamp with time zone | sí | — | Momento de la última sincronización realizada |
| 11 | `metadata_json` | jsonb | sí | — | Datos adicionales del intercambio, guardados como estructura |
| 12 | `tipo_fuente_id` | smallint | sí | FK → core.cat_tipos_fuente_integracion(id) | Fuente externa con la que se integra, según el catálogo |
| 13 | `protocolo_sincronizacion` | character varying(20) | sí | — | Medio por el que se sincroniza, como oficio manual o servicio |

Claves únicas compuestas: `sistema_destino`, `entidad_origen_tipo`, `entidad_origen_id`.

#### `core.locales`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 27 · **Columnas:** 17 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Local disponible para reuniones y capacitaciones, con su dirección, aforo, equipamiento y datos de contacto.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(50) | no | UQ | Código único con el que se identifica el local |
| 3 | `nombre` | character varying(255) | no | — | Denominación con la que se conoce el local |
| 4 | `distrito_id` | integer | sí | FK → core.distritos(id) | Distrito donde se ubica el local |
| 5 | `direccion` | character varying(255) | sí | — | Dirección donde se ubica el local |
| 6 | `ubicacion_ref` | character varying(255) | sí | — | Referencia de ubicación que ayuda a llegar al local |
| 7 | `foto_url` | character varying(500) | sí | — | Enlace a una fotografía del local |
| 8 | `aforo` | integer | sí | — | Capacidad máxima de personas que admite el local |
| 9 | `ingresos` | character varying(100) | sí | — | Descripción de los ingresos o accesos con que cuenta el local |
| 10 | `tiene_proyector` | boolean | sí | — | Indica si el local cuenta con proyector |
| 11 | `tiene_equipos_computo` | boolean | sí | — | Indica si el local cuenta con equipos de cómputo |
| 12 | `tiene_audio_micro` | boolean | sí | — | Indica si el local cuenta con equipo de audio y micrófono |
| 13 | `contacto_nombre` | character varying(255) | sí | — | Nombre de la persona de contacto del local |
| 14 | `contacto_celular` | character varying(50) | sí | — | Celular de la persona de contacto del local |
| 15 | `contacto_email` | character varying(255) | sí | — | Correo de la persona de contacto del local |
| 16 | `recomendacion` | text | sí | — | Comentario sobre la conveniencia de usar el local |
| 17 | `activo` | boolean | no | — | Indica si el local está disponible para programar eventos |

#### `core.log_accesos`

**Clasificación:** O · Salida (§12.3) · **Filas:** 857 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Intento de acceso al sistema con el documento presentado, el rol declarado y el resultado obtenido.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | bigint | no | PK | Identificador interno de la fila |
| 2 | `fecha` | timestamp with time zone | no | — | Momento en que se produjo el intento de acceso |
| 3 | `dni` | character varying(12) | sí | — | Documento de identidad presentado en el intento de acceso |
| 4 | `nombre` | character varying(255) | sí | — | Nombre declarado o registrado en el intento de acceso |
| 5 | `rol_declarado` | character varying(60) | sí | — | Rol que el usuario declaró al intentar acceder |
| 6 | `resultado` | character varying(10) | no | — | Resultado del intento de acceso, por ejemplo exitoso o denegado |
| 7 | `usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario del sistema asociado al intento, si se identificó |
| 8 | `origen` | character varying(20) | no | — | Procedencia del registro del intento de acceso |
| 9 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `core.mesa_miembros`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 62 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 2

Miembro de una mesa de diálogo, con su rol, el documento de designación y el período de vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `mesa_id` | uuid | no | FK → core.mesas_dialogo(id) | Mesa de diálogo a la que está vinculado el miembro designado |
| 3 | `rol` | character varying(30) | no | — | Función del miembro en la mesa: presidencia, secretaría técnica, titular, alterno, integrante o invitado |
| 4 | `actor_uid` | uuid | sí | FK → core.actores | Actor del conflicto que ocupa el puesto, cuando se pudo identificar |
| 5 | `nombre_texto` | character varying(255) | sí | — | Nombre del miembro tal como figura en el documento, cuando no se resuelve el actor |
| 6 | `doc_designacion` | character varying(255) | sí | — | Documento que sustenta la designación del miembro en la mesa |
| 7 | `valid_from` | date | sí | — | Fecha desde la cual rige la designación del miembro |
| 8 | `valid_to` | date | sí | — | Fecha hasta la cual rige la designación del miembro |

#### `core.mesas_dialogo`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 21 · **Columnas:** 24 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Espacio de diálogo formalizado, con su tipo de instrumento, base legal, vigencia, objetivo y rol del sector.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(50) | no | UQ | Código único de la mesa en el registro, del tipo OAIPCS-001 |
| 3 | `tipo_espacio_id` | smallint | sí | FK → core.cat_tipos_espacio_dialogo(id) | Tipo de espacio de diálogo al que corresponde la mesa |
| 4 | `linea_oaipcs` | character varying(60) | sí | — | Línea de acción de la oficina bajo la cual se agrupa la mesa |
| 5 | `titulo` | character varying(255) | no | — | Denominación oficial con la que se identifica la mesa |
| 6 | `tipo_instrumento` | character varying(80) | sí | — | Tipo de instrumento normativo que crea la mesa, como un decreto supremo |
| 7 | `base_legal` | character varying(150) | sí | — | Norma que sustenta la creación de la mesa, citada por su número |
| 8 | `fecha_norma` | date | sí | — | Fecha de emisión de la norma que crea la mesa |
| 9 | `prorrogas_modificatorias` | text | sí | — | Prorrogas o modificaciones posteriores de la norma que crea la mesa |
| 10 | `fecha_instalacion` | date | sí | — | Fecha en que la mesa quedó instalada formalmente |
| 11 | `naturaleza` | character varying(30) | sí | — | Carácter declarado de la mesa, conservado como texto libre del legado |
| 12 | `fecha_fin_vigencia` | date | sí | — | Fecha en que termina la vigencia de la mesa |
| 13 | `estado_vigencia` | character varying(30) | sí | — | Situación de vigencia de la mesa: vigente, vencida, por vencer, permanente o sin fecha |
| 14 | `objetivo` | text | sí | — | Propósito que la mesa debe cumplir según su norma de creación |
| 15 | `rol_produce` | character varying(40) | sí | — | Papel que cumple el Ministerio dentro de la mesa, como secretaría técnica o presidencia |
| 16 | `ambito_departamento` | text | sí | — | Departamentos que cubre la mesa, escritos como lista de nombres |
| 17 | `doc_designacion` | text | sí | — | Documento que acredita la designación de los representantes de la mesa |
| 18 | `link_evidencia` | character varying(500) | sí | — | Enlace al archivo de evidencia de la mesa, alojado fuera del sistema |
| 19 | `sectorista_usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario del sistema que atiende la mesa como sectorista |
| 20 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 21 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 22 | `origen_dato` | character varying(20) | no | — | Vía por la que llegó el registro: manual, agente, flujo, legado histórico o mensajería |
| 23 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de clasificación de la información: 1 público, 2 interno, 3 sensible |
| 24 | `tiene_norma` | boolean | sí | — | Indica si la mesa cuenta con una norma formal de creación |

#### `core.migracion_conflicto`

**Clasificación:** Sin clasificar · **Filas:** 498 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Conflicto detectado al cargar los datos del sistema anterior, con su hoja y fila de origen y el estado de resolución.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | bigint | no | PK | Identificador interno de la fila |
| 2 | `fase` | smallint | no | — | Número de la fase del cargador en la que se detectó el conflicto |
| 3 | `categoria` | character varying(40) | no | — | Tipo de conflicto detectado, como DNI duplicado o membresía sin coincidencia |
| 4 | `hoja_legado` | character varying(60) | sí | — | Hoja del libro original donde se originó el conflicto |
| 5 | `fila_legado` | integer | sí | — | Número de fila dentro de la hoja de origen del conflicto |
| 6 | `codigo_legado` | character varying(80) | sí | — | Código del registro de origen, conservado para poder rastrearlo |
| 7 | `detalle` | jsonb | no | — | Datos del conflicto en formato libre, con los valores que no se pudieron conciliar |
| 8 | `resuelto` | boolean | no | — | Indica si el conflicto ya fue revisado y dado por resuelto |
| 9 | `resuelto_por` | uuid | sí | FK → core.usuarios(id) | Usuario que dio por resuelto el conflicto |
| 10 | `resuelto_at` | timestamp with time zone | sí | — | Momento en que se resolvió el conflicto |
| 11 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `core.notificaciones`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Aviso dirigido a un usuario sobre un hecho del sistema, con su tipo, vencimiento y estado de lectura.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `usuario_id` | uuid | no | FK → core.usuarios(id) | Usuario al que se dirige el aviso y que debe leerlo |
| 3 | `tipo` | character varying(30) | no | — | Clase de aviso emitido, según el catálogo interno de tipos |
| 4 | `entidad_tipo` | character varying(30) | sí | — | Tipo de entidad que motivó el aviso, como un caso o una alerta |
| 5 | `entidad_id` | uuid | sí | — | Identificador de la entidad que motivó el aviso |
| 6 | `vence_en` | timestamp with time zone | sí | — | Momento a partir del cual el aviso deja de estar vigente |
| 7 | `estado` | character varying(10) | no | — | Situación del aviso: pendiente, enviado o leído |
| 8 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `core.organizaciones`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 224 · **Columnas:** 21 · **Clave primaria:** `actor_uid` · **Relaciones:** 3 · **Índices:** 3

Organización inscrita como actor colectivo, con su RUC, base legal, integrantes y situación ante el registro de OSPA.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor colectivo del que esta fila guarda los datos propios de organización |
| 2 | `ruc` | character(11) | sí | UQ | Registro único de contribuyente de la organización |
| 3 | `razon_social` | character varying(255) | sí | — | Denominación legal con la que la organización figura en el registro |
| 4 | `representante_uid` | uuid | sí | FK → core.actores(actor_uid) | Actor que ejerce la representación legal de la organización |
| 5 | `numero_integrantes` | integer | sí | — | Cantidad de integrantes declarada por la organización |
| 6 | `expediente_ospa` | character varying(50) | sí | — | Número de expediente de la organización ante el registro de OSPA |
| 7 | `estado_ospa` | character varying(50) | sí | — | Situación de la organización ante el registro de OSPA |
| 8 | `vigencia_desde` | date | sí | — | Fecha desde la que rige la vigencia registrada de la organización |
| 9 | `vigencia_hasta` | date | sí | — | Fecha hasta la que rige la vigencia registrada de la organización |
| 10 | `fuente_sync` | character varying(50) | sí | — | Sistema externo del que se sincronizan los datos de la organización |
| 11 | `ultima_sync` | timestamp with time zone | sí | — | Momento de la última sincronización con el sistema externo |
| 12 | `direccion` | character varying(255) | sí | — | Dirección declarada de la organización |
| 13 | `fecha_constitucion` | date | sí | — | Fecha de constitución de la organización |
| 14 | `tipo_organizacion_id` | smallint | sí | FK → core.cat_tipos_organizacion(id) | Tipo de organización según el catálogo, como gremio o asociación |
| 15 | `inscripcion_sunarp` | character varying(30) | sí | — | Número de inscripción de la organización en el registro de SUNARP |
| 16 | `n_embarcaciones` | integer | sí | — | Cantidad de embarcaciones que declara tener la organización |
| 17 | `n_armadores` | integer | sí | — | Cantidad de armadores que declara tener la organización |
| 18 | `foto_url` | character varying(500) | sí | — | Enlace a la imagen de la organización usada en las fichas |
| 19 | `perfil` | text | sí | — | Descripción libre del perfil de la organización, escrita en el origen |
| 20 | `abreviatura` | character varying(50) | sí | — | Siglas con las que se identifica la organización en fichas y reportes |
| 21 | `facebook_url` | character varying(500) | sí | — | Enlace al perfil de la organización en Facebook |

#### `core.outbox_integracion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 12 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 3

Cola de envíos hacia un sistema externo, con el contenido transformado, los reintentos y la aprobación previa.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `integracion_id` | uuid | no | FK → core.integraciones(id) | Integración que define el destino y las reglas del envío |
| 3 | `payload_local` | jsonb | no | — | Contenido del hecho tal como lo conoce el sistema local, antes de transformarlo |
| 4 | `payload_transformado` | jsonb | sí | — | Contenido ya adaptado al formato del sistema externo, que llena el worker |
| 5 | `estado_id` | smallint | no | FK → core.cat_estados_integracion(id) | Estado del envío según el catálogo de estados de integración |
| 6 | `intentos` | integer | no | — | Cantidad de intentos de envío realizados hasta el momento |
| 7 | `ultimo_error` | text | sí | — | Mensaje del último fallo ocurrido al intentar el envío |
| 8 | `proximo_intento_en` | timestamp with time zone | sí | — | Momento previsto para el siguiente reintento de envío |
| 9 | `aprobado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que autorizó el envío al sistema externo |
| 10 | `aprobado_en` | timestamp with time zone | sí | — | Momento en que se autorizó el envío |
| 11 | `ticket_externo` | character varying(100) | sí | — | Referencia o comprobante que devuelve el sistema externo al recibir |
| 12 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `core.output_contracts`

**Clasificación:** O · Salida (§12.3) · **Filas:** 0 · **Columnas:** 12 · **Clave primaria:** `id` · **Relaciones:** 6 · **Índices:** 7

Contrato de cada salida generada, con su formato, la consulta que la originó y el commit y snapshot que la respaldan.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `query_id` | uuid | no | — | Identificador de la consulta que originó la salida, sin clave ajena en el esquema |
| 3 | `usuario_id` | uuid | no | FK → core.usuarios(id) | Usuario que solicitó la generación de la salida |
| 4 | `formato` | character varying(10) | no | — | Formato de la salida generada: office o minister |
| 5 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso al que corresponde la salida, cuando la consulta se refiere a uno |
| 6 | `response_json` | jsonb | sí | — | Contenido de la respuesta generada, guardado como documento JSON |
| 7 | `response_uri` | character varying(500) | sí | — | Ubicación del archivo de la salida, alojado fuera de la base |
| 8 | `snapshot_id` | uuid | sí | FK → ctx.snapshot(id) | Instantánea de la base sobre la que se generó la salida |
| 9 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de clasificación de la información: 1 público, 2 interno, 3 sensible |
| 10 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 11 | `policy_snapshot_id` | uuid | sí | FK → policy.snapshot(id) | Instantánea de las reglas de política usadas para decidir qué mostrar |
| 12 | `chat_commit_id` | uuid | sí | FK → chat.commit(id) | Confirmación de la conversación que originó la salida |

#### `core.permiso_aprobacion`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Autorización temporal que habilita a un usuario a aprobar un objeto determinado, con su vigencia y quién la otorgó.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `usuario_id` | uuid | no | FK → core.usuarios(id) | Usuario que recibe la autorización para aprobar |
| 3 | `objeto` | character varying(60) | no | — | Nombre del objeto sobre el que se concede la autorización para aprobar |
| 4 | `vigente_desde` | date | no | — | Fecha desde la que la autorización surte efecto |
| 5 | `vigente_hasta` | date | sí | — | Fecha hasta la que la autorización mantiene su efecto |
| 6 | `otorgado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que concedió la autorización |

#### `core.plan_acciones`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Acción de un plan de intervención, con su responsable, plazo, criterio de contención y estado de avance.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `plan_id` | uuid | no | FK → core.planes_accion(documento_id) | Plan de acción al que pertenece la acción, referido por su documento |
| 3 | `descripcion` | text | no | — | Texto que describe la acción acordada y lo que debe lograrse |
| 4 | `responsable_uid` | uuid | sí | FK → core.actores(actor_uid) | Actor designado como responsable de ejecutar la acción |
| 5 | `responsable_texto` | character varying(255) | sí | — | Nombre del responsable escrito en el origen, cuando no se resuelve el actor |
| 6 | `plazo_codigo` | character varying(12) | sí | — | Plazo abreviado de la acción, como inmediato, hoy o 48 horas |
| 7 | `plazo_limite` | timestamp with time zone | sí | — | Fecha y hora límite comprometida para cumplir la acción |
| 8 | `criterio_contencion` | text | sí | — | Condición que permite dar la acción por cumplida |
| 9 | `estado` | character varying(15) | no | — | Grado de avance de la acción: pendiente, en curso, cumplida o descartada |

#### `core.planes_accion`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `documento_id` · **Relaciones:** 1 · **Índices:** 1

Plan de acción con su monto presupuestal, plazo límite y estado de aprobación, asociado a un documento del expediente.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `documento_id` | uuid | no | PK, FK → core.documentos(id) | Documento del expediente que hace de plan y aporta su monto y plazo |
| 2 | `monto_presupuestal` | numeric(15,2) | sí | — | Monto presupuestal asignado al plan de acción |
| 3 | `plazo_limite` | timestamp with time zone | sí | — | Fecha y hora límite comprometida para ejecutar el plan |
| 4 | `estado_aprobacion` | character varying(20) | no | — | Situación de aprobación del plan: borrador, en revisión, aprobado o rechazado |

#### `core.proceso_instancia`

**Clasificación:** P · Proceso (§12 (encabezado)) · **Filas:** 135 · **Columnas:** 21 · **Clave primaria:** `id` · **Relaciones:** 8 · **Índices:** 5

Paso ejecutado del flujo operativo sobre un caso o un reporte, con su estado, responsable y fechas de ocurrencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo_origen` | character varying(10) | no | — | Origen del paso: caso o reporte. Determina qué clave ajena queda poblada y de qué tabla del sistema anterior viene |
| 3 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso asociado, cuando el código de caso existe en el maestro. Está vacío en las filas cuyo código no existe como caso |
| 4 | `codigo_caso_legado` | character varying(50) | sí | — | Código de caso tal como venía en el sistema anterior; se conserva siempre, exista o no el caso, para poder rastrearlo |
| 5 | `alerta_id` | uuid | sí | FK → core.alertas_tempranas(id) | Alerta temprana asociada, cuando el código de reporte existe en el maestro de alertas. Está vacío en las filas cuyo vínculo es solo el código de texto |
| 6 | `codigo_reporte` | character varying(50) | sí | — | Código de reporte conservado como texto, sin clave ajena. Trae el código de alerta cuando el origen lo tiene y, si no, el código de la fila de reporte |
| 7 | `flujo_definicion_id` | uuid | sí | FK → core.flujo_definicion(id) | Paso del catálogo, resuelto por tipo de flujo y número de orden. Está vacío en las instancias de reporte cuyo paso no existe en el sistema anterior, porque allí solo hay tres pasos definidos |
| 8 | `estado_id` | uuid | sí | FK → core.flujo_estado(id) | Estado del paso. El sistema anterior no registraba estado por paso, así que está vacío en todas las instancias cargadas; el catálogo se llena igual para cuando el flujo se use en vivo |
| 9 | `usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario responsable, resuelto por su código del sistema anterior. Está vacío en las filas cuyo responsable no existe como usuario |
| 10 | `codigo_responsable_legado` | character varying(50) | sí | — | Responsable tal como venía en el sistema anterior; se conserva aunque se resuelva el usuario |
| 11 | `ocurrido_en` | timestamp with time zone | sí | — | Fecha y hora del paso, interpretada en hora de Lima. Está vacía en la fila que viene sin fecha de inicio |
| 12 | `finalizado_en` | timestamp with time zone | sí | — | Fecha y hora de fin del paso, cuando el sistema anterior la trae |
| 13 | `orden` | smallint | no | — | Número de paso tal como viene en el sistema anterior; se conserva aunque no exista una definición para ese paso |
| 14 | `nota` | text | sí | — | Texto libre del paso; en caso viene de la columna c09 y en reporte de la c08, porque las dos tablas de origen no comparten el significado de sus columnas |
| 15 | `codigo_legado` | character varying(50) | no | — | Código de la fila de proceso en el sistema anterior (PC, PR o PR-AL). No es único: hay códigos repetidos con instantes distintos |
| 16 | `fila_legado` | smallint | no | — | Número de fila de la tabla de origen; junto con el tipo de origen forma la clave que evita cargar dos veces el mismo paso |
| 17 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 18 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 19 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró la fila en el sistema |
| 20 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario de la última modificación |
| 21 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de clasificación de la información: 1 público, 2 interno, 3 sensible |

Claves únicas compuestas: `tipo_origen`, `fila_legado`.

#### `core.provincias`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 70 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 4

Provincia con su código de ubigeo y su región, para desagregar casos y lugares en el territorio.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | integer | no | PK | Identificador interno de la provincia |
| 2 | `region_id` | integer | no | FK → core.regiones(id) | Región a la que pertenece la provincia |
| 3 | `ubigeo` | character(4) | no | UQ | Código de ubigeo de cuatro dígitos asignado por el INEI |
| 4 | `nombre` | character varying(100) | no | — | Denominación oficial de la provincia |

Claves únicas compuestas: `region_id`, `nombre`.

#### `core.query_cache`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `clave_hash`, `clasificacion_max`, `policy_hash` · **Relaciones:** 1 · **Índices:** 1

Respuesta memorizada de una consulta, con su clave, su clasificación máxima y la huella de la política vigente al generarla.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `clave_hash` | character(64) | no | PK | Huella de la consulta normalizada, usada como clave de la memoria |
| 2 | `clasificacion_max` | smallint | no | PK, FK → core.cat_clasificacion(nivel) | Nivel de clasificación máximo de la respuesta guardada |
| 3 | `respuesta` | jsonb | no | — | Respuesta de la consulta guardada para reutilizarla |
| 4 | `creado` | timestamp with time zone | no | — | Momento en que se guardó la respuesta en la memoria |
| 5 | `expira` | timestamp with time zone | no | — | Momento a partir del cual la respuesta deja de reutilizarse |
| 6 | `policy_hash` | character(64) | no | PK | Huella de las reglas de política vigentes al generar la respuesta |

#### `core.regiones`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 25 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 3

Región o departamento con su ubigeo, unidad de mayor nivel para la desagregación territorial de casos y usuarios.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | integer | no | PK | Identificador interno de la región |
| 2 | `ubigeo` | character(2) | no | UQ | Código de ubigeo de dos dígitos asignado por el INEI |
| 3 | `nombre` | character varying(100) | no | UQ | Denominación oficial de la región o departamento |

#### `core.reunion_participantes`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `reunion_id`, `actor_uid` · **Relaciones:** 3 · **Índices:** 3

Participante de una reunión de diálogo, con su institución, cargo y constancia de asistencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `reunion_id` | uuid | no | PK, FK → core.reuniones_dialogo(id) | Reunión de diálogo en la que participa la persona |
| 2 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor que asiste o está convocado a la reunión |
| 3 | `institucion_uid` | uuid | sí | FK → core.actores(actor_uid) | Institución que representa el participante en la reunión |
| 4 | `cargo` | character varying(100) | sí | — | Cargo con el que el participante acude a la reunión |
| 5 | `asistio` | boolean | no | — | Indica si el participante asistió efectivamente a la reunión |

#### `core.reuniones_dialogo`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 19 · **Clave primaria:** `id` · **Relaciones:** 7 · **Índices:** 3

Reunión de diálogo vinculada a un caso, con su tipo, fecha, lugar y unidad orgánica que la convoca.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo_reunion` | character varying(50) | sí | UQ | Código único de la reunión dentro del registro de diálogo |
| 3 | `caso_id` | uuid | no | FK → core.casos(id) | Caso al que se vincula la reunión de diálogo |
| 4 | `convocante_unidad_id` | integer | no | FK → core.cat_unidades_organicas(id) | Unidad orgánica que convoca la reunión |
| 5 | `tipo_id` | smallint | sí | FK → core.cat_tipos_reunion(id) | Tipo de reunión según el catálogo de tipos de reunión |
| 6 | `programada` | boolean | no | — | Indica si la reunión quedó programada o se registró como no programada |
| 7 | `titulo` | character varying(255) | sí | — | Asunto o denominación con que se identifica la reunión |
| 8 | `fecha` | timestamp with time zone | no | — | Fecha y hora en que se realizó o se realizará la reunión |
| 9 | `lugar` | character varying(255) | sí | — | Lugar donde se lleva a cabo la reunión |
| 10 | `responsable_usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario del sistema responsable de la reunión |
| 11 | `nota_publicacion_url` | character varying(500) | sí | — | Enlace a la nota o publicación difundida sobre la reunión |
| 12 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 13 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 14 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró la fila en el sistema |
| 15 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario de la última modificación |
| 16 | `origen_dato` | character varying(20) | no | — | Vía por la que llegó el registro: manual, agente, flujo, legado histórico o mensajería |
| 17 | `confidence` | numeric(3,2) | sí | — | Grado de confianza del dato registrado, entre 0 y 1 |
| 18 | `es_validado_humano` | boolean | no | — | Indica si una persona revisó y confirmó los datos de la reunión |
| 19 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de clasificación de la información: 1 público, 2 interno, 3 sensible |

#### `core.riesgo_social_ordinal`

**Clasificación:** P · Proceso (§12.5) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 4

Nivel de riesgo social estimado para un lugar y una fecha, con el conteo de eventos y convocatorias y su justificación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `lugar_id` | uuid | no | FK → territorio.lugares(id) | Lugar del territorio al que se refiere la estimación |
| 3 | `fecha` | date | no | — | Fecha a la que corresponde la estimación de riesgo |
| 4 | `nivel` | character varying(10) | no | — | Nivel de riesgo asignado al lugar en esa fecha: verde, ámbar o rojo |
| 5 | `eventos_count` | integer | no | — | Cantidad de eventos contabilizados para estimar el riesgo |
| 6 | `convocatorias_count` | integer | no | — | Cantidad de convocatorias contabilizadas para estimar el riesgo |
| 7 | `fuente` | character varying(60) | no | — | Fuente de la que proviene la estimación, como defensoria o prensa |
| 8 | `justificacion` | text | sí | — | Explicación de por qué se asignó ese nivel de riesgo |
| 9 | `es_validado_humano` | boolean | no | — | Indica si una persona revisó y confirmó la estimación |
| 10 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de clasificación de la información: 1 público, 2 interno, 3 sensible |

Claves únicas compuestas: `lugar_id`, `fecha`, `fuente`.

#### `core.roles`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 9 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Rol de acceso del sistema con su nivel máximo de clasificación, base del control de permisos por perfil.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno del rol de acceso |
| 2 | `codigo` | character varying(30) | no | UQ | Código corto del rol, usado en la asignación de permisos |
| 3 | `max_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel máximo de clasificación que el rol puede consultar |

#### `core.suscripcion_notificacion`

**Clasificación:** O · Salida (§12.3) · **Filas:** 4 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Suscripción de una unidad orgánica a los avisos de alerta, clima social y reporte rápido, con su canal preferido.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `unidad_id` | integer | sí | FK → core.cat_unidades_organicas(id) | Unidad orgánica suscrita a los avisos |
| 3 | `recibe_alerta` | boolean | no | — | Indica si la unidad recibe avisos de alertas |
| 4 | `recibe_clima_social` | boolean | no | — | Indica si la unidad recibe avisos de clima social |
| 5 | `recibe_reporte_rapido` | boolean | no | — | Indica si la unidad recibe avisos de reporte rápido |
| 6 | `canal_preferido` | character varying(30) | sí | — | Canal por el que la unidad prefiere recibir los avisos, como correo o mensajería |
| 7 | `activo` | boolean | no | — | Indica si la suscripción está operativa |
| 8 | `codigo_legado` | character varying(50) | sí | UQ | Código de la suscripción en el sistema anterior, conservado para rastreo |

#### `core.usuario_roles`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 34 · **Columnas:** 4 · **Clave primaria:** `usuario_id`, `rol_id`, `desde` · **Relaciones:** 2 · **Índices:** 1

Asignación de un rol a un usuario, con el período durante el cual esa asignación está vigente.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `usuario_id` | uuid | no | PK, FK → core.usuarios(id) | Usuario al que se asigna el rol |
| 2 | `rol_id` | smallint | no | PK, FK → core.roles(id) | Rol que se concede al usuario durante el período indicado |
| 3 | `desde` | date | no | PK | Fecha desde la que rige la asignación del rol |
| 4 | `hasta` | date | sí | — | Fecha hasta la que rige la asignación del rol |

#### `core.usuario_territorio`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 25 · **Columnas:** 2 · **Clave primaria:** `usuario_id`, `region_id` · **Relaciones:** 2 · **Índices:** 1

Regiones sobre las que puede consultar un usuario, como restricción territorial de su acceso.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `usuario_id` | uuid | no | PK, FK → core.usuarios(id) | Usuario al que se restringe el acceso territorial |
| 2 | `region_id` | integer | no | PK, FK → core.regiones(id) | Región sobre la que el usuario puede consultar |

#### `core.usuarios`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 32 · **Columnas:** 13 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 5

Persona habilitada para operar el sistema, con su unidad orgánica, cargo, credenciales e identificación de directorio.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `sso_subject` | character varying(255) | sí | UQ | Identificador del usuario en el servicio institucional de identidad |
| 3 | `nombre` | character varying(255) | no | — | Nombre completo del usuario tal como se muestra en la aplicación |
| 4 | `email` | character varying(255) | sí | UQ | Correo electrónico institucional del usuario |
| 5 | `unidad_id` | integer | sí | FK → core.cat_unidades_organicas(id) | Unidad orgánica a la que pertenece el usuario |
| 6 | `activo` | boolean | no | — | Indica si la cuenta está habilitada para operar el sistema |
| 7 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 8 | `dni` | character varying(12) | sí | — | Documento nacional de identidad del usuario |
| 9 | `telefono` | character varying(50) | sí | — | Teléfono de contacto del usuario |
| 10 | `cargo` | character varying(150) | sí | — | Cargo que desempeña el usuario en su unidad orgánica |
| 11 | `foto_url` | character varying(500) | sí | — | Enlace a la fotografía del usuario usada en la aplicación |
| 12 | `clave_hash` | text | sí | — | Resumen cifrado de la contraseña local del usuario |
| 13 | `codigo_legado` | character varying(50) | sí | UQ | Código del usuario en el sistema anterior, conservado para rastreo |

### 5.10 `ctx`

Contexto sistémico: variables externas, dominios y observaciones que condicionan el análisis.

10 tablas · 61 columnas · 28 filas.

#### `ctx.captura`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Captura de una fuente web o documento durante una recolección, con su hash, archivo, tipo de contenido y clasificación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `trabajo_id` | uuid | no | FK → ctx.trabajo_recoleccion(id) | Trabajo de recolección durante el cual se obtuvo la captura |
| 3 | `url` | character varying(2000) | no | — | Dirección de la fuente web o documento capturado |
| 4 | `obtenido_en` | timestamp with time zone | no | — | Momento en que se obtuvo el contenido de la fuente |
| 5 | `hash` | character(64) | no | — | Huella del contenido capturado, para detectar cambios y duplicados |
| 6 | `uri_archivo` | character varying(500) | no | — | Ubicación del archivo guardado con la copia de la captura |
| 7 | `tipo_contenido` | character varying(80) | sí | — | Tipo de contenido capturado, como página, PDF o planilla |
| 8 | `corpus_id` | smallint | sí | FK → kag.cat_corpus(id) | Corpus documental al que se adscribe la captura |
| 9 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `ctx.cat_dominios`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 8 · **Columnas:** 2 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de dominios de contexto —oceanográfico, económico, territorial, hídrico, entre otros— que agrupan variables.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Clave numérica del dominio de contexto en el catálogo |
| 2 | `codigo` | character varying(20) | no | UQ | Código corto del dominio de contexto, como oceanográfico o económico |

#### `ctx.cat_fuentes`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de fuentes de las que se obtienen variables de contexto, con su nombre y su dirección base.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Clave numérica de la fuente en el catálogo de fuentes de contexto |
| 2 | `codigo` | character varying(30) | no | UQ | Código corto que identifica la fuente de contexto |
| 3 | `nombre` | character varying(120) | no | — | Nombre legible de la fuente de la que provienen las variables |
| 4 | `url_base` | character varying(255) | sí | — | Dirección base desde la que se consultan los datos de la fuente |

#### `ctx.cat_variables`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 20 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Catálogo de variables de contexto con su dominio, unidad de medida, ámbito, periodicidad y plazo de frescura.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Clave numérica de la variable en el catálogo de contexto |
| 2 | `codigo` | character varying(40) | no | UQ | Código único de la variable de contexto, usado en consultas y reportes |
| 3 | `nombre` | character varying(150) | no | — | Nombre legible de la variable de contexto medida |
| 4 | `dominio_id` | smallint | no | FK → ctx.cat_dominios(id) | Dominio de contexto al que pertenece la variable |
| 5 | `unidad` | character varying(30) | sí | — | Unidad de medida en que se expresa la variable |
| 6 | `ambito` | character varying(15) | no | — | Alcance territorial de la variable, como nacional, regional o local |
| 7 | `por_especie` | boolean | no | — | Indica si la variable se mide desagregada por especie |
| 8 | `periodicidad_dias` | smallint | sí | — | Cada cuántos días se espera una nueva observación de la variable |
| 9 | `ttl_frescura_dias` | smallint | no | — | Días tras los cuales la observación se considera desactualizada |

#### `ctx.herramienta`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Herramienta de recolección con su tipo, dominios permitidos, límite de uso por hora y si exige aprobación previa.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Clave numérica de la herramienta en el catálogo de recolección |
| 2 | `codigo` | character varying(40) | no | UQ | Código único de la herramienta de recolección |
| 3 | `tipo` | character varying(20) | no | — | Clase de herramienta, como navegador, API o descarga directa |
| 4 | `dominios_permitidos` | text[] | no | — | Dominios de contexto que la herramienta está autorizada a recolectar |
| 5 | `limite_tasa_hora` | integer | no | — | Máximo de consultas por hora permitido a la herramienta |
| 6 | `requiere_aprobacion` | boolean | no | — | Indica si su uso necesita aprobación previa de un responsable |

#### `ctx.observaciones`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 13 · **Clave primaria:** `id`, `fecha` · **Relaciones:** 8 · **Índices:** 4 · **Particionada en:** 6

Valor observado de una variable de contexto en una fecha y ámbito, con su fuente y su desagregación territorial.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | bigint | no | PK | Clave numérica de la observación, junto con la fecha en que se midió |
| 2 | `fecha` | date | no | PK | Fecha a la que corresponde el valor observado de la variable |
| 3 | `variable_id` | smallint | no | FK → ctx.cat_variables(id) | Variable de contexto medida en esta observación |
| 4 | `fuente_id` | smallint | no | FK → ctx.cat_fuentes(id) | Fuente de la que se obtuvo el valor observado |
| 5 | `valor` | numeric(18,4) | no | — | Valor numérico observado para la variable en la fecha indicada |
| 6 | `especie_id` | smallint | sí | FK → core.cat_especies(id) | Especie a la que se refiere el valor, cuando la variable va por especie |
| 7 | `region_id` | integer | sí | FK → core.regiones(id) | Región a la que se desagrega la observación, si aplica |
| 8 | `provincia_id` | integer | sí | FK → core.provincias(id) | Provincia a la que se desagrega la observación, si aplica |
| 9 | `distrito_id` | integer | sí | FK → core.distritos(id) | Distrito al que se desagrega la observación, si aplica |
| 10 | `lugar_id` | uuid | sí | FK → territorio.lugares(id) | Lugar concreto al que se refiere la observación de contexto |
| 11 | `zona_maritima_id` | smallint | sí | FK → ctx.zonas_maritimas(id) | Zona marítima a la que se refiere la observación de ámbito marino |
| 12 | `ingerido_en` | timestamp with time zone | no | — | Momento en que el sistema incorporó la observación |
| 13 | `metadata` | jsonb | sí | — | Datos adicionales de la observación, como notas o condiciones de medición |

#### `ctx.snapshot`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 2

Foto del contexto vigente de un caso en una fecha, con su hash, que respalda lo que el sistema sabía en ese momento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso cuyo contexto se fotografía en este snapshot |
| 3 | `fecha` | date | no | — | Fecha a la que corresponde el contexto capturado |
| 4 | `contenido` | jsonb | no | — | Contexto vigente del caso, congelado como documento JSON |
| 5 | `hash` | character(64) | no | — | Huella del contenido, para comprobar que la foto no fue alterada |
| 6 | `creado_por` | uuid | sí | FK → core.usuarios(id) | Usuario o proceso que generó el snapshot de contexto |
| 7 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `ctx.trabajo_recoleccion`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Trabajo programado de recolección de una variable o indicador, con su herramienta, estado y último error registrado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `variable_id` | smallint | sí | FK → ctx.cat_variables(id) | Variable de contexto que este trabajo busca recolectar |
| 3 | `indicador_id` | uuid | sí | FK → ind.indicador(id) | Indicador para el que se recolecta la variable, cuando aplica |
| 4 | `herramienta_id` | smallint | no | FK → ctx.herramienta(id) | Herramienta con la que se ejecuta la recolección |
| 5 | `estado` | character varying(10) | no | — | Situación del trabajo de recolección, por defecto activo |
| 6 | `ultima_ejecucion` | timestamp with time zone | sí | — | Momento de la última vez que se ejecutó el trabajo |
| 7 | `error` | text | sí | — | Mensaje del último error ocurrido durante la recolección |

#### `ctx.variable_fuentes`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `variable_id`, `fuente_id` · **Relaciones:** 2 · **Índices:** 1

Fuente admisible para obtener una variable de contexto, como vínculo entre la variable y la fuente que la publica.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `variable_id` | smallint | no | PK, FK → ctx.cat_variables(id) | Variable de contexto que la fuente puede proveer |
| 2 | `fuente_id` | smallint | no | PK, FK → ctx.cat_fuentes(id) | Fuente admisible para obtener los valores de esa variable |

#### `ctx.zonas_maritimas`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Zona marítima de referencia para desagregar las observaciones de contexto de ámbito marino.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Clave numérica de la zona marítima de referencia |
| 2 | `nombre` | character varying(100) | no | UQ | Nombre de la zona marítima usada para desagregar observaciones |

### 5.11 `domain`

Módulo de expansión con artefactos de dominio; sin uso todavía.

4 tablas · 47 columnas · 15 filas.

#### `domain.artefacto`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 23 · **Clave primaria:** `id` · **Relaciones:** 11 · **Índices:** 7

Artefacto de dominio versionado y bitemporal, con su carga útil, su sujeto, su estado de validación y su clasificación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo_id` | uuid | no | FK → domain.tipo_artefacto(id) | Tipo de artefacto que define su esquema y reglas de validación |
| 3 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso al que se vincula el artefacto cuando el tipo lo exige |
| 4 | `sujeto_actor_uid` | uuid | sí | FK → core.actores(actor_uid) | Actor sobre el que trata el artefacto, si su sujeto es una persona |
| 5 | `sujeto_lugar_id` | uuid | sí | FK → territorio.lugares(id) | Lugar o caleta sobre el que trata el artefacto de dominio |
| 6 | `sujeto_especie_id` | smallint | sí | FK → core.cat_especies(id) | Especie del catálogo sobre la que trata el artefacto |
| 7 | `sujeto_documento_id` | uuid | sí | FK → kag.documento_fuente(id) | Documento fuente sobre el que se apoya o del que deriva el artefacto |
| 8 | `payload` | jsonb | no | — | Contenido del artefacto en formato JSON, según su tipo y versión |
| 9 | `version_esquema` | character varying(10) | no | — | Versión del esquema de validación aplicada al contenido del artefacto |
| 10 | `estado_id` | smallint | no | FK → domain.cat_estados_artefacto(id) | Estado del ciclo de vida del artefacto dentro de su flujo de validación |
| 11 | `valid_from` | timestamp with time zone | no | — | Inicio de la vigencia temporal del dato según el modelo bitemporal |
| 12 | `valid_to` | timestamp with time zone | sí | — | Fin de la vigencia temporal del dato; nulo si sigue vigente |
| 13 | `recorded_at` | timestamp with time zone | no | — | Momento en que el sistema registró el artefacto en la base |
| 14 | `superseded_at` | timestamp with time zone | sí | — | Momento en que el artefacto fue reemplazado por una versión nueva |
| 15 | `supersedes_id` | uuid | sí | FK → domain.artefacto(id) | Artefacto anterior al que esta versión reemplaza |
| 16 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró el artefacto en el sistema |
| 17 | `updated_by` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la última modificación del artefacto |
| 18 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 19 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |
| 20 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 21 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 22 | `es_validado_humano` | boolean | no | — | Indica si una persona revisó y validó el contenido del artefacto |
| 23 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `domain.cat_estados_artefacto`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 6 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de estados del ciclo de vida de un artefacto: borrador, pendiente de validación, validado, aprobado o cerrado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno del estado del artefacto |
| 2 | `codigo` | character varying(20) | no | UQ | Código corto del estado, usado por las reglas de transición |
| 3 | `es_terminal` | boolean | no | — | Indica si el estado cierra el ciclo y no admite transiciones |

#### `domain.regla_negocio`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 3 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 3

Regla que condiciona el paso de un artefacto entre estados, con su condición de evaluación y su mensaje de error.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo_artefacto_id` | uuid | no | FK → domain.tipo_artefacto(id) | Tipo de artefacto al que se aplica la regla de transición |
| 3 | `codigo` | character varying(60) | no | — | Código que identifica la regla dentro del catálogo de negocio |
| 4 | `tipo_regla` | character varying(12) | no | — | Clase de la regla, como obligatoria, advertencia o bloqueo |
| 5 | `estado_desde_id` | smallint | sí | FK → domain.cat_estados_artefacto(id) | Estado de origen desde el cual se evalúa la transición |
| 6 | `estado_hasta_id` | smallint | sí | FK → domain.cat_estados_artefacto(id) | Estado de destino que la regla habilita o impide |
| 7 | `condicion_sql` | text | sí | — | Expresión SQL que el artefacto debe cumplir para cambiar de estado |
| 8 | `mensaje_error` | text | no | — | Texto que se muestra cuando la condición de la regla no se cumple |
| 9 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 10 | `activo` | boolean | no | — | Indica si la regla se evalúa actualmente en el flujo de estados |
| 11 | `version` | character varying(10) | no | — | Versión de la definición de la regla, para trazabilidad de cambios |

Claves únicas compuestas: `tipo_artefacto_id`, `codigo`, `version`.

#### `domain.tipo_artefacto`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 6 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Tipo de artefacto con su dominio, esquema de validación y requisitos de sujeto, que habilita nuevas entidades sin cambiar el modelo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(60) | no | — | Código estable que identifica el tipo de artefacto en el dominio |
| 3 | `dominio` | character varying(30) | no | — | Dominio funcional al que pertenece el tipo de artefacto |
| 4 | `version` | character varying(10) | no | — | Versión del tipo de artefacto y de su esquema de validación |
| 5 | `esquema_json` | jsonb | no | — | Esquema JSON que valida la carga útil de los artefactos de este tipo |
| 6 | `estado` | character varying(10) | no | — | Situación del tipo en el catálogo, como activo o retirado |
| 7 | `requiere_caso` | boolean | no | — | Indica si todo artefacto de este tipo debe estar vinculado a un caso |
| 8 | `sujeto_requerido` | character varying(10) | sí | — | Clase de sujeto exigido al artefacto, como actor, lugar o especie |
| 9 | `model_card_id` | uuid | sí | FK → model.model_card(id) | Ficha de modelo que documenta el método asociado a este tipo |
| 10 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

Claves únicas compuestas: `codigo`, `version`.

### 5.12 `economic`

Módulo de expansión económica; sin uso todavía.

3 tablas · 25 columnas · 0 filas.

#### `economic.anexo_metodologico`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Anexo que documenta la cadena causal, las fuentes y los supuestos de una medición económica, con su aprobación formal.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `version` | character varying(20) | no | UQ | Versión del anexo metodológico, única en el conjunto de anexos |
| 3 | `cadena_causal_json` | jsonb | no | — | Cadena causal documentada que sustenta la medición económica |
| 4 | `fuentes_por_dato_json` | jsonb | no | — | Fuente citada para cada dato usado en la medición económica |
| 5 | `supuestos_documentados_json` | jsonb | no | — | Supuestos declarados que condicionan el resultado de la medición |
| 6 | `approved_at` | timestamp with time zone | sí | — | Momento en que el anexo metodológico quedó aprobado formalmente |
| 7 | `approved_by` | uuid | sí | FK → core.usuarios(id) | Usuario que aprobó el anexo metodológico |
| 8 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `economic.counterfactual_analysis`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Estimación contrafactual de un caso resuelto: costo sin intervención, costo con intervención y diferencia, contrastada con casos análogos.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_resuelto_id` | uuid | no | FK → core.casos(id) | Caso ya resuelto sobre el que se calcula el contrafactual |
| 3 | `analog_cases_json` | jsonb | no | — | Casos análogos usados como referencia para la estimación |
| 4 | `estimated_without_intervention_usd` | numeric(15,2) | sí | — | Costo estimado en dólares si no se hubiera intervenido |
| 5 | `estimated_with_intervention_usd` | numeric(15,2) | sí | — | Costo estimado en dólares con la intervención ejecutada |
| 6 | `difference_usd` | numeric(15,2) | sí | — | Diferencia en dólares entre el costo con y sin intervención |
| 7 | `methodology_version` | character varying(20) | no | — | Versión de la metodología usada en el cálculo contrafactual |
| 8 | `calculated_at` | timestamp with time zone | no | — | Momento en que se calculó la estimación contrafactual |

#### `economic.impact_scenarios`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Escenario de impacto económico de un caso, con sus supuestos, pérdida estimada y efecto fiscal y laboral.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso al que corresponde el escenario de impacto económico |
| 3 | `scenario_type` | character varying(20) | no | — | Clase de escenario evaluado, como base, optimista o pesimista |
| 4 | `assumptions_json` | jsonb | no | — | Supuestos que sostienen el escenario de impacto económico |
| 5 | `estimated_loss_usd` | numeric(15,2) | sí | — | Pérdida económica estimada en dólares para el escenario |
| 6 | `estimated_job_loss` | integer | sí | — | Cantidad estimada de empleos perdidos en el escenario |
| 7 | `estimated_fiscal_impact` | numeric(15,2) | sí | — | Efecto fiscal estimado del escenario, en moneda de cálculo |
| 8 | `methodology_version` | character varying(20) | no | — | Versión de la metodología aplicada al escenario de impacto |
| 9 | `calculated_at` | timestamp with time zone | no | — | Momento en que se calculó el escenario de impacto |

### 5.13 `forecast`

Módulo de expansión de pronóstico; sin uso todavía.

3 tablas · 26 columnas · 0 filas.

#### `forecast.model_drift_log`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Registro de degradación detectada en un modelo de pronóstico, con su tipo, su magnitud y la acción adoptada.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `model_id` | uuid | no | FK → forecast.model_registry(id) | Modelo de pronóstico en el que se detectó la degradación |
| 3 | `detected_at` | timestamp with time zone | no | — | Momento en que se detectó la degradación del modelo |
| 4 | `drift_type` | character varying(50) | no | — | Tipo de deriva observada, como de datos o de concepto |
| 5 | `drift_magnitude` | numeric(5,4) | sí | — | Magnitud medida de la deriva, en escala de 0 a 1 |
| 6 | `action_taken` | character varying(100) | sí | — | Acción adoptada frente a la deriva, como reentrenar o retirar |

#### `forecast.model_registry`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 1

Registro de modelos de pronóstico con su versión, sus datos de entrenamiento, sus métricas y su estado de vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `model_type` | character varying(100) | no | — | Familia o algoritmo del modelo de pronóstico registrado |
| 3 | `model_version` | character varying(20) | no | — | Versión concreta del modelo, que distingue cada reentrenamiento |
| 4 | `training_data_hash` | character(64) | no | — | Huella del conjunto de datos empleado al entrenar el modelo |
| 5 | `last_trained_at` | timestamp with time zone | no | — | Momento en que se completó el último entrenamiento del modelo |
| 6 | `accuracy_metrics_json` | jsonb | sí | — | Métricas de exactitud obtenidas al evaluar el modelo |
| 7 | `is_active` | boolean | no | — | Indica si el modelo es la versión vigente para emitir pronósticos |
| 8 | `deactivated_reason` | text | sí | — | Motivo por el que el modelo dejó de estar vigente |
| 9 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `forecast.predictions`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Pronóstico emitido por un modelo sobre un objetivo, con su probabilidad, su intervalo de confianza y su horizonte.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `model_id` | uuid | no | FK → forecast.model_registry(id) | Modelo de pronóstico que generó esta predicción |
| 3 | `target_type` | character varying(50) | no | — | Tipo de entidad sobre la que se pronostica, como caso o actor |
| 4 | `target_id` | uuid | no | — | Identificador de la entidad pronosticada, según su tipo |
| 5 | `prediction_date` | date | no | — | Fecha a la que corresponde la emisión del pronóstico |
| 6 | `prediction_horizon_days` | integer | no | — | Cantidad de días hacia adelante que cubre el pronóstico |
| 7 | `probability` | numeric(5,4) | sí | — | Probabilidad estimada del evento pronosticado, entre 0 y 1 |
| 8 | `confidence_interval_low` | numeric(5,4) | sí | — | Límite inferior del intervalo de confianza de la probabilidad |
| 9 | `confidence_interval_high` | numeric(5,4) | sí | — | Límite superior del intervalo de confianza de la probabilidad |
| 10 | `contributing_factors_json` | jsonb | sí | — | Factores y pesos que explican la predicción emitida |
| 11 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

### 5.14 `impact`

Módulo de expansión de evaluación de impacto; sin uso todavía.

5 tablas · 40 columnas · 0 filas.

#### `impact.analisis_recurrencia`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 1

Verificación de si un caso resuelto volvió a abrirse en 12, 24 o 36 meses, con el caso recurrente identificado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_resuelto_id` | uuid | no | FK → core.casos(id) | Caso ya resuelto cuyo posible reingreso se verifica |
| 3 | `recurrencia_12m` | boolean | sí | — | Indica si el caso reapareció dentro de los doce meses siguientes |
| 4 | `recurrencia_24m` | boolean | sí | — | Indica si el caso reapareció dentro de los veinticuatro meses siguientes |
| 5 | `recurrencia_36m` | boolean | sí | — | Indica si el caso reapareció dentro de los treinta y seis meses siguientes |
| 6 | `caso_recurrente_id` | uuid | sí | FK → core.casos(id) | Caso posterior que materializa la reapertura del caso resuelto |
| 7 | `notas` | text | sí | — | Observaciones del analista sobre la recurrencia detectada |

#### `impact.encuestas_post_resolucion`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 1

Encuesta aplicada a un actor tras la resolución de un caso, sobre satisfacción, confianza institucional y percepción del resultado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso cuya resolución motiva la encuesta aplicada |
| 3 | `actor_id` | uuid | no | FK → core.actores(actor_uid) | Actor encuestado después de la resolución del caso |
| 4 | `fecha` | date | no | — | Fecha en que se aplicó la encuesta al actor |
| 5 | `consentimiento` | boolean | no | — | Indica si el actor autorizó el uso de sus respuestas |
| 6 | `satisfaccion_likert` | smallint | sí | — | Satisfacción declarada por el actor en escala Likert |
| 7 | `confianza_institucional_likert` | smallint | sí | — | Confianza en la institución declarada en escala Likert |
| 8 | `percepcion_resolucion` | text | sí | — | Opinión libre del actor sobre cómo se resolvió su caso |

#### `impact.evaluaciones_efectividad`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 1

Evaluación de la eficacia de un tipo de intervención sobre un tipo de caso, medida por resolución sin recurrencia en un período.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo_intervencion` | character varying(100) | no | — | Clase de intervención cuya eficacia se evalúa |
| 3 | `tipo_caso` | character varying(100) | no | — | Clase de caso sobre la que se mide la intervención |
| 4 | `total_casos` | integer | no | — | Cantidad de casos incluidos en la evaluación |
| 5 | `casos_resueltos_sin_recurrencia` | integer | no | — | Casos resueltos que no volvieron a abrirse en el período |
| 6 | `tasa_exito` | numeric(5,4) | sí | — | Proporción de casos resueltos sin recurrencia sobre el total |
| 7 | `periodo_analizado_desde` | date | no | — | Inicio del período cubierto por la evaluación |
| 8 | `periodo_analizado_hasta` | date | no | — | Fin del período cubierto por la evaluación |
| 9 | `calculado_at` | timestamp with time zone | no | — | Momento en que se calculó la evaluación de efectividad |

#### `impact.indicadores_bienestar`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 1

Indicador de bienestar del actor tras la intervención: ingreso, empleo formal, servicios básicos y seguridad alimentaria.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso en cuyo contexto se midió el bienestar del actor |
| 3 | `actor_id` | uuid | no | FK → core.actores(actor_uid) | Actor cuyo bienestar se mide tras la intervención |
| 4 | `fecha` | date | no | — | Fecha de la medición de los indicadores |
| 5 | `ingreso_promedio` | numeric(10,2) | sí | — | Ingreso mensual promedio del actor, expresado en soles |
| 6 | `empleo_formal` | boolean | sí | — | Indica si el actor tiene empleo formal al momento de la medición |
| 7 | `acceso_servicios_basicos` | boolean | sí | — | Indica si el actor accede a servicios básicos en su vivienda |
| 8 | `seguridad_alimentaria` | character varying(20) | sí | — | Grado de seguridad alimentaria reportado para el actor |
| 9 | `fuente` | character varying(100) | sí | — | Origen o medio del que provienen los datos del indicador |

#### `impact.lecciones_aprendidas_automaticas`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Lección extraída automáticamente de un caso resuelto, con su tipo, la evidencia que la sustenta y la revisión del equipo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso resuelto del que se extrajo la lección |
| 3 | `leccion` | text | no | — | Texto de la lección derivada del caso |
| 4 | `tipo_leccion` | character varying(50) | sí | — | Categoría que clasifica la lección extraída |
| 5 | `evidencia_json` | jsonb | sí | — | Datos del caso que sustentan la lección generada |
| 6 | `revisado_por_ds` | boolean | no | — | Indica si el equipo de defensa social ya validó la lección |
| 7 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

### 5.15 `ind`

Indicadores, plantillas de salida y sus espacios: la capa que produce cuadros de mando.

9 tablas · 87 columnas · 3 filas.

#### `ind.brecha`

**Clasificación:** O · Salida (§12.3) · **Filas:** 0 · **Columnas:** 13 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Brecha de información que impide calcular un indicador, con su propuesta de recolección, su esfuerzo estimado en horas y la decisión adoptada.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `indicador_id` | uuid | no | FK → ind.indicador(id) | Indicador al que se refiere la brecha de información detectada |
| 3 | `descripcion` | text | no | — | Descripción del vacío de información que impide calcular el indicador |
| 4 | `propuesta_recoleccion` | text | sí | — | Acciones propuestas para obtener el dato faltante y cerrar la brecha |
| 5 | `requiere_campo` | boolean | no | — | Indica si la brecha exige trabajo de campo para reunir el dato |
| 6 | `horas_estimadas` | numeric(6,1) | no | — | Esfuerzo estimado en horas para cerrar la brecha detectada |
| 7 | `mes_previsto` | date | sí | — | Mes en que se prevé recolectar el dato faltante |
| 8 | `estado` | character varying(10) | no | — | Situación de la brecha: propuesta, aprobada o descartada |
| 9 | `decidido_por` | uuid | sí | FK → core.usuarios(id) | Usuario que decidió cómo tratar la brecha detectada |
| 10 | `decision_escrita_uri` | character varying(500) | sí | — | Ubicación del documento que respalda la decisión adoptada sobre la brecha |
| 11 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 12 | `requiere_censo` | boolean | no | — | Indica si la brecha solo se cierra con información de censo |
| 13 | `censo_referencia` | character varying(40) | sí | — | Identificador del censo que aportaría el dato faltante |

#### `ind.indicador`

**Clasificación:** O · Salida (§12.3) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Indicador del marco de seguimiento, con su definición, naturaleza, dirección deseada y anexo de la Guía que lo origina.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | UQ | Código único del indicador en el marco de seguimiento |
| 3 | `nombre` | character varying(200) | no | — | Nombre del indicador tal como se presenta en los productos |
| 4 | `definicion` | text | sí | — | Definición conceptual y fórmula de cálculo del indicador |
| 5 | `componente_guia` | character varying(25) | no | — | Componente de la Guía al que pertenece el indicador |
| 6 | `anexo_origen` | smallint | sí | — | Número de anexo de la Guía donde se origina el indicador |
| 7 | `naturaleza` | character varying(20) | sí | — | Naturaleza del indicador, por ejemplo cuantitativo o cualitativo |
| 8 | `direccion` | character varying(12) | sí | — | Dirección deseada del indicador: mayor, menor o estable |

#### `ind.plantilla`

**Clasificación:** O · Salida (§12.3) · **Filas:** 3 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Plantilla de documento que define qué indicadores debe contener un producto, con su tipo de documento y su descripción.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | UQ | Código único de la plantilla de documento de salida |
| 3 | `nombre` | character varying(200) | no | — | Nombre de la plantilla que define el producto esperado |
| 4 | `tipo_documento_id` | smallint | sí | FK → core.cat_tipos_documento(id) | Tipo de documento que estructura la plantilla |
| 5 | `descripcion` | text | sí | — | Descripción del alcance y contenido de la plantilla |

#### `ind.plantilla_slot`

**Clasificación:** O · Salida (§12.3) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 4

Casillero de una plantilla que reserva un lugar para un indicador determinado, con su orden de aparición.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `plantilla_id` | uuid | no | FK → ind.plantilla(id) | Plantilla a la que pertenece el casillero |
| 3 | `orden` | smallint | no | — | Posición del casillero dentro de la plantilla |
| 4 | `codigo` | character varying(40) | no | — | Código del casillero usado para referenciarlo en el documento |
| 5 | `indicador_id` | uuid | no | FK → ind.indicador(id) | Indicador que ocupa el casillero de la plantilla |

Claves únicas compuestas: `plantilla_id`, `codigo`; `plantilla_id`, `orden`.

#### `ind.proxy_justificacion`

**Clasificación:** O · Salida (regla: §12.3 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `variante_id` · **Relaciones:** 2 · **Índices:** 2

Justificación metodológica de una variante usada como aproximación, con sus supuestos, límites e incertidumbre declarada.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `variante_id` | uuid | no | PK, FK → ind.variante(id) | Variante proxy cuya justificación metodológica se documenta |
| 2 | `constructo_objetivo` | text | no | — | Constructo que la variante proxy busca aproximar |
| 3 | `fuente_validez_id` | uuid | no | FK → kag.documento_fuente(id) | Documento que respalda la validez del proxy empleado |
| 4 | `supuestos` | text | no | — | Supuestos metodológicos en que se apoya el uso del proxy |
| 5 | `limites` | text | no | — | Limitaciones conocidas de la aproximación con proxy |
| 6 | `incertidumbre` | character varying(5) | no | — | Nivel de incertidumbre declarado para la variante proxy |
| 7 | `advertencia_metodologica` | text | sí | — | Advertencia que debe acompañar la lectura de los resultados del proxy |

#### `ind.relacion_dependencia`

**Clasificación:** O · Salida (regla: §12.3 agrupa el esquema) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 6

Dependencia entre dos indicadores o entre un indicador y una variable de contexto, con su tipo y su peso.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `indicador_id` | uuid | no | FK → ind.indicador(id) | Indicador dependiente dentro de la relación registrada |
| 3 | `depende_de_indicador_id` | uuid | sí | FK → ind.indicador(id) | Indicador del que depende el indicador principal |
| 4 | `depende_de_variable_id` | smallint | sí | FK → ctx.cat_variables(id) | Variable de contexto de la que depende el indicador |
| 5 | `tipo_dependencia` | character varying(20) | no | — | Tipo de relación entre los indicadores o variables vinculados |
| 6 | `peso` | numeric(5,4) | sí | — | Peso de la dependencia expresado como proporción entre 0 y 1 |

Claves únicas compuestas: `indicador_id`, `depende_de_indicador_id`, `depende_de_variable_id`.

#### `ind.resultado`

**Clasificación:** O · Salida (§12.3) · **Filas:** 0 · **Columnas:** 16 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 4

Valor calculado de una variante de indicador por distrito y período, con su cobertura, su denominador y su incertidumbre.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `variante_id` | uuid | no | FK → ind.variante(id) | Variante de indicador que produjo el valor calculado |
| 3 | `distrito_id` | integer | sí | FK → core.distritos(id) | Distrito al que corresponde el valor calculado |
| 4 | `periodo` | character varying(10) | no | — | Período al que corresponde el valor calculado |
| 5 | `valor` | numeric | sí | — | Valor calculado del indicador para el distrito y período |
| 6 | `incertidumbre` | character varying(5) | sí | — | Incertidumbre declarada del valor calculado |
| 7 | `run_id` | uuid | sí | — | Identificador de la ejecución de cálculo que generó el resultado |
| 8 | `calculado_en` | timestamp with time zone | no | — | Momento en que se calculó el resultado |
| 9 | `valor_categoria` | character varying(20) | sí | — | Categoría cualitativa asignada al valor calculado |
| 10 | `denominador` | numeric | sí | — | Denominador usado para calcular el valor del indicador |
| 11 | `cobertura_pct` | numeric(5,2) | sí | — | Porcentaje de cobertura del denominador respecto del total |
| 12 | `fuente_denominador` | character varying(120) | sí | — | Fuente de la que proviene el denominador usado |
| 13 | `requiere_censo` | boolean | no | — | Indica si el resultado requiere datos de censo |
| 14 | `censo_referencia` | character varying(40) | sí | — | Censo tomado como referencia para calcular el resultado |
| 15 | `valido_desde` | timestamp with time zone | no | — | Momento desde el cual el resultado se considera vigente |
| 16 | `superseded_at` | timestamp with time zone | sí | — | Momento en que el resultado fue reemplazado por otro |

#### `ind.seleccion`

**Clasificación:** O · Salida (§12.3) · **Filas:** 0 · **Columnas:** 14 · **Clave primaria:** `id` · **Relaciones:** 6 · **Índices:** 7

Elección de la variante de indicador usada en un caso o distrito y período, con las alternativas evaluadas y el motivo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `slot_id` | uuid | no | FK → ind.plantilla_slot(id) | Casillero de plantilla al que responde la selección |
| 3 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso para el que se elige la variante de indicador |
| 4 | `distrito_id` | integer | sí | FK → core.distritos(id) | Distrito al que aplica la selección de variante |
| 5 | `periodo` | character varying(10) | no | — | Período al que aplica la selección de variante |
| 6 | `variante_id` | uuid | no | FK → ind.variante(id) | Variante de indicador elegida para el casillero |
| 7 | `alternativas_mostradas` | jsonb | no | — | Alternativas de variante evaluadas y presentadas al decidir |
| 8 | `seleccionada_por` | uuid | no | FK → core.usuarios(id) | Usuario que eligió la variante de indicador |
| 9 | `motivo` | text | sí | — | Razón por la que se eligió esa variante de indicador |
| 10 | `valid_from` | timestamp with time zone | no | — | Momento desde el cual rige la selección registrada |
| 11 | `valid_to` | timestamp with time zone | sí | — | Momento hasta el cual rige la selección registrada |
| 12 | `recorded_at` | timestamp with time zone | no | — | Momento en que se registró la selección |
| 13 | `superseded_at` | timestamp with time zone | sí | — | Momento en que la selección fue reemplazada por otra |
| 14 | `supersedes_id` | uuid | sí | FK → ind.seleccion(id) | Selección anterior que esta selección reemplaza |

#### `ind.variante`

**Clasificación:** O · Salida (§12.3) · **Filas:** 0 · **Columnas:** 13 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 3

Forma concreta de calcular un indicador —factible, proxy o censal— con su especificación y su nivel de evidencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `indicador_id` | uuid | no | FK → ind.indicador(id) | Indicador al que pertenece la variante de cálculo |
| 3 | `clase` | character varying(10) | no | — | Clase de la variante: factible, proxy o censal |
| 4 | `especificacion` | jsonb | no | — | Especificación técnica del cálculo de la variante |
| 5 | `variable_id` | smallint | sí | FK → ctx.cat_variables(id) | Variable de contexto usada por la variante |
| 6 | `nivel_evidencia` | smallint | no | — | Nivel de evidencia que respalda la variante |
| 7 | `requiere_campo` | boolean | no | — | Indica si la variante necesita trabajo de campo |
| 8 | `horas_estimadas` | numeric(6,1) | sí | — | Esfuerzo estimado en horas para implementar la variante |
| 9 | `estado` | character varying(12) | no | — | Situación de la variante: propuesta, validada o descartada |
| 10 | `es_validado_humano` | boolean | no | — | Indica si una persona validó la variante |
| 11 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 12 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que registró la creación de la variante |
| 13 | `requiere_censo` | boolean | no | — | Indica si la variante requiere datos de censo |

### 5.16 `kag`

Grafo de conocimiento: nodos, aristas, comunidades e hipótesis; hoy proyecta actores.

30 tablas · 205 columnas · 3 187 filas.

#### `kag.actor_name_history`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 1 160 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Nombre sucesivo de un actor con su período de vigencia y su fuente, para distinguir un cambio de denominación de un cambio de identidad.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `actor_uid` | uuid | no | FK → core.actores | Actor al que pertenece este nombre histórico |
| 3 | `nombre` | character varying(255) | no | — | Denominación que el actor tuvo durante el período indicado |
| 4 | `valid_from` | date | no | — | Tiempo del mundo desde el que el actor fue conocido con ese nombre |
| 5 | `valid_to` | date | sí | — | Tiempo del mundo en que dejó de usarse ese nombre, vacío si sigue vigente |
| 6 | `fuente` | character varying(255) | sí | — | Fuente documental que respalda el uso de ese nombre |
| 7 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |

#### `kag.actor_profile`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `actor_uid` · **Relaciones:** 1 · **Índices:** 1

Perfil narrativo del actor —resumen y formas de trabajo— redactado a partir del material documental reunido sobre él.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor al que corresponde este perfil narrativo, en relación uno a uno |
| 2 | `resumen` | text | sí | — | Síntesis narrativa del actor redactada a partir del material documental |
| 3 | `formas_trabajo` | text | sí | — | Descripción de cómo opera el actor según la evidencia reunida |
| 4 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |

#### `kag.actor_profile_attribute`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 14 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 3

Atributo del perfil de un actor, versionado y con evidencia, como capacidad, interés o repertorio de acción.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `actor_uid` | uuid | no | FK → core.actores | Actor al que describe el atributo de perfil |
| 3 | `attribute_type` | character varying(30) | no | — | Clase de atributo del perfil, como capacidad, interés o repertorio |
| 4 | `value` | text | no | — | Contenido del atributo declarado para el actor |
| 5 | `severity` | smallint | sí | — | Peso o gravedad del atributo dentro del perfil del actor |
| 6 | `valid_from` | timestamp with time zone | no | — | Tiempo del mundo desde el que el atributo fue cierto para el actor |
| 7 | `valid_to` | timestamp with time zone | sí | — | Tiempo del mundo en que el atributo dejó de ser cierto |
| 8 | `recorded_at` | timestamp with time zone | no | — | Momento en que el sistema registró el atributo por primera vez |
| 9 | `superseded_at` | timestamp with time zone | sí | — | Momento en que el sistema reemplazó este atributo por otro |
| 10 | `supersedes_id` | uuid | sí | FK → kag.actor_profile_attribute(id) | Atributo anterior que esta versión reemplaza |
| 11 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 12 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 13 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 14 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `kag.anomalia_contextual`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Anomalía de un caso frente a su contexto sistémico, con la explicación que la acompaña y su estado de revisión.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso cuya evolución se aparta del contexto sistémico |
| 3 | `descripcion` | text | no | — | Enunciado de la anomalía detectada respecto del contexto |
| 4 | `origen` | character varying(30) | sí | — | Procedencia de la detección de la anomalía |
| 5 | `estado` | character varying(10) | no | — | Situación de revisión de la anomalía, por defecto marcada |
| 6 | `explicacion` | text | sí | — | Interpretación de por qué el caso se desvía del contexto observado |
| 7 | `fecha` | date | no | — | Fecha en que se identificó la anomalía contextual |

#### `kag.arista_evidencia`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `arista_id`, `fragmento_id` · **Relaciones:** 2 · **Índices:** 2

Fragmento documental que respalda una arista del grafo, con la cita textual y su nivel de confianza.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `arista_id` | uuid | no | PK, FK → kag.aristas(id) | Arista del grafo que este fragmento documental respalda |
| 2 | `fragmento_id` | uuid | no | PK, FK → kag.documento_fragmento(id) | Fragmento de documento que aporta la prueba de la arista |
| 3 | `cita_textual` | text | sí | — | Texto exacto del fragmento que sostiene la relación descrita |
| 4 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |

#### `kag.aristas`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 450 · **Columnas:** 17 · **Clave primaria:** `id` · **Relaciones:** 7 · **Índices:** 7

Relación entre dos nodos del grafo —alianza, tensión, influencia, posición o causalidad— con su justificación y su vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `origen_id` | uuid | no | FK → kag.nodos(id) | Nodo del que parte la relación, cuando la arista es dirigida |
| 3 | `destino_id` | uuid | no | FK → kag.nodos(id) | Nodo al que llega la relación descrita |
| 4 | `tipo_id` | smallint | no | FK → kag.cat_tipos_arista(id) | Tipo de relación del catálogo, como alianza, tensión o influencia |
| 5 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso en cuyo marco se afirma la relación entre los nodos |
| 6 | `intensidad` | smallint | sí | — | Fuerza relativa de la relación dentro del rango definido |
| 7 | `justificacion` | text | sí | — | Razón por la que se afirma la relación entre ambos nodos |
| 8 | `valid_from` | timestamp with time zone | no | — | Tiempo del mundo desde el que la relación fue cierta |
| 9 | `valid_to` | timestamp with time zone | sí | — | Tiempo del mundo en que la relación dejó de ser cierta |
| 10 | `recorded_at` | timestamp with time zone | no | — | Momento en que el sistema supo de la relación por primera vez |
| 11 | `superseded_at` | timestamp with time zone | sí | — | Momento en que el sistema dejó vigente esta arista |
| 12 | `supersedes_id` | uuid | sí | FK → kag.aristas(id) | Arista anterior que esta versión reemplaza |
| 13 | `split_from_id` | uuid | sí | FK → kag.aristas(id) | Arista de la que se dividió esta, al separarse la relación |
| 14 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |
| 15 | `origen_dato` | character varying(20) | no | — | Procedencia del registro: legado, captura manual o agente |
| 16 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 17 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `kag.atributo_evidencia`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `atributo_id`, `fragmento_id` · **Relaciones:** 2 · **Índices:** 2

Fragmento que respalda un atributo del perfil de un actor, con la cita textual y su nivel de confianza.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `atributo_id` | uuid | no | PK, FK → kag.actor_profile_attribute(id) | Atributo de perfil que este fragmento documental respalda |
| 2 | `fragmento_id` | uuid | no | PK, FK → kag.documento_fragmento(id) | Fragmento de documento que aporta la prueba del atributo |
| 3 | `cita_textual` | text | sí | — | Texto exacto del fragmento que sostiene el atributo descrito |
| 4 | `confidence` | numeric(3,2) | sí | — | Grado de certeza del dato, entre 0 y 1 |

#### `kag.cat_clases_arista`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 6 · **Columnas:** 2 · **Clave primaria:** `codigo` · **Relaciones:** 0 · **Índices:** 1

Catálogo de clases de relación del grafo: relación, influencia, posición, participación, causal y discurso.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `codigo` | character varying(20) | no | PK | Código de la clase de relación, como influencia o causal |
| 2 | `nombre` | character varying(60) | no | — | Nombre legible de la clase de relación del grafo |

#### `kag.cat_corpus`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 6 · **Columnas:** 3 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de corpus documentales: campo, normativa, literatura, metodología, medios o dato oficial.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Clave numérica del corpus en el catálogo documental |
| 2 | `codigo` | character varying(20) | no | UQ | Código corto del corpus, como campo, normativa o literatura |
| 3 | `nombre` | character varying(80) | no | — | Nombre legible del corpus documental |

#### `kag.cat_tipos_arista`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 20 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Catálogo de tipos de relación del grafo, con su clase, si es dirigida y los tipos de nodo que conecta.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Clave numérica del tipo de arista en el catálogo del grafo |
| 2 | `codigo` | character varying(40) | no | UQ | Código único del tipo de relación del grafo |
| 3 | `clase` | character varying(15) | no | FK → kag.cat_clases_arista(codigo) | Clase de relación a la que pertenece este tipo |
| 4 | `dirigida` | boolean | no | — | Indica si la relación tiene sentido de origen a destino |
| 5 | `origen_tipo` | character varying(20) | sí | — | Tipo de nodo admitido como origen de la relación |
| 6 | `destino_tipo` | character varying(20) | sí | — | Tipo de nodo admitido como destino de la relación |

#### `kag.cat_tipos_nodo`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 15 · **Columnas:** 2 · **Clave primaria:** `codigo` · **Relaciones:** 0 · **Índices:** 1

Catálogo de tipos de nodo admitidos: actor, caso, demanda, solución, lugar, concepto, hipótesis y otros.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `codigo` | character varying(20) | no | PK | Código del tipo de nodo, como actor, caso o concepto |
| 2 | `nombre` | character varying(60) | no | — | Nombre legible del tipo de nodo del grafo |

#### `kag.comunidad`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Comunidad detectada en una corrida del grafo, con su número, su nivel jerárquico y la comunidad de la que depende.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `corrida_id` | uuid | no | FK → kag.comunidad_corrida(id) | Corrida del algoritmo en la que se detectó la comunidad |
| 3 | `num` | integer | no | — | Número de la comunidad dentro de la corrida que la generó |
| 4 | `nivel_jerarquico` | smallint | no | — | Altura de la comunidad en la jerarquía detectada |
| 5 | `padre_id` | uuid | sí | FK → kag.comunidad(id) | Comunidad de nivel superior de la que depende esta |
| 6 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

Claves únicas compuestas: `corrida_id`, `num`, `nivel_jerarquico`.

#### `kag.comunidad_corrida`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 1

Ejecución del algoritmo de comunidades, con su momento de validez, resolución, semilla y número de aristas consideradas.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `valido_en` | timestamp with time zone | no | — | Tiempo del mundo al que corresponde la partición detectada |
| 3 | `conocido_en` | timestamp with time zone | no | — | Momento en que el sistema ejecutó y conoció la partición |
| 4 | `nivel_max` | smallint | no | — | Profundidad máxima de la jerarquía de comunidades a calcular |
| 5 | `algoritmo` | character varying(20) | no | — | Algoritmo usado para detectar comunidades, por defecto Leiden |
| 6 | `resolucion` | numeric | no | — | Resolución del algoritmo, que ajusta el tamaño de las comunidades |
| 7 | `semilla` | bigint | no | — | Semilla aleatoria que permite reproducir la corrida |
| 8 | `n_aristas` | integer | no | — | Cantidad de aristas del grafo consideradas en la corrida |
| 9 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 10 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `kag.comunidad_miembro`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 3 · **Clave primaria:** `comunidad_id`, `nodo_id` · **Relaciones:** 3 · **Índices:** 3

Nodo que integra una comunidad del grafo, como vínculo entre la comunidad y el elemento que la compone.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `comunidad_id` | uuid | no | PK, FK → kag.comunidad(id) | Comunidad a la que pertenece el nodo |
| 2 | `nodo_id` | uuid | no | PK, FK → kag.nodos(id) | Nodo del grafo que integra la comunidad |
| 3 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `kag.comunidad_resumen`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `comunidad_id` · **Relaciones:** 2 · **Índices:** 1

Resumen redactado de una comunidad del grafo, con el modelo y la versión que lo produjeron y su validación humana.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `comunidad_id` | uuid | no | PK, FK → kag.comunidad(id) | Comunidad a la que corresponde este resumen, uno por comunidad |
| 2 | `texto` | text | no | — | Resumen redactado del contenido y sentido de la comunidad |
| 3 | `modelo` | character varying(80) | no | — | Modelo de lenguaje que generó el resumen |
| 4 | `version_modelo` | character varying(40) | no | — | Versión del modelo que generó el resumen |
| 5 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 6 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `kag.contraste`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 20 · **Clave primaria:** `id` · **Relaciones:** 6 · **Índices:** 7

Contraste entre dos afirmaciones de fuentes distintas, con la escala de cada una, el tipo de discrepancia y su explicación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso en cuyo marco se compara la discrepancia |
| 3 | `afirmacion_a` | text | no | — | Primera afirmación del contraste, tal como la formula su fuente |
| 4 | `fragmento_a_id` | uuid | sí | FK → kag.documento_fragmento(id) | Fragmento documental que respalda la primera afirmación |
| 5 | `escala_a` | character varying(12) | no | — | Escala con que se expresa la primera afirmación |
| 6 | `afirmacion_b` | text | sí | — | Segunda afirmación, de fuente distinta, que se pone en contraste |
| 7 | `fragmento_b_id` | uuid | sí | FK → kag.documento_fragmento(id) | Fragmento documental que respalda la segunda afirmación |
| 8 | `escala_b` | character varying(12) | sí | — | Escala en que se expresa la segunda afirmación contrastada |
| 9 | `tipo` | character varying(15) | no | — | Clase de discrepancia entre ambas afirmaciones |
| 10 | `estado` | character varying(15) | no | — | Situación del contraste, por defecto abierta |
| 11 | `explicacion` | text | sí | — | Explicación de la discrepancia y de cómo se interpreta |
| 12 | `propuesto_por` | character varying(10) | no | — | Origen de la propuesta de contraste, por defecto el agente A2 |
| 13 | `calificado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que calificó y cerró el contraste |
| 14 | `valid_from` | timestamp with time zone | no | — | Tiempo del mundo desde el que el contraste es pertinente |
| 15 | `valid_to` | timestamp with time zone | sí | — | Tiempo del mundo en que el contraste deja de ser pertinente |
| 16 | `recorded_at` | timestamp with time zone | no | — | Momento en que el sistema registró el contraste |
| 17 | `superseded_at` | timestamp with time zone | sí | — | Momento en que el sistema dejó vigente este contraste |
| 18 | `supersedes_id` | uuid | sí | FK → kag.contraste(id) | Contraste anterior que esta versión reemplaza |
| 19 | `es_validado_humano` | boolean | no | — | Indica si un analista revisó y avaló el registro |
| 20 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `kag.documento_fragmento`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 2

Fragmento de un documento fuente, con su posición, su rango de caracteres y la versión del texto de la que proviene.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `documento_id` | uuid | no | FK → kag.documento_fuente(id) | Documento fuente del que se extrae el fragmento |
| 3 | `orden` | integer | no | — | Posición del fragmento dentro del documento |
| 4 | `pagina_o_minuto` | integer | sí | — | Página o minuto del documento donde aparece el fragmento |
| 5 | `texto` | text | no | — | Contenido textual del fragmento, base de toda cita |
| 6 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 7 | `inicio_char` | integer | sí | — | Posición del primer carácter del fragmento en el texto del documento |
| 8 | `fin_char` | integer | sí | — | Posición del último carácter del fragmento en el texto del documento |
| 9 | `texto_version` | integer | no | — | Versión del texto del documento de la que proviene el fragmento |

Claves únicas compuestas: `documento_id`, `orden`.

#### `kag.documento_fuente`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 10 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 2

Documento incorporado al grafo con su título, tipo, hash del contenido y versión del texto, base de toda cita textual.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `core_documento_id` | uuid | sí | FK → core.documentos(id) | Documento del núcleo del que proviene esta versión para el grafo |
| 3 | `titulo` | character varying(255) | no | — | Título con que se identifica el documento incorporado |
| 4 | `tipo` | character varying(60) | no | — | Clase de documento, como informe, norma o nota de prensa |
| 5 | `url` | character varying(500) | sí | — | Dirección web del documento original, si existe |
| 6 | `hash_contenido` | character(64) | sí | — | Huella del contenido del documento, para detectar cambios de versión |
| 7 | `fecha_ingesta` | timestamp with time zone | no | — | Momento en que el documento se incorporó al grafo |
| 8 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 9 | `texto_version` | integer | no | — | Versión del texto procesado, que cambia si se reextrae el documento |
| 10 | `corpus_id` | smallint | sí | FK → kag.cat_corpus(id) | Corpus documental al que pertenece el documento |

#### `kag.embedding`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Vector de un fragmento o de un atributo, con el modelo y la versión que lo generaron, para la búsqueda semántica.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `fragmento_id` | uuid | sí | FK → kag.documento_fragmento(id) | Fragmento cuyo texto se vectorizó para búsqueda semántica |
| 3 | `atributo_id` | uuid | sí | FK → kag.actor_profile_attribute(id) | Atributo vectorizado, cuando el vector no proviene de un fragmento |
| 4 | `modelo` | character varying(80) | no | — | Modelo de embeddings que generó el vector |
| 5 | `version_modelo` | character varying(30) | no | — | Versión del modelo que generó el vector |
| 6 | `embedding` | vector(1024) | no | — | Vector de 1024 dimensiones que representa el contenido del texto |
| 7 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 8 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `kag.entity_merge_log`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 2

Fusión de identidades de actores en una sola, con su justificación, el responsable y la posibilidad de reversión.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo_operacion` | character varying(10) | no | — | Clase de operación de identidad, como fusión o separación |
| 3 | `resultante_uid` | uuid | no | FK → core.actores(actor_uid) | Actor que resulta de la fusión de identidades |
| 4 | `usuario_id` | uuid | no | FK → core.usuarios(id) | Usuario responsable de ejecutar la fusión |
| 5 | `fecha` | timestamp with time zone | no | — | Momento en que se realizó la operación de fusión |
| 6 | `justificacion` | text | no | — | Razón por la que se consideró que los actores eran el mismo |
| 7 | `reversible` | boolean | no | — | Indica si la fusión puede revertirse |

#### `kag.entity_merge_members`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 3 · **Clave primaria:** `merge_log_id`, `actor_uid`, `rol` · **Relaciones:** 2 · **Índices:** 2

Actor que participó en una fusión de identidades, con el rol que tuvo como origen o como resultante.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `merge_log_id` | uuid | no | PK, FK → kag.entity_merge_log(id) | Fusión de identidades a la que pertenece este participante |
| 2 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor que intervino en la fusión de identidades |
| 3 | `rol` | character varying(12) | no | PK | Papel del actor en la fusión, como origen o resultante |

#### `kag.hipotesis`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 3

Hipótesis de trabajo sobre un caso, con su enunciado, su origen, su estado y su nivel de confianza.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `enunciado` | text | no | — | Texto de la hipótesis de trabajo sobre el caso |
| 3 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso al que se refiere la hipótesis |
| 4 | `origen` | character varying(10) | no | — | Procedencia de la hipótesis, como agente o analista |
| 5 | `estado` | character varying(12) | no | — | Situación de la hipótesis, por defecto propuesta |
| 6 | `nivel_confianza` | character varying(5) | sí | — | Grado de confianza en la hipótesis según la escala definida |
| 7 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 8 | `created_by` | uuid | sí | FK → core.usuarios(id) | Usuario que formuló la hipótesis |
| 9 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `kag.hipotesis_en_salida`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 3 · **Clave primaria:** `output_id`, `hipotesis_id` · **Relaciones:** 2 · **Índices:** 2

Hipótesis citada en una salida del sistema, con el rótulo con que se presentó al lector del reporte.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `output_id` | uuid | no | PK, FK → core.output_contracts(id) | Salida del sistema en la que se cita la hipótesis |
| 2 | `hipotesis_id` | uuid | no | PK, FK → kag.hipotesis(id) | Hipótesis presentada en la salida, con su rótulo |
| 3 | `rotulo` | character varying(30) | no | — | Rótulo con que se presenta la hipótesis al lector del informe |

#### `kag.hipotesis_evidencia`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 3 · **Clave primaria:** `hipotesis_id`, `fragmento_id` · **Relaciones:** 2 · **Índices:** 2

Fragmento que sostiene o refuta una hipótesis de trabajo, con el sentido en que la afecta.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `hipotesis_id` | uuid | no | PK, FK → kag.hipotesis(id) | Hipótesis que la evidencia sostiene o refuta |
| 2 | `fragmento_id` | uuid | no | PK, FK → kag.documento_fragmento(id) | Fragmento documental que se aporta como evidencia |
| 3 | `sentido` | character varying(10) | no | — | Efecto del fragmento sobre la hipótesis: a favor o en contra |

#### `kag.metrica_nodo`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `nodo_id`, `periodo`, `metrica` · **Relaciones:** 1 · **Índices:** 1

Medida calculada de un nodo del grafo en un período, como centralidad o grado, con marca de criticidad.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `nodo_id` | uuid | no | PK, FK → kag.nodos(id) | Nodo del grafo al que se calcula la medida |
| 2 | `periodo` | date | no | PK | Fecha del período en que se calculó la medida |
| 3 | `metrica` | character varying(30) | no | PK | Nombre de la medida calculada, como centralidad o grado |
| 4 | `valor` | numeric | no | — | Resultado numérico de la medida en el período |
| 5 | `es_critico` | boolean | no | — | Indica si el nodo se considera crítico según la medida |

#### `kag.nodos`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 1 520 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Vértice del grafo de conocimiento; hoy solo proyecta actores, con el identificador y la etiqueta del sujeto representado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo` | character varying(20) | no | FK → kag.cat_tipos_nodo(codigo) | Tipo del vértice según el catálogo de tipos de nodo |
| 3 | `ref_id` | uuid | no | — | Identificador del sujeto representado en su tabla de origen |
| 4 | `etiqueta` | character varying(255) | sí | — | Texto visible del nodo, hoy el nombre del actor representado |
| 5 | `created_at` | timestamp with time zone | no | — | Momento en que el nodo entró al grafo |
| 6 | `updated_at` | timestamp with time zone | no | — | Última vez que cambió el nodo, normalmente al actualizar su etiqueta |

Claves únicas compuestas: `tipo`, `ref_id`.

#### `kag.objetivo`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Objetivo que persigue un actor en el marco de un caso, con su tipo y su período de vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso en cuyo marco el actor persigue el objetivo |
| 3 | `descripcion` | text | no | — | Enunciado del objetivo que persigue el actor |
| 4 | `tipo` | character varying(50) | sí | — | Clase de objetivo según la tipología de análisis |
| 5 | `valid_from` | timestamp with time zone | no | — | Tiempo del mundo desde el que se persigue el objetivo |
| 6 | `valid_to` | timestamp with time zone | sí | — | Tiempo del mundo en que deja de perseguirse, vacío si sigue vigente |

#### `kag.saturacion`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Iteración de análisis que registra cuántas afirmaciones nuevas aportó y si con ello cambió la comprensión del caso.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso cuyo avance de comprensión se evalúa en la iteración |
| 3 | `iteracion` | integer | no | — | Número de la iteración de análisis dentro del caso |
| 4 | `nuevas_afirmaciones` | integer | no | — | Cantidad de afirmaciones nuevas aportadas en la iteración |
| 5 | `cambia_comprension` | boolean | no | — | Indica si la iteración modificó la comprensión del caso |
| 6 | `decidido_por` | uuid | sí | FK → core.usuarios(id) | Usuario que evaluó el resultado de la iteración |
| 7 | `fecha` | date | no | — | Fecha en que se evaluó la iteración de análisis |

Claves únicas compuestas: `caso_id`, `iteracion`.

#### `kag.vacio_informacion`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Vacío de información identificado, vinculado a un indicador o a una brecha, con su propuesta de cierre y su estado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `descripcion` | text | no | — | Enunciado del vacío de información identificado |
| 3 | `indicador_id` | uuid | sí | FK → ind.indicador(id) | Indicador afectado por la falta de información |
| 4 | `brecha_id` | uuid | sí | FK → ind.brecha(id) | Brecha de información a la que se asocia el vacío |
| 5 | `razon` | text | sí | — | Motivo por el que ese dato falta o no se pudo obtener |
| 6 | `propuesta` | text | sí | — | Acción propuesta para cerrar el vacío de información |
| 7 | `estado` | character varying(12) | no | — | Situación del vacío, por defecto abierto |

#### `kag.validacion_hallazgo`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Calificación de un hallazgo del análisis con su nivel de confianza y la justificación de quien lo validó.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso al que pertenece el hallazgo calificado |
| 3 | `hallazgo_ref` | character varying(80) | no | — | Referencia al hallazgo del análisis que se califica |
| 4 | `nivel_confianza` | character varying(5) | no | — | Grado de confianza asignado al hallazgo |
| 5 | `justificacion` | text | no | — | Razón de quien valida para sostener el nivel de confianza |
| 6 | `decidido_por` | uuid | sí | FK → core.usuarios(id) | Usuario que calificó el hallazgo |
| 7 | `fecha` | date | no | — | Fecha en que se calificó el hallazgo |

### 5.17 `lex`

Léxico del dominio: términos y sus variantes para el análisis de lenguaje.

11 tablas · 67 columnas · 0 filas.

#### `lex.clase`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Clase de discurso obtenida en una corrida de análisis léxico, con su porcentaje de unidades de contexto clasificadas.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `corrida_id` | uuid | no | FK → lex.corrida(id) | Corrida léxica en la que se obtuvo la clase de discurso |
| 3 | `num` | smallint | no | — | Número de la clase dentro de la corrida |
| 4 | `pct_uce` | numeric(5,2) | sí | — | Porcentaje de unidades de contexto asignadas a la clase |
| 5 | `descripcion_analista` | text | sí | — | Descripción de la clase redactada por el analista |

Claves únicas compuestas: `corrida_id`, `num`.

#### `lex.clase_termino`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `clase_id`, `termino_id` · **Relaciones:** 2 · **Índices:** 2

Término asociado a una clase de discurso, con su chi cuadrado, sus frecuencias y su significación estadística.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `clase_id` | uuid | no | PK, FK → lex.clase(id) | Clase de discurso a la que se asocia el término |
| 2 | `termino_id` | bigint | no | PK, FK → lex.termino(id) | Término asociado a la clase de discurso |
| 3 | `chi2` | numeric | sí | — | Estadístico chi cuadrado de la asociación entre término y clase |
| 4 | `frec_clase` | integer | sí | — | Frecuencia del término dentro de la clase de discurso |
| 5 | `frec_total` | integer | sí | — | Frecuencia total del término en el corpus analizado |
| 6 | `p_valor` | numeric | sí | — | Significación estadística de la asociación observada |

#### `lex.coocurrencia`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `corrida_id`, `termino_a`, `termino_b` · **Relaciones:** 3 · **Índices:** 3

Coocurrencia de dos términos en un corpus, con su valor y la medida estadística usada para calcularla.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `corrida_id` | uuid | no | PK, FK → lex.corrida(id) | Corrida léxica en la que se midió la coocurrencia |
| 2 | `termino_a` | bigint | no | PK, FK → lex.termino(id) | Primer término del par que coocurre en el corpus |
| 3 | `termino_b` | bigint | no | PK, FK → lex.termino(id) | Segundo término del par que coocurre en el corpus |
| 4 | `valor` | numeric | no | — | Valor calculado de la coocurrencia entre ambos términos |
| 5 | `medida` | character varying(20) | no | — | Medida estadística usada para calcular la coocurrencia |

#### `lex.corpus`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Conjunto congelado de documentos sobre el que se mide el lenguaje, con su filtro, su hash y su clasificación máxima.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(200) | no | UQ | Nombre único del corpus de documentos |
| 3 | `filtro` | jsonb | no | — | Criterios usados para seleccionar los documentos del corpus |
| 4 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 5 | `congelado` | boolean | no | — | Indica si el corpus quedó fijado y ya no admite cambios |
| 6 | `hash_corpus` | character(64) | sí | — | Huella que identifica la versión congelada del corpus |

#### `lex.corpus_documento`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `corpus_id`, `fuente_id` · **Relaciones:** 2 · **Índices:** 2

Documento incluido en un corpus léxico, con su versión de texto y las variables que lo describen, como caso o fecha.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `corpus_id` | uuid | no | PK, FK → lex.corpus(id) | Corpus al que pertenece el documento incluido |
| 2 | `fuente_id` | uuid | no | PK, FK → kag.documento_fuente(id) | Documento fuente incorporado al corpus |
| 3 | `texto_version` | integer | no | — | Versión del texto del documento usada en el corpus |
| 4 | `variables` | jsonb | no | — | Variables descriptivas del documento, como caso o fecha |

#### `lex.corrida`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 14 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Ejecución de un método léxico —frecuencias, coocurrencia, clasificación o diccionario— con su software, parámetros y métricas.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `corpus_id` | uuid | no | FK → lex.corpus(id) | Corpus sobre el que se ejecutó el método léxico |
| 3 | `metodo` | character varying(15) | no | — | Método léxico aplicado en la corrida |
| 4 | `software` | character varying(60) | sí | — | Software usado para ejecutar el análisis léxico |
| 5 | `version` | character varying(30) | sí | — | Versión del software usado en la corrida |
| 6 | `parametros` | jsonb | no | — | Parámetros configurados para ejecutar la corrida |
| 7 | `semilla` | bigint | sí | — | Semilla aleatoria fijada para reproducir la corrida |
| 8 | `origen` | character varying(10) | no | — | Origen de la corrida: manual, agente o programada |
| 9 | `archivo_hash` | character(64) | sí | — | Huella del archivo de resultados generado por la corrida |
| 10 | `plan_paso_id` | uuid | sí | FK → analisis.plan_paso(id) | Paso del plan de análisis que originó la corrida |
| 11 | `estado` | character varying(12) | no | — | Estado de la corrida: en curso, terminada o fallida |
| 12 | `metricas` | jsonb | no | — | Métricas obtenidas al ejecutar el método léxico |
| 13 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 14 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `lex.diccionario`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Diccionario temático versionado, con su descripción y su autor, usado para medir categorías en el discurso.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(160) | no | UQ | Nombre único del diccionario temático |
| 3 | `descripcion` | text | sí | — | Descripción del tema y del uso previsto del diccionario |
| 4 | `version` | integer | no | — | Número de versión del diccionario temático |
| 5 | `autor` | uuid | sí | FK → core.usuarios(id) | Usuario que elaboró el diccionario |

#### `lex.diccionario_entrada`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Entrada de un diccionario léxico: un lema o una expresión regular, con su tipo y su categoría temática.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `diccionario_id` | uuid | no | FK → lex.diccionario(id) | Diccionario al que pertenece la entrada |
| 3 | `patron` | character varying(200) | no | — | Lema o expresión regular que define la entrada |
| 4 | `tipo` | character varying(5) | no | — | Tipo de patrón de la entrada: lema o expresión regular |
| 5 | `categoria` | character varying(60) | sí | — | Categoría temática asignada a la entrada |

#### `lex.serie`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Frecuencia normalizada de un término por período y ámbito, comparada con una ventana de referencia configurable.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `diccionario_id` | uuid | sí | FK → lex.diccionario(id) | Diccionario al que pertenece la serie medida |
| 3 | `termino_id` | bigint | sí | FK → lex.termino(id) | Término cuya frecuencia se mide en la serie |
| 4 | `periodo` | date | no | — | Período al que corresponde la frecuencia medida |
| 5 | `ambito` | character varying(60) | no | — | Ámbito geográfico o temático de la medición |
| 6 | `frecuencia_normalizada` | numeric | no | — | Frecuencia del término normalizada para comparar períodos |
| 7 | `ventana_base_dias` | integer | no | — | Días de la ventana de referencia usada para normalizar |

#### `lex.termino`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Lema del vocabulario de análisis, con su categoría gramatical e idioma, reutilizable entre distintos corpus.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | bigint | no | PK | Identificador interno de la fila |
| 2 | `lema` | character varying(120) | no | — | Lema del vocabulario de análisis léxico |
| 3 | `categoria` | character varying(30) | no | — | Categoría gramatical asignada al lema |
| 4 | `idioma` | character varying(10) | no | — | Código de idioma del lema del término |

Claves únicas compuestas: `lema`, `categoria`, `idioma`.

#### `lex.uce`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `corrida_id`, `n` · **Relaciones:** 2 · **Índices:** 2

Unidad de contexto elemental del corpus, delimitada por posiciones en el texto y marcada como retenida o descartada.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `corrida_id` | uuid | no | PK, FK → lex.corrida(id) | Corrida léxica en la que se delimita la unidad de contexto |
| 2 | `n` | integer | no | PK | Número secuencial de la unidad dentro de la corrida |
| 3 | `fuente_id` | uuid | no | FK → kag.documento_fuente(id) | Documento del que proviene la unidad de contexto |
| 4 | `inicio_char` | integer | no | — | Posición de inicio de la unidad dentro del texto |
| 5 | `fin_char` | integer | no | — | Posición final de la unidad dentro del texto |
| 6 | `retenida` | boolean | no | — | Indica si la unidad se conserva para el análisis |

### 5.18 `model`

Fichas de los modelos que usa el sistema, con versión, uso y límites.

1 tabla · 18 columnas · 12 filas.

#### `model.model_card`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 12 · **Columnas:** 18 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Ficha de un modelo con su propósito, variables de entrada y salida, parámetros, métricas, limitaciones y revisión programada.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(60) | no | — | Código único que identifica la ficha del modelo en el catálogo |
| 3 | `version` | character varying(20) | no | — | Versión de la ficha del modelo |
| 4 | `tipo_modelo` | character varying(20) | no | — | Naturaleza del modelo, estadística o basada en reglas |
| 5 | `libreria_id` | uuid | sí | FK → config.libreria(id) | Librería de software empleada para ejecutar el modelo |
| 6 | `aplicacion_id` | uuid | sí | FK → config.aplicacion(id) | Aplicación del sistema en la que se usa el modelo |
| 7 | `proposito` | text | no | — | Para qué sirve el modelo y qué decisión apoya |
| 8 | `datos_entrenamiento_hash` | character(64) | sí | — | Huella del conjunto de datos con que se entrenó el modelo |
| 9 | `variables_entrada` | jsonb | no | — | Variables que el modelo recibe como entrada |
| 10 | `variables_salida` | jsonb | no | — | Variables que el modelo produce como resultado |
| 11 | `parametros` | jsonb | no | — | Hiperparámetros y configuración con que opera el modelo |
| 12 | `metricas` | jsonb | sí | — | Resultados de las métricas de desempeño del modelo |
| 13 | `limitaciones` | text | sí | — | Restricciones y condiciones en que el modelo no es fiable |
| 14 | `incertidumbre` | character varying(30) | sí | — | Forma en que el modelo expresa o mide su incertidumbre |
| 15 | `estado` | character varying(12) | no | — | Situación de la ficha en su ciclo de vida, como propuesto o aprobado |
| 16 | `reviewer` | character varying(120) | sí | — | Persona responsable de revisar la ficha del modelo |
| 17 | `proximo_review` | date | sí | — | Fecha programada para la siguiente revisión del modelo |
| 18 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

Claves únicas compuestas: `codigo`, `version`.

### 5.19 `mype`

Módulo de expansión para mypes; sin uso todavía.

1 tabla · 17 columnas · 0 filas.

#### `mype.ejecucion_nec`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 17 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 5

Adjudicación y pago de un núcleo ejecutor de compras a una MYPE, con montos, hitos de entrega, conformidad y mora.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `nec_codigo` | character varying(60) | no | — | Código del núcleo ejecutor de compras adjudicado |
| 3 | `lote_codigo` | character varying(60) | no | — | Código del lote de bienes o servicios del núcleo ejecutor |
| 4 | `mype_actor_uid` | uuid | no | FK → core.actores(actor_uid) | MYPE a la que se adjudicó la ejecución de la compra |
| 5 | `monto_adjudicado_sol` | numeric(15,2) | no | — | Monto adjudicado a la MYPE, expresado en soles |
| 6 | `fecha_adjudicacion` | date | no | — | Fecha en que se adjudicó la ejecución a la MYPE |
| 7 | `fecha_entrega_pactada` | date | sí | — | Fecha de entrega comprometida en la adjudicación |
| 8 | `fecha_recepcion_cite` | date | sí | — | Fecha de recepción registrada en el CITE correspondiente |
| 9 | `fecha_conformidad` | date | sí | — | Fecha en que se dio conformidad a la entrega recibida |
| 10 | `fecha_pago_efectivo` | date | sí | — | Fecha en que se pagó efectivamente el monto adjudicado |
| 11 | `estado_pago` | character varying(20) | no | — | Situación del pago a la MYPE, como pendiente o pagado |
| 12 | `dias_mora` | integer | sí | — | Días de atraso del pago, derivados por regla de las fechas registradas |
| 13 | `fuente_documento_id` | uuid | sí | FK → kag.documento_fuente(id) | Documento fuente del que se extrajeron los datos de la ejecución |
| 14 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 15 | `tipo_artefacto_id` | uuid | no | FK → domain.tipo_artefacto(id) | Tipo de artefacto contractual al que corresponde el registro |
| 16 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 17 | `updated_at` | timestamp with time zone | no | — | Momento de la última modificación del registro |

Claves únicas compuestas: `nec_codigo`, `lote_codigo`.

### 5.20 `pesca`

Módulo de expansión pesquero; sin uso todavía.

2 tablas · 23 columnas · 0 filas.

#### `pesca.licencia_cites_denp`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 15 · **Clave primaria:** `id` · **Relaciones:** 5 · **Índices:** 6

Permiso CITES de exportación solicitado y dictaminado, con la especie, los volúmenes y las fechas del trámite.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `solicitud_vuce_codigo` | character varying(80) | no | UQ | Código de la solicitud presentada en la VUCE |
| 3 | `exportador_actor_uid` | uuid | no | FK → core.actores(actor_uid) | Actor exportador que solicita el permiso CITES |
| 4 | `especie_id` | smallint | no | FK → core.cat_especies(id) | Especie cuya exportación ampara la licencia |
| 5 | `volumen_solicitado_kg` | numeric(12,2) | sí | — | Volumen de la especie solicitado para exportar, en kilogramos |
| 6 | `volumen_autorizado_denp_kg` | numeric(12,2) | sí | — | Volumen autorizado por la DNP, expresado en kilogramos |
| 7 | `fecha_solicitud` | timestamp with time zone | no | — | Momento en que se presentó la solicitud del permiso |
| 8 | `fecha_dictamen_imarpe` | timestamp with time zone | sí | — | Momento del dictamen técnico emitido por IMARPE |
| 9 | `fecha_emision_permiso` | timestamp with time zone | sí | — | Momento en que se emitió el permiso CITES |
| 10 | `estado_permiso` | character varying(20) | no | — | Situación del trámite del permiso CITES |
| 11 | `trazabilidad_qr_validada` | boolean | no | — | Indica si se validó el código QR de trazabilidad de la licencia |
| 12 | `fuente_documento_id` | uuid | sí | FK → kag.documento_fuente(id) | Documento fuente del que provienen los datos del permiso |
| 13 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |
| 14 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 15 | `tipo_artefacto_id` | uuid | no | FK → domain.tipo_artefacto(id) | Tipo de artefacto documental del permiso emitido |

#### `pesca.trazabilidad_qr`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Escaneo de un código QR de trazabilidad de una licencia, con su etapa, el lugar de desembarque y su validez.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `qr_code` | character varying(200) | no | — | Código QR leído en el escaneo de trazabilidad |
| 3 | `licencia_id` | uuid | no | FK → pesca.licencia_cites_denp(id) | Licencia CITES a la que pertenece el código escaneado |
| 4 | `lugar_desembarque_id` | uuid | sí | FK → territorio.lugares(id) | Lugar de desembarque donde se realizó el escaneo |
| 5 | `fecha_escaneo` | timestamp with time zone | no | — | Momento en que se escaneó el código QR |
| 6 | `etapa` | character varying(20) | no | — | Etapa de la cadena pesquera en que ocurrió el escaneo |
| 7 | `valido` | boolean | no | — | Indica si el escaneo resultó válido en la verificación |
| 8 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

### 5.21 `policy`

Reglas de negocio y tipos de regla, con su vigencia.

8 tablas · 55 columnas · 15 filas.

#### `policy.cat_tipos_regla`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 5 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de tipos de regla de política, con las claves que cada tipo exige en sus parámetros y su esquema.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | UQ | Código único del tipo de regla de política |
| 3 | `nombre` | character varying(100) | no | — | Nombre del tipo de regla de política |
| 4 | `claves_requeridas` | text[] | no | — | Claves que los parámetros de este tipo de regla deben incluir |
| 5 | `esquema_json` | jsonb | sí | — | Esquema que valida la estructura de los parámetros del tipo |

#### `policy.escenario`

**Clasificación:** INF · Transversal (regla: §12.4 gobierno transversal) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Escenario que agrupa un conjunto de reglas de política para simular o evaluar el efecto de una decisión.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(160) | no | UQ | Nombre único del escenario de política |
| 3 | `descripcion` | text | sí | — | Descripción del propósito del escenario de política |
| 4 | `creado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que registró la creación del escenario |
| 5 | `creado_en` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `policy.escenario_regla`

**Clasificación:** INF · Transversal (regla: §12.4 gobierno transversal) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `escenario_id`, `regla_id` · **Relaciones:** 2 · **Índices:** 2

Regla que compone un escenario de política, como vínculo entre el escenario y la norma que lo integra.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `escenario_id` | uuid | no | PK, FK → policy.escenario(id) | Escenario que agrupa la regla de política |
| 2 | `regla_id` | uuid | no | PK, FK → policy.regla(id) | Regla que integra el escenario de política |

#### `policy.gobierno`

**Clasificación:** INF · Transversal (regla: §12.4 gobierno transversal) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 1

Período de gobierno con su fecha de inicio y de término, que enmarca la vigencia de cargos y reglas.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(120) | no | — | Nombre del período de gobierno |
| 3 | `inicio` | date | no | — | Fecha de inicio del período de gobierno |
| 4 | `fin` | date | sí | — | Fecha de término del período de gobierno |

#### `policy.regla`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 10 · **Columnas:** 24 · **Clave primaria:** `id` · **Relaciones:** 9 · **Índices:** 11

Regla de política vigente —norma, restricción o preferencia— con su texto, parámetros, alcance, fuente y aprobación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(30) | no | — | Código de la regla de política |
| 3 | `clase` | character(1) | no | — | Clase de la regla según su carácter normativo |
| 4 | `tipo_regla_id` | smallint | no | FK → policy.cat_tipos_regla(id) | Tipo de regla según el catálogo de tipos |
| 5 | `titulo` | character varying(200) | no | — | Título breve de la regla de política |
| 6 | `texto` | text | no | — | Texto completo de la regla de política |
| 7 | `parametros` | jsonb | no | — | Parámetros que operacionalizan la regla de política |
| 8 | `alcance` | character varying(25) | no | — | Ámbito de aplicación de la regla de política |
| 9 | `estado` | character varying(12) | no | — | Estado de la regla: borrador, vigente o derogada |
| 10 | `gobierno_id` | smallint | sí | FK → policy.gobierno(id) | Gobierno durante el cual rige la regla |
| 11 | `titular_id` | smallint | sí | FK → policy.titular(id) | Cargo de gobierno que respalda la regla |
| 12 | `fuente_documento_id` | uuid | sí | FK → kag.documento_fuente(id) | Documento del que proviene la regla de política |
| 13 | `tipo_fuente` | character varying(25) | no | — | Tipo de fuente normativa de la regla |
| 14 | `valid_from` | timestamp with time zone | no | — | Momento desde el cual la regla está vigente |
| 15 | `valid_to` | timestamp with time zone | sí | — | Momento hasta el cual la regla está vigente |
| 16 | `recorded_at` | timestamp with time zone | no | — | Momento en que se registró la regla en el sistema |
| 17 | `superseded_at` | timestamp with time zone | sí | — | Momento en que la regla fue reemplazada por otra |
| 18 | `supersedes_id` | uuid | sí | FK → policy.regla(id) | Regla anterior que esta regla reemplaza |
| 19 | `disparador_vencimiento_fecha` | date | sí | — | Fecha en que la regla deja de aplicarse |
| 20 | `disparador_vencimiento_evento` | text | sí | — | Evento que provoca el término de la vigencia de la regla |
| 21 | `propuesto_por` | uuid | sí | FK → core.usuarios(id) | Usuario que propuso la regla de política |
| 22 | `aprobado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que aprobó la regla de política |
| 23 | `aprobado_por_2` | uuid | sí | FK → core.usuarios(id) | Segundo usuario que aprobó la regla de política |
| 24 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `policy.snapshot`

**Clasificación:** INF · Transversal (regla: §12.4 gobierno transversal) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Foto del conjunto de reglas vigente en un momento, con su hash, que permite reconstruir qué política se aplicó.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `creado_en` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 3 | `creado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que generó la foto del conjunto de reglas |
| 4 | `rol` | character varying(30) | no | — | Rol con el que se tomó la foto de las reglas |
| 5 | `valido_en` | timestamp with time zone | no | — | Momento en que el conjunto de reglas estaba vigente |
| 6 | `conocido_en` | timestamp with time zone | no | — | Momento en que el sistema conoció ese conjunto de reglas |
| 7 | `policy_hash` | character(64) | no | — | Huella que identifica el conjunto de reglas congelado |

#### `policy.snapshot_regla`

**Clasificación:** INF · Transversal (regla: §12.4 gobierno transversal) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `snapshot_id`, `regla_id` · **Relaciones:** 2 · **Índices:** 2

Regla incluida en una foto del ordenamiento, como vínculo entre el snapshot y la norma que quedó congelada.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `snapshot_id` | uuid | no | PK, FK → policy.snapshot(id) | Foto del ordenamiento que incluye la regla |
| 2 | `regla_id` | uuid | no | PK, FK → policy.regla(id) | Regla congelada dentro de la foto del ordenamiento |

#### `policy.titular`

**Clasificación:** INF · Transversal (regla: §12.4 gobierno transversal) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Persona que ocupa un cargo de gobierno durante un período, con su nombre y sus fechas de ejercicio.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `gobierno_id` | smallint | no | FK → policy.gobierno(id) | Gobierno durante el cual ejerce el cargo |
| 3 | `cargo` | character varying(80) | no | — | Cargo de gobierno que ocupa la persona |
| 4 | `persona` | character varying(160) | no | — | Nombre de la persona que ocupa el cargo |
| 5 | `desde` | date | no | — | Fecha desde la cual ejerce el cargo |
| 6 | `hasta` | date | sí | — | Fecha hasta la cual ejerce el cargo |

### 5.22 `proteccion`

Módulo de expansión de protección social; sin uso todavía.

1 tabla · 11 columnas · 0 filas.

#### `proteccion.registro_parametrico`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 4 · **Índices:** 3

Cobertura de un programa de protección a un actor afectado, con su umbral, monto máximo y período de cobertura.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `programa` | character varying(120) | no | — | Nombre del programa de protección que cubre al actor |
| 3 | `actor_uid` | uuid | no | FK → core.actores | Actor afectado que recibe la cobertura del programa |
| 4 | `caso_id` | uuid | sí | FK → core.casos(id) | Caso que sustenta la cobertura otorgada |
| 5 | `umbral_icen` | numeric(5,2) | no | — | Umbral del índice de cobertura aplicado para otorgar la ayuda |
| 6 | `monto_maximo_sol` | numeric(12,2) | sí | — | Monto máximo de cobertura otorgado, expresado en soles |
| 7 | `fecha_cobertura_desde` | date | no | — | Inicio del período de cobertura del programa |
| 8 | `fecha_cobertura_hasta` | date | sí | — | Fin previsto del período de cobertura |
| 9 | `estado` | character varying(15) | no | — | Situación de la cobertura, como vigente o vencida |
| 10 | `fuente_documento_id` | uuid | sí | FK → kag.documento_fuente(id) | Documento fuente que respalda la cobertura registrada |
| 11 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

### 5.23 `qda`

Codificación cualitativa: proyectos, códigos, segmentos y libro de códigos.

10 tablas · 79 columnas · 0 filas.

#### `qda.codigo`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Código del libro de códigos, con su jerarquía, su identificador externo y la marca de si admite codificación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `libro_id` | uuid | no | FK → qda.libro_codigos(id) | Libro de códigos al que pertenece el código |
| 3 | `guid_externo` | character varying(64) | no | — | Identificador del código en el software cualitativo de origen |
| 4 | `padre_id` | uuid | sí | FK → qda.codigo(id) | Código superior del que depende este en la jerarquía |
| 5 | `nombre` | character varying(200) | no | — | Nombre del código con que se etiqueta el texto |
| 6 | `descripcion` | text | sí | — | Definición del criterio de aplicación del código |
| 7 | `color` | character varying(9) | sí | — | Color con que el código se distingue en la interfaz de análisis |
| 8 | `es_codificable` | boolean | no | — | Indica si el código se aplica a segmentos o solo agrupa otros |

Claves únicas compuestas: `libro_id`, `guid_externo`.

#### `qda.exportacion`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Registro de cada salida de material cualitativo fuera del perímetro, con su hash, su autorización y su caducidad.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `proyecto_id` | uuid | sí | FK → qda.proyecto(id) | Proyecto cualitativo cuyo material se exportó |
| 3 | `usuario_id` | uuid | no | FK → core.usuarios(id) | Usuario que realizó la exportación del material |
| 4 | `exportado_en` | timestamp with time zone | no | — | Momento en que el material salió del perímetro del sistema |
| 5 | `descripcion_corpus` | jsonb | no | — | Composición del material exportado, con su alcance en JSON |
| 6 | `hash_archivo` | character(64) | no | — | Huella del archivo exportado, para verificar que no se alteró |
| 7 | `pseudonimizado` | boolean | no | — | Indica si la exportación reemplazó los identificadores de los actores |
| 8 | `excepcion_aprobada_por` | uuid | sí | FK → core.usuarios(id) | Usuario que autorizó la excepción que permite la salida del material |
| 9 | `dispositivo_institucional` | boolean | no | — | Indica si la exportación fue a un dispositivo institucional autorizado |
| 10 | `caduca_en` | timestamp with time zone | no | — | Momento a partir del cual el material exportado debe eliminarse |
| 11 | `run_id` | uuid | sí | — | Ejecución del agente que generó la exportación, cuando fue automática |

#### `qda.fuente`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Texto exportado a un software de análisis cualitativo, con su versión, su hash y su longitud, base de los segmentos.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `proyecto_id` | uuid | no | FK → qda.proyecto(id) | Proyecto cualitativo al que pertenece el texto exportado |
| 3 | `documento_id` | uuid | no | FK → kag.documento_fuente(id) | Documento del repositorio documental del que proviene el texto |
| 4 | `guid_externo` | character varying(64) | no | — | Identificador del texto en el software cualitativo de destino |
| 5 | `tipo` | character varying(30) | sí | — | Naturaleza del texto, como entrevista, documento o nota de campo |
| 6 | `texto_version` | integer | no | — | Versión del texto exportado, que permite rastrear sus cambios |
| 7 | `hash_texto_exportado` | character(64) | no | — | Huella del texto exportado, para verificar su integridad |
| 8 | `longitud_caracteres` | integer | no | — | Cantidad de caracteres del texto, base para ubicar los segmentos |
| 9 | `idioma` | character varying(10) | no | — | Idioma del texto, necesario para su análisis lingüístico |
| 10 | `solo_manual` | boolean | no | — | Indica si el texto queda restringido a codificación manual |

Claves únicas compuestas: `proyecto_id`, `guid_externo`.

#### `qda.libro_codigos`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Libro de códigos versionado de un proyecto cualitativo, con su origen y su período de vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `proyecto_id` | uuid | sí | FK → qda.proyecto(id) | Proyecto cualitativo al que pertenece el libro de códigos |
| 3 | `nombre` | character varying(200) | no | — | Nombre del libro de códigos dentro del proyecto |
| 4 | `version` | integer | no | — | Número de versión del libro, que aumenta con cada revisión |
| 5 | `origen` | character varying(10) | no | — | Procedencia del libro, como importado o construido en el sistema |
| 6 | `vigente_desde` | date | no | — | Fecha desde la que rige esta versión del libro de códigos |
| 7 | `vigente_hasta` | date | sí | — | Fecha en que el libro deja de usarse, vacía mientras siga vigente |

Claves únicas compuestas: `nombre`, `version`.

#### `qda.mapeo_pseudonimo`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 4 · **Clave primaria:** `proyecto_id`, `token` · **Relaciones:** 3 · **Índices:** 3

Equivalencia entre el token usado en una exportación y el actor real, guardada para poder revertir la pseudonimización.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `proyecto_id` | uuid | no | PK, FK → qda.proyecto(id) | Proyecto cualitativo en cuyo ámbito rige esta equivalencia |
| 2 | `token` | character varying(40) | no | PK | Token con el que se reemplazó al actor en el material exportado |
| 3 | `actor_uid` | uuid | no | FK → core.actores | Actor real al que corresponde el token, para revertir la pseudonimización |
| 4 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `qda.memo`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Nota analítica asociada a un elemento del proyecto cualitativo, con su ámbito y el autor que la redactó.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `proyecto_id` | uuid | no | FK → qda.proyecto(id) | Proyecto cualitativo al que pertenece la nota analítica |
| 3 | `ambito` | character varying(10) | no | — | Ámbito al que se refiere la nota, como código, segmento o documento |
| 4 | `objeto_id` | uuid | sí | — | Elemento del proyecto sobre el que se escribe la nota |
| 5 | `texto` | text | no | — | Contenido de la nota analítica redactada por el autor |
| 6 | `autor` | uuid | sí | FK → core.usuarios(id) | Usuario que redactó la nota analítica |
| 7 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 8 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `qda.perdida_roundtrip`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Elemento que no sobrevive al viaje de ida y vuelta entre el sistema y el software cualitativo, con su causa documentada.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `proyecto_id` | uuid | no | FK → qda.proyecto(id) | Proyecto cualitativo en el que se detectó la pérdida |
| 3 | `elemento` | character varying(60) | no | — | Tipo de elemento que no sobrevive al viaje de ida y vuelta |
| 4 | `software` | character varying(60) | no | — | Software cualitativo del intercambio en que se perdió el elemento |
| 5 | `descripcion` | text | sí | — | Causa o circunstancia documentada de la pérdida del elemento |

#### `qda.proyecto`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 12 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Proyecto cualitativo importado desde un software de análisis, con su versión del estándar, su archivo y su hash.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(200) | no | — | Nombre del proyecto cualitativo importado desde el software |
| 3 | `software_origen` | character varying(60) | sí | — | Software de análisis cualitativo del que proviene el proyecto |
| 4 | `version_software` | character varying(30) | sí | — | Versión del software de origen, que condiciona el formato importado |
| 5 | `version_estandar` | character varying(20) | sí | — | Versión del estándar de intercambio usado en la importación |
| 6 | `archivo_uri` | character varying(500) | sí | — | Ubicación del archivo importado, para volver a revisarlo |
| 7 | `hash` | character(64) | sí | — | Huella del archivo importado, para verificar su integridad |
| 8 | `plan_paso_id` | uuid | sí | FK → analisis.plan_paso(id) | Paso del plan de análisis que originó el proyecto cualitativo |
| 9 | `importado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que realizó la importación del proyecto |
| 10 | `importado_en` | timestamp with time zone | sí | — | Momento en que se importó el proyecto cualitativo |
| 11 | `estado` | character varying(10) | no | — | Situación del proyecto, como en preparación o disponible |
| 12 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `qda.segmento`

**Clasificación:** P · Proceso (§12.2) · **Filas:** 0 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 5 · **Índices:** 6

Tramo de texto codificado con un código, delimitado por posiciones de caracteres y con vigencia bitemporal.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `fuente_id` | uuid | no | FK → qda.fuente(id) | Texto exportado en el que se ubica el segmento codificado |
| 3 | `codigo_id` | uuid | no | FK → qda.codigo(id) | Código aplicado al segmento para clasificar su contenido |
| 4 | `inicio_char` | integer | no | — | Posición del primer carácter del segmento dentro del texto |
| 5 | `fin_char` | integer | no | — | Posición del último carácter del segmento dentro del texto |
| 6 | `guid_externo` | character varying(64) | sí | — | Identificador del segmento en el software cualitativo de origen |
| 7 | `codificador_usuario_id` | uuid | sí | FK → core.usuarios(id) | Usuario que aplicó el código al segmento |
| 8 | `recorded_at` | timestamp with time zone | no | — | Momento en que se registró la codificación del segmento |
| 9 | `superseded_at` | timestamp with time zone | sí | — | Momento en que el segmento fue reemplazado por una versión posterior |
| 10 | `supersedes_id` | uuid | sí | FK → qda.segmento(id) | Segmento anterior que esta versión reemplaza |
| 11 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `qda.segmento_fragmento`

**Clasificación:** P · Proceso (regla: §12.2 agrupa el esquema) · **Filas:** 0 · **Columnas:** 3 · **Clave primaria:** `segmento_id`, `fragmento_id` · **Relaciones:** 2 · **Índices:** 2

Solape entre un segmento codificado y un fragmento del grafo, con el número de caracteres que comparten.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `segmento_id` | uuid | no | PK, FK → qda.segmento(id) | Segmento codificado que se cruza con el fragmento del grafo |
| 2 | `fragmento_id` | uuid | no | PK, FK → kag.documento_fragmento(id) | Fragmento del grafo documental que solapa con el segmento |
| 3 | `solape_chars` | integer | no | — | Cantidad de caracteres que el segmento y el fragmento comparten |

### 5.24 `staging`

Aterrizaje temporal de importaciones externas antes de validarlas.

2 tablas · 18 columnas · 0 filas.

#### `staging.lote`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 0 · **Columnas:** 13 · **Clave primaria:** `id` · **Relaciones:** 5 · **Índices:** 6

Lote de carga manual de archivos externos, con su punto de ingesta, su hash, su estado y su validación.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `punto_ingesta_id` | smallint | no | FK → analisis.punto_ingesta(id) | Punto de ingesta por el que entró el lote de archivos |
| 3 | `plan_paso_id` | uuid | sí | FK → analisis.plan_paso(id) | Paso del plan de análisis al que se asocia la carga |
| 4 | `origen_software` | character varying(60) | sí | — | Software que generó los archivos del lote |
| 5 | `version_software` | character varying(30) | sí | — | Versión del software que generó los archivos |
| 6 | `archivo_uri` | character varying(500) | no | — | Ubicación del archivo cargado en el lote |
| 7 | `hash_archivo` | character(64) | no | — | Huella del archivo cargado, para verificar su integridad |
| 8 | `estado` | character varying(12) | no | — | Situación del lote en su ciclo de carga y validación |
| 9 | `validacion` | jsonb | sí | — | Resultado de las validaciones aplicadas al lote |
| 10 | `cargado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que cargó el lote al sistema |
| 11 | `aprobado_por` | uuid | sí | FK → core.usuarios(id) | Usuario que aprobó la carga del lote |
| 12 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |
| 13 | `nivel_clasificacion` | smallint | no | FK → core.cat_clasificacion(nivel) | Nivel de acceso al dato: 1 público, 2 reservado, 3 confidencial |

#### `staging.registro`

**Clasificación:** I · Entrada (§12.1) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Fila de un lote de aterrizaje temporal, con su carga útil y los errores de validación que se le detectaron.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | bigint | no | PK | Identificador interno de la fila |
| 2 | `lote_id` | uuid | no | FK → staging.lote(id) | Lote al que pertenece la fila aterrizada |
| 3 | `n` | integer | no | — | Número de orden de la fila dentro del lote |
| 4 | `payload` | jsonb | no | — | Contenido crudo de la fila tal como llegó del archivo |
| 5 | `errores` | jsonb | sí | — | Errores de validación detectados en la fila |

### 5.25 `territorio`

Módulo de expansión territorial; sin uso todavía.

16 tablas · 100 columnas · 9 filas.

#### `territorio.anomalias_ais`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 1

Anomalía detectada en el seguimiento satelital de embarcaciones, con su zona, su tipo y su severidad.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `vessel_hash` | character(64) | no | — | Huella que identifica la embarcación sin exponer sus datos |
| 3 | `zona_maritima` | character varying(100) | no | — | Zona marítima donde se detectó la anomalía |
| 4 | `fecha` | date | no | — | Fecha en que se detectó la anomalía |
| 5 | `tipo_anomalia` | character varying(50) | no | — | Tipo de comportamiento anómalo detectado |
| 6 | `severidad` | character varying(10) | sí | — | Gravedad asignada a la anomalía detectada |
| 7 | `source_data_hash` | character(64) | sí | — | Huella de los datos satelitales que originaron la detección |
| 8 | `created_at` | timestamp with time zone | no | — | Momento en que se creó el registro |

#### `territorio.caleta_detalle`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 3 · **Clave primaria:** `lugar_id` · **Relaciones:** 1 · **Índices:** 1

Datos propios de una caleta de pescadores artesanales, con su tipo y su nivel de organización.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `lugar_id` | uuid | no | PK, FK → territorio.lugares(id) | Lugar que corresponde a la caleta de pescadores |
| 2 | `tipo` | character varying(20) | sí | — | Tipo de caleta según su actividad |
| 3 | `nivel_organizacion` | character varying(10) | sí | — | Grado de organización de los pescadores de la caleta |

#### `territorio.cat_tipos_lugar`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 9 · **Columnas:** 2 · **Clave primaria:** `id` · **Relaciones:** 0 · **Índices:** 2

Catálogo de tipos de lugar: terminal pesquero, desembarcadero, planta, caleta, CITE, estación hídrica o piscigranja.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | smallint | no | PK | Identificador interno de la fila |
| 2 | `codigo` | character varying(40) | no | UQ | Código único del tipo de lugar del territorio |

#### `territorio.certificaciones_planta`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Certificación sanitaria o ambiental de una planta procesadora, con su estado y su fecha de vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `planta_id` | uuid | no | FK → territorio.planta_detalle(lugar_id) | Planta procesadora a la que corresponde la certificación |
| 3 | `certificacion` | character varying(20) | no | — | Nombre o tipo de la certificación obtenida por la planta |
| 4 | `estado` | character varying(20) | no | — | Estado en que se encuentra la certificación |
| 5 | `fecha_vigencia_hasta` | date | sí | — | Fecha hasta la cual la certificación está vigente |
| 6 | `fuente` | character varying(100) | sí | — | Fuente que informa la certificación de la planta |
| 7 | `fecha_actualizacion` | date | no | — | Fecha de la última actualización del dato |

#### `territorio.cuadricula_sismica`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Cuadrícula de un lote sísmico con su operador, fase y período, para cruzar actividad extractiva con territorio.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `lote` | character varying(20) | no | — | Identificador del lote sísmico |
| 3 | `operador` | character varying(120) | no | — | Empresa operadora del lote sísmico |
| 4 | `fase` | character varying(20) | no | — | Fase del proyecto sísmico en el lote |
| 5 | `periodo_inicio` | date | no | — | Fecha de inicio del período de actividad del lote |
| 6 | `periodo_fin` | date | sí | — | Fecha de término del período de actividad del lote |
| 7 | `poligono` | geography(Polygon,4326) | sí | — | Polígono que delimita el área del lote sísmico |
| 8 | `area_km2` | numeric(10,2) | sí | — | Superficie del lote expresada en kilómetros cuadrados |
| 9 | `fuente_documento_id` | uuid | sí | FK → kag.documento_fuente(id) | Documento que respalda los datos del lote sísmico |

#### `territorio.desembarcadero_detalle`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `lugar_id` · **Relaciones:** 1 · **Índices:** 1

Datos del desembarcadero artesanal, con el número de embarcaciones registradas que operan en él.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `lugar_id` | uuid | no | PK, FK → territorio.lugares(id) | Lugar que corresponde al desembarcadero artesanal |
| 2 | `embarcaciones_registradas` | integer | sí | — | Número de embarcaciones registradas que operan en el desembarcadero |

#### `territorio.estacion_hidrica_detalle`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `lugar_id` · **Relaciones:** 1 · **Índices:** 3

Estación de monitoreo hídrico con su código de la autoridad del agua, su cuenca, subcuenca y altitud.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `lugar_id` | uuid | no | PK, FK → territorio.lugares(id) | Lugar que corresponde a la estación de monitoreo hídrico |
| 2 | `codigo_ana` | character varying(40) | no | UQ | Código de la estación asignado por la autoridad del agua |
| 3 | `cuenca` | character varying(120) | no | — | Cuenca hidrográfica en la que se ubica la estación |
| 4 | `subcuenca` | character varying(120) | sí | — | Subcuenca hidrográfica en la que se ubica la estación |
| 5 | `altitud_msnm` | numeric(8,2) | sí | — | Altitud de la estación en metros sobre el nivel del mar |
| 6 | `tipo_estacion` | character varying(20) | no | — | Tipo de estación de monitoreo hídrico |

#### `territorio.expansion_informal`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 11 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Detección de expansión informal en un lugar, con su área, la precisión del método y su validación humana.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `lugar_id` | uuid | no | FK → territorio.lugares(id) | Lugar donde se detectó la expansión informal |
| 3 | `fecha_deteccion` | date | no | — | Fecha en que se detectó la expansión informal |
| 4 | `area_m2` | numeric(10,2) | no | — | Superficie de la expansión detectada en metros cuadrados |
| 5 | `precision` | numeric(4,3) | sí | — | Proporción de detecciones correctas del método aplicado |
| 6 | `exhaustividad` | numeric(4,3) | sí | — | Proporción de casos reales que el método logró detectar |
| 7 | `fuente_satelite` | character varying(40) | no | — | Fuente satelital usada en la detección |
| 8 | `unidad_minima_mapeable_m2` | numeric(6,2) | no | — | Menor superficie que el método distingue, en metros cuadrados |
| 9 | `validacion_humana` | boolean | no | — | Indica si la detección fue validada por una persona |
| 10 | `puntos_validados` | integer | sí | — | Cantidad de puntos revisados en la validación humana |
| 11 | `puntos_correctos` | integer | sí | — | Cantidad de puntos validados que resultaron correctos |

Claves únicas compuestas: `lugar_id`, `fecha_deteccion`, `fuente_satelite`.

#### `territorio.impacto_conflicto_planta`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 6 · **Clave primaria:** `id` · **Relaciones:** 2 · **Índices:** 3

Evaluación del impacto de un caso sobre una planta, con las certificaciones en riesgo y el nivel estimado.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caso_id` | uuid | no | FK → core.casos(id) | Caso cuyo impacto se evalúa sobre la planta |
| 3 | `planta_id` | uuid | sí | FK → territorio.planta_detalle(lugar_id) | Planta procesadora afectada por el caso |
| 4 | `certificaciones_en_riesgo` | jsonb | sí | — | Certificaciones de la planta que podrían verse afectadas |
| 5 | `impacto_estimado` | character varying(10) | sí | — | Nivel de impacto estimado del caso sobre la planta |
| 6 | `evaluado_at` | timestamp with time zone | no | — | Momento en que se realizó la evaluación de impacto |

#### `territorio.lugar_actores`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `lugar_id`, `actor_uid`, `valid_from` · **Relaciones:** 2 · **Índices:** 2

Actor vinculado a un lugar del territorio, con el tipo de vínculo y su período de vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `lugar_id` | uuid | no | PK, FK → territorio.lugares(id) | Lugar al que se vincula el actor |
| 2 | `actor_uid` | uuid | no | PK, FK → core.actores | Actor vinculado al lugar del territorio |
| 3 | `vinculo` | character varying(40) | no | — | Tipo de vínculo entre el actor y el lugar |
| 4 | `valid_from` | date | no | PK | Fecha desde la cual rige el vínculo |
| 5 | `valid_to` | date | sí | — | Fecha hasta la cual rige el vínculo |

#### `territorio.lugares`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 10 · **Clave primaria:** `id` · **Relaciones:** 3 · **Índices:** 4

Punto del territorio —caleta, planta, puerto o estación— con su tipo, coordenadas, distrito y estado operativo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `tipo_id` | smallint | no | FK → territorio.cat_tipos_lugar(id) | Tipo de lugar según el catálogo de tipos |
| 3 | `distrito_id` | integer | no | FK → core.distritos(id) | Distrito en el que se ubica el lugar |
| 4 | `nombre` | character varying(255) | no | — | Nombre del lugar del territorio |
| 5 | `latitud` | numeric(10,7) | sí | — | Latitud de la ubicación del lugar |
| 6 | `longitud` | numeric(10,7) | sí | — | Longitud de la ubicación del lugar |
| 7 | `operativo` | boolean | no | — | Indica si el lugar se encuentra en operación |
| 8 | `administrador_uid` | uuid | sí | FK → core.actores(actor_uid) | Actor responsable de la administración del lugar |
| 9 | `fuente_dato` | character varying(100) | sí | — | Fuente de la que provienen los datos del lugar |
| 10 | `fecha_actualizacion` | date | no | — | Fecha de la última actualización del dato |

Claves únicas compuestas: `distrito_id`, `tipo_id`, `nombre`.

#### `territorio.parque_industrial`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 9 · **Clave primaria:** `lugar_id` · **Relaciones:** 1 · **Índices:** 2

Parque industrial con su polígono, hectáreas totales, útiles, saneadas y su estado de saneamiento.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `lugar_id` | uuid | no | PK, FK → territorio.lugares(id) | Lugar que corresponde al parque industrial |
| 2 | `poligono` | geography(Polygon,4326) | sí | — | Polígono que delimita el parque industrial |
| 3 | `hectareas_total` | numeric(10,2) | no | — | Superficie total del parque en hectáreas |
| 4 | `hectareas_utiles` | numeric(10,2) | sí | — | Hectáreas aprovechables dentro del parque industrial |
| 5 | `hectareas_saneadas` | numeric(10,2) | no | — | Hectáreas con saneamiento físico legal concluido |
| 6 | `hectareas_con_cerco` | numeric(10,2) | no | — | Hectáreas del parque que cuentan con cerco perimetral |
| 7 | `estado_saneamiento` | character varying(20) | no | — | Estado del saneamiento físico legal del parque |
| 8 | `instrumento_legal` | character varying(80) | sí | — | Instrumento legal que sustenta el parque industrial |
| 9 | `fecha_ultima_actualizacion` | date | no | — | Fecha de la última actualización del dato |

#### `territorio.patrones_seguridad_caleta`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 7 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 2

Patrón de seguridad observado en una caleta durante un período, con su tipo, su severidad y su fuente.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `caleta_id` | uuid | no | FK → territorio.caleta_detalle(lugar_id) | Caleta en la que se observó el patrón de seguridad |
| 3 | `periodo` | character varying(20) | no | — | Período durante el cual se observó el patrón |
| 4 | `tipo_patron` | character varying(30) | no | — | Tipo de patrón de seguridad observado |
| 5 | `severidad` | character varying(10) | sí | — | Gravedad del patrón de seguridad observado |
| 6 | `fuente` | character varying(100) | no | — | Fuente que informa el patrón observado |
| 7 | `fecha_registro` | date | no | — | Fecha en que se registró el patrón observado |

#### `territorio.planta_detalle`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 5 · **Clave primaria:** `lugar_id` · **Relaciones:** 1 · **Índices:** 1

Datos de una planta procesadora: razón social, tipo de procesamiento, capacidad instalada y empleo directo.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `lugar_id` | uuid | no | PK, FK → territorio.lugares(id) | Lugar que corresponde a la planta procesadora |
| 2 | `razon_social` | character varying(255) | sí | — | Razón social de la empresa propietaria de la planta |
| 3 | `tipo_procesamiento` | character varying(60) | sí | — | Tipo de procesamiento que realiza la planta |
| 4 | `capacidad_tn_dia` | numeric(12,2) | sí | — | Capacidad instalada de la planta en toneladas por día |
| 5 | `empleo_directo` | integer | sí | — | Número de trabajadores directos de la planta |

#### `territorio.terminal_detalle`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 2 · **Clave primaria:** `lugar_id` · **Relaciones:** 1 · **Índices:** 1

Datos propios del terminal pesquero, con su capacidad de procesamiento diario expresada en toneladas.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `lugar_id` | uuid | no | PK, FK → territorio.lugares(id) | Lugar que corresponde al terminal pesquero |
| 2 | `capacidad_tn_dia` | numeric(12,2) | sí | — | Capacidad de procesamiento diario del terminal en toneladas |

#### `territorio.zona_pesca`

**Clasificación:** INF · Transversal (§12.4) · **Filas:** 0 · **Columnas:** 8 · **Clave primaria:** `id` · **Relaciones:** 1 · **Índices:** 3

Zona de pesca delimitada por un polígono, con su tipo, su especie asociada y su período de vigencia.

| # | Columna | Tipo | Nulo | Clave | Descripción |
| --: | --- | --- | :--: | --- | --- |
| 1 | `id` | uuid | no | PK | Identificador interno de la fila |
| 2 | `nombre` | character varying(120) | no | — | Nombre que identifica la zona de pesca |
| 3 | `tipo` | character varying(20) | no | — | Tipo al que corresponde la zona de pesca |
| 4 | `poligono` | geography(Polygon,4326) | sí | — | Polígono que delimita la zona de pesca |
| 5 | `fuente` | character varying(60) | no | — | Fuente de la que proviene la delimitación de la zona |
| 6 | `especie_id` | smallint | sí | FK → core.cat_especies(id) | Especie asociada a la zona de pesca |
| 7 | `valid_from` | date | no | — | Fecha desde la cual rige la delimitación de la zona |
| 8 | `valid_to` | date | sí | — | Fecha hasta la cual rige la delimitación de la zona |

## 6. Vistas y vistas materializadas

Los objetos derivados no guardan datos propios: se calculan a partir de las tablas anteriores. Una **vista** se recalcula en cada consulta; una **matview** es una instantánea que hay que refrescar a mano. Se documentan con su propósito y los objetos que leen, sin repetir sus columnas, que el motor entrega desde el catálogo.

### 6.1 `analytics`

22 objetos · 172 columnas · 1 459 filas.

#### `analytics.mv_compromisos_inter_ministeriales`

**Clasificación:** O · Salida · **Tipo:** matview · **Filas:** 0 · **Columnas:** 6

Compromisos de caso con su estado y su sincronización hacia MEF, MINAM, MINCETUR, MININTER y RREE, para el seguimiento interministerial.

Lee: `core.casos, core.cat_estados_compromiso, core.compromisos, core.integraciones`.

#### `analytics.mv_dashboard_alta_direccion`

**Clasificación:** O · Salida · **Tipo:** matview · **Filas:** 9 · **Columnas:** 8

Foto por región de casos activos, riesgo alto, crisis social, compromisos vencidos y días de estancamiento, para la Alta Dirección.

Lee: `analytics.vw_geo_distrito, core.casos, core.cat_estados_caso, core.cat_estados_hito, core.cat_niveles_conflicto, core.cat_niveles_riesgo, core.compromisos, core.hitos_compromiso`.

#### `analytics.mv_drift_embeddings`

**Clasificación:** O · Salida · **Tipo:** matview · **Filas:** 0 · **Columnas:** 5

Distancia coseno mensual entre centroides de embeddings por modelo y versión, para vigilar la deriva de la representación semántica.

Lee: `kag.embedding`.

#### `analytics.mv_drift_grafo`

**Clasificación:** O · Salida · **Tipo:** matview · **Filas:** 0 · **Columnas:** 4

Variación de la intermediación de nodos críticos del grafo frente al periodo previo, para detectar deriva estructural de la red.

Lee: `kag.metrica_nodo`.

#### `analytics.mv_tablero_decisional`

**Clasificación:** O · Salida · **Tipo:** matview · **Filas:** 9 · **Columnas:** 8

Tablero por región con casos validados, alertas activas, robustez del marco situacional y proporción de aristas validadas, para decidir.

Lee: `analytics.vw_geo_distrito, analytics.vw_marco_situacional_robustez, core.alertas_tempranas, core.casos, core.cat_estados_caso, core.cat_niveles_riesgo, kag.aristas`.

#### `analytics.vw_anexo_02_panorama_regional`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 11 · **Columnas:** 5

Panorama del Anexo 02: total de casos activos por región y subsector, con conteos de riesgo alto y de crisis social, para el reporte regional.

Lee: `analytics.vw_geo_distrito, core.casos, core.cat_estados_caso, core.cat_niveles_conflicto, core.cat_niveles_riesgo, core.cat_subsectores`.

#### `analytics.vw_anexo_14_seguimiento_compromisos`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 13 · **Columnas:** 15

Seguimiento del Anexo 14: compromisos por caso con ubicación, área responsable, temática, hitos y semáforo de vencimiento.

Lee: `analytics.vw_geo_distrito, core.casos, core.cat_alcances_geograficos, core.cat_estados_hito, core.cat_tematicas, core.cat_tipos_documento, core.cat_unidades_organicas, core.compromiso_distritos, core.compromisos, core.documentos, core.hitos_compromiso`.

#### `analytics.vw_anexo_15_matriz_conflictividad`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 22 · **Columnas:** 15

Matriz del Anexo 15: casos con región, alcance, subsector, temática, niveles de riesgo y conflicto, narración, alertas y actores involucrados.

Lee: `analytics.vw_geo_distrito, core.actores, core.alertas_tempranas, core.caso_cronologia, core.casos, core.casos_actores, core.cat_alcances_geograficos, core.cat_niveles_conflicto, core.cat_niveles_riesgo, core.cat_prioridades_atencion, core.cat_subsectores, core.cat_tematicas, core.cat_unidades_organicas, core.usuarios`.

#### `analytics.vw_anexo_16_registro_reuniones`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 12

Registro del Anexo 16: reuniones de diálogo con tipo, sector, responsable, lugar, asistentes, ayuda memoria, relatoria y nota publicada.

Lee: `analytics.vw_geo_distrito, core.casos, core.cat_subsectores, core.documentos, core.reunion_participantes, core.reuniones_dialogo, core.usuarios`.

#### `analytics.vw_anexo_17_registro_reportes`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 42 · **Columnas:** 11

Registro del Anexo 17: reportes por tipo, caso, responsable, ubicación, resumen ejecutivo, contenido y conclusiones recomendadas.

Lee: `analytics.vw_geo_distrito, core.alertas_tempranas, core.casos, core.cat_tipos_documento, core.documentos, core.usuarios`.

#### `analytics.vw_carga_campo`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 3

Comparación mensual entre horas de capacidad de campo disponibles y horas aprobadas que exigen campo, para planificar la carga operativa.

Lee: `core.capacidad_campo, ind.brecha`.

#### `analytics.vw_casos_estancados`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 35 · **Columnas:** 3

Días transcurridos desde la última actualización de cada caso en estado activo, para priorizar la revisión de casos sin movimiento reciente.

Lee: `core.casos, core.cat_estados_caso`.

#### `analytics.vw_eravisa_survival`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 32 · **Columnas:** 5

Serie por caso con días abierto, bandera de cierre y marca de censura, lista para el análisis de supervivencia de casos de ERAVISA.

Lee: `core.casos`.

#### `analytics.vw_erop_milestones`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 2 · **Columnas:** 6

Reglas de clase N del catálogo de políticas con código N-ROP, su estado y disparadores de vencimiento, para el seguimiento de hitos EROP.

Lee: `policy.regla`.

#### `analytics.vw_geo_distrito`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 698 · **Columnas:** 6

Dimensión geográfica que resuelve distrito, provincia y región con sus identificadores, reutilizada por las vistas analíticas y los anexos.

Lee: `core.distritos, core.provincias, core.regiones`.

#### `analytics.vw_indicadores_minister`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 15

Selecciones vigentes de indicadores con su resultado del periodo, excluyendo proxies sin validación humana o con incertidumbre alta.

Lee: `analytics.vw_selecciones_vigentes, ind.resultado`.

#### `analytics.vw_indicadores_obsoletos`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 5

Cadena recursiva de indicadores marcados como obsoletos cuando una variable dependiente supera su TTL de frescura, para su actualización.

Lee: `ctx.cat_variables, ind.indicador, ind.relacion_dependencia`.

#### `analytics.vw_mactor_red_actores`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 292 · **Columnas:** 9

Aristas vigentes de relación e influencia entre actores de un caso, con intensidad y confianza, para el análisis de red tipo MACTOR.

Lee: `kag.aristas, kag.cat_tipos_arista, kag.nodos`.

#### `analytics.vw_marco_situacional_robustez`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 35 · **Columnas:** 6

Banderas por caso de consistencia, correspondencia, coherencia contextual, saturación y trazabilidad, para evaluar la robustez del marco.

Lee: `core.casos, kag.anomalia_contextual, kag.contraste, kag.saturacion`.

#### `analytics.vw_organizaciones_vigencia`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 224 · **Columnas:** 5

Vigencia de organizaciones con días para vencer y estado VENCIDA, POR_VENCER o VIGENTE, para la depuración del padrón de actores.

Lee: `core.actores, core.organizaciones`.

#### `analytics.vw_riesgo_sistemico`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 35 · **Columnas:** 7

Casos con su riesgo social cruzado con los índices ENOS y de pobreza monetaria vigentes, clasificados como alto, moderado o sin contexto.

Lee: `core.casos, core.cat_niveles_riesgo`.

#### `analytics.vw_selecciones_vigentes`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 13

Selecciones de indicadores no reemplazadas y aún vigentes, con plantilla, slot, variante, clase e incertidumbre, para la trazabilidad analítica.

Lee: `ind.indicador, ind.plantilla, ind.plantilla_slot, ind.proxy_justificacion, ind.seleccion, ind.variante`.

### 6.2 `core`

2 objetos · 13 columnas · 847 filas.

#### `core.v_actor_datos_personales_seguro`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 847 · **Columnas:** 6

Exposición de identificadores y contactos cifrados de actores, sin valores en claro, para los consumidores autorizados de datos personales.

Lee: `core.actor_datos_personales`.

#### `core.vw_agregacion_compromiso_externo`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 7

Aglomeración por sistema y entidad de destino de las integraciones de compromisos, con hitos asociados y fechas de sincronización.

Lee: `core.integraciones`.

### 6.3 `lex`

1 objeto · 6 columnas · 0 filas.

#### `lex.vw_clases_publicables`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 6

Clases de corridas léxicas completas que informan estabilidad, con porcentaje de UCE y descripción del analista, listas para publicarse.

Lee: `lex.clase, lex.corrida`.

### 6.4 `mype`

3 objetos · 32 columnas · 0 filas.

#### `mype.inspeccion_cite`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 8

Inspecciones CITE vigentes extraídas del payload de artefactos, con fecha, resultado, observaciones e inspector, para el seguimiento de mype.

Lee: `domain.artefacto, domain.tipo_artefacto`.

#### `mype.mv_concentracion_lotes`

**Clasificación:** O · Salida · **Tipo:** matview · **Filas:** 0 · **Columnas:** 6

Concentración mensual por NEC de los montos adjudicados a mypes, con número de lotes, índice HHI y ranking de mypes, para analizar competencia.

Lee: `mype.ejecucion_nec`.

#### `mype.v_ejecucion_nec_mora_vigente`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 18

Ejecuciones NEC con días de mora calculados cuando no hay pago registrado, para el control de pagos pendientes a las mypes.

Lee: `mype.ejecucion_nec`.

### 6.5 `pesca`

1 objeto · 7 columnas · 0 filas.

#### `pesca.cuota_cites_especie`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 7

Cuotas CITES por especie y año, con monto consumido y estado, para el control de la extracción y la disponibilidad de cuota pesquera.

Lee: `domain.artefacto, domain.tipo_artefacto`.

### 6.6 `territorio`

1 objeto · 6 columnas · 0 filas.

#### `territorio.vw_monitoreo_hidrico_excede_eca`

**Clasificación:** O · Salida · **Tipo:** vista · **Filas:** 0 · **Columnas:** 6

Observaciones de oxígeno disuelto, pH y metales por lugar y fecha, con marca de exceso de ECA según los parámetros de configuración.

Lee: `ctx.observaciones`.

## 7. Sistema anterior (`legacy`)

Las 86 hojas del libro original se cargaron como tablas con columnas posicionales: `c01`, `c02`, … en el orden en que estaban en la hoja. Por eso el nombre de la columna no dice nada y el significado se documenta aquí solo para las 12 tablas que la migración lee directamente. Para las demás, el mapa columna a columna está en el análisis de portabilidad [2].

La clasificación de todas ellas es **X · Archivo**: no participan del flujo, se conservan porque son la única fuente reproducible de la carga [1].

#### `legacy._hojas`

**Filas:** 86 · **Columnas:** 5 · **Clase declarada:** — · **Clase en v10:** —

**Destino:** — (manifiesto de la carga)

Manifiesto de las hojas del libro original: nombre de hoja, tabla del esquema legacy, número de columnas, número de filas y momento de carga.

#### `legacy.bridge_actor_grupo`

**Filas:** 0 · **Columnas:** 4 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** — (`kag.aristas` cuando exista dato)

Tabla puente prevista entre actores y grupos de análisis; sin filas en el origen.

#### `legacy.bridge_alerta_actor`

**Filas:** 162 · **Columnas:** 7 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.alertas_actores` (se pierden rol/es_principal)

Vínculo entre alertas tempranas y actores civiles, con rol y marca de principal previstos pero vacíos; origen de las alertas con actores.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador de la relación alerta-actor (BAA-...); presente en 67 de las 162 filas. |
| 3 | `c02` | text | sí | Código de la alerta (AT-2026-xx), con relleno de dos o tres dígitos según la fila. |
| 4 | `c03` | text | sí | Código del actor (ACT-xxx); en tres filas las posiciones de alerta y actor están invertidas. |
| 5 | `c04` | text | sí | Columna vacía en todas las filas. |
| 6 | `c05` | text | sí | Columna vacía en todas las filas. |
| 7 | `c06` | text | sí | Segundo identificador de relación (BAA-...) presente en 95 filas y nunca junto al anterior. |

#### `legacy.bridge_alerta_actorestado`

**Filas:** 5 · **Columnas:** 4 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.alertas_actores`

Vínculo entre alertas tempranas y funcionarios del censo del Estado.

#### `legacy.bridge_alerta_demandas`

**Filas:** 231 · **Columnas:** 6 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.demandas` (pierde el vínculo con la alerta)

Vínculo entre alertas y demandas con la temática del vínculo; refuerza el vínculo alerta-demanda que también está denormalizado en la demanda.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador de la relación alerta-demanda (BAD-...); 207 valores distintos en 231 filas. |
| 3 | `c02` | text | sí | Constante: valor 'TR-01' en todas las filas. |
| 4 | `c03` | text | sí | Código de la alerta (AT-2026-xx); 75 valores distintos. |
| 5 | `c04` | text | sí | Código de la temática del vínculo (TEMA-xx); presente en 216 filas. |
| 6 | `c05` | text | sí | Identificador de la demanda (DEM-2026-xxxx); único en las 231 filas. |

#### `legacy.bridge_alerta_recurso`

**Filas:** 32 · **Columnas:** 4 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.alerta_especies`

Vínculo entre alertas y especies hidrobiológicas (recursos pesqueros).

#### `legacy.bridge_capacitacion_participant`

**Filas:** 9 · **Columnas:** 6 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.capacitacion_participantes`

Inscripción y culminación de funcionarios del Estado en una capacitación.

#### `legacy.bridge_caso_actor`

**Filas:** 80 · **Columnas:** 4 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.casos_actores` (posicion/influencia por defecto)

Vínculo entre casos y actores civiles, con referencias de caso que mezclan códigos completos y ordinales.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador de la relación caso-actor (RA-xxx); 68 valores distintos en 80 filas. |
| 3 | `c02` | text | sí | Código del actor (ACT-xxx); es el actor del vínculo, no el caso. |
| 4 | `c03` | text | sí | Referencia del caso: 46 códigos completos CS-PRODUCE-2026-xxx y 34 números sueltos (1 a 33) que se interpretan como ordinal de FACT_Casos. |

#### `legacy.bridge_caso_actor_estado`

**Filas:** 61 · **Columnas:** 4 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.casos_actores`

Vínculo entre casos y funcionarios del Estado.

#### `legacy.bridge_caso_actorestado`

**Filas:** 1 · **Columnas:** 4 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.casos_actores`

Vínculo entre un caso y un funcionario del Estado; variante mínima del puente de casos con funcionarios.

#### `legacy.bridge_caso_causas`

**Filas:** 4 · **Columnas:** 5 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `documentos.contenido_json`

Causas atribuidas a un caso, tomadas del análisis de caso.

#### `legacy.bridge_caso_demandas`

**Filas:** 12 · **Columnas:** 6 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.demandas.caso_id`

Vínculo entre casos y demandas con su temática y el texto de la demanda.

#### `legacy.bridge_caso_depto`

**Filas:** 87 · **Columnas:** 7 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.caso_distritos`

Departamentos cubiertos por cada caso con la marca de principal; las columnas van corridas y la marca queda en la última posición, sin cabecera.

#### `legacy.bridge_caso_descencadenantes`

**Filas:** 1 · **Columnas:** 5 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `documentos.contenido_json`

Desencadenantes atribuidos a un caso, tomados del análisis de caso.

#### `legacy.bridge_caso_impulsores`

**Filas:** 5 · **Columnas:** 5 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `documentos.contenido_json`

Impulsores atribuidos a un caso, tomados del análisis de caso.

#### `legacy.bridge_caso_ineteres_comunes`

**Filas:** 0 · **Columnas:** 5 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** —

Tabla puente prevista para los intereses comunes de un caso; sin filas en el origen.

#### `legacy.bridge_caso_intereses`

**Filas:** 0 · **Columnas:** 6 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** — (`kag.actor_profile_attribute`)

Tabla puente prevista para los intereses de las partes de un caso; sin filas en el origen.

#### `legacy.bridge_caso_medios`

**Filas:** 4 · **Columnas:** 8 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `documentos.contenido_json`

Medios y enlaces de difusión asociados a un caso.

#### `legacy.bridge_caso_necesidades`

**Filas:** 0 · **Columnas:** 6 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** — (idem)

Tabla puente prevista para las necesidades de las partes de un caso; sin filas en el origen.

#### `legacy.bridge_caso_posiciones`

**Filas:** 0 · **Columnas:** 6 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** — (`core.casos_actores.posicion`)

Tabla puente prevista para las posiciones de las partes de un caso; sin filas en el origen.

#### `legacy.bridge_caso_recurso`

**Filas:** 0 · **Columnas:** 4 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** —

Tabla puente prevista entre casos y recursos pesqueros; sin filas en el origen.

#### `legacy.bridge_clima_actor`

**Filas:** 1 · **Columnas:** 6 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.documento_actores`

Vínculo entre un reporte de clima social y un actor civil.

#### `legacy.bridge_clima_actor_estado`

**Filas:** 1 · **Columnas:** 6 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.documento_actores`

Vínculo entre un reporte de clima social y un funcionario del Estado.

#### `legacy.bridge_nodo_actor`

**Filas:** 3 · **Columnas:** 5 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** diferido a `territorio.*` por D18

Participación de funcionarios del Estado en los nodos de la Red Radar, con su rol en el nodo.

#### `legacy.bridge_radar_actor`

**Filas:** 1 · **Columnas:** 5 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** diferido a `territorio.*` por D18

Participación de funcionarios del Estado en una red de la Red Radar, con su rol.

#### `legacy.bridge_reporte_actor`

**Filas:** 1 · **Columnas:** 6 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.documento_actores`

Vínculo entre un reporte rápido y un actor civil.

#### `legacy.bridge_reporte_actor_estado`

**Filas:** 1 · **Columnas:** 6 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.documento_actores`

Vínculo entre un reporte rápido y un funcionario del Estado.

#### `legacy.bridge_sectorista_departamento`

**Filas:** 27 · **Columnas:** 4 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.usuario_territorio`

Departamentos asignados a cada sectorista para el seguimiento.

#### `legacy.dim_acciones_hitos`

**Filas:** 8 · **Columnas:** 14 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.plan_acciones` (requiere PAR/PAE)

Acciones de seguimiento de un caso, enlazables con hitos y evidencias.

#### `legacy.dim_actores`

**Filas:** 828 · **Columnas:** 17 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.actores` + `actor_datos_personales` + `actor_membresia`

Censo de actores civiles (pescadores, dirigentes y representantes) con sus datos de contacto, perfil y organización; origen de los actores y de la PII.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador interno del actor (ACT-xxx); dos códigos se repiten en las 828 filas. |
| 3 | `c02` | text | sí | Nombre completo del actor; 819 valores distintos en 828 filas. |
| 4 | `c03` | text | sí | DNI del actor en claro; falta en 186 filas y perdió los ceros a la izquierda al guardarse como número. |
| 5 | `c04` | text | sí | Teléfono de contacto del actor; falta en 320 filas. |
| 6 | `c05` | text | sí | Correo electrónico del actor; presente en 41 filas. |
| 7 | `c06` | text | sí | Cargo o función declarada por el actor. |
| 8 | `c07` | text | sí | Organización del actor escrita como nombre, no como código ORG-xxx. |
| 9 | `c08` | text | sí | Abreviatura de la organización o del cargo del actor. |
| 10 | `c09` | text | sí | Código del tipo de actor (Tipo-Act-02 en 233 filas, Tipo-Act-03 en 9) con valores ajenos al catálogo ('Regional', 'Sí'). |
| 11 | `c10` | text | sí | Nivel de gobierno del actor (Local, Regional, Nacional) con valores ajenos al catálogo ('Perfil-01', 'Sí'). |
| 12 | `c11` | text | sí | Categoría del actor en el conflicto (Actor Primario o Actor Secundario) con valores ajenos al catálogo (ROL-01, ROL-02, Perfil-01). |
| 13 | `c12` | text | sí | Código del perfil del actor (Perfil-01 a Perfil-03); una fila trae en su lugar ROL-01. |
| 14 | `c13` | text | sí | Código de departamento (DEP-xx) del actor; nunca es un distrito. |
| 15 | `c14` | text | sí | URL de la fotografía del actor; presente en 95 filas. |
| 16 | `c15` | text | sí | Marca de actividad del actor (Sí en 296 filas, No en 2); vacía en las demás. |
| 17 | `c16` | text | sí | Descripción libre del perfil del actor; presente en 74 filas. |

#### `legacy.dim_actores_estado`

**Filas:** 108 · **Columnas:** 17 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.actores` (fusionar con #56)

Censo de funcionarios del Estado con cargo, contacto y nivel de gobierno; se fusiona con el censo de actores civiles al migrar.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador del funcionario del Estado (ACT-EST-xxx); único en las 108 filas. |
| 3 | `c02` | text | sí | Nombre del funcionario; 86 valores distintos en 108 filas. |
| 4 | `c03` | text | sí | Constante: valor 'N/D' en todas las filas. |
| 5 | `c04` | text | sí | Teléfono de contacto del funcionario; 74 valores distintos. |
| 6 | `c05` | text | sí | Correo electrónico institucional del funcionario; 77 valores distintos. |
| 7 | `c06` | text | sí | Cargo del funcionario en la entidad; 92 valores distintos. |
| 8 | `c07` | text | sí | Columna vacía en todas las filas. |
| 9 | `c08` | text | sí | Columna vacía en todas las filas. |
| 10 | `c09` | text | sí | Columna vacía en todas las filas. |
| 11 | `c10` | text | sí | Columna vacía en todas las filas. |
| 12 | `c11` | text | sí | Columna vacía en todas las filas. |
| 13 | `c12` | text | sí | Columna vacía en todas las filas. |
| 14 | `c13` | text | sí | Columna vacía en todas las filas. |
| 15 | `c14` | text | sí | Columna vacía en todas las filas. |
| 16 | `c15` | text | sí | Marca de actividad del funcionario; sólo 9 filas traen 'Sí' y el resto está vacío. |
| 17 | `c16` | text | sí | Columna sin cabecera y vacía en todas las filas. |

#### `legacy.dim_alertas`

**Filas:** 83 · **Columnas:** 32 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.alertas_tempranas` + `alertas_actores` + `derivaciones_alerta`

Alertas tempranas con su situación, hechos, acciones sugeridas, fuente y enlace al PDF; registro de alertas del sistema anterior.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador de la alerta (AT-2026-xx); AT-2026-48 y AT-2026-49 se repiten. |
| 3 | `c02` | text | sí | Código del caso vinculado (CS-PRODUCE-2026-xxx); vacío en 33 filas. |
| 4 | `c03` | text | sí | Código del sectorista responsable (SEC-xx). |
| 5 | `c04` | text | sí | Fecha de la alerta; 79 valores distintos. |
| 6 | `c05` | text | sí | Fecha de la última actualización de la alerta; distinta en cada fila. |
| 7 | `c06` | text | sí | Código de departamento (DEP-xx) del hecho alertado; presente en 79 filas. |
| 8 | `c07` | text | sí | Código de provincia (PRO-xxx) del hecho alertado; presente en 44 filas. |
| 9 | `c08` | text | sí | Código de distrito (DIS-xxxx) del hecho alertado; presente en 41 filas. |
| 10 | `c09` | text | sí | Columna vacía en todas las filas. |
| 11 | `c10` | text | sí | Título de la alerta; distinto en cada fila. |
| 12 | `c11` | text | sí | Código de sector (AR-001 en 66 filas, AR-002 en 17). |
| 13 | `c12` | text | sí | Situación actual descrita en la alerta. |
| 14 | `c13` | text | sí | Hechos recientes que motivan la alerta; presente en 71 filas. |
| 15 | `c14` | text | sí | Código del nivel de alerta (NA-001 a NA-004); dos filas lo omiten. |
| 16 | `c15` | text | sí | Código del nivel de riesgo asociado (RIE-xxx). |
| 17 | `c16` | text | sí | Descripción del riesgo de la alerta. |
| 18 | `c17` | text | sí | Acciones sugeridas para atender la alerta. |
| 19 | `c18` | text | sí | Acciones ejecutadas por la OAIPCS; presente en 49 filas. |
| 20 | `c19` | text | sí | Constante: valor '1' en todas las filas. |
| 21 | `c20` | text | sí | Columna vacía en todas las filas. |
| 22 | `c21` | text | sí | Columna vacía en todas las filas. |
| 23 | `c22` | text | sí | URL del PDF de la alerta en Drive; distinta en cada fila. |
| 24 | `c23` | text | sí | Columna vacía en todas las filas. |
| 25 | `c24` | text | sí | Columna vacía en todas las filas. |
| 26 | `c25` | text | sí | Columna vacía en todas las filas. |
| 27 | `c26` | text | sí | Columna vacía en todas las filas. |
| 28 | `c27` | text | sí | Constante: valor 'Archivado' en todas las filas. |
| 29 | `c28` | text | sí | Tipo de fuente de la alerta; mezcla texto libre con un arreglo JSON en una fila. |
| 30 | `c29` | text | sí | Descripción de la fuente de la alerta; presente en 18 filas. |
| 31 | `c30` | text | sí | Enlace a la fuente de la alerta; presente en 5 filas. |
| 32 | `c31` | text | sí | Columna vacía en todas las filas. |

#### `legacy.dim_anuncios_acuerdos`

**Filas:** 0 · **Columnas:** 8 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** —

Tabla prevista para anuncios y acuerdos de las mesas de diálogo; sin filas en el origen.

#### `legacy.dim_area_responsable`

**Filas:** 66 · **Columnas:** 6 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.cat_unidades_organicas`

Áreas orgánicas de las entidades responsables, dependientes de una entidad.

#### `legacy.dim_autoridades`

**Filas:** 2 · **Columnas:** 13 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** idem (rol `alta_direccion`)

Autoridades de alta dirección con cargo, área y credenciales de acceso.

#### `legacy.dim_capacitaciones`

**Filas:** 1 · **Columnas:** 21 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.capacitaciones`

Capacitaciones realizadas o previstas, con su temario, modalidad, fechas y documento.

#### `legacy.dim_causas`

**Filas:** 0 · **Columnas:** 3 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** —

Catálogo previsto de causas de conflictividad; sin filas en el origen.

#### `legacy.dim_climasocial`

**Filas:** 7 · **Columnas:** 29 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `core.documentos` tipo `clima_social_general`

Reportes de clima social general por departamento o provincia, con situación, focos de tensión y oportunidades de intervención.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador del reporte de clima (CS-2026-xx); único en las 7 filas. |
| 3 | `c02` | text | sí | Código del caso vinculado; sólo una de las 7 filas lo trae. |
| 4 | `c03` | text | sí | Código del sectorista responsable (SEC-xx); 2 valores distintos. |
| 5 | `c04` | text | sí | Fecha del reporte; distinta en cada fila. |
| 6 | `c05` | text | sí | Código de departamento (DEP-xx) en las seis filas no vacías; la cabecera del libro la rotula como fecha de actualización. |
| 7 | `c06` | text | sí | Código de provincia (PRO-xxx) en las seis filas no vacías; la cabecera la rotula como ubigeo. |
| 8 | `c07` | text | sí | Constante: valor 'AR-001' en las seis filas no vacías, código de sector ajeno a esta posición. |
| 9 | `c08` | text | sí | Columna vacía en todas las filas. |
| 10 | `c09` | text | sí | Lugar del reporte; una sola fila lo trae ('Tacna'). |
| 11 | `c10` | text | sí | Columna vacía en todas las filas. |
| 12 | `c11` | text | sí | Título del reporte; una sola fila lo trae. |
| 13 | `c12` | text | sí | Código de sector (AR-001); una sola fila lo trae. |
| 14 | `c13` | text | sí | Situación actual del clima social; distinta en cada fila. |
| 15 | `c14` | text | sí | Focos de tensión identificados; distinto en cada fila. |
| 16 | `c15` | text | sí | Oportunidades de intervención identificadas; distinta en cada fila. |
| 17 | `c16` | text | sí | Referencia de riesgo: '1' en seis filas y 'RIE-002' en una. |
| 18 | `c17` | text | sí | Descripción del riesgo del reporte; presente en 5 filas. |
| 19 | `c18` | text | sí | Recomendaciones estratégicas; una sola fila trae 'Sin recomendaciones'. |
| 20 | `c19` | text | sí | Columna vacía en todas las filas. |
| 21 | `c20` | text | sí | URL del PDF del reporte en Drive; presente en 6 filas. |
| 22 | `c21` | text | sí | Columna vacía en todas las filas. |
| 23 | `c22` | text | sí | Constante: valor '0' en las seis filas no vacías. |
| 24 | `c23` | text | sí | Constante: valor '0' en las seis filas no vacías. |
| 25 | `c24` | text | sí | Columna vacía en todas las filas. |
| 26 | `c25` | text | sí | Estado del reporte; una sola fila trae 'Borrador'. |
| 27 | `c26` | text | sí | Columna vacía en todas las filas. |
| 28 | `c27` | text | sí | Demandas registradas en el reporte; una sola fila las trae. |
| 29 | `c28` | text | sí | Riesgos inmediatos del reporte; una sola fila los trae. |

#### `legacy.dim_climasocial_focalizado`

**Filas:** 6 · **Columnas:** 27 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `core.documentos` tipo `clima_social_focalizado`

Reportes de clima social focalizados en un caso o territorio específico.

#### `legacy.dim_coordinacion_tecnica`

**Filas:** 4 · **Columnas:** 14 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `core.documentos`

Documentos de coordinación técnica asociados a un caso, con su tipo, fecha y enlaces.

#### `legacy.dim_demandas`

**Filas:** 325 · **Columnas:** 10 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.demandas` (3P obligatorio)

Demandas de los actores con su descripción, organización, caso, alerta, temática y evidencia; registro de demandas del sistema anterior.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador de la demanda (DEM-2026-xxxx); único en las 325 filas. |
| 3 | `c02` | text | sí | Descripción libre de la demanda; 305 valores distintos. |
| 4 | `c03` | text | sí | Código de la organización que formula la demanda (ORG-xxx); presente en 98 filas. |
| 5 | `c04` | text | sí | Código del caso vinculado (CS-PRODUCE-2026-xxx o CS-2026-xx) en 100 filas; las otras 225 traen cadena vacía. |
| 6 | `c05` | text | sí | Referencia del padre de la demanda: 236 alertas (AT-2026-xx), 6 casos, 5 reportes rápidos y 1 temática; vacía en 77 filas. |
| 7 | `c06` | text | sí | Código de temática (TEMA-xx); una fila trae en su lugar una marca de tiempo. |
| 8 | `c07` | text | sí | Fecha de registro de la demanda; una fila la omite. |
| 9 | `c08` | text | sí | Tipo de evidencia del registro ('Hecho Ocurrido' en 74 filas, 'Publicaciones o Redes Sociales' en 3); vacía en 248 filas. |
| 10 | `c09` | text | sí | Enlace a la evidencia del registro; presente en 77 filas y 12 valores distintos. |

#### `legacy.dim_departamentos`

**Filas:** 27 · **Columnas:** 12 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.regiones`

Departamentos del país con su ubigeo, región natural, alcance, coordenadas y capital.

#### `legacy.dim_descencadenantes`

**Filas:** 0 · **Columnas:** 3 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** —

Catálogo previsto de desencadenantes de conflictos; sin filas en el origen.

#### `legacy.dim_destinatarios_fijos`

**Filas:** 4 · **Columnas:** 8 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.suscripcion_notificacion`

Destinatarios fijos de alertas, reportes de clima y reportes rápidos, con su área y canal preferido.

#### `legacy.dim_distritos`

**Filas:** 698 · **Columnas:** 12 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.distritos`

Distritos con su código INEI, provincia y departamento; catálogo territorial de mayor granularidad.

#### `legacy.dim_entidad_responsable`

**Filas:** 23 · **Columnas:** 6 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.actores` (tipo Público)

Entidades públicas responsables de la gestión de casos, con su nivel y estado.

#### `legacy.dim_estado_proceso`

**Filas:** 5 · **Columnas:** 5 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.flujo_estado`

Estados del proceso de un caso, con color de tablero y marca de estado terminal.

#### `legacy.dim_hitos`

**Filas:** 12 · **Columnas:** 14 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.hitos_compromiso` (requiere compromiso)

Hitos comprometidos de un caso, con responsable, fechas, estado y evidencia.

#### `legacy.dim_impulsores`

**Filas:** 0 · **Columnas:** 3 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** —

Catálogo previsto de impulsores de conflictos; sin filas en el origen.

#### `legacy.dim_intervencion`

**Filas:** 4 · **Columnas:** 3 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.cat_ciclos_intervencion`

Catálogo de ciclos de intervención (prevención, intervención y tratamiento, seguimiento y gestión del conocimiento).

#### `legacy.dim_locales`

**Filas:** 27 · **Columnas:** 16 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.locales`

Locales disponibles para reuniones y mesas de diálogo, con aforo, equipamiento, contacto y recomendaciones de uso.

#### `legacy.dim_medios`

**Filas:** 0 · **Columnas:** 6 · **Clase declarada:** X · **Clase en v10:** X

**Destino:** —

Catálogo previsto de medios de comunicación o difusión; sin filas en el origen.

#### `legacy.dim_mesas_grupos`

**Filas:** 21 · **Columnas:** 24 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.mesas_dialogo`, `core.mesa_miembros`

Mesas y grupos de diálogo con su base legal, vigencia, integrantes y rol de PRODUCE; concepto sin equivalente en el modelo nuevo.

#### `legacy.dim_nivel_alertas`

**Filas:** 4 · **Columnas:** 5 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `cat_prioridades_alerta` o `cat_niveles_conflicto` (eje a decidir)

Niveles de alerta temprana con su descripción y categoría.

#### `legacy.dim_organizacion`

**Filas:** 224 · **Columnas:** 17 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.actores` + `core.organizaciones`

Censo de organizaciones sociales y gremios con su tipo, representante, integrantes, embarcaciones y datos registrales.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador de la organización (ORG-xxx); único en las 224 filas. |
| 3 | `c02` | text | sí | Nombre de la organización; 222 valores distintos en 224 filas. |
| 4 | `c03` | text | sí | Código de departamento (DEP-xx) de la organización; presente en 121 filas. |
| 5 | `c04` | text | sí | Dirección de la organización; presente en 28 filas. |
| 6 | `c05` | text | sí | Fecha de constitución de la organización; presente en 28 filas. |
| 7 | `c06` | text | sí | Tipo de organización (Asociación, Gremio, Sindicato, Cooperativa) con los códigos de relleno TIPO_ORG_001 y TIPO_ORG_002. |
| 8 | `c07` | text | sí | Inscripción en SUNARP; presente en 22 filas. |
| 9 | `c08` | text | sí | Código del actor que representa a la organización (ACT-xxx), no el código de la organización. |
| 10 | `c09` | text | sí | Número de integrantes declarados; presente en 24 filas. |
| 11 | `c10` | text | sí | Número de embarcaciones declaradas; presente en 24 filas. |
| 12 | `c11` | text | sí | Número de armadores declarados; presente en 24 filas. |
| 13 | `c12` | text | sí | URL de la fotografía de la organización; presente en 20 filas. |
| 14 | `c13` | text | sí | Descripción libre del perfil de la organización; sólo una fila la trae. |
| 15 | `c14` | text | sí | RUC de la organización; presente en 5 filas. |
| 16 | `c15` | text | sí | Columna vacía en todas las filas. |
| 17 | `c16` | text | sí | Abreviatura de la organización; presente en 11 filas. |

#### `legacy.dim_paso_proceso`

**Filas:** 3 · **Columnas:** 6 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.flujo_definicion`

Pasos del flujo de atención de un caso con su estado resultante, responsable y plazo.

#### `legacy.dim_paso_proceso_caso`

**Filas:** 4 · **Columnas:** 7 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.flujo_definicion`

Definición detallada de los pasos del flujo de un caso, con responsables, plazos y descripción.

#### `legacy.dim_perfil`

**Filas:** 3 · **Columnas:** 3 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `kag.actor_profile.resumen`

Perfiles de comportamiento de los actores (dialogante, legitimante, disruptivo).

#### `legacy.dim_provincias`

**Filas:** 70 · **Columnas:** 9 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.provincias`

Provincias con su código INEI y su departamento.

#### `legacy.dim_punto_focal`

**Filas:** 17 · **Columnas:** 13 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** idem (rol `punto_focal` **no existe** en v9)

Puntos focales del sector con cargo, área y credenciales de acceso.

#### `legacy.dim_recurso_pesca`

**Filas:** 37 · **Columnas:** 7 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.cat_especies` (renombrar la columna sin nombre)

Catálogo de recursos hidrobiológicos con nombre común, nombre oficial, familia, grupo biológico y ámbito.

#### `legacy.dim_redaccion`

**Filas:** 51 · **Columnas:** 14 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `core.documentos`

Documentos de redacción asociados a un caso (ayudas memoria, informes, relatorías) con tipo, fecha y enlaces.

#### `legacy.dim_reporte_rapido`

**Filas:** 1 · **Columnas:** 26 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `core.documentos` tipo `reporte_rapido`

Reporte rápido de una intervención territorial con lugar, desarrollo, acuerdos y seguimiento.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador del reporte rápido (RR-2026-01). |
| 3 | `c02` | text | sí | Columna vacía en todas las filas. |
| 4 | `c03` | text | sí | Código del sectorista responsable (SEC-xx). |
| 5 | `c04` | text | sí | Fecha del reporte. |
| 6 | `c05` | text | sí | Columna vacía en todas las filas. |
| 7 | `c06` | text | sí | Código de departamento (DEP-xx) del reporte. |
| 8 | `c07` | text | sí | Código de provincia (PRO-xxx) del reporte. |
| 9 | `c08` | text | sí | Contiene 'AR-001', código de sector, en la posición del distrito. |
| 10 | `c09` | text | sí | Lugar de la intervención reportada. |
| 11 | `c10` | text | sí | Columna vacía en todas las filas. |
| 12 | `c11` | text | sí | Columna vacía en todas las filas. |
| 13 | `c12` | text | sí | Título del reporte rápido. |
| 14 | `c13` | text | sí | Columna vacía en todas las filas. |
| 15 | `c14` | text | sí | Resumen rápido del reporte. |
| 16 | `c15` | text | sí | Desarrollo de la intervención, con el clima y las demandas observadas. |
| 17 | `c16` | text | sí | Anuncios y acuerdos alcanzados. |
| 18 | `c17` | text | sí | Seguimiento propuesto. |
| 19 | `c18` | text | sí | URL del PDF del reporte en Drive. |
| 20 | `c19` | text | sí | Columna vacía en todas las filas. |
| 21 | `c20` | text | sí | Su única fila trae 'Borrador', valor de estado ajeno a esta posición. |
| 22 | `c21` | text | sí | Columna vacía en todas las filas. |
| 23 | `c22` | text | sí | Columna vacía en todas las filas. |
| 24 | `c23` | text | sí | Columna vacía en todas las filas. |
| 25 | `c24` | text | sí | Columna sin cabecera; su única fila trae '0'. |
| 26 | `c25` | text | sí | Columna sin cabecera; su única fila trae '0'. |

#### `legacy.dim_responsable`

**Filas:** 3 · **Columnas:** 5 · **Clase declarada:** D · **Clase en v10:** D

**Destino:** — (puntero polimórfico)

Mapa de responsables por origen: código del responsable, tipo y tabla de la que procede.

#### `legacy.dim_riesgos`

**Filas:** 3 · **Columnas:** 3 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.cat_niveles_riesgo`

Niveles de riesgo con su tipo.

#### `legacy.dim_rol_actor`

**Filas:** 4 · **Columnas:** 4 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.cat_roles_actor` (sembrar 1–3)

Roles de los actores en el conflicto.

#### `legacy.dim_sectoristas`

**Filas:** 15 · **Columnas:** 14 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.usuarios` + `usuario_roles` (sin contraseña)

Sectoristas del sector con DNI, credenciales de acceso, cargo y contacto.

#### `legacy.dim_tipo_actor`

**Filas:** 3 · **Columnas:** 3 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.cat_tipos_actor` (sembrar 1–3)

Tipos de actor del sistema (social, público, privado).

#### `legacy.dim_tipo_actor_radar`

**Filas:** 3 · **Columnas:** 3 · **Clase declarada:** D · **Clase en v10:** D

**Destino:** —

Roles de los participantes en los nodos de la Red Radar (titular, alterno, participante institucional).

#### `legacy.dim_tipo_cambio`

**Filas:** 6 · **Columnas:** 4 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `core.caso_estado_historial.motivo`

Tipos de cambio de estado de un caso, con su descripción.

#### `legacy.dim_tipo_caso`

**Filas:** 4 · **Columnas:** 4 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.cat_tematicas` (o descartar)

Tipos de caso según la escala de conflictividad (diferencias, controversias, conflicto activo y crisis).

#### `legacy.dim_tipo_org`

**Filas:** 4 · **Columnas:** 3 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.cat_tipos_actor` (eje distinto)

Tipos de organización (asociación, gremio, sindicato, cooperativa).

#### `legacy.dim_tipo_proceso`

**Filas:** 4 · **Columnas:** 7 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.cat_tipos_documento`

Tipos de reporte con su sigla, prefijo de identificador y si tienen flujo asociado.

#### `legacy.dim_tipo_sector`

**Filas:** 3 · **Columnas:** 4 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.cat_subsectores` (semilla; hoy vacía)

Tipos de sector productivo con su área responsable.

#### `legacy.dim_tipo_tematica`

**Filas:** 7 · **Columnas:** 4 · **Clase declarada:** A · **Clase en v10:** A

**Destino:** `core.cat_tematicas` (semilla; hoy vacía)

Temáticas de conflictividad con su descripción.

#### `legacy.dim_unidades_organicas_responsa`

**Filas:** 27 · **Columnas:** 7 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.cat_unidades_organicas` (colisión con #85)

Unidades orgánicas responsables, dependientes de un área y de una entidad.

#### `legacy.fact_analisis_casos`

**Filas:** 1 · **Columnas:** 27 · **Clase declarada:** C · **Clase en v10:** C

**Destino:** `core.documentos` tipo `analisis_caso` (JSON → `contenido_json`)

Análisis estructurado de un caso con manifestaciones, desencadenantes, impulsores, causas, medios y posiciones.

#### `legacy.fact_casos`

**Filas:** 35 · **Columnas:** 30 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.casos` + `caso_distritos` + `caso_factores`

Un caso de conflictividad con su etapa, tipo, territorio y fechas de seguimiento; es el registro central del sistema anterior.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador del caso (CS-PRODUCE-2026-xxx); único en las 35 filas. |
| 3 | `c02` | text | sí | Tipo de caso (TC-01 a TC-03) según la escala de conflictividad; falta en una fila. |
| 4 | `c03` | text | sí | Nombre del caso; distinto en cada fila. |
| 5 | `c04` | text | sí | Sector productivo (Sector-01 en 29 filas, Sector-02 en 6); semilla de los subsectores. |
| 6 | `c05` | text | sí | Temática del caso (TEMA-xx); 7 valores distintos. |
| 7 | `c06` | text | sí | Fecha de inicio del caso; falta en 3 filas. |
| 8 | `c07` | text | sí | Código de departamento (DEP-xx) del caso; 13 valores distintos. |
| 9 | `c08` | text | sí | Código de provincia (PRO-xxx) del caso; presente en 25 filas. |
| 10 | `c09` | text | sí | Código de distrito (DIS-xxxx) del caso; presente en 23 filas. |
| 11 | `c10` | text | sí | Código del sectorista responsable (SEC-xx); 4 valores distintos. |
| 12 | `c11` | text | sí | Prioridad de atención (Urgente, Moderado o Bajo). |
| 13 | `c12` | text | sí | Ciclo de intervención (Ciclo-001 a Ciclo-003); falta en una fila. |
| 14 | `c13` | text | sí | Porcentaje de avance del caso (0, 0.7, 0.8 o 0.9). |
| 15 | `c14` | text | sí | Código del nivel de riesgo (RIE-xxx); falta en una fila. |
| 16 | `c15` | text | sí | Descripción del riesgo del caso; falta en una fila. |
| 17 | `c16` | text | sí | Resumen ejecutivo del caso; distinto en cada fila. |
| 18 | `c17` | text | sí | Constante: valor '0' en todas las filas. |
| 19 | `c18` | text | sí | Constante: valor '0' en todas las filas. |
| 20 | `c19` | text | sí | Constante: valor '0' en todas las filas. |
| 21 | `c20` | text | sí | Columna vacía en todas las filas. |
| 22 | `c21` | text | sí | Columna vacía en todas las filas. |
| 23 | `c22` | text | sí | Constante: valor '0' en todas las filas. |
| 24 | `c23` | text | sí | Columna vacía en todas las filas. |
| 25 | `c24` | text | sí | Columna vacía en todas las filas. |
| 26 | `c25` | text | sí | Columna vacía en todas las filas. |
| 27 | `c26` | text | sí | Columna vacía en todas las filas. |
| 28 | `c27` | text | sí | Columna vacía en todas las filas. |
| 29 | `c28` | text | sí | Columna vacía en todas las filas. |
| 30 | `c29` | text | sí | Columna sin cabecera y vacía en todas las filas. |

#### `legacy.fact_hechos_casos`

**Filas:** 80 · **Columnas:** 14 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.caso_cronologia` + `fuentes_evidencia` + `cronologia_vinculos`

Hechos de la cronología de un caso, con fecha, tipo, criticidad, evidencia y referencias a alertas y documentos.

| # | Columna | Tipo | Nulo | Descripción |
| --: | --- | --- | :--: | --- |
| 1 | `fila_n` | integer | no | — |
| 2 | `c01` | text | sí | Identificador del hecho (HECHO-xxx); HECHO-012 y HECHO-047 se repiten. |
| 3 | `c02` | text | sí | Código del caso al que pertenece el hecho; 5 valores distintos. |
| 4 | `c03` | text | sí | Fecha del hecho; 74 valores distintos. |
| 5 | `c04` | text | sí | Tipo de hecho; 9 valores distintos. |
| 6 | `c05` | text | sí | Marca de hecho crítico (No en 69 filas, Si en 11). |
| 7 | `c06` | text | sí | Descripción del hecho; distinta en cada fila. |
| 8 | `c07` | text | sí | Código del sectorista que registra el hecho (SEC-xx). |
| 9 | `c08` | text | sí | Tipo de evidencia del hecho ('Evidencia Institucional u otra' en 70 filas, 'Evidencia de Alerta o Reporte' en 7); vacía en 3 filas. |
| 10 | `c09` | text | sí | Columna vacía en todas las filas. |
| 11 | `c10` | text | sí | Referencia de la alerta asociada: tres códigos AT-2026-xx y dos URL de archivo. |
| 12 | `c11` | text | sí | Columna vacía en todas las filas. |
| 13 | `c12` | text | sí | Enlace a la evidencia del hecho; presente en 63 filas. |
| 14 | `c13` | text | sí | Código del documento de redacción vinculado (RED-2026-xxx); presente en 2 filas. |

#### `legacy.fact_historial_estado`

**Filas:** 27 · **Columnas:** 11 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.caso_estado_historial`

Historial de cambios de estado de los casos; sus columnas de fecha y estado están intercambiadas y sólo tiene 27 filas reales.

#### `legacy.fact_nodo`

**Filas:** 1 · **Columnas:** 10 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** diferido a `territorio.*` por D18

Nodos de la Red Radar con su red, ubigeo, nivel, fecha de instalación y descripción.

#### `legacy.fact_proceso_caso`

**Filas:** 36 · **Columnas:** 11 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.proceso_instancia`

Paso del flujo en que se encuentra cada caso, con responsable, fechas y observaciones.

#### `legacy.fact_proceso_reporte`

**Filas:** 99 · **Columnas:** 9 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.proceso_instancia`

Paso del flujo de cada reporte, con responsable, fechas de inicio y fin, demora y observaciones.

#### `legacy.fact_red_radar`

**Filas:** 1 · **Columnas:** 7 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** diferido a `territorio.*` por D18

Redes de la Red Radar con su alcance territorial, nivel, fecha de instalación y descripción.

#### `legacy.log_accesos`

**Filas:** 857 · **Columnas:** 6 · **Clase declarada:** D · **Clase en v10:** B

**Destino:** `core.log_accesos`

Registro de intentos de acceso al sistema con fecha, DNI, nombre, rol y resultado; sin destino en el modelo nuevo.

#### `legacy.log_envios`

**Filas:** 17 · **Columnas:** 14 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.notificaciones` (parcial)

Registro de envíos de documentos y reportes con canal, remitente, destinatario, enlace y resultado.

#### `legacy.respuestas_de_formulario_1`

**Filas:** 1 · **Columnas:** 24 · **Clase declarada:** B · **Clase en v10:** B

**Destino:** `core.alertas_tempranas` + `core.actores` (formulario Google; `avisa.raw_ingest.fuente` no lo admite)

Respuesta de un formulario de alerta con los datos de la alerta, sus demandas, riesgos y el actor reportado.

## 8. Correspondencia del sistema anterior con v10

Cada fila dice en qué tabla del modelo terminó el contenido de una hoja. La columna «Clase declarada» es la del análisis de portabilidad [2], escrita contra v9; la columna «Clase en v10» aplica las reclasificaciones que fijó la migración [3]. Cuando discrepan, manda la segunda.

Los destinos se citan como los declara el Anexo A de [2]; cuando llevan una anotación entre paréntesis, esa anotación advierte de una pérdida o de una decisión pendiente y forma parte de la ficha.

| Tabla del sistema anterior | Filas | Clase declarada | Clase en v10 | Destino en v10 |
| --- | --: | :--: | :--: | --- |
| `legacy._hojas` | 86 | — | — | — (manifiesto de la carga) |
| `legacy.bridge_actor_grupo` | 0 | X | X | — (`kag.aristas` cuando exista dato) |
| `legacy.bridge_alerta_actor` | 162 | A | A | `core.alertas_actores` (se pierden rol/es_principal) |
| `legacy.bridge_alerta_actorestado` | 5 | A | A | `core.alertas_actores` |
| `legacy.bridge_alerta_demandas` | 231 | B | B | `core.demandas` (pierde el vínculo con la alerta) |
| `legacy.bridge_alerta_recurso` | 32 | D | B | `core.alerta_especies` |
| `legacy.bridge_capacitacion_participant` | 9 | D | B | `core.capacitacion_participantes` |
| `legacy.bridge_caso_actor` | 80 | B | B | `core.casos_actores` (posicion/influencia por defecto) |
| `legacy.bridge_caso_actor_estado` | 61 | B | B | `core.casos_actores` |
| `legacy.bridge_caso_actorestado` | 1 | B | B | `core.casos_actores` |
| `legacy.bridge_caso_causas` | 4 | C | C | `documentos.contenido_json` |
| `legacy.bridge_caso_demandas` | 12 | A | A | `core.demandas.caso_id` |
| `legacy.bridge_caso_depto` | 87 | A | A | `core.caso_distritos` |
| `legacy.bridge_caso_descencadenantes` | 1 | C | C | `documentos.contenido_json` |
| `legacy.bridge_caso_impulsores` | 5 | C | C | `documentos.contenido_json` |
| `legacy.bridge_caso_ineteres_comunes` | 0 | X | X | — |
| `legacy.bridge_caso_intereses` | 0 | X | X | — (`kag.actor_profile_attribute`) |
| `legacy.bridge_caso_medios` | 4 | C | C | `documentos.contenido_json` |
| `legacy.bridge_caso_necesidades` | 0 | X | X | — (idem) |
| `legacy.bridge_caso_posiciones` | 0 | X | X | — (`core.casos_actores.posicion`) |
| `legacy.bridge_caso_recurso` | 0 | X | X | — |
| `legacy.bridge_clima_actor` | 1 | D | B | `core.documento_actores` |
| `legacy.bridge_clima_actor_estado` | 1 | D | B | `core.documento_actores` |
| `legacy.bridge_nodo_actor` | 3 | D | B | diferido a `territorio.*` por D18 |
| `legacy.bridge_radar_actor` | 1 | D | B | diferido a `territorio.*` por D18 |
| `legacy.bridge_reporte_actor` | 1 | D | B | `core.documento_actores` |
| `legacy.bridge_reporte_actor_estado` | 1 | D | B | `core.documento_actores` |
| `legacy.bridge_sectorista_departamento` | 27 | D | B | `core.usuario_territorio` |
| `legacy.dim_acciones_hitos` | 8 | B | B | `core.plan_acciones` (requiere PAR/PAE) |
| `legacy.dim_actores` | 828 | B | B | `core.actores` + `actor_datos_personales` + `actor_membresia` |
| `legacy.dim_actores_estado` | 108 | B | B | `core.actores` (fusionar con #56) |
| `legacy.dim_alertas` | 83 | B | B | `core.alertas_tempranas` + `alertas_actores` + `derivaciones_alerta` |
| `legacy.dim_anuncios_acuerdos` | 0 | X | X | — |
| `legacy.dim_area_responsable` | 66 | B | B | `core.cat_unidades_organicas` |
| `legacy.dim_autoridades` | 2 | B | B | idem (rol `alta_direccion`) |
| `legacy.dim_capacitaciones` | 1 | D | B | `core.capacitaciones` |
| `legacy.dim_causas` | 0 | X | X | — |
| `legacy.dim_climasocial` | 7 | C | C | `core.documentos` tipo `clima_social_general` |
| `legacy.dim_climasocial_focalizado` | 6 | C | C | `core.documentos` tipo `clima_social_focalizado` |
| `legacy.dim_coordinacion_tecnica` | 4 | C | C | `core.documentos` |
| `legacy.dim_demandas` | 325 | B | B | `core.demandas` (3P obligatorio) |
| `legacy.dim_departamentos` | 27 | A | A | `core.regiones` |
| `legacy.dim_descencadenantes` | 0 | X | X | — |
| `legacy.dim_destinatarios_fijos` | 4 | D | B | `core.suscripcion_notificacion` |
| `legacy.dim_distritos` | 698 | A | A | `core.distritos` |
| `legacy.dim_entidad_responsable` | 23 | B | B | `core.actores` (tipo Público) |
| `legacy.dim_estado_proceso` | 5 | B | B | `core.flujo_estado` |
| `legacy.dim_hitos` | 12 | B | B | `core.hitos_compromiso` (requiere compromiso) |
| `legacy.dim_impulsores` | 0 | X | X | — |
| `legacy.dim_intervencion` | 4 | D | B | `core.cat_ciclos_intervencion` |
| `legacy.dim_locales` | 27 | D | B | `core.locales` |
| `legacy.dim_medios` | 0 | X | X | — |
| `legacy.dim_mesas_grupos` | 21 | D | B | `core.mesas_dialogo`, `core.mesa_miembros` |
| `legacy.dim_nivel_alertas` | 4 | B | B | `cat_prioridades_alerta` o `cat_niveles_conflicto` (eje a decidir) |
| `legacy.dim_organizacion` | 224 | A | A | `core.actores` + `core.organizaciones` |
| `legacy.dim_paso_proceso` | 3 | D | B | `core.flujo_definicion` |
| `legacy.dim_paso_proceso_caso` | 4 | D | B | `core.flujo_definicion` |
| `legacy.dim_perfil` | 3 | B | B | `kag.actor_profile.resumen` |
| `legacy.dim_provincias` | 70 | A | A | `core.provincias` |
| `legacy.dim_punto_focal` | 17 | B | B | idem (rol `punto_focal` **no existe** en v9) |
| `legacy.dim_recurso_pesca` | 37 | A | A | `core.cat_especies` (renombrar la columna sin nombre) |
| `legacy.dim_redaccion` | 51 | C | C | `core.documentos` |
| `legacy.dim_reporte_rapido` | 1 | C | C | `core.documentos` tipo `reporte_rapido` |
| `legacy.dim_responsable` | 3 | D | D | — (puntero polimórfico) |
| `legacy.dim_riesgos` | 3 | A | A | `core.cat_niveles_riesgo` |
| `legacy.dim_rol_actor` | 4 | A | A | `core.cat_roles_actor` (sembrar 1–3) |
| `legacy.dim_sectoristas` | 15 | B | B | `core.usuarios` + `usuario_roles` (sin contraseña) |
| `legacy.dim_tipo_actor` | 3 | A | A | `core.cat_tipos_actor` (sembrar 1–3) |
| `legacy.dim_tipo_actor_radar` | 3 | D | D | — |
| `legacy.dim_tipo_cambio` | 6 | C | C | `core.caso_estado_historial.motivo` |
| `legacy.dim_tipo_caso` | 4 | B | B | `core.cat_tematicas` (o descartar) |
| `legacy.dim_tipo_org` | 4 | B | B | `core.cat_tipos_actor` (eje distinto) |
| `legacy.dim_tipo_proceso` | 4 | B | B | `core.cat_tipos_documento` |
| `legacy.dim_tipo_sector` | 3 | A | A | `core.cat_subsectores` (semilla; hoy vacía) |
| `legacy.dim_tipo_tematica` | 7 | A | A | `core.cat_tematicas` (semilla; hoy vacía) |
| `legacy.dim_unidades_organicas_responsa` | 27 | B | B | `core.cat_unidades_organicas` (colisión con #85) |
| `legacy.fact_analisis_casos` | 1 | C | C | `core.documentos` tipo `analisis_caso` (JSON → `contenido_json`) |
| `legacy.fact_casos` | 35 | B | B | `core.casos` + `caso_distritos` + `caso_factores` |
| `legacy.fact_hechos_casos` | 80 | B | B | `core.caso_cronologia` + `fuentes_evidencia` + `cronologia_vinculos` |
| `legacy.fact_historial_estado` | 27 | B | B | `core.caso_estado_historial` |
| `legacy.fact_nodo` | 1 | D | B | diferido a `territorio.*` por D18 |
| `legacy.fact_proceso_caso` | 36 | D | B | `core.proceso_instancia` |
| `legacy.fact_proceso_reporte` | 99 | D | B | `core.proceso_instancia` |
| `legacy.fact_red_radar` | 1 | D | B | diferido a `territorio.*` por D18 |
| `legacy.log_accesos` | 857 | D | B | `core.log_accesos` |
| `legacy.log_envios` | 17 | B | B | `core.notificaciones` (parcial) |
| `legacy.respuestas_de_formulario_1` | 1 | B | B | `core.alertas_tempranas` + `core.actores` (formulario Google; `avisa.raw_ingest.fuente` no lo admite) |

## 9. Índice alfabético

Ordenado por nombre de objeto, para encontrar una tabla cuando se conoce el nombre pero no el esquema. Las tablas muestran su esquema delante.

**Símbolos**

- `legacy._hojas`

**A**

- `config.a2_transiciones`
- `core.actor_datos_personales`
- `core.actor_membresia`
- `kag.actor_name_history`
- `kag.actor_profile`
- `kag.actor_profile_attribute`
- `consultation.actores`
- `core.actores`
- `core.acuerdo_ospa_sni`
- `core.alerta_especies`
- `core.alertas_actores`
- `core.alertas_tempranas`
- `impact.analisis_recurrencia`
- `economic.anexo_metodologico`
- `kag.anomalia_contextual`
- `territorio.anomalias_ais`
- `config.aplicacion`
- `kag.arista_evidencia`
- `kag.aristas`
- `domain.artefacto`
- `kag.atributo_evidencia`

**B**

- `chat.blame`
- `chat.blob`
- `ind.brecha`
- `legacy.bridge_actor_grupo`
- `legacy.bridge_alerta_actor`
- `legacy.bridge_alerta_actorestado`
- `legacy.bridge_alerta_demandas`
- `legacy.bridge_alerta_recurso`
- `legacy.bridge_capacitacion_participant`
- `legacy.bridge_caso_actor`
- `legacy.bridge_caso_actor_estado`
- `legacy.bridge_caso_actorestado`
- `legacy.bridge_caso_causas`
- `legacy.bridge_caso_demandas`
- `legacy.bridge_caso_depto`
- `legacy.bridge_caso_descencadenantes`
- `legacy.bridge_caso_impulsores`
- `legacy.bridge_caso_ineteres_comunes`
- `legacy.bridge_caso_intereses`
- `legacy.bridge_caso_medios`
- `legacy.bridge_caso_necesidades`
- `legacy.bridge_caso_posiciones`
- `legacy.bridge_caso_recurso`
- `legacy.bridge_clima_actor`
- `legacy.bridge_clima_actor_estado`
- `legacy.bridge_nodo_actor`
- `legacy.bridge_radar_actor`
- `legacy.bridge_reporte_actor`
- `legacy.bridge_reporte_actor_estado`
- `legacy.bridge_sectorista_departamento`

**C**

- `territorio.caleta_detalle`
- `core.cambio_normativo`
- `core.capacidad_campo`
- `core.capacitacion_participantes`
- `core.capacitaciones`
- `ctx.captura`
- `core.caso_cronologia`
- `core.caso_distritos`
- `core.caso_estado_historial`
- `core.caso_factores`
- `core.caso_lugares`
- `core.caso_regiones`
- `core.casos`
- `core.casos_actores`
- `core.cat_alcances_geograficos`
- `core.cat_ciclos_intervencion`
- `kag.cat_clases_arista`
- `core.cat_clasificacion`
- `kag.cat_corpus`
- `agent.cat_detalle_schema`
- `ctx.cat_dominios`
- `core.cat_especies`
- `domain.cat_estados_artefacto`
- `core.cat_estados_caso`
- `core.cat_estados_compromiso`
- `core.cat_estados_hito`
- `core.cat_estados_integracion`
- `core.cat_factores_contexto`
- `ctx.cat_fuentes`
- `analisis.cat_herramientas`
- `core.cat_mapeo_estado_externo`
- `core.cat_niveles_alerta`
- `core.cat_niveles_conflicto`
- `core.cat_niveles_riesgo`
- `core.cat_perfiles_actor`
- `core.cat_pip_etapas`
- `core.cat_pip_fases`
- `core.cat_prioridades_alerta`
- `core.cat_prioridades_atencion`
- `core.cat_roles_actor`
- `core.cat_roles_funcionales`
- `core.cat_subsectores`
- `core.cat_tematicas`
- `core.cat_tipos_actor`
- `kag.cat_tipos_arista`
- `core.cat_tipos_cambio_caso`
- `core.cat_tipos_capacitacion`
- `core.cat_tipos_documento`
- `core.cat_tipos_espacio_dialogo`
- `core.cat_tipos_fuente_integracion`
- `core.cat_tipos_hecho`
- `territorio.cat_tipos_lugar`
- `kag.cat_tipos_nodo`
- `core.cat_tipos_organizacion`
- `policy.cat_tipos_regla`
- `core.cat_tipos_reunion`
- `core.cat_unidades_organicas`
- `ctx.cat_variables`
- `territorio.certificaciones_planta`
- `chat.cherry_pick`
- `lex.clase`
- `lex.clase_termino`
- `qda.codigo`
- `chat.commit`
- `core.compromiso_colaboradores`
- `core.compromiso_distritos`
- `core.compromiso_pip`
- `core.compromisos`
- `kag.comunidad`
- `kag.comunidad_corrida`
- `kag.comunidad_miembro`
- `kag.comunidad_resumen`
- `kag.contraste`
- `lex.coocurrencia`
- `lex.corpus`
- `lex.corpus_documento`
- `lex.corrida`
- `economic.counterfactual_analysis`
- `core.cronologia_vinculos`
- `territorio.cuadricula_sismica`

**D**

- `audit.datos_personales_acceso`
- `core.demandas`
- `core.demandas_actores`
- `core.demandas_evidencias`
- `core.derivaciones_alerta`
- `territorio.desembarcadero_detalle`
- `lex.diccionario`
- `lex.diccionario_entrada`
- `chat.diff`
- `legacy.dim_acciones_hitos`
- `legacy.dim_actores`
- `legacy.dim_actores_estado`
- `legacy.dim_alertas`
- `legacy.dim_anuncios_acuerdos`
- `legacy.dim_area_responsable`
- `legacy.dim_autoridades`
- `legacy.dim_capacitaciones`
- `legacy.dim_causas`
- `legacy.dim_climasocial`
- `legacy.dim_climasocial_focalizado`
- `legacy.dim_coordinacion_tecnica`
- `legacy.dim_demandas`
- `legacy.dim_departamentos`
- `legacy.dim_descencadenantes`
- `legacy.dim_destinatarios_fijos`
- `legacy.dim_distritos`
- `legacy.dim_entidad_responsable`
- `legacy.dim_estado_proceso`
- `legacy.dim_hitos`
- `legacy.dim_impulsores`
- `legacy.dim_intervencion`
- `legacy.dim_locales`
- `legacy.dim_medios`
- `legacy.dim_mesas_grupos`
- `legacy.dim_nivel_alertas`
- `legacy.dim_organizacion`
- `legacy.dim_paso_proceso`
- `legacy.dim_paso_proceso_caso`
- `legacy.dim_perfil`
- `legacy.dim_provincias`
- `legacy.dim_punto_focal`
- `legacy.dim_recurso_pesca`
- `legacy.dim_redaccion`
- `legacy.dim_reporte_rapido`
- `legacy.dim_responsable`
- `legacy.dim_riesgos`
- `legacy.dim_rol_actor`
- `legacy.dim_sectoristas`
- `legacy.dim_tipo_actor`
- `legacy.dim_tipo_actor_radar`
- `legacy.dim_tipo_cambio`
- `legacy.dim_tipo_caso`
- `legacy.dim_tipo_org`
- `legacy.dim_tipo_proceso`
- `legacy.dim_tipo_sector`
- `legacy.dim_tipo_tematica`
- `legacy.dim_unidades_organicas_responsa`
- `core.distritos`
- `core.documento_actores`
- `kag.documento_fragmento`
- `kag.documento_fuente`
- `core.documentos`

**E**

- `mype.ejecucion_nec`
- `kag.embedding`
- `community.encuestas_percepcion`
- `impact.encuestas_post_resolucion`
- `core.entidades`
- `kag.entity_merge_log`
- `kag.entity_merge_members`
- `core.envios_comunicacion`
- `policy.escenario`
- `policy.escenario_regla`
- `territorio.estacion_hidrica_detalle`
- `consultation.etapas`
- `impact.evaluaciones_efectividad`
- `territorio.expansion_informal`
- `qda.exportacion`

**F**

- `legacy.fact_analisis_casos`
- `legacy.fact_casos`
- `legacy.fact_hechos_casos`
- `legacy.fact_historial_estado`
- `legacy.fact_nodo`
- `legacy.fact_proceso_caso`
- `legacy.fact_proceso_reporte`
- `legacy.fact_red_radar`
- `core.feature_flags`
- `agent.feedback_log`
- `core.flujo_definicion`
- `core.flujo_estado`
- `qda.fuente`
- `core.fuentes_evidencia`

**G**

- `policy.gobierno`
- `config.guardrail_contract`

**H**

- `ctx.herramienta`
- `kag.hipotesis`
- `kag.hipotesis_en_salida`
- `kag.hipotesis_evidencia`
- `core.hitos_compromiso`
- `core.hitos_compromiso_estado_historico`
- `chat.hook`

**I**

- `economic.impact_scenarios`
- `territorio.impacto_conflicto_planta`
- `ind.indicador`
- `impact.indicadores_bienestar`
- `core.integraciones`

**L**

- `impact.lecciones_aprendidas_automaticas`
- `agent.lessons_learned`
- `config.libreria`
- `qda.libro_codigos`
- `pesca.licencia_cites_denp`
- `agent.llm_call`
- `agent.llm_call_fragmento`
- `core.locales`
- `core.log_accesos`
- `legacy.log_accesos`
- `legacy.log_envios`
- `staging.lote`
- `territorio.lugar_actores`
- `territorio.lugares`

**M**

- `qda.mapeo_pseudonimo`
- `qda.memo`
- `chat.merge`
- `core.mesa_miembros`
- `core.mesas_dialogo`
- `kag.metrica_nodo`
- `core.migracion_conflicto`
- `model.model_card`
- `forecast.model_drift_log`
- `forecast.model_registry`
- `agent.modelo_registro`

**N**

- `kag.nodos`
- `core.notificaciones`

**O**

- `kag.objetivo`
- `ctx.observaciones`
- `core.organizaciones`
- `core.outbox_integracion`
- `core.output_contracts`

**P**

- `config.parametro`
- `territorio.parque_industrial`
- `territorio.patrones_seguridad_caleta`
- `qda.perdida_roundtrip`
- `core.permiso_aprobacion`
- `analisis.plan`
- `core.plan_acciones`
- `analisis.plan_paso`
- `core.planes_accion`
- `territorio.planta_detalle`
- `ind.plantilla`
- `agent.plantilla_prompt`
- `ind.plantilla_slot`
- `forecast.predictions`
- `core.proceso_instancia`
- `consultation.procesos`
- `core.provincias`
- `ind.proxy_justificacion`
- `qda.proyecto`
- `analisis.punto_ingesta`

**Q**

- `core.query_cache`

**R**

- `chat.rama`
- `avisa.raw_ingest`
- `avisa.raw_ingest_rejected`
- `chat.ref`
- `chat.reflog`
- `core.regiones`
- `staging.registro`
- `proteccion.registro_parametrico`
- `policy.regla`
- `domain.regla_negocio`
- `ind.relacion_dependencia`
- `chat.remote`
- `chat.repositorio`
- `legacy.respuestas_de_formulario_1`
- `ind.resultado`
- `consultation.resultados`
- `core.reunion_participantes`
- `core.reuniones_dialogo`
- `core.riesgo_social_ordinal`
- `core.roles`
- `agent.run_log`

**S**

- `kag.saturacion`
- `config.schema_registry`
- `qda.segmento`
- `qda.segmento_fragmento`
- `ind.seleccion`
- `lex.serie`
- `agent.sesion`
- `agent.sesion_paso`
- `ctx.snapshot`
- `policy.snapshot`
- `policy.snapshot_regla`
- `chat.stash`
- `core.suscripcion_notificacion`
- `agent.synthetic_test_cases`

**T**

- `territorio.terminal_detalle`
- `lex.termino`
- `domain.tipo_artefacto`
- `policy.titular`
- `ctx.trabajo_recoleccion`
- `pesca.trazabilidad_qr`
- `chat.turno`

**U**

- `lex.uce`
- `core.usuario_roles`
- `core.usuario_territorio`
- `core.usuarios`

**V**

- `kag.vacio_informacion`
- `kag.validacion_hallazgo`
- `ctx.variable_fuentes`
- `ind.variante`

**Z**

- `territorio.zona_pesca`
- `ctx.zonas_maritimas`

**Vistas**

- `pesca.cuota_cites_especie`
- `mype.inspeccion_cite`
- `analytics.mv_compromisos_inter_ministeriales`
- `mype.mv_concentracion_lotes`
- `analytics.mv_dashboard_alta_direccion`
- `analytics.mv_drift_embeddings`
- `analytics.mv_drift_grafo`
- `analytics.mv_tablero_decisional`
- `core.v_actor_datos_personales_seguro`
- `mype.v_ejecucion_nec_mora_vigente`
- `core.vw_agregacion_compromiso_externo`
- `analytics.vw_anexo_02_panorama_regional`
- `analytics.vw_anexo_14_seguimiento_compromisos`
- `analytics.vw_anexo_15_matriz_conflictividad`
- `analytics.vw_anexo_16_registro_reuniones`
- `analytics.vw_anexo_17_registro_reportes`
- `analytics.vw_carga_campo`
- `analytics.vw_casos_estancados`
- `lex.vw_clases_publicables`
- `analytics.vw_eravisa_survival`
- `analytics.vw_erop_milestones`
- `analytics.vw_geo_distrito`
- `analytics.vw_indicadores_minister`
- `analytics.vw_indicadores_obsoletos`
- `analytics.vw_mactor_red_actores`
- `analytics.vw_marco_situacional_robustez`
- `territorio.vw_monitoreo_hidrico_excede_eca`
- `analytics.vw_organizaciones_vigencia`
- `analytics.vw_riesgo_sistemico`
- `analytics.vw_selecciones_vigentes`

## 10. Referencias

Cada referencia dice qué documento es y qué parte de este diccionario sostiene.

1. `docs/BRECHA_CAPA_DATOS_V9.md` — diagnóstico de la base viva. Su §12.1–12.6 es el origen de la clasificación entrada / proceso / salida / transversal / archivo.
2. `docs/ANALISIS_PORTABILIDAD_AVISA_2026_A_V9.md` — análisis de portabilidad. Su Anexo A declara clase y destino de las 87 tablas del sistema anterior, y su §3 es el mapa columna a columna.
3. `docs/DECISIONES_CARGA_LEGADO_V9.md` — decisiones de migración D1–D51. Su Anexo A.2 fija las reclasificaciones que quedaron vigentes en v10.
4. `docs/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` — documento padre: qué se conserva y qué cambia entre el sistema anterior y v10, con la estadística comparada.
5. `docs/AVISA_PRODUCE_v10.md` — arquitectura objetivo del modelo v10.
6. `docs/mvp.md` — plan de ejecución del producto mínimo; su §1.1 pide este diccionario como entregable.
7. `docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql` — cifrado AES-256 de los datos personales y registro de auditoría; explica las columnas `*_cifrado` y `*_hmac`.
8. `docs/ENTORNO_DOCKER_POSTGRES.md` — cómo levantar la base y qué credenciales usa.
9. `migration/generar_diccionario.py` — el generador de este documento y del CSV.
10. `migration/curacion_v10.py`, `migration/curacion_vistas.py` y `migration/curacion_legacy.py` — la curaduría de propósitos y de significados de columna.
11. `docs/PARCHE_11_GRAFO_KAG.sql` — nodos y aristas del grafo KAG: de dónde salen las filas de `kag.nodos` y `kag.aristas` y qué las mantiene al día.
12. `docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql`, generado por `migration/generar_comentarios_sql.py` desde `migration/curacion_v10_columnas.py` — de ahí salen los propósitos de tabla y las descripciones de columna que la base tiene escritas.

