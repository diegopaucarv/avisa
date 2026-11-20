# De cero a la base del MVP, y de ahí a SQL Server

Este documento explica, paso a paso, **cómo se crea la base de datos del MVP** y
**cómo se cargan los datos del sistema anterior**. Está escrito para que lo pueda
seguir alguien que no programó este sistema: cada paso dice qué hace, qué se
espera ver y qué hacer si algo falla.

Al final hay una tabla con todos los comandos juntos, una lista de errores
conocidos con su causa, y las referencias a los documentos que entran en detalle.

---

## 1. Para qué sirve

Hay dos trabajos distintos y conviene no mezclarlos:

1. **Construir la base vacía** del modelo nuevo (v10). Eso lo hace el propio
   contenedor al arrancar por primera vez.
2. **Traer los datos del sistema anterior** (Google Sheets) a esa base. Eso lo
   hace un programa de carga y, después, una tanda de parches.

Este documento cubre los dos, más un tercero: dejar una copia recortada de la
base para que el equipo de OGTI la migre a SQL Server.

---

## 2. Las tres bases

En el mismo servidor de PostgreSQL conviven tres bases con propósitos distintos.
Confundirlas es el error más caro de esta etapa.

| Base             | Para qué                                                                                                 | Se puede destruir |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ----------------- |
| `avisa`          | La base de trabajo: todo el esquema más los datos del sistema anterior. Es la que se consulta y se mide. | No sin copia      |
| `avisa_template` | Plantilla con el esquema **vacío**. Sirve para crear una base nueva idéntica en segundos.                | Se regenera       |
| `avisa_mssql`    | Copia **recortada** de `avisa`, con solo las tablas del MVP, preparada para el asistente de SQL Server.  | Sí, siempre       |

La base recortada no se toca a mano: se crea como copia y se recorta con un
script, para poder repetirlo cuantas veces haga falta.

---

## 3. Antes de empezar

Necesitas:

- Docker Desktop encendido.
- Python 3.11 o superior, con las dependencias del proyecto instaladas.
- Un archivo `.env` en la raíz del repositorio. Si no existe:

```sh
cp .env.example .env
```

Dentro de `.env` hay dos cosas que **no** se versionan y no deben salir del
repositorio:

- `POSTGRES_PASSWORD`: la contraseña de la base local.
- `APP_CRYPTO_KEY`: la clave con la que se cifran los datos personales. Si se
  pierde, los nombres y documentos ya cifrados no se pueden leer.

Comprueba que Docker responde:

```sh
docker compose ps
```

Si no aparece `avisa-db` o aparece detenido, levántalo:

```sh
docker compose up -d db
```

El puerto local es **55433** (no 5432), para no chocar con otras instalaciones.

---

## 4. Parte A — Crear la base del MVP

### 4.1 El camino normal

La primera vez que arranca el contenedor, la base se construye sola. El
contenedor ejecuta, en orden: las extensiones, el esquema completo **dos veces**
y la verificación.

```sh
docker compose up -d db
./scripts/db.sh status
```

`status` debe decir `healthy`. Después, la verificación del esquema:

```sh
./scripts/db.sh verify
```

Esto comprueba que las tablas, las claves y las políticas de seguridad están
donde deben. Si algo falta, el comando falla y dice qué.

**Por qué el esquema se aplica dos veces.** El esquema original declara una
relación con una tabla que todavía no existe (se crea más abajo) y una semilla
que apunta a un catálogo que aún está vacío. La primera pasada crea casi todo y
deja esos dos errores; la segunda los resuelve. Los mensajes de error de la
primera pasada son esperados y no indican un problema.

### 4.2 El camino manual (otra máquina, otro servidor)

Si necesitas construir la base sin el contenedor —por ejemplo en un servidor de
pruebas— usa el archivo unificado. Está en dos secciones a propósito:

```sh
# 1. Generar solo la sección A (esquema base) en un archivo aparte
python migration/consolidar_esquema.py --seccion A --salida /tmp/seccion_a.sql

# 2. Aplicarla sobre una base vacía
psql -U avisa -d avisa -v ON_ERROR_STOP=1 -f /tmp/seccion_a.sql
```

