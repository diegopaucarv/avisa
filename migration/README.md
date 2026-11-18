# migration/ — utilidades de análisis del legado

Herramientas de sólo lectura sobre `backend/BASE_CONFLICTOS_SOCIALES_2026.xlsx`
(86 hojas). No escriben en ninguna base de datos.

| Script                    | Qué hace                                                                                                                                                                         | Salida                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `inspect_legacy.py`       | Inventario de las 86 hojas: filas, columnas por posición, nulos, distintos, largo máximo y muestras                                                                              | `legacy_inventory.json`    |
| `print_inventory.py`      | Vista legible del inventario                                                                                                                                                     | `out_legacy_columns.txt`   |
| `dump_samples.py`         | Valores reales: filas completas de hojas ≤ 40 filas, 3 filas de muestra en las grandes                                                                                           | `docs/_legacy_samples.txt` |
| `verify_integrity.py`     | Chequeos de integridad: ordinales de los bridges, temáticas, estados, tipos                                                                                                      | stdout                     |
| `audit_bridges.py`        | Cuantifica cuánto de cada bridge es recuperable (ordinal vs código)                                                                                                              | stdout                     |
| `audit_alerta_demanda.py` | Verdad duplicada alerta↔demanda (columna vs bridge)                                                                                                                              | stdout                     |
| `audit_identity.py`       | Duplicados de ID y solape de los dos censos de personas                                                                                                                          | stdout                     |
| `decisions.py`            | **Reglas ejecutables** del cierre de decisiones (mapeos de catálogo, geografía INEI, bridges ordinales, especies, unión alerta↔demanda, riesgo derivado). Lo importa el cargador | stdout con `resumen()`     |
| `test_decisions.py`       | Verifica las 122 cifras del acta de cierre contra el workbook real                                                                                                               | stdout, exit 0/1           |

## Reproducir

```sh
python migration/inspect_legacy.py
python migration/print_inventory.py > migration/out_legacy_columns.txt
python migration/dump_samples.py
python migration/audit_bridges.py
python migration/audit_alerta_demanda.py
python migration/audit_identity.py
python migration/decisions.py
python migration/test_decisions.py
```

## Volcado del esquema

El inventario de columnas de `core`, `kag`, `config` y `ops` **no se conserva en el
repositorio**: es una foto que queda obsoleta en cuanto se aplica un parche. Se genera
bajo demanda, en cualquier momento, con el comando de abajo. `out_legacy_columns.txt` sí
se conserva, porque `docs/PLAN_PORTE_LEGADO_V9.md:36` lo cita como fuente.

```sh
docker exec avisa-db psql -U avisa -d avisa -At -F '|' \
  -c "select table_schema, table_name, ordinal_position, column_name, data_type, is_nullable
        from information_schema.columns
       where table_schema in ('core','kag','config','ops')
       order by 1,2,3;"  > /tmp/columnas_esquema.txt
```

## Orden de preparación de la base

El entorno definitivo aplica este orden **automáticamente** en el primer
arranque:

```sh
./scripts/db.sh up
./scripts/db.sh verify      # debe terminar en "verificación OK"
```

Detalle, puertos y verificación: `docs/ENTORNO_DOCKER_POSTGRES.md`. Ese
contenedor (`avisa-db`) es el único con **PostGIS + pgvector**; el contenedor de
pruebas `avisa-v9-test` sólo tiene pgvector y por eso le faltan tres tablas de
`territorio` (no usarlo como referencia del esquema).

Si hace falta reconstruir a mano, el orden es:

1. DDL v9 — `backend/PRODUCE_OAIPCS_AVISA_v9_ddl(1).sql`
   (⚠ requiere PostGIS y **dos pasadas**: hay una FK adelantada a `core.usuarios`).
2. `docs/PREPARACION_V9_CARGA_LEGADO.sql` — parche 1 (columnas, tablas nuevas, catálogos).
3. `docs/PREPARACION_V9_CARGA_LEGADO_2.sql` — parche 2 (huecos detectados al
   especificar la carga).
4. `docs/PREPARACION_V9_CARGA_LEGADO_3.sql` — parche 3 (cierre de bloqueos: DNI no
   único, prioridad de alerta NULL, padre de demanda, unidad OAIPCS, cola de
   revisión). Justificación: `docs/DECISIONES_CARGA_LEGADO_V9.md`.
5. `docs/PREPARACION_V9_CARGA_LEGADO_4.sql` — parche 4 (membresías sin
   fecha, D50; nivel de conflicto NULL en el historial, D51).
6. `docs/PREPARACION_V9_CARGA_LEGADO_5.sql` — parche 5 (seeds de cierre:
   12 etapas PIP, `avisa.raw_ingest` v1 y v2 en `config.schema_registry`,
   `agent.cat_detalle_schema` v1 provisional y las 3 plantillas de
   `ind.plantilla`; además refresca las 6 matviews). Justificación y estado de
   lo que queda pendiente: `docs/BRECHA_CAPA_DATOS_V9.md` §10.

```sh
# contra el entorno definitivo
./scripts/db.sh apply
```

## Sesión obligatoria del cargador

```sql
SET LOCAL app.clasificacion_max = '3';   -- sin esto SELECT/RETURNING ve 0 filas
SET LOCAL app.user_id = '<uuid admin>';
```
