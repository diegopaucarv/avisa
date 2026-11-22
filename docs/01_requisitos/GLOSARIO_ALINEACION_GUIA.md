# Glosario de alineación — vocabulario normativo de la Guía PRODUCE

**Autoridad:** `docs/01_requisitos/guia.md`.
**Uso:** este documento fija el vocabulario con el que deben coincidir el ERS, la v10, el MVP,
la migración, el diccionario y los runbooks. Si un documento usa una etiqueta distinta para el
mismo eje, se corrige **la etiqueta**, nunca el hecho.

> Este documento no reemplaza a la Guía: la traduce a una lista comprobable. Ante cualquier
> duda de criterio, manda `guia.md`.

---

## 0 · Reglas de edición (obligatorias)

1. **Cirugía, no reescritura.** Se corrige la etiqueta o el valor enumerado. No se reescriben
   párrafos, no se resumen secciones, no se cambian cifras, tablas, códigos ni referencias.
2. **Mirar el contexto antes de tocar.** Muchas de estas palabras son también español corriente:
   «otros actores», «por medio de», «crítica constructiva», «un tercero». Sólo se corrige cuando
   la palabra **nombra un valor de catálogo, una etiqueta de campo o un ítem de una enumeración
   cerrada**.
3. **La propia Guía usa «triangulación» y «saturación»** (§7.7.2). Esos términos **no se
   retiran** de los documentos. Sólo se cambia el nombre de la _ruta de atención_ en la ficha de
   la interfaz, que es otra cosa.
4. **No se inventan datos.** Si un documento afirma algo que la Guía no dice, se anota en el
   informe; no se rellena el hueco.
5. **No se tocan** `docs/avisa_actual/` (describe el sistema en producción tal como es),
   `docs/_archivo/` (archivado), `docs/img/*`, `docs/casos_uso/*.puml` (exige re-render) ni
   ningún `docs/*.sql` (están aplicados en la base o son generados).
6. **Los casos ya están recodificados (D5, cerrada y aplicada).** Las migraciones 16 y 19 llevaron
   los 35 casos al formato del Anexo 15 —`CS-<PA|MI>-<INF|OAT|NOR|DBE|GOB|ITE>-<AAAA>-<NN>`,
   p. ej. `CS-PA-INF-2026-01`—; el código anterior se conserva en `codigo_legado` y la sigla `GEN`
   cubre los casos sin subsector o sin temática. La numeración no se reescribe a mano otra vez.
7. **Cada edición se registra**: archivo, línea, texto anterior, texto nuevo, y la sección de la
   Guía que lo respalda.

---

## 1 · Los ejes y sus valores canónicos

Cada eje es independiente. Un valor de un eje **nunca** se usa en otro.

### 1.1 · Nivel de conflictividad (§7.5.1)

```
Diferencia → Controversia → Conflicto social → Crisis social
```

- Prohibido usar en este eje: `Alto`, `Medio`, `Bajo`, `Crítico`, `Conflicto_social`, `Crisis_social`.
- «Alto» pertenece al eje de riesgo, no a éste.

### 1.2 · Nivel de riesgo (§7.5.2)

```
Bajo · Moderado · Alto
```

- Prohibido: `Medio`, `Medio-alto`, `Medio bajo`, `Crítico`, `Muy alto`.
- «Moderado» **no** es sinónimo de «medio»: es el nombre normativo del nivel intermedio.

### 1.3 · Prioridad de atención del caso (§8.3.1, columna de la matriz)

```
Urgente · Moderado · Bajo
```

- Prohibido en este eje: `Crítica`, `Alta`, `Media`, `Inmediata`.
- «Crítica» es válida en el eje de alertas (1.7), no aquí.

### 1.4 · Temáticas de conflictividad (§7.6)

```
Infraestructura
Ordenamiento y acceso territorial
Normatividad
Distribución de beneficios
Gobernanza
Impactos de terceros
```

- Prohibido: «Acceso a infraestructura», «Otros» como tipología del catálogo.
- **D2, aplicada (migración 15):** `Otros` se retiró del catálogo y sus 2 casos y 48 demandas se
  reasignaron. Si un documento enumera el catálogo y aparece «Otros», se retira de la enumeración.

### 1.4.bis · Tipos de hecho (D1, cerrada y aplicada)

```
Aprobación de Normatividad · Bloqueo · Comunicado
Espacio de diálogo · Otro · Reunión Técnica · Visita de campo
```

- **D1, aplicada (migración 15):** `Protesta o Bloqueo` quedó como `Bloqueo` y
  `Comunicado o documento` como `Comunicado`. Esa es la lista completa del catálogo: siete valores.
