# P15 — El rol manda: nivel y capacidades

**Proyecto:** AVISA / SIPRECS — OAIPCS, Ministerio de la Producción
**Marco:** ERS v0.6 §6 (roles y permisos), RA-02, RD-08
**Entorno de aplicación:** contenedor `avisa-db`, PostgreSQL 16, esquema v10
**Parche:** `docs/PARCHE_15_ROLES_Y_BORRADO.sql` (idempotente)
**Estado:** aplicado y verificado en la base viva el 2026-11-20

---

## 1. Resumen

El parche cierra dos agujeros que tenían la misma causa: la base creía lo que
el cliente declaraba.

1. **El nivel ya no se declara, se deduce.** `core.clasificacion_max()` dejó de
   leer `app.clasificacion_max` y ahora busca el rol de la sesión en
   `core.roles`. Sin rol, el nivel es 0 y no se ve ninguna fila.
2. **Ver y escribir se separan.** El nivel decía qué filas se ven, no qué se
   puede hacer. Tres columnas nuevas en `core.roles` (`puede_crear`,
   `puede_editar`, `puede_eliminar`) dicen qué se puede hacer, y se exigen con
   políticas `RESTRICTIVE` que suman por `AND` sobre las `PERMISSIVE` del
   parche 13.

Cifras medidas hoy en `avisa-db`:

| Dato                                   | Valor | Consulta      |
| -------------------------------------- | ----: | ------------- |
| Filas en `core.roles`                  |     9 | §4, Q3        |
| Políticas `r_rol_*`                    |   213 | §3, Q2        |
| Tablas con esas políticas              |    77 | §3, Q2        |
| Cuentas en `core.usuarios`             |    32 | §4, Q4        |
| Asignaciones en `core.usuario_roles`   |    35 | §4, Q4 (suma) |
| Filas en `core.actor_datos_personales` |   847 | §5, Q6        |

`alta_direccion` queda en **solo lectura**: nivel 3, sin crear, editar ni borrar.
`auditor`, `analista_cualitativo`, `servicio_agente` y `curador_politica` crean y
editan, pero no borran.

---

## 2. El bug rol → nivel, explicado en palabras simples

Antes, la base le preguntaba al cliente cuánto podía ver, y le creía. La API
enviaba un número (`app.clasificacion_max`) y la base lo usaba tal cual. Nadie
comprobaba si ese número correspondía al rol de la persona. Un error de una línea
en la API, o una conexión maliciosa, daba nivel 3 a cualquiera.

Ahora la base pide el **código del rol** (`app.rol_codigo`), lo busca en la tabla
`core.roles` y de ahí saca el nivel. El cliente ya no dicta el número.

```
antes:  cliente dice "tengo nivel 3"  →  la base lo cree
ahora:  cliente dice "soy sectorista" →  la base busca el rol y decide
```

El segundo bug era más sutil. El nivel dice qué filas se ven, pero no distingue
leer de escribir. `consulta_lectura` tenía nivel 2 y, con las políticas del
parche 13, podía insertar y actualizar filas de nivel 1 y 2. Se llamaba
«consulta» y escribía. Por eso se añadieron las tres capacidades.

El silencio cierra: sin rol, con rol vacío o con un rol inventado, el nivel es 0
y las capacidades son falsas. Nunca se abre por omisión.

---

## 3. Objetos creados o modificados

| Objeto                                         | Tipo                                     | Qué hace                                                                 |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `core.roles.puede_crear`                       | columna `boolean NOT NULL DEFAULT false` | Autoriza `INSERT`.                                                       |
| `core.roles.puede_editar`                      | columna `boolean NOT NULL DEFAULT false` | Autoriza `UPDATE`.                                                       |
| `core.roles.puede_eliminar`                    | columna `boolean NOT NULL DEFAULT false` | Autoriza `DELETE`.                                                       |
| `ck_roles_capacidades`                         | restricción `CHECK`                      | `NOT puede_eliminar OR puede_editar`. Quien borra, edita.                |
| `core.rol_actual()`                            | función `sql` `STABLE`                   | `NULLIF(current_setting('app.rol_codigo', true), '')`.                   |
| `core.clasificacion_max()`                     | función reescrita                        | Nivel del rol de la sesión; 0 si no hay rol.                             |
| `core.puede_crear()`                           | función `sql`                            | `core.roles.puede_crear` del rol de la sesión.                           |
| `core.puede_editar()`                          | función `sql`                            | `core.roles.puede_editar` del rol de la sesión.                          |
| `core.puede_eliminar()`                        | función `sql`                            | `core.roles.puede_eliminar` del rol de la sesión.                        |
| `r_rol_insert`, `r_rol_update`, `r_rol_delete` | políticas `RESTRICTIVE`                  | Una por tabla y operación, con `core.puede_*()`.                         |
| `avisa_api`                                    | rol de login                             | `LOGIN NOSUPERUSER NOBYPASSRLS`, sin contraseña, miembro de `avisa_app`. |
| `avisa_app`                                    | rol de grupo                             | Sin login, sin `BYPASSRLS`, contenedor de privilegios.                   |
| `ALTER DEFAULT PRIVILEGES`                     | privilegios por defecto                  | Las tablas futuras nacen visibles para `avisa_app`.                      |

