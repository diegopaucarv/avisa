# 2. Orden de lectura canónico

Leer primero (1→7): obligatorio para cualquiera que entre al proyecto. Son 7 archivos.

Consulta: DICCIONARIO_DATOS, BRECHA, DECISIONES, ACTA, PLAN_PORTE, ANALISIS, P9, P10, P11. Se abren para resolver una pregunta concreta, no se leen de corrido.

```mermaid
graph TD
    A["1 · ERS v0.4<br/>qué debe hacer el sistema"] --> B["2 · AVISA_PRODUCE v10<br/>cómo está modelado"]
    B --> C["3 · mvp.md<br/>qué se entrega en diciembre"]
    C --> D["4 · PRIORIZACION_MVP_v10<br/>qué tablas van primero"]
    D --> E["5 · LEGADO_A_V10<br/>qué había antes"]
    E --> F["6 · FLUJO_BASE_MVP_Y_MIGRACION<br/>cómo se levanta"]
    F --> G["7 · ENTORNO_DOCKER_POSTGRES<br/>dónde corre"]

    H["Consulta bajo demanda"] --> H1["DICCIONARIO_DATOS · BRECHA"]
    H --> H2["DECISIONES D1-D51 · ACTA · PLAN_PORTE · ANALISIS"]
    H --> H3["P9 · P10 · P11"]

    G --> H
```
