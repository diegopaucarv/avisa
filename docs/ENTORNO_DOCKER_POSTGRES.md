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

El `initdb` se detiene en el parche 5. Los parches 6–16 **no** se aplican aquí:
necesitan el legado ya cargado y se ejecutan a mano (§9). El 17 tampoco: no se
monta siquiera y se pasa a mano.

El DDL y los parches **no se copian**: se montan como bind mounts con nombres
limpios (`/opt/avisa/sql/90_ddl_v9.sql`, `91_patch_01.sql` … `106_patch_16.sql`).
El DDL sale de `backups/backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql` —la copia
del repositorio, no `backend/`, que es otra carpeta— y los parches, de `docs/`.
Así no existen dos versiones del esquema que puedan divergir. Son **16 montajes
de parche**: los 5 `PREPARACION_*` (que sí ejecuta el `initdb`) y los 11
`PARCHE_6`…`PARCHE_16` (que no).

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

**45 de las 102 tablas de `core` tienen RLS** y **57 no**; en todo el modelo son
**520 políticas sobre 82 tablas** (303 de ellas en `core`). Medición del
2026-11-20; antes del parche 16 eran 11. Donde la política rige con
`FORCE ROW LEVEL SECURITY`, **el dueño de la tabla tampoco lee ni escribe** si la
sesión no declara el contexto. Sin esto, un `INSERT` falla con la política
`p_insert` y un `SELECT` devuelve 0 filas.

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

| control                         | esperado                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| extensiones                     | `btree_gist, pg_trgm, pgcrypto, plpgsql, postgis, vector`                                                                  |
| esquemas                        | 27 tras la carga (26 antes: sin `legacy`)                                                                                  |
| tablas                          | 374 tras la carga: 287 físicas del modelo (263 lógicas + 24 particiones) + 87 de `legacy`. Antes de la v10: 359 (272 + 87) |
| columnas `geography`            | 3                                                                                                                          |
| tablas territorio con geometría | 3 de 3                                                                                                                     |
| `cat_tematicas`                 | 7                                                                                                                          |
| `cat_subsectores`               | 3                                                                                                                          |
| `cat_tipos_actor`               | 7                                                                                                                          |
| `cat_roles_funcionales`         | 4                                                                                                                          |
| `cat_tipos_organizacion`        | 7                                                                                                                          |
| `cat_especies` (mínimo)         | 5 en `initdb`, 39 tras la carga                                                                                            |
| `cat_unidades_organicas`        | 1 en `initdb` (unidad `OAIPCS`), 66 tras la carga                                                                          |
| `cat_pip_etapas`                | 12                                                                                                                         |
| `config.schema_registry`        | 2 (`avisa.raw_ingest` v1 y v2)                                                                                             |
| `agent.cat_detalle_schema`      | 1 (v1 provisional)                                                                                                         |
| `ind.plantilla`                 | 3 (Anexo 2, Anexo 15, Minister View)                                                                                       |
| `ind.indicador` (pendiente)     | 0 (falta el catálogo de la Tabla 3)                                                                                        |
| RLS forzadas en `core`          | 45 de 102 (medición 2026-11-20; antes 11)                                                                                  |

La verificación es un `DO` con `RAISE EXCEPTION` si algo no cuadra: si el
esquema queda a medias, el contenedor **no** arranca. Preferimos un fallo ruidoso
a un entorno que parece sano y no lo está.

Las cifras de la tabla son el mínimo que exige `20_verify.sql`. Tras los parches
6–10 el modelo tiene 279 tablas físicas (24 particiones, 255 lógicas), 26 esquemas
propios y 48 tablas con RLS `FORCE` en todo el modelo —la fila de `core` cuenta solo
las 11 de ese esquema, y la particionada `agent.llm_call` cuenta como una—; la
medición completa del 2026-11-18 está en `docs/INDICE.md` §3.

Esa frase es la foto del 2026-11-18 y se conserva tal cual. **Remedición del
2026-11-20 sobre `avisa-db`, ya con los parches 16 y 17:** **263 tablas lógicas**
(34 / 12 / 75 / 22 / 120 por capa), **287 físicas** (263 + 24 particiones),
**34 vistas y materializadas** (241 columnas) y **2 126 columnas lógicas**, de las
cuales **2 107 tienen comentario** y **19 no**. El modelo tiene además 9 roles en
`core.roles`, 32 usuarios (28 activos) y el esquema `legacy` con **87 objetos**.

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

