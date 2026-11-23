-- Matarani como lugar seleccionable al crear un caso.
-- Matarani NO es distrito: es puerto del distrito de Islay (ubigeo 040704,
-- provincia Islay, region Arequipa). Por eso entra en territorio.lugares.
--
-- Coordenadas tomadas de gis.infraestructuras_puntos (ID_100015), que ya trae
-- el punto "Laboratorio Matarani (Alquilado)" con lat/lon del KML de PRODUCE.
--
-- Idempotente: se puede ejecutar mas de una vez.

BEGIN;

-- Tipos de lugar nuevos. cat_tipos_lugar no tiene default de id: se fija.
INSERT INTO territorio.cat_tipos_lugar (id, codigo) VALUES
    (10, 'puerto'),
    (11, 'localidad')
ON CONFLICT (codigo) DO NOTHING;

-- Matarani: puerto del distrito de Islay.
INSERT INTO territorio.lugares
    (tipo_id, distrito_id, nombre, latitud, longitud, operativo, fuente_dato, fecha_actualizacion)
SELECT
    t.id,
    d.id,
    'Matarani',
    -16.9997383,
    -72.0966519,
    true,
    'KML infraestructuras PRODUCE (ID_100015)',
    DATE '2026-11-23'
FROM territorio.cat_tipos_lugar t
JOIN core.distritos d ON d.ubigeo = '040704'
WHERE t.codigo = 'puerto'
ON CONFLICT (distrito_id, tipo_id, nombre) DO NOTHING;

COMMIT;
