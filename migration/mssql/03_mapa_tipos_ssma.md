# 03 · Mapa de tipos para SSMA y contrato de seguridad de la API .NET

Medición hecha el **2026-11-19** sobre la base de origen `avisa` (PostgreSQL 16.14,
contenedor `avisa-db`), con el alcance cerrado de `00_alcance_mvp.sql` y proyectada
al staging tras los pasos 1, 2 y 3. La copia `avisa_mssql` no se ha reconstruido
con el alcance nuevo: sus 74 tablas / 651 columnas son la medición anterior y no
se usan aquí.

El alcance es de **78 tablas del dominio y 685 columnas**. Esas 78 salen de las
**42 tablas declaradas** por prioridad (T0/T1), que ya incluyen `core.actor_alias`,
`core.banco_datos_tratamiento`, `core.cat_nivel_identificacion` y
`ref.base_legal_tratamiento` (parche 16) y `core.consulta_reniec` (parche 17),
**más 36 incorporadas al cerrar las dependencias**: **34 tablas padre** alcanzadas
recorriendo las claves ajenas (`core.regiones`, `core.provincias`,
`core.documentos`, `core.mesas_dialogo`, `policy.regla`, `ind.variante`,
`kag.documento_fuente`…) y **2 más al sembrar `ref` entera**
(`ref.base_legal_evidencia` y `kag.documento_fragmento`, que sólo se alcanzan
desde ella). Sin ese cierre quedaban columnas huérfanas
—`core.casos.region_principal_id` sin `core.regiones`, `core.actores.region_id`
sin destino— y el esquema no se podía ni migrar ni consultar.

Fuera del alcance quedan `legacy` (**87 tablas, 807 columnas**) y la tabla de
PostGIS `public.spatial_ref_sys` (5 columnas, 8 500 filas), que no se migra porque
pertenece a la extensión. Con ellas, el staging tiene **166 tablas físicas y 1 497
columnas**; las cifras de este documento son siempre del alcance de 78, salvo
donde se diga lo contrario.

Todas las cifras salen del catálogo de PostgreSQL o de `count(*)`; ninguna es
estimada. Las consultas de origen están en §1 para poder repetirlas.

Cómo se ejecutó todo:

```sh
cd C:\Users\Julia\Downloads\avisa
docker compose exec -T db psql -U avisa -d avisa_mssql -c "SELECT ..."
```

> Las cuentas se tomaron con el rol `avisa` (superusuario y `BYPASSRLS`). Con un
> rol sujeto a las políticas de fila, varias tablas devolverían 0 filas sin dar
> error: ese es el fallo silencioso que ya cubre el paso 2 (`01_rol_migracion.sql`).

---

## 1. Resumen medido

| Dato                                                                             |    Valor medido |
| -------------------------------------------------------------------------------- | --------------: |
| Tablas del alcance (9 esquemas; 42 declaradas + 36 por cierre)                   |              78 |
| Columnas del alcance                                                             |         **685** |
| **Combinaciones distintas de tipo** (`udt_name` + longitud + precisión + escala) |          **40** |
| Columnas `uuid`                                                                  |             124 |
| Columnas `uuid` con `DEFAULT` (el paso 3 se lo retiró a 28)                      |               0 |
| Columnas `jsonb` / `json`                                                        |          13 / 0 |
| Columnas `text`                                                                  |              43 |
| Columnas `bytea`                                                                 |               5 |
| Columnas `timestamptz` / `timestamp` sin zona                                    |          49 / 0 |
| Columnas `timestamptz` con `DEFAULT now()`                                       |              38 |
| Columnas `date`                                                                  |              33 |
| Columnas de tipo array                                                           |               0 |
| Enums, dominios                                                                  |           0 / 0 |
| Columnas generadas (`GENERATED ALWAYS AS`)                                       |               0 |
| Columnas `IDENTITY`                                                              |               3 |
| Columnas `serial` (`nextval`)                                                    |               8 |
| Claves primarias                                                                 |              77 |
| Claves ajenas                                                                    |             169 |
| Restricciones `UNIQUE` / `CHECK`                                                 |         73 / 85 |
| Índices únicos (incluye las 77 PK)                                               |             155 |
| Índices parciales (`WHERE ...`)                                                  |              10 |
| Tablas con RLS (todas con `FORCE`) / políticas                                   |        30 / 198 |
| Triggers                                                                         | 30 en 16 tablas |
| Funciones PL/pgSQL y SQL                                                         |              56 |
| Comentarios de tabla + columna en `avisa` (756 en el staging)                    |  757 (78 + 679) |
| Extensiones                                                                      |               6 |
| Filas en las 78 tablas                                                           |       **8 428** |
| Filas en `legacy` (87 tablas)                                                    |           4 729 |
| Filas en `public.spatial_ref_sys` (PostGIS)                                      |           8 500 |

Tipos presentes en el alcance (13): `character varying` 215 + `character` 13 · `uuid`
124 · `smallint` 102 · `timestamptz` 49 · `integer` 39 · `text` 43 · `date` 33 ·
`boolean` 30 · `numeric` 17 · `jsonb` 13 · `bytea` 5 · `bigint` 2.

Las 3 vistas del alcance (`core.v_actor_datos_personales_seguro` 6 columnas,
`ref.nivel_identificacion` 3, `ref.vw_base_legal_fuente` 12) **no** se cuentan: no
son tablas y no se migran como datos.

### Consultas de origen

Combinaciones de tipo (una fila por combinación). El filtro por `relkind` es
obligatorio: `information_schema.columns` también devuelve columnas de vistas y,
si no se excluyen, el alcance saldría con 706 columnas y las cuentas por tipo
dejarían de cerrar.

```sql
SELECT c.udt_name, c.data_type,
       c.character_maximum_length AS largo,
       c.numeric_precision          AS precision,
       c.numeric_scale              AS escala,
       count(*)                     AS columnas,
       count(DISTINCT (c.table_schema, c.table_name)) AS tablas
  FROM information_schema.columns c
  JOIN pg_class     k ON k.relname = c.table_name
  JOIN pg_namespace n ON n.oid = k.relnamespace AND n.nspname = c.table_schema
 WHERE k.relkind IN ('r', 'p')          -- tablas físicas, no vistas
   AND c.table_schema IN ('agent','audit','core','ind','kag','policy',
                          'staging','qda','ref')
 GROUP BY 1,2,3,4,5
 ORDER BY columnas DESC, c.udt_name;
-- 40 filas; la suma de "columnas" es 685
```

Conteo de filas exacto, en una sola consulta (con `query_to_xml`, porque no hay
`COUNT(*)` genérico en PostgreSQL):

```sql
SELECT sum((xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I',
                                  n.nspname, c.relname),
                           false, true, '')))[1]::text::bigint) AS filas
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p')
   AND n.nspname IN ('agent','audit','core','ind','kag','policy',
                     'staging','qda','ref');
-- 8428
```

---

## 2. Mapa de tipos completo (40 combinaciones)

Leyenda de la columna **Ajuste**: _No_ = SSMA lo traduce solo; _Sí_ = hay que
fijarlo a mano en **Project Settings → Type Mapping** antes de generar el DDL;
_Revisar_ = SSMA lo traduce, pero la semántica no es idéntica.