Al terminar tendrás **25 esquemas y 275 tablas** (251 tablas lógicas y 24
hijas de partición), 2 314 columnas y 581 claves ajenas. La sección A crea
también el esquema `staging`, con 2 tablas, que ya está incluido en esas cifras.

> En ese momento verás **avisos de error** porque cinco scripts de preparación
> mencionan tablas que todavía no existen (`core.usuarios`,
> `core.cambio_normativo`). Es normal: esas tablas aparecen al cargar los datos.
> No impiden el conteo y no hay que «arreglarlos».

**No apliques la sección B aquí.** Exige los datos ya cargados; si la corres
sobre una base vacía, el primer parche que consulta datos falla.

---

## 5. Parte B — Cargar los datos del sistema anterior

### 5.1 Dónde están los datos de origen

El programa de carga lee el libro de cálculo del sistema anterior:

```
backups/backend/BASE_CONFLICTOS_SOCIALES_2026.xlsx
```

Si el archivo está en otra ruta, se indica con `--xlsx`. El programa también
encuentra la base de datos sola: lee `DATABASE_URL` del `.env`, o compone la
cadena con `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_PORT`.

### 5.2 La carga

```sh
python -m migration.loader.run
```

Todo corre en **una sola transacción**: si una fase falla, la base queda
exactamente como estaba. Con unas 4 600 filas de origen el costo es mínimo y la
garantía —nunca una carga a medias— vale más.

Las fases, en orden:

| Fase | Qué carga                                                 |
| ---- | --------------------------------------------------------- |
| 0    | Copia en bruto de cada hoja del libro (`legacy.*`)        |
| 1    | Geografía: 25 regiones, 70 provincias, 698 distritos      |
| 2    | Catálogos: especies, entidades, unidades orgánicas, tipos |
| 3    | Actores y organizaciones                                  |
| 4    | Usuarios, roles y territorios asignados                   |
| 5    | Actores con datos personales (cifrados) y membresías      |
| 6    | Casos y sus territorios                                   |
| 7    | Cronología de casos y documentos                          |
| 8    | Alertas tempranas y especies involucradas                 |
| 9    | Demandas y sus evidencias                                 |
| 10   | Compromisos e hitos                                       |
| 11   | Mesas de diálogo, capacitaciones y locales                |
| 12   | Envíos de comunicación y suscripciones                    |
| 13   | Bitácora de accesos del sistema anterior                  |

Para reanudar un tramo o depurar una fase:

```sh
python -m migration.loader.run --from 6 --to 9
python -m migration.loader.run --only 5 --per-phase-commit
```

`--per-phase-commit` confirma cada fase por separado. Usalo solo para depurar:
pierdes la garantía de «todo o nada».

### 5.3 Verificar la carga

```sh
python -m migration.loader.run --verify
```

> **Ojo:** `--verify` **solo verifica**, no carga. Hay que ejecutarlo como
> comando aparte, después de la carga. Si lo corres sobre una base vacía, el
> informe dirá «FALLA … 0 (esperado N)» en casi todas las líneas: no es un
> problema de la carga, es que no hay nada que verificar.

La comprobación exige **35** filas en la tabla de roles de usuario, que es el
total que deja la carga más el parche 16 con su rol de administrador y oficial de
datos personales. Si se verifica antes de ese parche, la línea avisa de la fila
que falta y no es un problema de la carga.

### 5.4 Aplicar los parches 6 a 19

Los parches vienen **después** de la carga, siempre en orden, y nunca antes.
Cada uno hace algo que necesita datos reales: reclasificar documentos, cifrar
datos personales, rellenar el grafo de conocimiento, cerrar la seguridad por
fila.

Camino corto (un solo archivo, sección B):

```sh
python migration/consolidar_esquema.py --seccion B --salida /tmp/seccion_b.sql

MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -v crypto_key="$APP_CRYPTO_KEY" -f - < /tmp/seccion_b.sql
```

