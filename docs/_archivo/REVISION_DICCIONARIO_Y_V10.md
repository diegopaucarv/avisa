# Revisión del diccionario de datos y del modelo v10

Fecha: 2026-11-18. Base viva: contenedor `avisa-db`, base `avisa`.
Se excluyen siempre `public`, `information_schema`, `pg_*` y (salvo que se diga) `legacy`.

> Las cifras de este documento son las de ese día y se conservan como registro. El modelo
> creció después: ver la medición del 2026-11-19 en `INDICE.md` §3 y el diccionario vigente en
> `DICCIONARIO_DATOS.md`.

## 1. Veredicto

**El diccionario ya es publicable en lo que toca al modelo v10 y no queda nada abierto en la
capa de significados.** La cobertura de tablas es total: las 255 tablas lógicas del modelo
tienen descripción y las 30 vistas también. Las 2 036 columnas del modelo también están
descritas, así que esa capa no muestra huecos; las columnas sin descripción son todas del
sistema anterior. `nivel_clasificacion` ya tiene **un solo significado** en toda la base: un
número 1/2/3 validado contra un catálogo único.

## 2. Hallazgos

| Hallazgo                                                                                     | Severidad | Evidencia                                                                                                                                                                                                                                                                                                                                          | Propuesta                                                                                                                        |
| -------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 29 columnas del modelo v10 tenían comentario en la base pero no entrada en la curaduría      | Media     | La base tenía 2 036 columnas comentadas y la curaduría 2 007 claves. Faltaban 15 en `core.proceso_instancia`, 4 en `core.actor_datos_personales`, 3 en `core.flujo_definicion`, 2 en `audit.datos_personales_acceso`, 2 en `core.flujo_estado`, 2 en `kag.nodos` y 1 en `core.integraciones`: esas descripciones vivían solo en los parches 9 a 11 | **Resuelto.** Las 29 se incorporaron a `curacion_v10_columnas.py` (2 036 claves), se regeneró `PARCHE_12` y se aplicó en la base |
| `nivel_clasificacion` con dos semánticas de texto para los mismos números                    | Alta      | 47 columnas comentadas "1 público, 2 reservado, 3 confidencial"; 5 comentadas "1 público, 2 interno, 3 sensible" (`curacion_v10_columnas.py:965,1033,1062,1093,1111`)                                                                                                                                                                              | **Resuelto.** Las 5 se reescribieron en la curaduría; el `PARCHE_12` regenerado las aplicó                                       |
| `consultation.procesos.nivel_clasificacion` es `varchar(20)` con etiquetas y sin clave ajena | Alta      | Era la única de 53 columnas lógicas con ese tipo; 0 filas; comentario "expresado como etiqueta: Público, Reservado o Confidencial" (`curacion_v10_columnas.py:386`)                                                                                                                                                                                | **Resuelto.** El parche 13 la convirtió a `smallint` con FK a `core.cat_clasificacion`                                           |
| La cabecera del archivo unificado describía mal la sección A                                 | Media     | `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql:59-60` decía "275 tablas lógicas (no hay particiones todavía)", pero las particiones se crean en la propia sección A (líneas 859-1038, `DO` en 1026)                                                                                                                                                         | Corregido en `migration/consolidar_esquema.py`: ahora dice "275 físicas = 251 lógicas + 24 particiones"                          |
| El documento de diseño no refleja el parche 11                                               | Media     | `docs/AVISA_PRODUCE_v10.md:1561-1566` definía `kag.nodos` sin `created_at`/`updated_at`; `grep` de "parche 11" no devuelve coincidencias                                                                                                                                                                                                           | **Resuelto.** El diagrama ya lista las 6 columnas reales                                                                         |
| Las 30 vistas tienen propósito pero ninguna descripción por columna                          | Media     | `migration/generar_diccionario.py:709-735` (`ficha_vista`) nunca imprime tabla de columnas                                                                                                                                                                                                                                                         | Aceptarlo como decisión editorial o documentar columnas de las 5 vistas más usadas                                               |
| 610 columnas del legado sin descripción                                                      | Media     | `legacy`: 807 columnas, 197 curadas (`curacion_legacy.py`, 12 tablas) → 610 restantes                                                                                                                                                                                                                                                              | Ver §3.1: 519 son columnas genéricas y exigen el formulario original                                                             |
| `core.cat_clasificacion` usa "Publico/Reservado/Confidencial" sin tildes                     | Baja      | `SELECT * FROM core.cat_clasificacion` → (1,'Publico'),(2,'Reservado'),(3,'Confidencial')                                                                                                                                                                                                                                                          | **Resuelto.** El parche 13 dejó el catálogo en `1 Público / 2 Reservado / 3 Confidencial`                                        |

