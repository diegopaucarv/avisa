# P18 — Tope de gasto con aviso y RLS del catálogo de identidad

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** ERS v0.6 — RNF-13 (consumo y tope con aviso), RM-04 (pago por uso), §6.3 y §6.5
**Decisiones abiertas que lo condicionan:** H-65 (monto del tope), H-52 (identidad de sesión)
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_18_COSTOS_Y_RLS_ADMIN.sql` (idempotente, re-ejecutable)
**Estado:** aplicado y verificado en la base viva el 2026-11-20

---

## 1. Resumen

El parche 17 dejó el costo escrito al lado de cada llamada y de cada envío, pero
nada que lo sumara, lo comparara con un tope ni dijera cuándo avisar. Este parche
cierra esa mitad de RNF-13: un catálogo de servicios externos, una tabla de topes,
una vista de consumo por servicio y mes, el estado de cada tope, una vista de
aviso y dos funciones de control (`config.gasto_mes`, `config.puede_gastar`).

Cierra además una puerta que había quedado abierta en el catálogo de identidad.
`core.roles`, `core.usuarios` y `core.usuario_roles` no tenían seguridad por fila
y la aplicación conservaba `INSERT`, `UPDATE` y `DELETE` sobre ellas. Un
`UPDATE core.roles SET max_clasificacion = 3` desde la API elevaba el nivel de
cualquier rol. El parche 15 había cerrado el mismo agujero por el lado de
`app.clasificacion_max`; esta era la otra entrada.

Cierra además dos defectos que solo aparecieron al probar lo anterior:

- **El esquema `config` era inalcanzable para la aplicación.** No estaba en los
  privilegios por defecto del parche 15, así que `avisa_app` no tenía ni `USAGE`
  sobre él. Los objetos de este parche habrían nacido invisibles y
  `config.puede_gastar()` habría respondido «permission denied for schema
  config»: el tope existía en el papel y no se podía consultar. El bloque 6 lo
  resuelve y deja el privilegio por defecto puesto para las tablas futuras.
- **Dos topes vigentes a la vez duplicaban el consumo.** El cruce con
  `config.tope_gasto` era un `LEFT JOIN` normal; si dos filas cubrían el mismo
  mes (ambas con `vigente_hasta` en `NULL`), la vista mostraba el mes dos veces y
  `config.gasto_mes()` sumaba el gasto dos veces, bloqueando el servicio antes de
  tiempo. Ahora gana el tope de `vigente_desde` más reciente.

En cifras: **20 políticas nuevas** (`p18_*`), **RLS + FORCE en 5 tablas** y la
base pasa de **520 políticas sobre 82 tablas a 540 sobre 87**. `config` crece de
6 a 8 tablas.

Lo que el SQL **no** hace, y conviene decirlo antes de cualquier tabla: no fija
ningún monto. `config.tope_gasto` tiene **0 filas** porque la cifra es la decisión
abierta H-65. Tampoco envía avisos: deja la consulta que decide cuándo avisar
(`config.v_tope_aviso`) y el envío es del aplicativo. Se detalla en §6.

Ninguna cifra de este informe es estimada. Todas salen de `SELECT` ejecutados
contra `avisa-db` el 2026-11-20 y se reproducen en §5.

---

## 2. Objetos creados o modificados

| Objeto                                                                            | Tipo                                | Qué hace                                                                                                                         |
| --------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `config.servicio_externo`                                                         | tabla (8 columnas, 4 filas)         | Catálogo de los SVC-xx con costo: unidad de medida (token, mensaje, consulta) y costo unitario de referencia.                    |
| `config.tope_gasto`                                                               | tabla (11 columnas, 0 filas)        | Tope de gasto por servicio y periodo. `monto_usd`, `umbral_aviso_pct`, vigencia, aprobación y observación.                       |
| `ux_tope_gasto_servicio_periodo_desde`                                            | índice único                        | Un solo tope por servicio, periodo y fecha de inicio de vigencia.                                                                |
| `ck_tope_monto_positivo`, `ck_tope_umbral`, `ck_tope_periodo`, `ck_tope_vigencia` | restricciones `CHECK`               | Monto mayor que 0; umbral entre 1 y 100; periodo solo `mensual`; `vigente_hasta` no anterior a `vigente_desde`.                  |
| `fk` de `tope_gasto.servicio_codigo`                                              | clave ajena                         | Apunta a `config.servicio_externo(codigo)`: no se puede topar un servicio que no esté en el catálogo.                            |
| `config.v_consumo_servicio_mes`                                                   | vista                               | Una fila por servicio y mes: unidades, tokens, `costo_usd`, `tope_usd`, `pct_consumido` y `estado`.                              |
| `config.v_tope_aviso`                                                             | vista                               | Solo las filas con `estado` en `aviso` o `excedido`. Si devuelve filas, hay algo que avisar.                                     |
| `config.gasto_mes(text, date)`                                                    | función SQL `STABLE`                | Costo acumulado de un servicio en un mes. Sin segundo argumento, el mes en curso. Devuelve 0, nunca `NULL`.                      |
| `config.puede_gastar(text)`                                                       | función SQL `STABLE`                | `false` solo si el servicio ya está `excedido` en el mes en curso.                                                               |
| `core.roles`, `core.usuarios`, `core.usuario_roles`                               | tablas con RLS habilitado y forzado | Dejan de ser escribibles por la aplicación en general.                                                                           |
| `config.servicio_externo`, `config.tope_gasto`                                    | tablas con RLS habilitado y forzado | Lectura reservada a nivel 3; escritura reservada al rol `administrador`.                                                         |
| `avisa_app` · `USAGE` sobre `config` + privilegios                                | permisos (bloque 6)                 | Sin ellos los objetos de arriba nacían inalcanzables: `config.puede_gastar()` fallaba con «permission denied for schema config». |
| `ALTER DEFAULT PRIVILEGES` en `config`                                            | permisos por defecto                | Las tablas y funciones futuras de `config` nacen visibles para `avisa_app`; el fallo deja de reaparecer en producción.           |

Las 20 políticas, por tabla:

| Tabla                     | Políticas | Comandos cubiertos             | Quién pasa                                                                      |
| ------------------------- | --------: | ------------------------------ | ------------------------------------------------------------------------------- |
| `core.roles`              |         4 | SELECT, INSERT, UPDATE, DELETE | SELECT: cualquiera (ver §3.3). Escritura: `administrador`.                      |
| `core.usuarios`           |         4 | SELECT, INSERT, UPDATE, DELETE | SELECT: `administrador` o la fila propia. Escritura: `administrador`.           |
| `core.usuario_roles`      |         4 | SELECT, INSERT, UPDATE, DELETE | SELECT: `administrador` o las asignaciones propias. Escritura: `administrador`. |
| `config.servicio_externo` |         4 | SELECT, INSERT, UPDATE, DELETE | SELECT: `core.clasificacion_max() >= 3`. Escritura: `administrador`.            |
| `config.tope_gasto`       |         4 | SELECT, INSERT, UPDATE, DELETE | SELECT: `core.clasificacion_max() >= 3`. Escritura: `administrador`.            |
| **Total**                 |    **20** |                                | 12 en `core`, 8 en `config`.                                                    |

---

## 3. Antes y después

### 3.1 La tabla

| Indicador                                        | Antes del 18 | Después | Cambio |
| ------------------------------------------------ | -----------: | ------: | -----: |
| Políticas RLS en toda la base                    |          520 | **540** |    +20 |
| Tablas con al menos una política                 |           82 |  **87** |     +5 |
| `core` · tablas con RLS                          |           45 |  **48** |     +3 |
| `core` · políticas                               |          303 | **315** |    +12 |
| Tablas de `config`                               |            6 |   **8** |     +2 |
| Políticas en `config`                            |            0 |   **8** |     +8 |
| Tablas con RLS + FORCE puestas por este parche   |     no había |   **5** |     +5 |
| Filas en `config.servicio_externo`               |   no existía |   **4** |      — |
| Filas en `config.tope_gasto`                     |   no existía |   **0** |      — |
| `avisa_app` con `USAGE` sobre `config`           |           no |  **sí** |     +1 |
| `avisa_app` puede leer `config.servicio_externo` |           no |  **sí** |     +1 |

Estado global medido el 2026-11-20, después del parche:

| Métrica                                | Valor |
| -------------------------------------- | ----: |
| Tablas físicas                         |   289 |
| Tablas lógicas                         |   265 |
| Particiones                            |    24 |
| Columnas físicas                       | 2 511 |
| Columnas lógicas                       | 2 145 |
| Columnas lógicas con comentario        | 2 126 |
| Columnas lógicas sin describir         |    19 |
| Claves ajenas                          |   610 |
| Tablas en `legacy`                     |    87 |
| Tablas en `core`                       |   102 |
| Tablas de `core` con RLS               |    48 |
| Tablas de `core` sin RLS (a propósito) |    54 |

### 3.2 Aritmética del cambio

Los números cuadran con lo que el SQL hace, sin residuo:

```
520 políticas + 20 p18_*   = 540
 82 tablas    +  5 tablas  =  87
