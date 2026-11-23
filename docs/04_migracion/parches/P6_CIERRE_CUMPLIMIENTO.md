# P6 — Cierre de cumplimiento y clasificación documental

**Proyecto:** AVISA / SIPRECS — OAIPCS, PRODUCE
**Marco:** ERS v0.6 — guardrails G1–G25 (§16.1.quater y §16.1.quinquies del v10), decisión de migración D16 (`tipo_documento = 'Otro'` → tipo 15 `otro`) y bitácoras inmutables (`mvp.md` §2.5, DC-11 y DC-12)
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql` (idempotente, montado como `96_patch_06.sql` en `compose.yaml`, bloque `B.1` del unificado)
**Estado:** **aplicado y verificado en la base viva el 2026-11-21.** La reclasificación
se ejecutó el 2026-11-18 —lo dicen el título de `BRECHA_CAPADATOS_V9` §13.1 y la
marca `updated_at` de las filas movidas—; el 2026-11-21 se volvió a medir.

---

## 1. Resumen

El parche hace dos cosas: amplía el `CHECK` de `config.guardrail_contract` de
G1–G18 a G1–G25, y reclasifica de tipo 15 (`Otro`) a tipo 10 (`Ayuda Memoria`) los
documentos heredados de `DIM_Redaccion`: 34 filas `RED-2026-0xx`.

La primera es la única alteración **no aditiva** del esquema: borra una restricción
y la recrea con siete valores más. La segunda es un `UPDATE` acotado, con
instantánea previa para no arrastrar a los diez `RED-` ya bien clasificados.

Las cifras de «antes» vienen del bloque 0 del SQL —medido el 2026-11-18— y de
`BRECHA_CAPADATOS_V9` §13.1; las de «después», de la base viva hoy:

| Dato                                            |       Antes |         Después |
| ----------------------------------------------- | ----------: | --------------: |
| Valores admitidos por el `CHECK` de `guardrail` | 18 (G1–G18) | **25 (G1–G25)** |
| Filas de `config.guardrail_contract`            |          18 |          **25** |
| Documentos en tipo 15 (`Otro`)                  |          37 |           **3** |
| Documentos en tipo 10 (`Ayuda Memoria`)         |          11 |          **45** |
| Documentos `RED-%` en tipo 15                   |          34 |           **0** |
| Documentos `RED-%` en tipo 10                   |          10 |          **44** |
| Documentos `RED-%` en tipo 11 (`Relatoría`)     |           7 |           **7** |
| Filas totales de `core.documentos`              |         153 |         **153** |

Las 18 filas de contrato son las que había al ejecutarse el bloque `B.1`. Hoy hay
25 porque el bloque `B.2` —el parche 7— sembró G19–G25; su verificación previa
espera 18 filas y advierte de que «el parche 6 ya lo amplió a G1–G25». Este parche
**no** siembra esas filas, no mueve los tres `CT-2026-00x` que siguen en tipo 15,
no resuelve el reparto 44/7 y no borra la instantánea: solo autoriza a hacerlo.

---

## 2. Qué cambia

| Objeto                                               | Tipo                 | Qué hace                                                                                                                                    |
| ---------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.guardrail_contract` · `CHECK` de `guardrail` | restricción recreada | Descubre por catálogo la restricción que cita `G1`, la borra y crea `guardrail_contract_guardrail_check` con 25 literales, de `G1` a `G25`. |
| `core.patch6_documentos_snapshot`                    | tabla auxiliar       | Guarda `documento_id`, `tipo_previo` y `codigo` de las 34 filas a mover; el parche autoriza retirarla tras validar.                         |
| `core.documentos.tipo_id`                            | `UPDATE` de 34 filas | Pasa de 15 a 10 donde `tipo_id = 15` y `codigo LIKE 'RED-%'`; actualiza `updated_at`.                                                       |

Todo el cuerpo va entre `BEGIN` y `COMMIT`; el bloque 0 corre **antes** del
`BEGIN`, para que un estado de partida equivocado no abra una transacción que
luego haya que deshacer a mano. El `CHECK` de `severidad` no se toca.

---