|   # | Tipo origen (`udt_name`)  | Largo / prec.,esc. | Cols. | Tablas | Tipo destino en SQL Server                  | Ajuste  | Observación para el equipo .NET                                                                                                                                                                                                                                    |
| --: | ------------------------- | ------------------ | ----: | -----: | ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | `uuid`                    | —                  |   124 |     42 | `UNIQUEIDENTIFIER`                          | Sí      | `Guid`. 28 tenían `DEFAULT gen_random_uuid()` y el paso 3 se lo retiró: en SQL Server van con `DEFAULT NEWSEQUENTIALID()` (§3.1). Las otras 96 **no** llevan `DEFAULT`: las genera la API o heredan la clave de otra tabla; ponerles `NEWID()` rompe esa herencia. |
|   2 | `int2` (`smallint`)       | —                  |   102 |     58 | `SMALLINT`                                  | No      | `short`. No mapear a `TINYINT`: es 0..255 y perdería el rango negativo y el límite 32 767. Una es `IDENTITY` (`policy.titular.id`).                                                                                                                                |
|   3 | `timestamptz`             | —                  |    49 |     30 | `DATETIMEOFFSET(7)`                         | Sí      | `DateTimeOffset`, no `DateTime`. 38 tienen `DEFAULT now()` → `DEFAULT SYSDATETIMEOFFSET()`. Si no se fija el mapeo, SSMA las pasa a `DATETIME2` y la zona desaparece sin aviso.                                                                                    |
|   4 | `int4` (`integer`)        | —                  |    39 |     20 | `INT`                                       | No      | `int`. 8 son `serial` (§3.6) → `INT IDENTITY(1,1)`.                                                                                                                                                                                                                |
|   5 | `text`                    | —                  |    43 |     25 | `NVARCHAR(MAX)`                             | Sí      | `string`. Sin longitud: no truncará, pero no se puede indexar la columna entera (usar columna calculada o índice de prefijo).                                                                                                                                      |
|   6 | `varchar`                 | 20                 |    34 |     28 | `NVARCHAR(20)`                              | Sí      | Longitud en caracteres, igual que en origen. Incluye `ref.base_legal_evidencia.rol`, `core.cat_unidades_organicas.estado` y `core.entidades.estado`.                                                                                                               |
|   7 | `date`                    | —                  |    33 |     18 | `DATE`                                      | No      | `DateOnly` (o `DateTime` a medianoche). No convertir a `DATETIME`.                                                                                                                                                                                                 |
|   8 | `varchar`                 | 50                 |    34 |     23 | `NVARCHAR(50)`                              | Sí      | Idem (nombres y códigos de catálogo).                                                                                                                                                                                                                              |
|   9 | `bool`                    | —                  |    30 |     19 | `BIT`                                       | No      | `bool`. Traducir `true/false` a `1/0` en el DDL, en los `DEFAULT` y en las pruebas.                                                                                                                                                                                |
|  10 | `varchar`                 | 500                |    19 |     15 | `NVARCHAR(500)`                             | Sí      | URLs, rutas y enlaces (`foto_url`, `url_pdf`, `link_evidencia`, `fuente_url`, `archivo_uri`).                                                                                                                                                                      |
|  11 | `varchar`                 | 30                 |    18 |     15 | `NVARCHAR(30)`                              | Sí      | Incluye `core.roles.codigo`, `agent.run_log.rol` y `policy.snapshot.rol`: son la llave del contrato de seguridad (§7); no cambiar su contenido.                                                                                                                    |
|  12 | `varchar`                 | 255                |    17 |     12 | `NVARCHAR(255)`                             | Sí      | Rutas, correos y nombres de archivo.                                                                                                                                                                                                                               |
|  13 | `jsonb`                   | —                  |    13 |     12 | `NVARCHAR(MAX)` + `CHECK (ISJSON(col) = 1)` | Sí      | `string` JSON (`System.Text.Json`). 4 con `DEFAULT '{}'::jsonb` → `DEFAULT N'{}'`. Consultar con `JSON_VALUE`/`OPENJSON`. `jsonb` no conserva orden de claves ni duplicados: no depender de ellos.                                                                 |
|  14 | `varchar`                 | 40                 |    14 |     13 | `NVARCHAR(40)`                              | Sí      | Incluye `qda.mapeo_pseudonimo.token` (seudónimo, **no** el identificador real) y `core.documentos.estado`.                                                                                                                                                         |
|  15 | `varchar`                 | 60                 |    11 |     11 | `NVARCHAR(60)`                              | Sí      | Códigos y nombres cortos (`codigo_compromiso`, `documentos.codigo`, `kag.documento_fuente.tipo`).                                                                                                                                                                  |
|  16 | `varchar`                 | 100                |    14 |     11 | `NVARCHAR(100)`                             | Sí      | Nombres de región, provincia y distrito: son la clave del emparejamiento geográfico.                                                                                                                                                                               |
|  17 | `numeric`                 | 3,2                |    10 |      9 | `DECIMAL(3,2)`                              | No      | `decimal`. `confidence`/`confianza` (0,00 a 9,99).                                                                                                                                                                                                                 |
|  18 | `varchar`                 | 12                 |     8 |      8 | `NVARCHAR(12)`                              | Sí      | Códigos y estados. Incluye `dni` (12) y `staging.lote.estado`, que tiene `CHECK` de lista cerrada.                                                                                                                                                                 |
|  19 | `bpchar` (`char(n)`)      | 64                 |     8 |      6 | `CHAR(64)`                                  | Revisar | Hashes hexadecimales. `CHAR` rellena con espacios y compara ignorando blancos finales (igual que `bpchar`); en .NET llega con o sin relleno según el driver → `.Trim()` al comparar.                                                                               |
|  20 | `varchar`                 | 10                 |     7 |      7 | `NVARCHAR(10)`                              | Sí      | `ind.resultado.periodo`, `core.log_accesos.resultado`, `qda.proyecto.estado`.                                                                                                                                                                                      |
|  21 | `varchar`                 | 80                 |     7 |      7 | `NVARCHAR(80)`                              | Sí      | Nombres de catálogo y cargos.                                                                                                                                                                                                                                      |
|  22 | `varchar`                 | 200                |     9 |      7 | `NVARCHAR(200)`                             | Sí      | Títulos y nombres largos (`policy.regla.titulo`, `qda.proyecto.nombre`, `ref.base_legal_tratamiento.norma`).                                                                                                                                                       |
|  23 | `varchar`                 | 120                |     6 |      6 | `NVARCHAR(120)`                             | Sí      | Nombres de tipos de documento y de gobierno.                                                                                                                                                                                                                       |
|  24 | `bytea`                   | —                  |     5 |      2 | `VARBINARY(MAX)`                            | Sí      | `byte[]`. Cuatro son PII cifrada (`dni_cifrado`, `dni_hmac`, `email_cifrado`, `telefono_cifrado`) y la quinta es `core.consulta_reniec.resultado_cifrado`: ninguna debe pasar nunca por `string` ni por `NVARCHAR`.                                                |
|  25 | `varchar`                 | 150                |     4 |      3 | `NVARCHAR(150)`                             | Sí      | `core.actores.abreviatura`/`cargo_actual`, `core.usuarios.cargo`.                                                                                                                                                                                                  |
|  26 | `varchar`                 | 15                 |     4 |      4 | `NVARCHAR(15)`                              | Sí      | `nivel_gobierno` y `core.entidades.nivel`.                                                                                                                                                                                                                         |
|  27 | `varchar`                 | 25                 |     4 |      3 | `NVARCHAR(25)`                              | Sí      | `policy.regla.alcance`/`tipo_fuente` e `ind.indicador.componente_guia`.                                                                                                                                                                                            |
|  28 | `int8` (`bigint`)         | —                  |     2 |      2 | `BIGINT`                                    | No      | `long`. Ambas son `IDENTITY` (`audit.datos_personales_acceso.id`, `core.log_accesos.id`).                                                                                                                                                                          |
|  29 | `numeric`                 | 5,2                |     2 |      2 | `DECIMAL(5,2)`                              | No      | `decimal`; porcentajes 0,00 a 999,99 (`core.casos.pct_avance`, `ind.resultado.cobertura_pct`).                                                                                                                                                                     |
|  30 | `numeric`                 | 10,7               |     2 |      1 | `DECIMAL(10,7)`                             | No      | `decimal`; `latitud`/`longitud` (7 decimales ≈ 1 cm).                                                                                                                                                                                                              |
|  31 | `numeric` (sin precisión) | —                  |     2 |      1 | `DECIMAL(28,10)`                            | Sí      | `ind.resultado.valor` y `.denominador` (0 filas hoy). Ver §3.5: 28 dígitos porque `System.Decimal` topa en 28–29.                                                                                                                                                  |
|  32 | `varchar`                 | 160                |     2 |      2 | `NVARCHAR(160)`                             | Sí      | `policy.escenario.nombre`, `policy.titular.persona`.                                                                                                                                                                                                               |
|  33 | `bpchar` (`char(n)`)      | 1                  |     1 |      1 | `CHAR(1)`                                   | Revisar | `policy.regla.clase`: una sola letra. Es columna de texto, no un `BIT`.                                                                                                                                                                                            |
|  34 | `bpchar` (`char(n)`)      | 2                  |     1 |      1 | `CHAR(2)`                                   | Revisar | `core.regiones.ubigeo`.                                                                                                                                                                                                                                            |
|  35 | `bpchar` (`char(n)`)      | 4                  |     1 |      1 | `CHAR(4)`                                   | Revisar | `core.provincias.ubigeo`.                                                                                                                                                                                                                                          |
|  36 | `bpchar` (`char(n)`)      | 6                  |     1 |      1 | `CHAR(6)`                                   | Revisar | `core.distritos.ubigeo`: clave de emparejamiento con `legacy.dim_distritos`. Debe conservar el relleno para que el join no cambie.                                                                                                                                 |
|  37 | `bpchar` (`char(n)`)      | 11                 |     1 |      1 | `CHAR(11)`                                  | Revisar | `core.organizaciones.ruc`; su índice único es filtrado (§6.4) y tiene 219 `NULL`.                                                                                                                                                                                  |
|  38 | `numeric`                 | 6,1                |     1 |      1 | `DECIMAL(6,1)`                              | No      | `decimal`; `ind.variante.horas_estimadas`.                                                                                                                                                                                                                         |
|  39 | `varchar`                 | 5                  |     2 |      2 | `NVARCHAR(5)`                               | Sí      | `ind.resultado.incertidumbre`: texto corto, **no** numérico.                                                                                                                                                                                                       |
|  40 | `varchar`                 | 70                 |     1 |      1 | `NVARCHAR(70)`                              | Sí      | `core.hitos_compromiso.codigo_hito`.                                                                                                                                                                                                                               |