303 políticas core + 12     = 315
 45 tablas core    +  3     =  48
```

`config` no tenía ninguna política antes: 520 = 303 (core) + 0 (config) + 217
(resto de esquemas), y 540 = 315 (core) + 8 (config) + 217. Las 54 tablas de
`core` que siguen sin RLS no son un olvido: son tablas de catálogo y de
referencia que el parche 16 dejó fuera con criterio.

### 3.3 La lectura abierta de `core.roles`

La política `p18_roles_sel` deja `SELECT` abierto a cualquier sesión:

```sql
CREATE POLICY p18_roles_sel ON core.roles FOR SELECT USING (true);
```

No es un descuido. `core.rol_actual()` lee `app.rol_codigo`, pero
`core.clasificacion_max()` y `puede_crear()`, `puede_editar()` y
`puede_eliminar()` leen `core.roles` directamente. Las cinco son `STABLE` y
ninguna tiene `SECURITY DEFINER`: corren con los permisos de quien las llama y
las usa todo el sistema. Si se cerrara ese `SELECT`, cada consulta devolvería
`NULL` o `false`, `clasificacion_max()` daría 0 y el sistema se apagaría solo.

La protección que importa está en la escritura: `INSERT`, `UPDATE` y `DELETE`
exigen `core.rol_actual() = 'administrador'`. Antes, un `UPDATE` desde la
aplicación cambiaba `max_clasificacion` de cualquier rol; ahora no cambia
ninguna fila.

---

## 4. Pruebas de aislamiento y de tope

Todas las pruebas de RLS se corrieron con `SET LOCAL ROLE avisa_app` dentro de
una transacción, nunca como `avisa`. El usuario `avisa` es superusuario y tiene
`BYPASSRLS`: una prueba hecha con esa conexión se salta la política y no prueba
nada.

| Prueba                                                                | Antes                     | Ahora                                                 |
| --------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| `sectorista` · `UPDATE core.roles`                                    | `UPDATE 1`                | `UPDATE 0`                                            |
| `sectorista` · `SELECT core.roles`                                    | 9 filas                   | 9 filas                                               |
| `sectorista` · `SELECT core.usuarios`                                 | 32                        | 0                                                     |
| `administrador` · `SELECT core.usuarios` / `core.usuario_roles`       | 32 / 35                   | 32 / 35                                               |
| `administrador` · `UPDATE core.roles`                                 | `UPDATE 1`                | `UPDATE 1` (revertido)                                |
| Fila propia (`app.usuario_id = fa454b34-b866-4313-9606-b14c8cbd2eaf`) | —                         | 1 usuario + 3 asignaciones                            |
| Tope al 85 % de consumo                                               | —                         | estado `aviso`                                        |
| Tope al 115 %                                                         | —                         | estado `excedido`; `puede_gastar('SVC-06')` = `false` |
| `sectorista` · `SELECT config.servicio_externo`                       | error `permission denied` | 4 filas                                               |
| `consulta_lectura` (nivel 2) · `SELECT config.servicio_externo`       | —                         | 0 filas (la lectura es de nivel 3)                    |
| `avisa_app` · `INSERT` en `config.tope_gasto` sin ser administrador   | —                         | rechazado por RLS                                     |
| Dos topes que cubren el mismo mes · `gasto_mes('SVC-06')`             | 20 (sumaba dos veces)     | **10** (una sola fila)                                |
| Dos topes · cuál se aplica                                            | —                         | el de `vigente_desde` más reciente                    |

Cómo se leen las filas menos obvias:

- **`sectorista` y `core.roles`: 9 filas antes y después.** Es el resultado
  correcto. El rol necesita leer el catálogo para que `clasificacion_max()` y las
  capacidades del parche 15 funcionen (§3.3).
- **`sectorista` y `core.usuarios`: de 32 a 0.** En esa sesión no se fijó
  `app.usuario_id`, así que no había fila propia que mostrar y tampoco era
  administradora. Con el UUID propio, la misma persona ve 1 fila y sus 3
  asignaciones, como muestra la fila siguiente.
- **`administrador` y `core.roles`: `UPDATE 1`, revertido.** La política permite
  escribir al administrador. La transacción se revirtió: no quedó ningún cambio
  en la base.
- **Tope al 85 % y al 115 %.** Se probaron con filas de `config.tope_gasto`
  creadas en transacción y revertidas. Al 85 % el estado es `aviso`; al 115 %,
  `excedido`, y `config.puede_gastar()` empieza a devolver `false`.
- **`sectorista` y el catálogo: de error a 4 filas.** Antes del bloque 6 de
  permisos, la consulta ni siquiera llegaba a la tabla: PostgreSQL respondía
  `permission denied for schema config`. Es lo que hacía inútil el mecanismo
  entero, porque el aplicativo no podía preguntar si quedaba saldo.
- **`consulta_lectura` y el catálogo: 0 filas.** La política de lectura exige
  nivel 3 y ese rol es nivel 2. No es un fallo: es la misma regla que deja al
  personal de lectura fuera del panel de costos.
- **`INSERT` rechazado.** La política de escritura exige
  `core.rol_actual() = 'administrador'`; sin ese rol en la sesión, PostgreSQL
  responde «new row violates row-level security policy». El `GRANT` deja pasar,
  la RLS decide: por eso la prueba tiene que hacerse con `avisa_app` y no con
  `avisa`.
- **Dos topes que cubren el mismo mes: `gasto_mes` valía 20.** Con un
  `LEFT JOIN` normal, dos filas de `config.tope_gasto` vigentes a la vez (ambas
  con `vigente_hasta` en `NULL`) duplicaban la fila de consumo: la vista mostraba
  el mismo mes dos veces y la suma del gasto se iba al doble, lo que bloqueaba
  el servicio antes de tiempo. Se corrigió con un `LATERAL` que se queda con el
  tope de `vigente_desde` más reciente (`ORDER BY vigente_desde DESC, creado_en
