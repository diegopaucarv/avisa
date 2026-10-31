# Entorno Docker + PostgreSQL 16 (pgvector + PostGIS)

Este documento describe el entorno de base de datos donde se carga el legado
AVISA y sobre el que correrá la aplicación. Es el paso 1 de
`docs/DECISIONES_CARGA_LEGADO_V9.md` §11.

---

## 1. Por qué existe este entorno

El entorno de pruebas (`avisa-v9-test`, sólo `pgvector`) **no es una v9
completa**: la DDL exige `postgis` para tres tablas de `territorio` y, como se
aplicó tolerando errores, esas tablas nunca se crearon. Comparación medida:

|                                             | `avisa-v9-test` (sólo pgvector) |                                           `avisa-db` (este entorno) |
| ------------------------------------------- | ------------------------------: | ------------------------------------------------------------------: |
| extensiones                                 |             `plpgsql`, `vector` | `plpgsql`, `vector`, `postgis`, `btree_gist`, `pgcrypto`, `pg_trgm` |
| columnas `geography`                        |                               0 |                                                                   3 |
| tablas                                      |                             265 |                                                                 272 |
| `territorio.parque_industrial`              |                               ✗ |                                                                   ✓ |
| `territorio.cuadricula_sismica`             |                               ✗ |                                                                   ✓ |
| `territorio.zona_pesca`                     |                               ✗ |                                                                   ✓ |
| `core.outbox_integracion` y sus 2 catálogos |                               ✗ |                                                                   ✓ |

No se perdió ninguna tabla respecto del entorno de pruebas: las 7 que faltaban
son exactamente las que dependían de las extensiones ausentes.

`avisa-v9-test` **se conserva** tal cual; este entorno es el definitivo.

---

## 2. Requisitos

- Docker Engine o Docker Desktop con Compose v2 (`docker compose version`).
- ~1 GB de disco para la imagen y el volumen.
- Acceso a `apt.postgresql.org` la **primera** vez que se construye la imagen
  (se instala PostGIS desde el repositorio PGDG que ya trae la imagen base).

---

## 3. Arranque

```bash
cp .env.example .env       # y cambiar POSTGRES_PASSWORD
./scripts/db.sh up         # build + arranque + espera healthy
```

Al terminar:

```
AVISA listo en localhost:55433
  base: avisa   rol: avisa
```

La primera vez tarda **2–3 minutos**: el `initdb` aplica el DDL completo dos
veces y después los parches 1 → 2 → 3 → 4 → 5. Los arranques posteriores son inmediatos
(con el volumen ya poblado, el `initdb` no se repite).

---

## 4. Qué hace la inicialización

Los scripts de `docker/postgres/initdb/` se ejecutan **sólo** cuando el volumen
está vacío, en este orden:

| Script              | Qué hace                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `00_extensions.sql` | crea `vector`, `postgis`, `btree_gist`, `pgcrypto`, `pg_trgm`          |
| `10_apply_v9.sql`   | DDL v9 **dos pasadas**, luego parches 1 → 2 → 3 → 4 → 5                |
| `20_verify.sql`     | informa y **aborta la inicialización** si el esquema no quedó completo |

El DDL y los parches **no se copian**: se montan como bind mounts desde
`backend/` y `docs/` con nombres limpios (`/opt/avisa/sql/90_ddl_v9.sql`, etc.).
Así no existen dos versiones del esquema que puedan divergir.

### Por qué dos pasadas

La DDL v9 no es ejecutable en una sola pasada: `core.cambio_normativo` declara
una FK a `core.usuarios` antes de que esa tabla exista. La pasada 1 crea todo lo
posible y la pasada 2 resuelve lo que dependía de objetos posteriores.

### Por qué hay errores en el log y no hay que alarmarse

`docker compose logs db` muestra ~1.100 líneas `ERROR`. Todas son
`already exists` y `duplicate key` producidas por la **segunda** pasada del DDL
(que vuelve a crear objetos que la primera ya creó), más 8 errores de la FK
adelantada. Es el comportamiento esperado de aplicar la DDL dos veces.

Lo que **sí** es un fallo y no aparece en un arranque sano:

- `ERROR: type "geography" does not exist` → falta PostGIS;
- que `20_verify.sql` lance una `EXCEPTION` (el contenedor no arranca).

---

## 5. Conexión

| Dato          | Valor por defecto                  |
| ------------- | ---------------------------------- |
| host / puerto | `localhost:55433`                  |
| base          | `avisa`                            |
| rol           | `avisa`                            |
| contraseña    | la de `.env` (`POSTGRES_PASSWORD`) |
| DSN           | `./scripts/db.sh uri`              |

`55433` y no `5432` porque `5432` puede estar ocupado por un PostgreSQL local y
`55432` ya lo usa `avisa-v9-test`.

### Receta de sesión obligatoria

Once tablas de `core` tienen `FORCE ROW LEVEL SECURITY`: **el dueño de la tabla
tampoco lee ni escribe** si la sesión no declara el contexto. Sin esto, un
`INSERT` falla con la política `p_insert` y un `SELECT` devuelve 0 filas.

```python
async with conn.transaction():
    await conn.execute("select set_config('app.clasificacion_max', '3', true)")
    await conn.execute("select set_config('app.user_id', $1, true)", user_uuid)
    # ... trabajo ...
```

