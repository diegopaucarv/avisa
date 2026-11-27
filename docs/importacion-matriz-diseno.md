# Importación de casos desde la matriz de conflictos sociales (Excel)

**Documento de diseño de producto.** No es una guía de implementación ni un runbook: define _qué_ debe hacer la importación, _qué textos_ ve la persona que la usa y _qué huecos_ hay que cerrar antes de construirla.

| Campo                         | Valor                                                                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fecha                         | 2026-11-27                                                                                                                                                                                         |
| Fuente de datos inspeccionada | `docs/05_datos/23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx`                                                                                                                               |
| Cómo se inspeccionó           | Lectura con `exceljs` (desde `angular/node_modules`), celda por celda, incluidos `richText`, `hyperlink`, fórmulas, celdas combinadas y tipos de fecha. Scripts temporales eliminados al terminar. |
| Código de referencia          | `scripts/matriz/*.py`, `angular/src/app/features/importacion/*`, `app/api/v1/*`, `angular/src/app/dominio/*`                                                                                       |
| Estado de la base             | El diseño asume el esquema `core` de AVISA v10 y las migraciones 41/42/43 **propuestas**; no se ejecutó ninguna migración ni escritura.                                                            |
| Audiencia                     | Producto, OAIPCS, backend, frontend Angular                                                                                                                                                        |

---

## Convenciones

| Marca                    | Significado                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **OBL**                  | Obligatorio para poder crear el registro. Si falta o es inválido, la fila se rechaza.                                                |
| **OPC**                  | Opcional. Si falta, el campo queda `NULL`. La interfaz lo pinta como «—».                                                            |
| **TR**                   | Se transforma (normaliza, parte, resuelve contra catálogo) antes de escribirse.                                                      |
| **IGN**                  | Se ignora deliberadamente. Siempre se explica el motivo y se declara en el informe.                                                  |
| **REF**                  | Solo referencia para el mapeo o para el informe; no se escribe.                                                                      |
| **`[POR CONFIRMAR: …]`** | Hueco declarado. Nunca se inventa un valor: se escribe esta marca textual y se lista en el informe para que una persona lo complete. |

**Principio rector, heredado de `scripts/matriz/importar_matriz.py` (líneas 11-22):** _el dato ausente se declara, no se estima_. Toda regla de este documento se subordina a eso. Cuando una celda no permite una resolución inequívoca, se deja `NULL`, se conserva el texto crudo si hay columna para ello y se emite una advertencia.

---

# 1. Resumen ejecutivo y decisión recomendada

## 1.1 Qué se está importando (medido, no supuesto)

El libro tiene 8 hojas y **37 bloques de caso** repartidos en dos hojas que se solapan. Las cifras de esta tabla salen de contar celda por celda el archivo real; corrigen las del encargo donde difieren.

| Hoja                              | Filas con dato                                               | Qué aporta                                                                                  | Destino                                                                           |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `CASOS OAIPCS - OPERATIVO`        | 130 filas, 33 `N°` distintos, **37 bloques**                 | Caso + compromisos + hitos (una fila por hito)                                              | `core.casos`, `core.demandas`, `core.compromisos`, `core.hitos_compromiso`        |
| `METADATOS CASOS`                 | 131 filas combinadas, **31 códigos únicos**                  | Código `CS-…`, fecha de registro, prioridad                                                 | `core.mapa_matriz_excel`, campos del caso                                         |
| `Reporte de avance de casos punt` | 105 filas, **32 bloques**                                    | Alcance, sub sector, nivel de riesgo inicial, validación de hito, 8 pares de nudos críticos | `core.casos` (alcance, sub sector, nivel de conflicto) y `core.caso_nudo_critico` |
| `Seguimiento de Alertas`          | **50 filas**, 49 códigos únicos                              | Alertas, reportes rápidos, clima social                                                     | `core.alertas_tempranas`                                                          |
| `Seguimiento de Reuniones`        | 46 filas (18 completas + 28 con solo fecha, región y título) | Reuniones con actores                                                                       | `core.reuniones`                                                                  |
| `Maestros`                        | 88 filas, 5 catálogos en columnas + 2 tablas auxiliares      | **No se importa**: es el diccionario de equivalencias                                       | Tabla de equivalencias versionada                                                 |
| `DVPA`                            | 408 filas, 218 con nombre, **solo 14 con DNI**               | Directorio de actores de pesca y acuicultura                                                | `core.actores`, `core.caso_actores`                                               |
| `DVMYPE-I`                        | 4 filas, **todas con marcadores**                            | Actores MYPE (sin datos reales todavía)                                                     | `core.actores` (no importable aún)                                                |

## 1.2 Los diez hallazgos que condicionan el diseño

