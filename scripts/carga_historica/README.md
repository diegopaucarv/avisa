# Carga histórica de las alertas del sectorista

Proceso de una sola pasada que traslada el libro del sectorista
(`AVISA_carga_historica_Ivan_Ascurra_2026.xlsx`, 8 entregables de mayo a
noviembre de 2026) a la base AVISA en PostgreSQL/Neon. No es un servicio ni un
endpoint: es un programa de Python que lee, planifica e inserta de forma
controlada e idempotente.

## Qué hace y por qué no es un endpoint

El endpoint `POST /api/v1/alerts` es unitario: genera `codigo_alerta`, rechaza
arrays y no acepta `codigo_legado` ni `es_validado_humano`. Por eso no sirve
para una carga masiva que deba ser reintentable y trazable. Este script cubre
ese hueco:

- Acepta un libro completo con varias hojas relacionadas (alertas, hechos,
  actores, documentos, demandas, reuniones).
- Conserva la trazabilidad de origen mediante `codigo_legado`.
- Separa la **planificación** (pura y determinista) de la **aplicación** (una
  fila por vez, con savepoint).
- Es idempotente: volver a ejecutarlo no duplica lo ya cargado.

Módulos:

| Fichero                 | Responsabilidad                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `excel_historico.py`    | Lee el libro con `openpyxl` y valida hojas/columnas. Expone `leer_libro()` y `ErrorEstructura`. No conoce la base.                                                                          |
| `plan_historico.py`     | Planificación pura y determinista: `construir_plan(hojas, ctx) -> Plan` con `Insercion`, `Rechazo` y `Omision`. `Plan.huella()` calcula un SHA-256 del plan. No importa `psycopg2`.         |
| `importar_historico.py` | CLI. Resuelve catálogos, territorio y usuarios contra la BD (`contexto_completo`), detecta duplicados por contenido (`detectar_duplicados`), construye el plan y, opcionalmente, lo aplica. |
| `alias_catalogos.json`  | Equivalencias de vocabulario del Excel contra los catálogos reales. Es dato, no código.                                                                                                     |

## Requisitos

- Python 3.13.
- Dependencias: `psycopg2-binary`, `python-dotenv`, `openpyxl` y `pytest`.
- Un `.env` en la raíz del repositorio con `NEON_OWNER_URL` o `DATABASE_URL`.
  La conexión se toma de `NEON_OWNER_URL`, luego `DATABASE_URL`; `--dsn` tiene
  prioridad sobre ambas. Se espera el rol propietario (`neondb_owner`), porque
  el proceso inserta en `core`.

## Uso

Ensayo por defecto: solo lectura, no escribe nada.

```bash
python scripts/carga_historica/importar_historico.py --excel "RUTA\LIBRO.xlsx"
```

Aplicar de verdad: requiere las dos banderas.

```bash
python scripts/carga_historica/importar_historico.py --excel "RUTA\LIBRO.xlsx" --apply --confirmar
```

Ensayo de escritura: aplica dentro de una transacción y la revierte siempre,
para validar constraints y triggers sin persistir.

```bash
python scripts/carga_historica/importar_historico.py --excel "RUTA\LIBRO.xlsx" --ensayo-escritura --confirmar
```

## Banderas

| Bandera                    | Efecto                                                                                                      | Requiere      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| `--excel RUTA`             | Ruta del libro `.xlsx` (obligatoria).                                                                       | —             |
| `--apply`                  | Escribe y hace `commit`.                                                                                    | `--confirmar` |
| `--marcar-duplicados`      | Estampa el `codigo_legado` del libro en la fila existente y deduplica sus demandas. En dry-run solo simula. | —             |
| `--ensayo-escritura`       | Aplica el plan y revierte la transacción al final. Excluyente con `--apply`.                                | `--confirmar` |
| `--confirmar`              | Confirma la escritura. Sin ella, `--apply` y `--ensayo-escritura` abortan con código 2.                     | —             |
| `--continuar`              | Con `--apply`, confirma lo escrito aunque alguna fila falle.                                                | `--apply`     |
| `--solo tabla1,tabla2`     | Limita las tablas que se escriben. Las dependencias no incluidas pueden fallar.                             | —             |
| `--sin-dedup`              | Inserta todo sin comparar contenido (solo se omite por `codigo_legado` existente).                          | —             |
| `--alias RUTA_JSON`        | JSON de alias de catálogo (por defecto `alias_catalogos.json`).                                             | —             |
| `--informe RUTA.md\|.json` | Ruta del informe.                                                                                           | —             |
| `--dsn DSN`                | URL de conexión explícita.                                                                                  | —             |

