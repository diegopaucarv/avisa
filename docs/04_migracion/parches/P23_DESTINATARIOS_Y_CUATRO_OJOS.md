# P23 — Destinatarios nombrados, cuatro ojos y la escala de gravedad

**Proyecto:** AVISA / SIPRECS — OAIPCS, PRODUCE
**Marco:** ERS v0.6 — §11.1 (tabla de gravedad), RN-02, RN-04, G21, RD-08 y §2.2 de `mvp.md`
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_23_DESTINATARIOS_Y_CUATRO_OJOS.sql` (idempotente, re-ejecutable)
**Estado:** **aplicado y verificado en la base viva el 2026-11-20.** Se reejecutó
entero durante la revisión documental que cerró este informe, para añadir el
`FORCE ROW LEVEL SECURITY` que faltaba (§3.6) y volver a medir la idempotencia
(§5.2): la segunda pasada devolvió `already exists, skipping` en todas las piezas
de esquema y no movió ninguna fila.

---

## 1. Resumen

El parche 22 hizo ejecutable G21, pero dejó tres cosas dichas y no resueltas: la
visibilidad `sectorial` no tenía tabla donde nombrar a quién se remite; la
regla de «cuatro ojos» no se podía comprobar porque `es_validado_humano` es un
booleano sin autor; y el contrato de G21 en `config.guardrail_contract` se
probaba con un valor que el `CHECK` de la columna no admite desde el parche 22.
Alrededor de esas tres, el vacío **H-14** seguía preguntando si los niveles de
alerta son tres o cuatro.

El parche hace seis cosas:

1. Da **`es_grave`** a `core.cat_prioridades_alerta`, con un `CHECK` que impide
   marcar como grave un nivel sin plazo. RN-02 («graves son los niveles 1 y 2»)
   deja de estar escrita solo en el documento y pasa a estar en el dato.
2. Añade **`core.alertas_tempranas.validada_por`**, la firma de la validación
   previa, con dos restricciones: la firma y la fecha van juntas, y las dos
   firmas —validación y aprobación— no pueden ser de la misma persona.
3. Crea **`core.alerta_destinatario`**, la tabla que sostiene el valor
   `sectorial` de la visibilidad: el destinatario es una cuenta del sistema o un
   cargo sin cuenta, nunca los dos.
4. Amplía el gate **G21** para exigir el «cuatro ojos» y, en la visibilidad
   `sectorial`, al menos un destinatario nombrado.
5. **Corrige** el contrato G21 de `config.guardrail_contract`, que usaba
   `visibilidad = 'perfil_b'`, valor imposible desde el parche 22.
6. Lleva **`core.vw_alerta_estado`** de 20 a 22 columnas, con `validada_por` y
   el número de destinatarios.

En cifras (medidas en la base viva, no estimadas):

| Dato                                                   |          Antes |                                                      Después |
| ------------------------------------------------------ | -------------: | -----------------------------------------------------------: |
| Columnas de `core.alertas_tempranas`                   |             36 |                                                       **37** |
| Columnas de `core.vw_alerta_estado`                    |             20 |                                                       **22** |
| Niveles del catálogo de prioridades                    |              4 | **4** (sin alta; la etiqueta legada `Alta` es hoy `Urgente`) |
| Niveles marcados como graves                           | — (no existía) |                                                        **2** |
| Columnas de `core.alerta_destinatario`                 |              — |                                                       **11** |
| Filas de `core.alerta_destinatario`                    |              — |                                                **0** (vacía) |
| Restricciones `CHECK` del modelo v10                   |            354 |                                                      **360** |
| Triggers (no internos) del modelo v10                  |             68 |                                                       **69** |
| Índices sobre tablas del modelo v10                    |            762 |                                                      **767** |
| Tablas lógicas / físicas del modelo v10                |      265 / 289 |                                                **266 / 290** |
| Columnas lógicas / con particiones                     |  2 148 / 2 514 |                                            **2 161 / 2 527** |
| Filas del modelo v10                                   |         13 355 |                                        **13 355** (sin alta) |
| Objetos derivados / sus columnas                       |       37 / 311 |                                                 **37 / 313** |
| Tablas con RLS / políticas (modelo v10)                |       90 / 552 |                                                 **91 / 556** |
| Tablas con RLS / políticas en `core`                   |       51 / 327 |                                                 **52 / 331** |
| Claves ajenas (modelo / únicas para SQL Server)        |      611 / 527 |                                                **616 / 532** |
| Filas del CSV del diccionario                          |          3 321 |                                                    **3 334** |
| Alertas migradas con visibilidad distinta de `interna` |              0 |                                                        **0** |
| Alertas migradas con `validada_por`                    |              — |                                                        **0** |

Las cifras cuadran con las piezas: **13 columnas** nuevas (11 + 1 + 1), **6**
restricciones `CHECK`, **1** trigger (`trg_audit`), **5** índices (la clave
primaria de la tabla nueva y cuatro explícitos), **5** claves ajenas (4 de la
tabla nueva y `validada_por`) y **4** políticas.

Lo que el parche **no** hace: no siembra destinatarios, no rellena firmas ni
fechas en las 83 alertas migradas, no cambia las filas del catálogo de
prioridades y no toca `core.alertas_actores` ni `legacy.dim_destinatarios_fijos`.
Se detalla en §3, §4 y §6.

---

## 2. Qué cambia

| Objeto                                     | Tipo                                  | Qué hace                                                                                                                                          |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.cat_prioridades_alerta.es_grave`     | columna nueva                         | `boolean NOT NULL DEFAULT false`; verdadera en `Critica_Inmediata` (legado → `Crítica inmediata`, migración 15) y `Urgente`, fijada por `codigo`. |
| `cat_prioridades_alerta_grave_con_plazo`   | `CHECK`                               | `NOT es_grave OR sla_horas IS NOT NULL`: grave sin plazo, imposible.                                                                              |
| `core.alertas_tempranas.validada_por`      | columna nueva                         | `uuid REFERENCES core.usuarios(id) ON DELETE RESTRICT`; autor de la validación previa.                                                            |
| `alertas_validacion_coherente`             | `CHECK`                               | `(validada_por IS NULL) = (fecha_validacion IS NULL)`.                                                                                            |
| `alertas_cuatro_ojos`                      | `CHECK`                               | `validada_por <> aprobada_por` cuando constan las dos.                                                                                            |
| `core.ix_alertas_validada_por`             | índice parcial                        | `(validada_por) WHERE validada_por IS NOT NULL`.                                                                                                  |
| `core.alerta_destinatario`                 | tabla nueva, 11 columnas              | Destinatarios nombrados por alerta: `usuario_id` o `cargo`, excluyentes.                                                                          |
| `alerta_destinatario_canal_valido`         | `CHECK`                               | `correo`, `whatsapp` o `sms`.                                                                                                                     |
| `alerta_destinatario_identidad`            | `CHECK`                               | `(usuario_id IS NULL) <> (cargo IS NULL)`: exactamente uno de los dos.                                                                            |
| `alerta_destinatario_notificado_coherente` | `CHECK`                               | `notificado_en >= created_at`.                                                                                                                    |
| `ux_alerta_destinatario_usuario_canal`     | índice único parcial                  | Una fila por persona, canal y alerta.                                                                                                             |
| `ux_alerta_destinatario_cargo_canal`       | índice único parcial                  | Una fila por cargo (sin distinguir mayúsculas), canal y alerta.                                                                                   |
| `core.tg_alerta_g21_visibilidad()`         | función `plpgsql`, recreada           | Acumula lo que falta y lanza `G21_SIN_APROBACION`; ahora incluye el «cuatro ojos» y los destinatarios.                                            |
| `config.guardrail_contract` (G21)          | `UPDATE` de una fila                  | Pasa de `perfil_b` a `ejecutiva` y añade `validada_por` al caso negativo.                                                                         |
| `core.vw_alerta_estado`                    | `CREATE OR REPLACE VIEW`, 22 columnas | Conserva sus 20 columnas en el mismo orden y añade `validada_por` y `destinatarios`.                                                              |

