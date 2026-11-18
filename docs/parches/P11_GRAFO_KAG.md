# P11 — Grafo KAG: nodos de caso, nodos faltantes y aristas mínimas

Estado: **aplicado y verificado**. Parche ejecutado contra `avisa-db` el 2026-11-18.
Entregable SQL: `docs/PARCHE_11_GRAFO_KAG.sql`.

Antes del parche el grafo tenía **1 195 nodos y ninguna arista**: un almacén de
entidades, no un grafo. Este parche cierra seis defectos que se sostenían entre sí.

---

## 1. Qué estaba mal

| # | Defecto | Consecuencia |
| - | --- | --- |
| 1 | El alta del nodo de caso vivía dentro de `core.caso_historial()` | Un caso creado sin pasar por el historial no dejaba nodo |
| 2 | No existía sincronía de etiqueta al renombrar | El nodo conservaba el nombre viejo para siempre |
| 3 | `kag.nodos` no tenía marcas de tiempo ni índice por referencia | Imposible saber cuándo entró un nodo o consultarlo por `ref_id` |
| 4 | Solo había nodos de `actor` y `caso` | Las 325 demandas, que el catálogo ya admitía, no existían en el grafo |
| 5 | `kag.aristas` estaba vacía | Las tablas puente declaraban relaciones que el grafo ignoraba |
| 6 | Nada mantenía el grafo al día tras el parche | El grafo volvería a divergir con el primer alta nueva |

---

## 2. Qué hace el parche

### 2.1 Tipo de arista nuevo

`kag.cat_tipos_arista` gana la fila 20: `MIEMBRO_DE`, clase `relacion`, dirigida,
de `actor` a `actor`. Es la única relación actor–actor que la base declaraba y que
el catálogo no tenía.

### 2.2 Estructura de `kag.nodos`

| Columna | Tipo | Nulo | Nota |
| --- | --- | --- | --- |
| `id` | uuid | no | clave primaria |
| `tipo` | varchar(20) | no | `actor`, `caso`, `demanda`… |
| `ref_id` | uuid | no | identificador en la tabla de origen |
| `etiqueta` | varchar(255) | sí | nombre visible del nodo |
| `created_at` | timestamptz | no | nuevo en este parche |
| `updated_at` | timestamptz | no | nuevo; lo mueve `trg_nodo_toca` |

Se añade el índice `ix_nodos_ref` sobre `(tipo, ref_id)`, que es como se busca un
nodo desde su origen.

**Nota sobre las marcas de tiempo.** Las 1 195 filas que ya existían reciben
`created_at = updated_at = now()`, que es el momento de aplicación del parche y no
el de su alta real. El dato anterior no existe en la base; se prefiere una fecha
declarada a un nulo.

### 2.3 Funciones auxiliares

- `kag.nodo_asegura(tipo, ref_id, etiqueta)` devuelve el id del nodo y lo crea si no
  existe. No escribe si la etiqueta no cambió, para no ensuciar `updated_at`.
- `kag.arista_asegura(...)` crea una arista solo si no hay una vigente equivalente.

Ambas son idempotentes y se usan desde los disparadores.

### 2.4 Disparadores

| Disparador | Tabla | Cuándo | Qué hace |
| --- | --- | --- | --- |
| `trg_nodo_toca` | `kag.nodos` | antes de actualizar | mueve `updated_at` |
| `trg_caso_nace` | `core.casos` | después de insertar | crea el nodo del caso |
| `trg_demanda_nace` | `core.demandas` | después de insertar | crea el nodo de la demanda |
| `trg_caso_renombra` | `core.casos` | al cambiar `nombre_caso` | sincroniza la etiqueta |
| `trg_actor_renombra` | `core.actores` | al cambiar `nombre_actual` | sincroniza la etiqueta |
| `trg_caso_actor_nace` | `core.casos_actores` | después de insertar | crea la arista de participación |
| `trg_demanda_actor_nace` | `core.demandas_actores` | después de insertar | crea la arista de exigencia |
| `trg_membresia_nace` | `core.actor_membresia` | después de insertar | crea la arista de membresía |