**Total: 685 columnas en 40 combinaciones distintas.** La suma de la columna
«Cols.» es 685 y el número de filas es 40; ambas coinciden con `count(*)` sobre
las 78 tablas y con las combinaciones del catálogo.

### Por qué `NVARCHAR` y no `VARCHAR`

1. `varchar(n)` en SQL Server mide **bytes**, salvo en colaciones UTF-8, donde
   también mide bytes: `varchar(50)` con acentos admite menos de 50 caracteres.
   `NVARCHAR(n)` mide caracteres, que es lo que declara PostgreSQL.
2. La base de origen es `C.UTF-8` y guarda español real: 474 de 1 160 nombres de
   actores llevan tilde, 109 de 224 organizaciones también, 17 de 698 distritos
   llevan `ñ` o tilde, y 1 de las 25 regiones (`San Martín`).
3. El coste es el doble de bytes en texto, irrelevante con ≈1 GB/año (§3.17.1 del
   `AVISA_PRODUCE_v10.md`).

---

## 3. Notas de los tipos delicados

### 3.1 · `uuid` (124 columnas, 42 tablas)

- Destino: `UNIQUEIDENTIFIER`. En .NET, `Guid`.
- **28 columnas tenían `DEFAULT gen_random_uuid()` y hoy no tienen `DEFAULT`**
  (el paso 3 se lo retiró a propósito). En SQL Server deben recuperarlo como
  `DEFAULT NEWSEQUENTIALID()`. Todas son `id` salvo `core.actores.actor_uid`:

| Tabla                        | Columna     | Filas |
| ---------------------------- | ----------- | ----: |
| `agent.run_log`              | `id`        |     0 |
| `core.actor_alias`           | `id`        |   143 |
| `core.actor_membresia`       | `id`        |   292 |
| `core.actores`               | `actor_uid` | 1 160 |
| `core.alertas_tempranas`     | `id`        |    83 |
| `core.caso_cronologia`       | `id`        |    80 |
| `core.caso_estado_historial` | `id`        |    35 |
| `core.casos`                 | `id`        |    35 |
| `core.compromisos`           | `id`        |     8 |
| `core.consulta_reniec`       | `id`        |     0 |
| `core.documentos`            | `id`        |   153 |
| `core.hitos_compromiso`      | `id`        |    12 |
| `core.integraciones`         | `id`        |    20 |
| `core.mesas_dialogo`         | `id`        |    21 |
| `core.output_contracts`      | `id`        |     0 |
| `core.permiso_aprobacion`    | `id`        |     0 |
| `core.reuniones_dialogo`     | `id`        |     0 |
| `core.usuarios`              | `id`        |    32 |
| `ind.indicador`              | `id`        |     0 |
| `ind.resultado`              | `id`        |     0 |
| `ind.variante`               | `id`        |     0 |
| `kag.documento_fragmento`    | `id`        |     0 |
| `kag.documento_fuente`       | `id`        |    10 |
| `policy.escenario`           | `id`        |     0 |
| `policy.regla`               | `id`        |    10 |
| `policy.snapshot`            | `id`        |     0 |
| `qda.proyecto`               | `id`        |     0 |
| `staging.lote`               | `id`        |     0 |

- Las **96 restantes** no llevan `DEFAULT`: unas las genera la API, otras heredan
  la clave de otra tabla (`core.organizaciones.actor_uid`,
  `core.actor_datos_personales.actor_uid`, `core.reunion_participantes.actor_uid`,
  `kag.documento_fragmento.documento_id`…). Si SSMA les pone `NEWID()`, se rompe
  la herencia y aparecen huérfanos.
- `NEWSEQUENTIALID()` **solo** funciona como valor por defecto; no se puede
  invocar en una consulta. Si la API necesita generar el id antes de insertar,
  `Guid.NewGuid()` (aleatorio).
- `agent.run_log` tiene clave primaria **compuesta** `(id, ts)`: el `DEFAULT` va
  solo en `id`.

### 3.2 · `jsonb` (13 columnas, 12 tablas)

| Tabla.Columna                                    | Filas | Nulable                 |
| ------------------------------------------------ | ----: | ----------------------- |
| `agent.run_log.detalle`                          |     0 | sí                      |
| `audit.datos_personales_acceso.contexto`         | 3 088 | **no** (`DEFAULT '{}'`) |
| `core.alertas_tempranas.acciones_sugeridas_json` |    83 | sí                      |
| `core.alertas_tempranas.riesgos_json`            |    83 | sí                      |
| `core.cat_tipos_documento.esquema_json`          |    15 | sí                      |
| `core.compromisos.criterios_smart`               |     8 | sí                      |
| `core.documentos.contenido_json`                 |   153 | **no** (`DEFAULT '{}'`) |
| `core.integraciones.metadata_json`               |    20 | sí                      |
| `core.output_contracts.response_json`            |     0 | sí                      |
| `ind.variante.especificacion`                    |     0 | **no** (`DEFAULT '{}'`) |
| `policy.cat_tipos_regla.esquema_json`            |     5 | sí                      |
| `policy.regla.parametros`                        |    10 | **no** (`DEFAULT '{}'`) |
| `staging.lote.validacion`                        |     0 | sí                      |

- Destino `NVARCHAR(MAX)` con `CHECK (ISJSON(col) = 1)` (el chequeo está en
  `04_chequeos_postmigracion.sql`, §2).
- **Cubierto en el script 04:** su §2 comprueba las 13 columnas `jsonb` del
  alcance y crea 13 `CHECK` sobre 12 tablas, `core.integraciones.metadata_json`
  incluida. La comprobación previa de §2.1 debe dar 0 filas en cada columna.
- Un `CHECK` con expresión `UNKNOWN` (columna `NULL`) se acepta: el `NULL` pasa,
  que es lo que corresponde a las 9 columnas nulables.
- `jsonb` no conserva el orden de las claves ni los duplicados, y normaliza
  números. Si el contrato con la API depende del texto exacto, hay que guardar
  además la cadena original o aceptar la normalización.
- No hay GIN: si se filtra por una clave concreta, crear columna calculada
  `PERSISTED` + índice, o usar una tabla hija.
- `'{}'::jsonb` como `DEFAULT` → `DEFAULT N'{}'` (sin `::jsonb`).
- La antigua `policy.cat_tipos_regla.claves_requeridas` era la única columna
  array del alcance (las otras 3 de la base quedan fuera y las retira el paso 1);
  el paso 3 la convirtió con `array_to_json()` y hoy es `text`
  (43 columnas `text`, §3.3). No queda ninguna columna array en el alcance.

### 3.3 · `text` (43 columnas, 25 tablas)

Destino `NVARCHAR(MAX)`. No se puede poner índice sobre la columna completa
(límite de 1 700 bytes de clave en SQL Server): si hace falta, índice sobre
prefijo o columna calculada con `HASHBYTES`. Afecta a `core.usuarios.clave_hash`,
los tres campos de `audit.datos_personales_acceso` (`usuario`, `operacion`,
`motivo`), los textos largos de caso y alerta (`casos.resumen_ejecutivo`,
`casos.motivo_cierre`, `alertas_tempranas.hechos_recientes`), `policy.regla.texto`
y `kag.documento_fragmento.texto` —este último es el que más crece.

### 3.4 · `bytea` (5 columnas, 2 tablas)

`core.actor_datos_personales.{dni_cifrado, dni_hmac, email_cifrado,
telefono_cifrado}` → `VARBINARY(MAX)`. Se suma
`core.consulta_reniec.resultado_cifrado` (respuesta de la consulta RENIEC,
cifrada). En .NET, `byte[]`. La única función de
origen que usa `pgcrypto` es `core.actor_datos_personales_descifrar(...)`: en
SQL Server **no** se reconstruye con T-SQL; el descifrado pasa a la API
(Data Protection / Always Encrypted) y queda registrado en
`audit.datos_personales_acceso`.

La vista `core.v_actor_datos_personales_seguro` repite esas 4 columnas `bytea`,
pero no se migra como tabla.

### 3.5 · `numeric` sin precisión (2 columnas, 1 tabla)

`ind.resultado.valor` y `ind.resultado.denominador`. `numeric` sin precisión en
PostgreSQL es de precisión arbitraria; en SQL Server hay que elegir.
Recomendación: `DECIMAL(28,10)`.

- 28 dígitos significativos: `System.Decimal` de .NET admite 28–29; un
  `DECIMAL(38,10)` puede devolver valores que .NET no puede leer sin overflow.
- 10 decimales cubren los KPI (porcentajes y ratios).
- La tabla tiene **0 filas** hoy: no se pierde ningún dato con esta decisión.
  Si el negocio fija otro rango, hay que cambiarlo aquí y en el modelo de
  datos de la API (el script `04_...sql` no comprueba decimales).

### 3.6 · `serial` e `IDENTITY`