DESC LIMIT 1`). Ahora la vista devuelve una fila y `gasto_mes` devuelve 10, no 20.

---

## 5. Cómo se reproduce

Todas las consultas se ejecutaron con este envoltorio:

```
MSYS_NO_PATHCONV=1 docker exec avisa-db psql -U avisa -d avisa -t -c "..."
```

Aplicación del parche:

```
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f /dev/stdin < docs/PARCHE_18_COSTOS_Y_RLS_ADMIN.sql
```

El parche se ejecutó **cuatro veces** con éxito: la última, ya con los permisos
y el arreglo del tope duplicado. Ninguna pasada cambió datos ni duplicó objetos:
es idempotente (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `CREATE OR REPLACE`
y `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY`).

Prueba de aislamiento, con el patrón usado en todas las verificaciones de RLS:

```sql
BEGIN;
SET LOCAL ROLE avisa_app;
SELECT set_config('app.rol_codigo', 'sectorista', true);

SELECT count(*) FROM core.roles;                 -- 9
UPDATE core.roles SET max_clasificacion = 3;     -- UPDATE 0
SELECT count(*) FROM core.usuarios;              -- 0

ROLLBACK;
```

Prueba de la fila propia:

```sql
BEGIN;
SET LOCAL ROLE avisa_app;
SELECT set_config('app.usuario_id',
                  'fa454b34-b866-4313-9606-b14c8cbd2eaf', true);

