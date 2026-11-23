# P7 — Contrato de comportamiento de los guardrails G19–G25

**Proyecto:** AVISA / SIPRECS — OAIPCS, PRODUCE
**Marco:** `AVISA_PRODUCE_v10.md` §16.1.quater (G19–G22), §16.1.quinquies (G23–G25) y §9.9 (contrato de test sintético por guardrail)
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_7_GUARDRAILS_G19_G25.sql` (idempotente, montado como `97_patch_07.sql` en `compose.yaml`, bloque `B.2` del unificado)
**Estado:** **aplicado y verificado en la base viva el 2026-11-21.** La primera aplicación consta el 2026-11-18; las cifras de §5 se volvieron a medir el 2026-11-21. Ese mismo día la cláusula de conflicto pasó de `DO UPDATE` a `DO NOTHING`; el porqué y la medición están en §8.

---

## 1. Resumen

El parche 6 llevó el `CHECK` de la columna `guardrail` hasta `G25`, pero dejó el catálogo a medias: `config.guardrail_contract` seguía con las 18 filas de G1–G18 y los siete guardrails restantes, G19 a G25, no tenían contrato. Este parche no inventa esos siete: los siembra con el texto y los reason codes que fija `AVISA_PRODUCE_v10.md` —§16.1.quater para G19–G22, §16.1.quinquies para G23–G25— y con la misma forma de las 18 filas existentes.

Cada fila trae cuatro JSON y una severidad:

1. `input_dispara`, el caso pequeño que **hace fallar** la regla.
2. `input_no_dispara`, el mismo caso con solo lo imprescindible cambiado para **pasarla**.
3. `output_esperado_dispara`, con `{"ok": false, "fix": {...}, "msg": "...", "code": "<CODE>"}`.
4. `output_esperado_no_dispara`, con `{"ok": true, "msg": null, "code": null}`.
5. `severidad`, que es `block` en las siete.

En cifras (medidas hoy):

| Dato                                    | Antes | Después |
| --------------------------------------- | ----: | ------: |
| Filas de `config.guardrail_contract`    |    18 |  **25** |
| Guardrails distintos                    |    18 |  **25** |
| Filas de G19–G25                        |     0 |   **7** |
| Filas con `severidad = 'block'`         |     — |  **22** |
| Filas con `severidad = 'warn'`          |     — |   **3** |
| Filas de G19–G25 con reason code propio |     0 |   **7** |

El «18» de la columna «Antes» lo declaran el bloque 0.1 del propio SQL («Esperado: 18, sin duplicados») y `BRECHA_CAPA_DATOS_V9.md` §14 («18 filas (G1–G18)»). El reparto previo `block`/`warn` **no está medido** en ninguna de las dos fuentes; por eso va con «—». El 22/3 de hoy sí está medido (§5); por diferencia simple serían 15/3 antes de sumar las siete nuevas, pero esa resta no la confirma ninguna consulta.

Lo que el parche **no** hace: no toca las 18 filas G1–G18, no toca `config.parametro`, no crea tablas, columnas, restricciones, índices, funciones ni disparadores, y no siembra datos de negocio. Es un parche de contenido sobre una tabla de catálogo.

---

## 2. Qué cambia

| Objeto                                      | Tipo                                          | Qué hace                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.guardrail_contract`                 | tabla existente                               | Recibe 7 filas; no se crea ni se altera. Tiene `id uuid DEFAULT gen_random_uuid()`, cuatro `jsonb` no nulos, `guardrail varchar` no nulo y `severidad varchar` no nula. |
| filas `G19`–`G25`                           | `INSERT … ON CONFLICT (guardrail) DO NOTHING` | Siembra las siete claves que falten; **nunca reescribe** una fila existente.                                                                                            |
| `config.guardrail_contract_guardrail_check` | `CHECK` preexistente                          | Admite `G1`…`G25`; el parche 7 no lo modifica.                                                                                                                          |
| `config.guardrail_contract_severidad_check` | `CHECK` preexistente                          | Admite `block` y `warn`; el parche 7 no lo modifica.                                                                                                                    |
| `config.parametro`                          | —                                             | No se toca. La lista blanca de G22 vive ahí y la siembra otro parche.                                                                                                   |