Todo el cuerpo va entre `BEGIN` y `COMMIT`; el bloque 0 (comprobaciones previas)
corre **antes** del `BEGIN`, igual que en los parches 21 y 22, para que un estado
de partida equivocado no abra una transacción que luego haya que deshacer a mano.

---

## 3. Por qué, decisión por decisión

### 3.1 Cuatro filas, tres plazos, dos graves (H-14)

El catálogo tiene cuatro filas y solo tres plazos:

| Fila (`codigo`)                           | `sla_horas` | `es_grave` | Nivel del ERS (legado → canónico, migración 15) |
| ----------------------------------------- | ----------: | ---------- | ----------------------------------------------- |
| `Critica_Inmediata` → `Crítica inmediata` |          24 | sí         | 1 · Crítica → `Crítica inmediata`               |
| `Urgente`                                 |          48 | sí         | 2 · Alta → `Urgente`                            |
| `Temprana`                                |          72 | no         | 3 · Media → `Temprana`                          |
| `Seguimiento`                             |   sin plazo | no         | — (observación) → `Seguimiento`                 |

La respuesta a H-14 no es «tres o cuatro»: son **tres niveles de gravedad con
plazo** más **un cajón de observación sin plazo**. `Seguimiento` no es un grado:
es lo que se mira sin comprometer una hora de atención. Por eso es grave el
primero y el segundo, y por eso el `CHECK` impide que un nivel sin plazo se
declare grave —si alguna vez se quisiera, habría que decidirlo explícitamente y
no por omisión—.