## 3. Por qué, decisión por decisión

### 3.1 El techo era G18 y el diseño ya tenía 25

El v10 describe G19–G22 en §16.1.quater y G23–G25 en §16.1.quinquies. El `CHECK`
solo admitía hasta G18, así que el contrato no podía contener lo que el diseño ya
nombraba: el parche sube el techo, no inventa códigos.

**No siembra las filas, y es deliberado.** El texto de cada guardrail —qué input lo
dispara, cuál no, qué salida se espera— es contenido, no migración: lo firman
OAIPCS y OGTI. El sembrado lo hizo el parche 7, que dejó 25 filas con reparto 22
`block` y 3 `warn`, medido hoy y coincidente con el v10 §16.1.quinquies.

**El nombre del `CHECK` se descubre, no se supone.** PostgreSQL lo genera al crear
la tabla, y el bloque `DO` lo busca por definición (`LIKE '%G1%'`). Escribirlo a
mano habría fallado o, peor, dejado dos restricciones conviviendo.

### 3.2 El `UPDATE` se limita a `RED-%`, no a todo el tipo 15

El tipo 15 también tiene tres `CT-2026-00x` que vienen de `DIM_CoordinacionTecnica`,
no de `DIM_Redaccion`, y cuyo tipo correcto no está decidido. Moverlos habría sido
adivinar. El bloque 0.5 pide revisar además cualquier documento de tipo 15 con
código nulo o no `RED-`; hoy no hay ninguno.

La correspondencia cuadra en número: `legacy.dim_redaccion` tiene 51 filas y hay 51
`RED-%`; `legacy.dim_coordinacion_tecnica` tiene 4 y hay 4 `CT-2026-%`. Es
consistencia de conteo, no prueba de linaje fila a fila.

### 3.3 La instantánea, y por qué ya no está

Sin instantánea, revertir con el criterio inverso (`tipo 10` y `codigo LIKE
'RED-%'`) habría devuelto a tipo 15 también a los diez `RED-` que ya estaban bien.
La tabla guarda el `tipo_previo` de las 34 y permite un `UPDATE ... FROM` exacto.

Hoy **no existe**: `to_regclass` devuelve nulo. La cabecera del esquema unificado lo
documenta —«En la base `avisa` ya está borrada, por eso no aparece en los
conteos»—. La fecha del `DROP` es **[EN BLANCO · a confirmar]**.

### 3.4 La trampa de RLS: un `UPDATE` que afecta 0 filas sin fallar

`core.documentos` tiene RLS activo y forzado, con 7 políticas. La sesión de este
entorno es el rol `avisa`, superusuario y con `rolbypassrls` (medido: `avisa | t |
t`). Con un rol sin `BYPASSRLS`, el `UPDATE` no falla: afecta 0 filas en silencio.
Por eso la verificación 4.2 —«ningún `RED-` queda en tipo 15»— es la que delata el
fallo, no la cuenta de filas actualizadas.

### 3.5 44 frente a 7: se documenta, no se resuelve

De los 51 `RED-%`, siete ya estaban en tipo 11 (`Relatoría`) y diez en tipo 10;
tras mover 34, quedan 44 y 7. Por título son el mismo producto: los siete de tipo
11 se llaman «REUNIÓN …» y el resto son actas y ayudas memoria de reunión.
Unificarlos exige decidir si el producto es ayuda memoria o relatoría: criterio de
contenido de la OAIPCS.

---

## 4. Migración de datos

| Concepto                       | Valor                                         |
| ------------------------------ | --------------------------------------------- |
| Criterio del `UPDATE`          | `tipo_id = 15 AND codigo LIKE 'RED-%'`        |
| Filas seleccionadas            | **34**                                        |
| Tipo anterior / posterior      | 15 (`Otro`) / 10 (`Ayuda Memoria`)            |
| `RED-%` que no se mueven       | 10 en tipo 10 y 7 en tipo 11                  |
| `CT-2026-00x` que no se mueven | 3, todos en tipo 15                           |
| Filas totales antes / después  | 153 / 153                                     |
| Segunda pasada                 | 0 filas: el criterio ya no selecciona ninguna |
| Instantánea                    | retirada; hoy no existe                       |

