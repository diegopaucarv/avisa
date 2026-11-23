# AVISA en Neon

Esta carpeta contiene la variante del esquema unificado preparada para
ejecutarse en un proyecto **Neon (PostgreSQL 18)**.

| Archivo                           | Qué es                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `AVISA_V10_ESQUEMA_UNIFICADO.sql` | Copia derivada y **mantenida a mano** de `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql`. |
| `README.md`                       | Este documento: cómo subir la base y qué cambia respecto de Neon.                |

> El original queda intacto. El «NO EDITAR A MANO» de su cabecera describe al
> generador (`migration/consolidar_esquema.py`); esta copia sí se edita, y si
> se vuelve a consolidar el esquema hay que rehacer las diferencias de abajo.

---

## 1. Dos caminos (hay que elegir uno)

### A. Copiar la base actual, con datos — **recomendado**

Es lo que normalmente se busca al «subir la base a Neon»: llevar el estado
real (35 casos, 83 alertas, 33 usuarios, 87 tablas de `legacy`, 561 políticas
RLS…) sin reconstruir nada. Se hace con `pg_dump`/`pg_restore`, **no** con este
script.

### B. Construir el esquema desde cero

El script unificado sirve para crear el modelo vacío y luego cargar el legado
desde el Excel con `migration.loader`. Requiere ejecutar en orden:

```
Sección A  →  python -m migration.loader.run  →  Sección B
```

La Sección B **no** puede aplicarse sobre una base vacía: lee `legacy.*`,
`ind.*`, `kag.*`, etc. Sobre una base recién creada aborta en el primer parche
que consulta datos. Es el mismo comportamiento que en local.

---

## 2. Prerrequisitos

- Proyecto Neon con **PostgreSQL 18** y una base llamada `avisa`
  (creada por `neondb_owner`, que es el dueño por defecto).
- El rol **`neondb_owner`** (miembro de `neon_superuser`).
- **psql / pg_dump / pg_restore de la misma versión mayor** que el servidor.
  `pg_dump` se niega a volcar un servidor más nuevo («server version mismatch»):
  con el contenedor `avisa-db` (16.14) y un servidor 18.7 **no sirve**. Usar un
  contenedor efímero de la misma versión y montar `backups/`:

  ```bash
  docker run --rm -v "$PWD/backups:/backup" \
    -e PGHOST=<endpoint>.<region>.aws.neon.tech -e PGPORT=5432 \
    -e PGDATABASE=avisa -e PGUSER=neondb_owner -e PGPASSWORD=<clave> \
    -e PGSSLMODE=verify-full postgres:18-alpine \
    pg_dump -Fc --no-owner --no-acl -f /backup/avisa_neon.dump
  ```

  `--no-acl` sólo es aceptable para un respaldo de seguridad; para el camino A
  (restaurar conservando los 276 `GRANT`) hay que omitirlo.

- La clave de cifrado `APP_CRYPTO_KEY` (32 bytes en base64), para el parche 9.
- Para el camino B, además: `backups/backend/BASE_CONFLICTOS_SOCIALES_2026.xlsx`
  y las dependencias de Python del loader (`openpyxl`, `asyncpg`).

### Hosts de Neon

| Uso                                      | Host                                                             | Rol            |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------- |
| Migración, `psql`, `pg_restore`, scripts | `<endpoint>.<region>.aws.neon.tech` (**directo**, sin `-pooler`) | `neondb_owner` |
| Aplicación Next.js                       | `<endpoint>-pooler.<region>.aws.neon.tech`                       | `avisa_api`    |

El host directo es obligatorio para el script: usa `set_config(..., false)`
(clave de sesión, ver §3) y meta-órdenes de `psql`. En el pooler de Neon
(_transaction pooling_) la sesión no se conserva entre sentencias.

Cadena de conexión de ejemplo:

```
postgresql://neondb_owner:<clave>@<endpoint>.<region>.aws.neon.tech/avisa?sslmode=verify-full
```

`sslmode=verify-full` evita el aviso de deprecación de `pg`/`pg-connection-string`
y valida el certificado; `require` también funciona pero es más laxo.

---

## 3. Roles: la parte crítica

La aplicación **nunca** debe conectarse con `neondb_owner`. En Neon ese rol (y
todo rol creado desde la consola, la CLI o la API) tiene `rolbypassrls = true`,
es decir, **se salta las 561 políticas RLS**. La app debe usar `avisa_api`:

| Rol            | LOGIN | SUPERUSER | BYPASSRLS | Papel                      |
| -------------- | ----- | --------- | --------- | -------------------------- |
| `neondb_owner` | sí    | no        | **sí**    | administración / migración |
| `avisa_app`    | no    | no        | no        | contenedor de privilegios  |
| `avisa_api`    | sí    | no        | no        | conexión real de la app    |

`BYPASSRLS` no se hereda por pertenencia: `avisa_api` es miembro de
`avisa_app` y aun así no adquiere el atributo. Por eso los dos roles se crean
**por SQL** (con `NOBYPASSRLS` explícito), nunca por consola/CLI/API.

### Camino B (script)

Los roles los crean los parches 14 y 15 (Sección B). No hay que hacer nada
más, salvo **fijar la contraseña** fuera del repositorio:

```sql
ALTER ROLE avisa_api PASSWORD '<clave larga y única>';
```

### Camino A (restore)

`pg_dump` **no** incluye `CREATE ROLE`, pero sí los `GRANT`: si los roles no
existen, cada `GRANT ... TO avisa_app` falla. Por eso hay que crear los roles
**antes** de restaurar, con este bloque (ajustar la contraseña):

```sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_app') THEN
        CREATE ROLE avisa_app NOLOGIN NOSUPERUSER NOBYPASSRLS
                              NOCREATEDB NOCREATEROLE INHERIT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avisa_api') THEN
        CREATE ROLE avisa_api LOGIN NOSUPERUSER NOBYPASSRLS
                              NOCREATEDB NOCREATEROLE INHERIT;
    END IF;
END
$$;

GRANT avisa_app TO avisa_api;

-- Neon: el pooler rechaza el parámetro de arranque `options`.
ALTER ROLE avisa_api SET statement_timeout = '10s';
ALTER ROLE avisa_api SET idle_in_transaction_session_timeout = '15s';

ALTER ROLE avisa_api PASSWORD '<clave larga y única>';
GRANT CONNECT ON DATABASE avisa TO avisa_api;
```

---

## 4. Camino A · Copiar la base actual

### 4.1 Volcado fresco (desde local)

El dump de `backups/` es del 19/11 y no incluye las migraciones `12_*` a `19_*`
aplicadas el 22/11 ni el parche 18. Conviene generar uno nuevo:

```bash
docker exec avisa-db pg_dump -U avisa -d avisa -Fc -f /tmp/avisa_neon.dump
docker cp avisa-db:/tmp/avisa_neon.dump backups/avisa_neon.dump
```

Formato `-Fc` (custom) y **sin** `--no-acl`: los ~276 `GRANT` a `avisa_app`
hay que conservarlos.

### 4.2 Restauración (cliente de la misma versión mayor → Neon)

Se usa un contenedor `postgres:18-alpine` (el `pg_restore` 16.14 de `avisa-db`
no puede restaurar contra un servidor 18). Montar `backups/` en vez de copiar:

```bash
docker run --rm -v "$PWD/backups:/backup" \
  -e PGHOST=<endpoint>.<region>.aws.neon.tech -e PGPORT=5432 \
  -e PGDATABASE=avisa -e PGUSER=neondb_owner -e PGPASSWORD=<clave> \
  -e PGSSLMODE=verify-full postgres:18-alpine \
  pg_restore --no-owner --no-tablespaces --verbose \
  -d avisa /backup/avisa_neon.dump
```

- `--no-owner`: omite los ~507 `OWNER TO avisa` (el rol `avisa` no existe en Neon).
- **No** usar `--no-acl` / `--no-privileges`.
- No usar `--single-transaction`: hay errores esperados (ver 4.3) y conviene
  que el resto se restaure igual.

### 4.3 Errores esperados (y el único arreglo posterior)

Durante el restore fallan, sin abortar el resto, los
`ALTER DEFAULT PRIVILEGES FOR ROLE avisa ...` (17 en el dump del 19/11; un
volcado nuevo puede traer además las 2 de `config`). Error típico:

```
pg_restore: error: could not execute query: ERROR: must be member of role "avisa"
```

Es normal: en Neon el dueño de los objetos es `neondb_owner`. Después del
restore hay que reaplicar los privilegios por defecto para ese rol:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner
    IN SCHEMA core, kag, ind, analisis, territorio, consultation, ref
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner
    IN SCHEMA analytics, avisa
    GRANT SELECT ON TABLES TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner
    IN SCHEMA core, kag, ind, analisis, territorio, consultation
    GRANT USAGE, SELECT ON SEQUENCES TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner
    IN SCHEMA core, kag
    GRANT EXECUTE ON FUNCTIONS TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner
    IN SCHEMA config
    GRANT SELECT ON TABLES TO avisa_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner
    IN SCHEMA config
    GRANT EXECUTE ON FUNCTIONS TO avisa_app;