La columna se fija **por `codigo`, no por `id`**: si mañana se renumeran las
filas, la regla sigue significando lo mismo. Y sirve para que la aplicación no
lleve el número de nivel escrito en el código cuando la OAIPCS mueva el umbral:
cambiar qué es grave pasa a ser un `UPDATE` sobre el catálogo, no un despliegue.

_Posterior al parche (2026-11-21): el renombre de `Critica_Inmediata` a `Crítica inmediata` y la escala de cuatro códigos de D8 (`Crítica inmediata` · `Urgente` · `Temprana` · `Seguimiento`) quedaron resueltos por `migration/15_fusion_hechos_y_tematicas.sql`; el literal del parche queda como valor legado._

### 3.2 La firma que faltaba (H-84)

`aprobada_por` (parche 21) dio autor al segundo acto. Al primero le faltaba lo
mismo: `es_validado_humano` dice que alguien validó, no quién. Sin autor no hay
manera de comprobar que sean dos personas distintas, y una regla que no se puede
comprobar es una recomendación.

Tres decisiones sostienen la columna:

- **`ON DELETE RESTRICT`**, por la misma razón que `aprobada_por`: no se puede
  borrar a quien firmó mientras su firma conste en una alerta.
- **Firma y fecha equivalen**, no «ambas presentes»: las 83 alertas migradas
  tienen `es_validado_humano = true` y `fecha_validacion` en `NULL`, así que un
  `CHECK` que exigiera la fecha sobre la bandera las rechazaría. Lo que se exige
  es que no haya firma sin fecha ni fecha sin firma.
- **El `CHECK` `alertas_cuatro_ojos`** permite que falte alguna de las dos
  firmas —una aprobación puede registrarse mientras la validación se consigna—
  pero no que la misma persona firme los dos actos.

La regla queda además impuesta en el gate (§3.4), de modo que el error llegue con
el _reason code_ y no como una violación de restricción genérica. Queda registrada
como **H-84**, que este parche cierra; **no** es H-79, que sigue abierto y es otra
cosa: cómo se elige el rol de la sesión cuando la persona tiene varios.

### 3.3 La tabla de destinatarios, y por qué dos columnas excluyentes

El valor `sectorial` del `CHECK` de `visibilidad` significa «la remisión se limita
a los destinatarios nombrados de esa alerta», pero no existía la tabla donde
nombrarlos. `core.alertas_actores` no sirve: relaciona una alerta con los actores
del conflicto, no con las personas a las que se avisa. Una visibilidad que no
puede nombrar a quién se dirige no es una visibilidad: es una etiqueta.