Sin hallazgo (comprobado y correcto): no hay claves huérfanas ni claves repetidas.
Tablas 255/255, vistas 30/30, columnas 2 036/2 036 existentes, legado 87/87 tablas y
197/197 columnas. El escaneo del árbol sintáctico de los cuatro módulos de curaduría no
encontró ninguna clave duplicada que "gane en silencio". El total de 3 173 filas del
diccionario cuadra: 2 366 del modelo v10 con sus particiones + 807 del legado.

## 3. Las cinco preguntas

### 3.1 Cobertura del modelo v10

- **Tablas lógicas sin entrada: ninguna.** Las 255 claves de `curacion_v10.PROPOSITO` son
  exactamente las 255 tablas lógicas vivas (comparación de conjuntos contra el catálogo).
- **Columnas sin entrada en la curaduría: 29** de 2 036 (1,4 %), todas en objetos de los
  parches 9 a 11:
  - `core.proceso_instancia` (15): `alerta_id`, `caso_id`, `codigo_caso_legado`, `codigo_legado`,
    `codigo_reporte`, `codigo_responsable_legado`, `estado_id`, `fila_legado`, `finalizado_en`,
    `flujo_definicion_id`, `nota`, `ocurrido_en`, `orden`, `tipo_origen`, `usuario_id`.
  - `core.actor_datos_personales` (4): `dni_cifrado`, `dni_hmac`, `email_cifrado`, `telefono_cifrado`.
  - `core.flujo_definicion` (3), `core.flujo_estado` (2), `audit.datos_personales_acceso` (2),
    `kag.nodos` (2: `created_at`, `updated_at`), `core.integraciones` (1: `workflow_state`).
  - **Importante:** esas columnas sí tenían descripción en la base, porque los parches 9 a 11
    la escriben directamente. El hueco era de la curaduría, no del diccionario: la descripción
    vivía en un parche y no en la fuente que se edita a mano, de modo que cualquier cambio
    posterior la habría dejado huérfana. **Ya está cerrado:** las 29 entraron en la curaduría.
- **(a) Particiones: la herencia se cumple.** Hay 24 particiones de tabla (12 en `agent`,
  6 en `avisa`, 6 en `ctx`). Suman 330 columnas y **0 tienen comentario propio**; en las 24,
  el padre sí tiene comentario para todas sus columnas. `heredar_descripciones`
  (`migration/generar_diccionario.py:392-415`) las rellena por nombre. Confirmado.
- **(b) Vistas: 30 de 30 con propósito** (22 de `analytics`, más 8 en `core`, `lex`, `mype`,
  `pesca`, `territorio`). No hay vistas huérfanas ni entradas sobrantes. Pero el documento no
  describe columnas de vistas (ver tabla).
- **(c) Las 610 columnas del legado.** Todas se pueden etiquetar con una regla mecánica
  (rellenar una plantilla), pero eso no es lo mismo que describirlas. Desglose medido:
  - 610 en total; 12 tablas tienen curación y 75 no tienen ninguna.
  - **519** son columnas genéricas `c01`, `c02`, … del volcado de formularios.
  - **91** son metadatos de carga (`fila_n` 86, más `hoja`, `tabla`, `columnas`, `filas`,
    `cargado_at`).
  - Conclusión honesta: **las 610 se pueden rellenar con una plantilla para que no queden en
    blanco, pero las 519 columnas genéricas exigen la hoja original para decir algo útil.**
    Eso es trabajo manual real; de las 610, solo 91 se resuelven con una regla sin ambigüedad.