| Tabla.Columna                      | Tipo origen | Mecanismo origen     |        `MAX(id)` medido | Destino                  |
| ---------------------------------- | ----------- | -------------------- | ----------------------: | ------------------------ |
| `core.cat_roles_actor.id`          | `integer`   | `serial` (`nextval`) |                       7 | `INT IDENTITY(1,1)`      |
| `core.cat_subsectores.id`          | `integer`   | `serial` (`nextval`) |                       3 | `INT IDENTITY(1,1)`      |
| `core.cat_tematicas.id`            | `integer`   | `serial` (`nextval`) |                       7 | `INT IDENTITY(1,1)`      |
| `core.cat_tipos_actor.id`          | `integer`   | `serial` (`nextval`) |                       7 | `INT IDENTITY(1,1)`      |
| `core.cat_unidades_organicas.id`   | `integer`   | `serial` (`nextval`) |                      66 | `INT IDENTITY(1,1)`      |
| `core.distritos.id`                | `integer`   | `serial` (`nextval`) |                     698 | `INT IDENTITY(1,1)`      |
| `core.provincias.id`               | `integer`   | `serial` (`nextval`) |                      70 | `INT IDENTITY(1,1)`      |
| `core.regiones.id`                 | `integer`   | `serial` (`nextval`) |                      25 | `INT IDENTITY(1,1)`      |
| `policy.titular.id`                | `smallint`  | `IDENTITY`           |             — (0 filas) | `SMALLINT IDENTITY(1,1)` |
| `core.log_accesos.id`              | `bigint`    | `IDENTITY`           |                     857 | `BIGINT IDENTITY(1,1)`   |
| `audit.datos_personales_acceso.id` | `bigint`    | `IDENTITY`           | **3 089** (3 088 filas) | `BIGINT IDENTITY(1,1)`   |

Atención al último: hay un **hueco de un valor** (3 089 con 3 088 filas). Si se
migra con `IDENTITY_INSERT` y no se reajusta la semilla, el siguiente alta
choca con la clave. El reajuste y su verificación están en
`04_chequeos_postmigracion.sql` (§1.3).

### 3.7 · Fechas: `timestamptz` (49 columnas, 30 tablas)

Destino `DATETIMEOFFSET(7)`. En .NET, `DateTimeOffset`. **38 de las 49** tienen
`DEFAULT now()`, que pasa a `DEFAULT SYSDATETIMEOFFSET()`.

El `AVISA_PRODUCE_v10.md` §3.17.2.v10 admite dos variantes: `DATETIME2` en UTC
o `DATETIMEOFFSET`. Aquí se recomienda **`DATETIMEOFFSET`** porque el origen
guarda el instante **con** desplazamiento y la conversión a UTC es una decisión
de negocio que no debe tomarse de forma implícita en la migración. Si OGTI exige
`DATETIME2`, la migración debe convertir a UTC de forma explícita y la API debe
tratar todo `DateTime` como UTC (`Kind = Utc`); en ese caso el chequeo de §4 de
`04_...sql` debe configurarse para aceptar `datetime2` **solo** si se documenta
la conversión.

`timestamp without time zone`: **0 columnas**. No hay nada que "arreglar" por
ese lado, pero sí hay que evitar que SSMA convierta las 49 a `datetime2` por
defecto (es el error clásico: la zona desaparece sin aviso).

---

## 4. Colación recomendada

**Recomendación: `Modern_Spanish_100_CI_AS_SC`** como colación de la base
destino (`CREATE DATABASE ... COLLATE Modern_Spanish_100_CI_AS_SC`).

Fallbacks: `Modern_Spanish_100_CI_AS` si el servidor es anterior a 2012 (sin
`_SC`). Si OGTI confirma SQL Server 2019+ y se decide guardar texto en `VARCHAR`
en lugar de `NVARCHAR`, la variante sería `Modern_Spanish_100_CI_AS_SC_UTF8`,
con la advertencia de §2 sobre longitudes en bytes.

Desglose y por qué:

| Elemento         | Qué significa                                                                | Por qué se elige                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modern_Spanish` | Reglas de ordenación del español moderno (`ch` y `ll` como letras separadas) | Es el orden que espera un usuario peruano; `Traditional_Spanish` ordena distinto y ya no se recomienda.                                                                                                                                                                                                                                                                                                        |
| `CI`             | No distingue mayúsculas                                                      | Los datos llegan con mayúsculas inconsistentes: de 224 organizaciones, 166 no están todo en mayúsculas y hay un caso medido `AMPA PAITA` / `AMPA Paita`. También protege los códigos: `core.roles.codigo`, `cat_*.codigo`, `cat_*.nombre` son únicos y no deben poder duplicarse cambiando mayúsculas.                                                                                                         |
| `AS`             | **Distingue acentos**                                                        | En español la tilde cambia la palabra, y la base la usa como identidad: `core.distritos` guarda `Breña`, `Saña`, `Ferreñafe`, `Ica`… Si la colación fuera acento-insensible, `Saña` y `Sana`, `Peña` y `Pena` serían "iguales" para los índices únicos `distritos_provincia_id_nombre_key` y `cat_*_nombre_key`: se bloquearían altas legítimas o, peor, un proceso de deduplicación borraría una fila válida. |
| `_SC`            | Soporta caracteres suplementarios (fuera del plano básico)                   | El texto viene de WhatsApp y de documentos: puede traer emojis y alfabetos no latinos. Sin `_SC` esos caracteres se comparan como basura y ordenan mal.                                                                                                                                                                                                                                                        |

### El caso real: «San Martín»

Medido en `avisa_mssql` (antes `core.regiones` quedaba fuera del alcance; ahora
entra como padre por cierre de dependencias):

- `core.regiones` tiene 25 filas: **24 nombres sin tilde** y **`San Martín`**
  con tilde.
- En el alcance, `core.distritos` guarda **`San Martin de Porres`** (ubigeo
  `150135`) **sin** tilde, mientras la región homónima la lleva.
- Además, 17 de 698 distritos llevan `ñ` o tilde, 109 de 224 organizaciones y
  474 de 1 160 actores.

Es decir: el mismo nombre propio aparece con y sin tilde en el mismo sistema.
Consecuencias:

| Situación                        | Colación acento-sensible (`AS`)                                                                                 | Colación acento-insensible (`AI`)                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `WHERE nombre = N'San Martin'`   | Encuentra el distrito, **no** la región.                                                                        | Encuentra ambos.                                                                                            |
| `WHERE nombre LIKE N'San Mart%'` | **No** encuentra `San Martín`.                                                                                  | Encuentra ambos.                                                                                            |
| Índice único sobre `nombre`      | Dos grafías pueden coexistir (correcto: son filas distintas por error de captura, que hay que corregir a mano). | Las dos grafías colisionan: el índice **rechaza** la segunda alta, o la deduplicación decide por su cuenta. |
| Orden alfabético                 | `Peña` después de `Pena`.                                                                                       | Se mezclan.                                                                                                 |

### Conducta recomendada para el emparejamiento de actores y organizaciones

El dato medido justifica separar dos cosas:

- **Almacenamiento (`AS`)**: conserva la diferencia entre grafías. Medido en
  `core.actores.nombre_actual`: **31 grupos de nombre exactamente repetido**
  (64 filas implicadas, 33 sobrantes) y **10 grupos más de grafías distintas que
  sólo difieren en tilde o en mayúsculas** (21 filas, 11 sobrantes; en 9 la
  diferencia es de tildes y en 1 sólo de mayúsculas). El Resolver necesita ver
  esas diferencias para que una persona confirme la fusión: no puede hacerlo un
  `COLLATE` a escondidas.
- **Emparejamiento (`AI` explícito)**: para _generar candidatos_, buscar con
  `COLLATE Latin1_General_100_CI_AI_SC` en la consulta, o —mejor para el
  rendimiento— mantener una columna calculada `PERSISTED` con el nombre
  normalizado (sin tildes, en minúsculas) e indexarla. Así el `COLLATE` no
  aparece en cada consulta y el índice se usa.

Regla corta: **AI para buscar, AS para guardar y para los índices únicos.**

### Efecto sobre `LIKE` y sobre índices

- `LIKE` usa la colación de la columna. Con `CI`, `LIKE N'%san%'` encuentra
  `San`; con `AS`, `LIKE N'San Mart%'` **no** encuentra `San Martín`; con `AI`
  sí. Los comodines `_` y los rangos `[a-z]` cambian de comportamiento con
  colaciones `_SC` (un par sustituto cuenta como un carácter, no dos).
- Un patrón con comodín inicial (`'%texto%'`) **nunca** usa el índice, con
  cualquier colación. Un prefijo (`'texto%'`) sí puede hacer _seek_.
- Si se escribe `COLLATE ..._AI` en la consulta sobre una columna indexada con
  `AS`, el índice **no se puede usar** (conversión implícita) → recorrido
  completo. De ahí la columna normalizada persistida.
- La colación forma parte de la clave del índice: cambiarla cambia la unicidad
  y el orden. Crear un índice único sobre datos que colisionan **falla**; hay
  que corregir los datos antes.
- Comparar o unir dos columnas con colaciones distintas obliga a convertir
  (`CONVERT_IMPLICIT`) y pierde los _seeks_. Por eso: **todas las columnas de
  texto con la misma colación**, sin `COLLATE` a nivel de columna salvo que sea
  imprescindible y esté documentado.
- `tempdb` usa la colación del **servidor**: si la base se crea con otra
  colación, las tablas temporales y las variables de tabla necesitarán
  `COLLATE` en las comparaciones. Crear la base en un servidor con la misma
  colación evita el problema.

---

## 5. Palabras reservadas

Se buscaron estas 36 palabras contra los nombres de las **78 tablas** y de sus
**685 columnas**, y también contra las 87 tablas de `legacy`:

`user`, `order`, `group`, `level`, `status`, `key`, `plan`, `percent`, `public`,
`authorization`, `check`, `default`, `desc`, `file`, `line`, `print`, `rule`,
`schema`, `table`, `top`, `transaction`, `values`, `view`, `current`, `period`,
`identity`, `merge`, `text`, `value`, `date`, `time`, `row`, `range`, `system`,
`references`, `column`.

**Resultado medido: 0 coincidencias.** Ningún nombre de tabla ni de columna del
alcance es palabra reservada en SQL Server ni en PostgreSQL. Además, los 685
nombres de columna y los 78 de tabla cumplen `^[a-z_][a-z0-9_]*$` (0 no
conformes, 0 con tilde): no hay mayúsculas, espacios, tildes ni comillas que
escapar.

Consulta usada:

```sql
WITH reservadas(p) AS (
  VALUES ('user'),('order'),('group'),('level'),('status'),('key'),('plan'),
         ('percent'),('public'),('authorization'),('check'),('default'),
         ('desc'),('file'),('line'),('print'),('rule'),('schema'),('table'),
         ('top'),('transaction'),('values'),('view'),('current'),('period'),
         ('identity'),('merge'),('text'),('value'),('date'),('time'),('row'),
         ('range'),('system'),('references'),('column')
)
SELECT c.table_schema||'.'||c.table_name AS ubicacion,
       c.column_name AS nombre, c.data_type, r.p AS palabra
  FROM information_schema.columns c
  JOIN pg_class     k ON k.relname = c.table_name
  JOIN pg_namespace n ON n.oid = k.relnamespace AND n.nspname = c.table_schema
  JOIN reservadas   r ON lower(c.column_name) = r.p
 WHERE k.relkind IN ('r', 'p')
   AND c.table_schema NOT IN ('pg_catalog','information_schema');
