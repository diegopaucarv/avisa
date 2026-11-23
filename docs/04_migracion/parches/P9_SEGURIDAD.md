# P9 — Seguridad de nivel alto sobre datos personales de actores

**Proyecto:** AVISA / SIPRECS — OAIPCS, PRODUCE
**Marco legal:** Ley 29733 (protección de datos personales), principios de
finalidad (art. 6), seguridad (art. 9) y datos sensibles (art. 13).
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16.14,
base de la imagen `avisa/postgres:16` (derivada de `pgvector/pgvector:pg16`,
Debian 12), con `pgcrypto` 1.3 en el esquema `public`.
**Parche:** `docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql` (idempotente, re-ejecutable).
**Estado:** aplicado y verificado en la base viva el 2026-11-18.

---

## 1. Resumen

Se cifraron en la base los identificadores personales de actores y se vació el
plano: **642 DNI, 141 correos y 606 teléfonos** quedaron como blobs
`pgp_sym_encrypt` (AES-256) más una huella `hmac` del DNI para búsqueda. El
esquema `audit` registra desde ahora toda lectura descifrada y toda escritura de
la tabla de PII, y su historial rechaza `UPDATE`, `DELETE` y `TRUNCATE`.

Lo que el SQL **no** puede resolver —TLS en tránsito, `pgaudit` y custodia de la
clave— se documenta en §7 con los pasos exactos. No se implementó porque exige
tocar la imagen, el servicio y el gestor de secretos (§7, regla 3b del encargo).

Ninguna cifra de este informe es estimada: todas vienen de `SELECT` ejecutados
contra `avisa-db` y se reproducen en §5.

---

## 2. Objetos creados o modificados

| Objeto                                                                 | Tipo                       | Qué hace                                                                                                                                                                                                              |
| ---------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit`                                                                | esquema                    | Contenedor de la bitácora.                                                                                                                                                                                            |
| `audit.datos_personales_acceso`                                        | tabla                      | Bitácora append-only: `id`, `ocurrido_en`, `usuario`, `operacion`, `actor_uid`, `motivo`, `filas_afectadas`, `contexto jsonb`. `operacion` restringida a `select_descifrado`, `insert`, `update`, `delete`, `export`. |
| `audit.tg_rechazar_mutacion()`                                         | función                    | Lanza excepción en `UPDATE`, `DELETE` y `TRUNCATE`.                                                                                                                                                                   |
| `tg_append_only_row`, `tg_append_only_stmt`, `tg_append_only_truncate` | triggers                   | Cubren fila, sentencia y truncado. La variante de sentencia rechaza también `UPDATE`/`DELETE` que afectarían 0 filas.                                                                                                 |
| `core.actor_datos_personales.dni_cifrado`                              | columna `bytea`            | DNI cifrado.                                                                                                                                                                                                          |
| `core.actor_datos_personales.email_cifrado`                            | columna `bytea`            | Correo cifrado.                                                                                                                                                                                                       |
| `core.actor_datos_personales.telefono_cifrado`                         | columna `bytea`            | Teléfono cifrado.                                                                                                                                                                                                     |
| `core.actor_datos_personales.dni_hmac`                                 | columna `bytea`            | HMAC-SHA256 del DNI.                                                                                                                                                                                                  |
| `ix_actor_datos_personales_dni_hmac`                                   | índice **no único**        | Búsqueda por huella sin descifrar.                                                                                                                                                                                    |
| `core.tg_audit_datos_personales()` + `tg_audit_datos_personales`       | función y trigger          | Audita cada `INSERT`/`UPDATE`/`DELETE` de la tabla de PII, con las columnas que cambiaron y el origen.                                                                                                                |
| `core.v_actor_datos_personales_seguro`                                 | vista                      | `actor_uid`, `nivel_clasificacion`, `dni_cifrado`, `dni_hmac`, `email_cifrado`, `telefono_cifrado`. Nunca el plano. `security_invoker = true`.                                                                        |
| `core.actor_datos_personales_descifrar(uuid, text)`                    | función `SECURITY DEFINER` | Único camino soportado para ver PII en claro. Exige nivel 3, motivo no vacío, audita y devuelve `dni`, `email`, `telefono`. `EXECUTE` revocado de `PUBLIC`.                                                           |
| `core.ix_actor_dni`                                                    | índice                     | **Eliminado**: dependía de `dni` en claro y quedaba vacío tras la purga.                                                                                                                                              |

---

## 3. Cifras reales, antes y después

### 3.1 La tabla

`core.actor_datos_personales`: 847 filas, todas con `nivel_clasificacion = 3`.

| Dato                | Antes (en claro) | Después (en claro) |               Cifrados |
| ------------------- | ---------------: | -----------------: | ---------------------: |
| `dni`               |              642 |              **0** | 642 (+ 642 `dni_hmac`) |
| `email`             |              141 |              **0** |                    141 |
| `telefono_contacto` |              556 |              **0** |                      — |
| `telefono_alt`      |                0 |                  0 |                      — |
| `telefono_raw`      |              606 |              **0** |                      — |
| `telefono_cifrado`  |                — |                  — |                **606** |

El total de teléfonos cifrados es 606 y no 556 porque la tabla tenía **50 filas
con `telefono_raw` y sin `telefono_contacto`**. Cifrar solo `telefono_contacto`
y luego vaciar `telefono_raw` habría borrado esos 50 números del plano de `core`
(recuperables solo desde el legado). El backfill cifra
`COALESCE(telefono_contacto, telefono_raw)`; se documenta porque la cifra de
referencia del encargo (556) sigue siendo verificable por separado:

```
telefono_contacto = 556  →  556 blobs con valor normalizado "+51xxxxxxxxx"
solo telefono_raw =  50  →   50 blobs con el valor crudo de 9 dígitos
                    ────
