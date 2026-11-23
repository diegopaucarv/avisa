# P22 — Visibilidad, G21 ejecutable y la suplencia

**Proyecto:** AVISA / SIPRECS — OAIPCS, PRODUCE
**Marco:** ERS v0.6 — G21 (§11.8, §14.4), RN-04, RD-08 y §2.2 de `mvp.md`
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_22_VISIBILIDAD_Y_G21.sql` (idempotente, re-ejecutable)
**Estado:** **aplicado y verificado en la base viva el 2026-11-20.** Se aplicó
cinco veces: las tres primeras al cerrar el SQL, y dos más en la sesión que cerró
el registro, para volver a medir la idempotencia (§5.3). La segunda pasada en
adelante devuelve `UPDATE 0` y `already exists, skipping`, y no mueve ni una
marca de auditoría.

---

## 1. Resumen

El parche 21 dejó G21 a medio camino y lo dijo: puso `aprobada_por` y
`aprobada_en` en la alerta, pero el gate pedía además una columna `visibilidad`
que no existía, así que su contrato era declarativo. Alrededor de ese hueco
quedaban cuatro pendientes más, todos anotados en el informe del P21 (§6): la
tabla `core.permiso_aprobacion` no tenía consumidor; `core.vw_alerta_estado` no
exponía la visibilidad; las 83 alertas migradas seguían con `paso_actual = 1`
mientras su proceso estaba en el paso 5; y el flujo `reporte` tenía 9 instancias
en pasos que el catálogo nuevo no define.

El parche hace seis cosas:

1. Añade `core.alertas_tempranas.visibilidad` con sus tres valores
   (`interna`, `ejecutiva`, `sectorial`), su restricción nombrada y un índice
   parcial para las que dejan de ser internas.
2. Hace **ejecutable** G21 con el trigger `alertas_g21_visibilidad`, que rechaza
   cualquier visibilidad distinta de `interna` mientras falte alguna de las dos
   aprobaciones humanas, con el _reason code_ `G21_SIN_APROBACION`.
3. Da consumidor a `core.permiso_aprobacion`: la función
   `core.puede_aprobar()` y la vista de apoyo `core.vw_permiso_aprobacion`.
4. Amplía `core.vw_alerta_estado` a 20 columnas con la visibilidad al final.
5. Corrige el desfase de `paso_actual` en las 83 alertas, **derivándolo** de
   `core.proceso_instancia`.
6. Documenta —sin ampliar el catálogo— por qué 9 instancias de `reporte` no
   tienen paso definido.

En cifras (medidas, no estimadas):

| Dato                                              |         Antes |                    Después |
| ------------------------------------------------- | ------------: | -------------------------: |
| Columnas de `core.alertas_tempranas`              |            35 |                     **36** |
| Alertas con `visibilidad` (la columna no existía) |             — |    **83**, todas `interna` |
| Alertas con `visibilidad` distinta de `interna`   |             — |                      **0** |
| Triggers `BEFORE` en `core.alertas_tempranas`     |             1 |                      **2** |
| Restricciones `CHECK` en el modelo v10            |           353 |                    **354** |
| Triggers (no internos) en el modelo v10           |            67 |                     **68** |
| Índices sobre tablas en el modelo v10             |           761 |                    **762** |
| Columnas de `core.vw_alerta_estado`               |            19 |                     **20** |
| Filas de `core.vw_alerta_estado`                  |            83 |                     **83** |
| Alertas con `paso_actual = 1`                     |            83 |                      **0** |
| Alertas con `paso_actual = 5`                     |             0 |                     **83** |
| Columnas del modelo v10 (sin / con particiones)   | 2 147 / 2 513 |          **2 148 / 2 514** |
| Filas del modelo v10                              |        13 355 |      **13 355** (sin alta) |
| Objetos derivados (vistas y matviews)             |            36 |                     **37** |
| Columnas de los objetos derivados                 |           300 |                    **311** |
| Tablas con RLS / políticas en el modelo v10       |      90 / 552 |  **90 / 552** (sin cambio) |
| Tablas con RLS / políticas en `core`              |      51 / 327 |  **51 / 327** (sin cambio) |
| Claves ajenas (modelo / únicas para SQL Server)   |     611 / 527 | **611 / 527** (sin cambio) |
| Filas en `core.permiso_aprobacion`                |             0 |         **0** (sin cambio) |
| Filas en `core.proceso_instancia`                 |           218 |       **218** (sin cambio) |
| Filas en `core.flujo_definicion`                  |            12 |        **12** (sin cambio) |
| Filas del CSV del diccionario                     |         3 320 |                  **3 321** |

Lo que el parche **no** hace, y conviene decirlo antes de cualquier tabla: no
siembra suplencias, no amplía el flujo `reporte`, no inventa aprobaciones, no
inserta ni borra filas de datos y no toca `core.proceso_instancia` ni
`core.flujo_definicion`. Se detalla en §3, §4 y §6.

---

## 2. Qué cambia

| Objeto                                       | Tipo                                  | Qué hace                                                                                       |
| -------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `core.alertas_tempranas.visibilidad`         | columna nueva                         | `varchar(12) NOT NULL DEFAULT 'interna'`, con comentario.                                      |
| `alertas_visibilidad_valida`                 | `CHECK`                               | Admite exactamente `interna`, `ejecutiva` y `sectorial`.                                       |
| `core.ix_alertas_visibilidad_no_interna`     | índice parcial                        | `(visibilidad) WHERE visibilidad <> 'interna'`.                                                |
| `core.tg_alerta_g21_visibilidad()`           | función `plpgsql`                     | Lógica del gate: acumula lo que falta y lanza `G21_SIN_APROBACION`.                            |
| `alertas_g21_visibilidad`                    | trigger                               | `BEFORE INSERT OR UPDATE FOR EACH ROW`; llama a la función anterior.                           |
| `core.puede_aprobar(uuid, text)`             | función `sql STABLE SECURITY DEFINER` | `true` si el usuario tiene `direccion_oaipcs` vigente o una suplencia vigente para ese objeto. |
| `core.vw_permiso_aprobacion`                 | vista, `security_invoker = true`      | 10 columnas: persona habilitada, objeto, vigencia, marca `vigente` y quién otorgó.             |
| `core.vw_alerta_estado`                      | `CREATE OR REPLACE VIEW`              | Conserva sus 19 columnas en el mismo orden y añade `visibilidad` al final.                     |
| `core.alertas_tempranas.paso_actual`         | `UPDATE` (83 filas, derivado)         | Pasa de 1 a 5 tomando `max(orden)` de `core.proceso_instancia` de cada alerta.                 |
| `core.proceso_instancia.flujo_definicion_id` | `COMMENT ON COLUMN`                   | Fija el significado de `NULL` en las 9 instancias de `reporte` de los pasos 4–6.               |

Todo el cuerpo va entre `BEGIN` y `COMMIT`; el bloque 0 (comprobaciones previas)
corre **antes** del `BEGIN` para que un estado de partida equivocado no abra una
transacción que luego haya que deshacer a mano —la misma disposición del P21—.

---

## 3. Por qué, decisión por decisión

### 3.1 Tres valores, no un booleano

`interna`, `ejecutiva` y `sectorial` no los inventa el parche: están diseñados en
`docs/03_ejecucion/mvp.md` §2.2 (el atributo `visibilidad` del diagrama de la
alerta) y en su matriz de acceso (§~940), donde una alerta aprobada con
visibilidad `ejecutiva` se lee en el Perfil A y en el Perfil B, y una con
visibilidad `sectorial` se lee en el Perfil C solo si el actor es destinatario.
Un booleano «publicada sí/no» habría perdido el tercer caso, que es el que
distingue «se publica en el tablero de la Alta Dirección» de «se remite a los
nombrados».

**El valor de nacimiento es `interna`, y eso es lo que hace útil al gate.** Si la
columna naciera en `ejecutiva`, una alerta recién insertada por el pipeline sería
visible para el Perfil B antes de que nadie la hubiera leído. Con `interna` por
defecto, cualquier alerta que exista sin acto humano está, por construcción,
fuera del alcance de B y C, y el gate solo tiene que custodiar la salida.

**RD-08 se cita, no se implementa aquí.** La regla prohíbe datos personales en el
canal público del Dashboard Estratégico (`Publish to Web`), sea cual sea la
visibilidad de la alerta. El comentario de la columna lo dice para que nadie lea
`ejecutiva` como un permiso para publicar lo que sea; imponer RD-08 es trabajo de
las vistas del Perfil B (G24), no de este `CHECK`.

### 3.2 G21 ejecutable, y el orden de disparadores

G21 exige dos aprobaciones humanas antes de que una alerta salga de la OAIPCS:
la validación previa del Sectorista (`es_validado_humano`, `fecha_validacion` y
el proceso en el paso 2 o posterior) y la aprobación definitiva de la Dirección
(`aprobada_por` y `aprobada_en`). El trigger las comprueba juntas, en un solo
acto, porque la aplicación escribirá la visibilidad en la misma sentencia que
registra la aprobación.

Es **`BEFORE`** y no `AFTER` por una razón de mecánica: si algo falta, la
escritura no llega a ocurrir y la aplicación recibe una excepción con nombre en
lugar de tener que detectar un `AFTER` y deshacer. Con `AFTER` la fila ya estaría
guardada.

**El orden de los `BEFORE` importa y está verificado.** PostgreSQL los ejecuta por
nombre, en orden alfabético. Sobre `core.alertas_tempranas` conviven ahora:

| Trigger                   | Momento | Eventos        | Qué hace                                            |
| ------------------------- | ------- | -------------- | --------------------------------------------------- |
| `alertas_g21_visibilidad` | BEFORE  | INSERT, UPDATE | Este parche: el gate.                               |
| `trg_audit`               | BEFORE  | INSERT, UPDATE | Rellena `created_by` / `updated_at` / `updated_by`. |
| `trg_alerta_nace`         | AFTER   | INSERT         | Crea el paso 1 en `core.proceso_instancia`.         |

Al ser alfabéticamente el primero, el gate corre antes que `trg_audit`, de modo
que una escritura rechazada tampoco deja rastro de auditoría. Y como
`trg_alerta_nace` es `AFTER`, un alta rechazada por el gate nunca llega a crear
la instancia de proceso: no puede quedar una instancia huérfana. Los tres se
comprobaron con una consulta al catálogo (§5.4).

El mensaje acumula **todo** lo que falta, no solo la primera falta, para que la
aplicación pueda decir «falta la aprobación de la Dirección» cuando ya hay
validación previa, y las dos cosas cuando no hay ninguna.

### 3.3 La suplencia: por qué `SECURITY DEFINER` y por qué no se siembra

`core.permiso_aprobacion` existe desde el parche 10 y hasta ahora nadie la leía.
Es el mecanismo para que alguien **sin** el rol `direccion_oaipcs` pueda aprobar
mientras la Dirección está ausente, sin darle el rol entero.

`core.puede_aprobar()` es `SECURITY DEFINER` porque `core.usuario_roles` tiene
RLS forzada desde el parche 16: una función que corriera con los privilegios de
quien pregunta devolvería «no» a un usuario que no puede leer la tabla, y ese
«no» sería falso. Con el dueño de la función la respuesta no depende de quién
pregunta, que es justo el contrato de una función de autorización. Es el mismo
patrón de `core.tg_flujo_def_valida_rol()` (parche 21).

La vista de apoyo va con `WITH (security_invoker = true)` por la razón inversa:
**mostrar** nombres sí debe respetar la RLS de cada sesión. Con el dueño de la
vista, un sectorista que abriera el panel vería nombres que `core.usuarios` le
oculta.

**No se siembra ni una fila.** Designar un suplente es un acto administrativo de
la OAIPCS y hoy no hay decisión tomada. La tabla sigue con **0 filas**; lo que
queda resuelto es el consumo: `core.puede_aprobar()` la consulta y
`core.vw_permiso_aprobacion` la expone, de modo que el día que la OAIPCS designe
a alguien basta un `INSERT`, sin tocar código. Se probó con una fila temporal
que se deshizo (§5.5).

### 3.4 La vista a 20 columnas

`core.vw_alerta_estado` conserva sus 19 columnas en el mismo orden y `visibilidad`
va al final, igual que el parche 21 hizo con `aprobada_por` y `aprobada_en`. Un
consumidor que lea por posición no se entera del cambio; uno que lea por nombre
encuentra la columna nueva sin que cambie nada de lo anterior. Se verificó por
arreglo, no por recuento: las 19 primeras mantienen nombre y posición y la 20.ª
es `visibilidad` (§5.1).

### 3.5 El desfase de `paso_actual`: derivado, no escrito a mano

`paso_actual` es una copia desnormalizada y nunca se sincronizó: el cargador la
rellenó con el paso del sistema anterior (1) y el parche 20 renumeró el Archivo
al paso 5 en `core.proceso_instancia`, pero no en la alerta. El paso real de una
alerta es el de su última instancia de proceso —el mismo que lee la vista—, así
que el `UPDATE` lo toma de ahí con un `max(orden)` agrupado por alerta. **No hay
un `SET paso_actual = 5` literal.**

Y el criterio se comprueba antes de aplicarlo: si el desfase no cubriera
exactamente 83 filas —o alguna derivara a un paso distinto de 5— el bloque lanza
una excepción y el parche se detiene, en vez de forzar el número. Medido: cubrió
exactamente 83, porque cada alerta tiene una y solo una instancia en el paso 5
(26 alertas solo en el 5; 43 en 1 y 5; 13 en 2 y 5; 1 en 3 y 5).

La guarda de idempotencia es `IS DISTINCT FROM`: en la segunda pasada no hay
filas que cumplan el predicado, de modo que `updated_at` no se reescribe. En la
primera sí se movió, y es correcto: la fila cambió de verdad (lo captura
`trg_audit`).

### 3.6 Los 9 pasos de `reporte`: se documentan, no se inventan

`core.flujo_definicion` define tres pasos de reporte (1 Elaboración, 2 Remisión,
3 Archivo). `core.proceso_instancia` tiene 9 instancias de `reporte` en los pasos
4, 5 y 6 sin `flujo_definicion_id`: son pasos del sistema anterior, que tenía
seis. La evidencia está en sus propias notas:

| Paso | Instancia | Nota del legado                                   |
| ---- | --------- | ------------------------------------------------- |
| 4    | `PR-004`  | _(sin nota)_                                      |
| 4    | `PR-010`  | _(sin nota)_                                      |
| 4    | `PR-016`  | _(sin nota)_                                      |
| 5    | `PR-005`  | «Mesa de diálogo convocada por DVPA»              |
| 5    | `PR-011`  | «Reunión DVPA con gremios pesqueros»              |
| 5    | `PR-017`  | «En seguimiento activo - paro indefinido latente» |
| 6    | `PR-006`  | «Caso cerrado tras desbloqueo del puente»         |
| 6    | `PR-012`  | «Archivado tras desescalamiento»                  |
| 6    | `PR-018`  | «Pendiente resolución del conflicto»              |

Ampliar el catálogo a seis pasos habría sido peor que dejarlo así: crearía tres
pasos que nadie definió, con un rol responsable inventado y un estado resultante
sacado de la nada, y el flujo de reporte del sistema nuevo pasaría a tener seis
pasos «porque el anterior los tenía». La alternativa de mapear el paso 6
(Archivado) al 3 (Archivo) tampoco vale: reescribiría la historia de un reporte
archivado en febrero de 2026 como si hubiera pasado por un flujo que no existía,
y el estado del paso 3 es `Atendido`, no `Archivado`.

Así que `NULL` significa exactamente «paso del sistema anterior sin equivalente»
y se dice en el comentario de la columna. El bloque 6 vuelve a comprobar que son
9 y que ninguna otra instancia del modelo tiene el enlace vacío; si alguien
ampliara el catálogo antes, el parche aborta para no dejar mintiendo la nota.

---

## 4. Migración de datos

### 4.1 `core.alertas_tempranas.paso_actual`

| Concepto                            | Valor                                           |
| ----------------------------------- | ----------------------------------------------- |
| Filas que el criterio seleccionó    | **83** (exactamente las esperadas)              |
| Valor anterior                      | 1, en las 83                                    |
| Valor posterior                     | 5, derivado de `max(orden)` del proceso         |
| Filas tocadas que no fueran alertas | 0 (el criterio filtra `tipo_origen = 'alerta'`) |
| Segundo pase                        | `UPDATE 0`                                      |

Ninguna otra fila del modelo cambió. En particular, `core.casos` (36 instancias
de proceso) y `core.reporte` (27) no tenían desfase y no se tocaron.

### 4.2 Nada más se escribe

- `core.permiso_aprobacion` sigue con **0 filas**.
- `core.proceso_instancia` sigue con **218 filas**.
- `core.flujo_definicion` sigue con **12 filas**.
- `core.usuario_roles` sigue con **36 asignaciones**.
- Las 83 alertas siguen con `aprobada_por` en `NULL` y con `visibilidad =
'interna'`: la corrección de `paso_actual` no es una aprobación ni la
  insinúa.

La fila de prueba de la propia verificación del parche se inserta y se borra
dentro de la transacción; el recuento vuelve a 83 antes del `COMMIT` y el bloque
7 lo comprueba.

---

## 5. Verificación con cifras medidas

### 5.1 Cifras del estado posterior

Medidas en la base viva con consultas directas al catálogo, no estimadas:

| Dato                                                           |  Valor medido |
| -------------------------------------------------------------- | ------------: |
| Columnas de `core.alertas_tempranas`                           |            36 |
| Columnas de `core.vw_alerta_estado`                            |            20 |
| Columnas de `core.vw_permiso_aprobacion`                       |            10 |
| Filas de `core.vw_alerta_estado`                               |            83 |
| Alertas en `visibilidad = 'interna'`                           |            83 |
| Alertas en otro valor de `visibilidad`                         |             0 |
| Alertas con `paso_actual = 5`                                  |            83 |
| Alertas con `paso_actual <> 5`                                 |             0 |
| Alertas cuyo `max(orden)` de proceso es 5 y `paso_actual` es 5 |            83 |
| Triggers `BEFORE` en `core.alertas_tempranas`                  |             2 |
| Restricciones `CHECK` del modelo / triggers                    |      354 / 68 |
| Índices sobre tablas del modelo                                |           762 |
| Columnas lógicas / con particiones                             | 2 148 / 2 514 |
| Filas del modelo                                               |        13 355 |
| Tablas con RLS / políticas (modelo)                            |      90 / 552 |
| Tablas con RLS / políticas (`core`)                            |      51 / 327 |
| Claves ajenas (modelo / únicas)                                |     611 / 527 |
| Filas del CSV del diccionario                                  |         3 321 |

El orden y los nombres de las 20 columnas de la vista se comprobaron por arreglo
contra la lista literal; no se aceptó el recuento solo. Las 19 primeras son las
mismas y en el mismo orden que el parche 21 dejó.

Reparto por capas del CSV de prioridad (265 tablas lógicas, sin cambio respecto
del P21): **T0 34 · T1 12 · T2 76 · T3 22 · T4 121**; columnas **367 / 99 / 542 /
226 / 914**, que suman 2 148.

### 5.2 Salida literal de una pasada completa

Ejecutada por entrada estándar, porque los _bind mounts_ de `avisa-db` se fijaron
al crear el contenedor y llegan solo hasta `109_patch_19.sql`: ni el 21 ni el 22
están dentro. El `mount` `112_patch_22.sql` queda disponible tras el próximo
`docker compose up -d`, que recrea el contenedor.

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
    -v ON_ERROR_STOP=1 -f - < docs/PARCHE_22_VISIBILIDAD_Y_G21.sql
```