## Cómo funciona el plan

El flujo es secuencial y separa lo puro de lo que toca la base:

1. **Leer** (`leer_libro`): valida que existan las hojas y columnas requeridas
   de `COLUMNAS_REQUERIDAS`; si falta algo, lanza `ErrorEstructura` indicando
   la hoja y las columnas. Devuelve `LibroHistorico` (filas por hoja, cabeceras
   y el texto de la hoja `prompt`, que se ignora para la carga).
2. **Resolver contexto** (`contexto_completo`): consulta la BD para construir un
   `Contextos` con catálogos (`core.cat_*`), usuarios (`core.usuarios`),
   territorio (`core.regiones`/`provincias`/`distritos`), directorio de actores
   (`core.actores` y, si existe, `core.actor_alias`), los `codigo_legado` ya
   presentes por tabla y las bases de secuencia por año.
3. **Deduplicar** (`detectar_duplicados`): compara el contenido del libro con lo
   ya cargado y devuelve un mapa de duplicados más avisos.
4. **Planificar** (`construir_plan`): produce un `Plan` con `inserciones`,
   `omitidos`, `rechazos`, `advertencias`, `resumen` y `alias_usados`. Es
   determinista: mismos datos y mismo contexto implican misma `huella()`.
5. **Aplicar** (`aplicar`/`Ejecutor`): recorre las inserciones en orden de
   dependencia (primero padres, luego hijos) e inserta una fila por vez dentro
   de su propio savepoint. En modo ensayo no se llega a este paso.

## Códigos y trazabilidad

El libro trae `codigo_alerta`, `documentos.codigo` y `codigo_reunion` vacíos.
AVISA los genera con el mismo criterio que la aplicación, tomando el siguiente
sufijo por año a partir de los códigos ya existentes en la base:

| Entidad                  | Código generado | Sufijo                  |
| ------------------------ | --------------- | ----------------------- |
| `core.alertas_tempranas` | `AT-<año>-<n>`  | `max + 1`, dos dígitos  |
| `core.documentos`        | `RED-<año>-<n>` | `max + 1`, tres dígitos |
| `core.reuniones_dialogo` | `RD-<año>-<n>`  | `max + 1`, tres dígitos |

La trazabilidad se apoya en `codigo_legado`, con el patrón
`historico_sectorista_iaes-<AT|CS|RR|PAE|RD|Dnn>-<nnn>`. Ese valor es UNIQUE en
`alertas_tempranas`, `documentos` y `demandas`, y UNIQUE parcial en
`reuniones_dialogo` (`WHERE codigo_legado IS NOT NULL`). De ahí que la recarga
sea idempotente: el `codigo_legado` actúa como llave natural del origen.

Toda la carga se registra con `origen_dato = 'AVISA_HISTORICO'` y
`es_validado_humano = false`. El CHECK de `origen_dato` admite únicamente
`MANUAL`, `KAG`, `WORKFLOW`, `AVISA_HISTORICO` y `WHATSAPP`; nunca
`importacion`.

Riesgos y acciones no tienen tablas propias (`core.alertas_riesgos` y
`core.alertas_acciones` no existen): se guardan en `riesgos_json` y
`acciones_sugeridas_json` de la alerta.

Los actores se crean en `core.actores`, se enlazan en `core.alertas_actores` y
`core.documento_actores`, se agrupan como texto en `alertas.actores_clave`
(JSON), y el celular se registra en `actor_datos_personales.telefono_contacto`.
Un actor que ya existe en el directorio se reutiliza y no se le sobrescribe el
celular.

## Deduplicación e idempotencia

Hay dos capas.

**a. Por `codigo_legado`.** Si el registro ya existe en la base, se OMITE y no
se actualiza. Es la capa que hace idempotente la recarga.