telefono_cifrado  = 606
```

Consecuencia práctica: `telefono_cifrado` no tiene formato homogéneo. El
aplicativo debe normalizarlo al leerlo, igual que hacía antes con las dos
columnas.

### 3.2 Duplicados de DNI (hallazgo, no defecto del parche)

| Métrica                              | Valor |
| ------------------------------------ | ----: |
| Filas con DNI                        |   642 |
| DNI distintos                        |   587 |
| Filas sobrantes                      |    55 |
| Valores de DNI repetidos             |    45 |
| Repeticiones máximas de un mismo DNI |     4 |

Por eso el índice `dni_hmac` es **no único**: imponer unicidad habría fallado al
crear el índice y, sobre todo, habría decidido por OAIPCS una política de
identidad que no está tomada. Ejemplos reales de lo que hay detrás:

| DNI        | Veces | Nombres registrados                                                |
| ---------- | ----: | ------------------------------------------------------------------ |
| `1265126`  |     4 | Maylin / Miflin / Miglin / Milfin Flores Niña                      |
| `16592221` |     4 | Jorge Luis / Jose Luis / José Luis Alvarez Saba                    |
| `23618313` |     3 | Genaro Villanueva Cuya · Jenaro Mogolloncho · Pedro Villafuerte B. |
| `40468145` |     3 | María García Herrera · María García Moreno · Taira García Moreno   |

Los dos primeros casos son variantes de escritura de la misma persona: son
candidatos de fusión. Los otros dos mezclan nombres distintos bajo el mismo
número: son probables errores de captura. El `hmac` permite detectarlos sin
descifrar nada; la decisión de fusionar es de OAIPCS.

---

## 4. Clave: generación, uso y custodia

- **Generación:** `openssl rand -base64 32` → 44 caracteres Base64 (32 bytes).
- **Dónde vive hoy:** `APP_CRYPTO_KEY` en `.env` (raíz del repo, cubierto por
  `.gitignore`). No se guardó en la base, ni en `config.parametro`, ni en el SQL.
- **Cómo llega a la base:** solo por sesión.
  `docker exec -i avisa-db psql ... -v crypto_key="$APP_CRYPTO_KEY"` y el
  script hace `set_config('app.crypto_key', :'crypto_key', false)`.
  Sin `-v crypto_key`, el script imprime un error y no ejecuta nada.
- **Lo que la base sí garantiza:** ninguna rutina funciona sin clave. La función
  de descifrado aborta con «No hay clave en la sesión» y el backfill con «no se
  cifra nada».
- **Lo que la base no garantiza:** que la clave no termine en un log. Ver §7.3.

---

## 5. Verificaciones ejecutadas

Cada verificación es una consulta real contra `avisa-db`. «Esperado» es lo que
exigía el encargo; «obtenido» es la salida.

| #   | Verificación                                                    | Esperado        | Obtenido                                                     |
| --- | --------------------------------------------------------------- | --------------- | ------------------------------------------------------------ |
| V1  | Filas cifradas de DNI                                           | 642             | 642                                                          |
| V2  | Filas cifradas de correo                                        | 141             | 141                                                          |
| V3  | Filas cifradas de teléfono                                      | 556             | 606 (556 + 50 solo `raw`, §3.1)                              |
| V4  | Roundtrip DNI (descifrar y comparar con el plano)               | 0 discrepancias | 0 de 642                                                     |
| V5  | Roundtrip correo                                                | 0               | 0 de 141                                                     |
| V6  | Roundtrip teléfono                                              | 0               | 0 de 606                                                     |
| V7  | `dni_hmac` recalculado coincide con el DNI                      | 0               | 0                                                            |
| V8  | DNI contrastados contra `legacy.dim_actores.c03` (mismo nombre) | 642             | 642 coinciden, 0 sin coincidencia                            |
| V9  | Filas con plano tras la purga                                   | 0               | 0                                                            |
| V10 | Blobs alterados por la purga                                    | 0               | 0 de 847                                                     |
| V11 | Objetos que dependen de las columnas en claro                   | 0               | 0 (solo `ix_actor_dni`, eliminado)                           |
| V12 | Nivel 2 intentando descifrar                                    | error           | `Acceso denegado: se requiere clasificación 3`               |
| V13 | Motivo vacío (`'   '`)                                          | error           | `El motivo del descifrado es obligatorio`                    |
| V14 | `UPDATE` sobre la bitácora                                      | error           | `append-only: UPDATE no está permitido`                      |
| V15 | `DELETE` sobre la bitácora (con y sin filas)                    | error           | `append-only: DELETE no está permitido` (ambas)              |
| V16 | `TRUNCATE` sobre la bitácora                                    | error           | `append-only: TRUNCATE no está permitido`                    |
| V17 | Vistas, funciones e índices que dependan del plano              | ninguno         | ninguno (verificado con `pg_depend`, `pg_views` y `pg_proc`) |
| V18 | Re-ejecución del parche                                         | sin cambios     | `UPDATE 0` en los tres backfills; `Purga: nada que vaciar`   |

Muestra de roundtrip contra el legado (salida literal del parche):

```
 codigo_legado |           nombre_actual            | dni_descifrado | dni_legado | coincide