Pasada posterior a la primera (exit 0):

```
PARCHE 22 · bloque 0/8 · comprobaciones previas
DO
BEGIN
PARCHE 22 · bloque 1/8 · la visibilidad de la alerta
NOTICE:  PARCHE 22 · estado de partida coherente
NOTICE:  column "visibilidad" of relation "alertas_tempranas" already exists, skipping
ALTER TABLE
DO
COMMENT
CREATE INDEX
PARCHE 22 · bloque 2/8 · G21 ejecutable
NOTICE:  relation "ix_alertas_visibilidad_no_interna" already exists, skipping
CREATE FUNCTION
DROP TRIGGER
CREATE TRIGGER
COMMENT
PARCHE 22 · bloque 3/8 · la suplencia del aprobador
CREATE FUNCTION
COMMENT
COMMENT
CREATE VIEW
COMMENT
PARCHE 22 · bloque 4/8 · core.vw_alerta_estado con visibilidad
CREATE VIEW
COMMENT
PARCHE 22 · bloque 5/8 · desfase de paso_actual
DO
NOTICE:  desfase de paso_actual: 0 alertas por corregir
UPDATE 0
COMMENT
PARCHE 22 · bloque 6/8 · los pasos de reporte sin definición
COMMENT
DO
PARCHE 22 · bloque 7/8 · verificación
NOTICE:  reporte: 27 instancias, 9 sin definición (pasos 4-6) · paso 4: (sin nota) · paso 4: (sin nota) · paso 4: (sin nota) · paso 5: Mesa de diálogo convocada por DVPA · paso 5: Reunión DVPA con gremios pesqueros · paso 5: En seguimiento activo - paro indefinido latente · paso 6: Caso cerrado tras desbloqueo del puente · paso 6: Archivado tras desescalamiento · paso 6: Pendiente resolución del conflicto
NOTICE:  visibilidad: 83 alertas internas · alertas_tempranas: 36 columnas · vw_alerta_estado: 20 columnas y 83 filas · paso_actual: 83 en el paso 5 · permiso_aprobacion: 0 filas · proceso_instancia: 218
DO
COMMIT
PARCHE 22 · aplicado
```