El destinatario puede ser un usuario del sistema —el Ministro, los viceministros,
el secretario general— o un **cargo sin cuenta**: las jefaturas de gabinete
reciben envíos de alertas no graves y no entran al sistema (§6.1 del ERS). Por eso
hay dos columnas excluyentes y no una sola clave ajena: `usuario_id` o `cargo`.
Los dos a la vez sería ambiguo; ninguno, un destinatario que no existe.

`canal` permite una fila por destinatario y canal (`correo`, `whatsapp`, `sms`), y
`notificado_en` distingue el destinatario previsto del aviso ya cursado, con un
`CHECK` que impide un envío anterior a la creación de la fila.

### 3.4 El gate de cuatro ojos y el orden de comprobación

La función se **recrea entera** en lugar de parchearse: `CREATE OR REPLACE` deja
la definición en un solo sitio, que es lo que se puede leer y auditar. Los tres
requisitos para salir de `interna` son ahora:

1. la validación previa del Sectorista, con autor y fecha y `paso_actual >= 2`;
2. la aprobación definitiva de la Dirección, con autor y fecha;
3. que los dos autores sean personas distintas.

Y uno más, que solo aplica a `sectorial`: al menos un destinatario nombrado.

La comprobación de destinatarios se hace **solo sobre `UPDATE`**. En un `INSERT`
la clave de la fila todavía no sirve para buscar en la tabla hija; además, toda
alerta nace `interna` y los destinatarios se añaden después. El paso a
`sectorial` es un `UPDATE`, y ahí sí se puede exigir.

El trigger se dispara en **todo** `INSERT` y `UPDATE`, sin lista de columnas: el
invariante depende de siete columnas y una lista incompleta lo dejaría abierto por
el lado que nadie probó.

### 3.5 El contrato G21 que no podía pasar

El contrato se probaba con `"visibilidad": "perfil_b"`, un valor que el `CHECK` de
la columna no admite desde el parche 22 (`interna`, `ejecutiva`, `sectorial`). Un
contrato de prueba que usa un valor imposible no puede pasar nunca: el guardrail se
probaría contra sí mismo y fallaría siempre. Se alinea con el vocabulario real
(`ejecutiva`) y se le añade `validada_por` al caso negativo, para que el caso
cubra también la firma duplicada.

### 3.6 El `FORCE` que faltaba, y por qué importa

En la revisión documental que cerró este informe se detectó un defecto del propio
parche: `core.alerta_destinatario` quedaba con `ENABLE ROW LEVEL SECURITY` pero
**sin** `FORCE`. La aplicación se conecta como `avisa`, que es la propietaria de
las tablas, y el propietario de una tabla se salta las políticas cuando no están
forzadas. Con ese estado, las cuatro políticas del bloque 3 eran decorativas.

No era una convención discutible: **51 de las 52 tablas con RLS de `core`** están
forzadas, y las dos que el parche 21 creó (`core.flujo_estado` y
`core.permiso_aprobacion`) lo están explícitamente. `core.alerta_destinatario` era
la única excepción, y por omisión, no por decisión. En todo el modelo, **las 91
tablas con RLS están forzadas**: no hay ninguna otra con `ENABLE` a secas.

Se añadió `ALTER TABLE core.alerta_destinatario FORCE ROW LEVEL SECURITY;` y se
reejecutó el parche. Hoy el recuento de tablas con RLS y sin forzar en `core` es
**0**.

### 3.7 La vista a 22 columnas

`validada_por` entra al final, junto a la aprobación, y `destinatarios` cuenta las
filas de la tabla nueva con una subconsulta escalar. La vista conserva sus 20
columnas en el mismo orden y sus 83 filas: los dos contadores se resuelven sobre
una tabla vacía.

La pantalla necesita ese dato para saber si una alerta puede publicarse como
`sectorial`; sin él tendría que consultar la tabla hija por cada fila.

---

## 4. Migración de datos

Nada se rellena. Es la parte más importante de este parche y conviene decirla
antes que las cifras.