## 9. Aplicación de los parches 6–17 (post-carga)

El `initdb` aplica el DDL y los parches 1–5, y se detiene ahí. Los parches 6–17 no
pueden correr en ese momento: el 6 reclasifica documentos `RED-%` que todavía no
existen; el 9 y el 10 leen `legacy.dim_actores`, `legacy.dim_paso_proceso` y
`legacy.fact_proceso_*`; y el 11 rellena el grafo con las filas ya cargadas. En un
arranque limpio afectarían **0 filas sin dar error**. Por eso:

- solo se aplican **después** de cargar el legado, en orden 6 → 7 → 8 → 9 → 10 →
  11 → 12 → 13 → 14 → 15 → 16 → 17;
- el 12 comenta tablas y columnas y comenta también las columnas que añade el 11,
  así que va justo antes del 13;
- el 13 cambia el tipo de `consultation.procesos.nivel_clasificacion` y alinea el
  nombre `Público` del catálogo; no añade ni quita columnas, y repetirlo no tiene
  efecto;
- el 14 cierra brechas del ERS (rol de aplicación, alerta dentro del motor de
  proceso, niveles de identificación, enlace territorial y catálogo de bases
  legales); crea `avisa_app`, que el 15 necesita;
- el 15 hace que el nivel y las capacidades salgan de `core.roles` y no de un
  parámetro que declare el cliente;
- el 16 completa la seguridad por fila de `core` y registra el banco de datos
  personales (DC-04). Depende del 15: usa `core.clasificacion_max()` y
  `core.puede_crear()`, `core.puede_editar()`, `core.puede_eliminar()`;
- el 17 crea la consulta PIDE-RENIEC cifrada e inmutable, el privilegio nominal
  y las columnas de costo de Gemini y WhatsApp. Depende del 15 y del 16: usa las
  funciones de nivel y reutiliza el par de cifrado del 9;
- los **once** SQL del 6 al 16 están montados de solo lectura en
  `/opt/avisa/sql/96..106` (`96_patch_06.sql` … `106_patch_16.sql`), pero ningún
  script del `initdb` los invoca. El **17 no está montado** (`docs/PARCHE_17_RENIEC_Y_COSTOS.sql`
  sigue sólo en el disco): tanto el 17 como cualquiera de los once se pasan por
  entrada estándar, como se explica abajo;
- ni `./scripts/db.sh apply` ni `fresh` los tocan: esos comandos re-aplican el DDL
  y los parches 1–5 (§7).

### Comando

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f - < docs/PARCHE_7_GUARDRAILS_G19_G25.sql
```

Se cambia el nombre del archivo por el del parche que toca. El archivo se pasa por
**entrada estándar** (`-f -`): no se copia al contenedor ni se usa `-f /tmp/...`,
porque MSYS reescribe las rutas que empiezan por `/` y `psql` termina buscando
`C:/Program Files/Git/tmp/...`. `MSYS_NO_PATHCONV=1` evita esa conversión; es lo
mismo que hace `scripts/db.sh` (§8).

### El parche 9 necesita `APP_CRYPTO_KEY`

La clave vive en `.env` como `APP_CRYPTO_KEY` y se pasa a `psql` como variable:

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -v crypto_key="$APP_CRYPTO_KEY" -f - \
  < docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql
```

Sin `-v crypto_key`, el script aborta con salida 3. Todo corre en una sola
transacción: un fallo de verificación no deja purga, ni copia, ni columnas a medio
cifrar. La tabla de destino tiene RLS `FORCE`, así que hay que ejecutarlo con un
rol con `BYPASSRLS` (aquí `avisa`) o afectará 0 filas en silencio.

**La clave no tiene `clave_version`.** Se cifró con una sola versión de clave, de
modo que **rotarla obliga a re-cifrar todo**; no hay convivencia entre clave vieja
y nueva. Esa rotación y la custodia de la clave siguen abiertas (`docs/INDICE.md`
§5).

---

## 10. Archivos