Los dos `already exists, skipping` y el `UPDATE 0` son la prueba de que esa pasada
fue posterior a la primera: la primera devolvió `ALTER TABLE … ADD COLUMN` sin
`NOTICE` de omisión, `CREATE INDEX` de verdad, `desfase de paso_actual: 83
alertas por corregir` y `UPDATE 83`.

### 5.3 Idempotencia, medida con la marca de auditoría

La prueba dura es `updated_at`, que `trg_audit` reescribe en cada actualización
real. Se leyó antes y después de volver a aplicar el parche entero:

```
antes   → 2026-11-20 22:34:52.351699-05
pasada  → exit=0 · UPDATE 0 · already exists, skipping (columna e índice)
después → 2026-11-20 22:34:52.351699-05
```

Idéntica. Esa marca es la de la **primera** aplicación, que sí movió las 83
filas; ninguna pasada posterior la ha tocado.

Las sentencias que se ejecutan en cada pasada son las que no escriben datos:
`CREATE OR REPLACE FUNCTION/VIEW`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` y
`COMMENT ON`, que reemplaza el comentario anterior. Recrear una función o un
trigger no cambia su definición efectiva.

### 5.4 Prueba funcional del gate, sin dejar rastro

Dentro de una transacción con `SAVEPOINT`s, sobre una fila temporal que se borra
al final:

```
alta de la fila de prueba (visibilidad por defecto: interna)  → aceptada
UPDATE a ejecutiva sin ninguna aprobación
  → ERROR:  G21_SIN_APROBACION: la alerta P22-DEMO no puede pasar a visibilidad
     «ejecutiva»; falta la validación previa del Sectorista (es_validado_humano,
     fecha_validacion y paso_actual >= 2) y la aprobación definitiva de la
     Dirección de la OAIPCS (aprobada_por y aprobada_en)
    CONTEXT:  PL/pgSQL function core.tg_alerta_g21_visibilidad() line 23 at RAISE