1. **La hoja principal no está normalizada: una fila = un hito.** El caso se repite en todas sus filas. Importar «fila a fila» crearía 130 casos y 0 hitos. Hay que agrupar.
2. **El `N°` no es una clave.** El número **15 aparece dos veces con dos casos distintos**: «Demandas de las OSPAS de la Macrorregión Sur» (fila 48, riesgo `Bajo`) y «Restricciones internacionales a especies de tiburón» (filas 128-131, riesgo `Alto`). Agrupar solo por `N°` fusionaría dos casos ajenos. Falta el `32` y hay **3 bloques sin número** (filas 118-121, 127, 132).
3. **`Status` (columna 17) está vacía al 100 %** (130 de 130 celdas). No es un campo: es una columna abandonada.
4. **38 de los 64 hitos «Cumplido» no traen Fecha Real.** La API rechaza un hito `Cumplido` sin `fecha_real` (422 `FECHA_REAL_REQUERIDA`, `lib/db/repos/cases.ts` → `createHito`). Es el mayor riesgo de la importación y exige una decisión de producto explícita (§3.6).
5. **Ninguna de las 50 alertas trae código de caso** (columna 3 vacía en todas). Todas nacen «huérfanas» y hay que declararlas `requiere_vinculo_caso`.
6. **`Riesgo` y `Nivel de Riesgo` son dos vocabularios distintos** y no se deben confundir: `Riesgo` (Bajo/Medio/Alto/**Archivado**) → `Riesgo` del caso; `Nivel de Riesgo Inicial` (Bajo/Intermedio/Inminente/Crítico) → **`NivelConflicto`** (`Diferencia`/`Controversia`/`Conflicto social`/`Crisis social`).
7. **`Maestros` no es machine-parseable.** Es un volcado humano en bloques laterales (C, E, G, I, K) con combinadas `B:C` y `E:F`, erratas y dos tablas auxiliares (área→focal, espacios de diálogo). No se debe leer automáticamente: sus equivalencias se **codifican** en el backend.
8. **El 81 % del «Resumen Ejecutivo» está roto**: 85 de 105 celdas de la columna 21 del Reporte contienen `#REF!`. Se tratan como ausentes con advertencia.
9. **`Reporte de avance` es la única fuente del alcance geográfico y del nivel de conflicto**, y su numeración **no coincide** con la hoja principal (32 bloques frente a 37; un bloque sin `N°`). El emparejamiento debe ser por **nombre de caso normalizado**, no por número de fila.
10. **El código `CS-…` de `METADATOS` no identifica de forma segura un caso en la base**: hay colisiones documentadas y la API **emite su propio código** (`core.siguiente_codigo_caso`), sin permitir fijarlo. La identidad del caso la da `core.mapa_matriz_excel`, nunca `codigo_caso` (`importar_matriz.py`, líneas 19-21).

## 1.3 Decisión recomendada: híbrido en tres piezas, con el servidor como autoridad

**Recomendación: la importación de uso diario debe vivir dentro de la aplicación Angular, con un asistente XLSX que habla con un endpoint de servidor; el importador de escritorio se conserva como motor de referencia y herramienta de reconciliación, no como vía de uso.**

Tres piezas, no una:

| Pieza                                            | Qué es                                                                                                   | Rol                                                                                                                                 | Cuándo                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **A. Motor de referencia**                       | `scripts/matriz/parse_matriz.py` + `importar_matriz.py` (dry-run por defecto, `--apply --confirmar`)     | Verdad de negocio ya validada: agrupación, anomalías, transacción única. Se usa para migración masiva y para contrastar resultados. | Hoy, y en cada regresión |
| **B. Asistente XLSX con simulación en servidor** | Pantalla nueva en `features/importacion` + `POST /v1/matriz/previsualizar` ampliado para aceptar `.xlsx` | Uso diario no técnico: sube, ve el plan, corrige, confirma. **No escribe nada** en esta fase                                        | MVP                      |
| **C. Aplicación transaccional en servidor**      | `POST /v1/matriz/aplicar` con `confirmar: true`, una transacción                                         | Escritura real con RLS, sesión, auditoría y permisos de la app                                                                      | Fase 2                   |

**Por qué el servidor y no el navegador:**

- **RLS, sesión y auditoría ya están en la app.** Un importador de escritorio escribe con `neondb_owner` y `rolbypassrls`; la app escribe con el rol de la sesión y deja rastro. Para un dato que mueve 36 casos y ~130 hitos, la trazabilidad vale más que la comodidad.
- **El parser no cabe en el navegador sin duplicarlo.** Las reglas reales (cascada de actores, expansión de combinadas, claves compuestas, anomalías) están en Python y suman más de 100 KB de lógica. Portarlas al cliente crearía dos verdades que se separan en la primera errata nueva.
- **La simulación tiene que ser la misma que la aplicación.** Si el navegador simula y el servidor aplica, hay dos planes distintos. Un único `construirPlan()` en servidor garantiza que «lo que viste es lo que se escribe».
- **El archivo no debe quedarse en el equipo del usuario.** Adjuntos, `origen_ref`, hashes y versiones del libro se guardan en servidor; así el informe es reproducible.
- **El usuario no técnico no puede ejecutar Python.** Ese es el requisito de negocio: la OAIPCS usa el Excel a mano hoy; pedirle `python scripts/matriz/importar_matriz.py --apply --confirmar` no resuelve su problema.

**Por qué no se reescribe todo desde cero:** el dry-run de escritorio ya codifica las decisiones difíciles (qué es un bloque, qué es un hito, qué se declara). El diseño **reutiliza sus reglas como contrato**, no las reinventa.

**Lo que explícitamente NO se hará:**

- No se parseará `Maestros` para crear catálogos (§5).
- No se adivinará la fecha real de un hito cumplido (§3.6).
- No se creará un actor nuevo por defecto a partir de un nombre suelto (§7.4).
- No se fijará `alcance` a mano: la API lo prohíbe (`rechazarAlcanceManual`) y se deriva.
- No se reutilizará el formato `COLUMNAS_MATRIZ` de `app/api/v1/matriz/csv.ts` (A..W, 23 columnas): **no coincide** con el Excel actual de 25 columnas.

## 1.4 Decisiones de producto (para aprobar)

| #   | Decisión                       | Propuesta                                                                                      | Motivo                                         |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| D1  | Dónde importar                 | App (asistente XLSX) + servidor                                                                | §1.3                                           |
| D2  | Escritura                      | Transaccional por caso, con opción «todo o nada»                                               | Un caso a medias es peor que un caso rechazado |
| D3  | Reimportación                  | Upsert **conservador**: solo rellena vacíos; no pisa trabajo humano salvo «forzar»             | Evita perder avances cargados en AVISA         |
| D4  | Identidad del caso             | `core.mapa_matriz_excel` → si no hay, `(N° + nombre normalizado)` → si no, `(nombre + región)` | El `N°` solo no es clave (hallazgo 2)          |
| D5  | Hito «Cumplido» sin fecha real | Importar como `Registrado` + advertencia, con opción «exigir fecha»                            | No inventar fechas; no bloquear 38 hitos       |
| D6  | `Archivado` en `Riesgo`        | `riesgo = NULL` + `estado = Archivado` + advertencia                                           | No existe cuarto nivel de riesgo               |
| D7  | Nivel de riesgo inicial        | → `nivelConflicto` con tabla de equivalencias                                                  | Es conflictividad, no riesgo                   |
| D8  | Actores                        | Cascada de `match_actores.py`; «nuevo» = propuesta, no alta                                    | 14 DNI de 218 nombres                          |
| D9  | Alertas sin caso               | Se importan marcadas `requiere_vinculo_caso`                                                   | 50 de 50 vienen sin código                     |
| D10 | Documentos y adjuntos          | Fuera del MVP: se declaran como dato sin destino                                               | No hay título ni tipo en el Excel              |
| D11 | Vocabulario de temáticas       | Se declara la divergencia; no se toca `cat_tematicas`                                          | Dos vocabularios distintos en el mismo libro   |
| D12 | Permisos                       | Rol `importacion.matriz.ejecutar` para aplicar; simular requiere solo lectura                  | Cuatro ojos para escritura masiva              |

---

# 2. Mapa columna → campo, por hoja

## 2.0 Reglas de lectura comunes

1. **Se resuelve por encabezado, nunca por letra.** La matriz ya cambió de disposición una vez (riesgo D→H, descripción de riesgo I→G, temática M→L, fecha real W→V; ver `importar_matriz.py`, líneas 27-32). El mapeo se ancla al texto del encabezado normalizado.
2. **Encabezados con notas del 25NOV26.** Varias cabeceras traen instrucciones incrustadas (por ejemplo la columna 6 del operativo: «Análisis de Caso (Nota 25NOV26: Solo a los que ya tienen y a los 8 casos prioritarios)»). El reconocimiento usa **alias por prefijo**: si el encabezado _empieza por_ «Análisis de Caso», es esa columna.
3. **Encabezados de dos niveles.** La hoja principal tiene bandas combinadas en la fila 1 (`IDENTIFICACIÓN`, `ANÁLISIS Y RIESGOS`, `ACTORES Y DEMANDAS`, `COMPROMISOS`, `HITOS (NO SE ACTUALIZARÁ)`) y nombres en la fila 2. Las bandas son **solo referencia visual** y nunca se leen como dato.
4. **Combinadas siempre expandidas antes de mapear** (§4.3), salvo las columnas de hito.
5. **El orden de las columnas no es contrato.** Si mañana se inserta una columna, el mapeo debe seguir funcionando.

## 2.1 Hoja `CASOS OAIPCS - OPERATIVO` (25 columnas útiles; 27 de dimensión)

Encabezado en filas 1-2; datos desde la fila 3. Una fila = un hito.

| Col   | Encabezado real (fila 2)                     | Campo destino                                                    | Marca                   | Transformación / nota                                                                                                                                                                                        |
| ----- | -------------------------------------------- | ---------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | `N°`                                         | Clave de bloque `numero_excel` (no es campo del modelo)          | **TR**                  | Se normaliza a entero. **No es clave única** (§3.2). Si falta, se intenta heredar del bloque y se advierte `CASO_SIN_NUMERO`.                                                                                |
| 2     | `Región`                                     | `casos.region_principal_id` + `core.caso_regiones` (varias)      | **TR OBL**              | Lista con `/`, `y`, `-`. Se parte y se resuelve por nombre; la primera reconocible es la principal. `Nacional` no crea región: marca alcance nacional.                                                       |
| 3     | `Sectorista`                                 | `casos.punto_focal_usuario_id`                                   | **TR OPC**              | Resolución por nombre completo contra `core.usuarios`. Sin coincidencia inequívoca → `NULL` + `sectorista_sin_usuario`.                                                                                      |
| 4     | `Nombre de Caso`                             | `casos.nombre_caso`                                              | **OBL**                 | Texto. Base de la clave de agrupación. Se colapsan espacios y saltos.                                                                                                                                        |
| 5     | `Linea de tiempo` (richText)                 | Sin destino; candidata `core.caso_cronologia`                    | **IGN**                 | Es una narración con fechas dentro de un párrafo. Partirla exige decidir qué fecha corresponde a qué hecho: no es automatizable. Se guarda como anexo del informe y se marca `sin_destino`.                  |
| 6     | `Análisis de Caso …` (hyperlink)             | `casos.link_analisis_caso`                                       | **TR OPC**              | Se toma la **URL** (`https://drive.google.com/drive/folders/…`), no el texto «Análisis del Caso- Canva». Si la URL no es `http(s)`, se ignora con advertencia. Apunta a carpeta, no a documento.             |
| 7     | `Descripción del Riesgo Actual`              | `casos.descripcion_riesgo`                                       | **OPC**                 | Texto literal.                                                                                                                                                                                               |
| 8     | `Riesgo`                                     | `casos.nivel_riesgo_id`                                          | **TR OPC**              | `Bajo→1`, `Medio→2`, `Alto→3`. `Archivado` → `NULL` + `estado=Archivado` + advertencia `RIESGO_ARCHIVADO`. Sin default inventado: si falta, `riesgo_omitido`.                                                |
| 9     | `Actores del Estado `                        | `core.actores` + `core.caso_actores`                             | **TR OPC**              | Celda multivalor. Se parte con `partir_actores()` (§4.8) y se resuelve por la cascada de `match_actores.py` (§7.4).                                                                                          |
| 10    | `Actores Sociedad Civil `                    | `core.actores` + `core.caso_actores`                             | **TR OPC**              | Ídem, con `tipo_actor` de sociedad civil.                                                                                                                                                                    |
| 11    | `Demandas`                                   | `core.demandas.descripcion_demanda`                              | **TR OPC**              | Celda con lista numerada. Cada ítem = una demanda. Si el caso tiene demandas pero ninguna trae temática reconocible, la API rechazará el alta (`TEMATICA_REQUERIDA`): se avisa **antes**.                    |
| 12    | `Temática`                                   | `demandas.tematica_id` y `compromisos.tematica_id`               | **TR OPC**              | **Es por fila, no por caso**: un mismo caso trae `Gobernanza`, `Ordenanamiento…` y `Normatividad` en filas distintas (verificado en los casos 1, 2 y 8). Se corrige la errata `Ordenanamiento→Ordenamiento`. |
| 13    | `Acciones/Compromisos/Acuerdos …` (richText) | `compromisos.accion_compromiso`                                  | **TR OBL si hay hito**  | Se limpia el sufijo de instrucción «Validar con Punto Focal» que la cabecera arrastra al texto en algunas filas. Si empieza por «Plan …», se separa el plan (`separar_plan()`).                              |
| 14    | `Fuente del compromiso` (hyperlink)          | Sin destino                                                      | **IGN REF**             | El texto es «Acción 1: Adjuntar» y la URL es una carpeta de Drive. No es una fuente documental identificable ni un adjunto con título. Se usa solo para trazabilidad en el informe.                          |
| 15    | `Área Responsable de Monitoreo de Acción`    | `compromisos.unidad_id` (`core.cat_unidades_organicas`)          | **TR OPC**              | Siglas separadas por `/`. Solo se resuelve con coincidencia única; `DGPARPA` no existe en el catálogo → texto crudo + advertencia.                                                                           |
| 16    | `Punto Focal Monitoreo`                      | `compromisos.punto_focal_usuario_id` o `punto_focal_texto`       | **TR OPC**              | Excluyentes: si resuelve a usuario, id; si no, texto. La granuralidad es **por compromiso**, no por caso.                                                                                                    |
| 17    | `Status`                                     | Sin destino                                                      | **IGN**                 | Vacía en las 130 filas. No se mapea a `estado` ni a `estado_actualizacion`.                                                                                                                                  |
| 18    | `Hito`                                       | `hitos_compromiso.codigo_hito`                                   | **TR OPC**              | `Hito 1 … Hito 6`. Puede faltar (19 filas). Se normaliza a entero y se conserva la etiqueta.                                                                                                                 |
| 19    | `Descripción del Hito …` (richText)          | `hitos_compromiso.descripcion_hito`                              | **OBL para crear hito** | Se limpia la instrucción de cabecera. Si hay descripción sin etiqueta, se crea igual y se advierte `hito_sin_etiqueta`.                                                                                      |
| 20    | `Responsable del Hito`                       | `hitos_compromiso.responsable_usuario_id` o `responsable_texto`  | **TR OPC**              | Puede ser persona, área o tercero (PNP, MEF, MINEM). Solo resuelve a usuario si es una persona del padrón.                                                                                                   |
| 21    | `Fecha Planificada`                          | `hitos_compromiso.fecha_vencimiento` + `fecha_vencimiento_texto` | **TR OPC**              | 31 `Date`, 20 texto, 1 número, 78 vacías. Ver §4.5.                                                                                                                                                          |
| 22    | `Fecha Real`                                 | `hitos_compromiso.fecha_real` + `fecha_real_texto`               | **TR condicional**      | 20 `Date`, 12 texto, 1 número, 97 vacías. **Obligatoria si el estado es `Cumplido`** (regla de la API).                                                                                                      |
| 23    | `Estado Actual …` (richText)                 | `hitos_compromiso.estado_id`                                     | **TR OPC**              | `Cumplido→4`, `No Cumplido→6`, `Desestimado→5`. `No cumplido` (minúscula) → 6. Vacío → `Registrado (1)`.                                                                                                     |
| 24    | `Medios de verificación`                     | Sin destino; candidata `hitos_compromiso.descripcion_evidencia`  | **IGN REF**             | Es una instrucción («Acción 1: Adjuntar…»), no un archivo ni una URI. Se declara `sin_destino`.                                                                                                              |
| 25    | `Documentos (relatoria, AM, etc.)`           | `core.documentos`                                                | **IGN (MVP)**           | Texto que menciona documentos, no identificadores. El alta exige título y tipo: no se inventan.                                                                                                              |
| 26-27 | (vacías, residuo de formato)                 | —                                                                | **IGN**                 | Fuera del rango con dato.                                                                                                                                                                                    |

## 2.2 Hoja `METADATOS CASOS` (6 columnas)

Encabezado en la fila 1. **131 filas con combinadas: el bloque, no la fila, es la unidad.** 31 códigos únicos.

| Col | Encabezado              | Campo destino                                | Marca      | Transformación / nota                                                                                                        |
| --- | ----------------------- | -------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Código de Caso`        | `core.mapa_matriz_excel.codigo_excel`        | **TR OBL** | Patrón `CS-{PA\|MI}-{REG\|INF\|SOC}-{AÑO}-{NN}`. **Nunca** se usa como `codigo_caso` de la base.                             |
| 2   | `Fecha registro Caso`   | `casos.fecha_inicio` (con reserva semántica) | **TR OPC** | **96 de 113 celdas son números seriales, no fechas tipadas**, y 17 son `Date`. Hay que convertir serial→ISO (§4.5).          |
| 3   | `Departamento`          | Contraste con `casos.region_principal_id`    | **REF**    | Si discrepa de la hoja principal, gana la principal y se advierte `cabecera_discrepante`.                                    |
| 4   | `Sectorista`            | Contraste con `punto_focal_usuario_id`       | **REF**    | `André Jiménez Agapito` aparece aquí pero **no está en el catálogo `Maestros`**: se advierte `sectorista_fuera_catalogo`.    |
| 5   | `Prioridad de Atención` | `casos.prioridad_id`                         | **TR OPC** | `Urgente/Medio/Bajo`. Los valores del libro coinciden nombre a nombre.                                                       |
| 6   | `Nombre de Caso`        | Contraste con `casos.nombre_caso`            | **REF**    | Es la vía de emparejamiento con la hoja principal (normalizado). Si hay dos nombres para un código → `cabecera_discrepante`. |

## 2.3 Hoja `Reporte de avance de casos punt` (38 columnas)

Encabezado en la fila 1; 105 filas; 32 bloques. **Su numeración no coincide con la hoja principal**: el emparejamiento es por `Nombre de Caso` normalizado (columna 4), con `N°` solo como pista.

| Col                            | Encabezado                                   | Campo destino                             | Marca       | Transformación / nota                                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------- | ----------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                              | `N°`                                         | Pista de bloque                           | **REF**     | Un bloque no trae número. No identifica por sí solo.                                                                                                                                                                                         |
| 2                              | `Departamento`                               | Contraste de región                       | **REF**     | Igual que la hoja principal.                                                                                                                                                                                                                 |
| 3                              | `Alcance Geográfico `                        | `casos.alcance_id`                        | **TR OPC**  | `Nacional/Norte/Centro/Sur/Oriente`. `Regional` (1 caso) **no existe en el catálogo** → `NULL` + `alcance_fuera_catalogo`. La API no acepta alcance manual: se usa para **verificar** el derivado.                                           |
| 4                              | `Nombre de Caso`                             | Clave de emparejamiento                   | **TR OBL**  | Normalizado. Es la única unión fiable entre hojas.                                                                                                                                                                                           |
| 5                              | `Sub Sector`                                 | `casos.subsector_id`                      | **TR OPC**  | `Pesca y Acuicultura`, `Mype e Industria`. Se normaliza a `MYPE e Industria`.                                                                                                                                                                |
| 6                              | `Temática del Caso`                          | `casos.tematica` o `NULL`                 | **TR OPC**  | **Vocabulario distinto al de la hoja principal**: aquí `Recursos y Regulación`, `Infraestructura`, `Socio-Ambiental`. No se fuerza a `cat_tematicas`.                                                                                        |
| 7                              | `Problemática/Resumen de Caso`               | `casos.resumen`                           | **OPC**     | Párrafo.                                                                                                                                                                                                                                     |
| 8                              | `Descripción del Riesgo ` (richText)         | Contraste con `casos.descripcion_riesgo`  | **TR REF**  | Si discrepa, gana la hoja principal; se conserva el texto en el informe.                                                                                                                                                                     |
| 9                              | `Nivel de Riesgo Inicial`                    | `casos.nivel_conflicto`                   | **TR OPC**  | `Bajo (inicial y sin protestas)→Diferencia`, `Intermedio (acciones públicas de protestas)→Controversia`, `Inminente (Escala por decisión o hecho)→Conflicto social`, `Crítico (violencia, bloqueos, etc)→Crisis social`. **No es `Riesgo`.** |
| 10                             | `Acciones/Compromisos/Acuerdos …` (richText) | Contraste con compromisos                 | **REF**     | Se usa para conciliar, no para crear duplicados.                                                                                                                                                                                             |
| 11                             | `Medios de Verificaciones…` (hyperlink)      | Sin destino                               | **IGN REF** | Instrucción de cabecera + URL de carpeta.                                                                                                                                                                                                    |
| 12                             | `Área Responsable de Monitoreo de Acción`    | Contraste con `compromisos.unidad_id`     | **REF**     |                                                                                                                                                                                                                                              |
| 13                             | `Punto Focal Monitoreo`                      | Contraste con `compromisos.punto_focal_*` | **REF**     |                                                                                                                                                                                                                                              |
| 14                             | `Hito`                                       | Contraste con `codigo_hito`               | **REF**     |                                                                                                                                                                                                                                              |
| 15                             | `Descripción del Hito …`                     | Contraste con `descripcion_hito`          | **REF**     |                                                                                                                                                                                                                                              |
| 16                             | `Validación de Hito`                         | Sin destino                               | **IGN REF** | `Validado` 86, `Plan pendiente de aprobación` 6, `Validación Pendiente` 3, `Pendiente validacion` 3, `Por Validar` 2, `Validad` 1 (errata). No hay columna ni catálogo; se resume en el informe.                                             |
| 17                             | `Responsable del Hito`                       | Contraste                                 | **REF**     |                                                                                                                                                                                                                                              |
| 18                             | `Fecha Planificada…` (richText)              | Contraste con `fecha_vencimiento`         | **TR REF**  | Viene como **texto `dd.mm.aaaa`**, no como fecha: se convierte (§4.5).                                                                                                                                                                       |
| 19                             | `Fecha Real…`                                | Contraste con `fecha_real`                | **TR REF**  | Ídem.                                                                                                                                                                                                                                        |
| 20                             | `Estado Actual `                             | Contraste con `estado_id`                 | **TR REF**  | Si el estado del Reporte contradice al del operativo, gana el operativo y se advierte.                                                                                                                                                       |
| 21                             | `Resumen Ejecutivo al 17.02.2026`            | Sin destino                               | **IGN**     | **85 de 105 celdas son `#REF!`.** Se tratan como ausentes (§4.6) y se declara el fallo de origen.                                                                                                                                            |
| 22, 24, 26, 28, 30, 32, 34, 36 | `Nudos Críticos del …` (richText, 8 rangos)  | `core.caso_nudo_critico.descripcion`      | **TR OPC**  | Una fila por celda no vacía. El rótulo del rango se guarda como `semana`.                                                                                                                                                                    |
| 23, 25, 27, 29, 31, 33, 35, 37 | `Seguimiento del …` (richText, 8 rangos)     | `core.caso_nudo_critico.seguimiento`      | **TR OPC**  | `descripcion` y `seguimiento` pueden faltar por separado (CHECK: al menos uno).                                                                                                                                                              |
| 38                             | `Nivel de Riesgo Actual`                     | `casos.nivel_conflicto` (si está vacío)   | **TR OPC**  | Si el inicial ya se escribió, **no se pisa**: se advierte `nivel_conflicto_discrepante`.                                                                                                                                                     |

## 2.4 Hoja `Seguimiento de Alertas` (14 columnas útiles de 28)

Encabezado en la fila 1; datos desde la fila 2; 50 filas con código; **sin combinadas**.

| Col | Encabezado                       | Campo destino                           | Marca           | Transformación / nota                                                                                                                                                                        |
| --- | -------------------------------- | --------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Tipo`                           | `alertas.tipo_reporte`                  | **TR OPC**      | `REPORTE RAPIDO` 30, `ALERTA TEMPRANA` 16, `CLIMA SOCIAL` 3, `PLAN DE ACCIÓN RÁPIDA` 1. Se conserva el texto; si no hay catálogo, texto crudo.                                               |
| 2   | `Código de reporte`              | `alertas.codigo_alerta`                 | **TR OBL**      | `RR-2026-24`, `AT-2026-02`. **Hoy la API no acepta un código externo** (§10). Hay un código repetido: `AT-2026-18` en las filas 36 y 77.                                                     |
| 3   | `Código de caso de conflicto`    | `alertas.caso_id`                       | **OPC (vacía)** | **Vacía en las 50 filas.** Toda alerta se marca `requiere_vinculo_caso`.                                                                                                                     |
| 4   | `Responsable principal`          | `alertas.responsable_texto` / usuario   | **TR OPC**      | Resolución por nombre.                                                                                                                                                                       |
| 5   | `Fecha`                          | `alertas.fecha_alerta`                  | **TR OPC**      | Fechas tipadas; si falta, no se usa `current_date` en silencio: se advierte (§7.5).                                                                                                          |
| 6   | `Región`                         | `alertas.region_id`                     | **TR OPC**      | 12 valores, incluidas `Virtual`, `Litoral Sur`, `Lima Metropolitana` y `Nacional`. Las no reconocidas → `NULL` + `region_desconocida`; `lima provincias → lima` como en `cargar_alertas.py`. |
| 7   | `Provincia`                      | `alertas.provincia_id`                  | **TR OPC**      | Por nombre, dentro de la región.                                                                                                                                                             |
| 8   | `Distrito`                       | `alertas.distrito_principal_id` + texto | **TR OPC**      | Listas («Santa Rosa, Ventanilla, Ancón, Aucallama y Chancay»): se toma el primero reconocible y se guarda el texto completo.                                                                 |
| 9   | `Titulo`                         | `alertas.titulo`                        | **OBL**         | Truncado a 255 caracteres.                                                                                                                                                                   |
| 10  | `Tipo de Alerta`                 | `alertas.tipo_alerta`                   | **TR OPC**      | `PREVENTIVA` 11, `REACTIVA` 5; 34 vacías → `NULL`.                                                                                                                                           |
| 11  | `Resumen ejecutivo`              | `alertas.resumen`                       | **OPC**         | Puede traer la plantilla con emojis.                                                                                                                                                         |
| 12  | `Contenido`                      | `alertas.contenido`                     | **OPC**         | Plantilla `🔍 1. SITUACIÓN ACTUAL / 🏗️ 2. HECHOS RECIENTES / 🚨 Riesgos`. Se conserva tal cual: los emojis son parte del documento original.                                                 |
| 13  | `Conclusiones y recomendaciones` | `alertas.conclusiones`                  | **OPC**         |                                                                                                                                                                                              |
| 14  | `Documento `                     | `core.documentos`                       | **IGN (MVP)**   | Texto o enlace sin título ni tipo.                                                                                                                                                           |

## 2.5 Hoja `Seguimiento de Reuniones` (13 columnas útiles de 22)

Título combinado en la fila 1; **encabezado en la fila 2**; datos desde la fila 3. 46 filas: 18 completas (filas 3-20) y 28 parciales (filas 21-48) con solo fecha, región y título.

| Col | Encabezado              | Campo destino                 | Marca       | Transformación / nota                                                                                                         |
| --- | ----------------------- | ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Tipo`                  | `reuniones.tipo`              | **TR OPC**  | `Programado` 16, `No Programado` 2; 28 vacías → `[POR CONFIRMAR: tipo de reunión]`.                                           |
| 2   | `Código`                | Sin destino (clave sintética) | **IGN**     | **Vacía en las 46 filas.** La clave se compone: `fecha + lugar + título normalizado`.                                         |
| 3   | `Sector`                | `reuniones.sector`            | **TR OPC**  | `Pesca y Acuicultura`, `Mypes e Industria` → `MYPE e Industria`.                                                              |
| 4   | `Responsable principal` | `reuniones.responsable_texto` | **TR OPC**  |                                                                                                                               |
| 5   | `Fecha`                 | `reuniones.fecha`             | **TR OBL**  | Fechas tipadas y dos rangos en texto (`08-09/07/2026`, `16-17/07/2026`): se conservan como texto y se advierte `fecha_rango`. |
| 6   | `Departamento `         | `reuniones.region_id`         | **TR OPC**  | `Lima Metropolitana`, `Callao`, `Piura`, `Nacional`, `Macrosur`, `Lima / Pucusana`.                                           |
| 7   | `Lugar`                 | `reuniones.lugar`             | **OPC**     | Vacío en las 28 filas parciales.                                                                                              |
| 8   | `Titulo`                | `reuniones.titulo`            | **OBL**     |                                                                                                                               |
| 9   | `Asistencia `           | `reuniones.asistencia`        | **TR OPC**  | Booleano real de Excel.                                                                                                       |
| 10  | `AM`                    | `reuniones.acta_memoria`      | **TR OPC**  | Booleano.                                                                                                                     |
| 11  | `RELATORIA`             | `reuniones.relatoria`         | **TR OPC**  | Booleano.                                                                                                                     |
| 12  | `PUBLICACIÓN / NOTA`    | `reuniones.publicacion`       | **TR OPC**  | Booleano.                                                                                                                     |
| 13  | `Documentos`            | `reuniones.documentos_raw`    | **IGN REF** | Texto tipo «Reunión 05.03.2026», a veces con fecha incoherente con la de la fila. Se conserva solo en el informe.             |

## 2.6 Hoja `Maestros` (88 filas, 5 catálogos + 2 tablas auxiliares)

**No es una hoja de datos: es el diccionario.** Se usa para construir la tabla de equivalencias (§5), jamás para crear catálogos en caliente.

| Bloque                 | Ubicación | Valores                                                                                         | Destino                                          |
| ---------------------- | --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `Tipo_Caso`            | C1        | Alerta Temprana, Conflicto Social                                                               | `alertas.tipo_reporte` / naturaleza del caso     |
| `Alcance Geográfico`   | E1        | Nacional, Norte, Centro, Sur, Oriente                                                           | `cat_alcances_geograficos` (derivado)            |
| `Nivel de Riesgo`      | G1        | Bajo, Intermedio, Inminente, Crítico (con paréntesis)                                           | `NivelConflicto`                                 |
| `Estado Actual`        | I1        | Cumplido, No Cumplido, Desestimado                                                              | `cat_estados_hito`                               |
| `Rol en Conflicto`     | K1        | Decisor Principal, Decisor técnico, Proveedor evidencia, Implementador, Articulador territorial | **Sin destino**: `[POR CONFIRMAR]`               |
| `Riesgo`               | C7        | Alto, Medio, Bajo, Archivado                                                                    | `Riesgo` + `EstadoCaso`                          |
| `Sub Sector`           | E9        | Pesca y Acuicultura, Mype e Industria                                                           | `cat_subsectores`                                |
| `Sectorista`           | G9        | 5 personas                                                                                      | `core.usuarios`                                  |
| `Fases`                | K9        | Temprana, Implementación de Acuerdos, Desescalamiento, Diálogo, Escalamiento, Crisis            | `EtapaCiclo` (parcial)                           |
| `Temática`             | E14       | Infraestructura, Recursos y Regulación, Socio-Ambiental                                         | `cat_tematicas` (parcial)                        |
| `Estado del Caso`      | C17       | En Observación, Resuelto, Prevención, Seguimiento, En Tratamiento                               | `EstadoCaso` (parcial)                           |
| `Prioridad del Sector` | G17       | Alta, Media, Baja Prioridad Sectorial                                                           | `PrioridadAtencion`                              |
| `Impacto Social`       | I17       | Alto, Moderado, Bajo Impacto Social                                                             | **Sin destino**                                  |
| Área → Punto focal     | B25:F46   | 19 áreas + focal + confirmación                                                                 | `cat_unidades_organicas`, usuarios               |
| Espacios de diálogo    | B50:F88   | Mesa, entidad responsable, focal                                                                | **Sin destino** (catálogo de espacios pendiente) |

## 2.7 Hoja `DVPA` (23 columnas)

Encabezado en la fila 2; datos desde la fila 3; 408 filas con nombre u organización (**218 con nombre, solo 14 con DNI**).

| Col   | Encabezado                                           | Campo destino                     | Marca         | Transformación / nota                                                                                                                                 |
| ----- | ---------------------------------------------------- | --------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `N°`                                                 | Sin destino                       | **IGN**       | No es clave: hay huecos y repetidos.                                                                                                                  |
| 2     | `Fecha de registro`                                  | Metadato del actor                | **IGN**       | No hay columna; se conserva en el informe.                                                                                                            |
| 3     | `Foto Referencial`                                   | Sin destino                       | **IGN**       |                                                                                                                                                       |
| 4     | `Departamento`                                       | `actores.departamento`            | **TR OPC**    | Incluye `(Por confirmar)` → ausente.                                                                                                                  |
| 5     | `Provincia`                                          | `actores.provincia`               | **TR OPC**    |                                                                                                                                                       |
| 6     | `Distrito`                                           | `actores.distrito`                | **TR OPC**    |                                                                                                                                                       |
| 7     | `Nombres y Apellidos`                                | `actores.nombre_actual` (persona) | **OBL**       | Si está vacío pero hay organización, el registro es una organización, no una persona.                                                                 |
| 8     | `DNI`                                                | `actores.documento`               | **OPC**       | Solo 14 valores reales. Se valida 8 dígitos; si no, `DNI_INVALIDO`.                                                                                   |
| 9     | `Cargo en Organización`                              | `caso_actores.cargo`              | **TR OPC**    |                                                                                                                                                       |
| 10    | `Nombre de Organización`                             | `actores.organizacion`            | **TR OPC**    | 210 con valor.                                                                                                                                        |
| 11    | `Acrónimo / Siglas`                                  | `actores.siglas`                  | **TR OPC**    | Clave fuerte del matcher.                                                                                                                             |
| 12    | `Teléfono / Celular`                                 | `actores.telefono`                | **TR OPC**    | Puede ser número; conservar ceros iniciales.                                                                                                          |
| 13    | `Correo Electrónico`                                 | `actores.correo`                  | **TR OPC**    | Validación laxa; si no parece correo, texto crudo.                                                                                                    |
| 14    | `N° registro en SUNARP`                              | Sin destino                       | **IGN**       | Sin columna.                                                                                                                                          |
| 15    | `Recursos principales que extraen`                   | Sin destino                       | **IGN**       | Sin columna; candidata a atributo.                                                                                                                    |
| 16    | `Tipo de embarcaciones…`                             | Sin destino                       | **IGN**       |                                                                                                                                                       |
| 17    | `N° de socios`                                       | Sin destino                       | **IGN**       |                                                                                                                                                       |
| 18    | `N° de embarcaciones agrupadas`                      | Sin destino                       | **IGN**       |                                                                                                                                                       |
| 19    | `Perfil de Incidencia`                               | `actores.perfil_incidencia`       | **TR OPC**    | `DIALOGANTE` 10, `DISRUPTIVO` 9, `LEGITIMANTE` 4, `SIN INFORMACIÓN` 1; **384 vacías**.                                                                |
| 20    | `Postura vs PRODUCE`                                 | `actores.postura` o texto         | **TR OPC**    | 12 variantes libres (`Confrontacional`, `Colaborativa con demandas`, `Crítica-Colaborativa`…). Sin catálogo → texto crudo + `postura_fuera_catalogo`. |
| 21-23 | `Cap. Movilización / Negociación / Influencia (1-5)` | Sin destino                       | **IGN (MVP)** | Sin columnas; escala 1-5 declarada.                                                                                                                   |

## 2.8 Hoja `DVMYPE-I` (17 columnas)

Encabezado en la fila 2 (bandas `DATOS GENERALES`, `ORGANIZACIÓN`, `CONTACTO`, `UBICACIÓN`, `PERFIL / CARGO`, `CAPACIDADES Y RANGOS` en la fila 1). **4 filas de datos, todas con marcadores.**

| Col   | Encabezado                             | Campo destino                      | Marca                                               |
| ----- | -------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| 1     | `N°`                                   | Sin destino                        | **IGN**                                             |
| 2     | `Nombres y Apellidos`                  | `actores.nombre_actual`            | **OBL** (`(Representante por registrar)` → ausente) |
| 3     | `Cargo en Org.`                        | `caso_actores.cargo`               | **TR OPC**                                          |
| 4     | `Tipo de Actor`                        | `actores.tipo_actor`               | **TR OPC** (`Dirigente Gremial MYPE`)               |
| 5     | `DNI / Ref.`                           | `actores.documento`                | **OPC** (`(Por confirmar)`)                         |
| 6     | `Sector Productivo`                    | `actores.sector_productivo`        | **TR OPC**                                          |
| 7     | `Razón Social / Asociación`            | `actores.organizacion`             | **OPC**                                             |
| 8     | `Acrónimo`                             | `actores.siglas`                   | **TR OPC**                                          |
| 9-10  | `Teléfono / Correo`                    | `actores.telefono`, `correo`       | **TR OPC**                                          |
| 11-12 | `Departamento`, `Provincia / Distrito` | `actores.departamento`, `distrito` | **TR OPC**                                          |
| 13-14 | `Perfil de Incidencia`, `Postura`      | `actores.*`                        | **TR OPC** (`Por determinar` → ausente)             |
| 15-17 | `Cap. 1-5`                             | Sin destino                        | **IGN**                                             |

> **Resultado esperado hoy: 0 actores importados de esta hoja.** Las 4 filas son plantillas. El sistema debe decirlo con claridad y no crear «(Representante por registrar)» como persona (§4.7).

## 2.9 Resumen de lo que no tiene destino (y por qué)

| Dato                        | Hoja / columna                                     | Motivo                                                 | Qué hace el sistema                              |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Línea de tiempo             | Operativo, col 5                                   | Narración con fechas internas; partirla exige inventar | Se declara `sin_destino` y se adjunta al informe |
| Status                      | Operativo, col 17                                  | 100 % vacía                                            | **Se ignora sin advertencia** (ruido, no dato)   |
| Fuente del compromiso       | Operativo, col 14                                  | Hipervínculo a carpeta, texto «Acción 1: Adjuntar»     | `sin_destino`                                    |
| Medios de verificación      | Operativo, col 24                                  | Instrucción, no archivo                                | `sin_destino` + candidato futuro                 |
| Documentos                  | Operativo col 25, Alertas col 14, Reuniones col 13 | Texto sin título ni tipo                               | `sin_destino`                                    |
| Validación de hito          | Reporte, col 16                                    | Sin catálogo; 6 grafías                                | Se resume en el informe                          |
| Resumen ejecutivo           | Reporte, col 21                                    | `#REF!` en 85 de 105                                   | Ausente + `celda_error`                          |
| Rol en conflicto            | Maestros, K1                                       | Sin catálogo en el modelo                              | `[POR CONFIRMAR]`                                |
| Fases                       | Maestros, K9                                       | `EtapaCiclo` no cubre las 6                            | Mapeo parcial + `[POR CONFIRMAR]`                |
| Impacto social              | Maestros, I17                                      | Sin columna                                            | `[POR CONFIRMAR]`                                |
| Capacidades 1-5             | DVPA 21-23, MYPE 15-17                             | Sin columnas                                           | `sin_destino`                                    |
| Atributos pesqueros         | DVPA 14-18                                         | Sin columnas                                           | `sin_destino`                                    |
| Mesas y espacios de diálogo | Maestros, B50:F88                                  | Sin catálogo                                           | `sin_destino`                                    |

# 3. Reglas de agrupación y aplanado

## 3.1 La unidad de lectura no es la unidad de escritura

| Nivel               | Unidad                                                    | Qué es                                                                        |
| ------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Fila del Excel      | **Fila**                                                  | Un hito (o un compromiso sin hitos). 130 filas con dato en la hoja operativa. |
| Bloque              | **Caso**                                                  | Conjunto de filas consecutivas con el mismo caso. 37 bloques.                 |
| Registro a escribir | **Caso + N demandas + N compromisos + N hitos + N nudos** | Lo que se da de alta.                                                         |

**Regla de oro:** nunca se crea un caso por fila. Tampoco se crea un compromiso por fila: varias filas del mismo compromiso (una por hito) son **un** compromiso con **N** hitos.

## 3.2 Cómo se detecta un bloque (algoritmo)

1. **Expandir combinadas** de la hoja antes de leer (§4.3). Sin eso, el 90 % de las filas parece vacío (`parser_matriz.py`, `_expandir`).
2. **Descartar filas de relleno**: sin `N°`, sin nombre, sin descripción de hito y sin acción → no son datos.
3. **Descartar filas de sangrado de encabezado**: si `N°` contiene `IDENTIFICACIÓN`, `Región`, `Riesgo` o `ANÁLISIS Y RIESGOS`, la fila es un encabezado desplazado y se ignora con `fila_encabezado`.
4. **Abrir bloque nuevo** cuando cambia la pareja `(N° normalizado, Nombre de Caso normalizado)`. No cuando cambia solo el `N°`: el 15 está repetido (§3.3).
5. **Si el `N°` está vacío** (filas 118-121, 127, 132): se hereda del bloque anterior **solo si el nombre de caso es el mismo**; si el nombre cambia, se abre un bloque nuevo y se marca `CASO_SIN_NUMERO`.
6. **Propagar la cabecera** del bloque a todas sus filas (§3.4).
7. **Agrupar filas en compromisos** por `(acción normalizada, área responsable normalizada, punto focal normalizado)`.
8. **Agrupar filas en hitos** dentro de cada compromiso por `(etiqueta de hito, descripción normalizada)`.
9. **Emparejar con las otras hojas** por nombre de caso normalizado y, cuando exista, por `N°` como pista.

## 3.3 Claves de identidad (y por qué no se usa el `N°` solo)

| Entidad        | Clave                                                                                   | Evidencia                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Caso**       | `(N° , nombre normalizado)` dentro del archivo; `core.mapa_matriz_excel` contra la base | El **N° 15 aparece dos veces con dos casos distintos**: «Demandas de las OSPAS de la Macrorregión Sur» (riesgo `Bajo`) y «Restricciones internacionales a especies de tiburón» (riesgo `Alto`, filas 128-131). Con `N°` solo se fusionarían y se perdería un caso completo con 4 hitos; por eso el bloque de la fila 128 se aparta como **bloque en conflicto** y no se importa hasta que alguien le asigne número (§3.6). |
| **Compromiso** | `(caso, acción normalizada)` + área y focal como desempate                              | 56 acciones distintas para 130 filas: la acción se repite en cada hito del compromiso.                                                                                                                                                                                                                                                                                                                                     |
| **Hito**       | `(compromiso, etiqueta, descripción normalizada)`; **nunca la etiqueta sola**           | En el caso 1, la etiqueta `Hito 1` aparece **5 veces** (una por compromiso). Con la etiqueta sola se colapsarían 10 de los 15 hitos.                                                                                                                                                                                                                                                                                       |
| **Demanda**    | `(caso, descripción normalizada)`                                                       | La celda 11 trae listas numeradas; la misma demanda se repite en las filas de sus hitos.                                                                                                                                                                                                                                                                                                                                   |
| **Actor**      | DNI → siglas → nombre exacto → similitud (§7.4)                                         | 14 DNI de 218 nombres.                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Alerta**     | `codigo_reporte` (`RR-…`, `AT-…`)                                                       | 49 códigos únicos en 50 filas.                                                                                                                                                                                                                                                                                                                                                                                             |
| **Reunión**    | `(fecha, lugar, título normalizado)`                                                    | La columna `Código` está vacía en las 46 filas.                                                                                                                                                                                                                                                                                                                                                                            |

## 3.4 Qué se propaga y qué no

**Campos de cabecera (se propagan a todas las filas del bloque):** `N°`, `Región`, `Sectorista`, `Nombre de Caso`, `Linea de tiempo`, `Análisis de Caso`, `Descripción del Riesgo Actual`, `Riesgo`.

**Campos de fila (nunca se propagan):** `Temática`, `Acciones/Compromisos/Acuerdos`, `Fuente del compromiso`, `Área Responsable`, `Punto Focal`, `Hito`, `Descripción del Hito`, `Responsable del Hito`, `Fecha Planificada`, `Fecha Real`, `Estado Actual`, `Medios de verificación`, `Documentos`.

**Casos especiales:**

- **`Temática` es de fila, no de caso.** Verificado: el caso 1 trae `Gobernanza`, `Ordenanamiento y acceso territorial` y `Normatividad` en filas distintas; el caso 8 trae dos temáticas. Por eso va a `demandas.tematica_id` y `compromisos.tematica_id`, **no** a un campo único del caso.
- **Actores y demandas** son de fila, pero se **deduplican por bloque**: la celda 9, 10 u 11 de cada fila suele repetir el valor de la cabecera. Se toman una vez por bloque y se asocian al caso; si una fila introduce un actor nuevo, se añade al conjunto.
- **`Estado Actual` y `Fecha Real` no se arrastran jamás.** Si una fila no trae estado, el hito nace `Registrado`; no hereda el `Cumplido` de la fila anterior. (En `app/api/v1/matriz/csv.ts`, la lista `ARRASTRA` excluye expresamente las columnas de hito.)

## 3.5 Si dos filas del mismo caso discrepan

| Campo                             | Regla                                                                                                               | Mensaje                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `Nombre de Caso`                  | **Se separan en dos casos.** Un cambio de nombre con el mismo `N°` es señal de numeración repetida, no de sinónimo. | `CASO_NUMERO_REPETIDO` (advertencia)         |
| `Región`                          | Se **unen** las regiones distintas; la primera reconocible es la principal.                                         | `region_multiple` (advertencia, informativa) |
| `Riesgo`                          | **Gana el primer valor no vacío del bloque**; los demás se listan. Nunca se promedia.                               | `cabecera_discrepante`                       |
| `Sectorista`                      | Gana el primero; el resto se lista.                                                                                 | `cabecera_discrepante`                       |
| `Descripción del Riesgo Actual`   | Gana el texto más largo (suele ser el completo); el otro se conserva en el informe.                                 | `cabecera_discrepante`                       |
| `Análisis de Caso` (URL)          | Gana la primera URL válida; si hay dos distintas se listan.                                                         | `enlace_discrepante`                         |
| `Temática`                        | **No es discrepancia**: cada demanda y cada compromiso conserva la suya.                                            | —                                            |
| `Estado Actual`                   | Cada hito conserva el suyo. Si el Reporte contradice al operativo, gana el operativo.                               | `estado_discrepante`                         |
| `N°` vacío en una fila            | Se hereda del bloque si el nombre coincide.                                                                         | `CASO_SIN_NUMERO`                            |
| `N°` repetido con nombre distinto | Se separan y se avisa antes de aplicar.                                                                             | `CASO_NUMERO_REPETIDO`                       |

## 3.6 Casos límite y su resolución

| Situación                                                             | Cuántos                                      | Resolución                                                                                                                                                                                                              | Aviso                          |
| --------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Hito sin etiqueta (columna 18 vacía)                                  | 19 filas                                     | Se crea el hito con etiqueta derivada `Hito N` por orden dentro del compromiso y se declara la carencia.                                                                                                                | `hito_sin_etiqueta`            |
| Hito sin compromiso (columna 13 vacía)                                | 0 detectados                                 | Se rechaza la fila: un hito no puede colgar de la nada.                                                                                                                                                                 | `HITO_SIN_COMPROMISO`          |
| Compromiso sin hitos (acción sin descripción de hito)                 | Presente en varios bloques                   | Se crea el compromiso y **un hito sintético** con la misma descripción de la acción, estado `Registrado`. Se declara en el informe.                                                                                     | `compromiso_sin_hitos`         |
| Caso sin demandas                                                     | Varios bloques (p. ej. N° 7, 18, 20, 22, 27) | Se crea el caso; sin demandas no se puede crear demanda, pero el caso es válido.                                                                                                                                        | `caso_sin_demandas`            |
| **Hito `Cumplido` sin Fecha Real**                                    | **38 de 64**                                 | **Decisión D5:** se importa como `Registrado` + advertencia, conservando el texto `[POR CONFIRMAR: fecha real del hito]` en `fecha_real_texto`. Con el interruptor «exigir fecha real», en su lugar se rechaza la fila. | `HITO_CUMPLIDO_SIN_FECHA_REAL` |
| Hito con etiqueta y sin descripción                                   | 2 filas en el diagnóstico previo             | Se rechaza el hito; el compromiso se crea igual.                                                                                                                                                                        | `HITO_SIN_DESCRIPCION`         |
| Descripción de hito con texto de cabecera («Validar con Punto Focal») | Varias                                       | Se limpia el sufijo de instrucción.                                                                                                                                                                                     | `texto_limpiado` (informativa) |
| Bloque duplicado por error de numeración                              | 1 (filas 128-131)                            | **No se importa**: se aparta como bloque en conflicto y se lista con `[POR CONFIRMAR: número de caso]` (§3.7).                                                                                                          | `CASO_NUMERO_REPETIDO`         |

## 3.7 Ejemplo trabajado

**Caso 1 — «Conflicto intergremial por el uso de redes de enmalle…» (filas 3-15):**

| Lectura       | Resultado                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Filas         | 13                                                                                                                                  |
| Casos creados | **1**                                                                                                                               |
| Compromisos   | **5** (estudio técnico, ratificación de resolución, conformación de COREV, medidas de corto plazo, atención a solicitud del gremio) |
| Hitos         | **15** (3 por compromiso; la etiqueta `Hito 1` se repite 5 veces)                                                                   |
| Demandas      | **7**                                                                                                                               |
| Temáticas     | `Gobernanza`, `Ordenamiento y acceso territorial` (corregida), `Normatividad`                                                       |
| Estados       | 9 `Cumplido`, 2 `No Cumplido`, 2 vacíos                                                                                             |
| Fechas reales | 4 legibles; **5 hitos `Cumplido` sin fecha real**; una fecha es el texto `31.12.2025, 02, 03 y 05.01.2026`                          |

Si se importara fila a fila, este caso produciría **13 casos duplicados** y **0 hitos**. Si se agrupara solo por `N°` en todo el libro, el caso del tiburón se perdería dentro del caso 15.

**Caso 15 — la trampa:** fila 48 («Demandas de las OSPAS de la Macrorregión Sur», riesgo `Bajo`) y filas 128-131 («Restricciones internacionales a especies de tiburón», riesgo `Alto`). Son **dos casos**, pero comparten número.

**Decisión (alineada con `BLOQUE_DUPLICADO = 128` en `importar_matriz.py` y con `plan_importacion.py`):** se importa el bloque de la fila 48 y el de la fila 128 **no se importa**: se aparta como _bloque en conflicto_, se lista en el informe con `[POR CONFIRMAR: número de caso]` y se resuelve a mano asignándole el número libre que corresponda (el 32, por ejemplo). Así el conteo es 36 casos importables y 1 bloque pendiente, sin inventar numeración.

## 3.8 Cuadre esperado del libro completo

| Concepto                            | Cifra                                                           |
| ----------------------------------- | --------------------------------------------------------------- |
| Filas con dato en la hoja operativa | 130                                                             |
| Bloques                             | 37                                                              |
| Casos importables                   | **36** (37 bloques menos el bloque en conflicto de la fila 128) |
| Bloques en conflicto                | 1 (fila 128: número 15 repetido, caso distinto)                 |
| Compromisos distintos               | 56                                                              |
| Hitos                               | hasta 130 (una por fila con descripción)                        |
| Demandas distintas                  | 23                                                              |
| Nudos críticos                      | 16 celdas por bloque × 32 bloques, menos vacías                 |

El informe debe **cuadrar siempre**: `filas leídas = filas procesadas + filas rechazadas + filas omitidas + filas de encabezado`. Si no cuadra, la importación se detiene y se muestra el descuadre: es señal de un error del parser, no del archivo.

---

# 4. Normalización de celdas Excel

## 4.1 Orden del pipeline

Cada celda pasa, en este orden, por: **leer tipo → descomprimir richText → expandir combinada → limpiar texto → detectar error de celda → detectar marcador → convertir (fecha, booleano, número) → validar**. Ningún paso se salta y ninguno inventa: si un paso no puede convertir, deja el texto crudo y emite advertencia.

## 4.2 `richText`

- Se **concatenan los runs en orden**, respetando los saltos de línea internos (`\n`, `\n\n`) que el equipo usa como separador de ideas.
- Los saltos de línea **no** se convierten en espacios: en `Acciones/Compromisos` separan acciones, y en `Nudos` separan viñetas.
- Se sustituyen espacios duros (`\u00A0`) por espacios normales.
- Se recortan espacios al inicio y al final y se colapsan 3 o más saltos en 2.
- Se conservan las comillas tipográficas (`“ ”`), porque forman parte del nombre del estudio y de los títulos oficiales.
- **No se eliminan los emojis** del contenido de alertas (`🔍 1. SITUACIÓN ACTUAL`): son parte del documento original y ayudan a leerlo.

## 4.3 Celdas combinadas

- **Siempre se expanden antes de mapear**, salvo en las columnas de hito, que nunca se arrastran.
- La expansión copia el valor del **origen** (esquina superior izquierda) a todas las celdas del rango.
- La hoja operativa tiene **405 rangos combinados**, algunos solapados y mal aplicados (por ejemplo, el `N°` del caso 15 se extiende sobre filas que ya no le pertenecen). Por eso: **la expansión no decide la agrupación**; solo rellena huecos. La agrupación la decide el nombre (§3.2).
- Las combinadas de la hoja `METADATOS` hacen que el código se repita por bloque: se deduplica al leer, no al expandir.
- Lista de columnas que **sí** se arrastran (equivalente a `ARRASTRA` de `app/api/v1/matriz/csv.ts`): `N°`, región, sectorista, nombre de caso, línea de tiempo, análisis, descripción del riesgo, riesgo, actores (estado y sociedad civil), demandas, acción, área, punto focal, fuente, documentos.
- Lista que **no** se arrastra: `Hito`, `Descripción del Hito`, `Responsable del Hito`, `Fecha Planificada`, `Fecha Real`, `Estado Actual`, `Medios de verificación`. Un blanco ahí es «sin dato», no «lo mismo que arriba».

## 4.4 `hyperlink`

Una celda con hipervínculo trae dos cosas: **texto visible** y **URL**. Se separan siempre.

| Caso                               | Texto visible              | URL                                        | Qué se hace                                                                     |
| ---------------------------------- | -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `Análisis de Caso`                 | «Análisis del Caso- Canva» | `https://drive.google.com/drive/folders/…` | Se guarda la **URL** en `link_analisis_caso`; el texto se descarta.             |
| `Fuente del compromiso`            | «Acción 1: Adjuntar»       | carpeta de Drive                           | `sin_destino`: no es una fuente, es una instrucción.                            |
| `Medios de Verificación` (Reporte) | «Acción 1: Adjuntar»       | carpeta                                    | `sin_destino`.                                                                  |
| `Documentos` (Reuniones)           | «Reunión 05.03.2026»       | a veces enlace                             | `sin_destino`; se advierte si la fecha del texto no coincide con la de la fila. |

Reglas: si la URL no empieza por `http://` o `https://`, se ignora el enlace y se conserva el texto. Si la URL apunta a una **carpeta** (contiene `/folders/`), se guarda igual pero se marca `enlace_a_carpeta` en el informe, porque no es un documento verificable.

## 4.5 Fechas

El libro mezcla **cuatro** formatos y hay que tratarlos por separado:

| Origen                | Ejemplo real                                    | Detección                             | Resultado                                                                |
| --------------------- | ----------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Fecha tipada de Excel | `2025-11-06`                                    | `instanceof Date`                     | ISO `2025-11-06` → `fecha`                                               |
| **Serial numérico**   | `45900` (96 celdas en `METADATOS`)              | `typeof number` y rango 20 000-60 000 | Se convierte con base 1899-12-30 (corrige el bug del año 1900) → ISO     |
| Texto `dd.mm.aaaa`    | `06.11.2025`                                    | Regex `\d{1,2}\.\d{1,2}\.\d{4}`       | Se convierte → ISO (¡el importador CSV actual **no** acepta punto!)      |
| Texto `dd/mm/aaaa`    | `08/07/2026`                                    | Regex                                 | Se convierte → ISO                                                       |
| Rango de días         | `08-09/07/2026`, `16-17/07/2026`                | Guion antes de la barra               | **No se elige un día**: se conserva el texto y se advierte `fecha_rango` |
| Lista de fechas       | `31.12.2025, 02, 03 y 05.01.2026`               | Comas y « y »                         | Texto crudo → `fecha_texto`; advertencia `fecha_multiple`                |
| Texto no convertible  | `Indefinido`, `Depende de entrega de obra`, `-` | Cualquier otro                        | Texto crudo → `fecha_texto`; advertencia `fecha_no_convertible`          |
| Vacío                 | —                                               | —                                     | `NULL`; sin advertencia si el estado no la exige                         |

**Reglas adicionales:**

- Nunca se completa una fecha con la de hoy. (El cargador heredado `cargar_alertas.py` usaba `current_date` cuando faltaba; en esta importación **no** se hace: se advierte.)
- Se validan rangos: año entre 2000 y 2100; día y mes válidos. `31/02/2026` → `fecha_invalida`.
- Se conservan **dos columnas por fecha**: la tipada (`fecha_vencimiento`, `fecha_real`) y el texto crudo (`fecha_vencimiento_texto`, `fecha_real_texto`). Así nunca se pierde lo que decía el Excel.
- La fecha de registro de `METADATOS` **no** es la fecha de inicio del caso: se escribe en `fecha_inicio` solo si está vacía y se marca `fecha_registro_como_inicio` en el informe.

## 4.6 Errores de celda (`#REF!`, `#N/A`, …)

Se reconocen como **ausencia**, no como texto: `#REF!`, `#N/A`, `#VALUE!`, `#DIV/0!`, `#NAME?`, `#NULL!`, `#NUM!` (misma lista que `ERRORES_EXCEL` en `scripts/matriz/matriz_hojas_aux.py`).

En este libro el caso masivo es el **Resumen Ejecutivo: 85 de 105 celdas con `#REF!`**. Se tratan como vacías y se emite **una sola advertencia agregada por hoja y columna** («85 celdas con `#REF!` en Resumen Ejecutivo»), no 85 mensajes.

## 4.7 Marcadores y placeholders

Se reconocen como **ausencia** y **nunca se escriben** como si fueran un nombre:

`(Por confirmar)`, `(Organización por confirmar)`, `(Razón Social por confirmar)`, `(Representante por registrar)`, `Por determinar`, `Sin datos`, `SIN INFORMACIÓN`, `FALTA PUNTO FOCAL`, `-`, `—`, `N/A`, `No aplica`.

> En `DVMYPE-I` **las 4 filas son plantillas**. Si no se aplica esta regla, la base acabaría con cuatro personas llamadas «(Representante por registrar)». El sistema debe decir: «Esta hoja no trae datos reales todavía».

## 4.8 Celdas con varios valores

| Campo              | Separadores                                          | Regla                                                                                                                                                                                                         |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demandas           | Lista numerada (`1.`, `-`, `•`) y saltos de línea    | Cada ítem es una demanda. Si no hay numeración, se parte por doble salto. **No** se parte por coma: una demanda contiene comas.                                                                               |
| Actores            | Doble salto de línea, `/` y **coma de primer nivel** | Se usa `partir_actores()` de `parser_matriz.py`: la coma solo divide si hay 2 o más partes que parezcan entidad. Así «Pescadores de Cabo Blanco, Órganos, Ñuro» queda entero, y «DIREPRO / IMARPE» se separa. |
| Región             | `/`, `y`, `-`                                        | Se parte y se resuelve cada nombre. `Nacional` no se parte.                                                                                                                                                   |
| Temática           | Ninguno                                              | Un solo valor por fila. Si trae varios, se advierte `tematica_multiple` y se toma el primero.                                                                                                                 |
| Área responsable   | `/`                                                  | Siglas. Se resuelve solo con coincidencia única.                                                                                                                                                              |
| Distrito (alertas) | `,` y `y`                                            | Se toma el primero reconocible; el texto completo se conserva.                                                                                                                                                |

## 4.9 Booleanos

| Valor en la celda                    | Resultado                                     |
| ------------------------------------ | --------------------------------------------- |
| `true` / `false` (booleano de Excel) | Tal cual                                      |
| `Sí` / `Si` / `S` / `X` / `1`        | `true`                                        |
| `No` / `N` / `0`                     | `false`                                       |
| Vacío                                | `NULL` (no `false`)                           |
| Otro texto                           | `NULL` + advertencia `booleano_no_reconocido` |

La distinción entre `false` y `NULL` importa: «no asistió» y «no se registró» son cosas distintas, y la interfaz las pinta distinto.

## 4.10 Números, teléfonos y texto

- `1.0` (float de Excel) → entero `1` para `N°`.
- Teléfonos guardados como número (`950268934`) → texto, **sin perder ceros iniciales** si existieran.
- DNI → texto de 8 dígitos; `1234567` → `DNI_INVALIDO`; `12345678.0` → `12345678`.
- Se limpian caracteres de control invisibles y se normaliza el espacio antes de comparar, pero **se guarda el texto original** para mostrar.
- Truncados declarados: `alertas.titulo` y `reuniones.titulo` a 255; `descripcion_hito` a 1000 (con `texto_truncado` en el informe).

## 4.11 Encabezados, alias y sangrado

- Normalización de encabezado: NFKD, sin diacríticos, minúsculas, todo lo no alfanumérico a espacio, espacios colapsados (igual que `normalizarEncabezado` en `importacion.csv.ts`).
- Coincidencia **exacta o por prefijo**: «Análisis de Caso (Nota 25NOV26… )» empieza por «analisis de caso». Así las notas del equipo no rompen el mapeo.
- Si un encabezado esperado no aparece, la columna se declara **no mapeada** y el campo queda opcional o bloquea según §2. Nunca se adivina por posición.
- Si una fila de datos contiene un encabezado (`IDENTIFICACIÓN`, `Región`, `Riesgo`, `COMPROMISOS`, `Status`), se trata como **sangrado de encabezado** y se descarta.

---

# 5. Listas maestras y equivalencias

## 5.1 Por qué `Maestros` no se parsea automáticamente

1. **No es una tabla.** Son cinco catálogos en columnas C, E, G, I y K, más dos tablas auxiliares (filas 25-46 y 50-88) con combinadas `B:C` y `E:F`.
2. **Tiene erratas y duplicados** (`Sectorista` con 5 nombres, `André Jiménez` solo en `METADATOS`, `DGPARPA` que no existe en el catálogo de áreas).
3. **Mezcla vocabularios**: `Temática` (Infraestructura, Recursos y Regulación, Socio-Ambiental) no es el de la hoja principal (Ordenamiento, Gobernanza, Normatividad) ni el de `cat_tematicas`.
4. **No tiene versión ni vigencia.** Si mañana alguien añade un valor, el parseo automático crearía catálogos a medias sin revisión.
5. **Un catálogo se gobierna, no se descubre.** La equivalencia debe ser una tabla revisada y versionada, con responsable.

**Decisión:** las equivalencias viven en una tabla del backend (`core.equivalencias_matriz`: `familia`, `valor_excel`, `valor_destino`, `vigente_desde`, `nota`, `revisado_por`), sembrada a mano a partir de `Maestros`. `Maestros` es la **fuente citada**, no el importador.

## 5.2 Tabla de equivalencias

### 5.2.1 `Riesgo` (columna 8 del operativo)

| Valor Excel | `nivel_riesgo_id` | `EstadoCaso` | Nota                                                                    |
| ----------- | ----------------- | ------------ | ----------------------------------------------------------------------- |
| `Bajo`      | 1                 | —            |                                                                         |
| `Medio`     | 2                 | —            |                                                                         |
| `Alto`      | 3                 | —            |                                                                         |
| `Archivado` | `NULL`            | `Archivado`  | **No existe un cuarto nivel de riesgo.** Se declara `RIESGO_ARCHIVADO`. |
| Vacío       | `NULL`            | —            | `riesgo_omitido` (no se asume `Bajo`)                                   |
| Otro        | `NULL`            | —            | `RIESGO_NO_MAPEABLE`; se lista el valor                                 |

### 5.2.2 `Nivel de Riesgo` / `Nivel de Riesgo Inicial` → `NivelConflicto`

| Valor Excel                                   | `NivelConflicto`   | Motivo                        |
| --------------------------------------------- | ------------------ | ----------------------------- |
| `Bajo (inicial y sin protestas)`              | `Diferencia`       | Escalada mínima               |
| `Intermedio (acciones públicas de protestas)` | `Controversia`     | Acción pública sin ruptura    |
| `Inminente (Escala por decisión o hecho)`     | `Conflicto social` | Escalada declarada            |
| `Crítico (violencia, bloqueos, etc)`          | `Crisis social`    | Violencia o bloqueo           |
| Vacío                                         | `NULL`             | No se estima                  |
| Otro                                          | `NULL`             | `NIVEL_CONFLICTO_NO_MAPEABLE` |

> **Este es el error de vocabulario más caro del libro.** Si `Nivel de Riesgo Inicial` se guardara en `Riesgo`, el 67 % de los casos quedaría como «Intermedio», un valor que `Riesgo` no admite, y se perdería el nivel de conflictividad que exige la Guía §7.5.1.

### 5.2.3 `Estado Actual` (hito)

| Valor Excel                                   | `cat_estados_hito.id` | Nota                                         |
| --------------------------------------------- | --------------------- | -------------------------------------------- |
| `Cumplido`                                    | 4                     | Exige `fecha_real` salvo decisión D5         |
| `No Cumplido` / `No cumplido` / `NO CUMPLIDO` | 6                     | Normalizado sin distinguir mayúsculas        |
| `Desestimado`                                 | 5                     |                                              |
| `En ejecución`                                | 2                     | No aparece en este libro; se acepta si llega |
| `Paralizado`                                  | 3                     | Ídem                                         |
| Vacío                                         | 1 (`Registrado`)      |                                              |
| Otro                                          | —                     | `ESTADO_HITO_NO_MAPEABLE`                    |

### 5.2.4 `Estado del Caso` (Maestros C17) → `EstadoCaso`

| Valor Excel                          | `EstadoCaso` | Nota                                |
| ------------------------------------ | ------------ | ----------------------------------- |
| `En Observación`                     | `Abierto`    |                                     |
| `Prevención`                         | `Abierto`    | La distinción se pierde: se declara |
| `Seguimiento`                        | `Abierto`    |                                     |
| `En Tratamiento`                     | `Abierto`    |                                     |
| `Resuelto`                           | `Resuelto`   |                                     |
| (implícito por `Riesgo = Archivado`) | `Archivado`  |                                     |

Este campo **no aparece en ninguna hoja de datos**: solo existe en `Maestros`. No se importa hoy; se documenta porque define el catálogo futuro.

### 5.2.5 `Alcance Geográfico`

| Valor Excel                                     | Catálogo | Nota                                                             |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `Nacional`, `Norte`, `Centro`, `Sur`, `Oriente` | Igual    | Son los 5 del catálogo                                           |
| `Regional` (1 caso)                             | `NULL`   | No existe; `ALCANCE_FUERA_CATALOGO`                              |
| Vacío                                           | derivado | El alcance se deriva de las regiones; **la API prohíbe fijarlo** |

### 5.2.6 `Temática`

| Hoja       | Valor                                                         | `cat_tematicas`                                                                  |
| ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Operativo  | `Ordenanamiento y acceso territorial`                         | `Ordenamiento y acceso territorial` (errata corregida)                           |
| Operativo  | `Gobernanza`                                                  | `Gobernanza`                                                                     |
| Operativo  | `Normatividad`                                                | `Normatividad`                                                                   |
| Reporte    | `Infraestructura`                                             | `Infraestructura`                                                                |
| Reporte    | `Recursos y Regulación`                                       | `[POR CONFIRMAR]` — no hay equivalente canónico                                  |
| Reporte    | `Socio-Ambiental`                                             | `[POR CONFIRMAR]` — candidato a `Impactos de terceros`                           |
| (Maestros) | `Infraestructura`, `Recursos y Regulación`, `Socio-Ambiental` | Ídem                                                                             |
| Catálogo   | —                                                             | `Distribución de beneficios`, `Impactos de terceros` **no aparecen** en el libro |

Sin coincidencia: `tematica_id = NULL` + `TEMATICA_FUERA_CATALOGO`. **No se crea temática nueva** en caliente (`importar_matriz.py`, A4: «No se toca `cat_tematicas`»).

### 5.2.7 Sub sector, prioridad, sectorista, área

| Familia              | Excel                                                                                                                                                                       | Destino                      | Nota                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| Sub sector           | `Pesca y Acuicultura`                                                                                                                                                       | `cat_subsectores`            | Coincide                                                                                    |
| Sub sector           | `Mype e Industria`, `Mypes e Industria`                                                                                                                                     | `MYPE e Industria`           | Normaliza plural y mayúsculas                                                               |
| Prioridad            | `Urgente`, `Medio`, `Bajo`                                                                                                                                                  | `cat_prioridades_atencion`   | Coincide                                                                                    |
| Prioridad del sector | `Alta` / `Media` / `Baja Prioridad Sectorial`                                                                                                                               | `Urgente` / `Medio` / `Bajo` | **Mapeo interpretativo**: se declara                                                        |
| Sectorista           | 5 nombres de `Maestros`                                                                                                                                                     | `core.usuarios`              | `André Jiménez Agapito` no está en `Maestros`                                               |
| Área                 | `DGPA`, `DGAAMPA`, `DGPCHDI`, `DIPFORPA`, `DGPARPA`, `FONDEPES`, `IMARPE`, `SANIPES`, `PNACP`, `PCMP`, `PNDP`, `OGA`, `DGAAMI`, `DGSFS-PA`, `ITP`, `DGITDF`, `DGDE`, `PNTE` | `cat_unidades_organicas`     | `DGPARPA` y `DIPFORPA` no existen con esa grafía; se conserva texto + `AREA_FUERA_CATALOGO` |

### 5.2.8 `Rol en Conflicto` y `Fases` (sin uso hoy)

| Valor Excel                                                                                               | Destino                      | Decisión                                           |
| --------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `Decisor Principal`, `Decisor técnico`, `Proveedor evidencia`, `Implementador`, `Articulador territorial` | Sin columna                  | `[POR CONFIRMAR: rol en conflicto]`; no se escribe |
| `Temprana`                                                                                                | `Prevención estratégica`     | Referencia, no se importa                          |
| `Diálogo`, `Escalamiento`, `Crisis`                                                                       | `Intervención y tratamiento` | Referencia                                         |
| `Desescalamiento`, `Implementación de Acuerdos`                                                           | `Monitoreo de compromisos`   | Referencia                                         |
| `Impacto Social` (`Alto`, `Moderado`, `Bajo`)                                                             | Sin columna                  | `[POR CONFIRMAR]`                                  |

## 5.3 Qué pasa con un valor desconocido

| Situación                             | Comportamiento                                                | Texto al usuario                                                                                          |
| ------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Falta un valor obligatorio            | Rechazo de fila                                               | «Falta «Riesgo» y no hay valor equivalente en el catálogo.»                                               |
| Valor opcional desconocido            | `NULL` + advertencia, la fila se importa                      | «El valor «Regional» de «Alcance» no está en el catálogo. Se importó sin alcance; corríjalo en la ficha.» |
| Valor que parece una errata           | Se propone la corrección en el informe                        | ««Ordenanamiento y acceso territorial» se interpretó como «Ordenamiento y acceso territorial».»           |
| Valor nuevo repetido en 3 o más casos | Se agrupa en una sola advertencia y se abre `[POR CONFIRMAR]` | «3 casos traen «Recursos y Regulación». No hay equivalencia: ¿se añade al catálogo?»                      |

**Nunca** se crean entradas de catálogo durante la importación. La cola de `[POR CONFIRMAR]` se revisa después, con nombre y apellido del responsable.

## 5.4 Gobernanza de las equivalencias

- **Una sola tabla**, versionada, con `vigente_desde` y `revisado_por`.
- **Cambiar una equivalencia no reescribe lo ya importado**: solo afecta a importaciones futuras; el informe indica qué filas usaron una equivalencia retirada.
- **La equivalencia se muestra en la vista previa**: cada valor transformado se puede expandir para ver «Excel decía X → se guardará Y».
- **`Maestros` se cita como fuente** en la tabla (`fuente = 'Maestros!G2'`), para que cualquiera pueda auditarla contra el libro.

# 6. Validaciones y rechazos por fila

## 6.1 Severidades

| Severidad       | Significado                             | Efecto                       |
| --------------- | --------------------------------------- | ---------------------------- |
| **Archivo**     | El libro no se puede procesar           | No hay vista previa          |
| **Hoja**        | Una hoja se descarta, las demás siguen  | Se avisa y se continúa       |
| **Caso**        | Un bloque entero no se escribe          | Sus filas van a rechazos     |
| **Fila**        | Solo esa fila se rechaza                | El resto del caso se escribe |
| **Advertencia** | Se escribe, pero con un hueco declarado | Va al informe                |
| **Informativa** | Solo se informa                         | No requiere acción           |

Los textos marcados con ◆ **ya existen en el código** y se reutilizan literalmente. El resto son propuestas de este documento, redactadas para que una persona no técnica sepa qué hacer.

## 6.2 Archivo y hojas

| Código                 | Condición                                                     | Texto exacto                                                                                                                                | Sev.    |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `HOJA_NO_ENCONTRADA`   | No aparece ninguna hoja reconocible                           | «Este archivo no contiene la matriz de conflictos: no encuentro la hoja «CASOS OAIPCS - OPERATIVO». Compruebe que subió el libro correcto.» | Archivo |
| `HOJA_SIN_ENCABEZADO`  | La fila de encabezado no tiene «Nombre de Caso» ni «Demandas» | «La hoja «{hoja}» no tiene un encabezado reconocible. ¿Se movió la fila de títulos?»                                                        | Hoja    |
| `LIBRO_PROTEGIDO`      | El archivo no se puede abrir                                  | «No se puede leer el archivo. Si tiene contraseña, quítela y vuelva a intentarlo.»                                                          | Archivo |
| `ARCHIVO_MUY_GRANDE`   | > 5 MB o > 20 000 filas                                       | «El archivo supera el límite de 5 MB o 20 000 filas. Divídalo por año.»                                                                     | Archivo |
| `FORMATO_NO_SOPORTADO` | Extensión distinta de `.xlsx`/`.xlsm`                         | «Solo se aceptan libros de Excel (.xlsx). Guarde como «Libro de Excel» y vuelva a subirlo.»                                                 | Archivo |
| `XLSX_NO_SOPORTADO` ◆  | El importador genérico recibe un `.xlsx`                      | «Un .xlsx es un archivo comprimido, no una hoja de texto: no se puede leer aquí. En Excel use «Archivo → Guardar como → CSV UTF-8»…»        | Archivo |
| `LIMITE_FILAS` ◆       | > 400 filas en el importador genérico                         | «El archivo supera el límite de 400 filas por tanda.»                                                                                       | Archivo |

> `XLSX_NO_SOPORTADO` y `LIMITE_FILAS` son del **importador CSV genérico** de `features/importacion`. En el asistente de matriz **no deben aparecer**: si aparecen, es un error de cableado (ver §10).

## 6.3 Caso

| Código                      | Condición                                     | Texto exacto                                                                                                                                                                              | Sev.        |
| --------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `SIN_NOMBRE`                | Columna 4 vacía en todo el bloque             | «Falta «Nombre de Caso»: sin un nombre no se puede crear el caso.»                                                                                                                        | Caso        |
| `REGION_DESCONOCIDA`        | Ninguna región del bloque resuelve            | «La región «{valor}» no está en el catálogo. Corrija la celda B{fila} o escriba el nombre oficial (por ejemplo «Áncash», no «Ancash»).»                                                   | Caso        |
| `REGION_MULTIPLE`           | El bloque trae varias regiones                | «Este caso abarca {n} regiones. Se guardarán todas; la principal será «{region}».»                                                                                                        | Advertencia |
| `CASO_SIN_NUMERO`           | El bloque no tiene `N°`                       | «Este caso no trae número. Se importará con «[POR CONFIRMAR: número de caso]».»                                                                                                           | Advertencia |
| `CASO_NUMERO_REPETIDO`      | Dos bloques distintos con el mismo `N°`       | «El número {n} aparece en dos casos distintos: «{a}» y «{b}». Se importará el primero; el segundo quedará pendiente hasta que se le asigne un número. Corrija la numeración en el Excel.» | Advertencia |
| `RIESGO_NO_MAPEABLE`        | Valor fuera de Bajo/Medio/Alto/Archivado      | «El riesgo «{valor}» no se reconoce. El caso se importará sin nivel de riesgo; use Bajo, Medio o Alto.»                                                                                   | Advertencia |
| `RIESGO_ARCHIVADO`          | `Riesgo = Archivado`                          | ««Archivado» no es un nivel de riesgo: el caso se marcará como archivado y quedará sin nivel.»                                                                                            | Advertencia |
| `SECTORISTA_SIN_USUARIO`    | No se resuelve el nombre                      | «El sectorista «{nombre}» no coincide con ningún usuario. El caso se importará sin sectorista asignado.»                                                                                  | Advertencia |
| `SECTORISTA_FUERA_CATALOGO` | El nombre no está en `Maestros`               | «El sectorista «{nombre}» no figura en la lista maestra. ¿Es una persona nueva?»                                                                                                          | Advertencia |
| `ENLACE_INVALIDO`           | URL que no es http(s)                         | «El enlace de «Análisis de Caso» no es una dirección válida. Se importará sin enlace.»                                                                                                    | Advertencia |
| `ENLACE_A_CARPETA`          | URL de Drive con `/folders/`                  | «El enlace apunta a una carpeta, no a un documento. Se guardará igual.»                                                                                                                   | Informativa |
| `CASO_SIN_DEMANDAS`         | Bloque sin demandas                           | «Este caso no trae demandas. Se creará solo con sus compromisos e hitos.»                                                                                                                 | Advertencia |
| `CASO_SIN_HITOS`            | Bloque sin ningún hito                        | «Este caso no trae hitos: se creará con sus compromisos y sin seguimiento.»                                                                                                               | Advertencia |
| `CABECERA_DISCREPANTE`      | Dos valores distintos en un campo de cabecera | «En «{campo}» el caso trae dos valores: se usará «{elegido}» y se ignorará «{descartado}».»                                                                                               | Advertencia |
| `SIN_CODIGO` ◆              | Fila sin código AVISA ni código Excel         | «La fila no trae código AVISA ni código Excel, así que no se puede saber a qué caso pertenece.»                                                                                           | Caso        |
| `SIN_EQUIVALENCIA` ◆        | Código Excel sin equivalencia                 | «El código Excel «{codigo}» no tiene equivalencia en `core.mapa_matriz_excel`. Asígnela en «Mapeo de casos» antes de aplicar.»                                                            | Caso        |
| `CASO_INEXISTENTE` ◆        | El caso resuelto no existe                    | «El caso «{codigo}» no existe en `core.casos».»                                                                                                                                           | Caso        |

## 6.4 Demanda

| Código                    | Condición                                | Texto exacto                                                                                                                      | Sev.        |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `DEMANDA_SIN_TEXTO`       | Ítem vacío tras partir la lista          | «Una de las demandas de la celda K{fila} está vacía. Se omite.»                                                                   | Fila        |
| `TEMATICA_REQUERIDA` ◆    | La demanda no tiene temática reconocible | «La demanda «{texto}» no tiene temática. La base exige una temática para crearla: asígnela en «Demandas» o corrija la columna L.» | Fila        |
| `TEMATICA_FUERA_CATALOGO` | Temática sin equivalencia                | «La temática «{valor}» no está en el catálogo. La demanda se creará sin temática.»                                                | Advertencia |
| `TEMATICA_MULTIPLE`       | Más de un valor en una celda             | «La celda L{fila} trae más de una temática. Se usará «{primera}».»                                                                | Advertencia |
| `DUPLICADO_EN_ARCHIVO` ◆  | Demanda repetida en el mismo caso        | ««{texto}» ya aparece en una fila anterior de este archivo.»                                                                      | Fila        |

## 6.5 Compromiso

| Código                    | Condición                         | Texto exacto                                                                                                           | Sev.        |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------- |
| `ACCION_VACIA` ◆          | Hito sin acción/compromiso        | «Falta la acción/compromiso (columna M) para esta fila: el hito no puede existir sin un compromiso al que pertenecer.» | Fila        |
| `AREA_FUERA_CATALOGO`     | Área no resuelta                  | «El área «{valor}» no está en el catálogo de unidades orgánicas. Se guardará como texto.»                              | Advertencia |
| `PUNTO_FOCAL_NO_RESUELTO` | Persona no encontrada             | «El punto focal «{nombre}» no coincide con ningún usuario. Se guardará el nombre como texto.»                          | Advertencia |
| `COMPROMISO_SIN_DEMANDA`  | Acción sin demanda en su fila     | «Este compromiso no está vinculado a una demanda. Se creará suelto; puede vincularlo después.»                         | Advertencia |
| `COMPROMISO_SIN_HITOS`    | Acción sin hitos                  | «Este compromiso no trae hitos. Se creará un hito con el texto de la acción, en estado «Registrado».»                  | Advertencia |
| `COMPROMISO_DUPLICADO`    | Misma acción+área+focal dos veces | «Este compromiso ya aparece en este caso. Se reutiliza en lugar de duplicarlo.»                                        | Informativa |

## 6.6 Hito

| Código                         | Condición                                 | Texto exacto                                                                                                                                                                   | Sev.        |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `HITO_SIN_COMPROMISO`          | Fila de hito sin acción                   | «Esta fila describe un hito pero no dice a qué compromiso pertenece. Complete la columna M (acción) o elimine la fila.»                                                        | Fila        |
| `HITO_SIN_DESCRIPCION`         | Etiqueta sin descripción                  | «El {etiqueta} del compromiso «{accion}» no tiene descripción. Se omite el hito.»                                                                                              | Fila        |
| `HITO_SIN_ETIQUETA`            | Descripción sin etiqueta                  | «Un hito del compromiso «{accion}» no tiene etiqueta. Se numerará como «Hito {n}».»                                                                                            | Advertencia |
| `HITO_DUPLICADO`               | Mismo compromiso + etiqueta + descripción | «Fila duplicada: repite el bloque de la fila {n}.» ◆                                                                                                                           | Fila        |
| `ESTADO_HITO_NO_MAPEABLE`      | Estado fuera de catálogo                  | «El estado «{valor}» no se reconoce. Se usará «Registrado».»                                                                                                                   | Advertencia |
| `HITO_CUMPLIDO_SIN_FECHA_REAL` | `Cumplido` sin fecha real                 | «El hito «{descripcion}» está marcado como cumplido pero no tiene fecha real. Se importará como «Registrado». Escriba la fecha real en la columna V para conservar el estado.» | Advertencia |
| `FECHA_REAL_REQUERIDA` ◆       | Modo «exigir fecha real»                  | «Un hito en estado «Cumplido» exige fecha real. Complete la columna V o cambie el estado.»                                                                                     | Fila        |
| `FECHA_INVALIDA` ◆             | Fecha imposible (31/02)                   | ««{valor}» no es una fecha. Use AAAA-MM-DD o DD/MM/AAAA.»                                                                                                                      | Fila        |
| `FECHA_NO_CONVERTIBLE`         | Texto libre                               | «La fecha «{valor}» no se puede convertir. Se guardará el texto tal cual.»                                                                                                     | Advertencia |
| `FECHA_RANGO`                  | Rango de días                             | ««{valor}» es un rango de fechas. Se guardará el texto, sin elegir un día.»                                                                                                    | Advertencia |
| `FECHA_MULTIPLE`               | Varias fechas en una celda                | «La celda trae varias fechas («{valor}»). Se guardará el texto; sepárelas en hitos distintos si quiere fechas por hito.»                                                       | Advertencia |
| `FECHA_FUERA_DE_RANGO`         | Año < 2000 o > 2100                       | «La fecha «{valor}» está fuera del rango razonable (2000-2100). Revise la celda.»                                                                                              | Fila        |
| `RESPONSABLE_NO_RESUELTO`      | Persona no encontrada                     | «El responsable «{nombre}» no coincide con ningún usuario. Se guardará como texto.»                                                                                            | Advertencia |
| `ESTADO_DISCREPANTE`           | Reporte y operativo difieren              | «El hito «{descripcion}» figura como «{a}» en el operativo y como «{b}» en el Reporte. Se usará «{a}».»                                                                        | Advertencia |

## 6.7 Actor

| Código                    | Condición                           | Texto exacto                                                                                                   | Sev.        |
| ------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| `ACTOR_SIN_NOMBRE`        | Sin nombre ni organización          | «La fila {n} no trae ni nombre ni organización. No se puede crear un actor vacío.»                             | Fila        |
| `DNI_INVALIDO` ◆          | DNI distinto de 8 dígitos           | «El DNI «{valor}» debe tener 8 dígitos.»                                                                       | Advertencia |
| `PLACEHOLDER`             | Marcador en vez de dato             | ««{valor}» es un marcador de plantilla, no un dato. Se omite.»                                                 | Informativa |
| `ACTOR_AMBIGUO`           | Coincidencia dudosa (cascada)       | ««{nombre}» se parece a «{candidato}» ({porcentaje} %). No se vincula automáticamente: revíselo en «Actores».» | Advertencia |
| `ACTOR_NUEVO`             | Sin coincidencia                    | ««{nombre}» no existe en el directorio. Se propone crearlo, pero no se crea sin su confirmación.»              | Informativa |
| `PERSONA_VS_ORGANIZACION` | El nombre casa con una organización | ««{nombre}» coincide con una organización, no con una persona. No se vincula.»                                 | Advertencia |

## 6.8 Alerta

| Código                    | Condición                      | Texto exacto                                                                                                                        | Sev.        |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `ALERTA_SIN_TITULO`       | Columna 9 vacía                | «Falta «Titulo»: sin título no se puede crear la alerta.»                                                                           | Fila        |
| `ALERTA_SIN_CASO`         | Columna 3 vacía                | «Esta alerta no trae código de caso. Se importará como alerta sin caso y quedará en la lista «Por vincular».»                       | Advertencia |
| `ALERTA_CODIGO_DUPLICADO` | `AT-2026-18` dos veces         | «El código «{codigo}» aparece dos veces en el archivo (filas {a} y {b}). Se importará una sola vez; revise si son la misma alerta.» | Advertencia |
| `ALERTA_CODIGO_EXISTENTE` | El código ya existe en la base | «La alerta «{codigo}» ya existe. Se omitirá para no duplicarla.»                                                                    | Informativa |
| `ALERTA_SIN_FECHA`        | Columna 5 vacía                | «Esta alerta no trae fecha. Se importará sin fecha; no se usará la fecha de hoy.»                                                   | Advertencia |
| `ALERTA_SIN_TIPO_ALERTA`  | Columna 10 vacía               | «No se indica si la alerta es preventiva o reactiva. Se importará sin tipo.»                                                        | Advertencia |
| `REGION_DESCONOCIDA`      | `Virtual`, `Litoral Sur`       | «La región «{valor}» no es una región geográfica. Se importará sin región.»                                                         | Advertencia |

## 6.9 Reunión

| Código                          | Condición                      | Texto exacto                                                                                                         | Sev.        |
| ------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| `REUNION_SIN_TITULO`            | Columna 8 vacía                | «Falta «Titulo»: sin título no se puede crear la reunión.»                                                           | Fila        |
| `REUNION_SIN_TIPO`              | Columna 1 vacía (28 filas)     | «Esta reunión no indica si fue programada o no programada. Se importará con «[POR CONFIRMAR: tipo de reunión]».»     | Advertencia |
| `REUNION_SIN_SECTOR`            | Columna 3 vacía                | «Esta reunión no indica sector. Se importará sin sector.»                                                            | Advertencia |
| `REUNION_SIN_LUGAR`             | Columna 7 vacía                | «Esta reunión no indica lugar. Se importará sin lugar y no podrá emparejarse por la clave fecha+lugar+título.»       | Advertencia |
| `REUNION_DOCUMENTO_INCOHERENTE` | La fecha del texto no coincide | «El documento «{texto}» menciona una fecha distinta a la de la reunión ({fecha}). Se conserva solo como referencia.» | Informativa |

## 6.10 Precedencia y agregación

1. **Archivo → hoja → caso → fila.** Un error de archivo impide todo; un error de caso no impide los demás casos de la hoja.
2. **Un caso con error bloqueante no se escribe, ni siquiera parcialmente** (salvo el modo «continuar con lo válido», que debe pedirse expresamente).
3. **Las advertencias no bloquean.** Se cuentan, se agrupan por código y se listan con un ejemplo y el total.
4. **Nunca se muestran 130 mensajes iguales.** Se agrupan: «38 hitos cumplidos sin fecha real» con un enlace «ver los 38».
5. **El orden de la tabla de rechazos es el de la hoja**, no el de detección, para que el usuario pueda recorrer el Excel de arriba abajo.

## 6.11 La tabla de rechazos

Columnas: **Hoja · Fila · Caso · Registro · Código · Motivo · Cómo corregir**. La última columna es la que hace útil el informe: no basta con decir qué falló.

| Hoja         | Fila | Caso                             | Registro                   | Código                         | Motivo                                                       | Cómo corregir                                                             |
| ------------ | ---- | -------------------------------- | -------------------------- | ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| CASOS OAIPCS | 68   | «Presunta depredación…»          | Hito «Revisión de informe» | `HITO_CUMPLIDO_SIN_FECHA_REAL` | El hito está marcado como cumplido pero no tiene fecha real. | Escriba la fecha real en la columna V o cambie el estado a «No Cumplido». |
| CASOS OAIPCS | 128  | «Restricciones internacionales…» | Caso                       | `CASO_NUMERO_REPETIDO`         | El número 15 aparece en dos casos distintos.                 | Asigne un número libre al caso de la fila 128.                            |

---

# 7. Deduplicación y actualización

## 7.1 Cómo se reconoce un caso que ya existe

Se intenta en este orden y **se detiene en el primer acierto**:

| #   | Clave                                                                                               | Confianza         | Cuándo se usa                                         |
| --- | --------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| 1   | `core.mapa_matriz_excel.codigo_excel → codigo_caso`                                                 | Alta              | Siempre que exista la tabla y el código esté mapeado  |
| 2   | `(N° , nombre normalizado)` de una importación anterior registrada en `core.mapa_matriz_excel.nota` | Media             | Reimportación del mismo libro                         |
| 3   | `nombre_caso` normalizado **exacto**                                                                | Media             | Si no hay mapeo                                       |
| 4   | `nombre_caso` normalizado + región principal                                                        | Media-alta        | Desempate entre casos homónimos de distintas regiones |
| 5   | Similitud de nombre ≥ 0,92 (léxica) + misma región                                                  | Baja → **dudoso** | Solo se **propone**, nunca se aplica solo             |

**Lo que no se usa:**

- **`codigo_caso` (`CS-…`) escrito a mano.** La API no lo acepta: lo emite `core.siguiente_codigo_caso(subsector, tematica)` en `insertCaseRow` (`lib/db/repos/cases.ts`, ~1716-1744). Además hay códigos del Excel que **colisionan por casualidad** (`importar_matriz.py`, líneas 19-21).
- **Posición de la fila.** La numeración del Reporte no coincide con la del operativo.
- **`N°` solo.** El 15 está repetido (§3.3).

Si dos estrategias dan casos distintos → `CASO_AMBIGUO`, se detiene la fila y se pide decisión.

## 7.2 Modos de importación

| Modo                          | Qué hace si el caso existe                                         | Cuándo                                                                    |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Crear** (por defecto)       | **Rechaza** el bloque y lo lista                                   | Primera carga, o carga de casos nuevos                                    |
| **Actualizar**                | **Upsert conservador**: rellena vacíos, no pisa valores existentes | Reimportación periódica                                                   |
| **Actualizar y sobrescribir** | Pisa los campos de la lista blanca                                 | Solo con permiso `importacion.matriz.sobrescribir` y confirmación escrita |
| **Omitir**                    | No toca nada y lo informa                                          | Casos ya conciliados a mano                                               |

**Por qué conservador por defecto:** el Excel es la fuente de la OAIPCS, pero AVISA ya tiene trabajo humano (hitos cerrados, compromisos ajustados, puntos focales reasignados). Un reimport ciego borraría ese trabajo. La regla es: **el Excel rellena lo que está vacío; no borra lo que alguien escribió**.

### Política por campo en modo «Actualizar»

| Campo                                  | Si está vacío en AVISA                                        | Si tiene valor en AVISA                                           |
| -------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Título, resumen, descripción de riesgo | Se escribe                                                    | **No se pisa**; se muestra el diff                                |
| Región                                 | Se añade la que falte                                         | No se quitan regiones                                             |
| Riesgo                                 | Se escribe                                                    | No se pisa; `conflicto_riesgo`                                    |
| Nivel de conflicto                     | Se escribe                                                    | No se pisa                                                        |
| Sectorista / punto focal               | Se asigna si es nulo                                          | No se reasigna                                                    |
| Prioridad                              | Se escribe                                                    | No se pisa                                                        |
| Estado del caso                        | Se escribe solo si es `Abierto` y llega `Archivado` explícito | No se reabre un caso resuelto                                     |
| Compromisos                            | Se crean los que faltan                                       | Se reutilizan por clave de acción; **no se borran**               |
| Hitos                                  | Se crean los que faltan                                       | Se reutilizan por clave; **no se borran**                         |
| Estado de un hito                      | Se escribe                                                    | **Nunca se retrocede** de `Cumplido` a `No Cumplido` sin `forzar` |
| Fecha real                             | Se escribe si falta                                           | No se pisa                                                        |

## 7.3 Compromisos e hitos: no duplicar

- **Compromiso existente** = misma `(caso, acción normalizada)`. Si la acción cambió de redacción, se compara con similitud ≥ 0,90 y se marca `compromiso_renombrado` en el informe (no se crea otro).
- **Hito existente** = misma `(compromiso, etiqueta, descripción normalizada)`. Si la descripción cambió, se conserva la de AVISA y se informa el texto nuevo.
- **Nunca se borran** compromisos ni hitos que no vengan en el Excel: la matriz no es la verdad absoluta de lo que existe, solo de lo que se actualiza.
- Los **nudos críticos** usan `origen_ref = MATRIZ-N{fila:04d}-C{col:02d}`; el contenido literal idéntico se colapsa con motivo `repetido_identico` (misma regla que `importar_matriz.py`).

## 7.4 Actores: la cascada de `match_actores.py`

Gana la **primera** rama; los umbrales son los del script real (no se inventan):

| #   | Regla                                                                           | Resultado                           |
| --- | ------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | Siglas exactas normalizadas (token completo, sin siglas genéricas ni topónimos) | `auto` (1,0)                        |
| 2   | Nombre exacto normalizado                                                       | `auto`                              |
| 3   | Léxico ≥ 0,90 **y** embedding ≥ 0,78                                            | `auto`                              |
| 4   | Embedding ≥ 0,87 **y** sin sigla **y** (≥ 3 palabras o ≥ 24 caracteres)         | `auto`                              |
| 5   | Embedding ≥ 0,78 **o** léxico ≥ 0,72                                            | `dudoso` (revisión)                 |
| 6   | Nada                                                                            | `nuevo` (propuesta; **no se crea**) |

Reglas adicionales:

- **Una persona nunca casa con una organización, ni al revés** (máscara por tipo).
- **Siglas genéricas** (`DPA`, `OSPA`, `GORE`, `MYPE`, `SAC`, `SRL`…) no resuelven por sí solas.
- **Con `DNI` válido, el DNI manda** sobre cualquier similitud de nombre.
- El resultado `dudoso` va a una lista de revisión con el candidato y el porcentaje; el usuario decide en un clic.

## 7.5 Alertas y reuniones

- **Alertas:** la identidad es `codigo_reporte` (`RR-2026-24`, `AT-2026-02`). Si ya existe, `on conflict do nothing` (como `cargar_alertas.py`). **Hueco:** `POST /v1/alerts` no acepta un `codigo_alerta` externo, así que hoy no se puede hacer upsert por ese código (§10).
- **Código repetido en el archivo** (`AT-2026-18` en filas 36 y 77): se importa una sola vez y se avisa `ALERTA_CODIGO_DUPLICADO`. Si los contenidos difieren, se conserva el primero y el segundo va al informe como posible versión distinta.
- **Fecha ausente:** no se usa `current_date`. Se deja `NULL` y se advierte. (El cargador heredado sí usaba la fecha del día; se documenta el cambio de criterio.)
- **Reuniones:** la identidad es `(fecha, lugar, título normalizado)` porque `Código` está vacío. Las 28 filas parciales se importan con `[POR CONFIRMAR]` en tipo y sector, y **sin lugar** no se pueden deduplicar: se avisa antes de escribir.
- **Vinculación alerta ↔ caso:** no se hace por heurística en el MVP. Se importan sin caso, marcadas `requiere_vinculo_caso`, y se ofrece una sugerencia («esta alerta de Piura podría ser el caso 1») que **requiere confirmación**.

## 7.6 Duplicados dentro del mismo archivo

| Duplicado                        | Detección                                | Acción                                                                         |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Bloque repetido por número       | `N°` igual + nombre distinto             | Dos casos + `CASO_NUMERO_REPETIDO`                                             |
| Fila repetida (mismo bloque)     | Acción + hito + descripción normalizados | Se descarta como `DUPLICADO` («Fila duplicada: repite el bloque de la fila N») |
| Demanda repetida en el caso      | Descripción normalizada                  | Se descarta y se avisa                                                         |
| Actor repetido en el caso        | Nombre/DNI normalizado                   | Se asocia una vez                                                              |
| Nudo idéntico en la misma semana | Texto literal                            | Se colapsa como `repetido_identico`                                            |
| Código de alerta repetido        | `codigo_reporte`                         | Se importa uno + advertencia                                                   |
| Reunión repetida                 | Fecha + lugar + título                   | Se descarta la segunda                                                         |

## 7.7 Lo que nunca se actualiza

- **Documentos y adjuntos**: no se reemplazan ni se borran.
- **Historial y cronología**: append-only; la importación no reescribe pasado.
- **Anulaciones**: un registro anulado no se «revive» por reimportar.
- **Campos calculados**: avance, clasificación, alcance y `priorizado` se recalculan en la app, nunca se importan.
- **Usuarios y catálogos**: la importación no crea usuarios, áreas ni temáticas.

# 8. Simulación (dry-run), orden de escritura e informe

## 8.1 Dos fases, siempre

| Fase        | Endpoint                                                | Escribe           | Devuelve                                         |
| ----------- | ------------------------------------------------------- | ----------------- | ------------------------------------------------ |
| **Simular** | `POST /v1/matriz/previsualizar` (ampliado para `.xlsx`) | **No**            | El plan completo + el informe + las advertencias |
| **Aplicar** | `POST /v1/matriz/aplicar`                               | Sí, transaccional | El informe real con los identificadores creados  |

**La aplicación no vuelve a parsear el archivo.** Recibe el `plan_id` que devolvió la simulación (o el hash del archivo + la versión de reglas), de modo que lo aplicado es exactamente lo simulado. Si el archivo cambió entre simular y aplicar, se rechaza con `PLAN_DESACTUALIZADO`.

Esta es la misma filosofía del importador de escritorio: `--dry-run` es el modo por defecto, `--apply` exige `--confirmar` y abre una sola transacción (`importar_matriz.py`, líneas 13-15).

## 8.2 Qué garantiza la simulación

1. **Cero escrituras.** La conexión es de solo lectura o el endpoint no abre transacción.
2. **El mismo código.** Simular y aplicar usan la misma función `construirPlan()`. No hay dos parsers.
3. **Los rechazos son definitivos:** lo que la simulación rechaza, la aplicación también lo rechaza, con el mismo código y el mismo texto.
4. **Los identificadores nuevos no existen todavía.** La vista previa muestra «se creará» con un identificador provisional (`tmp-1`, `tmp-2`), no inventa códigos `CS-…`: el código real lo emite la base.
5. **Los emparejamientos se muestran con su confianza**: «Caso existente CS-PA-REG-2024-01, coincidencia por nombre (alta)».

## 8.3 Orden de escritura

El orden no es estético: respeta las claves foráneas y permite que un fallo se aísle.

| #   | Paso                       | Entidades                                      | Transaccionalidad          | Si falla                                                      |
| --- | -------------------------- | ---------------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| 1   | Caso                       | `core.casos`, `caso_regiones`, `caso_factores` | **T** (savepoint por caso) | Se revierte el caso entero                                    |
| 2   | Demandas                   | `core.demandas`                                | **T**                      | Se revierte el caso                                           |
| 3   | Actores (resolución)       | Lectura de `core.actores`                      | Solo lectura               | —                                                             |
| 4   | Actores (altas)            | `core.actores`                                 | **BB**                     | El caso se escribe; el actor se informa como pendiente        |
| 5   | Vinculaciones              | `core.caso_actores`                            | **T**                      | Se revierte el caso                                           |
| 6   | Compromisos                | `core.compromisos`                             | **T**                      | Se revierte el caso                                           |
| 7   | Hitos                      | `core.hitos_compromiso`                        | **T**                      | Se revierte el caso                                           |
| 8   | Nudos críticos             | `core.caso_nudo_critico`                       | **T**                      | Se revierte el caso (o se omiten nudos si el modo lo permite) |
| 9   | Alertas                    | `core.alertas_tempranas`                       | **T por alerta**           | Se revierte esa alerta, no el lote                            |
| 10  | Reuniones                  | `core.reuniones`                               | **BB**                     | Se informa; no afecta a los casos                             |
| 11  | Documentos / adjuntos      | `core.documentos`                              | **BB (fuera del MVP)**     | Se informa                                                    |
| 12  | Registro de la importación | `core.importaciones`, `importacion_filas`      | **T**                      | Sin registro no hay importación válida                        |
| 13  | Recálculos                 | avance, clasificación, contadores              | **BB, posterior**          | Se reintenta en segundo plano                                 |

**Leyenda:** **T** = dentro de la transacción del caso; **BB** = best-effort, con reintento o revisión manual.

### Dos modos de transacción

| Modo                       | Comportamiento                                                                                                  | Uso                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Por caso** (recomendado) | Una transacción global con `SAVEPOINT` por caso; si un caso falla, se revierte solo ese caso y el lote continúa | Carga normal de 30-40 casos            |
| **Todo o nada**            | Una transacción única; cualquier fallo revierte todo                                                            | Primera carga, migraciones, auditorías |

En ambos modos, **el informe es el mismo**: lo que cambia es si los casos válidos quedan escritos.

## 8.4 Guardas antes de aplicar

| Guarda                                                          | Si falla                                               |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Esquema completo (migraciones 41/42/43 presentes)               | `ESQUEMA_PENDIENTE` — 503, no se abre transacción      |
| `core.mapa_matriz_excel` poblada                                | `MAPA_VACIO` — se ofrece sembrarla o subir el mapeo    |
| Permiso `importacion.matriz.ejecutar`                           | 403 con texto claro                                    |
| `confirmar: true` explícito                                     | 400                                                    |
| Hash del archivo igual al simulado                              | `PLAN_DESACTUALIZADO`                                  |
| Ningún rechazo de severidad «Caso» sin resolver (modo estricto) | 409 con el listado                                     |
| Cuadre de filas correcto                                        | `CUADRE_INCORRECTO` — se aborta: es un bug, no un dato |

## 8.5 Idempotencia

- **`origen_dato = 'AVISA_HISTORICO'`** en todo lo que entra por aquí.
- **`origen_ref`** en nudos (`MATRIZ-N{fila:04d}-C{col:02d}`) y en filas de importación (`hash + fila + columna`).
- **Reejecutar la misma simulación dos veces** produce el mismo plan (mismo hash de salida). Si no, hay una fuente de no determinismo (orden de diccionarios, fecha de hoy) y es un bug.
- **Reaplicar el mismo plan** en modo «Actualizar» no crea duplicados: los pasos 1, 2, 6, 7 y 8 buscan por clave antes de insertar.
- **Anulación por lote:** cada importación deja un `anulacion_id`; deshacerla es anular ese lote, no borrar fila a fila.

## 8.6 El informe post-importación

Se produce en tres formatos: **pantalla**, **JSON** (para auditoría) y **Markdown descargable** (para adjuntar al correo de cierre). Los tres tienen la misma estructura.

### Estructura

| Sección                  | Contenido                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **0. Cabecera**          | Archivo, tamaño, hash SHA-256, fecha y hora, usuario, versión de las reglas, versión del mapa de casos, duración |
| **1. Resumen**           | Contadores grandes: leídas, creadas, actualizadas, omitidas, rechazadas, advertencias                            |
| **2. Por entidad**       | Casos, demandas, compromisos, hitos, nudos, actores (vinculados / propuestos), alertas, reuniones                |
| **3. Cuadre**            | `leídas = procesadas + rechazadas + omitidas + encabezado`. Si no cuadra, se muestra en rojo y no se aplica      |
| **4. Rechazos**          | Tabla por hoja y fila, con código, motivo y cómo corregir                                                        |
| **5. Advertencias**      | Agrupadas por código, con total y un ejemplo; enlace a «ver todas»                                               |
| **6. `[POR CONFIRMAR]`** | Cola de huecos: qué falta, dónde está y quién debería completarlo                                                |
| **7. Sin destino**       | Datos del Excel que no tienen dónde vivir, con el motivo                                                         |
| **8. Cambios por caso**  | Diff campo a campo de lo actualizado (solo en modo «Actualizar»)                                                 |
| **9. Trazabilidad**      | `importacion_id`, `anulacion_id`, enlaces a los casos creados                                                    |

### Ejemplo de resumen (con el libro de nov-2026)

| Métrica             | Valor                                                  |
| ------------------- | ------------------------------------------------------ |
| Filas leídas        | 130 + 105 + 50 + 46 + 408 + 4 = **743**                |
| Casos creados       | 36                                                     |
| Casos actualizados  | 0 (primera carga)                                      |
| Demandas creadas    | 23                                                     |
| Compromisos creados | 56                                                     |
| Hitos creados       | 130                                                    |
| Nudos creados       | ~250 (8 pares × 32 bloques, menos vacíos)              |
| Actores vinculados  | 0 (directorio nuevo: se proponen)                      |
| Actores propuestos  | 218 personas y las organizaciones de la columna 10     |
| Alertas creadas     | 50 (49 códigos únicos)                                 |
| Reuniones creadas   | 46                                                     |
| Rechazos            | 0 bloqueantes; 38 hitos degradados + 1 número repetido |
| Advertencias        | 8 códigos distintos                                    |

> Estas cifras son **del libro inspeccionado**, no promesas. El informe real las recalcula y debe cuadrar con ellas; si no, hay que investigar antes de aplicar.

### Ejemplo de JSON (recortado)

```json
{
  "importacion_id": "imp_2026_11_27_001",
  "archivo": {
    "nombre": "23NOV2026 MATRIZ DE CONFLICTOS SOCIALES (2) (1).xlsx",
    "sha256": "…",
    "hojas": 8
  },
  "usuario": "usuario@produce.gob.pe",
  "reglas": "matriz-2026.11.1",
  "modo": "crear",
  "cuadre": {
    "leidas": 743,
    "procesadas": 739,
    "rechazadas": 0,
    "omitidas": 4,
    "ok": true
  },
  "entidades": {
    "casos": 36,
    "demandas": 23,
    "compromisos": 56,
    "hitos": 130,
    "nudos": 251,
    "alertas": 49,
    "reuniones": 46
  },
  "rechazos": [],
  "advertencias": [
    {
      "codigo": "HITO_CUMPLIDO_SIN_FECHA_REAL",
      "total": 38,
      "ejemplo": { "hoja": "CASOS OAIPCS - OPERATIVO", "fila": 68 }
    }
  ],
  "por_confirmar": [
    {
      "campo": "numero_caso",
      "valor": "[POR CONFIRMAR: número de caso]",
      "fila": 128
    },
    {
      "campo": "fecha_real",
      "valor": "[POR CONFIRMAR: fecha real del hito]",
      "filas": 38
    }
  ]
}
```

---

# 9. Copy completo de la interfaz

Todo lo que sigue está listo para copiar y pegar. Los textos entre `{llaves}` son variables. Los números de ejemplo corresponden al libro de nov-2026.

## 9.1 Punto de entrada

En la vista **Importar**, junto a los tipos actuales (`casos`, `casos-demandas`, `actores-*`, `asistencia`), la tarjeta de la matriz deja de ser `delegar` y pasa a abrir el asistente.

> **Matriz de conflictos (Excel)**
> Importe los casos, compromisos, hitos, alertas y reuniones de la matriz de la OAIPCS sin digitar uno por uno. Revise todo antes de aplicar: nada se guarda hasta que usted lo confirme.
> `Abrir asistente` · `[Nuevo]`

Si el usuario no tiene permiso de lectura de importación:

> No tiene permiso para importar la matriz. Pida acceso a la Dirección de la OAIPCS.

## 9.2 Cabecera del asistente

> **Importar matriz de conflictos**
> Cinco minutos de revisión para ahorrar horas de digitación. Nada se escribe en la base hasta el último paso.

Pasos del asistente:

| #   | Etiqueta  | Estado completado           |
| --- | --------- | --------------------------- |
| 1   | Archivo   | «Libro cargado»             |
| 2   | Hojas     | «8 hojas detectadas»        |
| 3   | Columnas  | «25 de 25 reconocidas»      |
| 4   | Revisión  | «36 casos listos»           |
| 5   | Confirmar | «Pendiente de confirmación» |
| 6   | Resultado | «Importación terminada»     |

Botones persistentes: `Cancelar` · `Atrás` · `Continuar` · `Cerrar`.

## 9.3 Paso 1 — Archivo

**Título:** «Paso 1 de 6 · Suba la matriz»

**Ayuda:**

> Suba el mismo archivo de Excel que usa el equipo de la OAIPCS. Se aceptan libros `.xlsx` y `.xlsm` de hasta 5 MB.
> No modifique el archivo antes de subirlo: si falta una hoja o cambió un encabezado, se lo diremos en el paso siguiente.

**Zona de carga:**

> Arrastre el archivo aquí o `Seleccionar archivo`
> Formato: Excel (.xlsx, .xlsm) · Máximo 5 MB

**Al seleccionar:**

> Leyendo «{archivo}»… Esto puede tardar unos segundos si el libro tiene muchas hojas.

**Errores:**

| Situación                       | Texto                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Extensión no soportada          | «Solo se aceptan libros de Excel (.xlsx). Si su archivo es un CSV, use el importador de casos.»  |
| Archivo muy grande              | «El archivo pesa {tamaño} y el límite es 5 MB. Divídalo por año o elimine las hojas que no use.» |
| Archivo dañado o con contraseña | «No podemos abrir el archivo. Si tiene contraseña, quítela y vuelva a intentarlo.»               |
| Sin conexión                    | «Se perdió la conexión. El archivo no se envió; vuelva a intentarlo.»                            |

## 9.4 Paso 2 — Hojas detectadas

**Título:** «Paso 2 de 6 · Esto es lo que encontramos»

**Ayuda:**

> Leímos el libro y reconocimos estas hojas. Marque las que quiere importar. La hoja de casos es obligatoria; las demás son opcionales.

**Tabla:**

| Hoja                     | Qué se importará                             | Filas      | Estado            |
| ------------------------ | -------------------------------------------- | ---------- | ----------------- |
| CASOS OAIPCS - OPERATIVO | Casos, compromisos e hitos                   | 130        | `Obligatoria`     |
| METADATOS CASOS          | Código y prioridad de cada caso              | 31 códigos | `Se usa siempre`  |
| Reporte de avance        | Alcance, nivel de conflicto y nudos críticos | 105        | `Recomendada`     |
| Seguimiento de Alertas   | Alertas y reportes rápidos                   | 50         | `Opcional`        |
| Seguimiento de Reuniones | Reuniones con actores                        | 46         | `Opcional`        |
| DVPA                     | Directorio de actores                        | 408        | `Opcional`        |
| DVMYPE-I                 | Actores MYPE                                 | 4          | `Sin datos`       |
| Maestros                 | —                                            | 88         | `Solo referencia` |

**Textos por estado:**

> **DVMYPE-I no trae datos reales todavía.** Sus 4 filas son plantillas con «(Representante por registrar)». Si la marca, no se importará ningún actor y se lo diremos en el resultado.

> **Maestros no se importa.** Es la lista de referencia de la propia matriz: la usamos para traducir valores, no para crear catálogos.

**Si falta la hoja principal:**

> Este archivo no contiene la hoja «CASOS OAIPCS - OPERATIVO». ¿Seguro que es la matriz de conflictos? Si la hoja cambió de nombre, renómbrela en Excel y vuelva a subir el archivo.

**Botones:** `Volver a subir` · `Continuar`.

## 9.5 Paso 3 — Columnas

**Título:** «Paso 3 de 6 · Revisemos las columnas»

**Ayuda:**

> Emparejamos automáticamente cada columna del Excel con un campo del sistema. Revise las que están en amarillo: son las que no pudimos reconocer con certeza.

**Resumen:**

> 21 columnas reconocidas automáticamente · 3 para revisar · 1 no se usará

**Tabla:**

| Columna del Excel | Se guardará en         | Confianza | Acción        |
| ----------------- | ---------------------- | --------- | ------------- |
| N°                | Número del caso        | Alta      | `Cambiar`     |
| Región            | Región del caso        | Alta      | `Cambiar`     |
| …                 | …                      | …         | …             |
| Temática          | Temática de la demanda | **Media** | `Revisar`     |
| Status            | — (columna vacía)      | —         | `No se usará` |

**Textos de ayuda por columna (ejemplos):**

> **Temática.** La matriz usa «Ordenanamiento y acceso territorial»; el sistema guarda «Ordenamiento y acceso territorial». Corregimos la errata automáticamente.

> **Riesgo.** Solo se aceptan Bajo, Medio o Alto. El valor «Archivado» no es un nivel de riesgo: el caso se marcará como archivado.

> **Estado Actual.** Si un hito dice «Cumplido» pero no trae fecha real, lo importaremos como «Registrado». Puede cambiar esta regla en Opciones avanzadas.

> **Status.** Esta columna está vacía en las 130 filas. No se usará.

**Si una columna obligatoria no aparece:**

> No encontramos la columna «Nombre de Caso». Sin ella no se pueden crear los casos. ¿Cambió el encabezado en Excel?

**Opciones avanzadas (plegadas):**

> - **Exigir fecha real en hitos cumplidos**: si se activa, los 38 hitos sin fecha se rechazan en lugar de degradarse.
> - **Modo de actualización**: crear solo casos nuevos (por defecto) · actualizar sin sobrescribir · actualizar y sobrescribir.
> - **Importar alertas sin caso**: activado (recomendado).

**Botones:** `Restablecer mapeo automático` · `Atrás` · `Simular importación`.

## 9.6 Paso 4 — Revisión y simulación

**Título:** «Paso 4 de 6 · Esto es lo que se va a importar»

**Ayuda:**

> Esta es una simulación: **no se ha guardado nada**. Revise los números, abra los rechazos y las advertencias, y corrija el Excel si algo no cuadra. Puede volver a subir el archivo las veces que necesite.

**Aviso de simulación (persistente, banda superior):**

> **Simulación.** No se ha modificado la base de datos. Los cambios se aplican en el paso 5.

**Tarjetas de resumen:**

| Tarjeta      | Texto                               |
| ------------ | ----------------------------------- |
| Casos        | **36** · «36 nuevos»                |
| Demandas     | **23**                              |
| Compromisos  | **56**                              |
| Hitos        | **130** · «38 sin fecha real»       |
| Alertas      | **50** · «todas sin caso vinculado» |
| Reuniones    | **46** · «28 incompletas»           |
| Rechazos     | **0** bloqueantes                   |
| Advertencias | **8** tipos                         |

**Pestañas:** `Casos` · `Demandas` · `Compromisos` · `Hitos` · `Nudos` · `Alertas` · `Reuniones` · `Actores` · `Rechazos` · `Advertencias` · `Por confirmar` · `Sin destino`.

**Filtros:** `Buscar por caso o texto` · `Solo con advertencias` · `Solo rechazados`.

**Fila de la tabla (ejemplo):**

> **1 · Conflicto intergremial por el uso de redes de enmalle de fondo…**
> Piura · Riesgo Medio · 13 filas · 5 compromisos · 15 hitos · 7 demandas
> `Ver detalle` · `Ver en Excel (fila 3)`

**Detalle de un caso:** muestra la cabecera, la lista de compromisos con sus hitos y, al lado de cada valor, la traducción aplicada:

> Excel: «Bajo (inicial y sin protestas)» → Nivel de conflicto: **Diferencia**
> Excel: «Cumplido» sin fecha → Estado: **Registrado** · `[POR CONFIRMAR: fecha real del hito]`

**Estado vacío de una pestaña:**

> No hay nudos críticos en este archivo. La hoja «Reporte de avance» no los trae o están vacíos.

**Estado de error de simulación:**

> No pudimos terminar la simulación. El archivo se leyó, pero falló el emparejamiento de casos. Detalle técnico: `{mensaje}`. `Reintentar` · `Descargar registro`.

**Botones:** `Descargar informe de simulación` · `Volver a subir` · `Atrás` · `Continuar`.

## 9.7 Paso 5 — Confirmación

**Título:** «Paso 5 de 6 · Confirme la importación»

**Ayuda:**

> Al confirmar, se escribirán **36 casos, 23 demandas, 56 compromisos y 130 hitos** en la base. Esta acción queda registrada con su usuario y la hora.

**Resumen antes de confirmar:**

| Concepto                             | Valor             |
| ------------------------------------ | ----------------- |
| Casos                                | 36                |
| Casos existentes que se actualizarán | 0 (primera carga) |
| Rechazos que se omitirán             | 0                 |
| Hitos que quedarán como «Registrado» | 38                |
| Alertas sin caso                     | 50                |

**Casillas obligatorias:**

> ☐ He revisado la simulación y entiendo que se crearán 36 casos.
> ☐ Entiendo que 38 hitos marcados como «Cumplido» quedarán como «Registrado» porque no traen fecha real.
> ☐ Entiendo que las 50 alertas se importarán sin caso y habrá que vincularlas después.

**Confirmación reforzada (solo si hay más de 100 registros o modo «sobrescribir»):**

> Para confirmar, escriba **IMPORTAR** en el campo.

**Aviso de concurrencia:**

> Otra persona importó esta matriz hace {tiempo}. Revise si su archivo es más reciente antes de continuar.

**Textos de progreso:**

> Importando casos… 12 de 36
> Importando hitos… 84 de 130
> Guardando el informe…

**Errores durante la aplicación:**

| Situación                     | Texto                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Falla un caso                 | «El caso «{nombre}» no se pudo guardar: {motivo}. Los demás casos se guardaron correctamente.»                                                   |
| Falla todo (modo todo o nada) | «No se guardó nada. La base quedó como estaba. Motivo: {motivo}. `Descargar registro`»                                                           |
| Se perdió la conexión         | «Se perdió la conexión durante la importación. No sabemos si terminó. **No vuelva a importar todavía**: consulte el historial de importaciones.» |
| Permiso retirado              | «Su sesión ya no tiene permiso para aplicar importaciones. La simulación sigue disponible.»                                                      |
| Plan desactualizado           | «El archivo o el mapeo cambiaron desde la simulación. Vuelva al paso 4 y simule de nuevo.»                                                       |

**Botones:** `Atrás` · `Importar {n} registros` · `Cancelar`.

## 9.8 Paso 6 — Resultado

**Título:** «Paso 6 de 6 · Importación terminada»

**Éxito total:**

> **Listo.** Se importaron 36 casos, 23 demandas, 56 compromisos y 130 hitos. No hubo rechazos.
> Quedan 38 hitos sin fecha real y 50 alertas sin caso vinculado: están en la lista de pendientes.

**Éxito parcial:**

> **Importación completada con pendientes.** Se guardaron 35 de 36 casos. Un caso no se pudo importar: «{nombre}». Los demás quedaron guardados.

**Nada importado:**

> **No se importó ningún registro.** Todos los casos tenían errores bloqueantes. Revise la lista de rechazos y vuelva a intentarlo.

**Tarjetas:** `Casos creados` · `Casos actualizados` · `Rechazados` · `Advertencias` · `Pendientes`.

**Acciones del resultado:**

> `Descargar informe (Markdown)` · `Descargar informe (JSON)` · `Ver casos importados` · `Revisar pendientes` · `Importar otro archivo`

**Texto de cierre:**

> Guarde el informe: es el comprobante de lo que se importó y de lo que quedó pendiente.

## 9.9 Mensajes globales

| Elemento                              | Texto                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Cerrar el asistente con trabajo hecho | «Si cierra ahora, se perderá la simulación. No se ha guardado nada. ¿Cerrar de todos modos?» `Seguir revisando` · `Cerrar` |
| Sesión expirada                       | «Su sesión expiró. Vuelva a iniciar sesión; la simulación se conserva durante 24 horas.»                                   |
| Sin permiso de escritura              | «Puede simular, pero no aplicar. Solicite el permiso «Aplicar importaciones de matriz».»                                   |
| Error inesperado                      | «Algo falló de nuestro lado. No se guardó nada. `Reintentar` · `Descargar registro`»                                       |
| Importación en curso (bloqueo)        | «Ya hay una importación de matriz en curso por {usuario}. Espere a que termine para evitar conflictos.»                    |
| Aviso de libro desactualizado         | «Este libro es del {fecha}. La matriz se actualiza cada semana: ¿seguro que es la versión vigente?»                        |

## 9.10 Cómo se ven los errores (patrón común)

Todo error visible tiene **título, causa y salida**:

> **{Título corto}**
> {Qué pasó, en una frase, sin jerga.}
> {Qué puede hacer ahora: corregir una celda, cambiar una opción o pedir ayuda.}

| Código                         | Título visible           | Cuerpo                                                                                                                                                   |
| ------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REGION_DESCONOCIDA`           | Región no reconocida     | «La región «{valor}» no está en el catálogo. Corrija la celda B{fila} o escriba el nombre oficial.»                                                      |
| `HITO_CUMPLIDO_SIN_FECHA_REAL` | Hito cumplido sin fecha  | «38 hitos están marcados como cumplidos pero no traen fecha real. Se importarán como «Registrado». Si prefiere rechazarlos, active «Exigir fecha real».» |
| `CASO_NUMERO_REPETIDO`         | Número de caso repetido  | «El número 15 aparece en dos casos distintos. Se importará el primero; el segundo quedará pendiente hasta que le asigne un número libre en el Excel.»    |
| `TEMATICA_REQUERIDA`           | Demanda sin temática     | «Una demanda no tiene temática y la base no permite crearla sin ella. Asígnela en la columna L.»                                                         |
| `ALERTA_SIN_CASO`              | Alertas sin caso         | «Ninguna de las 50 alertas trae código de caso. Se importarán y quedarán en «Por vincular».»                                                             |
| `ARCHIVO_MUY_GRANDE`           | Archivo demasiado grande | «El límite es 5 MB. Divida el libro por año.»                                                                                                            |
| `ESQUEMA_PENDIENTE`            | El sistema no está listo | «Falta aplicar una actualización de la base para importar la matriz. Avisa al equipo técnico; no es un problema de su archivo.»                          |
| `PLAN_DESACTUALIZADO`          | La simulación caducó     | «El archivo o el mapeo cambiaron desde que simuló. Vuelva a simular.»                                                                                    |

## 9.11 Avisos `[POR CONFIRMAR: …]`

Se escriben **literalmente** en el campo cuando no hay dato, y se listan en el informe. Textos exactos:

| Campo                  | Texto exacto                                  |
| ---------------------- | --------------------------------------------- |
| Número de caso         | `[POR CONFIRMAR: número de caso]`             |
| Fecha real de un hito  | `[POR CONFIRMAR: fecha real del hito]`        |
| Fecha planificada      | `[POR CONFIRMAR: fecha planificada del hito]` |
| Tipo de reunión        | `[POR CONFIRMAR: tipo de reunión]`            |
| Sector de reunión      | `[POR CONFIRMAR: sector de la reunión]`       |
| Lugar de reunión       | `[POR CONFIRMAR: lugar de la reunión]`        |
| Rol en conflicto       | `[POR CONFIRMAR: rol en conflicto]`           |
| Temática               | `[POR CONFIRMAR: temática]`                   |
| Focal de monitoreo     | `[POR CONFIRMAR: punto focal de monitoreo]`   |
| Vinculación de alerta  | `[POR CONFIRMAR: caso de la alerta]`          |
| Organización del actor | `[POR CONFIRMAR: organización del actor]`     |

**Cómo se muestran en pantalla:** en ámbar, no en rojo: no es un error, es un hueco declarado. Al pasar el cursor:

> Este dato no venía en el Excel. Se importó con una marca para que alguien lo complete después; no se inventó un valor.

## 9.12 Accesibilidad y microcopy de apoyo

- Todo campo tiene etiqueta visible; los iconos llevan `aria-label`.
- Los mensajes de error se anuncian con `role="alert"` y no roban el foco.
- La tabla de rechazos se puede recorrer con teclado y enlace directo a la fila del Excel (`Ver en Excel (fila N)`).
- Los colores de estado nunca son el único indicador: siempre hay texto (`Rechazado`, `Advertencia`, `Pendiente`).
- El botón de aplicar dice **cuánto** va a aplicar («Importar 209 registros»), no solo «Aceptar».
- Ningún mensaje culpa al usuario: «No encontramos…», «Necesitamos…», nunca «Ha introducido mal…».

## 9.13 Resumen de botones

| Botón                             | Dónde                  | Qué hace                              |
| --------------------------------- | ---------------------- | ------------------------------------- |
| `Abrir asistente`                 | Tarjeta de importación | Abre el paso 1                        |
| `Seleccionar archivo`             | Paso 1                 | Abre el selector                      |
| `Volver a subir`                  | Pasos 2-4              | Reinicia la carga                     |
| `Continuar`                       | Pasos 1-4              | Avanza                                |
| `Atrás`                           | Pasos 2-5              | Retrocede sin perder la simulación    |
| `Restablecer mapeo automático`    | Paso 3                 | Descarta cambios manuales de columnas |
| `Simular importación`             | Paso 3                 | Ejecuta el dry-run                    |
| `Descargar informe de simulación` | Paso 4                 | Markdown/JSON del plan                |
| `Importar {n} registros`          | Paso 5                 | Aplica, con confirmación              |
| `Descargar informe`               | Paso 6                 | Comprobante final                     |
| `Ver casos importados`            | Paso 6                 | Va al listado filtrado por lote       |
| `Revisar pendientes`              | Paso 6                 | Va a la cola `[POR CONFIRMAR]`        |
| `Cancelar` / `Cerrar`             | Todos                  | Pide confirmación si hay trabajo      |

# 10. Cambios técnicos necesarios

## 10.1 Estado actual, hueco y esfuerzo

Complejidad: **S** ≤ 3 días · **M** ≤ 2 semanas · **L** > 2 semanas (una persona).

| #   | Capacidad                        | Cómo está hoy                                                                                                                                                    | Qué falta                                                                                           | Complejidad | Riesgo                                                       |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------ |
| T1  | Leer `.xlsx`                     | El importador Angular es **solo CSV/TSV**: `importacion.csv.ts` y `esExcelBinario()` rechazan `.xlsx` con `MENSAJE_EXCEL`                                        | Subir el binario al servidor y parsearlo allí (recomendado) **o** SheetJS en el navegador           | **L**       | Duplicar el parser si se hace en cliente                     |
| T2  | Endpoint de simulación de matriz | `POST /v1/matriz/previsualizar` ya existe, pero recibe `{csv: string}` y un formato A..W de 23 columnas (`matriz/csv.ts`) que **no coincide** con el Excel de 25 | Aceptar `.xlsx`, detectar hojas, mapear por encabezado, devolver plan + informe                     | **M**       | El formato antiguo sigue vivo: hay que versionar el contrato |
| T3  | Motor de reglas en servidor      | Solo existe en Python (`parse_matriz.py`, `parser_matriz.py`, `matriz_hojas_aux.py`, `match_actores.py`)                                                         | Portar a TS **o** exponer el motor Python como servicio interno                                     | **L**       | Dos implementaciones divergentes                             |
| T4  | Pruebas doradas                  | No hay                                                                                                                                                           | Guardar los JSON de `scripts/matriz/salida/` como _golden files_ y comparar el plan TS contra ellos | **M**       | Sin esto, T3 no es verificable                               |
| T5  | Aplicación transaccional         | No existe para matriz; `importar_matriz.py --apply` es de escritorio                                                                                             | `POST /v1/matriz/aplicar` con transacción, savepoints y `confirmar`                                 | **L**       | Escritura parcial si no hay savepoints                       |
| T6  | Mapa de casos                    | `core.mapa_matriz_excel` existe como migración **propuesta**; `GET /v1/matriz/mapeo` ya lo lista                                                                 | Aplicar la migración y sembrarla; endpoint para corregir equivalencias                              | **M**       | Sin mapa, todo cae a «crear» y se duplica                    |
| T7  | Upsert por código de caso        | La API **no** permite fijar `codigo_caso`; lo emite la base                                                                                                      | No hace falta cambiarlo: el plan resuelve el `caso_id` por el mapa                                  | **S**       | Bajo                                                         |
| T8  | Código externo de alerta         | `POST /v1/alerts` emite su propio código; no acepta `RR-…`                                                                                                       | Añadir `origen_codigo` + índice único, y aceptarlo en el alta                                       | **M**       | Reimportar duplicaría alertas                                |
| T9  | Reuniones                        | Existe la tabla y migración 42 (propuesta); no se verificó endpoint de alta                                                                                      | Verificar y, si falta, crear `POST /v1/reuniones`                                                   | **M**       | Bloquea la hoja de reuniones, no el MVP de casos             |
| T10 | Nudos críticos                   | `core.caso_nudo_critico` (migración 43, propuesta) con `descripcion` nullable                                                                                    | Aplicar migración; endpoint de alta por lote                                                        | **S/M**     | Sin CHECK, nudos vacíos                                      |
| T11 | Actores: propuesta               | `POST /v1/actors` crea; no hay endpoint de emparejamiento                                                                                                        | Exponer la cascada de `match_actores.py` en modo propuesta                                          | **M**       | Crear duplicados de actores                                  |
| T12 | Equivalencias                    | No existe tabla                                                                                                                                                  | `core.equivalencias_matriz` versionada + pantalla de revisión                                       | **S**       | Valores nuevos sin gobierno                                  |
| T13 | Auditoría de importación         | No existe                                                                                                                                                        | `core.importaciones` + `importacion_filas` con hash y `anulacion_id`                                | **M**       | Sin comprobante ni deshacer                                  |
| T14 | Permisos                         | RLS y roles existen; no hay permiso específico                                                                                                                   | `importacion.matriz.simular` y `importacion.matriz.ejecutar`                                        | **S**       | Cualquiera podría escribir 200 registros                     |
| T15 | Componente de asistente          | El panel actual es un drawer de CSV                                                                                                                              | Stepper, tablas de vista previa, diff y descarga de informe                                         | **M**       | Payload grande en pantalla                                   |
| T16 | Documentos y adjuntos            | `core.documentos` exige título y tipo                                                                                                                            | Diseño aparte (fuera de alcance)                                                                    | **L**       | No bloquea                                                   |
| T17 | Política de fecha real           | La API ya rechaza `Cumplido` sin fecha (422)                                                                                                                     | Interruptor «exigir/degradar» en el plan                                                            | **S**       | 38 hitos en riesgo                                           |

## 10.2 El hueco que no se puede rodear

**No existe upsert por `codigo_caso` ni por `codigo_alerta`.** Cualquier diseño que dependa de reimportar «por código» falla:

- El código del caso lo emite `core.siguiente_codigo_caso(subsector, tematica)` dentro de `insertCaseRow` (`lib/db/repos/cases.ts`, ~1716-1744). No es un campo de entrada.
- El código de la alerta lo emite la API de alertas.

**Consecuencia:** la identidad tiene que venir del **mapa** (`core.mapa_matriz_excel`) y, para alertas, de una columna nueva `origen_codigo`. Es el cambio de mayor retorno y menor esfuerzo de todo el proyecto (T6 + T8).

## 10.3 Riesgos técnicos y de producto

| Riesgo                                                               | Probabilidad  | Impacto | Mitigación                                                          |
| -------------------------------------------------------------------- | ------------- | ------- | ------------------------------------------------------------------- |
| Duplicar casos en la primera carga                                   | Alta sin mapa | Alto    | Simulación obligatoria + mapa sembrado + «crear» rechaza existentes |
| Perder trabajo humano al reimportar                                  | Media         | Alto    | Upsert conservador por defecto (D3)                                 |
| Divergencia Python ↔ TS                                              | Alta          | Alto    | Golden files y un solo contrato de plan                             |
| 38 hitos degradados se perciben como pérdida                         | Alta          | Medio   | Copia explícita en el paso 5 + `[POR CONFIRMAR]`                    |
| Fechas serial mal convertidas                                        | Media         | Medio   | Tests con los 96 seriales reales de `METADATOS`                     |
| Un libro con columnas movidas rompe el mapeo                         | Media         | Medio   | Mapeo por encabezado + paso 3 de revisión humana                    |
| Bloqueo por RLS al escribir en lote                                  | Baja          | Alto    | Probar con el rol real, no con `neondb_owner`                       |
| El usuario aplica sin leer                                           | Media         | Alto    | Casillas obligatorias + botón con el número exacto                  |
| Maestros se «arregla» en el Excel y se espera que el sistema lo siga | Alta          | Bajo    | El paso 2 dice «solo referencia»                                    |

## 10.4 Lo que **no** hay que hacer

- No reutilizar `COLUMNAS_MATRIZ` de `app/api/v1/matriz/csv.ts`: es otro formato (A..W, 23 columnas, con `Prioridad de Atención` en D y `Nombre de Caso` en E). El Excel actual tiene `Nombre de Caso` en D y 25 columnas.
- No ampliar `LIMITE_FILAS` de 400 al importador genérico para «que pase la matriz»: son flujos distintos.
- No añadir `.xlsx` al importador CSV sin separar la ruta: rompería los mensajes y la validación por fila.
- No ejecutar migraciones desde la aplicación. Las migraciones 41/42/43 y las nuevas (`mapa`, `equivalencias`, `importaciones`) se aplican a mano, con revisión.

---

# 11. Plan de entrega por fases

## Fase 0 — Contrato y verdad de referencia

**Qué se entrega:** este documento, el contrato del `plan` (JSON) y los _golden files_ extraídos del libro real.

**Criterios de aceptación:**

1. El plan de referencia declara **36 casos, 56 compromisos, 130 hitos, 23 demandas, 49 alertas, 46 reuniones** y cuadra 743 filas leídas.
2. Los 37 bloques están identificados: 36 importables, 1 en conflicto (fila 128), el `N° 15` repetido y los 3 bloques sin número.
3. Cada rechazo y advertencia de este documento tiene código y texto aprobado por producto.
4. El documento está revisado por OAIPCS (vocabulario y copy).

## Fase 1 — MVP: simulación en la app, sin escritura

**Qué se entrega:** tarjeta en Importar, asistente de 6 pasos, carga `.xlsx`, detección de hojas, mapeo por encabezado, plan y informe descargable. **Cero escrituras.**

**Criterios de aceptación:**

1. Con el libro de nov-2026, la simulación muestra los 36 casos y el cuadre correcto.
2. Con un libro sin la hoja principal, muestra `HOJA_NO_ENCONTRADA` y no avanza.
3. Con un `.csv`, ofrece el importador de casos (no el asistente).
4. El 100 % de las 38 advertencias de fecha real se agrupan en **una** tarjeta.
5. Se puede descargar el informe en Markdown y JSON con el mismo contenido que la pantalla.
6. **Verificación de no escritura:** contar filas antes y después de simular; deben ser idénticas.
7. Tiempo de simulación < 30 s para 743 filas.
8. El asistente es usable con teclado y sin depender del color.

**Fuera de alcance:** aplicar, alertas, reuniones, actores, documentos.

## Fase 2 — Aplicación de casos

**Qué se entrega:** `POST /v1/matriz/aplicar` con transacción por caso, alta de casos, demandas, compromisos, hitos y nudos. Modos crear/actualizar. Registro de importación.

**Criterios de aceptación:**

1. Primera aplicación: 36 casos, 23 demandas, 56 compromisos, 130 hitos, y el informe real coincide con el simulado.
2. Reaplicar el mismo archivo en modo «Actualizar»: **0 casos nuevos, 0 compromisos nuevos, 0 hitos nuevos**.
3. Un caso con error forzado revierte solo ese caso; los demás quedan escritos y el informe lo dice.
4. Modo «todo o nada» con un error: la base queda exactamente como estaba (verificado por conteo y por hash de una muestra).
5. Los 38 hitos degradados quedan en `Registrado` con `fecha_real_texto = [POR CONFIRMAR: fecha real del hito]`.
6. El modo «exigir fecha real» rechaza esos 38 y no escribe ninguno de sus casos en modo estricto.
7. Todo lo escrito lleva `origen_dato = AVISA_HISTORICO` y un `importacion_id` consultable.
8. Deshacer el lote por `anulacion_id` devuelve los conteos al estado anterior.

## Fase 3 — Hojas auxiliares

**Qué se entrega:** alertas (con `origen_codigo`), reuniones, DVPA con propuesta de actores y nudos del Reporte.

**Criterios de aceptación:**

1. 49 alertas creadas (una por código único), **0 vinculadas a caso**, todas en «Por vincular».
2. Reimportar no duplica alertas ni reuniones.
3. 46 reuniones; las 28 incompletas con `[POR CONFIRMAR]` en tipo y sector.
4. Actores: **0 creados automáticamente**; todas las coincidencias y altas quedan como propuestas con su nivel de confianza.
5. Los nudos se crean con `origen_ref` y los idénticos se colapsan.
6. `DVMYPE-I` produce 0 actores y el mensaje «no trae datos reales».

## Fase 4 — Operación continua

**Qué se entrega:** reimportación semanal, vinculación asistida de alertas, deduplicación de actores, gobierno de equivalencias, documentos.

**Criterios de aceptación:**

1. Un reimport semanal se completa en < 2 minutos y produce un diff legible por caso.
2. La cola `[POR CONFIRMAR]` baja de 38 a 0 con trabajo humano trazable.
3. Ninguna equivalencia nueva se crea sin `revisado_por`.
4. Las alertas se vinculan con sugerencia + confirmación, nunca solas.
5. El informe de la semana anterior se puede comparar con el actual.

## 11.1 Backlog de decisiones pendientes

| #   | Decisión                                                 | Quién             | Bloquea |
| --- | -------------------------------------------------------- | ----------------- | ------- |
| P0  | Asignar número al bloque de la fila 128 (tiburón)        | OAIPCS            | Fase 1  |
| P1  | Aprobar el copy de los 11 pasos                          | Producto + OAIPCS | Fase 1  |
| P2  | Fecha real: degradar o rechazar por defecto              | OAIPCS            | Fase 2  |
| P3  | Modo por defecto: crear o actualizar                     | Producto          | Fase 2  |
| P4  | ¿Se importan alertas sin caso?                           | OAIPCS            | Fase 3  |
| P5  | ¿Quién revisa la cola `[POR CONFIRMAR]`?                 | Dirección OAIPCS  | Fase 4  |
| P6  | ¿Se expone el motor Python o se porta a TS?              | Arquitectura      | Fase 1  |
| P7  | Catálogo de temáticas: ¿se alinean los dos vocabularios? | OAIPCS + datos    | Fase 4  |
| P8  | ¿Se guardan documentos y adjuntos?                       | Producto          | Fase 4  |

---

# Apéndice A — Cifras medidas del libro

| Medida                                    | Valor                                   |
| ----------------------------------------- | --------------------------------------- |
| Hojas                                     | 8                                       |
| Hoja operativa: filas con dato            | 130                                     |
| Hoja operativa: bloques                   | 37                                      |
| Hoja operativa: `N°` distintos            | 33 (falta el 32; el 15 está repetido)   |
| Filas sin `N°`                            | 6 (118-121, 127, 132)                   |
| Rangos combinados en la hoja operativa    | 405                                     |
| Hitos `Cumplido`                          | 64                                      |
| Hitos `Cumplido` sin fecha real           | **38**                                  |
| Hitos `No Cumplido` / `No cumplido`       | 45 / 2                                  |
| Hitos `Desestimado`                       | 1                                       |
| Filas con `Status`                        | **0**                                   |
| Compromisos (acciones distintas)          | 56                                      |
| Demandas distintas                        | 23                                      |
| `Riesgo`: Medio / Bajo / Alto / Archivado | 73 / 28 / 24 / 5                        |
| `METADATOS`: códigos únicos               | 31                                      |
| `METADATOS`: fechas seriales (no `Date`)  | 96 de 113                               |
| Reporte: `#REF!` en columna 21            | **85 de 105**                           |
| Alertas                                   | 50 filas, 49 códigos                    |
| Alertas con código de caso                | **0**                                   |
| Reuniones                                 | 46 (18 completas, 28 parciales)         |
| Reuniones con `Código`                    | **0**                                   |
| DVPA: filas con nombre / con DNI          | 218 / **14**                            |
| DVMYPE-I: filas reales                    | **0** (4 plantillas)                    |
| `Maestros`: catálogos en columnas         | 5 (C, E, G, I, K) + 2 tablas auxiliares |
| Bloques en conflicto                      | 1 (fila 128, número 15 repetido)        |

# Apéndice B — Inventario de valores para pruebas

**Región (20 valores):** Lima Metropolitana · Piura · Lima Provincias · Arequipa · (lista de 11 regiones con `/`) · Callao · Loreto · Lambayeque · Lima · Ancash · Ica · Moquegua · «Ica y Arequipa» · Nacional · Tumbes · «Piura - Lambayeque» · Junín.

**Temática:** vacío (114) · Ordenanamiento y acceso territorial (7) · Gobernanza (5) · Normatividad (4).

**Estado Actual:** Cumplido (64) · No Cumplido (45) · vacío (18) · No cumplido (2) · Desestimado (1).

**Hito:** Hito 1 (44) · Hito 2 (27) · Hito 3 (23) · vacío (19) · Hito 4 (11) · Hito 5 (5) · Hito 6 (1).

**Nivel de Riesgo Inicial:** Intermedio (67) · Bajo (25) · Inminente (7) · Crítico (3) · vacío (3).

**Validación de Hito:** Validado (86) · Plan pendiente de aprobación (6) · vacío (4) · Validación Pendiente (3) · Pendiente validacion (3) · Por Validar (2) · Validad (1).

**Alcance:** Centro (38) · Norte (24) · Nacional (21) · Sur (14) · Oriente (7) · Regional (1).

**Tipo de alerta:** REPORTE RAPIDO (30) · ALERTA TEMPRANA (16) · CLIMA SOCIAL (3) · PLAN DE ACCIÓN RÁPIDA (1).

**Tipo de Alerta:** vacío (34) · PREVENTIVA (11) · REACTIVA (5).

**Perfil de incidencia (DVPA):** vacío (384) · DIALOGANTE (10) · DISRUPTIVO (9) · LEGITIMANTE (4) · SIN INFORMACIÓN (1).

**Postura (DVPA):** 12 variantes libres: Confrontacional · Colaborativa · Alineada con mayoría · Colaborativa con demandas · Sin datos · Crítica-Colaborativa · Colaborativa estratégica · Confrontacional-Legal · Colaborativa con presión · Confrontacional-Académica · Moderada-Crítica.

# Apéndice C — Trazabilidad de fuentes

| Qué se cita                                                                        | Dónde                                                                                              |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Reglas de agrupación, anomalías, `partir_actores`, `norm`, `como_fecha`            | `scripts/matriz/parser_matriz.py`                                                                  |
| Expansión de combinadas, `ERRORES_EXCEL`, `fecha_desde_celda`, booleanos, nudos    | `scripts/matriz/matriz_hojas_aux.py`                                                               |
| Anomalías declaradas y salida canónica                                             | `scripts/matriz/parse_matriz.py`                                                                   |
| Dry-run por defecto, `--apply --confirmar`, transacción única, notas A1-A5 y B1-B6 | `scripts/matriz/importar_matriz.py` (líneas 1-91)                                                  |
| Estados de hito 1..6, riesgo 1..3                                                  | `scripts/matriz/cargar_matriz.py`                                                                  |
| Umbrales y cascada de actores                                                      | `scripts/matriz/match_actores.py`                                                                  |
| `on conflict do nothing`, región normalizada, fecha por defecto                    | `scripts/matriz/cargar_alertas.py`                                                                 |
| Catálogo de importaciones y estrategias `api` / `padron` / `delegar`               | `angular/src/app/features/importacion/importacion.tipos.ts`                                        |
| CSV, delimitadores, `esExcelBinario`, `MENSAJE_EXCEL`                              | `angular/src/app/features/importacion/importacion.csv.ts`                                          |
| Validaciones y textos ◆                                                            | `angular/src/app/features/importacion/importacion.validar.ts`                                      |
| Ejecución en serie y mensajes de error parcial                                     | `angular/src/app/features/importacion/importacion.service.ts`                                      |
| Alta de caso y emisión del código                                                  | `app/api/v1/cases/route.ts`, `lib/db/repos/cases.ts` (`createCase`, `insertCaseRow`, `createHito`) |
| Alta de demanda, compromiso, hito y alerta                                         | `lib/db/repos/cases.ts` (`createDemanda`, `createCommitment`, `createHito`, `createAlert`)         |
| Simulación existente y códigos de rechazo                                          | `app/api/v1/matriz/previsualizar/route.ts`, `app/api/v1/matriz/plan.ts`                            |
| Formato A..W antiguo y lista `ARRASTRA`                                            | `app/api/v1/matriz/csv.ts`                                                                         |
| Mapa de casos                                                                      | `GET /v1/matriz/mapeo`, `core.mapa_matriz_excel`                                                   |
| Vocabularios del dominio                                                           | `angular/src/app/dominio/modelos.ts`                                                               |
| Diagnóstico previo de columnas (versión anterior del libro)                        | `docs/07_frontend/MATRIZ_DIAGNOSTICO_EXCEL.md`                                                     |
| Diagnóstico de datos de la base                                                    | `docs/diagnostico-datos-2026-11-27.md`                                                             |

> El diagnóstico de `docs/07_frontend/MATRIZ_DIAGNOSTICO_EXCEL.md` describe la **versión anterior** de la matriz (25 columnas A..W con `Prioridad de Atención` en D y `Nombre de Caso` en E). El libro actual de `docs/05_datos/` tiene otra disposición. Este documento manda sobre el actual; aquel sigue siendo válido para entender de dónde viene el modelo.

# Apéndice D — Glosario mínimo

| Término                    | Significado                                                 |
| -------------------------- | ----------------------------------------------------------- |
| **Bloque**                 | Conjunto de filas consecutivas de un mismo caso             |
| **Aplanar**                | Convertir N filas en 1 caso + N compromisos + N hitos       |
| **Sangrado de encabezado** | Fila de datos que en realidad repite un título de banda     |
| **`[POR CONFIRMAR]`**      | Hueco declarado, nunca inventado                            |
| **Dry-run**                | Simulación sin escritura                                    |
| **Golden file**            | Salida de referencia contra la que se prueba el parser      |
| **Savepoint**              | Punto de retorno dentro de una transacción                  |
| **Upsert conservador**     | Actualiza solo lo vacío, no pisa lo existente               |
| **`origen_ref`**           | Referencia estable al origen (fila/columna) para deduplicar |