Camino largo (parche por parche, útil cuando uno falla y hay que aislarlo):

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f - < docs/PARCHE_6_CIERRE_CUMPLIMIENTO.sql
```

…y así hasta el 17, cambiando solo el nombre del archivo. El parche 9 además
necesita `-v crypto_key="$APP_CRYPTO_KEY"`; sin esa variable aborta a propósito.

El parche 18 va aparte, siempre al final:

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f /dev/stdin < docs/PARCHE_18_COSTOS_Y_RLS_ADMIN.sql
```

Y después el 19, que cierra los comentarios que faltaban:

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f /dev/stdin < docs/PARCHE_19_COMENTARIOS_FALTANTES.sql
```

**Detalles que importan:**

- `MSYS_NO_PATHCONV=1` es necesario en Git Bash: si no, el sistema convierte las
  rutas que empiezan por `/` a rutas de Windows y `psql` busca en el lugar
  equivocado.
- El archivo se pasa por entrada estándar (`-f -`, o `-f /dev/stdin` como en el
  18), no con `-f /tmp/...`. Los 19 archivos del entorno —los 5 de preparación y
  los parches 6 a 19— están montados de solo lectura dentro del contenedor, de
  `96_patch_06.sql` a `109_patch_19.sql` (el 17 es `107_patch_17.sql`, el 18 el
  `108` y el 19 el `109`), así que también vale `-f /opt/avisa/sql/109_patch_19.sql`.
- El parche 6 crea una tabla de respaldo (`core.patch6_documentos_snapshot`) que
  él mismo autoriza a borrar cuando se valida. En la base de trabajo ya está
  borrada, por eso los conteos no la incluyen; en una base reconstruida existe
  hasta que se borre.
- El parche 17 depende del 15 y del 16: crea `core.consulta_reniec`
  (cifrada, de solo agregar y con huella HMAC), el privilegio nominal
  (`core.cat_privilegio`, `core.privilegio_usuario`) y las columnas de costo de
  Gemini y WhatsApp. Como el 14, el 15 y el 16, se pasa por entrada estándar.
- El parche 18 cierra el tope de gasto de RNF-13 y la escalada de privilegios
  del catálogo de identidad. Crea `config.servicio_externo` (8 columnas, 4
  filas: SVC-02 Gemini, SVC-06 correo, SVC-07 WhatsApp y SVC-16 PIDE-RENIEC) y
  `config.tope_gasto` (11 columnas y **0 filas**: el monto es la decisión
  abierta H-65), las vistas `config.v_consumo_servicio_mes` y
  `config.v_tope_aviso`, y las funciones `config.gasto_mes(text, date)` y
  `config.puede_gastar(text)`. Además pone seguridad por fila con `FORCE` en
  `core.roles`, `core.usuarios`, `core.usuario_roles` y en las dos tablas
  nuevas: la escritura queda solo para el rol `administrador`, y `core.roles`
  mantiene el `SELECT` abierto porque las funciones de contexto de todos los
  usuarios lo necesitan. Son 20 políticas nuevas (`p18_*`) y se puede repetir
  sin daño: se ha ejecutado cuatro veces sin error.
- El parche 19 no toca la estructura: agrega los **19 comentarios de columna**
  que quedaron pendientes en `core.cat_privilegio`, `core.privilegio_usuario`,
  `core.consulta_reniec` y `core.envios_comunicacion`, porque el parche 12 los
  comentó antes de que el 17 creara esos objetos. Verifica que el modelo quede
  sin ninguna columna sin describir; si quedara una, aborta.

### 5.5 Verificar de nuevo

```sh
python -m migration.loader.run --verify
```

Con los parches aplicados deben pasar **todas** las comprobaciones. Además:

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f - < migration/tests/test_15_roles.sql
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f - < migration/tests/test_16_rls_core.sql
```

Los dos terminan con un mensaje de cierre y **no** deben mostrar la palabra
`FALLO` en ninguna línea (el texto del banner final sí la menciona; eso no
cuenta).