-- 0 filas (la misma consulta sobre pg_class relname también da 0)
```

### Casi-coincidencias (existen, pero **no** son reservadas)

Están aquí porque son las que alguien podría "corregir" por error. Ninguna
necesita corchetes; SSMA las entrecomillará igualmente (ver abajo).

| Columna real                                                                                               | Tipo          | Se parece a | ¿Reservada?                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------- | ----------- | -------------------------------------------------- |
| `audit.datos_personales_acceso.usuario`                                                                    | `text`        | `user`      | No                                                 |
| `agent.run_log.rol`, `policy.snapshot.rol`                                                                 | `varchar(30)` | `role`      | No (no es reservada en ninguno de los dos motores) |
| `ref.base_legal_evidencia.rol`                                                                             | `varchar(20)` | `role`      | No                                                 |
| `core.cat_niveles_conflicto.orden`, `core.cat_niveles_riesgo.orden`, `core.cat_prioridades_atencion.orden` | `smallint`    | `order`     | No                                                 |
| `kag.documento_fragmento.orden`                                                                            | `integer`     | `order`     | No                                                 |
| `ind.resultado.periodo`                                                                                    | `varchar(10)` | `period`    | No                                                 |
| `core.cat_clasificacion.nivel`                                                                             | `smallint`    | `level`     | No                                                 |
| `core.entidades.nivel`                                                                                     | `varchar(15)` | `level`     | No                                                 |
| `staging.lote.estado`, `policy.regla.estado`, `ind.variante.estado`                                        | `varchar(12)` | `status`    | No                                                 |
| `core.documentos.estado`                                                                                   | `varchar(40)` | `status`    | No                                                 |
| `core.entidades.estado`, `core.cat_unidades_organicas.estado`                                              | `varchar(20)` | `status`    | No                                                 |
| `qda.proyecto.estado`                                                                                      | `varchar(10)` | `status`    | No                                                 |
| `core.usuarios.clave_hash`                                                                                 | `text`        | `key`       | No                                                 |
| `ind.resultado.valor`                                                                                      | `numeric`     | `value`     | No                                                 |
| `core.log_accesos.fecha`, `core.reuniones_dialogo.fecha`                                                   | `timestamptz` | `date`      | No                                                 |
| `core.documentos.fecha`                                                                                    | `date`        | `date`      | No                                                 |
| `qda.mapeo_pseudonimo.token`                                                                               | `varchar(40)` | —           | No                                                 |
| `policy.regla.clase`                                                                                       | `char(1)`     | `class`     | No                                                 |

### Qué hace SSMA y qué debe hacer .NET

- SSMA genera el DDL **entrecomillando todos los identificadores con corchetes**
  (`[core].[actores].[nombre_actual]`), aunque no haga falta. Es lo deseable:
  mantener esa opción activada evita sorpresas si mañana se agrega una columna
  llamada `order`.
- .NET: usar siempre nombres parametrizados y, si se escribe SQL crudo,
  `QUOTENAME()` o corchetes. Nunca concatenar identificadores sin comillas.
- No renombrar nada a `user`, `order`, `key`, `value`, `status`, `level`,
  `date`, `text`, `check`, `default`, `public`, `top`, `percent`, `identity`,
  `merge`, `file`, `line`, `row`, `range`, `system`, `schema`, `references`,
  `table`, `column`, `authorization`, `plan`, `current`, `period`, `time`.
- Nota para el equipo: en PostgreSQL `user` y `current_user` son palabras
  especiales; en SQL Server `user` también es una función. La columna
  `usuario` evita el problema en ambos.
- En vistas y consultas crudas conviene **alias explícito** en las columnas
  ambiguas (`estado_id` vs `estado`), no por reservadas, sino porque el
  `SELECT *` sobre tablas con 30+ columnas es frágil.

---

## 6. Lo que SSMA no migra y hay que reconstruir

Conteos medidos en el alcance. SSMA **sí** traduce tablas, claves primarias
(77), claves ajenas (169), `UNIQUE` (73), `CHECK` (85), índices simples y vistas
sencillas. Lo siguiente no viaja o viaja mal:

| Objeto de origen                                                          |                                                                                                      Cantidad medida | Qué pasa en SSMA                                                                                     | Alternativa en SQL Server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Políticas RLS (`CREATE POLICY`, 30 tablas con `FORCE ROW LEVEL SECURITY`) |                                                                                                    **198** políticas | No se migran. Sin RLS, la API vería todo: es la mayor pérdida de seguridad posible.                  | `CREATE SECURITY POLICY` + función de predicado en línea + `SESSION_CONTEXT`. Ver §7 y `04_...sql` §5.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Triggers                                                                  |                                                                                                  **30** en 16 tablas | No se traducen (son PL/pgSQL). Uno es _constraint trigger_ (`ind.variante.trg_proxy_justificacion`). | Triggers `AFTER`/`INSTEAD OF`. `BEFORE` → `AFTER` + validación; para auditoría (`trg_audit`, `set_audit`), `AFTER INSERT/UPDATE` o valores por defecto en columnas.                                                                                                                                                                                                                                                                                                                                                                                         |
| Funciones PL/pgSQL y SQL                                                  |                                                                                                 **56** en 8 esquemas | No se migran.                                                                                        | Reescribir en T-SQL como procedimientos o funciones; las de seguridad (`clasificacion_max`, `puede_*`, `rol_actual`) **desaparecen**: su papel lo asume `SESSION_CONTEXT`. `core.actor_datos_personales_descifrar` pasa a la API.                                                                                                                                                                                                                                                                                                                           |
| Vistas                                                                    | **3** en el alcance (`core.v_actor_datos_personales_seguro`, `ref.nivel_identificacion`, `ref.vw_base_legal_fuente`) | Las simples se traducen; las que usan `DISTINCT ON`, `FILTER`, `LATERAL` o arrays fallan.            | Reescribir como `CREATE VIEW`. Ojo: la vista segura no es la frontera de seguridad; lo es la RLS.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Índices parciales (`WHERE ...`)                                           |                                                                                       **10** (5 únicos, 5 no únicos) | No se traducen.                                                                                      | Índices **filtrados**. 8 de 10 son traducción directa; 2 usan `IN`/`NOT IN` (`ix_casos_activos`, `ix_hitos_por_vencer`), que un índice filtrado no admite → rediseñar. Ver §6.4 y `04_...sql` §6.                                                                                                                                                                                                                                                                                                                                                           |
| Índices únicos con columnas nulables                                      |                                                                                        **28** índices; **10 fallan** | SQL Server admite un solo `NULL` por índice único; PostgreSQL admite muchos.                         | Índice único **filtrado** `WHERE col IS NOT NULL`. Medido (nulos por columna): `organizaciones.ruc` 219, `cat_unidades_organicas.codigo_legado_unidad` 39, `caso_estado_historial.codigo_legado` 35 de 35, `usuarios.sso_subject` 32, `usuarios.email` 27, `usuarios.dni` 21, `compromisos.redefinido_de_id` 8, `cat_roles_actor.codigo_legado` 6, `cat_tipos_actor.codigo_legado` 4, `cat_tipos_organizacion.codigo_legado` 3. Los otros 18 hoy tienen 0 `NULL`, pero también se filtran: si no, el segundo `NULL` fallaría (en origen se admiten varios). |
| Comentarios (`COMMENT ON`)                                                |                                                                    **757** en `avisa` (78 de tabla + 679 de columna) | No se migran.                                                                                        | `sp_addextendedproperty` (y `fn_listextendedproperty` para leerlos). Es documentación de la PII y de la clasificación: no es opcional. Diferencia medida: `agent.run_log` tiene comentario de tabla en `avisa` pero lo perdió al aplanarse en el paso 1.                                                                                                                                                                                                                                                                                                    |
| Extensiones                                                               |                                           **6**: `btree_gist`, `pg_trgm`, `pgcrypto`, `plpgsql`, `postgis`, `vector` | No existen en SQL Server.                                                                            | `pgcrypto` → cifrado en la API o Always Encrypted; `pg_trgm` → similitud en el servicio Python (v10 §3.17.2.v10); `postgis`/`vector` → no se usan en el alcance (0 columnas de geometría y 0 `vector`); `btree_gist` → no hay restricciones `EXCLUDE` en el alcance (0).                                                                                                                                                                                                                                                                                    |
| Secuencias (`serial` + `IDENTITY`)                                        |                                                                                                            **8 + 3** | Se convierten en secuencia + `DEFAULT nextval` o se pierden.                                         | `IDENTITY` (recomendado) o `SEQUENCE` + `NEXT VALUE FOR`. Ver §3.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Privilegios y roles de PostgreSQL (`GRANT`, `avisa_app`)                  |                                                                                                                    — | No viajan.                                                                                           | Usuarios/roles de base de datos y `GRANT`/`DENY`. El login de la API **no** debe ser `db_owner`.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### 6.1 · RLS

30 tablas con `relrowsecurity = true` **y** `relforcerowsecurity = true`
(hasta el dueño queda sujeto a las políticas):

`audit.datos_personales_acceso`; en `core`,
`actor_alias`, `actor_datos_personales`, `actor_membresia`, `actores`,
`alertas_actores`, `alertas_tempranas`, `banco_datos_tratamiento`, `caso_cronologia`,
`caso_estado_historial`, `casos`, `casos_actores`, `compromiso_colaboradores`,
`compromisos`, `consulta_reniec`, `cronologia_vinculos`, `documentos`,
`hitos_compromiso`, `log_accesos`, `mesas_dialogo`, `organizaciones`,
`output_contracts`, `reunion_participantes` y `reuniones_dialogo`; en `kag`,
`documento_fragmento` y `documento_fuente`; `policy.regla`;
`qda.mapeo_pseudonimo` y `qda.proyecto`; y `staging.lote`.

Reparto de las 198 políticas: 24 tablas × 7 políticas (3 permisivas de
clasificación + 4 restrictivas de rol/capacidad) = 168,
`core.hitos_compromiso` y `core.output_contracts` con 8 cada una = 16,
`core.log_accesos` con 6, `staging.lote` con 4 (solo clasificación, **sin**
capacidades), `audit.datos_personales_acceso` con 2 (lectura por `puede_auditar`,
alta siempre permitida) y `core.consulta_reniec` con 2 (inmutable: lectura y alta).
`audit.datos_personales_acceso` es la única tabla con RLS
que **no** tiene columna `nivel_clasificacion`: su política no filtra por nivel.

El parche 16 (bloque B.11) completó la cobertura de `core`: las 20 tablas del
alcance con `nivel_clasificacion` tienen RLS, incluidas `core.hitos_compromiso`,
`core.log_accesos`, `core.mesas_dialogo` y `core.output_contracts` (`log_accesos`
con nivel 3 por defecto), que eran las cuatro que quedaban sin filtro.

### 6.2 · Triggers (30, en 16 tablas)

| Tabla                                                                                                                           | Triggers                                                                                                                  | Comportamiento                                             | Equivalente                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit.datos_personales_acceso`                                                                                                 | `tg_append_only_row`, `tg_append_only_stmt`, `tg_append_only_truncate`                                                    | Rechaza `DELETE`/`UPDATE`/`TRUNCATE` (bitácora inmutable)  | `DENY UPDATE, DELETE` al login de la API + trigger `INSTEAD OF` si se quiere mensaje claro. `TRUNCATE` se controla con permisos (`DENY ALTER`). |
| `core.actor_datos_personales`                                                                                                   | `tg_audit_datos_personales`, `trg_pii_solo_identificados`                                                                 | Audita la PII y solo la permite de actores identificados   | `AFTER INSERT, UPDATE, DELETE` que inserta en la bitácora; y `AFTER INSERT, UPDATE` + `THROW`, o `CHECK` si la condición es de la misma fila.   |
| `core.actores`                                                                                                                  | `trg_actor_nace`, `trg_actor_renombra`, `trg_audit`                                                                       | Nace, registra renombres y rellena auditoría               | `AFTER INSERT` / `AFTER UPDATE` + `DEFAULT` en las columnas de auditoría.                                                                       |
| `core.alertas_tempranas`, `core.caso_cronologia`, `core.casos`, `core.compromisos`, `core.documentos`, `core.reuniones_dialogo` | `trg_audit`                                                                                                               | Rellena `created_by`/`updated_by` y fechas                 | `DEFAULT` en las columnas + `AFTER` trigger; el `user_id` llega por `SESSION_CONTEXT` (§7).                                                     |
| `core.casos`                                                                                                                    | `trg_caso_historial`, `trg_caso_nace`, `trg_caso_renombra`                                                                | Historial de estado y alta del caso                        | Trigger `AFTER INSERT, UPDATE`.                                                                                                                 |
| `core.alertas_tempranas`                                                                                                        | `trg_alerta_nace`                                                                                                         | Nace con su actor/estado                                   | Trigger `AFTER INSERT`.                                                                                                                         |
| `core.actor_membresia`, `core.casos_actores`                                                                                    | `trg_membresia_nace`, `trg_caso_actor_nace`                                                                               | Alta de vínculos actor↔organización y actor↔caso           | Trigger `AFTER INSERT`.                                                                                                                         |
| `core.cat_niveles_conflicto`                                                                                                    | `trg_bloquear_niveles_conflicto`                                                                                          | Bloquea escritura directa del catálogo                     | `DENY INSERT, UPDATE, DELETE` al login de la API (mejor que un trigger).                                                                        |
| `core.compromisos`                                                                                                              | `trg_chk_compromiso`                                                                                                      | Valida campos obligatorios del compromiso                  | `CHECK` + trigger `AFTER` si hay reglas entre filas.                                                                                            |
| `policy.regla`                                                                                                                  | `trg_chk_regla`, `trg_aviso_vencimiento`                                                                                  | Valida la regla y avisa de su vencimiento                  | `CHECK` + `AFTER INSERT, UPDATE` o un trabajo programado para el aviso.                                                                         |
| `ind.variante`                                                                                                                  | `trg_proxy_justificacion`                                                                                                 | _Constraint trigger_ (se difiere al fin de la transacción) | No tiene equivalente directo: validar en la API o con `AFTER` + `THROW`.                                                                        |
| `core.consulta_reniec`                                                                                                          | `tg_consulta_reniec_auditar`, `tg_reniec_append_only_row`, `tg_reniec_append_only_stmt`, `tg_reniec_append_only_truncate` | Audita la consulta y la vuelve inmutable                   | `AFTER INSERT` para la auditoría + `DENY UPDATE, DELETE` al login de la API; igual que la bitácora de PII.                                      |
| `agent.run_log`                                                                                                                 | `trg_runlog_guard`                                                                                                        | Guarda la escritura del registro de ejecuciones            | `AFTER INSERT, UPDATE, DELETE` o `DENY UPDATE, DELETE` al login de la API, según la política.                                                   |