Los cuatro `jsonb` son `NOT NULL` y `severidad` no tiene valor por defecto: el parche tiene que entregar la fila completa para que el `INSERT` pase. No hay contrato a medio escribir posible.

---

## 3. Por qué, decisión por decisión

### 3.1 Los siete guardrails, uno por uno

Los resúmenes traducen lo que fija la v10 y lo que el propio JSON siembra; los códigos se leyeron literalmente de la base en §5.

| Guardrail | Qué comprueba                                                                                                                   | `input_dispara` (resumen)                                                                                    | Reason code                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `G19`     | No reidentificación: un actor nivel 4 no se vincula a nombre o documento sin validación humana; se propone alias                | `nivel_identidad: 4` con `vinculo_propuesto: nombre_civil` y `validado_humano: false`                        | `G19_REIDENTIFICACION`           |
| `G20`     | Cita literal: la cita debe existir literalmente en la fuente y los offsets caer dentro del texto                               | `cita_propuesta` añade «de la caleta» a un `texto_fuente` que no la tiene; `verificada_literal: false`       | `G20_CITA_NO_LITERAL`            |
| `G21`     | Aprobación humana antes de visibilidad: sin `aprobada_por`/`aprobada_en`, la visibilidad queda en `interna`                     | `visibilidad: perfil_b` con `aprobada_por` y `aprobada_en` nulos                                             | `G21_SIN_APROBACION`             |
| `G22`     | Fuente permitida: solo lista blanca y API oficial o proveedor licenciado                                                       | Scraping de un grupo de Facebook; `via: scraping`, `en_lista_blanca: false`                                  | `G22_FUENTE_NO_PERMITIDA`        |
| `G23`     | Nivel Alto antes que dato: dato identificable sin base legal ni consentimiento no se escribe                                   | `campo: dni` con `base_legal` nulo y `consentimiento: false`                                                 | `G23_SIN_BASE_LEGAL`             |
| `G24`     | Identidad sintética por defecto: perfil no analista recibe el identificador `ANI-*`, no el nombre                              | `perfil: B` con `tipo_identificador: nombre_civil` y `proyecta_pii: true`                                    | `G24_REIDENTIFICACION_EN_SALIDA` |
| `G25`     | Sin etiqueta penal sin sentencia: exige `sentencia_firme` con `documento_uri`; `bajo_investigacion` no sale a portal           | `tipo_situacion: bajo_investigacion`, `sentencia_firme: false` y `documento_uri` nulo                        | `G25_ETIQUETA_SIN_SENTENCIA`     |

### 3.2 Todas `block`, y no `warn`

La v10 §16.1.quater dice expresamente que estos guardrails «rechazan, no solo advierten». Un `warn` deja pasar el dato y deja constancia; eso no sirve para un dato personal, una cita inventada o una etiqueta penal sin sentencia. Las tres `warn` del catálogo son de frescura del dato (`G3`, «variable ICEN_N12 desactualizada»), de vigencia de la model card (`G7`) y de concentración (`G16`, «concentración alta»): avisan sobre la calidad o el contexto del dato, no sobre su legalidad, y por eso el dato sigue pasando.

### 3.3 El caso negativo cambia solo lo imprescindible