### 3.2 Consistencia de `nivel_clasificacion`

- 59 tablas físicas tienen la columna: **53 lógicas + 6 particiones** de `agent.llm_call`.
- Valores realmente almacenados (agregado de las 59): **1 → 10 filas, 2 → 2 184, 3 → 1 996**.
  42 tablas están vacías en esa columna. No hay ningún valor fuera de 1/2/3.
- **59 de las 59 tienen clave ajena** a `core.cat_clasificacion` (53 lógicas + 6 particiones)
  desde el parche 13.
  Las otras 2 claves ajenas al catálogo son columnas con otro nombre (`core.roles.max_clasificacion`
  y `core.query_cache.clasificacion_max`). Es decir, el modelo trata el nivel como número con catálogo.
- **La excepción ya no existe**: `consultation.procesos` era `varchar(20)`, guardaba etiquetas y no
  tenía FK; el parche 13 la pasó a `smallint` con FK al catálogo, y hoy tiene 0 filas.
- Comentarios en la base: 52 columnas dicen "público / reservado / confidencial"; **ninguna** dice
  ya "público / interno / sensible"; ninguna usa etiquetas. El catálogo `core.cat_clasificacion`
  guarda `1 Público / 2 Reservado / 3 Confidencial`.
- **Regla canónica, ya aplicada (parche 13):** `nivel_clasificacion` es `smallint NOT NULL` con
  FK a `core.cat_clasificacion`; **1 = Público, 2 = Reservado, 3 = Confidencial**, y la FK hace
  que esos sean los únicos valores posibles (no se añade `CHECK`, ver `parches/P13_CLASIFICACION.md`
  §3). `consultation.procesos` quedó convertida y se eliminó la redacción "interno/sensible" de los
  cinco comentarios.

### 3.3 Impacto del parche 11 en el documento de diseño

- `docs/AVISA_PRODUCE_v10.md:1561-1570` definía `kag.nodos` con 4 columnas (`id`, `tipo`,
  `ref_id`, `etiqueta`). La base tiene **6**: añade `created_at` y `updated_at`. **Ya coordinado:**
  el diagrama lista las 6.
- `kag.aristas` (`docs/AVISA_PRODUCE_v10.md:1575-1593`) sí lista las 16 columnas actuales,
  incluida `nivel_clasificacion`. Coherente.
- No hay ninguna mención al parche 11 en el documento y **no hay cifras de filas** de `kag`
  en él, así que no hay cifras que corregir, solo el diagrama.
- Disparadores: el parche 11 declara 8 y los 8 existen en la base (`trg_nodo_toca` en
  `kag.nodos`, más 7 sobre tablas de `core`: `casos`, `demandas`, `actores`,
  `casos_actores`, `demandas_actores`, `actor_membresia`). Coincide con
  `docs/parches/P11_GRAFO_KAG.md:102`. Aquí no hay discrepancia.
- Cifras del grafo: medido `kag.nodos` = 1 520 (actor 1 160, demanda 325, caso 35) y
  `kag.aristas` = 450. `docs/parches/P11_GRAFO_KAG.md:94-102` declara exactamente esos
  números: documento y base coinciden.

### 3.4 Entradas huérfanas, duplicados y cobertura de los parches 9-11

- **Huérfanas: ninguna.** Tablas 255/255, vistas 30/30, columnas 2 036/2 036 existentes en la
  base; legado 87/87 tablas y 197/197 columnas. Ninguna clave apunta a algo inexistente.
- **Duplicadas: ninguna** dentro de cada módulo (verificado leyendo el árbol sintáctico, que es
  la única forma de ver una clave repetida que Python sobrescribe sin avisar).