**b. Por contenido** (`detectar_duplicados`). Antes de insertar se compara el
libro contra lo ya cargado usando título, fecha y textos normalizados
(minúsculas, sin tildes, sin espacios ni puntuación) con similitud `difflib`.
Los umbrales son:

| Umbral        | Valor | Efecto                                     |
| ------------- | ----- | ------------------------------------------ |
| `UMBRAL_CASI` | 0.85  | Se marca como duplicado y se omite.        |
| `UMBRAL_DUDA` | 0.70  | Solo se advierte y la fila se carga igual. |

En alertas se comparan `plantilla_whatsapp` y `situacion_actual`; en documentos,
`contenido_json.texto_original`. Un texto idéntico o un par (título, fecha)
idéntico se tratan como duplicado. La separación en el libro real es amplia: el
grupo repetido puntúa ≥ 0,89 y el nuevo ≤ 0,49.

**c. Consecuencia sobre los hijos.** Si una alerta o un documento resulta
duplicado de algo ya cargado con otro código, sus hijos (hechos, vínculos de
actores, vínculos de documentos) también se omiten: el padre no se inserta y la
referencia no sería resoluble. En cambio, si el mismo `codigo_legado` ya existe
en la base, la demanda SÍ se inserta y se enlaza al padre existente por id.

Además, dentro del propio libro se rechazan `codigo_legado` repetidos y pares
(tipo, título normalizado, fecha) repetidos.

**Idempotencia / recarga.** Volver a ejecutar sobre una base ya cargada no
inserta nada nuevo: los mismos `codigo_legado` producen omisiones. El ensayo de
escritura permite comprobar constraints y triggers revirtiendo siempre la
transacción.

## Fusión de duplicados (`--marcar-duplicados`)

Cuando una alerta (o documento) del libro ya existe con otro código, la
deduplicación la trata como duplicado y omite sus hijos. Con
`--marcar-duplicados` se invierte esa decisión: el `codigo_legado` del libro se
estampa sobre la fila existente para dejarla trazable e idempotente, de modo que
en adelante se reconozca por `codigo_legado` y sus hijos puedan insertarse
enlazados por id al padre existente.

- En dry-run (`--excel` sin `--apply`) solo se simula en memoria: el plan y el
  informe muestran lo mismo que haría el apply, sin escribir nada.
- En `--apply` y `--ensayo-escritura` se ejecuta
  `update core.<tabla> set codigo_legado = %s where id = %s and codigo_legado is null`
  por cada duplicado. El ensayo de escritura revierte la transacción al final, así
  que nunca deja marcas persistentes.
- Si la fila destino trae como `codigo_legado` su propio código generado (un
  molde de relleno), se sustituye por el del libro. Si trae un legado ajeno
  distinto, no se sobrescribe: se registra `conflicto`, se advierte y el legado
  sigue contando como duplicado.
- Auditoría: el informe incluye `## Marcas de codigo_legado` con
  `legado → código existente (similitud)` y el estado (`marcado`, `ya marcado`,
  `conflicto`, `simulado`).

Como al marcar las alertas sus demandas pasan a insertarse, `deduplicar_demandas`
compara cada demanda del libro con las ya cargadas en su padre (descripción
normalizada, sin tildes, mayúsculas ni puntuación): descripción idéntica o
similitud ≥ 0,85 se omite; entre 0,70 y 0,85 se advierte y se carga igual.

## Campos sin destino

Columnas del Excel que no tienen columna equivalente en el esquema. No se
fuerzan ni se rellenan con valores ficticios:

| Origen (Excel)                              | Destino                                  | Tratamiento                       |
| ------------------------------------------- | ---------------------------------------- | --------------------------------- |
| `demandas.orden`                            | —                                        | Sin columna; se ignora.           |
| `demandas.grupo`                            | —                                        | Sin columna; se ignora.           |
| `alertas_actores.orden`                     | —                                        | Sin columna; se ignora.           |
| `alertas_actores.texto_original`            | —                                        | Sin columna; se ignora.           |
| `documentos.region`, `documentos.provincia` | `core.documentos` no tiene esas columnas | Se conservan en `contenido_json`. |

Regla general: un campo desconocido queda ausente/NULL, nunca `0` ni un valor de
relleno.