| Guardrail | Cambio que hace pasar la regla                                                                    |
| --------- | ------------------------------------------------------------------------------------------------- |
| `G19`     | `vinculo_propuesto` pasa de `nombre_civil` a `alias`                                              |
| `G20`     | `cita_propuesta` iguala `texto_fuente` y `verificada_literal` pasa a `true`                       |
| `G21`     | `aprobada_por` y `aprobada_en` dejan de ser nulos                                                 |
| `G22`     | `en_lista_blanca` pasa a `true` y `via` a `api_oficial`                                           |
| `G23`     | `base_legal` deja de ser nulo (la regla admite base legal **o** consentimiento)                   |
| `G24`     | `tipo_identificador` pasa a `sintetico` y `proyecta_pii` a `false`                                |
| `G25`     | `tipo_situacion` pasa a `sentencia_firme`, `sentencia_firme` a `true` y `documento_uri` se puebla |

Así el caso negativo se lee y se discute sin ejecutar el motor: cada `input_no_dispara` aísla la variable que la regla mide.

### 3.4 `ON CONFLICT … DO NOTHING`, y no `DO UPDATE`

La tabla tiene la clave por `guardrail` y el `INSERT` aporta siete claves.
`DO NOTHING` resuelve el conflicto sin escribir: en una base limpia inserta
las siete filas; en una base donde ya existen, no toca ninguna. El conteo no
cambia por este camino —siete claves en `VALUES`, siete filas en la tabla— y,
como solo aporta G19–G25, no puede alcanzar G1–G18.

La diferencia con el `DO UPDATE` que el archivo traía hasta el 2026-11-21 es
quién manda sobre el contenido. Aquel reescribía los cuatro JSON y la
severidad desde `EXCLUDED`: _corregía_ una fila desviada, pero también
revertía una corrección hecha por un parche posterior. La fila G21 es el caso
concreto: el parche 23 la dejó en `ejecutiva` y con `validada_por`, y una
corrida suelta del 7 la devolvía a `perfil_b` sin firma. Con `DO NOTHING` el
contenido de una fila pertenece al último parche que la escribe, y reejecutar
el 7 no puede deshacerlo.

El precio se dice sin adornos: **este parche ya no corrige una fila desviada
a mano**. Para eso está el parche que la posee —el 23, en el caso de G21—.

### 3.5 Contrato, no implementación

Las filas dicen qué debe rechazarse, no que ya se rechace. Los objetos que harían cumplir G19–G25 en ejecución se detallan en §6.

---

## 4. Migración de datos

Solo se escriben siete filas de catálogo. No hay datos de negocio, ni `UPDATE` sobre tablas de actores, alertas o procesos. Las 18 filas G1–G18 quedan intactas por dos razones: `DO NOTHING` solo puede coincidir con las claves que el `INSERT` aporta, y al coincidir no escribe. `config.parametro` no se menciona. No se escribe el `id`: las filas nuevas lo reciben de `gen_random_uuid()`, y una reejecución no lo reasigna.

El rollback está en el bloque 3 del SQL, comentado: borra las siete claves y deja la tabla en 18 filas. El `CHECK` que admite `G25` no se revierte aquí porque pertenece al parche 6.

---

## 5. Verificación con cifras medidas

### 5.1 Cifras del estado posterior

| Dato                                                         | Valor medido |
| ------------------------------------------------------------ | -----------: |
| Filas totales / guardrails distintos                         |      25 / 25 |
| Filas `block` / `warn`                                       |       22 / 3 |
| Filas de G1–G18                                              |           18 |
| Filas de G19–G25                                             |            7 |
| G19–G25 con `severidad = 'block'`                            |            7 |
| G19–G25 con `input_dispara` no nulo                          |            7 |
| G19–G25 con `input_no_dispara` no nulo                       |            7 |
| Líneas de fuente del bloque `B.2`                            |          267 |
| `guardrail_contract_guardrail_check` admite `G1`…`G25`       |           sí |
| `guardrail_contract_severidad_check` admite `block` y `warn` |           sí |

El contenido del bloque `B.2` ocupa las líneas 10404–10670 del unificado: 267 líneas, las mismas que el archivo fuente (`wc -l` = 267). Su encabezado de bloque está en la 10400.