### 6.3 · Funciones (56)

Por esquema: `core` 26, `kag` 16, `policy` 6, `ind` 3, `qda` 2, `audit` 1,
`agent` 1, `staging` 1.

| Grupo                   | Funciones                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Destino                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Seguridad               | `core.rol_actual`, `clasificacion_max`, `puede_crear`, `puede_editar`, `puede_eliminar`, `puede_auditar`, `puede_consultar_reniec`, `usuario_actual`, `staff_bypass_subject_rls`                                                                                                                                                                                                                                                                                  | **No se reescriben como funciones de tabla**: el valor vive en `SESSION_CONTEXT` y lo fija la API (§7). |
| Auditoría / triggers    | `core.set_audit`, `caso_historial`, `tg_alerta_nace`, `tg_audit_datos_personales`, `tg_pii_solo_identificados`, `bloquear_escritura_directa`, `audit.tg_rechazar_mutacion`                                                                                                                                                                                                                                                                                        | Lógica dentro de los triggers T-SQL reconstruidos.                                                      |
| Validación / negocio    | `core.chk_compromiso`, `chk_outbox_aprobacion`, `sync_hito_estado`, `deriv_limite`, `icd_aplicar_ajuste`, `aplicar_cambio_normativo`, `revertir_cambio_normativo`, `ind.chk_brecha_capacidad`, `chk_sin_ciclo`, `exigir_justificacion`, `policy.chk_regla`, `policy.aviso_vencimiento`, `policy.vencer_reglas`, `policy.crear_snapshot`, `policy.contexto_activo`, `policy.reglas_activas`, `qda.chk_exportacion`, `qda.hereda_clasificacion`, `staging.promover` | Procedimientos/funciones T-SQL o lógica en la API, según dónde debe ejecutarse.                         |
| Utilidad de partición   | `core.crear_particion`                                                                                                                                                                                                                                                                                                                                                                                                                                            | No hace falta: `agent.run_log` ya se aplanó en el paso 1 y el particionado no es necesario en el MVP.   |
| Sin uso tras el recorte | Las 16 de `kag` (`actor_nace`, `actor_renombra`, `caso_nace`, `caso_renombra`, `caso_actor_nace`, `demanda_nace`, `demanda_actor_nace`, `membresia_nace`, `nodo_toca`, `nombre_cierra_previo`, `hereda_nivel_corrida`, `chk_hipotesis_en_salida`, `sync_nombre_actual`, `arista_asegura`, `nodo_asegura`, `subgrafo`) y `agent.run_log_guard`                                                                                                                     | Se quedaron sin trigger al eliminar las tablas de `kag` y al aplanar `agent.run_log`: **no se migran**. |