- **Las 4 tablas de los parches 9-11** (`audit.datos_personales_acceso`, `core.flujo_definicion`,
  `core.flujo_estado`, `core.proceso_instancia`) tienen propósito en `curacion_v10.PROPOSITO`
  y, tras la corrección, también sus 22 columnas están descritas.
- **Las 4 columnas cifradas de `core.actor_datos_personales`** (`dni_cifrado`, `dni_hmac`,
  `email_cifrado`, `telefono_cifrado`): ya tienen entrada en la curaduría. Era el hueco más
  delicado, porque son datos personales y el diccionario las habría mostrado sin explicar cómo
  se protegen.

### 3.5 Estado del archivo unificado

- Contiene el DDL base y los 13 parches: `SECCIÓN A` con bloques A.1
  extensiones, A.2 y A.3 (dos pasadas del DDL) y A.3.1-A.3.5 (parches 1 a 5); `SECCIÓN B`
  con bloques B.1-B.8 (parches 6 a 13). **Los 13 parches están presentes**
  en un archivo de 15 248 líneas (1 008 825 bytes). Los números de línea se desplazan cuando
  se recompone: cámbielos sólo después de volver a ejecutar `migration/consolidar_esquema.py`.
- Cabecera declarada: solo A = 275 tablas, 2 314 columnas y 581 claves ajenas;
  A+B = 279 tablas, 2 366 columnas, 590 claves ajenas.
- Verificado en la base: **2 366 columnas, 590 claves ajenas, 60 disparadores, 26 esquemas**
  (25 con tablas y `analytics`, que solo tiene vistas). Las cifras de A+B (279, 2 366, 590)
  son exactas. Las de la sección A sola no se pueden comprobar sin crear una base vacía; la
  cuenta de 275 es compatible: 275 físicas = 251 lógicas + 24 particiones creadas dentro de
  A, y B añade 4 tablas, lo que da 255 lógicas y 279 físicas. El texto "275 tablas lógicas
  (no hay particiones todavía)" ya se corrigió en el generador.

## 4. Qué se tocó después de esta revisión

Esta revisión sólo escribió `docs/REVISION_DICCIONARIO_Y_V10.md`. Las correcciones se
aplicaron en un paso posterior, con autorización de la usuaria:

- `migration/curacion_v10_columnas.py`: +29 entradas (2 007 → 2 036 claves).
- `docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql`: regenerado con
  `migration/generar_comentarios_sql.py` y aplicado en `avisa-db` (2 036 columnas).
- `migration/consolidar_esquema.py`: corregida la cabecera de la sección A, y el archivo
  `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql` recompuesto.
- `docs/DICCIONARIO_DATOS.md` y `docs/diccionario_datos.csv`: regenerados; siguen en 3 173
  filas y las 610 sin descripción siguen siendo todas del sistema anterior.
- `docs/PARCHE_13_CLASIFICACION.sql`: convierte
  `consultation.procesos.nivel_clasificacion` a `smallint` y añade la FK a
  `core.cat_clasificacion`; normaliza las tildes del catálogo. El parche **no** añade un `CHECK`
  de rango: la FK al catálogo ya limita el valor a 1, 2 o 3. La redacción de los cinco
  comentarios "interno/sensible" se corrigió en la curaduría y la reescribió el
  `PARCHE_12` regenerado. Aplicado en `avisa-db`; informe en `docs/parches/P13_CLASIFICACION.md`.

Lo que sigue **sin tocar**, porque exige una decisión editorial y no una corrección de texto:

- Las 30 vistas: tienen propósito pero no descripción por columna.
- Las 519 columnas genéricas `c01`, `c02`, … del legado: sin la hoja original no se pueden
  describir con utilidad.
- Los archivos de curaduría de tablas, vistas y legado.
- La base `avisa`: para los parches 12 y 13 se ejecutó SQL de comentarios, de tipo y de
  restricción sobre `consultation.procesos`; no se creó ni se borró ninguna tabla, y no se
  tocó ninguna fila. No se ejecutó git.
