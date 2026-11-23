# P17 — Consulta PIDE-RENIEC y control de costos

**Proyecto:** AVISA / SIPRECS — OAIPCS, PRODUCE
**Marco:** ERS v0.6 RF-D13, RA-07, RA-08, RN-17 (RENIEC); RNF-13, RM-04, RM-06 a RM-21 (costos)
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_17_RENIEC_Y_COSTOS.sql` (idempotente)
**Estado:** aplicado y verificado en la base viva el 2026-11-20

---

## 1. Resumen

El ERS v0.6 movió tres servicios al alcance de diciembre: PIDE-RENIEC (SVC-16),
Gemini (SVC-02) y WhatsApp (SVC-07). Con ellos entró el control de costos
(RNF-13, RM-04, RM-06 a RM-21). El esquema no tenía dónde guardar ninguno de los
tres. Este parche abre esos sitios.

Deja tres tablas nuevas: `core.cat_privilegio`, `core.privilegio_usuario` y
`core.consulta_reniec`. Deja dos funciones de puerta: `core.tiene_privilegio()`
y `core.puede_consultar_reniec()`. Añade seis columnas de costo a
`agent.llm_call` y cinco a `core.envios_comunicacion`.

Lo importante, y conviene decirlo antes de cualquier tabla: **hoy no hay
consultas reales a RENIEC**. `core.consulta_reniec` tiene **0 filas** y el
privilegio está concedido a **una sola persona**. Lo que existe es el sitio, no
el uso.

Lo que el SQL **no** resuelve —convenio con RENIEC (H-68), dictamen legal (H-04),
las «75 piezas/día» de Gemini (H-73) y la cuenta de WhatsApp (H-74)— está en §9.
Tampoco implementa el tope de gasto ni el aviso que pide RNF-13: guarda el dato
para calcularlos, no el mecanismo.

Ninguna cifra de este informe es estimada. Todas salen de `SELECT` ejecutados
contra `avisa-db` y se listan con su consulta en §7.

---

## 2. Por qué un privilegio nominal y no un rol

RA-07 no dice «un rol puede consultar RENIEC». Dice: «Solo la **Directora con
privilegio RENIEC** (hoy, Edith) puede iniciar una consulta a PIDE-RENIEC
(SVC-16); nadie más, ni siquiera el resto de la Dirección, puede pedirla
directamente».

Un rol se concede a un conjunto de personas. En esta base el conjunto es grande:

| Rol                | Personas con el rol |
| ------------------ | ------------------: |
| `consulta_lectura` |                  17 |
| `sectorista`       |                  15 |
| `alta_direccion`   |                   2 |
| `administrador`    |                   1 |
| `auditor`          |                   0 |

Conceder `consulta_reniec` al rol `sectorista` habría dado acceso a **15
personas**. RA-07 pide una. Por eso el parche no toca `core.roles` y crea dos
tablas de metadatos de autorización:

| Pieza                           | Función                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `core.cat_privilegio`           | Catálogo de capacidades nominales. Hoy tiene un solo código: `consulta_reniec`. |
| `core.privilegio_usuario`       | Concesión a una persona concreta, con motivo obligatorio y fecha de caducidad.  |
| `core.usuario_actual()`         | Lee `app.usuario_id` de la sesión. Sin ese parámetro devuelve NULL.             |
| `core.tiene_privilegio(text)`   | Verifica código, vigencia y actividad. Falla cerrado.                           |
| `core.puede_consultar_reniec()` | Atajo de `tiene_privilegio('consulta_reniec')`. Única puerta a la tabla.        |

La concesión efectiva, en la base viva:

| Usuario                    | Nombre              | Cargo     | Privilegio        | Desde      | Hasta | Activo |         Motivo |
| -------------------------- | ------------------- | --------- | ----------------- | ---------- | ----- | ------ | -------------: |
| `ebautista@produce.gob.pe` | Edith Bautista León | Directora | `consulta_reniec` | 2026-11-19 | NULL  | sí     | 115 caracteres |

Es idempotente y no crea usuarios: el bloque `DO` resuelve por correo. Si el
correo no existe, avisa con `RAISE NOTICE` y no falla. Falla cerrado, no abierto:
sin `app.usuario_id`, `core.puede_consultar_reniec()` devuelve `f`.

`core.cat_privilegio` y `core.privilegio_usuario` no llevan RLS. Son metadatos de
autorización: la evaluación de la política de `consulta_reniec` necesita leerlos,
y una RLS sobre ellos se evaluaría a sí misma.

---

## 3. Objetos creados o modificados

| Objeto                                                             | Tipo                                                | Qué hace                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `core.cat_privilegio`                                              | tabla                                               | Catálogo nominal: `codigo`, `nombre`, `descripcion`, `requiere_motivo`.                                                       |
| `core.privilegio_usuario`                                          | tabla                                               | Concesión a una persona: `usuario_id`, `privilegio_id`, `motivo` (>= 10), `desde`, `hasta`, `activo`.                         |
| `ix_privilegio_usuario_usuario`                                    | índice parcial                                      | Búsqueda de privilegios activos por usuario.                                                                                  |
| `core.usuario_actual()`                                            | función `sql` `STABLE`                              | UUID de `app.usuario_id`. NULL si no se fijó.                                                                                 |
| `core.tiene_privilegio(text)`                                      | función `sql` `STABLE`                              | Cierto si el privilegio está concedido, vigente y activo.                                                                     |
| `core.puede_consultar_reniec()`                                    | función `sql` `STABLE`                              | Atajo del anterior para `consulta_reniec`.                                                                                    |
| `core.consulta_reniec`                                             | tabla                                               | Una fila por consulta: actor, caso, quién, motivo, fecha, integración, resultado cifrado, huella, nivel 3.                    |
| `ix_consulta_reniec_actor` / `..._usuario`                         | índices                                             | Consultas por actor y por usuario, ordenadas por fecha descendente.                                                           |
| `tg_reniec_append_only_row` / `_stmt` / `_truncate`                | triggers `BEFORE`                                   | Rechazan `UPDATE`, `DELETE` y `TRUNCATE` con `audit.tg_rechazar_mutacion()`.                                                  |
| `core.tg_consulta_reniec_auditar()` + `tg_consulta_reniec_auditar` | función `SECURITY DEFINER` y trigger `AFTER INSERT` | Escribe el rastro en `audit.datos_personales_acceso` con `operacion = 'select_reniec'`.                                       |
| `audit.datos_personales_acceso_operacion_check`                    | restricción reemplazada                             | Admite el valor `select_reniec` junto a los cinco anteriores.                                                                 |
| `p_reniec_select` / `p_reniec_insert`                              | políticas RLS                                       | Leer y registrar exigen el privilegio; insertar exige firmar con el propio usuario y nivel 3.                                 |
| `agent.llm_call`                                                   | 6 columnas nuevas                                   | `tokens_thinking`, `thinking_budget`, `grounding_habilitado`, `store_habilitado`, `datos_anonimizados`, `costo_estimado_usd`. |
| `core.envios_comunicacion`                                         | 5 columnas nuevas                                   | `id_externo`, `plantilla_codigo`, `estado_entrega`, `costo_estimado_usd`, `actualizado_en`.                                   |
| `ux_envio_id_externo`                                              | índice único parcial                                | Un `wamid` de Meta no se registra dos veces por canal.                                                                        |
| `ck_envio_estado_entrega`                                          | restricción nueva                                   | Solo `enviado`, `entregado`, `leido`, `fallido`, `sin_confirmar`.                                                             |
| `core.banco_datos_tratamiento` (`BD-GSCS`)                         | fila actualizada                                    | Declara el resultado de requisitorias y su medida de seguridad.                                                               |

---

## 4. El ciclo de una consulta a RENIEC

1. La aplicación autentica a la persona y fija `app.usuario_id` en la sesión.
2. Pregunta `core.puede_consultar_reniec()`. Si no es cierto, no hay ciclo: la
   política `p_reniec_select` y `p_reniec_insert` ya cierran la tabla.
3. La persona elige un actor de `core.actores`, un caso opcional y escribe el
   motivo. La base exige al menos 15 caracteres (RN-17: finalidad declarada).
4. La aplicación llama a PIDE-RENIEC **fuera de la base**. El esquema no llama a
   nadie: eso depende del convenio (H-68).
5. Con la respuesta en mano, la aplicación cifra el resultado con
   `pgp_sym_encrypt(payload, app.crypto_key)` y calcula la huella SHA-256.
6. Inserta la fila. El `WITH CHECK` de `p_reniec_insert` verifica tres cosas: que
   hay privilegio vigente, que `consultado_por_usuario_id = core.usuario_actual()`
   (nadie firma consultas ajenas) y que `nivel_clasificacion = 3`.
7. El trigger `AFTER INSERT` escribe en `audit.datos_personales_acceso` una fila
   con operación `select_reniec`, el actor, el motivo, el usuario y el caso. Lo
   escribe la base, no el aplicativo: si el aplicativo olvida auditar, queda
   auditado igual.
8. El resultado se lee solo desde la base, descifrando con `app.crypto_key`. No
   hay tabla, vista ni exportación que lo muestre en claro (RA-08).
9. No hay corrección posible por `UPDATE`. Si un registro quedó mal, se agrega
   otro que lo explique: la tabla es de solo agregar.

Prueba completa ejecutada en transacción revertida, como `avisa_app` y con Edith
en `app.usuario_id`: el `INSERT` entró (`INSERT 0 1`), la fila quedó visible para
ella (`visibles = 1`), el blob se descifró con la clave de sesión
(`83 bytes` → `sin requisitorias`) y la auditoría registró la fila
(`auditados = 1`). El `ROLLBACK` devolvió la tabla a 0.

---

## 5. Cifrado del resultado

| Columna               | Tipo                  | Qué guarda                                                                                                |
| --------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- |
| `resultado_cifrado`   | `bytea` `NOT NULL`    | El resultado de la consulta como blob `pgp_sym_encrypt` (OpenPGP, AES-256). Nunca el texto plano.         |
| `resultado_hmac`      | `char(64)` `NOT NULL` | Huella SHA-256 en hexadecimal del resultado en claro. Permite detectar consultas repetidas sin descifrar. |
| `nivel_clasificacion` | `smallint` `NOT NULL` | Fijo en 3 por `CHECK (nivel_clasificacion = 3)`. Confidencial no se puede degradar por error.             |
| `motivo`              | `text` `NOT NULL`     | Justificación de finalidad. `CHECK` de al menos 15 caracteres.                                            |

Detalles que importan en operación:

- `pgcrypto` 1.3 vive en el esquema `public`; `pgp_sym_encrypt` se llama con
  nombre calificado desde la aplicación.
- La llave **no está en la base**. Llega por sesión en `app.crypto_key`, igual
  que en el parche 9. Su custodia sigue abierta (§7.3 de `P9_SEGURIDAD.md`).
- El parche **no trae función de descifrado**. A diferencia de
  `core.actor_datos_personales_descifrar()`, aquí no hay atajo: el aplicativo
  cifra, descifra y calcula la huella. La base solo impone el sitio, el permiso y
  la bitácora.
- Capacidad de descifrado probada: 17 caracteres de texto entraron como 83 bytes.
  El sobre de OpenPGP ocupa el resto.
- No hay columna de etiqueta. Ni «criminal», ni «sospechoso», ni «bajo
  investigación». Es deliberado: el esquema no clasifica personas sin sentencia
  firme.

Dos diferencias con el parche 9, que conviene tener presentes:

| Aspecto               | Parche 9 (`actor_datos_personales`)       | Parche 17 (`consulta_reniec`)  |
| --------------------- | ----------------------------------------- | ------------------------------ |
| Tipo de la huella     | `bytea` (`dni_hmac`)                      | `char(64)` (`resultado_hmac`)  |
| Función de descifrado | `core.actor_datos_personales_descifrar()` | ninguna: lo hace el aplicativo |

---

## 6. Control de costos

| Concepto                                         | Dónde se guarda                                                                                    | Tope        | Aviso       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------- | ----------- |
| Tokens de Gemini (entrada, salida, razonamiento) | `agent.llm_call.tokens_in`, `tokens_out`, `tokens_thinking`                                        | no hay      | no hay      |
| Costo de Gemini                                  | `agent.llm_call.costo_estimado_usd` `numeric(12,6)`                                                | no hay      | no hay      |
| Cumplimiento RM-11 a RM-15                       | `agent.llm_call.thinking_budget`, `grounding_habilitado`, `store_habilitado`, `datos_anonimizados` | no aplica   | no aplica   |
| Envío de WhatsApp (trazabilidad)                 | `core.envios_comunicacion.id_externo`, `plantilla_codigo`, `estado_entrega`, `actualizado_en`      | no hay      | no hay      |
| Costo de WhatsApp                                | `core.envios_comunicacion.costo_estimado_usd` `numeric(12,6)`                                      | no hay      | no hay      |
| Consulta a RENIEC                                | `core.consulta_reniec` (sin costo por consulta: convenio de Estado)                                | no aplica   | no aplica   |
| Tope de gasto mensual (RM-04, RNF-13)            | no existe tabla ni parámetro                                                                       | **ausente** | **ausente** |
| Aviso al acercarse al tope (RNF-13)              | no existe tabla, vista ni disparador                                                               | **ausente** | **ausente** |

RNF-13 pide dos cosas: «registrar el consumo de cada servicio externo y permitir
un tope de gasto con aviso», con el indicador «consumo y costo por servicio y por
mes». El parche cumple la primera mitad. Deja los datos crudos para calcular el
indicador —`agent.llm_call.ts` y `destino`, `core.envios_comunicacion.fecha_envio`
y `canal`, más la columna `costo_estimado_usd` en ambas— pero no entrega el
agregado, ni el tope, ni el aviso.

Comprobado en la base viva:

- No hay vista ni función que sume `agent.llm_call`: 0 coincidencias en
  `pg_proc.prosrc` y 0 vistas dependientes en `pg_depend`.
- No hay tabla con nombre de consumo, costo, tope, presupuesto o límite.
- `config.parametro` tiene 17 filas y ninguna se refiere a costo, tope o consumo.

RM-04 («pago por uso con tope de gasto y alerta de consumo») queda, por tanto,
sin soporte en el esquema. Está declarado en §9.

---

## 7. Cifras reales

| Dato                                             | Valor                                                  | Consulta                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filas en `core.consulta_reniec`                  | **0**                                                  | `SELECT count(*) FROM core.consulta_reniec;`                                                                                                                                                                                                         |
| Consultas reales a RENIEC registradas            | **0**                                                  | igual que la anterior                                                                                                                                                                                                                                |
| Filas en `core.privilegio_usuario`               | 1                                                      | `SELECT count(*) FROM core.privilegio_usuario;`                                                                                                                                                                                                      |
| Personas con el privilegio                       | 1                                                      | `SELECT count(DISTINCT usuario_id) FROM core.privilegio_usuario;`                                                                                                                                                                                    |
| Filas en `core.cat_privilegio`                   | 1 (`consulta_reniec`)                                  | `SELECT codigo FROM core.cat_privilegio;`                                                                                                                                                                                                            |
| Usuarios en la base / activos                    | 32 / 28                                                | `SELECT count(*), count(*) FILTER (WHERE activo) FROM core.usuarios;`                                                                                                                                                                                |
| Rol `sectorista` / `alta_direccion` / `auditor`  | 15 / 2 / 0                                             | `SELECT r.codigo, count(ur.usuario_id) FROM core.roles r LEFT JOIN core.usuario_roles ur ON ur.rol_id=r.id GROUP BY 1;`                                                                                                                              |
| RLS en `core.consulta_reniec`                    | activo y forzado (`t`, `t`)                            | `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='consulta_reniec';`                                                                                                                                                          |
| Políticas sobre la tabla                         | 2 (`SELECT`, `INSERT`); 0 de `UPDATE`/`DELETE`         | `SELECT policyname, cmd FROM pg_policies WHERE tablename='consulta_reniec';`                                                                                                                                                                         |
| Disparadores sobre la tabla                      | 4 (3 append-only + 1 de auditoría)                     | `SELECT count(*) FROM pg_trigger WHERE tgrelid='core.consulta_reniec'::regclass AND NOT tgisinternal;`                                                                                                                                               |
| Permisos de `avisa_app`                          | `SELECT`, `INSERT`; sin `UPDATE`, `DELETE`, `TRUNCATE` | `SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='consulta_reniec' AND grantee='avisa_app';`                                                                                                                        |
| Llamadas a Gemini registradas (`agent.llm_call`) | **0** (todas las particiones)                          | `SELECT count(*) FROM agent.llm_call;`                                                                                                                                                                                                               |
| Columnas de costo en `llm_call`                  | 6 en `llm_call` y 6 en cada una de sus 6 particiones   | `SELECT count(*) FROM information_schema.columns WHERE table_schema='agent' AND table_name='llm_call' AND column_name IN ('tokens_thinking','thinking_budget','grounding_habilitado','store_habilitado','datos_anonimizados','costo_estimado_usd');` |
| Envíos registrados (`core.envios_comunicacion`)  | 17                                                     | `SELECT count(*) FROM core.envios_comunicacion;`                                                                                                                                                                                                     |
| Envíos por canal                                 | WhatsApp 5 · Otro 7 · Correo 5                         | `SELECT canal, count(*) FROM core.envios_comunicacion GROUP BY 1;`                                                                                                                                                                                   |
| Envíos con `id_externo` (wamid)                  | 0                                                      | `SELECT count(*) FROM core.envios_comunicacion WHERE id_externo IS NOT NULL;`                                                                                                                                                                        |
| Envíos con `estado_entrega`                      | 0 (los 17 en NULL)                                     | `SELECT count(*) FROM core.envios_comunicacion WHERE estado_entrega IS NOT NULL;`                                                                                                                                                                    |
| Envíos con `costo_estimado_usd`                  | 0                                                      | `SELECT count(*) FROM core.envios_comunicacion WHERE costo_estimado_usd IS NOT NULL;`                                                                                                                                                                |
| Filas en `audit.datos_personales_acceso`         | 3 088                                                  | `SELECT count(*) FROM audit.datos_personales_acceso;`                                                                                                                                                                                                |
| Con `operacion = 'select_reniec'`                | **0**                                                  | `SELECT count(*) FROM audit.datos_personales_acceso WHERE operacion='select_reniec';`                                                                                                                                                                |
| Con `operacion = 'select_descifrado'` / `update` | 3 / 3 085                                              | `SELECT operacion, count(*) FROM audit.datos_personales_acceso GROUP BY 1;`                                                                                                                                                                          |
| Integraciones en `core.integraciones`            | 20 (10 sistemas × 2)                                   | `SELECT count(*) FROM core.integraciones;`                                                                                                                                                                                                           |
| Integraciones de RENIEC                          | **0**                                                  | `SELECT count(*) FROM core.integraciones WHERE sistema_origen ILIKE '%reniec%' OR sistema_destino ILIKE '%reniec%';`                                                                                                                                 |
| Filas del banco de datos (`BD-GSCS`)             | 1; declara PIDE-RENIEC                                 | `SELECT count(*) FROM core.banco_datos_tratamiento WHERE codigo='BD-GSCS' AND categorias_datos LIKE '%PIDE-RENIEC%';`                                                                                                                                |
| `pgcrypto`                                       | 1.3, esquema `public`                                  | `SELECT extname, extversion FROM pg_extension WHERE extname='pgcrypto';`                                                                                                                                                                             |
| Vistas o funciones que exponen `consulta_reniec` | 0                                                      | `SELECT count(*) FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class v ON v.oid=r.ev_class WHERE d.refobjid='core.consulta_reniec'::regclass AND v.oid<>'core.consulta_reniec'::regclass;`                                             |
| Tamaño del blob de prueba (17 caracteres)        | 83 bytes                                               | `SELECT octet_length(resultado_cifrado) FROM core.consulta_reniec;` (en transacción revertida)                                                                                                                                                       |

Las dos filas que más importan: **0 consultas** y **1 persona**. El resto son
sitios preparados que todavía nadie usa.

---

## 8. Cómo se reproduce

Ejecución, tal como figura en la cabecera del parche:

```
cat docs/PARCHE_17_RENIEC_Y_COSTOS.sql \
  | docker compose exec -T db psql -U avisa -d avisa
