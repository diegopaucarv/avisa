-- ============================================================================
-- SQL DATABASE SCHEMA GENERATED FROM BASE_CONFLICTOS_SOCIALES_2026.xlsx
-- Database Engine: MySQL / PostgreSQL Compatible
-- Total Tables: 86
-- ============================================================================

CREATE DATABASE IF NOT EXISTS db_conflictos_sociales_2026 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE db_conflictos_sociales_2026;

-- ------------------------------------------------------------
-- Table for Sheet: 'Respuestas de formulario 1' (1 rows, 23 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `respuestas_de_formulario_1` (
    `marca_temporal` DATETIME,
    `departamento` VARCHAR(50),
    `provincia` VARCHAR(50),
    `ambito_geografico` VARCHAR(50),
    `id_caso_vinculado` VARCHAR(50),
    `titulo_alerta` VARCHAR(50),
    `situacin_actual` VARCHAR(100),
    `hechos_recientes` VARCHAR(100),
    `demandas` VARCHAR(100),
    `riesgos` VARCHAR(100),
    `recomendaciones` VARCHAR(50),
    `ids_actores_existentes` VARCHAR(50),
    `sectorista` VARCHAR(50),
    `nivel_riesgo` VARCHAR(50),
    `estado` VARCHAR(50),
    `actor_nuevo` VARCHAR(50),
    `actor_nombre` VARCHAR(50),
    `actor_cargo` VARCHAR(50),
    `actor_institucion` VARCHAR(50),
    `actor_tipo` VARCHAR(50),
    `actor_nivel_gobierno` VARCHAR(50),
    `actor_departamento` VARCHAR(50),
    `actor_rol_alerta` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Capacitacion_Participant' (9 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_capacitacion_participant` (
    `id_relacion` VARCHAR(50),
    `id_capacitacion` VARCHAR(50),
    `id_actor_estado` VARCHAR(50),
    `inscrito` VARCHAR(50),
    `culmino` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Capacitaciones' (1 rows, 12 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_capacitaciones` (
    `id_capacitacion` VARCHAR(50),
    `tipo_capacitacion` VARCHAR(50),
    `titulo` VARCHAR(255),
    `objetivo` DECIMAL(10,2),
    `lugar` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `modalidad` VARCHAR(50),
    `fecha_inicio` DATETIME,
    `fecha_fin` DATETIME,
    `duracion` VARCHAR(50),
    `link_documento` DECIMAL(10,2),
    `estado` VARCHAR(50),
    PRIMARY KEY (`id_capacitacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'FACT_Analisis_Casos' (1 rows, 26 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fact_analisis_casos` (
    `id_analisis` VARCHAR(50),
    `codigo_caso` VARCHAR(50),
    `nombre_caso` VARCHAR(100),
    `resumen_ejecutivo` TEXT,
    `id_departamento` DECIMAL(10,2),
    `id_riesgos` VARCHAR(50),
    `id_sector` DECIMAL(10,2),
    `id_tematica` DECIMAL(10,2),
    `fecha` DATETIME,
    `elaborado_por` VARCHAR(50),
    `manifestaciones` JSON,
    `desencadenantes` JSON,
    `impulsores` JSON,
    `causas` JSON,
    `medios` JSON,
    `geografia_conflicto` DECIMAL(10,2),
    `grupos_posiciones` JSON,
    `intereses_comunes` JSON,
    `acciones_visibles` JSON,
    `factores_agravantes` JSON,
    `problema_estructural` DECIMAL(10,2),
    `recomendaciones` JSON,
    `link_word` VARCHAR(100),
    `posicion_produce` VARCHAR(50),
    `intereses_produce` DECIMAL(10,2),
    `necesidades_produce` DECIMAL(10,2),
    PRIMARY KEY (`id_analisis`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Alerta_Recurso' (32 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_alerta_recurso` (
    `id_relacion` VARCHAR(50),
    `id_recurso` VARCHAR(50),
    `id_alerta` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_ActorEstado' (1 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_actorestado` (
    `id_relacion` VARCHAR(50),
    `id_actor_estado` VARCHAR(50),
    `id_caso` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'LOG_Accesos' (857 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `log_accesos` (
    `fecha` DATETIME,
    `dni` INT,
    `nombre` VARCHAR(50),
    `rol` VARCHAR(50),
    `resultado` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'FACT_Casos' (35 rows, 28 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fact_casos` (
    `id_caso` VARCHAR(50),
    `id_tipo` VARCHAR(50),
    `nombre_caso` VARCHAR(100),
    `id_sector` VARCHAR(50),
    `id_tematica` VARCHAR(50),
    `fecha_inicio` DATETIME,
    `id_ubigeo` VARCHAR(50),
    `id_provincia` VARCHAR(50),
    `id_distrito` VARCHAR(50),
    `id_sectorista` VARCHAR(50),
    `prioridad` VARCHAR(50),
    `id_intervencion` VARCHAR(50),
    `pct_avance` DECIMAL(10,2),
    `id_riesgos` VARCHAR(50),
    `descripcion_riesgo` TEXT,
    `resumen_ejecutivo` TEXT,
    `n_acciones` INT,
    `n_hitos_total` INT,
    `n_hitos_cumplidos` INT,
    `fecha_cierre` DECIMAL(10,2),
    `fecha_reapertura` DECIMAL(10,2),
    `n_reaperturas` INT,
    `motivo_cierre` DECIMAL(10,2),
    `link_pdf_drive` DECIMAL(10,2),
    `fecha_envio_correo` DECIMAL(10,2),
    `destinatarios_correo` DECIMAL(10,2),
    `fecha_envio_whatsapp` DECIMAL(10,2),
    `destinatarios_whatsapp` DECIMAL(10,2),
    PRIMARY KEY (`id_caso`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'FACT_Proceso_Caso' (36 rows, 10 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fact_proceso_caso` (
    `id_proceso_caso` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `paso_caso` INT,
    `id_responsable` VARCHAR(50),
    `fecha_inicio` DATETIME,
    `fecha_fin` DECIMAL(10,2),
    `dias_demora` INT,
    `paso_caso_1` INT,
    `observaciones` VARCHAR(50),
    `motivo` DECIMAL(10,2),
    PRIMARY KEY (`id_proceso_caso`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'FACT_RED_RADAR' (1 rows, 6 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fact_red_radar` (
    `id_radar` VARCHAR(50),
    `nombre_radar` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `nivel` VARCHAR(50),
    `fecha_instalacin` DATETIME,
    `descripcin` VARCHAR(50),
    PRIMARY KEY (`id_radar`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'FACT_NODO' (1 rows, 9 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fact_nodo` (
    `id_nodo` VARCHAR(50),
    `id_radar` VARCHAR(50),
    `nombre_nodo` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `id_provincia` VARCHAR(50),
    `id_distrito` DECIMAL(10,2),
    `nivel` VARCHAR(50),
    `fecha_instalacin` DATETIME,
    `descripcin` VARCHAR(50),
    PRIMARY KEY (`id_nodo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'FACT_Proceso_Reporte' (99 rows, 8 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fact_proceso_reporte` (
    `id_proceso` VARCHAR(50),
    `id_tipo_reporte` VARCHAR(50),
    `paso_num` INT,
    `id_responsable` VARCHAR(50),
    `fecha_inicio` DATETIME,
    `fecha_fin` DATETIME,
    `dias_demora` INT,
    `observaciones` VARCHAR(50),
    PRIMARY KEY (`id_proceso`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Paso_Proceso_Caso' (4 rows, 6 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_paso_proceso_caso` (
    `paso_caso` INT,
    `nombre_caso` VARCHAR(50),
    `estado_caso` VARCHAR(50),
    `tipo_responsable_caso` VARCHAR(50),
    `dias_plazo_max` INT,
    `descripcin` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Paso_Proceso' (3 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_paso_proceso` (
    `paso_num` INT,
    `nombre_paso` VARCHAR(50),
    `estado_resultado` VARCHAR(50),
    `tipo_responsable` VARCHAR(50),
    `dias_plazo_max` INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'FACT_Historial_Estado' (33 rows, 10 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fact_historial_estado` (
    `id_historial` INT,
    `id_caso` VARCHAR(50),
    `fecha_cambio` VARCHAR(50),
    `id_estado_nuevo` DATETIME,
    `id_riesgos` INT,
    `id_fase_nueva` VARCHAR(50),
    `id_tipo_cambio` DECIMAL(10,2),
    `motivo_cambio` DECIMAL(10,2),
    `id_responsable` DECIMAL(10,2),
    `id_alerta_vinculada` DECIMAL(10,2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Tipo_Cambio' (6 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_tipo_cambio` (
    `id_tipo_cambio` VARCHAR(50),
    `nombre` VARCHAR(50),
    `descripcin` VARCHAR(50),
    PRIMARY KEY (`id_tipo_cambio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'LOG_Envios' (17 rows, 13 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `log_envios` (
    `id_envio` VARCHAR(50),
    `fecha_envio` DATETIME,
    `canal` VARCHAR(50),
    `id_tipo_reporte` VARCHAR(50),
    `id_documento` INT,
    `paso_num` VARCHAR(50),
    `id_remitente` VARCHAR(50),
    `rol_remitente` VARCHAR(50),
    `id_destinatario` VARCHAR(50),
    `link_pdf_drive` BIGINT,
    `resultado` VARCHAR(255),
    `observacion` VARCHAR(50),
    `unnamed__12` VARCHAR(50),
    PRIMARY KEY (`id_envio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Alertas' (83 rows, 31 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_alertas` (
    `id_alerta` VARCHAR(50),
    `id_caso_vinculado` VARCHAR(50),
    `sectorista` VARCHAR(50),
    `fecha` DATETIME,
    `fecha_actualizacin` DATETIME,
    `id_ubigeo` VARCHAR(50),
    `id_provincia` VARCHAR(50),
    `id_distrito` VARCHAR(50),
    `fotografa` DECIMAL(10,2),
    `titulo_alerta` TEXT,
    `id_sector` VARCHAR(50),
    `situacion_actual` TEXT,
    `hechos_recientes` TEXT,
    `id_nivel_alerta` VARCHAR(50),
    `id_riesgos` VARCHAR(50),
    `descripcion_riesgo_alerta` TEXT,
    `acciones_sugeridas` TEXT,
    `acciones_oaipcs` TEXT,
    `paso_actual` INT,
    `fecha_validacion` DECIMAL(10,2),
    `fecha_remision` DECIMAL(10,2),
    `link_pdf_drive` VARCHAR(100),
    `fecha_envio_correo` DECIMAL(10,2),
    `destinatarios_correo` DECIMAL(10,2),
    `fecha_envio_whatsapp` DECIMAL(10,2),
    `destinatarios_whatsapp` DECIMAL(10,2),
    `estado` VARCHAR(50),
    `tipo_fuente` VARCHAR(100),
    `descripcin_fuente` TEXT,
    `link_fuente` VARCHAR(100),
    `id_mesa_grupo` DECIMAL(10,2),
    PRIMARY KEY (`id_alerta`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Reporte_Rapido' (1 rows, 25 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_reporte_rapido` (
    `id_rr` VARCHAR(50),
    `id_caso_vinculado` DECIMAL(10,2),
    `sectorista` VARCHAR(50),
    `fecha` DATETIME,
    `fecha_actualizacin` DECIMAL(10,2),
    `id_ubigeo` VARCHAR(50),
    `id_provincia` VARCHAR(50),
    `id_distrito` VARCHAR(50),
    `lugar` VARCHAR(50),
    `ubicacin_georeferenciado` DECIMAL(10,2),
    `fotografa` DECIMAL(10,2),
    `titulo_reporte_rapido` VARCHAR(100),
    `id_sector` DECIMAL(10,2),
    `resumen_rapido` TEXT,
    `desarrollo_intervencin` TEXT,
    `anuncios_acuerdos` TEXT,
    `seguimiento` VARCHAR(255),
    `link_pdf_drive` VARCHAR(100),
    `fecha_envio_correo` DECIMAL(10,2),
    `destinatarios_correo` VARCHAR(50),
    `fecha_envio_whatsapp` DECIMAL(10,2),
    `destinatarios_whatsapp` DECIMAL(10,2),
    `estado` DECIMAL(10,2),
    `unnamed__23` INT,
    `unnamed__24` INT,
    PRIMARY KEY (`id_rr`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_ClimaSocial' (7 rows, 28 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_climasocial` (
    `id_clima` VARCHAR(50),
    `id_caso_vinculado` VARCHAR(50),
    `sectorista` VARCHAR(50),
    `fecha` DATETIME,
    `fecha_actualizacin` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `id_provincia` VARCHAR(50),
    `id_distrito` DECIMAL(10,2),
    `lugar` VARCHAR(50),
    `ubicacin_georeferenciado` DECIMAL(10,2),
    `titulo_clima` VARCHAR(100),
    `id_sector` VARCHAR(50),
    `situacin_actual_clima` TEXT,
    `focos_tension_clima` TEXT,
    `oportunidades_intervencin_clima` TEXT,
    `id_riesgos` VARCHAR(50),
    `descripcin_riesgo_clima` TEXT,
    `recomedaciones_estratgicas_clima` VARCHAR(50),
    `acciones_oaipcs_clima` DECIMAL(10,2),
    `link_pdf_drive` VARCHAR(100),
    `fecha_envio_correo` DECIMAL(10,2),
    `destinatarios_correo` INT,
    `fecha_envio_whatsapp` INT,
    `destinatarios_whatsapp` DECIMAL(10,2),
    `estado` VARCHAR(50),
    `id_mesagrupo` DECIMAL(10,2),
    `demandas_clima` VARCHAR(100),
    `riesgos_inmediatos_clima` TEXT,
    PRIMARY KEY (`id_clima`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_ClimaSocial_Focalizado' (6 rows, 26 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_climasocial_focalizado` (
    `id_clima2` VARCHAR(50),
    `id_caso_vinculado` DECIMAL(10,2),
    `sectorista` VARCHAR(50),
    `fecha` DATETIME,
    `fecha_actualizacin` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `id_provincia` VARCHAR(50),
    `id_distrito` DECIMAL(10,2),
    `lugar` DECIMAL(10,2),
    `ubicacin_georeferenciado` DECIMAL(10,2),
    `titulo_clima` DECIMAL(10,2),
    `id_sector` DECIMAL(10,2),
    `situacin_actual_clima` TEXT,
    `alerta_clave` DECIMAL(10,2),
    `focos_tension_clima` TEXT,
    `recomendacin2_clima` TEXT,
    `id_riesgos` INT,
    `descripcin_riesgo_clima` TEXT,
    `recomedaciones_estratgicas_clima` DECIMAL(10,2),
    `acciones_oaipcs_clima` DECIMAL(10,2),
    `link_pdf_drive` VARCHAR(100),
    `fecha_envio_correo` DECIMAL(10,2),
    `destinatarios_correo` INT,
    `fecha_envio_whatsapp` INT,
    `destinatarios_whatsapp` DECIMAL(10,2),
    `estado` DECIMAL(10,2),
    PRIMARY KEY (`id_clima2`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Riesgos' (3 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_riesgos` (
    `id_riesgos` VARCHAR(50),
    `tipo_riesgo` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Locales' (27 rows, 15 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_locales` (
    `id_local` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `nombre_local` VARCHAR(100),
    `direccin` VARCHAR(100),
    `ubicacin` VARCHAR(100),
    `fotografia` VARCHAR(100),
    `aforo` INT,
    `ingresos` VARCHAR(50),
    `proyector` VARCHAR(50),
    `equipos_computo` VARCHAR(50),
    `audio_micro` VARCHAR(50),
    `nombre_contacto` VARCHAR(100),
    `celular_contacto` VARCHAR(50),
    `correo_contacto` VARCHAR(50),
    `recomendacion` VARCHAR(255),
    PRIMARY KEY (`id_local`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Destinatarios_Fijos' (4 rows, 7 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_destinatarios_fijos` (
    `id_destinatario` VARCHAR(50),
    `id_area` VARCHAR(50),
    `recibe_alerta` VARCHAR(50),
    `recibe_clima` VARCHAR(50),
    `recibe_rr` VARCHAR(50),
    `canal_preferido` VARCHAR(50),
    `activo` VARCHAR(50),
    PRIMARY KEY (`id_destinatario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Recurso_Pesca' (37 rows, 6 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_recurso_pesca` (
    `` VARCHAR(50),
    `nombre_comn_recurso` VARCHAR(50),
    `nombre_oficial_recurso` VARCHAR(50),
    `familia` VARCHAR(50),
    `grupo_biolgico` VARCHAR(50),
    `mbito_recurso` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Estado_Proceso' (5 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_estado_proceso` (
    `id_estado` VARCHAR(50),
    `nombre_proceso` VARCHAR(50),
    `color_pbi` VARCHAR(50),
    `es_terminal` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Recurso' (0 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_recurso` (
    `id_cr` VARCHAR(255),
    `id_recurso` VARCHAR(255),
    `id_caso` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Demandas' (12 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_demandas` (
    `id_rela_demanda` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `id_tematica` VARCHAR(50),
    `id_demanda` VARCHAR(50),
    `descripcion_demanda` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Alerta_Demandas' (231 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_alerta_demandas` (
    `id_rela_demanda` VARCHAR(50),
    `id_tipo_reporte` VARCHAR(50),
    `id_alerta` VARCHAR(50),
    `id_tematica` VARCHAR(50),
    `id_demanda` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Alerta_ActorEstado' (5 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_alerta_actorestado` (
    `id_relacion` VARCHAR(50),
    `id_alerta` VARCHAR(50),
    `id_actor_estado` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Tipo_Tematica' (7 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_tipo_tematica` (
    `id_tematica` VARCHAR(50),
    `tipo_tematica` VARCHAR(50),
    `descripcion` TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Demandas' (325 rows, 9 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_demandas` (
    `id_demanda` VARCHAR(50),
    `descripcion_demanda` TEXT,
    `id_organizacion` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `id_alerta` VARCHAR(50),
    `id_tematica` VARCHAR(50),
    `fecha` DATETIME,
    `tipo_evidencia_registro` VARCHAR(50),
    `link_evidencia_registro` VARCHAR(100),
    PRIMARY KEY (`id_demanda`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_anuncios_acuerdos' (0 rows, 7 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_anuncios_acuerdos` (
    `id_acuerdos` VARCHAR(255),
    `acuerdo` VARCHAR(255),
    `descripcion_acuerdos` VARCHAR(255),
    `id_area` VARCHAR(255),
    `id_caso` VARCHAR(255),
    `id_rr` VARCHAR(255),
    `fecha` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Nivel_Alertas' (4 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_nivel_alertas` (
    `id_nivel_alerta` VARCHAR(50),
    `nivel` VARCHAR(50),
    `descripcin_nivel` VARCHAR(100),
    `categoria` VARCHAR(50),
    PRIMARY KEY (`id_nivel_alerta`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Descencadenantes' (1 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_descencadenantes` (
    `id_rela_id_descencadenantes` VARCHAR(50),
    `id_analisis` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `descripcion_descencadenantes` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Impulsores' (5 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_impulsores` (
    `id_rela_id_impulsores` VARCHAR(50),
    `id_analisis` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `descripcion_impulsores` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Causas' (4 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_causas` (
    `id_rela_id_causas` VARCHAR(50),
    `id_analisis` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `descripcion_causas` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Medios' (4 rows, 7 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_medios` (
    `id_rela_id_medios` VARCHAR(50),
    `id_analisis` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `descripcion_medios` VARCHAR(100),
    `tipo_medios` VARCHAR(50),
    `link` VARCHAR(100),
    `unnamed__6` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_ACTOR_GRUPO' (0 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_actor_grupo` (
    `id_rela_id_grupo_actor` VARCHAR(255),
    `id_caso` VARCHAR(255),
    `id_organizacin` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_POSICIONES' (0 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_posiciones` (
    `id_rela_id_posiciones` VARCHAR(255),
    `id_caso` VARCHAR(255),
    `id_organizacin` VARCHAR(255),
    `id_posicion` VARCHAR(255),
    `descripcion_posicion` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_INTERESES' (0 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_intereses` (
    `id_rela_id_intereses` VARCHAR(255),
    `id_caso` VARCHAR(255),
    `id_organizacin` VARCHAR(255),
    `id_interes` VARCHAR(255),
    `descripcion_interes` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_NECESIDADES' (0 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_necesidades` (
    `id_rela_id_necesidades` VARCHAR(255),
    `id_caso` VARCHAR(255),
    `id_organizacin` VARCHAR(255),
    `id_necesidades` VARCHAR(255),
    `descripcion_necesidades` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_INETERES_COMUNES' (0 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_ineteres_comunes` (
    `id_rela_id_interes_comunes` VARCHAR(255),
    `id_caso` VARCHAR(255),
    `id_interes_comunes` VARCHAR(255),
    `descripcion_interes_comunes` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Descencadenantes' (0 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_descencadenantes` (
    `id_descencadenantes` VARCHAR(255),
    `descripcin_descencadenates` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Impulsores' (0 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_impulsores` (
    `id_impulsores` VARCHAR(255),
    `descripcin_impulsores` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Causas' (0 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_causas` (
    `id_causas` VARCHAR(255),
    `descripcin_causas` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Medios' (0 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_medios` (
    `id_medios` VARCHAR(255),
    `nombre` VARCHAR(255),
    `tipo_medio` VARCHAR(255),
    `enlace` VARCHAR(255),
    `pincipal` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Tipo_Proceso' (4 rows, 6 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_tipo_proceso` (
    `id_tipo_reporte` VARCHAR(50),
    `nombre_tipo` VARCHAR(50),
    `sigla` VARCHAR(50),
    `prefijo_id` VARCHAR(50),
    `tiene_flujo` VARCHAR(50),
    `activo` VARCHAR(50),
    PRIMARY KEY (`id_tipo_reporte`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Acciones_Hitos' (8 rows, 13 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_acciones_hitos` (
    `id_accion` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `n_accion` INT,
    `descripcion_accion` VARCHAR(255),
    `id_area` VARCHAR(50),
    `id_pf` VARCHAR(50),
    `id_hito` DECIMAL(10,2),
    `tipo_evidencia` VARCHAR(100),
    `id_redaccion` DECIMAL(10,2),
    `id_clima` DECIMAL(10,2),
    `id_alerta` DECIMAL(10,2),
    `id_rr` DECIMAL(10,2),
    `link_evidencia` DECIMAL(10,2),
    PRIMARY KEY (`id_accion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Hitos' (12 rows, 13 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_hitos` (
    `id_hitos` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `n_hito` INT,
    `descripcion_hito` VARCHAR(255),
    `responsable_hito` VARCHAR(50),
    `validacion_hito` VARCHAR(50),
    `fecha_planificada` DATETIME,
    `fecha_real` DATETIME,
    `estado_hito` VARCHAR(50),
    `link_evidencia` DECIMAL(10,2),
    `id_accion` VARCHAR(50),
    `id_area` VARCHAR(50),
    `descripcion_evidencia` VARCHAR(255),
    PRIMARY KEY (`id_hitos`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_REDACCION' (51 rows, 13 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_redaccion` (
    `id_redaccion` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `fecha` DATETIME,
    `titulo_redaccion` VARCHAR(100),
    `tipo_documento` VARCHAR(50),
    `descripcion` TEXT,
    `sectorista` DECIMAL(10,2),
    `link_archivo` VARCHAR(100),
    `link_lista` VARCHAR(100),
    `link_foto` VARCHAR(100),
    `estado` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `id_sectorista` VARCHAR(50),
    PRIMARY KEY (`id_redaccion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_COORDINACION_TECNICA' (4 rows, 13 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_coordinacion_tecnica` (
    `id_ct` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `fecha` DATETIME,
    `titulo_redaccion` VARCHAR(255),
    `tipo_documento` VARCHAR(50),
    `descripcion` TEXT,
    `sectorista` DECIMAL(10,2),
    `link_archivo` VARCHAR(100),
    `link_lista` DECIMAL(10,2),
    `link_foto` VARCHAR(100),
    `estado` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `id_sectorista` VARCHAR(50),
    PRIMARY KEY (`id_ct`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_MESAS_GRUPOS' (21 rows, 23 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_mesas_grupos` (
    `id_mesa_grupo` VARCHAR(50),
    `tipo_espacio` VARCHAR(50),
    `con_norma` VARCHAR(50),
    `linea_oaipcs` VARCHAR(50),
    `titulo_mesa` VARCHAR(255),
    `tipo_instrumento` VARCHAR(50),
    `base_legal` VARCHAR(100),
    `fecha_norma` DATETIME,
    `prorrogas_modificatorias` VARCHAR(255),
    `fecha_instalacion` DATETIME,
    `naturaleza` VARCHAR(50),
    `fecha_fin_vigencia` DATETIME,
    `estado_vigencia` VARCHAR(50),
    `objetivo` VARCHAR(255),
    `presidente` VARCHAR(100),
    `secretario_tecnico` VARCHAR(50),
    `rol_produce` VARCHAR(50),
    `ambito_departamento` TEXT,
    `titular` VARCHAR(100),
    `alterno` VARCHAR(100),
    `doc_designacion` VARCHAR(255),
    `id_sectorista` VARCHAR(50),
    `link_evidencia` VARCHAR(100),
    PRIMARY KEY (`id_mesa_grupo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_ORGANIZACION' (224 rows, 16 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_organizacion` (
    `id_organizacion` VARCHAR(50),
    `nombre_organizacin` VARCHAR(255),
    `id_ubigeo` VARCHAR(50),
    `direccin` VARCHAR(100),
    `fecha_constitucin` DATETIME,
    `id_tipo_org` VARCHAR(50),
    `inscripcin_sunarp` INT,
    `cod_actor` VARCHAR(50),
    `integrantes` INT,
    `embarcaciones` INT,
    `armadores` INT,
    `fotografa` VARCHAR(100),
    `perfil_organizacion` TEXT,
    `ruc` BIGINT,
    `link_facebook` DECIMAL(10,2),
    `abreviatura` VARCHAR(50),
    PRIMARY KEY (`id_organizacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_TIPO_ORG' (4 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_tipo_org` (
    `id_tipo_org` VARCHAR(50),
    `nombre_tipo` VARCHAR(50),
    PRIMARY KEY (`id_tipo_org`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Actores' (828 rows, 16 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_actores` (
    `id_actor` VARCHAR(50),
    `nombre_actor` VARCHAR(255),
    `dni` INT,
    `telefono` VARCHAR(50),
    `email` VARCHAR(50),
    `cargo` VARCHAR(50),
    `id_organizacion` VARCHAR(255),
    `abreviatura` VARCHAR(255),
    `id_tipo_actor` VARCHAR(50),
    `nivel_gobierno` VARCHAR(50),
    `categoria` VARCHAR(50),
    `id_perfil` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `fotografa` VARCHAR(100),
    `activo` VARCHAR(50),
    `descripcion_perfil` TEXT,
    PRIMARY KEY (`id_actor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Actores_Estado' (108 rows, 15 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_actores_estado` (
    `id_actor_estado` VARCHAR(50),
    `nombre_actor` VARCHAR(50),
    `dni` VARCHAR(50),
    `telefono` VARCHAR(50),
    `email` VARCHAR(50),
    `cargo` VARCHAR(100),
    `id_entidad` DECIMAL(10,2),
    `id_area` DECIMAL(10,2),
    `id_unidad` DECIMAL(10,2),
    `id_tipo_actor` DECIMAL(10,2),
    `nivel_gobierno` DECIMAL(10,2),
    `categoria` DECIMAL(10,2),
    `id_ubigeo` DECIMAL(10,2),
    `fotografia` DECIMAL(10,2),
    `activo` VARCHAR(50),
    PRIMARY KEY (`id_actor_estado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'FACT_Hechos_Casos' (80 rows, 13 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fact_hechos_casos` (
    `id_hecho` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `fecha` DATETIME,
    `tipo_hecho` VARCHAR(50),
    `hecho_crtico` VARCHAR(50),
    `descripcion` TEXT,
    `id_sectorista` VARCHAR(50),
    `tipo_evidencia_hecho` VARCHAR(50),
    `id_clima` DECIMAL(10,2),
    `id_alerta` VARCHAR(100),
    `id_rr` DECIMAL(10,2),
    `link_evidencia` VARCHAR(100),
    `id_redaccion` VARCHAR(50),
    PRIMARY KEY (`id_hecho`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Depto' (87 rows, 6 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_depto` (
    `id_relacion` VARCHAR(50),
    `id_caso` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `departamento` VARCHAR(50),
    `es_principal` VARCHAR(50),
    `unnamed__5` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Actor' (80 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_actor` (
    `id_relacion` VARCHAR(50),
    `id_actor` VARCHAR(50),
    `id_caso` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_RADAR_Actor' (1 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_radar_actor` (
    `id_relacion` VARCHAR(50),
    `id_actor_estado` VARCHAR(50),
    `id_radar` VARCHAR(50),
    `id_actor_radar` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Nodo_Actor' (3 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_nodo_actor` (
    `id_relacion` VARCHAR(50),
    `id_actor_estado` VARCHAR(50),
    `id_nodo` VARCHAR(50),
    `id_actor_radar` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Caso_Actor_Estado' (61 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_caso_actor_estado` (
    `id_relacion` VARCHAR(50),
    `id_actor_estado` VARCHAR(50),
    `id_caso` VARCHAR(50),
    PRIMARY KEY (`id_relacion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Alerta_Actor' (162 rows, 6 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_alerta_actor` (
    `id_raa` VARCHAR(50),
    `id_alerta` VARCHAR(50),
    `id_actor` VARCHAR(50),
    `rol_en_alerta` DECIMAL(10,2),
    `es_principal` DECIMAL(10,2),
    `id_relacion` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Reporte_Actor' (1 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_reporte_actor` (
    `id_rra` VARCHAR(50),
    `id_rr` VARCHAR(50),
    `id_actor` VARCHAR(50),
    `rol_en_alerta` DECIMAL(10,2),
    `es_principal` DECIMAL(10,2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Reporte_Actor_Estado' (1 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_reporte_actor_estado` (
    `id_rra` VARCHAR(50),
    `id_rr` VARCHAR(50),
    `id_actor_estado` VARCHAR(50),
    `rol_en_alerta` DECIMAL(10,2),
    `es_principal` DECIMAL(10,2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Clima_Actor' (1 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_clima_actor` (
    `id_clima` VARCHAR(50),
    `id_rr` VARCHAR(50),
    `id_actor` VARCHAR(50),
    `rol_en_alerta` DECIMAL(10,2),
    `es_principal` DECIMAL(10,2),
    PRIMARY KEY (`id_clima`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Clima_Actor_Estado' (1 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_clima_actor_estado` (
    `id_clima` VARCHAR(50),
    `id_rr` VARCHAR(50),
    `id_actor_estado` VARCHAR(50),
    `rol_en_alerta` DECIMAL(10,2),
    `es_principal` DECIMAL(10,2),
    PRIMARY KEY (`id_clima`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'BRIDGE_Sectorista_Departamento' (27 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bridge_sectorista_departamento` (
    `id_rsc` VARCHAR(50),
    `id_sectorista` VARCHAR(50),
    `id_departamento` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Departamentos' (27 rows, 8 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_departamentos` (
    `id_ubigeo` VARCHAR(50),
    `departamento` VARCHAR(50),
    `codigo_depto` INT,
    `region_natural` VARCHAR(50),
    `alcance` VARCHAR(50),
    `latitud` DECIMAL(10,2),
    `longitud` DECIMAL(10,2),
    `capital` VARCHAR(50),
    PRIMARY KEY (`id_ubigeo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Provincias' (70 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_provincias` (
    `id_provincia` VARCHAR(50),
    `cod_inei` INT,
    `nombre_provincia` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `nombre_departamento` VARCHAR(50),
    PRIMARY KEY (`id_provincia`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Distritos' (698 rows, 8 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_distritos` (
    `id_distrito` VARCHAR(50),
    `cod_inei` INT,
    `nombre_distrito` VARCHAR(50),
    `id_provincia` VARCHAR(50),
    `nombre_provincia` VARCHAR(50),
    `id_ubigeo` VARCHAR(50),
    `nombre_departamento` VARCHAR(50),
    `estado` VARCHAR(50),
    PRIMARY KEY (`id_distrito`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Tipo_Caso' (4 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_tipo_caso` (
    `id_tipo` VARCHAR(50),
    `tipo_caso` VARCHAR(50),
    `descripcion` VARCHAR(100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Rol_Actor' (4 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_rol_actor` (
    `id_rol` VARCHAR(50),
    `tipo_rol` VARCHAR(50),
    `descripcion` DECIMAL(10,2),
    PRIMARY KEY (`id_rol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Tipo_Sector' (3 rows, 3 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_tipo_sector` (
    `id_sector` VARCHAR(50),
    `tipo_sector` VARCHAR(50),
    `id_area` VARCHAR(50),
    PRIMARY KEY (`id_sector`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Tipo_Actor' (3 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_tipo_actor` (
    `id_tipo_actor` VARCHAR(50),
    `tipo_actor` VARCHAR(50),
    PRIMARY KEY (`id_tipo_actor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Tipo_Actor_Radar' (3 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_tipo_actor_radar` (
    `id_actor_radar` VARCHAR(50),
    `tipo_actor` VARCHAR(50)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Perfil' (3 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_perfil` (
    `id_perfil` VARCHAR(50),
    `tipo_perfil` VARCHAR(50),
    PRIMARY KEY (`id_perfil`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Intervencion' (4 rows, 2 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_intervencion` (
    `id_intervencion` VARCHAR(50),
    `tipo_intervencion` VARCHAR(50),
    PRIMARY KEY (`id_intervencion`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Sectoristas' (15 rows, 13 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_sectoristas` (
    `id_sectorista` VARCHAR(50),
    `nombre_sectorista` VARCHAR(50),
    `dni` INT,
    `clave_sectorista` INT,
    `n_casos` INT,
    `cargo` VARCHAR(50),
    `id_entidad` DECIMAL(10,2),
    `id_area` DECIMAL(10,2),
    `id_unidad` DECIMAL(10,2),
    `email` VARCHAR(50),
    `telefono` INT,
    `fotografia` DECIMAL(10,2),
    `estado` VARCHAR(50),
    PRIMARY KEY (`id_sectorista`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Punto_Focal' (17 rows, 12 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_punto_focal` (
    `id_pf` VARCHAR(50),
    `nombre_pf` VARCHAR(50),
    `dni` DECIMAL(10,2),
    `clave_pf` DECIMAL(10,2),
    `cargo` VARCHAR(50),
    `id_entidad` VARCHAR(50),
    `id_area` VARCHAR(50),
    `id_unidad` DECIMAL(10,2),
    `email` VARCHAR(50),
    `telefono` INT,
    `fotografia` DECIMAL(10,2),
    `estado` VARCHAR(50),
    PRIMARY KEY (`id_pf`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Autoridades' (2 rows, 12 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_autoridades` (
    `id_autoridades` VARCHAR(50),
    `nombre_autoridades` VARCHAR(50),
    `dni` INT,
    `clave_autoridades` INT,
    `cargo` VARCHAR(50),
    `id_entidad` DECIMAL(10,2),
    `id_area` VARCHAR(50),
    `id_unidad` DECIMAL(10,2),
    `email` VARCHAR(50),
    `fotografia` DECIMAL(10,2),
    `telefono` DECIMAL(10,2),
    `estado` VARCHAR(50),
    PRIMARY KEY (`id_autoridades`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Responsable' (3 rows, 4 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_responsable` (
    `id_responsable` VARCHAR(50),
    `id_origen` VARCHAR(50),
    `tipo_responsable` VARCHAR(50),
    `tabla_origen` VARCHAR(50),
    PRIMARY KEY (`id_responsable`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Entidad_Responsable' (23 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_entidad_responsable` (
    `id_entidad` VARCHAR(50),
    `nombre_entidad` VARCHAR(50),
    `abreviatura` VARCHAR(50),
    `nivel` VARCHAR(50),
    `estado` VARCHAR(50),
    PRIMARY KEY (`id_entidad`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Area_Responsable' (66 rows, 5 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_area_responsable` (
    `id_area` VARCHAR(50),
    `nombre_area` VARCHAR(100),
    `abreviatura` VARCHAR(50),
    `id_entidad` VARCHAR(50),
    `estado` VARCHAR(50),
    PRIMARY KEY (`id_area`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Table for Sheet: 'DIM_Unidades_Organicas_Responsa' (27 rows, 6 columns)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dim_unidades_organicas_responsa` (
    `id_unidad` VARCHAR(50),
    `nombre_unidad` VARCHAR(100),
    `abreviatura` VARCHAR(50),
    `id_area` VARCHAR(50),
    `id_entidad` VARCHAR(50),
    `estado` VARCHAR(50),
    PRIMARY KEY (`id_unidad`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