### 5.6 Regenerar los artefactos derivados

Los documentos que se generan **no se editan a mano**: se regeneran cuando cambia su fuente. Este es
el orden, porque cada uno puede alimentar al siguiente (la razón de cada flecha está en `INDICE.md`
**§6.e**):

```sh
python migration/generar_comentarios_sql.py   # 1. PARCHE_12 (comentarios de tablas y columnas)
python migration/consolidar_esquema.py        # 2. AVISA_V10_ESQUEMA_UNIFICADO.sql
python migration/generar_diccionario.py       # 3. DICCIONARIO_DATOS.md + diccionario_datos.csv
python migration/reporte_estadistica.py       # 4. img/delta_*.svg + §11.5 de LEGADO_A_V10
python migration/prioridad_mvp.py             # 5. 03_ejecucion/mvp_prioridad_tablas.csv
python migration/extraer_fks.py               # 6. sql_server/*.sql + INFORME_FKS.md
```

**Cuáles necesitan la base encendida y cuáles no.** Los pasos 1, 3, 4 y 5 leen el catálogo vivo
(`pg_class`, `pg_attribute`, `pg_constraint`) y fallan sin base: miden filas y columnas reales, no
heredan cifras. Los pasos 2 y 6 trabajan sobre archivos —el 2 lee el DDL y los 19 SQL, el 6 lee el
unificado del paso 2— y por eso son los únicos que corren con la base apagada.

**Comprobación de que quedaron coherentes.** Después del paso 3, las «Cifras de esta edición» del
encabezado de `05_datos/DICCIONARIO_DATOS.md` deben coincidir con la medición del 2026-11-20 de
`INDICE.md` §3; si no coinciden, el desactualizado es el diccionario. Después del paso 5, el CSV
debe tener **265** filas de datos y sumar **2 145** columnas y **13 352** filas, que es lo que dice
`03_ejecucion/PRIORIZACION_MVP_v10.md` §1.

---

## 6. Parte C — Preparar la copia para SQL Server

El asistente de SQL Server (SSMA) no debe ver las 374 tablas: genera cientos de
avisos que esconden los reales. Se le entrega una copia recortada.

### 6.1 Crear la copia

```sh
docker compose exec -T db psql -U avisa -d postgres \
  -c "DROP DATABASE IF EXISTS avisa_mssql;" \
  -c "CREATE DATABASE avisa_mssql TEMPLATE avisa;"
```

`TEMPLATE avisa` copia también los datos. Es lo que queremos: la copia debe
llevar filas para que el asistente migre contenido, no solo estructura.

**No recortes la base de trabajo.** El script de recorte se niega a correr si no
está en una base de staging, pero no lo tientes.

### 6.2 Recortar el alcance

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa_mssql \
  -v ON_ERROR_STOP=1 -f - < migration/mssql/00_alcance_mvp.sql
```

Resultado esperado: **78 tablas**, **685 columnas** y **169 claves ajenas** (163
de ellas entre tablas del propio alcance). Son las **46 tablas del MVP** más las
que entran por dependencias: al recortar, cada clave ajena que apunta fuera de la
lista arrastra consigo la tabla padre que le da destino, y así se suman 32
tablas, **3 de ellas de `kag`** (el mínimo que sostiene
`ref.base_legal_evidencia`). Incluye el esquema `legacy` completo si OGTI va a
conservar el archivo histórico.

### 6.3 Crear el rol de migración

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa_mssql \
  -v migrador_password='<clave temporal>' \
  -f - < migration/mssql/01_rol_migracion.sql
```

**Por qué hace falta.** La base aplica seguridad por fila. Si SSMA se conecta
con un usuario normal y sin contexto de sesión, PostgreSQL **no da error**:
devuelve cero filas. El asistente migraría tablas vacías y el informe diría
«correcto». Ese fallo silencioso es la razón del rol: se llama
`ssql_migrator`, solo lee y se salta la seguridad por fila a propósito.

La contraseña no vive en el repositorio: se pasa como variable.