`core.caso_historial()` se reescribe: ya **no** inserta en `kag.nodos`; vuelve a
hacer solo lo suyo, que es registrar el cambio de estado.

### 2.5 Relaciones mínimas

Se rellenan las aristas que la propia base ya declaraba en sus tablas puente:

| Arista | Origen | Destino | Filas | De dónde sale |
| --- | --- | ---: | --- | --- |
| `PARTICIPA_EN` | actor | caso | 60 | `core.casos_actores` |
| `EXIGE` | actor | demanda | 98 | `core.demandas_actores` |
| `MIEMBRO_DE` | actor | actor | 292 | `core.actor_membresia` |

No se inventan `ALIANZA` ni `TENSION`: esas relaciones no están escritas en `core` y
exigirían lectura documental o análisis de agente. Quedan para una fase posterior.

---

## 3. Resultado medido

| Métrica | Antes | Después |
| --- | ---: | ---: |
| `kag.nodos` | 1 195 | **1 520** |
| — de tipo `actor` | 1 160 | 1 160 |
| — de tipo `caso` | 35 | 35 |
| — de tipo `demanda` | 0 | **325** |
| `kag.aristas` | 0 | **450** |
| — `PARTICIPA_EN` | 0 | 60 |
| — `EXIGE` | 0 | 98 |
| — `MIEMBRO_DE` | 0 | 292 |
| Disparadores en el grafo | 0 | 8 |

Los 1 160 actores provienen de `legacy.dim_actores` (828),
`legacy.dim_actores_estado` (108) y `legacy.dim_organizacion` (224); todos con
`origen_dato = 'AVISA_HISTORICO'`.

---

## 4. Cómo verificar

```sql
-- Nodos por tipo
SELECT tipo, count(*) FROM kag.nodos GROUP BY tipo ORDER BY 2 DESC;

-- Aristas por tipo
SELECT t.codigo, count(*)
  FROM kag.aristas a JOIN kag.cat_tipos_arista t ON t.id = a.tipo_id
 GROUP BY t.codigo ORDER BY 2 DESC;

-- Alta de caso: crea nodo y sigue escribiendo el historial de estado
BEGIN;
  INSERT INTO core.casos (...) VALUES (...) RETURNING id;
  SELECT * FROM kag.nodos WHERE tipo = 'caso' AND ref_id = ...;
  SELECT * FROM core.caso_estado_historial WHERE caso_id = ...;
ROLLBACK;
```

Las pruebas de este parche se hicieron en transacción con `ROLLBACK`, sin dejar
filas de ensayo en la base.

---

## 5. Lo que el parche no hace

- No cierra la validez de una arista cuando se borra el vínculo de origen: el
  borrado deja la arista vigente. Se resolverá cuando el grafo tenga fecha de
  vigencia por arista.
- No crea relaciones que no estén en `core`.
- No vuelve a calcular etiquetas de nodos ya existentes más allá del renombre: la
  etiqueta de un caso es su `nombre_caso` y la de una demanda es el texto del
  pedido.

---

## 6. Hallazgos de datos que el parche dejó a la vista

- `core.demandas` tiene 325 filas, pero solo **99 tienen caso** y 222 cuelgan de una
  alerta; 26 no tienen ningún vínculo. Solo **3 casos** tienen demandas cargadas.
- `core.demandas_actores` tiene 98 filas: **227 demandas no tienen actor declarado**.
  Por eso `EXIGE` tiene 98 aristas y no 325.
- `kag.actor_name_history` tiene 1 160 filas, una sola versión por actor: es una
  foto del nombre actual, no un historial de cambios.

Estos huecos son de la carga del legado, no del grafo. El parche los hace visibles
al no inventar aristas que no existen.