```

Cualquier **otro** error del restore merece revisión: no conviene ignorarlo.

### 4.4 Funciones `SECURITY DEFINER`

Con `--no-owner`, las 14 funciones `SECURITY DEFINER` quedan propiedad de
`neondb_owner`, que tiene `BYPASSRLS`. Es lo mismo que pasa en local, donde
pertenecen al superusuario `avisa`: funciones como
`core.autenticar_usuario(...)` siguen funcionando con la app porque el dueño
de la función se salta RLS. No hay que «arreglarlo» cambiando el dueño:
rompería el login.

---

## 5. Camino B · Construir desde cero

### 5.1 Sección A

El archivo se divide por el rótulo de la Sección B (así no se depende de
números de línea, que cambian al editar la copia):

```bash
awk '/^--  SECCIÓN B · POST-CARGA/{exit} {print}' \
    docs/neon/AVISA_V10_ESQUEMA_UNIFICADO.sql > /tmp/avisa_A.sql

awk 'f{print} /^--  SECCIÓN B · POST-CARGA/{f=1; print}' \
    docs/neon/AVISA_V10_ESQUEMA_UNIFICADO.sql > /tmp/avisa_B.sql
```

El corte deja en `avisa_A.sql` el divisor `-- ====...` de la cabecera de la
Sección B como última línea, y en `avisa_B.sql` el rótulo completo. Ambas
cosas son inocuas: son comentarios SQL.

La Sección A se ejecuta como `neondb_owner` (tarda; crea 25 esquemas y
~275 tablas):

```bash
psql "postgresql://neondb_owner:<clave>@<endpoint>.<region>.aws.neon.tech/avisa?sslmode=verify-full" \
     -v crypto_key='<clave de 32 bytes>' \
     -f /tmp/avisa_A.sql
```

Los avisos de error del DDL son esperados (se aplica en dos pasadas con
`ON_ERROR_STOP off`); es idéntico a local.

### 5.2 Cargar el legado

El loader lee el workbook y **recrea** el esquema `legacy`:

```bash
DATABASE_URL="postgresql://neondb_owner:<clave>@<endpoint>.<region>.aws.neon.tech/avisa?sslmode=verify-full" \
    python -m migration.loader.run
```

Debe correr como `neondb_owner` (en local corre como el superusuario `avisa`).
La verificación se hace con `python -m migration.loader.run --verify`.

### 5.3 Sección B

```bash
psql "postgresql://neondb_owner:<clave>@<endpoint>.<region>.aws.neon.tech/avisa?sslmode=verify-full" \
     -v crypto_key='<clave de 32 bytes>' \
     -f /tmp/avisa_B.sql
```

La Sección B crea `avisa_app` y `avisa_api`, fija sus atributos, concede
privilegios y aplica los parches 6–24. **Debe correr como `neondb_owner`**:
el parche 9 exige un rol con `BYPASSRLS` (o superusuario) para que el backfill
de datos personales cifrados no afecte 0 filas en silencio, igual que en local
corre como el superusuario `avisa`. Al terminar hay que fijar la contraseña:

```sql
ALTER ROLE avisa_api PASSWORD '<clave larga y única>';
```

---

## 6. Conexión de la aplicación

`APP_DATABASE_URL` debe apuntar al **pooler** y usar `avisa_api`:

```
APP_DATABASE_URL=postgresql://avisa_api:<clave>@<endpoint>-pooler.<region>.aws.neon.tech/avisa?sslmode=verify-full
```

Además hay que **quitar `options`** de `lib/db/pool.ts`: el pooler de Neon
rechaza ese parámetro de arranque
(`unsupported startup parameter in options`). Los timeouts ya quedaron fijados
en el rol `avisa_api` (§3). Cambio pendiente en `lib/db/pool.ts`:

```diff
     globalPool.__avisaPool = new Pool({
       connectionString: resolveConnectionString(),
-      max: Number(process.env.APP_DB_POOL_MAX ?? 8),
-      idleTimeoutMillis: 30_000,
-      connectionTimeoutMillis: 5_000,
+      max: Number(process.env.APP_DB_POOL_MAX ?? 3),
+      idleTimeoutMillis: 30_000,
+      connectionTimeoutMillis: 10_000,
       application_name: "avisa-next",
-      // Ninguna consulta de la interfaz puede quedarse colgada sin límite.
-      options:
-        "-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000",
     });