### 6.4 · Índices parciales (10)

| Índice de origen                                               | Definición                                                                              | Traducción                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.usuarios.ux_usuarios_dni` (único)                        | `(dni) WHERE dni IS NOT NULL`                                                           | `CREATE UNIQUE INDEX ux_usuarios_dni ON core.usuarios(dni) WHERE dni IS NOT NULL;` — **directa**.                                                                                                                          |
| `core.caso_estado_historial.ux_caso_historial_vigente` (único) | `(caso_id) WHERE hasta IS NULL`                                                         | `CREATE UNIQUE INDEX ... ON core.caso_estado_historial(caso_id) WHERE hasta IS NULL;` — directa.                                                                                                                           |
| `ind.resultado.ux_ind_resultado_vigente` (único)               | `(variante_id, distrito_id, periodo) WHERE superseded_at IS NULL`                       | Directa; `distrito_id` es nulable: solo puede existir **una** fila con `distrito_id NULL` por `(variante_id, periodo)`. Hoy hay 0 filas.                                                                                   |
| `policy.regla.ux_regla_codigo_vigente` (único)                 | `(codigo) WHERE superseded_at IS NULL`                                                  | Directa.                                                                                                                                                                                                                   |
| `core.entidades.entidades_codigo_legado_key` (único)           | `(codigo_legado) WHERE codigo_legado IS NOT NULL`                                       | Directa.                                                                                                                                                                                                                   |
| `core.actor_membresia.ix_membresia_org`                        | `(organizacion_uid) WHERE valid_to IS NULL`                                             | Directa.                                                                                                                                                                                                                   |
| `core.documentos.ix_documentos_reunion`                        | `(reunion_id) WHERE reunion_id IS NOT NULL`                                             | Directa.                                                                                                                                                                                                                   |
| `core.output_contracts.ix_output_chat_commit`                  | `(chat_commit_id) WHERE chat_commit_id IS NOT NULL`                                     | Directa.                                                                                                                                                                                                                   |
| `core.casos.ix_casos_activos`                                  | `(nivel_riesgo_id, fecha_ultima_actualizacion DESC) WHERE estado_id = ANY (ARRAY[1,2])` | **No directa**: el predicado de un índice filtrado no admite `IN`. Opciones: dos índices filtrados (`WHERE estado_id = 1` y `WHERE estado_id = 2`) o un índice plano `(nivel_riesgo_id, fecha_ultima_actualizacion DESC)`. |
| `core.hitos_compromiso.ix_hitos_por_vencer`                    | `(fecha_vencimiento) WHERE estado_id <> ALL (ARRAY[4,5])`                               | **No directa**: no admite `NOT IN`. Opciones: columna calculada persistida `es_vigente` + índice filtrado `WHERE es_vigente = 1`, o índice plano.                                                                          |

Nombres y comentarios completos en `04_chequeos_postmigracion.sql` §6.

**Los 28 índices únicos con columna nulable.** Medidos: 28 índices únicos no
primarios con al menos una columna nulable (27 de una columna y
`ux_ind_resultado_vigente` de tres). Diez tienen más de un `NULL` y fallarían tal
cual: `organizaciones.ruc` 219, `cat_unidades_organicas.codigo_legado_unidad` 39,
`caso_estado_historial.codigo_legado` 35 de 35, `usuarios.sso_subject` 32,
`usuarios.email` 27, `usuarios.dni` 21, `compromisos.redefinido_de_id` 8,
`cat_roles_actor.codigo_legado` 6, `cat_tipos_actor.codigo_legado` 4 y
`cat_tipos_organizacion.codigo_legado` 3. De los 28, tres ya eran parciales en
origen (`ux_usuarios_dni`, `ux_ind_resultado_vigente` y
`entidades_codigo_legado_key`); los otros dos parciales del alcance
(`ux_caso_historial_vigente`, sobre `caso_id`, y `ux_regla_codigo_vigente`, sobre
`codigo`) no entran en la cuenta porque esas columnas son `NOT NULL`. Los 18
restantes tienen **0 `NULL` hoy**, pero su columna es nulable: un índice único sin
filtro aceptaría un solo `NULL` y rechazaría el segundo, cosa que en PostgreSQL no
pasa. Por eso hay que filtrarlos también.

**Cobertura en el script 04:** su §6.2 crea los 25 únicos no parciales con
columna nulable (9 con `NULL` hoy y 16 sin), §6.3 traduce los 5 parciales y §6.4
los 3 parciales no únicos; §6.6 espera **33** índices filtrados. Fuera quedan sólo
los 2 cuyo predicado usa `IN` / `NOT IN` (§6.5), que van como índice plano.

### 6.5 · Comentarios

757 comentarios en `avisa` (78 de tabla + 679 de columna); 756 en el staging,
porque `agent.run_log` conserva el suyo. Incluyen la
clasificación de cada dato («interno», «sensible»), que es lo que permite auditar
la PII: 20 tablas del alcance tienen columna `nivel_clasificacion`. La única
tabla sin comentario de tabla es `agent.run_log`, que lo perdió al aplanarse en
el paso 1 (medido: en `avisa` sí lo tiene). Reconstruir con
`sp_addextendedproperty`; el script de origen ya los tiene
(`docs/PARCHE_12_COMENTARIOS_COLUMNAS.sql`), y
`migration/generar_comentarios_sql.py` los genera.

---

## 7. Contrato de seguridad para la API .NET

### 7.1 · Qué hay hoy en PostgreSQL (medido)

| Pieza                                | Definición real                                          | Qué aporta                                  |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| `core.rol_actual()`                  | `NULLIF(current_setting('app.rol_codigo', true), '')`    | Código de rol de la sesión.                 |
| `core.clasificacion_max()`           | `roles.max_clasificacion` del rol, o **0** si no hay rol | Nivel máximo de fila visible.               |
| `core.puede_crear/editar/eliminar()` | `roles.puede_*` del rol, o `false`                       | Capacidades de escritura.                   |
| `core.puede_auditar()`               | rol ∈ (`administrador`, `auditor`, `alta_direccion`)     | Lectura de la bitácora de PII.              |
| `core.puede_consultar_reniec()`      | `tiene_privilegio('consulta_reniec')`                    | Única puerta a `core.consulta_reniec`.      |
| `app.user_id`                        | uuid del usuario                                         | `created_by`/`updated_by` (tienen FK real). |
| `app.staff_bypass_subject_rls`       | booleano                                                 | Perfiles no acotados a un actor.            |

Los valores de `core.roles` (9 filas) son la única fuente de verdad:

| `codigo`               | `max_clasificacion` | crear | editar | eliminar |
| ---------------------- | ------------------: | ----- | ------ | -------- |
| `administrador`        |                   3 | sí    | sí     | sí       |
| `alta_direccion`       |                   3 | sí    | sí     | sí       |
| `analista_cualitativo` |                   3 | sí    | sí     | no       |
| `auditor`              |                   3 | sí    | sí     | no       |
| `consulta_lectura`     |                   2 | no    | no     | no       |
| `curador_politica`     |                   2 | sí    | sí     | no       |
| `externo_publico`      |                   1 | no    | no     | no       |
| `sectorista`           |                   3 | sí    | sí     | sí       |
| `servicio_agente`      |                   3 | sí    | sí     | no       |

Sin rol: `clasificacion_max() = 0` → **ninguna fila visible ni escribible**
(el silencio cierra, no abre). La misma regla debe valer para las 30 tablas con
RLS del §6.1, salvo `core.consulta_reniec`: su política de origen no mira el
nivel ni las capacidades, sólo el privilegio nominal RENIEC.

### 7.2 · Traducción a `SESSION_CONTEXT`

| Clave de sesión          | Tipo SQL Server    | Origen del valor                                   | Quién la fija       |
| ------------------------ | ------------------ | -------------------------------------------------- | ------------------- |
| `rol_codigo`             | `NVARCHAR(30)`     | claim del token ya validado                        | API                 |
| `nivel_clasificacion`    | `SMALLINT`         | `core.roles.max_clasificacion` del rol             | API (al autenticar) |
| `puede_crear`            | `BIT`              | `core.roles.puede_crear`                           | API                 |
| `puede_editar`           | `BIT`              | `core.roles.puede_editar`                          | API                 |
| `puede_eliminar`         | `BIT`              | `core.roles.puede_eliminar`                        | API                 |
| `puede_auditar`          | `BIT`              | rol ∈ (`administrador`,`auditor`,`alta_direccion`) | API                 |
| `puede_consultar_reniec` | `BIT`              | `core.tiene_privilegio('consulta_reniec')`         | API                 |
| `user_id`                | `UNIQUEIDENTIFIER` | claim `sub`                                        | API                 |
| `staff`                  | `BIT`              | perfil no acotado                                  | API                 |

Se fijan con:

```sql
EXEC sp_set_session_context @key = N'rol_codigo',           @value = N'sectorista', @read_only = 1;
EXEC sp_set_session_context @key = N'nivel_clasificacion',  @value = 3,             @read_only = 1;
EXEC sp_set_session_context @key = N'puede_crear',          @value = 1,             @read_only = 1;
EXEC sp_set_session_context @key = N'puede_editar',         @value = 1,             @read_only = 1;
EXEC sp_set_session_context @key = N'puede_eliminar',       @value = 1,             @read_only = 1;
EXEC sp_set_session_context @key = N'puede_auditar',        @value = 0,             @read_only = 1;
EXEC sp_set_session_context @key = N'puede_consultar_reniec', @value = 0,           @read_only = 1;
EXEC sp_set_session_context @key = N'user_id',              @value = @uid,          @read_only = 1;
EXEC sp_set_session_context @key = N'staff',                @value = 1,             @read_only = 1;
```

**El valor sale del token, nunca del cuerpo de la petición.** Concretamente:

1. La API valida la firma del token y la expiración.
2. Toma `rol_codigo` del claim, **no** de un campo del JSON del cliente. Un
   cliente que mande `"rol": "administrador"` en el cuerpo no cambia nada.
3. Comprueba que `rol_codigo` exista en `core.roles`; si no existe, rechaza la
   petición (no se fija contexto, y sin contexto no se ve nada).
4. Deriva `nivel_clasificacion` y las capacidades **de la fila de `core.roles`**,
   igual que hace `clasificacion_max()`. Nunca se acepta un nivel declarado por
   el cliente: ese fue el fallo que corrigió el parche 15.
5. Fija el contexto al abrir cada conexión (interceptor de EF Core /
   `DbConnection.StateChange`), antes de la primera consulta.

### 7.3 · Qué debe leer la función de predicado

Solo `SESSION_CONTEXT`, sin tocar tablas: es rápido y no puede entrar en
recursión con las propias políticas.

```sql
CREATE OR ALTER FUNCTION seg.fn_ver (@nivel SMALLINT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS SMALLINT);
```

Si la clave no está, `TRY_CAST` devuelve `NULL`, la comparación es `UNKNOWN` y
no se devuelve fila: **deniega**. Es el equivalente exacto de
`nivel_clasificacion <= clasificacion_max()` con `clasificacion_max() = 0`.

Las capacidades se leen igual:

```sql
CREATE OR ALTER FUNCTION seg.fn_insertar (@nivel SMALLINT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    SELECT 1 AS permitido
     WHERE TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS SMALLINT) >= 2
       AND @nivel <= TRY_CAST(SESSION_CONTEXT(N'nivel_clasificacion') AS SMALLINT)
       AND TRY_CAST(SESSION_CONTEXT(N'puede_crear') AS BIT) = 1;