```
compose.yaml                        servicio db (puerto, volúmenes, healthcheck)
.env.example / .env                 credenciales (.env no se versiona)
docker/postgres/Dockerfile          pgvector:pg16 + postgis
docker/postgres/initdb/
    00_extensions.sql               extensiones
    10_apply_v9.sql                 DDL x2 + parches 1-5
    20_verify.sql                   verificación con aborto
scripts/db.sh                       operación
backups/backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql
                                   DDL v9 (montado como /opt/avisa/sql/90_ddl_v9.sql)
docs/PREPARACION_V9_CARGA_LEGADO_5.sql   parche 5 (seeds de cierre)
docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql    parche 6 (post-carga, §9)
docs/PARCHE_7_GUARDRAILS_G19_G25.sql     parche 7 (post-carga, §9)
docs/PARCHE_8_ICD_TOPE_Q40.sql           parche 8 (post-carga, §9)
docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql   parche 9 (post-carga, §9)
docs/PARCHE_10_FLUJO_PROCESO_D17.sql     parche 10 (post-carga, §9)
docs/PARCHE_11_GRAFO_KAG.sql             parche 11 (post-carga, §9)
docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql  parche 12 (post-carga, §9)
docs/PARCHE_13_CLASIFICACION.sql         parche 13 (post-carga, §9)
docs/PARCHE_14_CIERRE_ERS.sql            parche 14 (post-carga, §9)
docs/PARCHE_15_ROLES_Y_BORRADO.sql       parche 15 (post-carga, §9)
docs/PARCHE_16_RLS_CORE_Y_DC04.sql       parche 16 (post-carga, §9)
docs/PARCHE_17_RENIEC_Y_COSTOS.sql       parche 17 (post-carga; **no** montado, se pasa a mano)
```

---

## 11. La interfaz y la API en el mismo entorno

El compose tiene tres servicios: `db`, `api` y `ui`. Los dos últimos existen
para poder ver la interfaz sin instalar Node ni Python en la máquina.

### Arranque

```bash
docker compose up -d api ui
```

Y se abre **http://localhost:3000**. El servicio de acceso ya está contestando:
usuario `12345678`, clave `demo`.

| Servicio | Contenedor  | Puerto del host | Qué es                        |
| -------- | ----------- | --------------- | ----------------------------- |
| `db`     | `avisa-db`  | 55433           | PostgreSQL 16                 |
| `api`    | `avisa-api` | 8000            | FastAPI de demostración       |
| `ui`     | `avisa-ui`  | 3000            | Next.js 16 en modo desarrollo |

La interfaz no llama a la API desde el navegador: pide a sus propias rutas
`/api/...` y Next reenvía a `http://api:8000` por la red interna del compose.
Por eso no importa que el puerto 8000 no esté expuesto al exterior; se
expone igual para poder probar la API con `curl`.

### Cómo entra el código en la interfaz

El código se monta desde el disco (`.:/app`) y las dependencias viven en el
volumen `avisa_node_modules`, que Docker rellena la primera vez con lo que ya
viene instalado en la imagen. Por eso:

- **Editar** un archivo de `app/`, `components/` o `frontend/` se refleja solo,
  sin reconstruir ni reiniciar.
- **Cambiar `package.json`** sí exige `docker compose build ui`; y si el
  volumen ya existía hay que vaciarlo para que se vuelva a rellenar:
  `docker volume rm avisa_node_modules`. Esto borra el volumen: hacerlo con
  el contenedor de la interfaz parado.
- La primera construcción tarda unos 3–4 minutos (descarga e instalación de
  dependencias). Los arranques siguientes tardan segundos.

### Comprobaciones

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" -d '{"dni":"12345678","password":"demo"}'
```

Las dos deben devolver `200`. La segunda prueba el camino completo navegador →
Next → FastAPI.

### Lo que este entorno no hace

- La API sigue sirviendo **datos de ejemplo**: no lee la base. El login y el
  tablero funcionan aunque `db` esté vacía.
- La interfaz corre en modo desarrollo, no compilada. Para una entrega hay que
  construirla aparte (`pnpm build` y `pnpm start`).
- `.next` se guarda en un volumen porque el montaje de Windows es lento; Next
  avisa de ello en el registro (`Slow filesystem detected`). Es una advertencia,
  no un fallo.

### Archivos que añade esta parte

```
docker/api/Dockerfile               API FastAPI (contexto: raíz del repo)
docker/ui/Dockerfile                interfaz Next.js 16 (contexto: raíz del repo)
.dockerignore                       deja fuera node_modules, .next, docs y migration
```