### 6.4 Normalizar tipos

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa_mssql \
  -v ON_ERROR_STOP=1 -f - < migration/mssql/02_normalizar_tipos.sql
```

SQL Server no tiene equivalentes directos de tres cosas que PostgreSQL sí tiene:

| En PostgreSQL                           | Qué se hace antes de migrar                                        |
| --------------------------------------- | ------------------------------------------------------------------ |
| `uuid` con valor por defecto automático | Se retira el valor por defecto; SQL Server lo genera con `NEWID()` |
| `jsonb`                                 | Se mapea a `nvarchar(max)` y se valida con `ISJSON(...) = 1`       |
| `timestamptz` (fecha con zona)          | Se lleva a `datetimeoffset(7)`, o se estandariza a UTC             |
| Arreglos (`text[]`)                     | No existen en SQL Server: se convierten a texto JSON               |

El script retira 25 valores por defecto de `uuid` y deja constancia de los 12
campos `jsonb`. La lista completa de correspondencias está en
`migration/mssql/03_mapa_tipos_ssma.md`.

### 6.5 Comprobar la copia

```sh
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa_mssql \
  -v ON_ERROR_STOP=1 -f - < migration/tests/test_migracion_mssql.sql
```

Debe pasar entero. Comprueba los conteos de tablas, columnas, claves ajenas,
políticas de seguridad por fila y comentarios.

---

## 7. Parte D — Migrar con SSMA y cerrar

1. Conecta SSMA con el usuario `ssql_migrator` y su contraseña temporal.
2. Revisa el mapeo de tipos antes de convertir: `json` y `jsonb` deben apuntar a
   `nvarchar(max)`.
3. Ejecuta la conversión y luego la migración de datos.
4. Corre los chequeos de llegada en SQL Server:

```
migration/mssql/04_chequeos_postmigracion.sql
```

> **Cobertura:** esos chequeos ya cubren las 30 tablas con seguridad por fila del
> alcance recortado, con 143 predicados. Las tablas que añadieron los parches
> 14, 15, 16 y 17 tienen su equivalente en SQL Server en el apartado §5.2 y §5.3 del
> mismo archivo, y las pruebas del §5.5 las ejercitan con dos niveles de
> clasificación. El detalle técnico está en `migration/mssql/INFORME_TIPOS.md`.

5. Cuando la migración esté cerrada, elimina el rol de migración: es una
   excepción a la seguridad y no debe quedarse.

```sql
DROP OWNED BY ssql_migrator;
DROP ROLE ssql_migrator;
```

---

## 8. Parte E — Rehacer la base desde cero

Cuando algo queda a medias, es más rápido y más seguro empezar de nuevo que
reparar. La plantilla existe para eso.

```sh
./scripts/db.sh snapshot   # congela el esquema VACÍO como avisa_template
./scripts/db.sh fresh      # borra la base actual y la recrea desde la plantilla
```

`snapshot` **no** copia datos: guarda la estructura para que `fresh` sea
instantáneo. Después de `fresh` hay que volver a cargar el legado y a aplicar
los parches (partes B y siguientes).

La secuencia completa que se verificó en una base nueva:

```
sección A  →  carga del legado  →  parches 6 a 19  →  pruebas 15 y 16
```

Al terminar: **289 tablas físicas** (265 lógicas y 24 hijas de partición),
**2 511 columnas** y **610 claves ajenas**, sin contar `legacy` ni `public`. Son
las cifras medidas en la base de trabajo el 2026-11-20.

**Comprobación del 2026-11-19, de punta a punta.** La secuencia completa se
corrió sobre una base desechable (`avisa_check`) para validar el orden de los
bloques del archivo unificado. El resultado fue: sección A → **275 tablas
físicas, 2 314 columnas y 581 claves ajenas**; tras la carga y los parches
hasta el 17 → **288 tablas físicas, 2 496 columnas y 609 claves ajenas**. La
única diferencia con la base de trabajo es `core.patch6_documentos_snapshot` (1
tabla, 4 columnas y 1 comentario), que el parche 6 crea como respaldo y deja a
la espera de que se valide y se borre; al quitarla quedan exactamente **287 /
2 492 / 609**. La seguridad por fila también coincide: **520 políticas en 82
tablas** y **66 disparadores**.

El parche 18, que entró después, añade 2 tablas, 19 columnas, 1 clave ajena y 20
políticas en 5 tablas: el estado final es **290 tablas físicas, 2 515 columnas y
610 claves ajenas** (**289 / 2 511 / 610** sin el respaldo del parche 6) y **540
políticas en 87 tablas**. El parche 19 no altera ninguna de esas cifras: solo
escribe los 19 comentarios de columna que el 17 había dejado pendientes.

---

## 9. Errores conocidos

| Síntoma                                                                                      | Causa                                                                                      | Qué hacer                                                                                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `No hay DSN. Definí DATABASE_URL…`                                                           | El programa no encontraba el `.env`                                                        | Corregido: ahora busca el `.env` en la raíz y un nivel arriba. Si persiste, exporta `DATABASE_URL` a mano              |
| `no encuentro el workbook del legado`                                                        | El libro vivía en `backend/`, que hoy aloja la API y no el libro                           | Corregido: ahora busca en `backend/` y en `backups/backend/`. Usa `--xlsx` si está en otro sitio                       |
| `ImportError: cannot import name 'db' from 'backend'`                                        | La raíz conserva un `backend/` con la API y sin `db.py`, que hacía sombra al de `backups/` | Corregido: la ruta de importación se decide por la presencia de `backend/db.py`, no del directorio                     |
| El parche 14 aborta con `violates check constraint proceso_instancia_origen_coherente_check` | Convertía filas a origen «alerta» antes de relajar la restricción que lo prohibía          | Corregido: la restricción se retira al inicio del bloque 2 y se vuelve a crear al final, ya con los datos normalizados |
| `permission denied for table actor_alias`                                                    | Los permisos generales corrían antes de crear la tabla                                     | Corregido: los permisos se otorgan al crear cada tabla nueva                                                           |
| `--verify` dice «FALLA … 0 (esperado N)» en todo                                             | Se ejecutó sin cargar primero                                                              | Corre la carga (`python -m migration.loader.run`) y después la verificación                                            |
| Un borrado «no falla» pero no borra nada                                                     | La seguridad por fila no lanza error al denegar un `DELETE`: afecta 0 filas                | Comprueba filas afectadas, no la ausencia de error                                                                     |
| `psql` busca en `C:/Program Files/Git/tmp/...`                                               | Git Bash convierte las rutas que empiezan por `/`                                          | Usa `MSYS_NO_PATHCONV=1` y pasa el archivo por entrada estándar                                                        |
| Recuentos de filas que no cuadran                                                            | `public.spatial_ref_sys` (PostGIS) tiene 8 500 filas ajenas al sistema                     | Excluye el esquema `public` de cualquier conteo                                                                        |
| Recuentos de tablas que no cuadran                                                           | Las particiones se cuentan como tablas físicas                                             | Distingue tablas lógicas (`relkind='r'`) de particiones (`relkind='p'`)                                                |

---

## 10. Todos los comandos, juntos

```sh
# --- entorno
cp .env.example .env
docker compose up -d db
docker compose ps
./scripts/db.sh status