- `Otro` (singular) es el valor del catálogo de tipos de hecho; no confundir con «otros actores»
  ni con `Otros`, que se retiró de las temáticas (1.4).

### 1.5 · Subsectores (§7.6)

```
Pesca y Acuicultura · MYPE e Industria
```

- Prohibido: `Mype e Industria` (forma mal escrita), `Gestión y Prevención de Conflictos`
  (es la oficina, no un subsector), `Pesca artesanal` como subsector.
- «Pesca artesanal» puede aparecer como **descripción** de un caso, no como valor del catálogo.

### 1.6 · Actores (§7.4)

| Eje                        | Valores canónicos                                                   | Prohibido                                                              |
| -------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Tipo / rol estructural     | `Actor social` · `Actor público` · `Actor privado`                  | `Actor Sociedad Civil`, `Actor del Estado`, `Sociedad Civil` como tipo |
| Función en la intervención | `Principal` · `Secundario` · `Tercero imparcial` · `No determinado` | `Tercero` a secas como función, `No_determinado`                       |
| Posicionamiento            | `Dialogante` · `Legitimante` · `Conflictivo`                        | `Disruptivo`                                                           |

- `NEC`, `CITE`, `SANIPES`, `Exportador CITES`, `Proveedor MYPE` e `Inspector CITE` **no son tipos
  ni funciones de actor**: son entidades o cargos. Si un documento los clasifica como tipo o
  función, se corrige la clasificación y se anota.

### 1.7 · Alertas tempranas (§8.1.2.2, RED-RADAR)

Dos columnas distintas, no una:

| Columna   | Valores canónicos                                            |
| --------- | ------------------------------------------------------------ |
| Nivel     | `Inmediato` · `Táctico` · `Preventivo` · `Monitoreo`         |
| Prioridad | `Crítica inmediata` · `Urgente` · `Temprana` · `Seguimiento` |
| Plazo     | `sla_horas`: 24 · 48 · 72 · (sin plazo)                      |

- El plazo **no** va dentro de la etiqueta: `Inmediato (24h)` → `Inmediato` y el plazo a su
  columna. Lo mismo con `Táctico (24h - 48h)` y `Preventivo (48h - 72h)`.
- Las 83 alertas históricas con `estado_legado = 'Archivado'` se documentan como **Atendidas**
  (decisión ya tomada); la migración de datos está pendiente.

### 1.8 · Estados de hito, de compromiso y de caso (§8.3.2)

Hito:

```
Registrado · En ejecución · Paralizado · Cumplido · Desestimado
```

Compromiso:

```
Por iniciar · En proceso · Cumplido · Redefinido · Desestimado
```

Caso:

```
Abierto · Resuelto · Archivado
```

- `Activo` y `En seguimiento` quedaron retirados en la migración 33: eran dos nombres para el
  mismo hecho (`es_activo = true`) y se unificaron en `Abierto`. La SPA normaliza cualquier
  respuesta antigua a esos tres valores.
- Prohibido: `En_ejecucion`, `En_seguimiento`, `Por_iniciar`, `En_proceso`, `Vencido` como
  sinónimo de `Paralizado`.
- «Vencido» existe, pero es el **cálculo de plazo por fecha**, no un estado de gestión.

El **estado de atención de la demanda** es un eje independiente (no está entre los doce ejes
congelados) y usa los mismos valores legibles desde la migración 24: `Pendiente` · `En proceso` ·
`Atendida` · `Desestimada`. La forma con guion bajo ya no existe en la base: un `CHECK` que la admita
sería un error, y la API acepta la forma legada sólo para no romper clientes, escribiendo siempre la
canónica.

### 1.9 · Alcance geográfico

```
Norte · Centro · Sur · Oriente · Nacional
```

- Se **deriva** de la región; no se elige a mano. En etiquetas de interfaz, «Territorio» → «Región».
- «GORE» es la etiqueta de «Gobierno regional» en la ficha.

### 1.10 · Ciclo de intervención (§8.1–8.4)

```
Prevención estratégica · Prevención operativa
Intervención y tratamiento
Monitoreo de compromisos (seguimiento)
Gestión de la información y del conocimiento (transversal)
```

- Los bloques pueden ocurrir simultáneamente: no son etapas rígidas ni secuenciales.
- El nombre de la **ruta de atención de la ficha** usa estos cuatro nombres. «Triangulación»,
  «saturación» y «validación» describen el método de análisis (§7.7.2), no la ruta.

### 1.11 · Anexos

La numeración es la de la Guía y no se reutiliza:

| #   | Anexo                                         |
| --- | --------------------------------------------- |
| 1   | Matriz de Sistematización de Demandas         |
| 2   | Reporte Regional de Conflictividad y Demandas |
| 3   | Formato de Alerta Temprana                    |
| 4   | Clima Social General                          |
| 5   | Clima Social Focalizado                       |
| 6   | Plan de Acción Rápida                         |
| 7   | Plan de Acción Estratégico                    |
| 8   | Análisis de Caso                              |
| 9   | Formato de Argumentario Institucional         |
| 10  | Acta de Acuerdo                               |
| 11  | Reporte de Actividad                          |
| 12  | Ayuda Memoria                                 |
| 13  | Relatoría                                     |
| 14  | Matriz de Seguimiento de Compromisos          |
| 15  | Matriz de Conflictividad                      |
| 16  | Registro de Reuniones y Espacios de Diálogo   |
| 17  | Registro de Reportes                          |

- `cat_tipos_documento` cubre hoy los anexos **1 a 13**: el reporte de alerta temprana lleva
  `anexo_numero = 3` desde la migración 14 y los anexos 1 y 2 se añadieron en la migración 20
  (decisión D3). Los anexos **14 a 17 no se tipifican a propósito**: los anexos 14, 15 y 16 son
  registros estructurados con tabla propia (`compromisos` e `hitos_compromiso`, `casos`,
  `reuniones_dialogo`) y el 17 se sirve desde `analytics.vw_anexo_17_registro_reportes` (E4,
  cerrado sin crear tabla).

### 1.12 · Vocabulario CONGELADO

Los valores de los **doce ejes** de §1 son **vocabulario congelado**: ya están en la base viva
(migraciones 14 a 19) y **no se vuelven a tocar sin una migración**. Cambiar cualquier etiqueta
—conflictividad, riesgo, prioridad del caso, temáticas, tipos de hecho, subsectores, actores,
alertas, estados, alcance o ciclo— exige escribir la migración, correrla y volver a medir.
Ningún documento corrige estos valores por redacción.

---

## 2 · Tabla de reemplazos exactos

Sólo se aplican a etiquetas, valores de catálogo y enumeraciones cerradas.

| Antes                        | Después                                              | Eje     |
| ---------------------------- | ---------------------------------------------------- | ------- |
| `Actor del Estado`           | `Actor público`                                      | 1.6     |
| `Actor Sociedad Civil`       | `Actor social`                                       | 1.6     |
| `No_determinado`             | `No determinado`                                     | 1.6     |
| `Tercero` (como función)     | `Tercero imparcial`                                  | 1.6     |
| `Disruptivo`                 | `Conflictivo`                                        | 1.6     |
| `Mype e Industria`           | `MYPE e Industria`                                   | 1.5     |
| `Conflicto_social`           | `Conflicto social`                                   | 1.1     |
| `Crisis_social`              | `Crisis social`                                      | 1.1     |
| `En_ejecucion`               | `En ejecución`                                       | 1.8     |
| `En_seguimiento`             | _retirado_ (migración 33: se unificó en `Abierto`)   | 1.8     |
| `Por_iniciar` / `En_proceso` | `Por iniciar` / `En proceso`                         | 1.8     |
| `Critica_Inmediata`          | `Crítica inmediata`                                  | 1.7     |
| `Protesta o Bloqueo`         | `Bloqueo`                                            | 1.4.bis |
| `Comunicado o documento`     | `Comunicado`                                         | 1.4.bis |
| `Inmediato (24h)`            | `Inmediato`                                          | 1.7     |
| `Táctico (24h - 48h)`        | `Táctico`                                            | 1.7     |
| `Preventivo (48h - 72h)`     | `Preventivo`                                         | 1.7     |
| riesgo `Medio`               | riesgo `Moderado`                                    | 1.2     |
| prioridad `Crítica` (caso)   | prioridad `Urgente`                                  | 1.3     |
| conflictividad `Alto`        | `Conflicto social` o `Crisis social`, según el texto | 1.1     |

---

## 3 · Cómo se comprueba que no falta nada

```sh
cd docs
grep -rn --include=*.md -E "Actor del Estado|Actor Sociedad Civil|No_determinado|Disruptivo|Mype e Industria|Conflicto_social|Crisis_social|En_ejecucion" . | grep -v _archivo | grep -v avisa_actual
grep -rn --include=*.md -E "Inmediato \(24h\)|T[áa]ctico \(24h|Preventivo \(48h" .
grep -rn --include=*.md -iE "riesgo (medio|cr[ií]tico)|prioridad cr[ií]tica" .
grep -rn --include=*.md -E "Critica_Inmediata|En_seguimiento|Por_iniciar|En_proceso|CS-PRODUCE" .
```

El objetivo es que las cuatro búsquedas no devuelvan nada fuera de `_archivo/`,`avisa_actual/`,
`guia.md` (que cita el legado) y este glosario.