### 5.2 Salida literal de las consultas

Las consultas del bloque 2, corridas con `psql -At -F'|'` sobre la base viva el 2026-11-21. Conteo total y reparto por severidad (2.1 y 2.2):

```
25|25
block|22
warn|3
```

Listado ordenado numéricamente (2.3), las 25 filas sin huecos:

```
G1|block|G1_PRIV
G2|block|G2_CAUSAL
G3|warn|G3_FRESH
G4|block|G4_FUENTE
G5|block|G5_TAXO
G6|block|G6_PREV
G7|warn|G7_MODEL
G8|block|G8_COM
G9|block|G9_SOB
G10|block|G10_INOC
G11|block|G11_CONS
G12|block|G12_ANON
G13|block|G13_LENTE
G14|block|G14_PROXY
G15|block|G15_NORMA
G16|warn|G16_CONC
G17|block|G17_ECA
G18|block|G18_CITES
G19|block|G19_REIDENTIFICACION
G20|block|G20_CITA_NO_LITERAL
G21|block|G21_SIN_APROBACION
G22|block|G22_FUENTE_NO_PERMITIDA
G23|block|G23_SIN_BASE_LEGAL
G24|block|G24_REIDENTIFICACION_EN_SALIDA
G25|block|G25_ETIQUETA_SIN_SENTENCIA
```

Solo G19–G25, con los dos códigos y el `ok` del caso negativo (2.4):

```
G19|block|G19_REIDENTIFICACION|true|
G20|block|G20_CITA_NO_LITERAL|true|
G21|block|G21_SIN_APROBACION|true|
G22|block|G22_FUENTE_NO_PERMITIDA|true|
G23|block|G23_SIN_BASE_LEGAL|true|
G24|block|G24_REIDENTIFICACION_EN_SALIDA|true|
G25|block|G25_ETIQUETA_SIN_SENTENCIA|true|
```

Las 18 filas previas siguen ahí (2.6): `18`. Las dos restricciones, transcritas de forma resumida (el `ANY` de la primera enumera literalmente `G1` a `G25`):

```
guardrail_contract_guardrail_check  = CHECK (guardrail = ANY (ARRAY['G1', … ,'G25']))
guardrail_contract_severidad_check  = CHECK (severidad = ANY (ARRAY['block','warn']))
```

### 5.3 Idempotencia, medida sobre la base viva

Se ejecutó el parche corregido por entrada estándar, sobre una base que ya
tenía aplicados los parches 21, 22 y 23:

```console
$ MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa -f - \
    < docs/PARCHE_7_GUARDRAILS_G19_G25.sql
…
INSERT 0 0
COMMIT
```

`INSERT 0 0`: las siete claves ya existían y `DO NOTHING` no escribió
ninguna. El estado no se movió:

| Comprobación                             | Antes        | Después      |
| ---------------------------------------- | ------------ | ------------ |
| Filas / guardrails distintos / `block`   | 25 / 25 / 22 | 25 / 25 / 22 |
| G21 `visibilidad`                        | `ejecutiva`  | `ejecutiva`  |
| G21 `validada_por` en `input_no_dispara` | presente     | presente     |

Con la versión anterior la misma orden habría devuelto `INSERT 0 7` y habría
dejado G21 en `perfil_b` sin `validada_por`, rompiendo además la verificación
de cierre del parche 23. La idempotencia deja de ser un argumento sobre el
texto y pasa a ser una salida medida.

---

## 6. Riesgos y lo que queda abierto

**1. El contrato es especificación, no implementación.** No existen todavía: la verificación determinista de offsets de G20, el rechazo de escritura de G23 sobre `core.actor_datos_personales`, la comprobación de que ninguna vista de perfil B o C proyecte nombre o documento para G24, y `core.situacion_judicial_restricta` para G25. Son los cuatro objetos que la v10 §16.1.quinquies da por no implementados.