SELECT count(*) FROM core.usuarios;        -- 1
SELECT count(*) FROM core.usuario_roles;   -- 3

ROLLBACK;
```

Prueba del tope. El monto se calcula sobre el consumo medido del mes, para que
el porcentaje sea el que se quiere probar y no una cifra inventada. Requiere que
el servicio tenga consumo con costo mayor que 0 en el mes en curso; si no lo
tiene, el tope no se puede expresar como porcentaje.

```sql
BEGIN;

-- 85 % del tope: el estado debe ser `aviso`
INSERT INTO config.tope_gasto (servicio_codigo, periodo, monto_usd, umbral_aviso_pct)
SELECT servicio_codigo, 'mensual', round(costo_usd / 0.85, 2), 80
  FROM config.v_consumo_servicio_mes
 WHERE mes = date_trunc('month', now())::date
   AND servicio_codigo = 'SVC-06'
   AND costo_usd > 0;

SELECT servicio_codigo, costo_usd, tope_usd, pct_consumido, estado
  FROM config.v_consumo_servicio_mes
 WHERE mes = date_trunc('month', now())::date;

ROLLBACK;
```

Para el 115 % se repite con `round(costo_usd / 1.15, 2)` y se agrega:

```sql
SELECT config.puede_gastar('SVC-06');   -- false
```

Prueba de permisos del rol de la aplicación:

```sql
BEGIN;
SET LOCAL ROLE avisa_app;
SELECT set_config('app.rol_codigo', 'sectorista', true);