```

(`max: 3` es una recomendación conservadora para el plan gratuito de Neon;
`lib/db/tenant.ts` ya usa `set_config(..., true)` dentro de
`BEGIN/COMMIT`, así que es seguro con _transaction pooling_.)

---

## 7. Verificación

Consultas de comprobación, ejecutadas como `neondb_owner` (host directo):

```sql
-- Extensiones instaladas
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- Atributos de rol (avisa_api NUNCA debe tener bypassrls)
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
  FROM pg_roles WHERE rolname IN ('neondb_owner','avisa_app','avisa_api');

-- Políticas y RLS forzada (local: 561 políticas, 91 tablas con FORCE)
SELECT count(*) AS politicas FROM pg_policies;
SELECT count(*) AS force_rls FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relrowsecurity AND c.relforcerowsecurity
   AND n.nspname NOT IN ('pg_catalog','information_schema');

-- Conteos de negocio (referencia local del 22/11)
SELECT (SELECT count(*) FROM core.casos)              AS casos,        -- 35
       (SELECT count(*) FROM core.alertas_tempranas)  AS alertas,      -- 83
       (SELECT count(*) FROM core.usuarios)           AS usuarios,     -- 33
       (SELECT count(*) FROM core.documentos)         AS documentos;   -- 153
```

Prueba de RLS y de login, **conectado como `avisa_api`** al pooler:

```sql
-- Sin app.rol_codigo, RLS debe dejar la tabla en cero filas.
SELECT count(*) FROM core.casos;   -- esperado: 0