**2. Reejecutar este parche después del 23 revertía la corrección de G21** _(cerrado el 2026-11-21 · §8)_. Verificado entonces: la fila G21 de la base ya no era la del archivo. El parche 23 (bloque 5) la dejó con `visibilidad = 'ejecutiva'` y `validada_por` en los dos inputs; el archivo del P7 seguía trayendo `perfil_b` y sin `validada_por`. Como el `ON CONFLICT` sobrescribía los cuatro JSON, una corrida manual del `97_patch_07.sql` después del `113_patch_23.sql` devolvía G21 a `perfil_b`. En una cadena limpia el orden era seguro (97 antes de 113); una reejecución suelta no lo era. Lo cerró el cambio a `DO NOTHING`.

**3. G25 no tiene tabla que lo respalde.** `core.situacion_judicial_restricta` está definida en la v10 §13.6.bis.v10 y §2.3.bis, pero no se crea aquí; la decisión de cumplimiento DC-07 la registra como pendiente.

**4. G22 depende de la lista blanca.** El contenido de la lista vive en `config.parametro` y lo siembra otro parche; aquí solo se fija el comportamiento esperado.

**5. El comentario §4.b del propio SQL quedó desactualizado** _(cerrado el 2026-11-21 · §8)_. Decía que `core.alertas_tempranas` no tenía `visibilidad`, `aprobada_por` ni `aprobada_en` «hoy». Era falso desde los parches 21 y 22. El §4.b se reescribió; el detalle está en §7.

**6. Los textos de `msg` y `fix` son una propuesta.** No consta validación del área dueña de la política; el informe archivado lo dejaba como pendiente. Las claves y los valores son coherentes con el vocabulario del esquema, pero el texto literal conviene que lo revise la OAIPCS.

---

## 7. Frases de otros documentos que quedan desactualizadas