SELECT count(*) FROM config.servicio_externo;      -- 4
SELECT config.puede_gastar('SVC-06');              -- true (sin tope cargado)

-- con 'consulta_lectura' en su lugar, el catálogo da 0 filas:
-- SELECT count(*) FROM config.servicio_externo;   -- 0

ROLLBACK;
```

Prueba del tope duplicado, la que destapó el error de la suma:

```sql
BEGIN;
-- dar costo a un envío del mes en curso, para que el porcentaje signifique algo
UPDATE core.envios_comunicacion
   SET costo_estimado_usd = 10, canal = 'Correo', fecha_envio = now()
 WHERE id = (SELECT id FROM core.envios_comunicacion ORDER BY id LIMIT 1);

-- dos topes vigentes a la vez: el viejo con 1 000 y el del mes con 12
INSERT INTO config.tope_gasto (servicio_codigo, monto_usd, vigente_desde)
VALUES ('SVC-06', 1000, date_trunc('month', now() - interval '2 month')::date);
INSERT INTO config.tope_gasto (servicio_codigo, monto_usd, vigente_desde)
VALUES ('SVC-06', 12, date_trunc('month', now())::date);

SELECT count(*)                        -- 1, no 2
  FROM config.v_consumo_servicio_mes
 WHERE servicio_codigo = 'SVC-06' AND mes = date_trunc('month', now())::date;

SELECT config.gasto_mes('SVC-06');     -- 10, no 20

SELECT tope_usd, pct_consumido, estado -- 12.00 | 83.3 | aviso
  FROM config.v_consumo_servicio_mes
 WHERE servicio_codigo = 'SVC-06' AND mes = date_trunc('month', now())::date;

ROLLBACK;
```

Con `monto_usd = 5` en lugar de 12 el estado pasa a `excedido`, `puede_gastar()`
devuelve `false` y `config.v_tope_aviso` devuelve una fila.

Consultas de inspección, sin transacción:

```sql
-- catálogo sembrado
SELECT codigo, nombre, unidad, costo_unitario_usd FROM config.servicio_externo ORDER BY codigo;

-- estado de cada servicio en el mes en curso
SELECT servicio_codigo, servicio, costo_usd, tope_usd, pct_consumido, estado
  FROM config.v_consumo_servicio_mes
 WHERE mes = date_trunc('month', now())::date
 ORDER BY servicio_codigo;

-- ¿hay algo que avisar?
SELECT * FROM config.v_tope_aviso;

-- políticas y RLS del parche
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname IN ('core', 'config')
   AND c.relname IN ('roles', 'usuarios', 'usuario_roles', 'servicio_externo', 'tope_gasto')
 ORDER BY 1;