# --- base del MVP (camino normal; el contenedor ya lo hizo al arrancar)
./scripts/db.sh verify

# --- base del MVP (manual, sin contenedor)
python migration/consolidar_esquema.py --seccion A --salida /tmp/seccion_a.sql
psql -U avisa -d avisa -v ON_ERROR_STOP=1 -f /tmp/seccion_a.sql

# --- datos del sistema anterior
python -m migration.loader.run
python -m migration.loader.run --verify

# --- parches 6 a 19
python migration/consolidar_esquema.py --seccion B --salida /tmp/seccion_b.sql
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -v crypto_key="$APP_CRYPTO_KEY" -f - < /tmp/seccion_b.sql

# --- parche 18 suelto (si se aplica uno por uno)
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f /dev/stdin < docs/PARCHE_18_COSTOS_Y_RLS_ADMIN.sql

# --- parche 19 suelto (los comentarios de columna que faltaban)
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f /dev/stdin < docs/PARCHE_19_COMENTARIOS_FALTANTES.sql

# --- pruebas
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f - < migration/tests/test_15_roles.sql
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa \
  -v ON_ERROR_STOP=1 -f - < migration/tests/test_16_rls_core.sql

# --- copia para SQL Server
docker compose exec -T db psql -U avisa -d postgres \
  -c "DROP DATABASE IF EXISTS avisa_mssql;" \
  -c "CREATE DATABASE avisa_mssql TEMPLATE avisa;"
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa_mssql \
  -v ON_ERROR_STOP=1 -f - < migration/mssql/00_alcance_mvp.sql
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa_mssql \
  -v migrador_password='<clave temporal>' -f - < migration/mssql/01_rol_migracion.sql
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa_mssql \
  -v ON_ERROR_STOP=1 -f - < migration/mssql/02_normalizar_tipos.sql