**1. Las 83 alertas migradas siguen en `interna`.** Tienen
`es_validado_humano = true`, `fecha_validacion` y `validada_por` en `NULL`,
`aprobada_por` en `NULL`. El sistema anterior marcaba la bandera de validación
pero nunca guardó quién validó, cuándo, ni quién aprobó. Inventar esos datos sería
fabricar un acto administrativo.

**2. `core.alerta_destinatario` nace vacía.** Nombrar destinatarios es
configuración viva de la OAIPCS: quién recibe qué y por qué canal es una decisión
de la oficina, no un dato del legado.

**3. El catálogo de prioridades no cambia de filas.** Siguen siendo cuatro, con
sus mismos códigos y plazos. Solo se les añade un dato derivado, `es_grave`, que
se fija con `UPDATE ... WHERE codigo IN (...)`, idempotente por construcción.

**4. `core.alertas_actores` no se toca.** Sigue siendo la tabla de actores del
conflicto. Las alertas que antes se mapeaban «≈» a ella para la visibilidad
`sectorial` conservan sus filas; lo que cambia es que ahora existe la tabla
correcta para el otro uso.

_Posterior al parche (2026-11-21): el código legado `Critica_Inmediata` que aquí se cuenta entre los «mismos códigos» pasó a `Crítica inmediata` por `migration/15_fusion_hechos_y_tematicas.sql`; siguen siendo cuatro filas con los mismos plazos._

---

## 5. Verificación con cifras medidas

### 5.1 Cifras del estado posterior

Medidas en la base viva con consultas directas al catálogo:

| Dato                                             |  Valor medido |
| ------------------------------------------------ | ------------: |
| Columnas de `core.alertas_tempranas`             |            37 |
| Columnas de `core.vw_alerta_estado`              |            22 |
| Filas de `core.vw_alerta_estado`                 |            83 |
| Columnas de `core.alerta_destinatario`           |            11 |
| Filas de `core.alerta_destinatario`              |             0 |
| Niveles del catálogo / niveles graves            |         4 / 2 |
| Alertas con visibilidad `interna`                |            83 |
| Alertas con visibilidad distinta de `interna`    |             0 |
| Alertas con la bandera de validación y sin fecha |            83 |
| Tablas con RLS en `core` / de ellas sin forzar   |        52 / 0 |
| Políticas de RLS en `core`                       |           331 |
| Restricciones `CHECK` del modelo / triggers      |      360 / 69 |
| Índices sobre tablas del modelo                  |           767 |
| Tablas lógicas / físicas                         |     266 / 290 |
| Columnas lógicas / con particiones               | 2 161 / 2 527 |
| Objetos derivados / sus columnas                 |      37 / 313 |
| Claves ajenas (modelo / únicas)                  |     616 / 532 |
| Filas del CSV del diccionario                    |         3 334 |

El contrato G21 quedó, en la base:

```text
input_dispara   {"visibilidad": "ejecutiva", "aprobada_por": null,
                 "aprobada_en": null, "validada_por": null}
input_no_dispara {"visibilidad": "ejecutiva",
                 "aprobada_por": "3f9c2a41-7b8e-4d6f-9a01-5c2e8b7d4a63",
                 "aprobada_en": "2026-11-18T10:15:00-05:00",
                 "validada_por": "a2d5c9e0-1b47-4f83-8e26-7c0d9b3a5f18"}
```

### 5.2 Salida de la pasada de verificación

Ejecutada por entrada estándar contra `avisa-db`, con `ON_ERROR_STOP=1`. Extracto
del bloque de comprobación del propio parche:

```text
PARCHE 23 · bloque 7/8 · comprobación
NOTICE:  PARCHE 23 · alertas_tempranas: 37 columnas · vw_alerta_estado: 22 columnas ·
         niveles graves: 2 · destinatarios: 0
NOTICE:  PARCHE 23 · alertas no internas: 0 · alertas con la bandera de validación
         pero sin fecha (esperado 83): 83
PARCHE 23 · bloque 8/8 · cierre
COMMIT
PARCHE 23 · aplicado
```

### 5.3 Idempotencia, medida con la marca de auditoría