---------------+------------------------------------+----------------+------------+----------
 ACT-001       | Adonay Olaya Marchan               | 74558302       | 74558302   | t
 ACT-004       | Diego Armando Paiva Jacinto        | 46901273       | 46901273   | t
 ACT-005       | Edgar Jiménez Caipa                | 04649859       | 04649859   | t
 ACT-006       | Henry Juárez Ruiz                  | 44557328       | 44557328   | t
 ACT-007       | Hilton Gregorio Guerrero Bonifacio | 22287612       | 22287612   | t
```

Llamada a la función de descifrado (nivel 3, motivo declarado):

```
 dni | email |   telefono
-----+-------+--------------
     |       | +51939773280     ← ACT-002: no tenía DNI ni correo
```

### 5.1 ¿Se puede recuperar el plano desde el legado?

Sí, para las 847 filas actuales. Se comprobó dato por dato contra el origen:

| Dato     | Total | Reconstruible desde                                   | Sin origen |
| -------- | ----: | ----------------------------------------------------- | ---------: |
| DNI      |   642 | `legacy.dim_actores.c03` (por nombre): 642            |          0 |
| Teléfono |   606 | `dim_actores.c04`: 508 · `dim_actores_estado.c04`: 98 |          0 |
| Correo   |   141 | `dim_actores.c05`: 41 · `dim_actores_estado.c05`: 100 |          0 |

Dos matices que conviene conocer antes de destruir el legado:

- 14 teléfonos contienen **más de un número en un solo campo** (por ejemplo
  `ACT-EST-029`: `914-737-571 / 946-657-520`, o `ACT-EST-062`:
  `614-8333 Anx 4008 / 949-950-668`). Son válidos, pero un comparativo por
  dígitos sueltos no los reconoce.
- `legacy.dim_actores` tiene **códigos repetidos**: `ACT-720` y `ACT-827`
  aparecen dos veces cada uno. El cargador resolvió uno de esos choques creando
  `ACT-720-2` en `core.actores`. Emparejar por código falla en ese caso;
  emparejar por nombre funciona (fue el criterio de la verificación V8).

---

## 6. Bitácora: qué quedó registrado

Primera ejecución y pruebas, hasta el cierre de este informe:

| Operación           | Origen       | Acción        |     Filas |                                Filas afectadas |
| ------------------- | ------------ | ------------- | --------: | ---------------------------------------------: |
| `update`            | `PARCHE_9`   | —             |     2 236 |                                          2 236 |
| `update`            | —            | `purga_plano` |         1 |                                            847 |
| `update`            | `aplicacion` | —             |         1 |                                              1 |
| `select_descifrado` | `aplicacion` | —             |         2 |                                              2 |
| `select_descifrado` | —            | —             |         1 | 1 (prueba previa al ajuste del campo `origen`) |
| **Total**           |              |               | **2 241** |                                                |

Las 2 236 escrituras de `PARCHE_9` son 1 389 del backfill (642 + 141 + 606) más
847 de la purga: el trigger de auditoría se instaló **antes** del backfill a
propósito, para que la propia migración quede trazada y no haya una ventana sin
registro. El grupo `select_descifrado` con origen `aplicacion` agrupa dos
llamadas de prueba al descifrado, ambas con nivel 3 y motivo declarado (§5
reproduce una de ellas).

El campo `contexto` guarda la lista de columnas modificadas y el origen. Esta es
la fila de la prueba de escritura sin cambios, con el formato que emite el
trigger:

```json
{ "origen": "aplicacion", "tabla": "core.actor_datos_personales", "campos": [] }
```

`usuario` se llena con `session_user`. Dentro de una función `SECURITY DEFINER`,
`current_user` sería `avisa` (el propietario del objeto) y no diría quién
accedió; por eso se usa `session_user`. En este despliegue ambos valen `avisa`
(ver limitación L3 en §8).

---

## 7. Lo que la base no resuelve (diagnóstico honesto)

### 7.1 TLS en tránsito

Estado medido: `SHOW ssl` → **`off`**. No existen `server.crt` ni `server.key` en
`/var/lib/postgresql/data`. `pg_hba.conf` efectivo:

```
local   all  all                      trust
host    all  all  127.0.0.1/32        trust
host    all  all  ::1/128             trust
host    all  all  all                 scram-sha-256
```

Consecuencias: el puerto 55433 se publica en el host y todo el tráfico —incluida
la contraseña y cualquier PII descifrada— viaja sin cifrar; y cualquier proceso
del host entra como `avisa` **sin contraseña** por `127.0.0.1`. El cifrado en
reposo de este parche no protege ese tramo.

Pasos exactos (no implementados aquí; requieren `docker/**` y `compose.yaml`):

1. Emitir el certificado. En producción, con la CA interna de OGTI; en local,
   autofirmado con nombre y SAN que cubran **cómo se conectan los clientes**
   (`localhost`, `avisa-db`, IP publicada):

   ```
   openssl req -new -x509 -days 365 -nodes -newkey rsa:2048 \
     -keyout server.key -out server.crt \
     -subj "/CN=avisa-db" \
     -addext "subjectAltName=DNS:localhost,DNS:avisa-db,IP:127.0.0.1"
   ```

   `verify-full` falla si el SAN no coincide con el host usado en la cadena de
   conexión: es el error más común al activar esto.

2. Instalar los archivos en el clúster (`/var/lib/postgresql/data`) o en otra
   ruta y apuntar `ssl_cert_file` / `ssl_key_file` a ella. Propietario
   `postgres:postgres` y `chmod 600 server.key`: el motor, si el archivo tiene
   permisos más amplios, se niega a arrancar con TLS. El volumen
   `avisa_pgdata` no contiene hoy ninguno de los dos.

3. Parámetros del servidor (en `command:` de `compose.yaml` o en
   `postgresql.conf`):

   ```
   ssl = on
   ssl_min_protocol_version = TLSv1.2
   ssl_prefer_server_ciphers = on
   ```

4. `pg_hba.conf`: sustituir las líneas `trust` y cerrar el paso sin TLS.

   ```
   local   all  all              scram-sha-256
   hostssl all  all  0.0.0.0/0   scram-sha-256
   hostssl all  all  ::/0        scram-sha-256
   hostnossl all all all         reject
   ```

5. Recargar (`SELECT pg_reload_conf();`) y, en la práctica, recrear el contenedor
   para que el cambio quede en la definición. Verificar:

   ```
   SHOW ssl;
   SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid();
   ```

6. Cliente: `sslmode=verify-full` en `DATABASE_URL` y en `psql`. Sin `verify-full`
   (o `verify-ca` con la CA) el cifrado es vulnerable a interposición.

### 7.2 `pgaudit`

Estado medido: `SELECT count(*) FROM pg_available_extensions WHERE name='pgaudit'`
→ **0**. El paquete no está en la imagen; `CREATE EXTENSION pgaudit` fallaría y
**no se intentó**. La trazabilidad de este parche es, por tanto, la tabla
`audit` con triggers: cubre escrituras y descifrados a través de la función, no
lecturas directas a las columnas cifradas ni sentencias del motor.

Pasos exactos (no implementados):

1. En `docker/postgres/Dockerfile`, junto a PostGIS:

   ```
   RUN apt-get update \
       && apt-get install -y --no-install-recommends \
          postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
          postgresql-16-pgaudit \
       && rm -rf /var/lib/apt/lists/*
   ```

   El repositorio PGDG ya está configurado en la imagen base.

2. `shared_preload_libraries = 'pgaudit'` **exige reinicio** del servidor: no se
   puede activar en caliente. En `compose.yaml`:

   ```yaml
   command:
     - postgres
     - -c
     - shared_preload_libraries=pgaudit
     - -c
     - pgaudit.log=ddl,role,function,write
     - -c
     - pgaudit.log_catalog=off
     - -c
     - pgaudit.log_parameter=off
     - -c
     - pgaudit.log_statement_once=on
   ```

   `pgaudit.log_parameter=off` es obligatorio: con `on`, los valores de los
   parámetros (DNI, correo, teléfono) se escribirían **en claro** en el log. Ese
   sería el peor resultado posible de una medida de seguridad.

3. `CREATE EXTENSION pgaudit;` una vez disponible; verificar con
   `SHOW shared_preload_libraries;` y provocando un `CREATE TABLE` de prueba.

4. Un log no es una bitácora inalterable por sí mismo: para que sea evidencia hay
   que enviarlo fuera del contenedor (colector con retención y sellado). Mientras
   eso no exista, `audit.datos_personales_acceso` es la única fuente y su
   inmutabilidad es relativa (§8, L4).

### 7.3 Custodia de la clave

Estado actual: la clave vive en `.env` (fuera de git) de la máquina de
desarrollo y se pasa por línea de comandos. Eso tiene tres fugas posibles:

1. **Línea de comandos:** `docker exec ... -v crypto_key=...` es visible en la
   lista de procesos del host mientras corre.
2. **Historial del intérprete:** si se escribe la clave literal en la shell,
   queda en el historial.
3. **Log del servidor:** si se activa `log_statement=all` o `pgaudit.log_parameter=on`,
   el `set_config('app.crypto_key', ...)` puede quedar escrito en claro.

Lo que corresponde a OGTI:

- Custodiar la clave en el **gestor de secretos institucional** (Vault,
  AWS Secrets Manager, Azure Key Vault u homologado), con acceso auditado y
  rotación programada. Ni en la base, ni en el repositorio, ni en `.env`.
- Inyectarla en el aplicativo al arrancar y fijarla **por conexión**
  (`SET app.crypto_key` al abrir la conexión). Con un pooler en modo
  transacción, usar `SET LOCAL` dentro de cada transacción: un GUC de sesión
  puede filtrarse entre clientes que comparten la conexión física.
- Para operaciones manuales, leerla de un archivo protegido y evitar la CLI
  (`psql -v` queda en `ps`).

Rotación: el esquema **no tiene identificador de versión de clave**. Rotar exige
una ventana de mantenimiento, descifrando con la clave vieja y re-cifrando con la
nueva en una sola transacción:

```sql
BEGIN;
SELECT set_config('app.crypto_key_vieja', :'vieja', true),
       set_config('app.crypto_key',       :'nueva', true);
UPDATE core.actor_datos_personales
   SET dni_cifrado      = pgp_sym_encrypt(pgp_sym_decrypt(dni_cifrado,      current_setting('app.crypto_key_vieja')), current_setting('app.crypto_key'), 'cipher-algo=aes256'),
       email_cifrado    = pgp_sym_encrypt(pgp_sym_decrypt(email_cifrado,    current_setting('app.crypto_key_vieja')), current_setting('app.crypto_key'), 'cipher-algo=aes256'),
       telefono_cifrado = pgp_sym_encrypt(pgp_sym_decrypt(telefono_cifrado, current_setting('app.crypto_key_vieja')), current_setting('app.crypto_key'), 'cipher-algo=aes256'),
       dni_hmac         = hmac(pgp_sym_decrypt(dni_cifrado, current_setting('app.crypto_key_vieja')), current_setting('app.crypto_key'), 'sha256')
 WHERE dni_cifrado IS NOT NULL OR email_cifrado IS NOT NULL OR telefono_cifrado IS NOT NULL;
COMMIT;
```

Recomendación para el próximo parche: columna `clave_version smallint` para poder
rotar sin ventana y sin descifrar todo de golpe.

Respaldos: `pg_dump` incluye los blobs. Sin la clave, el respaldo es ilegible
(protección real); con la clave, el respaldo es tan sensible como la base. La
copia de la clave y la de los respaldos no deben estar en el mismo lugar, y la
clave debe estar fuera del respaldo.

Pérdida de la clave: para las 847 filas actuales el dato se reconstruye del
legado (§5.1), pero **cualquier PII registrada después del parche se perdería
irremediablemente**. Además, contra el `hmac` de un DNI de 8 dígitos, quien
obtenga la clave puede enumerar el espacio completo (10⁸) y revertir la huella
sin descifrar. Es un argumento más para tratarla como secreto de máxima
criticidad y no como configuración.

---

## 8. Limitaciones que quedan abiertas

**L1. RLS inerte.** El rol `avisa` es superusuario con `rolbypassrls`. Las cuatro
políticas `p_clasificacion`/`p_insert`/`p_update`/`p_delete` siguen en la tabla,
pero no limitan a ese rol. Este parche no cambia eso: exige separar roles de
aplicación y de administración (DC-02).

**L2. Los GUC no son credenciales.** `app.clasificacion_max` y `app.crypto_key`
son parámetros personalizados: cualquier sesión puede fijarlos. La base no puede
demostrar que quien los fijó se autenticó. El control efectivo es de red y de
aplicación; aquí el nivel 3 solo evita descifrados accidentales, no un atacante
con conexión directa.

**L3. La bitácora no identifica a la persona.** No hay `SET ROLE` por
funcionario: `session_user` es siempre `avisa`. Para saber _quién_ miró un DNI
hace falta `usuario_id` (FK a `core.usuarios`) pasado explícitamente por el
aplicativo —y, por tanto, falsificable si el aplicativo está comprometido— o
roles de base por usuario. Recomendación: añadir `usuario_id uuid` y registrarlo
desde el backend con el usuario autenticado.

**L4. Inmutabilidad relativa.** Los triggers impiden `UPDATE`/`DELETE`/`TRUNCATE`
a cualquier sesión, incluida `avisa`, pero el propietario puede desactivarlos
(`ALTER TABLE ... DISABLE TRIGGER`) y un superusuario puede hacer lo mismo. La
inmutabilidad real exige sacar la evidencia del servidor (envío de log a storage
WORM) y separar el rol que administra del que audita. Mientras tanto, esta tabla
es un control de uso indebido, no una prueba forense.

**L5. Los intentos denegados no se registran.** Si la función lanza excepción
—nivel insuficiente, motivo vacío, clave ausente, actor inexistente— la
transacción se revierte y con ella el `INSERT` en la bitácora. Queda rastro
indirecto: en las pruebas, un fallo de descifrado consumió el `id` 2238 sin dejar
fila (hueco en la secuencia). Para auditar denegaciones hacen falta `pgaudit` o
un registro fuera de la transacción (por ejemplo `dblink`, o log del
aplicativo). No se implementó.

**L6. Las columnas en claro siguen existiendo.** `dni`, `email`,
`telefono_contacto`, `telefono_alt` y `telefono_raw` quedaron en `NULL`, pero
siguen siendo escribibles: nada impide que un `INSERT` futuro vuelva a guardar
plano. No se añadió un `CHECK (dni IS NULL AND ...)` porque rompería el cargador
del legado. Cuando el cargador se actualice, la opción correcta es restricción
`CHECK` y luego eliminar las columnas.

**L7. Datos sensibles del art. 13 fuera del alcance.** `genero` y
`autoidentificacion_etnica` siguen en claro. Hoy están **vacías** (0 valores en
847 filas), así que no hay exposición actual; si se empiezan a poblar, deben
cifrarse con el mismo criterio. `base_legal` no está vacía: tiene un único valor,
`LEGADO_AVISA_2026`, en las 847 filas, que acredita la procedencia histórica del
dato y no un consentimiento informado. Lo que falta es el consentimiento con
fecha: `fecha_consentimiento` es nula en las 847 filas. Ese es un vacío de
cumplimiento que ningún parche puede rellenar; lo decide y documenta OAIPCS.

**L8. No hay huella del correo.** Buscar por correo obliga a descifrar las 141
filas. Si la búsqueda por correo es un caso de uso, añadir `email_hmac` con el
mismo patrón.

**L9. Duplicados sin resolver.** 45 DNI repetidos y 55 filas sobrantes siguen
ahí, ahora detectables por `hmac`. La fusión de fichas (propuesta v10:
`core.actor_fusion`) no existe en esta base.

**L10. `audit` no está exento de RLS por diseño.** La tabla no activa RLS; solo
el rol `avisa` tiene privilegios sobre ella (ACL vacía = propietario). Si se
crean roles de aplicación, hay que conceder solo `INSERT` y `SELECT`, nunca
`UPDATE`/`DELETE`, y mantener los triggers como segunda barrera.

---

## 9. Operación del parche

### 9.1 Requisitos

- Contenedor `avisa-db` levantado y accesible.
- Clave en `.env` (`APP_CRYPTO_KEY`) o en el gestor de secretos (§7.3).
- Rol con `BYPASSRLS` o superusuario (aquí `avisa`), porque la tabla tiene RLS
  `FORCE` y un rol limitado afectaría 0 filas en silencio.

### 9.2 Ejecución

```sh
docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
  -v crypto_key="$APP_CRYPTO_KEY" -f - \
  < docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql
```

No usar `-f /tmp/...`: MSYS rompe la ruta. El archivo se pasa por entrada
estándar.

### 9.3 Comportamiento en fallo

Todo corre dentro de una única transacción. Si una verificación falla
(roundtrip, HMAC, dependencias, blobs posteriores a la purga), el `RAISE
EXCEPTION` aborta la transacción completa: no queda purga, ni copia, ni columnas
a medio cifrar. El script se ejecutó varias veces durante la puesta a punto
(siete ejecuciones: la primera migró, las siguientes confirmaron idempotencia);
las últimas pasadas dieron `UPDATE 0` y `Purga: nada que vaciar`, sin errores y
con salida 0. Sin `-v crypto_key`, el script aborta con salida 3.

### 9.4 Reversión

El parche es aditivo salvo dos cambios destructivos: la purga del plano y la
eliminación de `core.ix_actor_dni`. Para revertir:

1. Reconstruir el plano desde el legado. El emparejamiento fiable es por nombre
   (`c02`); por código falla en `ACT-720-2` y en los códigos duplicados.
   Hay que cubrir tres orígenes: `dim_actores` (DNI `c03`, teléfono `c04`,
   correo `c05`), `dim_actores_estado` (teléfono `c04`, correo `c05`) y las 14
   filas con varios teléfonos en un campo.
2. Recrear el índice parcial:

   ```sql
   CREATE INDEX IF NOT EXISTS ix_actor_dni
       ON core.actor_datos_personales (dni) WHERE dni IS NOT NULL;
   ```

3. Opcionalmente, retirar los objetos nuevos:

   ```sql
   DROP FUNCTION IF EXISTS core.actor_datos_personales_descifrar(uuid, text);
   DROP VIEW     IF EXISTS core.v_actor_datos_personales_seguro;
   DROP TRIGGER  IF EXISTS tg_audit_datos_personales ON core.actor_datos_personales;
   ALTER TABLE core.actor_datos_personales
       DROP COLUMN IF EXISTS dni_cifrado,
       DROP COLUMN IF EXISTS email_cifrado,
       DROP COLUMN IF EXISTS telefono_cifrado,
       DROP COLUMN IF EXISTS dni_hmac;
   ```

   `audit.datos_personales_acceso` conviene **no** borrarla: es el registro de lo
   ocurrido y su valor es histórico. Si se retira la tabla, se pierde la
   evidencia.

---

## 10. Pendientes, en orden de prioridad

1. **TLS con `hostssl` y `verify-full`** y eliminación de las líneas `trust`
   (§7.1). Es el hueco más grande: sin esto, el cifrado en reposo se anula en
   tránsito.
2. **Custodia de la clave en el gestor de secretos de OGTI**, con rotación e
   inyección por conexión (§7.3).
3. **Rol de aplicación sin `SUPERUSER` ni `BYPASSRLS`** para que el RLS deje de
   ser decorativo (L1).
4. **`pgaudit` + envío del log fuera del contenedor** (§7.2), que además cubriría
   las denegaciones hoy invisibles (L5).
5. **`usuario_id` en la bitácora** para saber quién consultó qué (L3).
6. **`CHECK` de plano nulo o eliminación de las columnas en claro**, cuando el
   cargador del legado escriba directamente en los blobs (L6).
7. **Decisión de OAIPCS sobre los 45 DNI duplicados** (L9) y sobre el
   consentimiento con fecha, hoy nulo en las 847 filas (`base_legal` sí está
   poblada, con `LEGADO_AVISA_2026`) (L7).
8. **`clave_version` y `email_hmac`** si se rota la clave o se busca por correo
   (L7.3, L8).