| Documento                                                     | Dice (viejo)                                                                                                                                                                            | Debe decir (nuevo)                                                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PARCHE_7_GUARDRAILS_G19_G25.sql`, §4.b (líneas 255–263) | «`core.alertas_tempranas` no las tiene hoy: el guardrail fija el contrato antes que la columna, a propósito».                                                                           | **Aplicado el 2026-11-21.** Las tres columnas existen: `aprobada_por` y `aprobada_en` desde el parche 21, `visibilidad` desde el 22; el gate G21 es ejecutable y el parche 23 le sumó `validada_por` y los cuatro ojos. |
| `docs/_archivo/P7_G19_G25.md`, «Pendientes» 2                 | «`core.alertas_tempranas` no tiene `visibilidad`, `aprobada_por` ni `aprobada_en`».                                                                                                     | Material histórico: las tres columnas existen desde los parches 21 y 22. El informe vigente es este; el archivado no se edita.                                                                                          |
| `docs/_archivo/P7_G19_G25.md`, «Pendientes» 1 y 3             | «No existen todavía: el trigger de visibilidad de G21 …, la verificación … de G20 y la vista que no proyecta PII de G24»; «`core.situacion_judicial_restricta` … no existe en la base». | El trigger de G21 sí existe desde el parche 22 (`alertas_g21_visibilidad`); siguen ausentes la verificación de G20, la vista de G24 y la tabla de G25.                                                                  |

Lo que ya está correcto y **no** hay que cambiar: `BRECHA_CAPA_DATOS_V9.md` §14 ya dice «18 filas (G1–G18)» → «25 (G1–G25); `block` 22 / `warn` 3»; la v10 §16.1.quinquies ya dice que la tabla tiene 25 filas, y las fechas «18 de noviembre de 2026» de §16.1.quater y §16.1.quinquies son correctas; `docs/README.md` ya registra el parche 7 como aplicado el 2026-11-18 (y se actualiza aparte). Los informes `P21` y `P22` conservan sus frases sobre G21 sin ejecutar: son fotos de su momento, y el §8 del P22 ya deja constancia de que el parche 23 cerró esa pieza.

---

## 8. Actualización posterior (2026-11-21)

Se escribe después y **no reescribe** §6 ni §7, que quedan como foto del
estado que este parche dejó. Lo que sigue dice qué se corrigió, por qué y
cómo se comprobó.

### 8.1 La excepción, dicha en voz alta

El repo no edita parches cerrados; la convención la fijó el P19. Este se
editó el 2026-11-21 con autorización explícita, y el motivo se registra
aquí en vez de quedar como trampa de orden: el `DO UPDATE` revertía en
silencio la corrección de G21 que hizo el 23, y solo se descubría
reejecutando el 7 suelto. Una excepción escrita es preferible a un error
latente.

### 8.2 Qué cambió y cómo se comprobó

El `INSERT` de G19–G25 usa `ON CONFLICT (guardrail) DO NOTHING`. La
cabecera del SQL lleva el porqué; §3.4 y §5.3 están reescritos con el
criterio nuevo y con la salida medida.

| Comprobación                                                   | Resultado                                |
| -------------------------------------------------------------- | ---------------------------------------- |
| Reejecución del parche corregido sobre la base con 21, 22 y 23 | `INSERT 0 0` + `COMMIT`                  |
| Filas de `config.guardrail_contract` antes / después           | 25 / 25                                  |
| G21 `visibilidad` antes / después                              | `ejecutiva` / `ejecutiva`                |
| G21 `validada_por` en `input_no_dispara`, antes / después      | presente / presente                      |
| Salida que habría dado la versión con `DO UPDATE`              | `INSERT 0 7`, G21 de vuelta a `perfil_b` |

El caso `dispara` de G21 deja `validada_por` en `NULL` a propósito: es la
firma que falta la que debe hacer saltar la regla. La que el 23 añadió al
`input_no_dispara` es la que permite pasar.

### 8.3 Estado de los riesgos de §6

| Riesgo de §6                                        | Estado      | Quién lo cerró                                                            |
| --------------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| 1. El contrato es especificación, no implementación | **Abierto** | Siguen ausentes la verificación de G20, la vista de G24 y la tabla de G25 |
| 2. Reejecutar el 7 después del 23 revertía G21      | **Cerrado** | `DO NOTHING`: la fila ya no se reescribe                                  |
| 3. G25 no tiene tabla que lo respalde               | **Abierto** | Decisión DC-07, pendiente                                                 |
| 4. G22 depende de la lista blanca                   | **Abierto** | La siembra la hace otro parche                                            |
| 5. El §4.b del propio SQL desactualizado            | **Cerrado** | §4.b reescrito el 2026-11-21                                              |
| 6. Los textos de `msg` y `fix` son una propuesta    | **Abierto** | Falta validación del área dueña de la política                            |

### 8.4 Lo que la corrección no arregla

Con `DO NOTHING`, el 7 ya no devuelve al archivo una fila G19–G25 editada a
mano en la base. Si alguien cambia el contrato por SQL directo, el parche no
lo corrige: el contenido pertenece al parche que lo posee —el 23 para G21—.
Tampoco se mueve el reparto 22 `block` / 3 `warn`, ni ninguna cifra del
modelo.

### 8.5 Propagación

El cuerpo del parche está embebido como bloque `B.2` del unificado, así que
se regeneraron `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql` (**21 609 líneas,
1 309 699 bytes**; el contenido de `B.2` en las líneas 10404–10670) y los
derivados de `docs/sql_server/` —`AVISA_V10_ESQUEMA_SIN_FK.sql`,
`AVISA_V10_CLAVES_AJENAS.sql` e `INFORME_FKS.md`, con 532 claves ajenas
únicas y sin cambio de cifra—. El diccionario lee la base viva y no se ve
afectado. Ninguna cifra estructural del modelo cambia de valor.