UPDATE a sectorial con la validación previa puesta y sin la Dirección
  → ERROR:  G21_SIN_APROBACION: la alerta P22-DEMO no puede pasar a visibilidad
     «sectorial»; falta la aprobación definitiva de la Dirección de la OAIPCS
     (aprobada_por y aprobada_en)
UPDATE a ejecutiva con las dos aprobaciones
  → UPDATE 1 · visibilidad = ejecutiva · paso_actual = 5
la vista proyecta visibilidad = ejecutiva
ROLLBACK
```

El segundo mensaje nombra **solo** lo que falta: es la prueba de que el gate no
devuelve un texto fijo. El primero nombra las dos. El código de error es `P0001`
y la verificación del propio parche lo comprueba con `RETURNED_SQLSTATE`, además
de comprobar que el mensaje empieza por `G21_SIN_APROBACION:`.

El bloque 7 del parche repite estas tres pruebas dentro de su transacción y las
mete en la misma pasada, de modo que la comprobación viaja con el archivo. Si el
gate aceptara una visibilidad sin aprobación, el parche abortaría y se desharía
entero.

También se comprobó que el `CHECK` sigue mandando por su cuenta: con la fila ya
aprobada, un `UPDATE` a `visibilidad = 'perfil_b'` falla con `check_violation`.
El trigger no sustituye a la restricción.

Al terminar: 83 alertas, 0 filas de prueba, 83 internas.

### 5.5 `puede_aprobar` y la suplencia

```
core.puede_aprobar(SEC-11)                    → t
core.puede_aprobar(AUT-002)                   → f
core.puede_aprobar(NULL)                      → f
core.puede_aprobar(uuid inexistente)          → f
```

Con una fila temporal en `core.permiso_aprobacion` (`AUT-002`,
`objeto = 'aprobacion_alerta'`, vigencia abierta), dentro de una transacción que
se deshace:

```
core.puede_aprobar(AUT-002)                          → t
core.puede_aprobar(AUT-002, 'otro_objeto')           → f
core.vw_permiso_aprobacion                            → 1 fila, vigente = t
```

Tras el `ROLLBACK`: 0 filas. La tabla no ganó ni un suplente.

### 5.6 Los objetos derivados

| Objeto                         |        Antes |      Después |
| ------------------------------ | -----------: | -----------: |
| Vistas (objetos)               |           30 |       **31** |
| Columnas de las vistas         |          263 |      **274** |
| Tablas materializadas          |            6 |            6 |
| Columnas de las matviews       |           37 |           37 |
| **Total (objetos / columnas)** | **36 / 300** | **37 / 311** |

La cuenta cuadra: 300 + 1 columna de `vw_alerta_estado` + 10 de
`vw_permiso_aprobacion` = 311.

### 5.7 La cadena regenerada

En el orden de `FLUJO_BASE_MVP_Y_MIGRACION.md` §5.6, con la base encendida:

```sh
python migration/generar_comentarios_sql.py   # 259 tablas · 2 067 columnas (2 326 comentarios)
python migration/consolidar_esquema.py        # 25 bloques · 20 857 líneas · 1 243 KB
python migration/generar_diccionario.py       # CSV 3 321 filas · 37 vistas · 0 sin clasificar
python migration/reporte_estadistica.py       # 2 514 columnas · 611 FK · 354 CHECK · 762 índices
python migration/prioridad_mvp.py             # T0 34 · T1 12 · T2 76 · T3 22 · T4 121
python migration/extraer_fks.py               # 527 FK únicas → sql_server/*
```

Nada se editó a mano en los generados. El unificado incluye el parche como bloque
**B.17** (917 líneas) y su encabezado dice ya «parches 6-22», «2 514 columnas» y
«3 321 columnas» con el legado. Ese último número estaba en **3 318** y era
incoherente incluso antes de este parche (2 513 + 807 daba 3 320): se corrigió a
la suma real, 2 514 + 807 = 3 321.

---

## 6. Riesgos y lo que queda abierto

**1. La visibilidad `sectorial` no tiene todavía a quién remitir.** El MVP
describe el valor como «solo para los destinatarios nombrados», pero `core` no
tiene una tabla de destinatarios de alerta: el puente del MVP-45 mapea
`core.alerta_destinatario` a `core.alertas_actores` «≈». Hoy el `CHECK` admite
`sectorial` y el gate lo exige con las dos firmas, pero quién lo ve del lado del
Perfil C lo tendrá que resolver la vista o la política cuando exista esa pieza.
No es un defecto del parche: es una dependencia declarada.

**2. Las 83 alertas migradas no pueden publicarse con un solo `UPDATE`.** El gate
pide `fecha_validacion` no nula para salir de `interna`, y las 83 la tienen en
`NULL` porque el sistema anterior nunca registró la validación previa. Que ahora
`paso_actual = 5` no cambia eso: la columna de paso es una copia del proceso, no
una firma. Publicar una de esas alertas exige que una persona la valide primero,
que es exactamente lo que G21 quiere decir.

**3. El contrato G21 de `config.guardrail_contract` sigue con un valor que el
`CHECK` no admite.** La fila del gate usa `{"visibilidad": "perfil_b"}` en su
JSON, herencia del diseño anterior a este parche, mientras que la columna admite
`ejecutiva` en su lugar. Son dos representaciones del mismo concepto que ya no
coinciden. No se toca aquí porque cambiar el contrato es una decisión de
especificación, no de esquema. La corrección propuesta, **sin aplicar**:

```sql
-- NO APLICADO. El contrato G21 debe hablar el vocabulario de la columna.
-- UPDATE config.guardrail_contract
--    SET contrato = jsonb_set(contrato, '{visibilidad}', '"ejecutiva"')
--  WHERE codigo = 'G21';
```

**4. `core.permiso_aprobacion` sigue con 0 filas.** Es deliberado (§3.3). El
consumo está resuelto; la designación de un suplente es un acto administrativo
de la OAIPCS que no consta.

**5. `visibilidad` no está en la curaduría de columnas, y es a propósito.**
`migration/generar_comentarios_sql.py` genera `PARCHE_12` a partir de
`curacion_v10_columnas.COLUMNAS`, y ese parche es el bloque **B.13**, que corre
**antes** de B.17. Si la columna estuviera en la curaduría, el archivo unificado
emitiría `COMMENT ON COLUMN core.alertas_tempranas.visibilidad` sobre una columna
que aún no existe y la reconstrucción desde cero fallaría. El parche 21 hizo lo
mismo con `aprobada_por` y `aprobada_en`. La descripción **sí** llega al
diccionario, porque `generar_diccionario.py` lee `col_description` de la base y
es B.17 quien fija el comentario. La alternativa limpia —mover B.13 después de
B.17— reordenaría la cadena entera y no se ha hecho aquí.

**6. El gate no impone «quien valida no aprueba».** Sigue abierto como en el P21
(punto 4): una persona con dos roles podría validar en una sesión y aprobar en
otra. Haría falta una condición de persona (`aprobada_por <> validada_por`) y una
columna que registre quién validó; hoy `es_validado_humano` es un booleano sin
autor. Queda con H-79.

**7. Los 9 pasos de `reporte` siguen sin definición.** Es una decisión
documentada (§3.6), no un pendiente. Si el módulo de reportes entra en alcance,
el camino correcto es definir los pasos nuevos en `core.flujo_definicion` y
mapear las instancias históricas entonces, no ahora a ciegas. Las dos
alternativas descartadas, para que quede el rastro:

```sql
-- (b) DESCARTADA: ampliar el catálogo a seis pasos.
--     Inventa tres pasos, su rol responsable y su estado resultante.
-- INSERT INTO core.flujo_definicion (tipo_flujo, orden, codigo, nombre, rol_responsable, estado_resultante)
-- VALUES ('reporte', 4, 'V10-REP-04', 'Mesa de diálogo', 'sectorista', 'En_proceso'),
--        ('reporte', 5, 'V10-REP-05', 'Seguimiento',   'sectorista', 'En_proceso'),
--        ('reporte', 6, 'V10-REP-06', 'Cierre',        'sectorista', 'Archivado');
--     (`En_proceso` es la forma legada de `En proceso`; la alternativa no se aplicó.)