```

---

## 6. Lo que el SQL no resuelve

**1. No hay ningún tope cargado.** `config.tope_gasto` tiene 0 filas porque el
monto es la decisión abierta H-65. Mientras no se cargue una fila, el estado de
cada servicio es `sin_tope` y `config.puede_gastar()` devuelve `true` siempre.
El mecanismo está listo; la cifra no. Tampoco hay costo unitario de referencia:
las 4 filas del catálogo tienen `costo_unitario_usd` en `NULL`.

**2. El aviso no lo envía la base.** `config.v_tope_aviso` devuelve filas y ahí
termina el trabajo del esquema. Quien avisa es el aplicativo, por correo
institucional (SVC-06) o WhatsApp (SVC-07), como pide RNF-13. La base no manda
correos ni mensajes, y no queda registro de que el aviso se haya enviado.

**3. `config` no tenía RLS antes de este parche.** Lo que se protege aquí son
dos tablas de configuración —catálogo de servicios y topes—, no datos
personales. La lectura se reserva a nivel 3 y la escritura al rol
`administrador`. El resto de `config` sigue como estaba.

**4. Las vistas de costo no son `security_invoker`, a propósito.** Sus tres
fuentes tienen RLS: `agent.llm_call` y `core.envios_comunicacion` por
clasificación, y `core.consulta_reniec` por privilegio. Si la vista corriera con
los permisos de quien la consulta, cada persona vería un total distinto del
mismo mes —y del mismo servicio— y el tope no significaría nada. Por eso corre
con los permisos del dueño y el control de quién ve el panel queda en el
aplicativo (§6.3 del ERS). Es una decisión, no un olvido.

**5. Los 4 servicios sembrados son los que el ERS ya nombra.** SVC-02 (Gemini),
SVC-06 (correo), SVC-07 (WhatsApp) y SVC-16 (PIDE-RENIEC). Si aparece otro
servicio con costo, hay que insertarlo a mano en el catálogo; el parche no lo
descubre solo. Además, la vista etiqueta como `SVC-OTROS` los envíos cuyo
`canal` no coincide con WhatsApp ni con correo: se ven en el consumo, pero no
tienen fila en el catálogo ni, por tanto, tope.

**6. Los permisos del rol de la aplicación: resuelto dentro del parche, con un
resto fuera de él.** La primera versión del bloque no otorgaba nada a
`avisa_app`, y el esquema `config` no estaba entre los que cubren los

privilegios por defecto del parche 15. La consecuencia era silenciosa y grave:
`config.puede_gastar()` existía, tenía `EXECUTE`, y aun así el aplicativo recibía
«permission denied for schema config». El bloque 6 lo cierra con `USAGE`,
`SELECT` sobre todo `config`, escritura sobre las dos tablas de tope, `EXECUTE`
sobre las dos funciones y `ALTER DEFAULT PRIVILEGES` para lo que venga después.

Queda fuera del parche y sin resolver: **otros 17 esquemas siguen sin `USAGE`
para `avisa_app`** —`agent`, `chat`, `community`, `ctx`, `domain`, `economic`,
`forecast`, `impact`, `legacy`, `lex`, `model`, `mype`, `pesca`, `policy`,
`proteccion`, `qda` y `staging`—. De ellos, el que más pesa es `policy` (8
tablas de reglas y escenarios), porque está en el alcance del MVP. No se
concedieron aquí porque no es una decisión de este parche: `legacy` guarda el
volcado histórico crudo y `staging` es la zona de carga del ETL; abrirlos a la
API sin discutirlo sería un retroceso de seguridad.

**7. Por debajo del nivel 3, el tope no frena nada.** `config.puede_gastar()` y

`config.gasto_mes()` leen `config.tope_gasto`, que tiene RLS de lectura para
nivel 3. Si las llama un rol de nivel 2, la tabla le devuelve 0 filas, el gasto
calculado es 0 y la respuesta es `true`: el control falla abierto. Hoy no hay
ruta de la aplicación por la que un nivel 2 dispare un gasto —quien sincroniza y
envía es `sectorista` (nivel 3) o `administrador`—, así que el riesgo es de
defensa en profundidad. Si OAIPCS quiere un candado duro, la función debe ser
`SECURITY DEFINER` y decidir ella misma el permiso, en lugar de heredar la
visibilidad de quien la llama.

**8. Las funciones no validan el código de servicio.**
`config.gasto_mes('SVC-99')` devuelve `0` y `config.puede_gastar('SVC-99')`
devuelve `true`: un error de tecleo en el aplicativo se lee como «no hay gasto,
adelante». Devolver un error sería más honesto, pero cambiaría el contrato de
una función que el aplicativo ya va a llamar con códigos del catálogo.

**9. `umbral_aviso_pct = 100` es válido y no avisa.** El `CHECK` admite de 1 a
100; con 100 el estado salta de `normal` a `excedido` sin pasar por `aviso`.
Está permitido a propósito —hay quien quiere solo el corte—, pero conviene
saberlo antes de configurar un tope.