La prueba de que se movieron exactamente 34 no depende de la instantánea, sino de
la marca de auditoría. Agrupando los `RED-%` por `updated_at`:

```
10|2026-10-31|10
10|2026-11-18|34
11|2026-10-31|7
```

Las 34 filas de tipo 10 con marca del 2026-11-18 son las que tocó el `UPDATE` (el
parche escribe `updated_at = now()`, y `BRECHA_CAPADATOS_V9` §13.1 fecha la
corrección ese día). Las diez con marca anterior ya estaban en tipo 10; las siete
de tipo 11 no se tocaron. Los tres `CT-` de tipo 15 conservan el 2026-10-31.

No se insertó ni borró ninguna fila de `core.documentos` ni se escribió en
`config.guardrail_contract`; la única tabla creada fue la instantánea, ya retirada.

---

## 5. Verificación con cifras medidas

### 5.1 Salida de las consultas

Definición del `CHECK`, tal como la devuelve el catálogo:

```sh
MSYS_NO_PATHCONV=1 docker exec avisa-db psql -U avisa -d avisa -At -F'|' -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='config.guardrail_contract'::regclass AND contype='c';"
```

```
guardrail_contract_guardrail_check|CHECK (((guardrail)::text = ANY ((ARRAY['G1'::character varying, 'G2'::character varying, 'G3'::character varying, 'G4'::character varying, 'G5'::character varying, 'G6'::character varying, 'G7'::character varying, 'G8'::character varying, 'G9'::character varying, 'G10'::character varying, 'G11'::character varying, 'G12'::character varying, 'G13'::character varying, 'G14'::character varying, 'G15'::character varying, 'G16'::character varying, 'G17'::character varying, 'G18'::character varying, 'G19'::character varying, 'G20'::character varying, 'G21'::character varying, 'G22'::character varying, 'G23'::character varying, 'G24'::character varying, 'G25'::character varying])::text[])))
guardrail_contract_severidad_check|CHECK (((severidad)::text = ANY ((ARRAY['block'::character varying, 'warn'::character varying])::text[])))
```

Conteo de literales `G` de la definición y prueba de techo (`G19` sí, `G25` sí,
`G26` no):

```
guardrail_contract_guardrail_check|25
guardrail_contract_severidad_check|0
guardrail_contract_guardrail_check|t|t|f
guardrail_contract_severidad_check|f|f|f
```

Repartos por tipo, en el orden `RED-%` y `CT-2026-%`:

```
10|44
11|7

10|1
15|3
```

Filas del contrato, severidad, G19–G25, existencia de la instantánea, etiquetas
indebidas y total de documentos (`to_regclass` nulo = no existe):

```
25
block|22
warn|3
7
f
0
153
```

### 5.2 Resumen de comprobaciones

| Comprobación                                 | Esperado por el SQL | Medido hoy            | Veredicto              |
| -------------------------------------------- | ------------------- | --------------------- | ---------------------- |
| Valores del `CHECK` de `guardrail`           | —                   | 25, hasta `G25`       | correcto; `G26` no     |
| Filas de `config.guardrail_contract`         | 25                  | 25                    | correcto               |
| Reparto de severidad                         | —                   | 22 `block` / 3 `warn` | coincide con el v10    |
| Filas G19–G25                                | 7                   | 7                     | correcto               |
| `RED-%` en tipo 15                           | 0                   | 0                     | correcto               |
| `CT-2026-%` por tipo                         | —                   | 1 / 3                 | coincide con §13.1     |
| Etiquetas «criminal»/«saboteador» en tipo 15 | 0                   | 0                     | correcto               |
| Instantánea: 34 en tabla / 34 movidas        | 34 / 34             | no repetible          | **no verificable hoy** |

La última fila es honesta: la verificación 4.4 del SQL no puede repetirse porque
la tabla que consulta ya no existe. Su equivalente medido es el reparto por
`updated_at` de §4, que aísla las mismas 34 filas.

---

## 6. Riesgos y lo que queda abierto