### 3.1 Alcance de las políticas restrictivas

```sql
-- Q1 · políticas r_rol_* por esquema
SELECT schemaname, count(*) AS restrictivas
  FROM pg_policies
 WHERE policyname LIKE 'r_rol_%' AND permissive = 'RESTRICTIVE'
 GROUP BY schemaname ORDER BY schemaname;
```

```sql
-- Q2 · total y tablas distintas
SELECT count(*) AS políticas,
       count(DISTINCT (schemaname||'.'||tablename)) AS tablas
  FROM pg_policies WHERE policyname LIKE 'r_rol_%';
-- 213 | 77
```

`core` aporta 127 y el resto de esquemas 86. Las 86 están fuera de `core`, así
que son de este parche. Las 127 de `core` se reparten con el parche 16, que exige
las dependencias del 15 y añade las suyas después sobre 32 tablas.

El bloque 3 del SQL recorre, en tiempo de ejecución, toda tabla que ya tuviera
una política `PERMISSIVE` de `INSERT`, `UPDATE` o `DELETE` por clasificación.
Excluye `audit` (la bitácora debe registrarse desde cualquier sesión) y `staging`.
Por eso `core.roles`, `core.usuarios` y `core.usuario_roles` quedaron fuera: no
tenían políticas `PERMISSIVE`. Ver §7.

---

## 4. La matriz de capacidades resultante

```sql
-- Q3 · roles y capacidades
SELECT id, codigo, max_clasificacion, puede_crear, puede_editar, puede_eliminar
  FROM core.roles ORDER BY id;
```

```sql
-- Q4 · cuentas por rol
SELECT r.codigo, count(ur.usuario_id) AS cuentas
  FROM core.roles r
  LEFT JOIN core.usuario_roles ur ON ur.rol_id = r.id
 GROUP BY r.id, r.codigo ORDER BY r.id;
```

|   # | Rol                    | Nivel máx. | Crea | Edita | Borra | Cuentas |
| --: | ---------------------- | ---------: | :--: | :---: | :---: | ------: |
|   1 | `sectorista`           |          3 |  sí  |  sí   |  sí   |      15 |
|   2 | `administrador`        |          3 |  sí  |  sí   |  sí   |       1 |
|   3 | `consulta_lectura`     |          2 |  no  |  no   |  no   |      17 |
|   4 | `alta_direccion`       |          3 |  no  |  no   |  no   |       2 |
|   5 | `servicio_agente`      |          3 |  sí  |  sí   |  no   |       0 |
|   6 | `auditor`              |          3 |  sí  |  sí   |  no   |       0 |
|   7 | `externo_publico`      |          1 |  no  |  no   |  no   |       0 |
|   8 | `analista_cualitativo` |          3 |  sí  |  sí   |  no   |       0 |
|   9 | `curador_politica`     |          2 |  sí  |  sí   |  no   |       0 |

La columna «cuentas» no suma 32. Suma 35, porque hay tres cuentas con más de un
rol: Edith Bautista León tiene tres (`sectorista`, `administrador`,
`alta_direccion`), y André Jiménez Agapito y Javier Alegre Paredes tienen dos
(`sectorista`, `consulta_lectura`). A cambio, una cuenta no tiene ningún rol:
`Carga legado AVISA 2026`. El total de asignaciones es 35 y todas están abiertas
(`hasta IS NULL`).

```sql
-- Q5 · cuentas con más de un rol
SELECT u.nombre, string_agg(r.codigo, ', ' ORDER BY r.id) AS roles, count(*) AS n
  FROM core.usuarios u
  JOIN core.usuario_roles ur ON ur.usuario_id = u.id
  JOIN core.roles r ON r.id = ur.rol_id
 GROUP BY u.id, u.nombre HAVING count(*) > 1;
```

De las 32 cuentas, 28 están activas y 4 inactivas. Las 4 inactivas conservan una
asignación cada una.

Dos notas sobre la matriz:

- El nivel máximo del rol está acotado por el catálogo de clasificación:
  1 Público, 2 Reservado, 3 Confidencial.