-- (c) DESCARTADA: mapear el paso 6 al 3 (Archivo).
--     Reescribe la historia de reportes archivados en febrero de 2026 y el
--     estado del paso 3 es «Atendido», no «Archivado».
-- UPDATE core.proceso_instancia pi
--    SET flujo_definicion_id = (SELECT id FROM core.flujo_definicion
--                                WHERE tipo_flujo='reporte' AND orden=3)
--  WHERE pi.tipo_origen='reporte' AND pi.orden=6;
```

**8. Propagación: cerrada en los artefactos, abierta en lo documental.**

- `compose.yaml` monta el parche como `112_patch_22.sql`, a continuación del
  `111`, y `docker compose config --quiet` pasa. En el contenedor actual el
  montaje llega solo al `109`; el archivo entra con el próximo
  `docker compose up -d`.
- `migration/consolidar_esquema.py` lo incorpora como bloque **B.17**, justo
  después de B.16, con `tolera_errores=False`.
- `migration/curacion_vistas.py` documenta por fin el propósito de
  `core.vw_alerta_estado` (era el pendiente 7 del P21) y añade
  `core.vw_permiso_aprobacion`.
- `migration/curacion_v10.py` y `migration/curacion_v10_columnas.py` reciben el
  texto **literal** que el parche escribe en tres comentarios
  (`core.permiso_aprobacion`, `core.proceso_instancia.flujo_definicion_id` y
  `core.alertas_tempranas.paso_actual`), para que el diccionario y el
  `PARCHE_12` regenerado no contradigan a la base.
- `migration/loader/checks.py` **no necesitó cambios**: la expectativa de
  `usuario_roles` ya es el rango `(34, 36)` que dejó el P21, y no hay ninguna
  sobre `paso_actual`, `visibilidad` ni el número de columnas de la alerta.
- `migration/tests/*.sql` tampoco: `test_15_roles.sql` inserta alertas con
  `(codigo_alerta)` o `(codigo_alerta, nivel_clasificacion)`, de modo que el
  `DEFAULT 'interna'` los deja pasar por el gate en su primera línea;
  `test_migracion_mssql.sql` fija el recuento de `core.alertas_tempranas` en 83
  (sin cambio) y sus tres comprobaciones de tipo buscan columnas `uuid` con
  `DEFAULT`, `ARRAY` y `jsonb` (12 esperadas), ninguna de las cuales toca este
  parche. No se ejecutaron aquí: necesitan roles y datos de prueba, y su
  contrato no cambia.

Lo que queda abierto es documental y de otro dueño. §7 lista las frases exactas.

---

## 7. Frases de otros documentos que quedan desactualizadas

Lista para que otros agentes las propaguen. «Viejo» es el texto que hay hoy;
«nuevo» es lo que debe decir. No se ha editado ninguno de estos documentos en
este parche.

### 7.1 `docs/01_requisitos/ERS_AVISA_PRODUCE_v0.6.md`

| Sección / línea            | Dice (viejo)                                                                                                                                                                                              | Debe decir (nuevo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §12.1, línea ~1433         | «`core.alertas_tempranas` tiene **35 columnas**: a las 33 anteriores se suman `aprobada_por` … y `aprobada_en`»                                                                                           | «tiene **36 columnas**: a las 35 del parche 21 se suma `visibilidad` (`varchar(12)`, por defecto `interna`, con `CHECK` de tres valores), que es la columna que el gate lee»                                                                                                                                                                                                                                                                                                      |
| §12.1, línea ~1433         | «`core.vw_alerta_estado` proyecta esas dos columnas al final y pasa de 17 a **19 columnas**, con las mismas 83 filas»                                                                                     | «proyecta esas dos columnas y `visibilidad` al final y pasa de 19 a **20 columnas**, con las mismas 83 filas»                                                                                                                                                                                                                                                                                                                                                                     |
| §12.1, línea ~1433         | «El gate **G21 todavía no es ejecutable**: pide además la columna `visibilidad`, que llega con otro parche.»                                                                                              | «El gate **G21 es ejecutable desde el parche 22**: el trigger `alertas_g21_visibilidad` rechaza con `G21_SIN_APROBACION` cualquier visibilidad distinta de `interna` mientras falte la validación previa del Sectorista o la aprobación definitiva de la Dirección.»                                                                                                                                                                                                              |
| §22 Anexo B.2, línea ~2455 | «G21 avanza media pieza: `core.alertas_tempranas` pasa de 33 a **35 columnas** … para que el gate sea ejecutable falta todavía la columna `visibilidad`.»                                                 | «G21 avanza media pieza: `core.alertas_tempranas` pasa de 33 a **35 columnas** …» (la frase se cierra aquí, y la novena pasada cuenta el resto)                                                                                                                                                                                                                                                                                                                                   |
| §22 Anexo B.2, línea ~2455 | «`core.vw_alerta_estado` pasa a **19 columnas** … y las cifras del modelo quedan en **2 147 columnas lógicas**, **13 355 filas**, **90 tablas con RLS y 552 políticas** (**51 y 327** dentro de `core`).» | La octava pasada se conserva como foto de su momento; se **añade** una «**Novena pasada del 2026-11-20**» con: 36 columnas en la alerta, `vw_alerta_estado` a 20, el trigger de G21, `core.puede_aprobar()`, `vw_permiso_aprobacion`, `paso_actual = 5` en las 83, **2 148 columnas lógicas**, **2 514 con particiones**, **13 355 filas**, **90 tablas con RLS y 552 políticas** (**51 y 327** en `core`), **37 objetos derivados con 311 columnas** y **3 321 filas** en el CSV |

### 7.2 `docs/02_arquitectura/AVISA_PRODUCE_v10.md`

| Sección / línea              | Dice (viejo)                                                                                                                                                                                                      | Debe decir (nuevo)                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §16.1.quater, línea ~5981    | «un _trigger_ rechaza `visibilidad ≠ 'interna'` si falta alguna de las dos (las dos columnas existen desde el parche 21; el _trigger_ es el diseño y aún no existe, porque falta `visibilidad`, §16.1.quinquies)» | «un _trigger_ rechaza `visibilidad ≠ 'interna'` si falta alguna de las dos: `alertas_g21_visibilidad`, `BEFORE INSERT OR UPDATE`, creado por el parche 22 junto con la columna `visibilidad`»                                             |
| §16.1.quinquies, línea ~5998 | «No existen todavía: el trigger de visibilidad de G21 (falta `visibilidad`; `aprobada_por` y `aprobada_en` existen desde el parche 21), la verificación determinista …»                                           | «No existen todavía: la verificación determinista de offsets de G20, el rechazo de escritura de G23 …, la comprobación automática … de G24, y `core.situacion_judicial_restricta` para G25.» (se **quita** el trigger de G21 de la lista) |
| §11.8, línea ~4701           | «`core.permiso_aprobacion` (usuario, objeto, vigencia) sigue siendo el mecanismo … Hoy la tabla tiene 0 filas y ningún consumidor.»                                                                               | «… Hoy la tabla tiene 0 filas, porque no hay suplente designado, pero ya tiene consumidor: `core.puede_aprobar()` la consulta y `core.vw_permiso_aprobacion` la expone a la administración (parche 22).»                                  |

### 7.3 `docs/03_ejecucion/mvp.md`

| Sección / línea             | Dice (viejo)                                                                                                                                                                                                                                             | Debe decir (nuevo)                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.4, línea ~1080           | «`core.vw_alerta_estado` las proyecta al final, hasta **19 columnas**»                                                                                                                                                                                   | «… hasta **20 columnas** (la 20.ª es `visibilidad`)»                                                                                                                                                                                                                        |
| §3.4, línea ~1080           | «Lo que sigue faltando es (a) la columna **`visibilidad`**, sin la cual el gate G21 no es ejecutable y su trigger no existe, y (b) el consumidor de **`core.permiso_aprobacion`** para la suplencia, que sigue con **0 filas** y sin código que lo lea.» | «El **parche 22** cerró las dos piezas: `visibilidad` existe con tres valores y el trigger `alertas_g21_visibilidad` hace ejecutable G21, y `core.puede_aprobar()` es el consumidor de `core.permiso_aprobacion` (que sigue con 0 filas porque no hay suplente designado).» |
| §3.4, encabezado del bloque | «**Lo que todavía falta.**»                                                                                                                                                                                                                              | «**Lo que falta y lo que no.**» (el bloque ya no introduce solo carencias)                                                                                                                                                                                                  |

### 7.4 `docs/05_datos/BRECHA_CAPA_DATOS_V9.md`

| Sección / línea                     | Dice (viejo)                                                                                                                                                                                                                  | Debe decir (nuevo)                                                                                                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §~1212-1214 (lista de lo que falta) | «**Las columnas que G21 necesita.** `core.alertas_tempranas` no tiene `visibilidad`, `aprobada_por` ni `aprobada_en`. El contrato de G21 está sembrado y verificado (parche 7), pero vigila columnas que todavía no existen.» | «**Las columnas que G21 necesita.** Ya existen: `aprobada_por` y `aprobada_en` desde el parche 21 y `visibilidad` desde el 22, con el trigger `alertas_g21_visibilidad` que hace efectivo el contrato del parche 7. Este punto deja de ser una brecha.» |

### 7.5 `docs/README.md`

| Sección / línea                                                                  | Dice (viejo)                                                                                                                                                                                                                                                                                                                                                                    | Debe decir (nuevo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cabecera, nota de pasadas (línea ~5)                                             | «… **2 147 columnas lógicas**, **13 355 filas**, 36 objetos derivados con **300 columnas**, **611 claves ajenas** … y **3 320 filas** en el CSV del diccionario. Queda dicho lo que el parche **no** hizo: G21 sigue sin poder ejecutarse, porque a `core.alertas_tempranas` le falta la columna `visibilidad`, y el flujo `reporte` conserva sus 9 instancias sin definición.» | Añadir «**Novena pasada del 2026-11-20:**» con el parche 22 (36 columnas, `vw_alerta_estado` a 20, gate G21 ejecutable, `core.puede_aprobar()`, `vw_permiso_aprobacion`, `paso_actual = 5`), y cerrar con: **2 148 columnas lógicas**, **2 514 con particiones**, **13 355 filas**, **90 tablas con RLS y 552 políticas** (**51 / 327** en `core`), **37 objetos derivados con 311 columnas** y **3 321 filas** en el CSV. Lo que queda: la visibilidad `sectorial` sin tabla de destinatarios y el flujo `reporte` con sus 9 instancias sin definición (documentadas, no ampliadas) |
| Árbol de archivos, línea ~74                                                     | «16 PARCHE_6…PARCHE_21.sql parches 6–21 · se aplican a mano tras la carga»                                                                                                                                                                                                                                                                                                      | «17 PARCHE_6…PARCHE_22.sql · parches 6–22»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Tabla de documentos, línea ~103                                                  | «aplicar los parches 6–21»                                                                                                                                                                                                                                                                                                                                                      | «aplicar los parches 6–22»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Tabla de parches, líneas ~136-138                                                | fila del 21 sin sucesora; «sección B (post-carga, parches 6–21)»; «los 16 parches post-carga (6–21)»                                                                                                                                                                                                                                                                            | añadir la fila «`PARCHE_22_VISIBILIDAD_Y_G21.sql` · **vigente · aplicado 2026-11-20** · visibilidad y G21 ejecutable · montado como `112`»; «parches 6–22»; «los 17 parches post-carga (6–22)»                                                                                                                                                                                                                                                                                                                                                                                       |
| Índice de parches por número, línea ~204                                         | última fila: «21 · `PARCHE_21_DIRECCION_Y_FLUJO.sql` …»                                                                                                                                                                                                                                                                                                                         | añadir «22 · `PARCHE_22_VISIBILIDAD_Y_G21.sql` · Visibilidad, gate G21 ejecutable y consumidor de la suplencia · post-carga, a mano»                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Nota «Por qué los parches 6–21 no van en el `initdb`», línea ~206 (y ~422, ~523) | «parches 6–21»                                                                                                                                                                                                                                                                                                                                                                  | «parches 6–22»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| «Medición del 2026-11-20», líneas ~276-299                                       | «tras los parches 6–21»; «**2 147 columnas lógicas**»; «Objetos derivados: **36** (30 vistas y 6 tablas materializadas) con 300 columnas»; «**3 320 filas**»                                                                                                                                                                                                                    | «tras los parches 6–22»; «**2 148 columnas lógicas**»; «**37** (31 vistas y 6 tablas materializadas) con **311 columnas**»; «**3 321 filas**»                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| «Los 21 SQL que `compose.yaml` monta», línea ~368                                | «los **21 SQL** … `PARCHE_6` a `PARCHE_21` (dieciséis)»                                                                                                                                                                                                                                                                                                                         | «los **22 SQL** … `PARCHE_6` a `PARCHE_22` (diecisiete)»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tabla de montajes, línea ~430                                                    | «Parches 6–21 · `PARCHE_6…PARCHE_21` (dieciséis) · `96`–`111`»                                                                                                                                                                                                                                                                                                                  | «Parches 6–22 · (diecisiete) · `96`–`112`»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 7.6 `docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md`

| Sección / línea                        | Dice (viejo)                                                                                                                                         | Debe decir (nuevo)                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §~72                                   | «Los parches 6–21 **no** se aplican aquí»                                                                                                            | «Los parches 6–22 **no** se aplican aquí»                                                                                                                                                                                                                                                                                         |
| §~77-82                                | «`91_patch_01.sql` … `111_patch_21.sql`»; «Son **21 montajes de parche** … los 16 `PARCHE_6`…`PARCHE_21`, de `96_patch_06.sql` a `111_patch_21.sql`» | «… `112_patch_22.sql`»; «**22 montajes** … los 17 `PARCHE_6`…`PARCHE_22`, de `96_patch_06.sql` a `112_patch_22.sql`»                                                                                                                                                                                                              |
| §~190                                  | «con los parches 6–21 aplicados»                                                                                                                     | «con los parches 6–22 aplicados»                                                                                                                                                                                                                                                                                                  |
| §9, título y §~252-254                 | «9. Aplicación de los parches 6–21 (post-carga)»; «Los parches 6–21 no …»                                                                            | «6–22» en ambos                                                                                                                                                                                                                                                                                                                   |
| §9, tras el bloque del 21 (línea ~421) | (no hay bloque del 22)                                                                                                                               | añadir: «El 22 hace ejecutable G21 y cierra la visibilidad:» + el comando `-f - < docs/PARCHE_22_VISIBILIDAD_Y_G21.sql`, su `NOTICE` de cierre y la frase de que es idempotente (se ejecutó cinco veces)                                                                                                                          |
| §~440-443                              | «El 21 tampoco mueve tablas … y deja **2 147 columnas lógicas** y **552 políticas RLS sobre 90 tablas**»                                             | añadir, tras esa frase: «El 22 tampoco mueve tablas: suma una columna, una restricción, un índice parcial, un trigger, una función y una vista, y deja **2 148 columnas lógicas**, **354 CHECK**, **68 triggers**, **762 índices** y **37 objetos derivados con 311 columnas**; las políticas siguen en **552 sobre 90 tablas**.» |
| §10, lista de archivos, línea ~514     | «`docs/PARCHE_21_DIRECCION_Y_FLUJO.sql` parche 21 (post-carga, §9)»                                                                                  | añadir la línea «`docs/PARCHE_22_VISIBILIDAD_Y_G21.sql` parche 22 (post-carga, §9)»                                                                                                                                                                                                                                               |

### 7.7 `docs/06_operacion/FLUJO_BASE_MVP_Y_MIGRACION.md`

| Sección / línea                           | Dice (viejo)                                                                                                                                                                                         | Debe decir (nuevo)                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §5.4, tras el bloque del 21 (línea ~256)  | (no hay bloque del 22)                                                                                                                                                                               | añadir «Y el 22, que cierra los pendientes de base del 20 y el 21:» + el comando `-f /dev/stdin < docs/PARCHE_22_VISIBILIDAD_Y_G21.sql`                                                                                                                                                                                                                   |
| §5.4, viñeta de montajes, líneas ~264-268 | «Los 21 archivos del entorno —los 5 de preparación y los parches 6 a 21— … de `96_patch_06.sql` a `111_patch_21.sql` (… el 21 el `111`), así que también vale `-f /opt/avisa/sql/111_patch_21.sql`.» | «Los **22** archivos … los parches 6 a **22** … de `96_patch_06.sql` a `112_patch_22.sql` (… el 22 el `112`), así que también vale `-f /opt/avisa/sql/112_patch_22.sql`.»                                                                                                                                                                                 |
| §5.4, viñetas de detalles                 | (no hay viñeta del 22)                                                                                                                                                                               | añadir: «- El parche 22 hace ejecutable G21 (`visibilidad` + trigger `alertas_g21_visibilidad`), da consumidor a `core.permiso_aprobacion` (`core.puede_aprobar()`), amplía `core.vw_alerta_estado` a 20 columnas y corrige `paso_actual` en las 83 alertas derivándolo de `core.proceso_instancia`. No siembra suplencias ni amplía el flujo `reporte`.» |
| §5.6, línea ~342                          | «el 2 lee el DDL y los 21 SQL»                                                                                                                                                                       | «el 2 lee el DDL y los 22 SQL»                                                                                                                                                                                                                                                                                                                            |
| §5.6, línea ~348                          | «sumar **2 147** columnas y **13 355** filas»                                                                                                                                                        | «sumar **2 148** columnas y **13 355** filas»                                                                                                                                                                                                                                                                                                             |

### 7.8 Lo que **no** hay que cambiar

Los informes `P18`, `P20` y `P21` conservan sus cifras: son fotos de su momento y
no se reescriben. `docs/03_ejecucion/PRIORIZACION_MVP_v10.md` (§4, «6 columnas»
de `core.permiso_aprobacion`) sigue siendo correcto: el parche no le añade ni le
quita columnas. Y los artefactos generados (`AVISA_V10_ESQUEMA_UNIFICADO.sql`,
`PARCHE_12_COMENTARIOS_COLUMNAS.sql`, `DICCIONARIO_DATOS.md`,
`diccionario_datos.csv`, `mvp_prioridad_tablas.csv`, `sql_server/*`, `delta_*.svg`
y la §11.5 de `LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md`) ya llevan las cifras
nuevas porque la cadena se regeneró (§5.7).

---

## 8. Actualización posterior (parche 23 y revisión del 2026-11-21)

Se escribe después y **no reescribe** §6 ni §7, que quedan como foto del estado
que este parche dejó. Lo que sigue dice qué cerró el parche 23 y qué se corrigió
en la revisión documental posterior.

| Pendiente de §6                                          | Estado                        | Quién lo cerró                                                                                                               |
| -------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. La visibilidad `sectorial` no tiene a quién remitir   | **Cerrado**                   | Parche 23: `core.alerta_destinatario` (11 columnas, vacía) y el gate exige al menos un destinatario para pasar a `sectorial` |
| 2. Las 83 alertas no se publican con un solo `UPDATE`    | **Abierto, y es lo correcto** | Siguen sin firmas: publicarlas exige que una persona valide y otra apruebe                                                   |
| 3. El contrato G21 usa un valor que el `CHECK` no admite | **Cerrado**                   | Parche 23: la fila pasa a `visibilidad = 'ejecutiva'` y el caso negativo añade `validada_por`                                |
| 4. `core.permiso_aprobacion` con 0 filas                 | **Abierto, deliberado**       | Nombrar suplente es acto administrativo de la OAIPCS                                                                         |
| 5. `visibilidad` fuera de la curaduría de columnas       | **Abierto, y se extiende**    | Lo mismo vale para `validada_por`: `PARCHE_12` es B.13 y corre antes de B.17                                                 |
| 6. El gate no impone «quien valida no aprueba»           | **Cerrado**                   | Parche 23: `validada_por`, el `CHECK` `alertas_cuatro_ojos` y la tercera comprobación del gate (H-84)                        |
| 7. Los 9 pasos de `reporte` sin definición               | **Abierto, y documentado**    | Decisión registrada en §3.6; no es un defecto                                                                                |
| 8. Propagación documental                                | **Cerrada**                   | Pasadas novena y décima; §7 de este informe quedó aplicado en los documentos                                                 |

**Corrección de la revisión del 2026-11-21.** El parche 23 creó
`core.alerta_destinatario` con `ENABLE ROW LEVEL SECURITY` y **sin `FORCE`**. Como
la aplicación se conecta como `avisa`, propietaria de las tablas, el propietario
se saltaba las cuatro políticas: eran decorativas. Se añadió el `FORCE` al SQL del
parche y se reejecutó entero —idempotente, sin mover ninguna fila—; hoy **52 de
las 52 tablas con RLS de `core` están forzadas** y el recuento de tablas con RLS
sin forzar es **0**. El detalle está en el §3.6 del informe del parche 23.