## Reglas de honestidad del dato

- No se usan valores fijos: toda referencia a catálogos se resuelve contra la
  BD (`core.cat_*`, `core.usuarios`, territorio).
- Lo no resoluble se reporta como advertencia y queda NULL. Si la columna es
  obligatoria, la fila se rechaza (por ejemplo, `fecha_reporte` o `fecha` de
  reunión ausentes no se dejan al DEFAULT; `tipo_documento` no resoluble
  rechaza el documento porque `tipo_id` es NOT NULL).
- Las fechas vacías se rechazan en lugar de dejar que el DEFAULT invente un
  valor.
- `programada` se omite cuando el libro no la declara, para que aplique el
  default de la base y nunca se fuerce `false`.
- Los textos que excederían el `varchar(n)` de su columna se recortan al límite
  real leído de `information_schema.columns` (nunca con números fijos en el
  código) y el recorte queda como advertencia en el informe, indicando tabla,
  código, campo y longitud original. Con la 87 aplicada las dos columnas que lo
  sufrían (`core.actores.cargo_actual` y `core.reuniones_dialogo.titulo`) son
  `text`, así que ya no se recortan; la salvaguarda queda para futuras columnas.

## Límite de longitud de los textos

**Estado (2026-11-28).** La migración 87 **ya está aplicada** (verificado en
`core.migracion_log`): `core.actores.cargo_actual` y
`core.reuniones_dialogo.titulo` son `text`, así que el import conserva el texto
completo sin recorte. El script sigue leyendo el límite de
`information_schema.columns` y, si una columna vuelve a ser `varchar(n)`, recorta
a ese límite y lo registra como advertencia (ver «Reglas de honestidad del
dato»); no ejecuta migraciones.

## Alias de catálogo

`alias_catalogos.json` traduce el vocabulario del Excel al de los catálogos
reales. Los valores resueltos por alias se cuentan en `alias_usados` y se
informan.

| Valor en el Excel  | Valor en el catálogo |
| ------------------ | -------------------- |
| `Disruptivo`       | `Conflictivo`        |
| `Moderado`         | `Medio`              |
| `Intermedio`       | `Medio`              |
| `Critico`          | `Alto`               |
| `Moderado-Alto`    | `Alto`               |
| `Mype e Industria` | `MYPE e Industria`   |

Un alias que apunta a un destino inexistente en el catálogo genera advertencia
y deja el campo en NULL.

## Informes y auditoría

Cada ejecución imprime un resumen por tabla en consola y escribe un informe. Por
defecto va a `scripts/carga_historica/informe_<fecha>_<sufijo>.md`, donde
`<fecha>` es `AAAA-MM-DD_HHmm` y `<sufijo>` distingue el modo: `dry` (ensayo),
`apply` (aplicación) o `rollback` (ensayo de escritura). Con `--informe` se fija
la ruta y, si termina en `.json`, se emite JSON.

El informe incluye la `huella` del plan, los alias usados, la tabla resumen por
entidad (insertar / ya existe / rechazos / escritos / fallos), los omitidos, los
rechazos, las advertencias y los fallos de escritura.

La `huella()` es un SHA-256 estable calculado sobre inserciones, omisiones,
rechazos y advertencias. Sirve para comprobar determinismo: dos ejecuciones sin
cambios deben producir la misma huella.

## Seguridad

- El modo por defecto es ensayo de solo lectura: la conexión se abre con
  `readonly` y `autocommit`, y no se modifica la base.
- `--apply` exige `--confirmar`; si falta, el proceso termina con código 2 sin
  abrir una conexión de escritura.
- `--ensayo-escritura` también exige `--confirmar`, aplica el plan dentro de una
  transacción y hace `rollback` siempre, para validar constraints y triggers sin
  persistir. Es mutuamente excluyente con `--apply`.
- Sin `--continuar`, si alguna fila falla se deshace la carga completa; con
  `--continuar` se conserva lo escrito.
- Cada fila se inserta dentro de su propio savepoint: un fallo revierte solo esa
  fila, sin abortar el resto de la transacción.
- Este script no ejecuta migraciones ni DDL: solo inserta filas. Cualquier
  cambio de esquema es responsabilidad de otro proceso.