`set_config(..., true)` es el equivalente a `SET LOCAL`: dura la transacción.

Comprobado con `asyncpg 0.32` contra este contenedor: `app.clasificacion_max`
se lee correctamente dentro de la transacción y las tablas con RLS responden.

---

## 6. Verificación

```bash
./scripts/db.sh verify
```

Debe terminar con:

```
NOTICE:  verificación OK: PostGIS + pgvector, 3 tablas de territorio, parches 1-5 y catálogos sembrados
```

y mostrar esta tabla. Ojo: este script se ejecuta **dos veces** en la vida del
entorno — al final del `initdb`, con el esquema vacío, y luego vía
`./scripts/db.sh verify`, con el legado ya cargado. Por eso cada fila indica el
valor en ambos estados (los catálogos **crecen** con la carga, nunca se
reducen; por eso las comprobaciones son contra mínimos, no contra igualdad
exacta):

| control                         | esperado                                                  |
| ------------------------------- | --------------------------------------------------------- |
| extensiones                     | `btree_gist, pg_trgm, pgcrypto, plpgsql, postgis, vector` |
| esquemas                        | 27 tras la carga (26 antes: sin `legacy`)                 |
| tablas                          | 359 tras la carga (272 del modelo + 87 de `legacy`)       |
| columnas `geography`            | 3                                                         |
| tablas territorio con geometría | 3 de 3                                                    |
| `cat_tematicas`                 | 7                                                         |
| `cat_subsectores`               | 3                                                         |
| `cat_tipos_actor`               | 7                                                         |
| `cat_roles_funcionales`         | 4                                                         |
| `cat_tipos_organizacion`        | 7                                                         |
| `cat_especies` (mínimo)         | 5 en `initdb`, 39 tras la carga                           |
| `cat_unidades_organicas`        | 1 en `initdb` (unidad `OAIPCS`), 66 tras la carga         |
| `cat_pip_etapas`                | 12                                                        |
| `config.schema_registry`        | 2 (`avisa.raw_ingest` v1 y v2)                            |
| `agent.cat_detalle_schema`      | 1 (v1 provisional)                                        |
| `ind.plantilla`                 | 3 (Anexo 2, Anexo 15, Minister View)                      |
| `ind.indicador` (pendiente)     | 0 (falta el catálogo de la Tabla 3)                       |
| RLS forzadas en `core`          | 11                                                        |

La verificación es un `DO` con `RAISE EXCEPTION` si algo no cuadra: si el
esquema queda a medias, el contenedor **no** arranca. Preferimos un fallo ruidoso
a un entorno que parece sano y no lo está.

---

## 7. Operación

```bash
./scripts/db.sh status   # estado y salud
./scripts/db.sh psql     # consola interactiva
./scripts/db.sh logs     # log del initdb
./scripts/db.sh apply    # re-aplica DDL + parches sobre la base existente
./scripts/db.sh down     # detiene y elimina el contenedor (conserva datos)
./scripts/db.sh reset    # elimina el volumen y reconstruye todo
./scripts/db.sh snapshot # congela el esquema actual como avisa_template
./scripts/db.sh fresh    # recrea la base desde avisa_template + parches 1-5
```

`snapshot` se niega a congelar la plantilla si la base ya tiene el schema
`legacy` (legado cargado): la plantilla es el esquema **vacío**, y una plantilla
con datos rompería la reproducibilidad de la carga. `fresh` re-aplica los
parches 1-5 después del clonado (son idempotentes), así que una plantilla
anterior al último parche no deja la base desactualizada.

`apply` es idempotente: los parches 1–5 lo son por diseño, y el DDL se vuelve a
aplicar tolerando errores.

---

## 8. Problemas conocidos

**El contenedor se declara `healthy` mientras todavía aplica el esquema.**
Ocurrió durante la puesta en marcha y ya está corregido. `pg_isready` sin host
usa el socket Unix, y el servidor temporal del `initdb` también escucha por ese
socket. El healthcheck ahora sondea `-h 127.0.0.1`: el servidor temporal arranca
con `listen_addresses` vacío, así que el TCP sólo responde cuando el esquema ya
está aplicado.

**`psql: error: C:/Program Files/Git/...: No such file or directory`.**
Git Bash convierte los argumentos que empiezan por `/`. `scripts/db.sh` exporta
`MSYS_NO_PATHCONV=1`; si se invoca `docker exec` a mano, hay que hacer lo mismo.

**Cambiar `POSTGRES_PASSWORD` después del primer arranque no cambia nada**: la
contraseña se fija en el `initdb`. Hay que hacer `./scripts/db.sh reset`.

**PostGIS es 3.7.x**, no 3.4 como en el sandbox donde se probó el DDL. Es
compatible con `GEOGRAPHY(POLYGON)`; la verificación lo comprueba en cada
arranque.

---

## 9. Archivos

```
compose.yaml                        servicio db (puerto, volúmenes, healthcheck)
.env.example / .env                 credenciales (.env no se versiona)
docker/postgres/Dockerfile          pgvector:pg16 + postgis
docker/postgres/initdb/
    00_extensions.sql               extensiones
    10_apply_v9.sql                 DDL x2 + parches 1-5
    20_verify.sql                   verificación con aborto
scripts/db.sh                       operación
docs/PREPARACION_V9_CARGA_LEGADO_5.sql   parche 5 (seeds de cierre)
```