-- La función SECURITY DEFINER sigue autenticando.
SELECT * FROM core.autenticar_usuario('11111111', 'demo');
-- esperado: 11111111 | administrador
```

Si `core.casos` devuelve 35 en vez de 0, la app está conectada con un rol con
`BYPASSRLS` (probablemente `neondb_owner`).

### 7.1 Migraciones 32–36 aplicadas en Neon (2026-11-22)

El esquema de Neon quedó por detrás del local: las migraciones `32` a `36` se
ejecutaron primero contra `avisa-db` y después contra Neon, con `neondb_owner`. El
DDL de 32–35 exigió el **host directo** (el pooler no conserva la sesión entre
sentencias); la `36`, que solo actualiza datos dentro de una transacción, se aplicó
por la cadena del `.env`. Cada archivo se aplicó en su propia transacción, cortado
antes de sus comprobaciones finales.

| Archivo                               | Efecto en Neon                                              |
| ------------------------------------- | ----------------------------------------------------------- |
| `32_anexo15_left_join.sql`            | `CREATE` + `ALTER`: ocho `LEFT JOIN`, `security_invoker`    |
| `33_estado_abierto_unico.sql`         | 35 casos a `Abierto`, estado 2 retirado del catálogo        |
| `34_historial_tramo_unico.sql`        | 35 tramos sintéticos eliminados, 35 tramos reabiertos       |
| `35_fecha_inicio_real.sql`            | Sin cambios (`0` filas): la fecha del legado ya era la real |
| `36_historial_desde_fecha_inicio.sql` | `UPDATE 32`: el tramo abierto toma la fecha real del caso   |

Estado del historial tras la 36: **35 tramos, 35 abiertos, 32 alineados con
`fecha_inicio` y 3 en la fecha de carga** (los casos que no tienen fecha de
inicio: `desde` no admite nulos y no se inventa un valor). Ningún tramo cerrado
queda con `hasta < desde`.

Dos avisos al replicar:

- **No ejecutar el archivo 32 completo.** Su último bloque hace `set role
avisa_app`, que en Neon no aplica; hay que cortar en `-- 1 · Comprobación` y
  ejecutar solo la parte de datos.
- **Las verificaciones por identidad no son intercambiables.** Como
  `neondb_owner` la vista devuelve 35 filas; como `avisa_api` con
  `set_config('app.rol_codigo', ...)` devuelve 34; sin variables de sesión, 0.

`migration/` contiene dos archivos numerados `32`, y **ambos están aplicados**:
`32_anexo15_left_join.sql` (la vista del Anexo 15) y
`32_exigir_anulacion_puede_eliminar.sql` (la guarda `core.exigir_anulacion`). En
Neon lo confirma `pg_proc`: la función llama a `core.puede_eliminar()`. Es una
colisión de numeración heredada, no un pendiente de ejecución.

---

## 8. Diferencias de esta copia respecto del original

Todas están marcadas en el SQL con `NEON:`:

1. `ALTER DEFAULT PRIVILEGES FOR ROLE avisa` → `FOR ROLE neondb_owner`
   (6 sentencias: parche 15 y parche 18). Si se usa otro rol administrador,
   hay que cambiar ese nombre.
2. Tras `GRANT avisa_app TO avisa_api;` se añaden los `ALTER ROLE ... SET`
   de timeouts, el `GRANT CONNECT` (con `current_database()`) y el recordatorio
   comentado de `ALTER ROLE ... PASSWORD`.
3. Junto a `set_config('app.crypto_key', ..., false)` se advierte que el
   archivo exige conexión directa (sin `-pooler`).
4. En el rótulo de la Sección B se advierte que debe ejecutarse con un rol con
   `BYPASSRLS` (`neondb_owner`), por el backfill del parche 9.

No se tocó nada más: mismo orden, mismos `\echo`, mismos `\set`/`\if`, mismas
secciones A y B.

---

## 9. Problemas conocidos

| Síntoma                                                    | Causa                                         | Arreglo                                              |
| ---------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| `unsupported startup parameter in options`                 | `lib/db/pool.ts` manda `options` al pooler    | Quitar `options`; usar los `ALTER ROLE ... SET` (§6) |
| La app ve todas las filas                                  | conectada como `neondb_owner`                 | usar `avisa_api` y verificar `rolbypassrls = false`  |
| `must be member of role "avisa"` en el restore             | 17 `ALTER DEFAULT PRIVILEGES FOR ROLE avisa`  | reaplicar para `neondb_owner` (§4.3)                 |
| `permission denied for schema public` al crear extensiones | rol sin privilegios de administrador          | ejecutar como `neondb_owner`                         |
| El script falla en la Sección B                            | base sin legado cargado                       | ejecutar el loader entre A y B (§5.2)                |
| `\restrict` desconocido al usar `psql -f plain.sql`        | volcado en texto plano con cliente psql viejo | restaurar con `pg_restore` o actualizar psql         |

---

## 10. Estado aplicado en Neon (2026-11-23)

Base `avisa`, servidor **18.7**, host directo, rol `neondb_owner`. Se aplicaron,
en este orden: `migration/39_gis_infraestructuras.sql`,
`gis/derived/0001_distritos_inei_2025.sql`,
`migration/loader/cargar_gis.py`,
`gis/derived/0004_revincular_infraestructuras_por_nombre.sql`,
`gis/derived/0002_territorio_lugares_matarani.sql`,
`gis/derived/0003_casos_tematica_anulable.sql`,
`migration/40_casos_naturaleza.sql` y los `GRANT` del esquema `gis`.

| Comprobación                                 |                                                          Valor esperado |
| -------------------------------------------- | ----------------------------------------------------------------------: |
| `core.distritos` / `provincias` / `regiones` |                                                        1 891 / 196 / 25 |
| `gis.infraestructuras_puntos`                |                                                                  13 456 |
| filas con `distrito_id`                      |          13 454 (2 sin distrito por diseño: Matarani y Mazamari-Pangoa) |
| `core.migracion_log`                         | `distritos_inei_2025`, `casos_tematica_anulable`, `40_casos_naturaleza` |
| `core.casos` con naturaleza declarada        |                            7 «Nacional o sectorial» + 27 «Sin declarar» |
| `territorio.lugares`                         |                                           1 (Matarani, puerto de Islay) |

Verificación rápida (como `neondb_owner`, host directo):

```sql
select (select count(*) from core.distritos) as distritos,
       (select count(*) from core.provincias) as provincias,
       (select count(*) from gis.infraestructuras_puntos) as gis,
       (select count(*) from gis.infraestructuras_puntos where distrito_id is not null) as gis_con_distrito;
```

**Cuidado con el RLS al verificar.** `avisa_api` no tiene `BYPASSRLS`: sin
`set_config('app.rol_codigo', …)` las tablas con `FORCE ROW LEVEL SECURITY`
devuelven **0 filas en silencio** (no es un error de permisos). Con
`app.rol_codigo = 'administrador'` y `app.ver_anulados = 'off'` se ven 34 casos,
76 alertas y 306 demandas; con la papelera abierta, 35 / 83 / 325.

Respaldos: `backups/avisa_neon_20261123.dump` (volcado completo previo, 3,2 MB)
y las tablas `core.distritos_backup_20261123`, `core.provincias_backup_20261123`,
`core.casos_tematica_backup_20261123` y `core.casos_naturaleza_backup_20261123`.

**Identidad entre entornos:** `id` no es estable entre local y Neon; el
invariante es `ubigeo`. Ver `gis/derived/README.md` y
`gis/derived/mapa_ids_distritos_local_vs_neon.csv`.