- La política `PERMISSIVE` de `DELETE` exige nivel 3. Por eso `curador_politica`,
  que tiene nivel 2, no podría borrar aunque se le concediera la capacidad. El
  nivel y la capacidad son dos cerrojos, no uno.

---

## 5. Pruebas de aislamiento

Todas las pruebas se ejecutaron con `SET LOCAL ROLE avisa_app`. Es obligatorio:
la conexión de `psql` es `avisa`, que es superusuario con `BYPASSRLS`, y sin
cambiar de rol cualquier prueba pasaría sin tocar las políticas. Cada prueba
termina en `ROLLBACK`; no se escribió ningún dato real.

| Rol de sesión                                    | Operación                                    | Filas afectadas | Esperado  |
| ------------------------------------------------ | -------------------------------------------- | --------------: | --------- |
| `alta_direccion`                                 | `SELECT count(*)` sobre 847 filas de nivel 3 |             847 | 847       |
| `alta_direccion`                                 | `UPDATE`                                     |               0 | 0         |
| `sectorista`                                     | `UPDATE`                                     |             847 | 847       |
| `sectorista`                                     | `INSERT` de una fila                         |               1 | 1         |
| `sectorista`                                     | `DELETE`                                     |             847 | 847       |
| `auditor`                                        | `UPDATE`                                     |             847 | 847       |
| `auditor`                                        | `DELETE`                                     |               0 | 0         |
| `analista_cualitativo`                           | `DELETE`                                     |               0 | 0         |
| `servicio_agente`                                | `DELETE`                                     |               0 | 0         |
| `curador_politica`                               | `DELETE`                                     |               0 | 0         |
| `consulta_lectura`                               | `SELECT count(*)`                            |               0 | 0         |
| `consulta_lectura`                               | `UPDATE`                                     |               0 | 0         |
| `consulta_lectura`                               | `INSERT`                                     |   error `42501` | error     |
| `consulta_lectura` + `app.clasificacion_max='3'` | `core.clasificacion_max()`                   |               2 | 2         |
| sin rol                                          | `core.clasificacion_max()`                   |               0 | 0         |
| `rol_que_no_existe`                              | nivel / `core.puede_crear()`                 |       0 / falso | 0 / falso |

Lectura de los resultados:

- `alta_direccion` ve las 847 filas confidenciales y no escribe **ninguna**. Ese
  era el objetivo: leer todo, no capturar.
- `auditor` edita 847 y borra 0. La asimetría editar/borrar es exactamente la que
  pedía el parche.
- `consulta_lectura` no ve nada de nivel 3 (nivel 2) y no escribe nada.
- La prueba clave del primer bug: con `app.clasificacion_max = '3'` declarado por
  la sesión, el nivel sigue siendo **2** y no aparece ninguna fila. El parámetro
  se ignora.
- `INSERT` bajo `consulta_lectura` no devuelve 0 filas: lanza
  `new row violates row-level security policy for table "actor_datos_personales"`,
  que es el comportamiento correcto de un `WITH CHECK`.

```sql
-- Q6 · tamaño de la tabla de prueba
SELECT count(*) AS filas FROM core.actor_datos_personales;  -- 847
```

```sql
-- Q7 · prueba del bug cerrado
BEGIN;
SET LOCAL ROLE avisa_app;
SET LOCAL app.rol_codigo = 'consulta_lectura';
SET LOCAL app.clasificacion_max = '3';
SELECT core.clasificacion_max() AS nivel, count(*) AS visibles
  FROM core.actor_datos_personales;
ROLLBACK;
-- nivel = 2, visibles = 0
```

---

## 6. Cómo se reproduce

Aplicar el parche (idempotente; se puede repetir):

```sh
docker exec -i avisa-db psql -U avisa -d avisa -v ON_ERROR_STOP=1 \
  -f - < docs/PARCHE_15_ROLES_Y_BORRADO.sql
```

Debe terminar con `PARCHE 15 aplicado.` y con `9 de 9` roles coherentes.

Repetir una prueba de aislamiento:

```sh
MSYS_NO_PATHCONV=1 docker exec avisa-db psql -U avisa -d avisa -c "
BEGIN;
SET LOCAL ROLE avisa_app;
SET LOCAL app.rol_codigo = 'alta_direccion';
UPDATE core.actor_datos_personales SET actor_uid = actor_uid;
ROLLBACK;"
-- UPDATE 0
```

Cambiar `'alta_direccion'` por `'sectorista'` da `UPDATE 847`. La diferencia es
solo el rol.

Comprobar que la función ya no lee el parámetro del cliente:

```sh
MSYS_NO_PATHCONV=1 docker exec avisa-db psql -U avisa -d avisa -c \
 "SELECT pg_get_functiondef('core.clasificacion_max()'::regprocedure);"
```