```

El parche imprime siete bloques (`1/7` a `7/7`) y cierra con la lista de
privilegios concedidos. No necesita `app.crypto_key`: nunca cifra ni descifra,
solo crea estructuras. La clave hace falta para **usar** la tabla, no para
aplicarla.

Aviso de operación: el usuario `avisa` es superusuario y tiene `BYPASSRLS`. Toda
prueba de RLS hecha con esa conexión **no prueba nada** —la política se salta—.
Hay que hacerla con `SET LOCAL ROLE avisa_app` dentro de una transacción. Así se
hicieron las verificaciones de este informe.

Las que se repiten con más frecuencia:

```sql
-- 1. ¿Hay consultas registradas?
SELECT count(*) FROM core.consulta_reniec;

-- 2. ¿A quién pertenece el privilegio?
SELECT u.email, cp.codigo, pu.desde, pu.hasta, pu.activo
  FROM core.privilegio_usuario pu
  JOIN core.cat_privilegio cp ON cp.id = pu.privilegio_id
  JOIN core.usuarios u ON u.id = pu.usuario_id;

-- 3. ¿Falla cerrado sin usuario de sesión?
BEGIN;
SELECT set_config('app.usuario_id', '', true);
SELECT core.puede_consultar_reniec();   -- f
ROLLBACK;