La reejecución devolvió `already exists, skipping` en la columna `es_grave`, en la
columna `validada_por`, en el índice parcial de validación, en la tabla nueva, en
sus tres índices y en la vista del bloque 6 —que es `CREATE OR REPLACE` y por
tanto se reescribe sin error—. Los `UPDATE` afectaron a las mismas 2 + 2 filas del
catálogo y a la misma fila del contrato G21, sin mover ninguna marca de auditoría
ni la marca de la tabla nueva, que sigue vacía.

---

## 6. Riesgos y lo que queda abierto

**1. Las 83 alertas migradas no pueden publicarse con un solo `UPDATE`.** El gate
pide las dos firmas para salir de `interna`, y las 83 no las tienen. Publicar una
exige que una persona la valide y otra la apruebe, que es exactamente lo que G21
quiere decir.

**2. `core.alerta_destinatario` sigue con 0 filas.** Es deliberado (§4). La
tabla y el gate están resueltos; nombrar destinatarios es una decisión de la
OAIPCS que no consta.

**3. `visibilidad` y `validada_por` no están en la curaduría de columnas.** Por la
misma razón que el parche 22 explicó para `visibilidad`: `PARCHE_12` es el bloque
**B.13** del unificado y corre **antes** de B.17, así que un `COMMENT ON COLUMN`
emitido allí apuntaría a una columna que aún no existe. Las descripciones sí llegan
al diccionario, porque `generar_diccionario.py` lee `col_description` de la base y
es B.17 quien fija los comentarios.

**4. Siete columnas de `core.alerta_destinatario` no tienen comentario.** Son `id`,
`alerta_id`, `motivo`, `created_at`, `updated_at`, `created_by` y `updated_by`, y
son las únicas siete columnas sin describir de las 2 161 del modelo lógico. La
tabla está documentada, y las cuatro columnas con semántica propia
(`usuario_id`, `cargo`, `canal`, `notificado_en`) también. Completar las otras
siete es un pendiente de diccionario, no de esquema.

**5. El peso de los factores de gravedad sigue abierto (H-09).** Este parche fija
qué niveles son graves, no cómo se calcula la gravedad a partir de los cinco
factores del §11.1. La rúbrica propuesta está en el ERS y no se ha cerrado.

**6. H-79 sigue abierto y no debe confundirse con H-84.** El gate compara
**personas** (`validada_por` contra `aprobada_por`), no **sesiones**. Cómo se
elige el rol de la sesión cuando una persona tiene varios es otra pregunta.

**7. La visibilidad `sectorial` estrena tabla, pero no lectores.** No hay todavía
código que la consulte; la vista expone el número de destinatarios para que la
pantalla pueda decidir, y la política de lectura de la tabla es abierta a
propósito. Cuando exista la bandeja de la alerta, el filtro por destinatario se
resuelve leyendo esta tabla.

---

## 7. Propagación documental: lo que se aplicó y lo que no se tocó

A diferencia de los informes 20 a 22, aquí la propagación **ya está hecha** en el
árbol documental. Se deja el registro para que no se rehaga a ciegas.

### 7.1 Documentos actualizados