Debe aparecer `FROM core.roles r WHERE r.codigo = core.rol_actual()` y **ninguna**
referencia a `app.clasificacion_max`.

Revisar el inventario que imprime el propio parche (bloque 5): la tabla de roles
con `nivel`, `crea`, `edita`, `borra` y el conteo de políticas `r_rol_%`.

---

## 7. Lo que el SQL no resuelve

**1. `app.rol_codigo` lo sigue declarando el cliente.** El parche cerró el número,
no la declaración. Quien tenga las credenciales de `avisa_api` puede fijar el rol
que quiera. Comprobado:

```sql
BEGIN; SET LOCAL ROLE avisa_app;
SET LOCAL app.rol_codigo = 'consulta_lectura';
SET LOCAL app.rol_codigo = 'administrador';
SELECT core.clasificacion_max(), core.puede_eliminar();  -- 3 | t
ROLLBACK;
```

La frontera de confianza es el proceso de la API, no la base. El nivel ya no se
puede inflar más allá de lo que diga `core.roles`, pero el rol sí se puede
suplantar. La base no sabe a qué usuario autenticó el IdP.

**2. El catálogo de roles es escribible por la aplicación.** `core.roles` no tiene
RLS (`relrowsecurity = f`) y `avisa_app` tiene `INSERT`, `UPDATE` y `DELETE`
sobre ella. Comprobado:

```sql
BEGIN; SET LOCAL ROLE avisa_app;
UPDATE core.roles SET puede_editar = true WHERE codigo = 'consulta_lectura';
ROLLBACK;  -- UPDATE 1
```

Lo mismo vale para `core.usuarios` y `core.usuario_roles`. Una API comprometida
puede concederse capacidades o asignarse un rol. La tabla que define los permisos
no está protegida por permisos.

**3. La sesión aplica un solo rol.** `app.rol_codigo` es un valor único. Hoy Edith
acumula tres roles (`sectorista`, `alta_direccion`, `administrador`) y la regla
vigente en el ERS §6 es «opera con el rol de mayor alcance». Ese criterio no está
decidido formalmente: queda abierto el vacío **H-79** (cómo se elige el rol de la
sesión y si la persona puede cambiarlo). Mientras siga abierto, el rol efectivo de
una persona con varios roles depende de la aplicación.

**4. «Quién audita» no sale de la tabla.** `core.puede_auditar()` conserva una
lista fija de códigos:

```sql
SELECT COALESCE(current_setting('app.rol_codigo', true), '') IN
       ('administrador', 'auditor', 'alta_direccion');
```

Deja fuera a `sectorista`, `servicio_agente` y `analista_cualitativo`, que también
son nivel 3. Es una segunda fuente de verdad sobre los permisos, no derivada de
`core.roles`.

**5. Un `HINT` desactualizado.** `core.actor_datos_personales_descifrar(uuid, text)`
ya calcula el nivel con `core.clasificacion_max()`, pero su mensaje de ayuda sigue
diciendo «`app.clasificacion_max` la fija el aplicativo tras autenticar». La
lógica es correcta; el texto engaña al operador. Es el único resto del parámetro
viejo en la base: no queda ninguna política, vista ni función que lo use como
dato (0 políticas, 0 vistas, 1 función y solo en el texto del `HINT`).

**6. El superusuario sigue saltando todo.** `avisa` es `rolsuper` y `rolbypassrls`.
Las políticas se aplican a `avisa_app` y a `avisa_api`, pero cualquier operación
hecha como `avisa` no las ve. Es el mismo riesgo DC-02 del informe P9: la
superusuario queda reservada a operación y migración.

**7. Consecuencia del nivel 3.** Como «ver PII en claro» equivale a «tener un rol
de nivel 3», la población que puede descifrar pasó a depender de la tabla de
roles. Hoy son **16 de las 31 cuentas con rol** las que alcanzan nivel 3 (las otras
15 se quedan en 2):

```sql
SELECT t.nivel_max, count(*) AS cuentas
  FROM (SELECT u.id, max(r.max_clasificacion) AS nivel_max
          FROM core.usuarios u
          JOIN core.usuario_roles ur ON ur.usuario_id = u.id
          JOIN core.roles r ON r.id = ur.rol_id
         GROUP BY u.id) t
 GROUP BY t.nivel_max ORDER BY 1;
-- 2 | 15
-- 3 | 16
```

Las 32 cuentas incluyen una sin rol (`Carga legado AVISA 2026`), por eso la suma es
31 y no 32. No es un defecto del parche; es el mapa de acceso que el parche deja
a la vista.