-- 4. ¿Se puede borrar?
BEGIN;
DELETE FROM core.consulta_reniec;       -- append-only: DELETE no está permitido
ROLLBACK;
```

Resultados obtenidos en la base viva:

| Verificación                                    | Resultado                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `puede_consultar_reniec()` sin `app.usuario_id` | `f` (falla cerrado)                                                      |
| `puede_consultar_reniec()` con Edith            | `t`                                                                      |
| `puede_consultar_reniec()` con otro usuario     | `f`                                                                      |
| `INSERT` como `avisa_app` sin privilegio        | `ERROR: new row violates row-level security policy`                      |
| `INSERT` como `avisa_app` firmando por otro     | `ERROR: new row violates row-level security policy`                      |
| `motivo` de 5 caracteres                        | `ERROR: ... violates check constraint "ck_consulta_reniec_motivo"`       |
| `nivel_clasificacion = 2`                       | `ERROR: ... violates check constraint "ck_consulta_reniec_confidencial"` |
| `UPDATE`                                        | `ERROR: ... append-only: UPDATE no está permitido`                       |
| `DELETE`                                        | `ERROR: ... append-only: DELETE no está permitido`                       |
| `TRUNCATE`                                      | `ERROR: ... append-only: TRUNCATE no está permitido`                     |
| `DELETE` como `avisa_app`                       | `ERROR: permission denied for table consulta_reniec`                     |

---

## 9. Lo que el SQL no resuelve

- **Convenio con RENIEC — H-68.** El esquema no llama a nadie. `core.integraciones`
  tiene 20 filas y ninguna es PIDE-RENIEC; la columna `consulta_reniec.integracion_id`
  existe y está vacía. Falta el convenio vigente, el endpoint, la credencial y
  quién los gestiona. El propio ERS deja el usuario resuelto (Edith) y el
  convenio en blanco.
- **Dictamen legal — H-04.** La base guarda y cifra. Si el texto puede viajar a
  Gemini, con qué anonimización y bajo qué base legal, no lo decide una
  restricción `CHECK`. Las columnas `store_habilitado` y `datos_anonimizados`
  registran la decisión; no la toman.
- **Las «75 piezas/día» de Gemini — H-73.** No se sabe qué es una pieza ni de
  dónde sale el lote. El esquema no puede fijar ni verificar esa cuota: no hay
  contador diario ni marca de lote en `agent.llm_call`, y la tabla está vacía.
- **Cuenta de WhatsApp — H-74.** Sin cuenta de empresa verificada, número
  dedicado y plantillas aprobadas, `id_externo` no se puede llenar. Hoy los 17
  envíos tienen `id_externo` en NULL y `estado_entrega` en NULL: no se sabe si
  llegaron, porque no hay proveedor que lo diga.
- **Tope de gasto y aviso (RNF-13, RM-04).** No hay tabla de topes, ni umbral, ni
  disparador, ni tabla de avisos. El parche deja `costo_estimado_usd` y la fecha,
  que es la materia prima; el mecanismo no existe.
- **Agregado por servicio y por mes (RNF-13).** No hay vista ni función. Para
  obtener el indicador hay que escribir la consulta a mano, agrupando
  `agent.llm_call` por `date_trunc('month', ts)` y `destino`, y
  `core.envios_comunicacion` por `date_trunc('month', fecha_envio)` y `canal`.
  Además `destino` es texto libre: no es una clave de servicio.
- **Descifrado y custodia de la clave.** No hay función de descifrado; la
  aplicación lo hace. La custodia de `APP_CRYPTO_KEY` sigue como la dejó el
  parche 9: en `.env`, fuera de la base, sin gestor de secretos.
- **Quién lee la bitácora de consultas.** La única política de `SELECT` exige el
  privilegio nominal. El rol `auditor` tiene 0 personas y ninguna política; el
  rol `administrador` tiene 1 persona, que es la propia Edith. El panel 25 del
  ERS («Consultas a RENIEC», para Administrador y Legal) no tiene, hoy, camino en
  la base.
- **Integridad de la huella.** Nada verifica que `resultado_hmac` corresponda al
  contenido: se probó un `INSERT` con `repeat('a',64)` y pasó. Tampoco hay índice
  único sobre la huella, así que la deduplicación es una intención del aplicativo,
  no una garantía de la base.
- **Mensaje de error del disparador.** `audit.tg_rechazar_mutacion()` nombra
  siempre `audit.datos_personales_acceso` en el texto, aunque el rechazo ocurra
  en `core.consulta_reniec`. Es cosmético y viene de la función compartida; no se
  tocó para no alterar el parche 9.
- **Inconsistencia menor de tipo.** `resultado_hmac` es `char(64)`; `dni_hmac`
  del parche 9 es `bytea`. Ambas funcionan, pero el aplicativo debe tratarlas
  distinto. No se cambió porque el parche ya está aplicado y `char(64)` es válido
  para un hexadecimal.