```

`puede_crear = 0` tampoco pasa (0 no es `NULL`): la capacidad apagada cierra.
La política completa, tabla por tabla, con las pruebas de "sin contexto no se ve
nada", está en `04_chequeos_postmigracion.sql` §5.

### 7.4 · Cuatro advertencias que no se pueden omitir

1. **Pooling.** `@read_only = 1` impide reescribir la clave en esa sesión. Si
   una conexión del pool se reutiliza, hay que comprobar en la prueba T98 que
   el contexto del usuario anterior **no** sobrevive (`SELECT
SESSION_CONTEXT(N'rol_codigo')`). Si sobrevive, hay que fijar el contexto con
   `@read_only = 0` en cada _checkout_, limpiarlo al devolver la conexión, o
   desactivar el pooling. Un contexto filtrado al siguiente usuario es una fuga
   de datos entre usuarios, no un detalle de rendimiento.
2. **La política no protege del que puede cambiarla.** Las políticas se
   aplican también a `dbo` y a los miembros de `db_owner` (documentado en
   «Row-level security»); lo que sí ocurre es que quien tenga permisos de
   DDL sobre `seg.*` puede **desactivar o reescribir** la política, y el
   `sysadmin` de la instancia puede hacer lo mismo. El login de la API no
   debe ser `db_owner` ni `sysadmin`; el DDL de seguridad
   (`CREATE/ALTER SECURITY POLICY`) se audita y se restringe.
3. **La política es tan fuerte como su función.** Si alguien con permiso altera
   la función de predicado, la seguridad desaparece. Control de cambios sobre
   `seg.*`.
4. **Fallo silencioso.** Sin contexto, la consulta devuelve 0 filas y **no da
   error** (igual que en PostgreSQL). Un informe "vacío" puede ser un problema
   de contexto. Registrar en la API cuando el token no trae rol válido, y alertar.

---

## 8. Decisiones abiertas y errores encontrados

### Decisiones que necesitan confirmación

1. `DATETIMEOFFSET(7)` frente a `DATETIME2` en UTC (§3.7). Recomendado
   `DATETIMEOFFSET(7)`; si OGTI impone `DATETIME2`, documentar la conversión a
   UTC y ajustar el chequeo del script 04.
2. `NVARCHAR` en todas las columnas de texto (recomendado) frente a `VARCHAR`
   con colación `_SC_UTF8`.
3. `DECIMAL(28,10)` para las 2 columnas `numeric` sin precisión (§3.5), con la
   tabla vacía hoy.
4. `core.hitos_compromiso`, `core.log_accesos`, `core.mesas_dialogo` y
   `core.output_contracts` ya tienen RLS tras el parche 16 (§6.1). **Resuelto:**
   la política de SQL Server de `04_...sql` §5 ya cubre las 30 tablas del alcance
   con 143 predicados (13 tablas nuevas × 5 = 65, más las 14 anteriores × 5 = 70,
   más 5 de `core.actor_alias`, 2 de `core.consulta_reniec` y el único FILTER de
   `audit.datos_personales_acceso`). El bloque §5.5 lo prueba con un arnés de dos
   niveles; dio 30 tablas y 143 predicados.
5. `core.regiones` ya está en el alcance (padre por cierre de dependencias):
   hay que decidir si se corrigen las 24 grafías sin tilde antes de migrar, o si
   se migran tal cual y la corrección se hace después con el Resolver. Afecta a
   los índices únicos de `core.regiones` y al emparejamiento con `core.distritos`.

### Errores de SQL que aparecieron durante la medición

Se documentan literalmente porque el encargo los pide:

1. `ERROR: recursive query "cl" column 1 has collation "default" in non-recursive
term but collation "C" overall` — al reproducir el cierre de dependencias del
   paso 1 con una `WITH RECURSIVE`. El script original resuelve esto con
   `COLLATE "C"` en los dos términos; la consulta de comprobación lo omitía.
2. `ERROR: column "puede_auditar" does not exist` — `puede_auditar` es una
   **función** (`core.puede_auditar()`), no una columna de `core.roles`. La
   tabla de roles solo tiene `puede_crear`, `puede_editar` y `puede_eliminar`.
3. El primer conteo de filas devolvió **1**. La consulta era
   `SELECT count(*) ... FROM (SELECT 1) x, LATERAL (SELECT sum(...) ...) y`:
   contaba la fila semilla en lugar de sumar el `sum` del lateral. Se corrigió
   con un `sum(...)` directo sobre `pg_class` + `query_to_xml`, sin subconsulta
   escalar (la versión correcta está en §1).

Ningún error afectó a datos: todas las sentencias fueron de lectura.