| Documento                                                         | Qué se propagó                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md`                    | §11.1 con la tabla de tres niveles y la correspondencia con el catálogo; RN-02, RN-13, OBJ-02 e IE-04; H-14 cerrada y H-84 resuelta; §12.1 con las cifras del parche; Anexo B.2 con el registro de la décima pasada |
| `docs/03_ejecucion/mvp.md`                                        | 266 tablas lógicas, reparto T0 33 y T1 13, y el puente que sigue sumando 46 tablas y 55 objetos                                                                                                                     |
| `docs/05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md`         | 290 tablas físicas, 266 lógicas, 616 claves ajenas, 360 `CHECK`, 767 índices, 69 disparadores, 2 161 / 2 527 columnas, 91 tablas con RLS y 556 políticas                                                            |
| `docs/05_datos/BRECHA_CAPA_DATOS_V9.md`                           | Remedición con el parche 23: 266 tablas, 313 columnas de objetos derivados, 556 políticas sobre 91 tablas                                                                                                           |
| `docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md`                    | Cadena de cifras: 2 511 físicas tras el 18, 2 148 lógicas tras el 22, 2 161 lógicas y 2 527 con particiones al cierre; 616 claves ajenas, 360 `CHECK`, 69 triggers, 767 índices                                     |
| `docs/06_operacion/FLUJO_BASE_MVP_Y_MIGRACION.md`                 | Ídem, con la cuenta sin el respaldo del parche 6 explícita: 289 tablas tras el 21 y 290 tras el 23                                                                                                                  |
| `docs/README.md`                                                  | Fila del parche 23 en la tabla de scripts, serie de montajes 6 a 23, recuentos de dieciocho parches post-carga, décima pasada y este informe                                                                        |
| `docs/03_ejecucion/PRIORIZACION_MVP_v10.md`                       | Reparto por capas del CSV con el parche 23 aplicado                                                                                                                                                                 |
| `docs/AVISA_V10_PRIORIZACION.sql`                                 | Resiembra de `priorizacion` con el reparto real del CSV                                                                                                                                                             |
| `migration/consolidar_esquema.py`                                 | El generador compone el parche 23 y describe el estado final en su encabezado, incluido el `FORCE` de la tabla nueva                                                                                                |
| `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`                            | Regenerado: bloque **B.18** completo, 21 458 líneas y 1 271 KB                                                                                                                                                      |
| `docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md` (Anexo B.2)        | Registro de la **decimotercera pasada**, con la corrección del `FORCE`                                                                                                                                              |
| `docs/casos_uso/AVISA_CASOS_USO.puml` y `docs/img/AVISA_CU_*.svg` | Los cinco bloques y sus cinco láminas regeneradas                                                                                                                                                                   |

### 7.2 Lo que no se toca, y por qué

- **Los registros de la octava y la novena pasada** del Anexo B.2 del ERS: son
  fotos fechadas y dicen lo que había entonces.
- **`docs/_archivo/`, `docs/avisa_actual/`**: material histórico.
- **`docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`**: ya está regenerado con el parche 23
  y el `FORCE` (§7.1); no queda pendiente.
- **`docs/04_migracion/parches/P20` a `P22`**: no se reescriben. Se les añade una
  sección final de «Actualización posterior» que dice qué pendiente de cada uno
  cerraron el 22 y el 23; su cuerpo y sus cifras siguen siendo los de su momento.
- **`docs/_archivo/`, `docs/avisa_actual/`**: material histórico.

---

## 8. Actualización posterior (parche 24, 2026-11-21)

El parche 24 describe las siete columnas que este parche dejó sin comentario. Se
escribe después y **no reescribe §6**, que queda como foto del estado que el 23
dejó.

| Pendiente de §6                                         | Estado                        | Quién lo cerró                                                                                                     |
| ------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1. Las 83 alertas no se publican con un solo `UPDATE`   | **Abierto, y es lo correcto** | Siguen sin firmas: publicarlas exige que una persona valide y otra apruebe                                         |
| 2. `core.alerta_destinatario` con 0 filas               | **Abierto, deliberado**       | Nombrar destinatarios es acto administrativo de la OAIPCS                                                          |
| 3. `visibilidad` y `validada_por` fuera de la curaduría | **Abierto, y se extiende**    | Lo mismo vale para las siete columnas del 24: `PARCHE_12` es B.13 y corre antes de B.18                            |
| 4. Siete columnas sin comentario                        | **Cerrado**                   | Parche 24: siete `COMMENT ON COLUMN`; el modelo cierra en **2 161 de 2 161** y la guardia del 19 vuelve a dar cero |
| 5. El peso de los factores de gravedad (H-09)           | **Abierto**                   | Nada de lo que hizo el 24 lo toca                                                                                  |
| 6. H-79, el rol de la sesión con varios roles           | **Abierto**                   | Ídem                                                                                                               |
| 7. La visibilidad `sectorial` sin lectores              | **Abierto**                   | Ídem                                                                                                               |

El detalle del cierre está en `04_migracion/parches/P24_COMENTARIOS_DESTINATARIO.md`.
Lo único que cambió en el modelo es de metadatos: sigue con 266 tablas lógicas,
290 físicas, 2 161 columnas y 556 políticas sobre 91 tablas.