**1. El reparto 44/7 sigue sin decidir, y los tres `CT-2026-00x` siguen en tipo 15.** No es defecto de migración: mientras la OAIPCS no fije si el producto es
ayuda memoria o relatoría, la misma clase de documento vive en dos tipos.

**2. Las filas del contrato existen; las implementaciones de G23–G25, no.** El
`CHECK` las admite y la tabla las contiene, pero eso es el contrato declarado, no
el rechazo efectivo. El v10 §16.1.quinquies enumera lo que falta; de esa lista pude
comprobar un objeto: `core.situacion_judicial_restricta` no existe (`to_regclass`
devuelve nulo), que es la pieza de G25.

**3. El rollback exacto ya no es ejecutable.** La sección 5 del SQL revierte con
`UPDATE ... FROM core.patch6_documentos_snapshot`, y esa tabla fue retirada. Hoy no
hay camino de vuelta sin recrear una instantánea, y el criterio inverso —`tipo 10`
y `RED-%`— seleccionaría 44 filas, no 34.

**4. El RLS sigue siendo inerte frente al rol de aplicación.** `avisa` es
superusuario y `rolbypassrls`; las 7 políticas de `core.documentos` no lo frenan.
Mientras eso no cambie (DC-02), un `UPDATE` mal escrito puede afectar 0 filas sin
error, como advierte la cabecera.

**5. La evidencia citada para G23–G25 no está donde el parche dice.** La cabecera
apunta a `mvp.md` §2.5, pero esa sección describe el schema `audit` (DC-11 y
DC-12) y no menciona G23–G25: el archivo no tiene ni una ocurrencia de «G23». La
fuente real es el v10 §16.1.quinquies y, para el contrato de prueba, §9.9.

---

## 7. Frases de otros documentos que quedan desactualizadas

Lista para que otros agentes las propaguen. «Viejo» es el texto que hay hoy;
«nuevo» es lo que debe decir. No se ha editado ninguno de estos documentos.

| Documento / sección                                          | Dice (viejo)                                                                      | Debe decir (nuevo)                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql`, cabecera, línea ~24 | «`mvp.md` §2.5 / `v10` §16.1.quinquies (G23–G25)» como evidencia                  | «`v10` §16.1.quinquies (G23–G25) y `v10` §9.9 (contrato de test)»; `mvp.md` §2.5 trata del schema `audit`, no de guardrails                                      |
| `docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql` §6(a)                | «Sembrar G19–G25 … las filas no existen: el contrato queda “abierto pero vacío”»  | Cerrado: las 25 filas existen desde el parche 7, con reparto 22 `block` y 3 `warn`; el `CHECK` las admite desde este parche (medido el 2026-11-21)               |
| `docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql` §6(b)                | «`core.actor_datos_personales`: 847 filas con `dni` en claro (642)»               | «847 filas, **0** con `dni` en claro y 642 con `dni_cifrado`»: el plano se purgó con el parche 9 (`BRECHA_CAPADATOS_V9` §14); `fecha_consentimiento` sigue vacía |
| `docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql` §6(c)                | «el RLS de 169 políticas es inerte (DC-02)»                                       | Hoy son **556 políticas sobre 91 tablas**; el P22 medía 552 sobre 90. La inercia frente a `avisa` sigue igual                                                    |
| `docs/03_ejecucion/mvp.md` §0.2, línea ~53                   | «Tres agentes (A1, A2, A3) + Guardrails G1–G18 … + los guardrails G19–G22 (§3.4)» | «Guardrails **G1–G25**»: el contrato los admite y tiene las 25 filas desde el 2026-11-18, G23–G25 incluidas                                                      |

Lo que **no** hay que cambiar: `BRECHA_CAPADATOS_V9` §13.1 ya dice «corregido el
2026-11-18», con 37 → 3 documentos en «Otro» y la inconsistencia 44/7 declarada;
su §14 registra el paso de 18 a 25 filas en el parche 7. La §11.5 de
`LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` conserva las filas 51 y 52 de la tabla
de hojas (`dim_redaccion` 51, `dim_coordinacion_tecnica` 4), correctas hoy.
`docs/README.md` lo actualiza el responsable del índice.