MSYS_NO_PATHCONV=1 docker exec -i avisa-db psql -U avisa -d avisa_mssql \
  -v ON_ERROR_STOP=1 -f - < migration/tests/test_migracion_mssql.sql

# --- rehacer desde cero
./scripts/db.sh snapshot
./scripts/db.sh fresh
```

---

## 11. Referencias

Los documentos citados en este texto, con lo que aporta cada uno:

1. `docs/06_operacion/ENTORNO_DOCKER_POSTGRES.md` — el contenedor, las credenciales, el
   arranque y la aplicación de los parches 6 a 19 (§9).
2. `docs/AVISA_V10_ESQUEMA_UNIFICADO.sql` — todo el esquema en un archivo, en dos
   secciones, con el detalle de qué produce cada una. Generado: no se edita a mano.
3. `migration/consolidar_esquema.py` — el programa que arma ese archivo unificado.
4. `docs/03_ejecucion/PRIORIZACION_MVP_v10.md` — qué tablas forman el MVP y en qué orden se
   construyen.
5. `docs/04_migracion/DECISIONES_CARGA_LEGADO_V9.md` — las decisiones de la carga (MIG D1–D51)
   y por qué se tomó cada una.
6. `docs/04_migracion/PLAN_PORTE_LEGADO_V9.md` — la especificación de la carga y el mapa de
   fuentes.
7. `docs/04_migracion/ACTA_CIERRE_CARGA_V9.md` — las cifras certificadas de la carga.
8. `migration/mssql/INFORME_TIPOS.md` — qué tipos cambian al pasar a SQL Server y
   qué queda pendiente.
9. `migration/mssql/03_mapa_tipos_ssma.md` — la tabla de correspondencias para el
   asistente de SQL Server.
10. `migration/mssql/04_chequeos_postmigracion.sql` — las comprobaciones que se
    corren en SQL Server al terminar.
11. `docs/PARCHE_9_SEGURIDAD_NIVEL_ALTO.sql` — el cifrado de datos personales y
    por qué necesita `crypto_key`.
12. `docs/PARCHE_16_RLS_CORE_Y_DC04.sql` — la seguridad por fila de `core` y el
    registro del banco de datos personales.
13. `docs/PARCHE_17_RENIEC_Y_COSTOS.sql` — la consulta PIDE-RENIEC cifrada e
    inmutable, el privilegio nominal y las columnas de costo de Gemini y de
    WhatsApp.
14. `docs/05_datos/LEGADO_A_V10_SIMILITUDES_Y_DIFERENCIAS.md` — qué es igual y qué cambia
    entre el sistema anterior y la v10, con las cifras comparadas.
15. `docs/PARCHE_18_COSTOS_Y_RLS_ADMIN.sql` — el tope de gasto de RNF-13 (aviso
    al acercarse, bloqueo al excederse) y la seguridad por fila del catálogo de
    identidad: `core.roles`, `core.usuarios` y `core.usuario_roles`.
