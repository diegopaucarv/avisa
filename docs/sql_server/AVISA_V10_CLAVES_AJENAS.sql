-- =====================================================================
--  AVISA · CLAVES AJENAS · sección dedicada
-- =====================================================================
--  GENERADO POR migration/extraer_fks.py a partir de
--  docs/AVISA_V10_ESQUEMA_UNIFICADO.sql. NO EDITAR A MANO.
--
--  PARA QUÉ
--  El esquema se crea sin claves ajenas
--  (AVISA_V10_ESQUEMA_SIN_FK.sql) y las relaciones se añaden aquí.
--  Así la creación de tablas no depende del orden, y el equipo de SSMA
--  puede quedarse con el archivo completo o comentar los bloques que
--  decida no aplicar en SQL Server.
--
--  CÓMO SE APLICA
--  Después de crear las tablas, con psql:
--
--      psql -U avisa -d avisa -f docs/sql_server/AVISA_V10_CLAVES_AJENAS.sql
--
--  No es idempotente: ADD CONSTRAINT falla si la restricción ya existe.
--  Para volver a aplicarlo, primero se borran las claves ajenas; el
--  bloque final deja la consulta que genera los DROP.
--
--  526 claves ajenas, agrupadas por tabla hija.
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
--  agent.feedback_log · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE agent.feedback_log ADD CONSTRAINT feedback_log_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  agent.lessons_learned · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE agent.lessons_learned ADD CONSTRAINT lessons_learned_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES core.usuarios(id);
ALTER TABLE agent.lessons_learned ADD CONSTRAINT lessons_learned_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES agent.feedback_log(id);

-- ---------------------------------------------------------------------
--  agent.llm_call · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE agent.llm_call ADD CONSTRAINT llm_call_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE agent.llm_call ADD CONSTRAINT llm_call_policy_snapshot_id_fkey FOREIGN KEY (policy_snapshot_id) REFERENCES policy.snapshot(id);

-- ---------------------------------------------------------------------
--  agent.llm_call_fragmento · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE agent.llm_call_fragmento ADD CONSTRAINT llm_call_fragmento_call_id_call_ts_fkey FOREIGN KEY (call_id, call_ts) REFERENCES agent.llm_call(id, ts);
ALTER TABLE agent.llm_call_fragmento ADD CONSTRAINT llm_call_fragmento_fragmento_id_fkey FOREIGN KEY (fragmento_id) REFERENCES kag.documento_fragmento(id);

-- ---------------------------------------------------------------------
--  agent.plantilla_prompt · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE agent.plantilla_prompt ADD CONSTRAINT plantilla_prompt_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES agent.plantilla_prompt(id);

-- ---------------------------------------------------------------------
--  agent.sesion · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE agent.sesion ADD CONSTRAINT sesion_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE agent.sesion ADD CONSTRAINT sesion_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES analisis.plan(id);
ALTER TABLE agent.sesion ADD CONSTRAINT sesion_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  agent.sesion_paso · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE agent.sesion_paso ADD CONSTRAINT sesion_paso_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES agent.sesion(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  agent.synthetic_test_cases · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE agent.synthetic_test_cases ADD CONSTRAINT synthetic_test_cases_caso_semilla_id_fkey FOREIGN KEY (caso_semilla_id) REFERENCES core.casos(id);

-- ---------------------------------------------------------------------
--  analisis.plan · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE analisis.plan ADD CONSTRAINT plan_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES core.usuarios(id);
ALTER TABLE analisis.plan ADD CONSTRAINT plan_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE analisis.plan ADD CONSTRAINT plan_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES core.usuarios(id);
ALTER TABLE analisis.plan ADD CONSTRAINT plan_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  analisis.plan_paso · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE analisis.plan_paso ADD CONSTRAINT plan_paso_depende_de_fkey FOREIGN KEY (depende_de) REFERENCES analisis.plan_paso(id);
ALTER TABLE analisis.plan_paso ADD CONSTRAINT plan_paso_herramienta_id_fkey FOREIGN KEY (herramienta_id) REFERENCES analisis.cat_herramientas(id);
ALTER TABLE analisis.plan_paso ADD CONSTRAINT plan_paso_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES analisis.plan(id) ON DELETE CASCADE;
ALTER TABLE analisis.plan_paso ADD CONSTRAINT plan_paso_punto_ingesta_id_fkey FOREIGN KEY (punto_ingesta_id) REFERENCES analisis.punto_ingesta(id);

-- ---------------------------------------------------------------------
--  avisa.raw_ingest · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE avisa.raw_ingest ADD CONSTRAINT raw_ingest_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE avisa.raw_ingest ADD CONSTRAINT raw_ingest_policy_snapshot_id_fkey FOREIGN KEY (policy_snapshot_id) REFERENCES policy.snapshot(id);

-- ---------------------------------------------------------------------
--  avisa.raw_ingest_rejected · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE avisa.raw_ingest_rejected ADD CONSTRAINT raw_ingest_rejected_raw_id_raw_received_at_fkey FOREIGN KEY (raw_id, raw_received_at) REFERENCES avisa.raw_ingest(id, received_at);

-- ---------------------------------------------------------------------
--  chat.blame · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.blame ADD CONSTRAINT blame_commit_id_fkey FOREIGN KEY (commit_id) REFERENCES chat.commit(id);
ALTER TABLE chat.blame ADD CONSTRAINT blame_origen_commit_id_fkey FOREIGN KEY (origen_commit_id) REFERENCES chat.commit(id);
ALTER TABLE chat.blame ADD CONSTRAINT blame_origen_turno_id_fkey FOREIGN KEY (origen_turno_id) REFERENCES chat.turno(id);
ALTER TABLE chat.blame ADD CONSTRAINT blame_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES chat.turno(id);

-- ---------------------------------------------------------------------
--  chat.blob · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE chat.blob ADD CONSTRAINT blob_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  chat.cherry_pick · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.cherry_pick ADD CONSTRAINT cherry_pick_aplicado_por_fkey FOREIGN KEY (aplicado_por) REFERENCES core.usuarios(id);
ALTER TABLE chat.cherry_pick ADD CONSTRAINT cherry_pick_commit_destino_id_fkey FOREIGN KEY (commit_destino_id) REFERENCES chat.commit(id);
ALTER TABLE chat.cherry_pick ADD CONSTRAINT cherry_pick_commit_origen_id_fkey FOREIGN KEY (commit_origen_id) REFERENCES chat.commit(id);
ALTER TABLE chat.cherry_pick ADD CONSTRAINT cherry_pick_rama_destino_id_fkey FOREIGN KEY (rama_destino_id) REFERENCES chat.rama(id);

-- ---------------------------------------------------------------------
--  chat.commit · 6 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.commit ADD CONSTRAINT commit_aplicacion_id_fkey FOREIGN KEY (aplicacion_id) REFERENCES config.aplicacion(id);
ALTER TABLE chat.commit ADD CONSTRAINT commit_artefacto_id_fkey FOREIGN KEY (artefacto_id) REFERENCES domain.artefacto(id);
ALTER TABLE chat.commit ADD CONSTRAINT commit_modelo_card_id_fkey FOREIGN KEY (modelo_card_id) REFERENCES model.model_card(id);
ALTER TABLE chat.commit ADD CONSTRAINT commit_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE chat.commit ADD CONSTRAINT commit_politica_snapshot_id_fkey FOREIGN KEY (politica_snapshot_id) REFERENCES policy.snapshot(id);
ALTER TABLE chat.commit ADD CONSTRAINT commit_repositorio_id_fkey FOREIGN KEY (repositorio_id) REFERENCES chat.repositorio(id);

-- ---------------------------------------------------------------------
--  chat.diff · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.diff ADD CONSTRAINT diff_commit_a_id_fkey FOREIGN KEY (commit_a_id) REFERENCES chat.commit(id);
ALTER TABLE chat.diff ADD CONSTRAINT diff_commit_b_id_fkey FOREIGN KEY (commit_b_id) REFERENCES chat.commit(id);

-- ---------------------------------------------------------------------
--  chat.hook · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE chat.hook ADD CONSTRAINT hook_repositorio_id_fkey FOREIGN KEY (repositorio_id) REFERENCES chat.repositorio(id);

-- ---------------------------------------------------------------------
--  chat.merge · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.merge ADD CONSTRAINT merge_commit_id_fkey FOREIGN KEY (commit_id) REFERENCES chat.commit(id);
ALTER TABLE chat.merge ADD CONSTRAINT merge_merge_base_id_fkey FOREIGN KEY (merge_base_id) REFERENCES chat.commit(id);
ALTER TABLE chat.merge ADD CONSTRAINT merge_rama_destino_id_fkey FOREIGN KEY (rama_destino_id) REFERENCES chat.rama(id);
ALTER TABLE chat.merge ADD CONSTRAINT merge_rama_origen_id_fkey FOREIGN KEY (rama_origen_id) REFERENCES chat.rama(id);

-- ---------------------------------------------------------------------
--  chat.rama · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.rama ADD CONSTRAINT rama_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES core.usuarios(id);
ALTER TABLE chat.rama ADD CONSTRAINT rama_head_commit_id_fkey FOREIGN KEY (head_commit_id) REFERENCES chat.commit(id);
ALTER TABLE chat.rama ADD CONSTRAINT rama_rama_padre_id_fkey FOREIGN KEY (rama_padre_id) REFERENCES chat.rama(id);
ALTER TABLE chat.rama ADD CONSTRAINT rama_repositorio_id_fkey FOREIGN KEY (repositorio_id) REFERENCES chat.repositorio(id);

-- ---------------------------------------------------------------------
--  chat.ref · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.ref ADD CONSTRAINT ref_commit_id_fkey FOREIGN KEY (commit_id) REFERENCES chat.commit(id);
ALTER TABLE chat.ref ADD CONSTRAINT ref_repositorio_id_fkey FOREIGN KEY (repositorio_id) REFERENCES chat.repositorio(id);
ALTER TABLE chat.ref ADD CONSTRAINT ref_tag_autor_id_fkey FOREIGN KEY (tag_autor_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  chat.reflog · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.reflog ADD CONSTRAINT reflog_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES core.usuarios(id);
ALTER TABLE chat.reflog ADD CONSTRAINT reflog_repositorio_id_fkey FOREIGN KEY (repositorio_id) REFERENCES chat.repositorio(id);

-- ---------------------------------------------------------------------
--  chat.remote · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.remote ADD CONSTRAINT remote_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE chat.remote ADD CONSTRAINT remote_repositorio_id_fkey FOREIGN KEY (repositorio_id) REFERENCES chat.repositorio(id);

-- ---------------------------------------------------------------------
--  chat.repositorio · 6 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.repositorio ADD CONSTRAINT fk_repo_default_branch ADD CONSTRAINT fk_repo_default_branch FOREIGN KEY (default_branch_id) REFERENCES chat.rama(id) DEFERRABLE INITIALLY DEFERRED;;
ALTER TABLE chat.repositorio ADD CONSTRAINT repositorio_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE chat.repositorio ADD CONSTRAINT repositorio_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES core.usuarios(id);
ALTER TABLE chat.repositorio ADD CONSTRAINT repositorio_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE chat.repositorio ADD CONSTRAINT repositorio_sujeto_actor_uid_fkey FOREIGN KEY (sujeto_actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE chat.repositorio ADD CONSTRAINT repositorio_territorio_lugar_id_fkey FOREIGN KEY (territorio_lugar_id) REFERENCES territorio.lugares(id);

-- ---------------------------------------------------------------------
--  chat.stash · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.stash ADD CONSTRAINT stash_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES core.usuarios(id);
ALTER TABLE chat.stash ADD CONSTRAINT stash_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE chat.stash ADD CONSTRAINT stash_rama_origen_id_fkey FOREIGN KEY (rama_origen_id) REFERENCES chat.rama(id);
ALTER TABLE chat.stash ADD CONSTRAINT stash_repositorio_id_fkey FOREIGN KEY (repositorio_id) REFERENCES chat.repositorio(id);

-- ---------------------------------------------------------------------
--  chat.turno · 5 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE chat.turno ADD CONSTRAINT turno_blob_ref_fkey FOREIGN KEY (blob_ref) REFERENCES chat.blob(hash);
ALTER TABLE chat.turno ADD CONSTRAINT turno_commit_id_fkey FOREIGN KEY (commit_id) REFERENCES chat.commit(id) ON DELETE CASCADE;
ALTER TABLE chat.turno ADD CONSTRAINT turno_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES model.model_card(id);
ALTER TABLE chat.turno ADD CONSTRAINT turno_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE chat.turno ADD CONSTRAINT turno_politica_snapshot_id_fkey FOREIGN KEY (politica_snapshot_id) REFERENCES policy.snapshot(id);

-- ---------------------------------------------------------------------
--  community.encuestas_percepcion · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE community.encuestas_percepcion ADD CONSTRAINT encuestas_percepcion_caleta_id_fkey FOREIGN KEY (caleta_id) REFERENCES territorio.caleta_detalle(lugar_id);
ALTER TABLE community.encuestas_percepcion ADD CONSTRAINT encuestas_percepcion_encuestador_id_fkey FOREIGN KEY (encuestador_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  config.aplicacion · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE config.aplicacion ADD CONSTRAINT aplicacion_modelo_card_id_fkey FOREIGN KEY (modelo_card_id) REFERENCES model.model_card(id);

-- ---------------------------------------------------------------------
--  config.parametro · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE config.parametro ADD CONSTRAINT parametro_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES core.usuarios(id);
ALTER TABLE config.parametro ADD CONSTRAINT parametro_fuente_normativa_id_fkey FOREIGN KEY (fuente_normativa_id) REFERENCES policy.regla(id);
ALTER TABLE config.parametro ADD CONSTRAINT parametro_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES config.parametro(id);

-- ---------------------------------------------------------------------
--  config.tope_gasto · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE config.tope_gasto ADD CONSTRAINT tope_gasto_servicio_codigo_fkey FOREIGN KEY (servicio_codigo) REFERENCES config.servicio_externo(codigo);

-- ---------------------------------------------------------------------
--  consultation.actores · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE consultation.actores ADD CONSTRAINT actores_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES core.actores(actor_uid);
ALTER TABLE consultation.actores ADD CONSTRAINT actores_proceso_id_fkey FOREIGN KEY (proceso_id) REFERENCES consultation.procesos(id);

-- ---------------------------------------------------------------------
--  consultation.etapas · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE consultation.etapas ADD CONSTRAINT etapas_proceso_id_fkey FOREIGN KEY (proceso_id) REFERENCES consultation.procesos(id);

-- ---------------------------------------------------------------------
--  consultation.procesos · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE consultation.procesos ADD CONSTRAINT procesos_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE consultation.procesos ADD CONSTRAINT procesos_nivel_clasificacion_fkey ADD CONSTRAINT procesos_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion (nivel);;

-- ---------------------------------------------------------------------
--  consultation.resultados · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE consultation.resultados ADD CONSTRAINT resultados_proceso_id_fkey FOREIGN KEY (proceso_id) REFERENCES consultation.procesos(id);

-- ---------------------------------------------------------------------
--  core.actor_alias · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.actor_alias ADD CONSTRAINT actor_alias_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.actor_datos_personales · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.actor_datos_personales ADD CONSTRAINT actor_datos_personales_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid) ON DELETE CASCADE;
ALTER TABLE core.actor_datos_personales ADD CONSTRAINT actor_datos_personales_base_legal_id_fkey ADD CONSTRAINT actor_datos_personales_base_legal_id_fkey FOREIGN KEY (base_legal_id) REFERENCES ref.base_legal_tratamiento(id);;
ALTER TABLE core.actor_datos_personales ADD CONSTRAINT actor_datos_personales_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  core.actor_membresia · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.actor_membresia ADD CONSTRAINT actor_membresia_organizacion_uid_fkey FOREIGN KEY (organizacion_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.actor_membresia ADD CONSTRAINT actor_membresia_persona_uid_fkey FOREIGN KEY (persona_uid) REFERENCES core.actores(actor_uid);

-- ---------------------------------------------------------------------
--  core.actores · 12 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.actores ADD CONSTRAINT actores_caso_ancla_id_fkey ADD CONSTRAINT actores_caso_ancla_id_fkey FOREIGN KEY (caso_ancla_id) REFERENCES core.casos(id) ON DELETE SET NULL;;
ALTER TABLE core.actores ADD CONSTRAINT actores_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.actores ADD CONSTRAINT actores_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);
ALTER TABLE core.actores ADD CONSTRAINT actores_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.actores ADD CONSTRAINT actores_nivel_identificacion_id_fkey ADD CONSTRAINT actores_nivel_identificacion_id_fkey FOREIGN KEY (nivel_identificacion_id) REFERENCES core.cat_nivel_identificacion(id);;
ALTER TABLE core.actores ADD CONSTRAINT actores_organizacion_ancla_uid_fkey ADD CONSTRAINT actores_organizacion_ancla_uid_fkey FOREIGN KEY (organizacion_ancla_uid) REFERENCES core.actores(actor_uid) ON DELETE SET NULL;;
ALTER TABLE core.actores ADD CONSTRAINT actores_perfil_id_fkey FOREIGN KEY (perfil_id) REFERENCES core.cat_perfiles_actor(id);
ALTER TABLE core.actores ADD CONSTRAINT actores_region_id_fkey ADD CONSTRAINT actores_region_id_fkey FOREIGN KEY (region_id) REFERENCES core.regiones(id);;
ALTER TABLE core.actores ADD CONSTRAINT actores_rol_actor_id_fkey FOREIGN KEY (rol_actor_id) REFERENCES core.cat_roles_actor(id);
ALTER TABLE core.actores ADD CONSTRAINT actores_rol_funcional_id_fkey FOREIGN KEY (rol_funcional_id) REFERENCES core.cat_roles_funcionales(id);
ALTER TABLE core.actores ADD CONSTRAINT actores_tipo_actor_id_fkey FOREIGN KEY (tipo_actor_id) REFERENCES core.cat_tipos_actor(id);
ALTER TABLE core.actores ADD CONSTRAINT actores_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.acuerdo_ospa_sni · 5 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.acuerdo_ospa_sni ADD CONSTRAINT acuerdo_ospa_sni_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE core.acuerdo_ospa_sni ADD CONSTRAINT acuerdo_ospa_sni_fuente_documento_id_fkey FOREIGN KEY (fuente_documento_id) REFERENCES kag.documento_fuente(id);
ALTER TABLE core.acuerdo_ospa_sni ADD CONSTRAINT acuerdo_ospa_sni_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.acuerdo_ospa_sni ADD CONSTRAINT acuerdo_ospa_sni_ospa_actor_uid_fkey FOREIGN KEY (ospa_actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.acuerdo_ospa_sni ADD CONSTRAINT acuerdo_ospa_sni_planta_actor_uid_fkey FOREIGN KEY (planta_actor_uid) REFERENCES core.actores(actor_uid);

-- ---------------------------------------------------------------------
--  core.alerta_especies · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.alerta_especies ADD CONSTRAINT alerta_especies_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES core.alertas_tempranas(id) ON DELETE CASCADE;
ALTER TABLE core.alerta_especies ADD CONSTRAINT alerta_especies_especie_id_fkey FOREIGN KEY (especie_id) REFERENCES core.cat_especies(id);

-- ---------------------------------------------------------------------
--  core.alertas_actores · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.alertas_actores ADD CONSTRAINT alertas_actores_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES core.actores(actor_uid);
ALTER TABLE core.alertas_actores ADD CONSTRAINT alertas_actores_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES core.alertas_tempranas(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.alertas_tempranas · 10 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_mesa_id_fkey ADD CONSTRAINT alertas_tempranas_mesa_id_fkey FOREIGN KEY (mesa_id) REFERENCES core.mesas_dialogo(id);;
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_nivel_alerta_id_fkey FOREIGN KEY (nivel_alerta_id) REFERENCES core.cat_niveles_alerta(id);
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_prioridad_id_fkey FOREIGN KEY (prioridad_id) REFERENCES core.cat_prioridades_alerta(id);
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_sectorista_usuario_id_fkey FOREIGN KEY (sectorista_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_subsector_id_fkey FOREIGN KEY (subsector_id) REFERENCES core.cat_subsectores(id);
ALTER TABLE core.alertas_tempranas ADD CONSTRAINT alertas_tempranas_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.banco_datos_tratamiento · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.banco_datos_tratamiento ADD CONSTRAINT banco_datos_tratamiento_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.banco_datos_tratamiento ADD CONSTRAINT banco_datos_tratamiento_oficial_datos_usuario_id_fkey FOREIGN KEY (oficial_datos_usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.cambio_normativo · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.cambio_normativo ADD CONSTRAINT cambio_normativo_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES core.usuarios(id);
ALTER TABLE core.cambio_normativo ADD CONSTRAINT cambio_normativo_revertido_por_fkey FOREIGN KEY (revertido_por) REFERENCES core.usuarios(id);
ALTER TABLE core.cambio_normativo ADD CONSTRAINT cambio_normativo_solicitado_por_fkey FOREIGN KEY (solicitado_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.capacidad_campo · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.capacidad_campo ADD CONSTRAINT capacidad_campo_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.capacitacion_participantes · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.capacitacion_participantes ADD CONSTRAINT capacitacion_participantes_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.capacitacion_participantes ADD CONSTRAINT capacitacion_participantes_capacitacion_id_fkey FOREIGN KEY (capacitacion_id) REFERENCES core.capacitaciones(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.capacitaciones · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.capacitaciones ADD CONSTRAINT capacitaciones_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);
ALTER TABLE core.capacitaciones ADD CONSTRAINT capacitaciones_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.capacitaciones ADD CONSTRAINT capacitaciones_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES core.cat_tipos_capacitacion(id);

-- ---------------------------------------------------------------------
--  core.caso_cronologia · 7 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.caso_cronologia ADD CONSTRAINT caso_cronologia_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.caso_cronologia ADD CONSTRAINT caso_cronologia_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.caso_cronologia ADD CONSTRAINT caso_cronologia_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.caso_cronologia ADD CONSTRAINT caso_cronologia_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.caso_cronologia ADD CONSTRAINT caso_cronologia_sectorista_usuario_id_fkey FOREIGN KEY (sectorista_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE core.caso_cronologia ADD CONSTRAINT caso_cronologia_tipo_hecho_id_fkey FOREIGN KEY (tipo_hecho_id) REFERENCES core.cat_tipos_hecho(id);
ALTER TABLE core.caso_cronologia ADD CONSTRAINT caso_cronologia_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.caso_distritos · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.caso_distritos ADD CONSTRAINT caso_distritos_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.caso_distritos ADD CONSTRAINT caso_distritos_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);

-- ---------------------------------------------------------------------
--  core.caso_estado_historial · 6 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.caso_estado_historial ADD CONSTRAINT caso_estado_historial_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.caso_estado_historial ADD CONSTRAINT caso_estado_historial_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES core.cat_estados_caso(id);
ALTER TABLE core.caso_estado_historial ADD CONSTRAINT caso_estado_historial_nivel_conflicto_id_fkey FOREIGN KEY (nivel_conflicto_id) REFERENCES core.cat_niveles_conflicto(id);
ALTER TABLE core.caso_estado_historial ADD CONSTRAINT caso_estado_historial_nivel_riesgo_id_fkey FOREIGN KEY (nivel_riesgo_id) REFERENCES core.cat_niveles_riesgo(id);
ALTER TABLE core.caso_estado_historial ADD CONSTRAINT caso_estado_historial_tipo_cambio_id_fkey FOREIGN KEY (tipo_cambio_id) REFERENCES core.cat_tipos_cambio_caso(id);
ALTER TABLE core.caso_estado_historial ADD CONSTRAINT caso_estado_historial_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.caso_factores · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.caso_factores ADD CONSTRAINT caso_factores_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.caso_factores ADD CONSTRAINT caso_factores_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES core.cat_factores_contexto(id);

-- ---------------------------------------------------------------------
--  core.caso_lugares · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.caso_lugares ADD CONSTRAINT caso_lugares_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.caso_lugares ADD CONSTRAINT caso_lugares_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id);

-- ---------------------------------------------------------------------
--  core.caso_regiones · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.caso_regiones ADD CONSTRAINT caso_regiones_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.caso_regiones ADD CONSTRAINT caso_regiones_region_id_fkey FOREIGN KEY (region_id) REFERENCES core.regiones(id);

-- ---------------------------------------------------------------------
--  core.casos · 17 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.casos ADD CONSTRAINT casos_alcance_id_fkey FOREIGN KEY (alcance_id) REFERENCES core.cat_alcances_geograficos(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_ciclo_intervencion_id_fkey FOREIGN KEY (ciclo_intervencion_id) REFERENCES core.cat_ciclos_intervencion(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_distrito_principal_id_fkey FOREIGN KEY (distrito_principal_id) REFERENCES core.distritos(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_entidad_id_fkey FOREIGN KEY (entidad_id) REFERENCES core.entidades(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES core.cat_estados_caso(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.casos ADD CONSTRAINT casos_nivel_conflicto_id_fkey FOREIGN KEY (nivel_conflicto_id) REFERENCES core.cat_niveles_conflicto(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_nivel_riesgo_id_fkey FOREIGN KEY (nivel_riesgo_id) REFERENCES core.cat_niveles_riesgo(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_prioridad_id_fkey FOREIGN KEY (prioridad_id) REFERENCES core.cat_prioridades_atencion(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_provincia_principal_id_fkey FOREIGN KEY (provincia_principal_id) REFERENCES core.provincias(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_punto_focal_usuario_id_fkey FOREIGN KEY (punto_focal_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_region_principal_id_fkey FOREIGN KEY (region_principal_id) REFERENCES core.regiones(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_subsector_id_fkey FOREIGN KEY (subsector_id) REFERENCES core.cat_subsectores(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_tematica_id_fkey FOREIGN KEY (tematica_id) REFERENCES core.cat_tematicas(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_unidad_responsable_id_fkey FOREIGN KEY (unidad_responsable_id) REFERENCES core.cat_unidades_organicas(id);
ALTER TABLE core.casos ADD CONSTRAINT casos_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.casos_actores · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.casos_actores ADD CONSTRAINT casos_actores_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES core.actores(actor_uid);
ALTER TABLE core.casos_actores ADD CONSTRAINT casos_actores_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.cat_pip_etapas · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.cat_pip_etapas ADD CONSTRAINT cat_pip_etapas_fase_id_fkey FOREIGN KEY (fase_id) REFERENCES core.cat_pip_fases(id);

-- ---------------------------------------------------------------------
--  core.cat_unidades_organicas · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.cat_unidades_organicas ADD CONSTRAINT cat_unidades_organicas_entidad_id_fkey FOREIGN KEY (entidad_id) REFERENCES core.entidades(id);
ALTER TABLE core.cat_unidades_organicas ADD CONSTRAINT cat_unidades_organicas_padre_id_fkey FOREIGN KEY (padre_id) REFERENCES core.cat_unidades_organicas(id);

-- ---------------------------------------------------------------------
--  core.compromiso_colaboradores · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.compromiso_colaboradores ADD CONSTRAINT compromiso_colaboradores_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.compromiso_colaboradores ADD CONSTRAINT compromiso_colaboradores_compromiso_id_fkey FOREIGN KEY (compromiso_id) REFERENCES core.compromisos(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.compromiso_distritos · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.compromiso_distritos ADD CONSTRAINT compromiso_distritos_compromiso_id_fkey FOREIGN KEY (compromiso_id) REFERENCES core.compromisos(id) ON DELETE CASCADE;
ALTER TABLE core.compromiso_distritos ADD CONSTRAINT compromiso_distritos_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);

-- ---------------------------------------------------------------------
--  core.compromiso_pip · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.compromiso_pip ADD CONSTRAINT compromiso_pip_compromiso_id_fkey FOREIGN KEY (compromiso_id) REFERENCES core.compromisos(id) ON DELETE CASCADE;
ALTER TABLE core.compromiso_pip ADD CONSTRAINT compromiso_pip_etapa_id_fkey FOREIGN KEY (etapa_id) REFERENCES core.cat_pip_etapas(id);

-- ---------------------------------------------------------------------
--  core.compromisos · 11 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_alcance_id_fkey FOREIGN KEY (alcance_id) REFERENCES core.cat_alcances_geograficos(id);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_documento_origen_id_fkey FOREIGN KEY (documento_origen_id) REFERENCES core.documentos(id);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES core.cat_estados_compromiso(id);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_redefinido_de_id_fkey FOREIGN KEY (redefinido_de_id) REFERENCES core.compromisos(id);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_reunion_id_fkey FOREIGN KEY (reunion_id) REFERENCES core.reuniones_dialogo(id);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_tematica_id_fkey FOREIGN KEY (tematica_id) REFERENCES core.cat_tematicas(id);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_unidad_responsable_id_fkey FOREIGN KEY (unidad_responsable_id) REFERENCES core.cat_unidades_organicas(id);
ALTER TABLE core.compromisos ADD CONSTRAINT compromisos_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.consulta_reniec · 5 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.consulta_reniec ADD CONSTRAINT consulta_reniec_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.consulta_reniec ADD CONSTRAINT consulta_reniec_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE core.consulta_reniec ADD CONSTRAINT consulta_reniec_consultado_por_usuario_id_fkey FOREIGN KEY (consultado_por_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE core.consulta_reniec ADD CONSTRAINT consulta_reniec_integracion_id_fkey FOREIGN KEY (integracion_id) REFERENCES core.integraciones(id);
ALTER TABLE core.consulta_reniec ADD CONSTRAINT consulta_reniec_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  core.cronologia_vinculos · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.cronologia_vinculos ADD CONSTRAINT cronologia_vinculos_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES core.alertas_tempranas(id);
ALTER TABLE core.cronologia_vinculos ADD CONSTRAINT cronologia_vinculos_cronologia_id_fkey FOREIGN KEY (cronologia_id) REFERENCES core.caso_cronologia(id) ON DELETE CASCADE;
ALTER TABLE core.cronologia_vinculos ADD CONSTRAINT cronologia_vinculos_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES core.documentos(id);

-- ---------------------------------------------------------------------
--  core.demandas · 7 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.demandas ADD CONSTRAINT demandas_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES core.alertas_tempranas(id);
ALTER TABLE core.demandas ADD CONSTRAINT demandas_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.demandas ADD CONSTRAINT demandas_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.demandas ADD CONSTRAINT demandas_documento_origen_id_fkey FOREIGN KEY (documento_origen_id) REFERENCES core.documentos(id);
ALTER TABLE core.demandas ADD CONSTRAINT demandas_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.demandas ADD CONSTRAINT demandas_tematica_id_fkey FOREIGN KEY (tematica_id) REFERENCES core.cat_tematicas(id);
ALTER TABLE core.demandas ADD CONSTRAINT demandas_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.demandas_actores · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.demandas_actores ADD CONSTRAINT demandas_actores_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES core.actores(actor_uid);
ALTER TABLE core.demandas_actores ADD CONSTRAINT demandas_actores_demanda_id_fkey FOREIGN KEY (demanda_id) REFERENCES core.demandas(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.demandas_evidencias · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.demandas_evidencias ADD CONSTRAINT demandas_evidencias_demanda_id_fkey FOREIGN KEY (demanda_id) REFERENCES core.demandas(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.derivaciones_alerta · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.derivaciones_alerta ADD CONSTRAINT derivaciones_alerta_alerta_id_fkey FOREIGN KEY (alerta_id) REFERENCES core.alertas_tempranas(id) ON DELETE CASCADE;
ALTER TABLE core.derivaciones_alerta ADD CONSTRAINT derivaciones_alerta_area_destino_id_fkey FOREIGN KEY (area_destino_id) REFERENCES core.cat_unidades_organicas(id);

-- ---------------------------------------------------------------------
--  core.distritos · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.distritos ADD CONSTRAINT distritos_provincia_id_fkey FOREIGN KEY (provincia_id) REFERENCES core.provincias(id);

-- ---------------------------------------------------------------------
--  core.documento_actores · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.documento_actores ADD CONSTRAINT documento_actores_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.documento_actores ADD CONSTRAINT documento_actores_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES core.documentos(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.documentos · 8 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.documentos ADD CONSTRAINT documentos_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE core.documentos ADD CONSTRAINT documentos_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.documentos ADD CONSTRAINT documentos_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);
ALTER TABLE core.documentos ADD CONSTRAINT documentos_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.documentos ADD CONSTRAINT documentos_responsable_usuario_id_fkey FOREIGN KEY (responsable_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE core.documentos ADD CONSTRAINT documentos_reunion_id_fkey FOREIGN KEY (reunion_id) REFERENCES core.reuniones_dialogo(id);
ALTER TABLE core.documentos ADD CONSTRAINT documentos_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES core.cat_tipos_documento(id);
ALTER TABLE core.documentos ADD CONSTRAINT documentos_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.envios_comunicacion · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.envios_comunicacion ADD CONSTRAINT envios_comunicacion_remitente_usuario_id_fkey FOREIGN KEY (remitente_usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.feature_flags · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.feature_flags ADD CONSTRAINT feature_flags_activado_por_fkey FOREIGN KEY (activado_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.fuentes_evidencia · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.fuentes_evidencia ADD CONSTRAINT fuentes_evidencia_cronologia_id_fkey FOREIGN KEY (cronologia_id) REFERENCES core.caso_cronologia(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.hitos_compromiso · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.hitos_compromiso ADD CONSTRAINT hitos_compromiso_compromiso_id_fkey FOREIGN KEY (compromiso_id) REFERENCES core.compromisos(id) ON DELETE CASCADE;
ALTER TABLE core.hitos_compromiso ADD CONSTRAINT hitos_compromiso_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES core.cat_estados_hito(id);
ALTER TABLE core.hitos_compromiso ADD CONSTRAINT hitos_compromiso_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  core.hitos_compromiso_estado_historico · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.hitos_compromiso_estado_historico ADD CONSTRAINT hitos_compromiso_estado_historico_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES core.cat_estados_hito(id);
ALTER TABLE core.hitos_compromiso_estado_historico ADD CONSTRAINT hitos_compromiso_estado_historico_hito_id_fkey FOREIGN KEY (hito_id) REFERENCES core.hitos_compromiso(id) ON DELETE CASCADE;
ALTER TABLE core.hitos_compromiso_estado_historico ADD CONSTRAINT hitos_compromiso_estado_historico_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.integraciones · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.integraciones ADD CONSTRAINT integraciones_tipo_fuente_id_fkey FOREIGN KEY (tipo_fuente_id) REFERENCES core.cat_tipos_fuente_integracion(id);

-- ---------------------------------------------------------------------
--  core.locales · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.locales ADD CONSTRAINT locales_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);

-- ---------------------------------------------------------------------
--  core.log_accesos · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.log_accesos ADD CONSTRAINT log_accesos_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.log_accesos ADD CONSTRAINT log_accesos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.mesa_miembros · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.mesa_miembros ADD CONSTRAINT mesa_miembros_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.mesa_miembros ADD CONSTRAINT mesa_miembros_mesa_id_fkey FOREIGN KEY (mesa_id) REFERENCES core.mesas_dialogo(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.mesas_dialogo · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.mesas_dialogo ADD CONSTRAINT mesas_dialogo_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.mesas_dialogo ADD CONSTRAINT mesas_dialogo_sectorista_usuario_id_fkey FOREIGN KEY (sectorista_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE core.mesas_dialogo ADD CONSTRAINT mesas_dialogo_tipo_espacio_id_fkey FOREIGN KEY (tipo_espacio_id) REFERENCES core.cat_tipos_espacio_dialogo(id);

-- ---------------------------------------------------------------------
--  core.migracion_conflicto · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.migracion_conflicto ADD CONSTRAINT migracion_conflicto_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.notificaciones · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.notificaciones ADD CONSTRAINT notificaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.organizaciones · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.organizaciones ADD CONSTRAINT organizaciones_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid) ON DELETE CASCADE;
ALTER TABLE core.organizaciones ADD CONSTRAINT organizaciones_representante_uid_fkey FOREIGN KEY (representante_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.organizaciones ADD CONSTRAINT organizaciones_tipo_organizacion_id_fkey FOREIGN KEY (tipo_organizacion_id) REFERENCES core.cat_tipos_organizacion(id);

-- ---------------------------------------------------------------------
--  core.outbox_integracion · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.outbox_integracion ADD CONSTRAINT outbox_integracion_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES core.usuarios(id);
ALTER TABLE core.outbox_integracion ADD CONSTRAINT outbox_integracion_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES core.cat_estados_integracion(id);
ALTER TABLE core.outbox_integracion ADD CONSTRAINT outbox_integracion_integracion_id_fkey FOREIGN KEY (integracion_id) REFERENCES core.integraciones(id);

-- ---------------------------------------------------------------------
--  core.output_contracts · 6 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.output_contracts ADD CONSTRAINT output_contracts_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE core.output_contracts ADD CONSTRAINT output_contracts_chat_commit_id_fkey FOREIGN KEY (chat_commit_id) REFERENCES chat.commit(id);
ALTER TABLE core.output_contracts ADD CONSTRAINT output_contracts_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.output_contracts ADD CONSTRAINT output_contracts_policy_snapshot_id_fkey FOREIGN KEY (policy_snapshot_id) REFERENCES policy.snapshot(id);
ALTER TABLE core.output_contracts ADD CONSTRAINT output_contracts_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES ctx.snapshot(id);
ALTER TABLE core.output_contracts ADD CONSTRAINT output_contracts_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.permiso_aprobacion · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.permiso_aprobacion ADD CONSTRAINT permiso_aprobacion_otorgado_por_fkey FOREIGN KEY (otorgado_por) REFERENCES core.usuarios(id);
ALTER TABLE core.permiso_aprobacion ADD CONSTRAINT permiso_aprobacion_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.plan_acciones · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.plan_acciones ADD CONSTRAINT plan_acciones_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES core.planes_accion(documento_id) ON DELETE CASCADE;
ALTER TABLE core.plan_acciones ADD CONSTRAINT plan_acciones_responsable_uid_fkey FOREIGN KEY (responsable_uid) REFERENCES core.actores(actor_uid);

-- ---------------------------------------------------------------------
--  core.planes_accion · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.planes_accion ADD CONSTRAINT planes_accion_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES core.documentos(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.privilegio_usuario · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.privilegio_usuario ADD CONSTRAINT privilegio_usuario_otorgado_por_usuario_id_fkey FOREIGN KEY (otorgado_por_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE core.privilegio_usuario ADD CONSTRAINT privilegio_usuario_privilegio_id_fkey FOREIGN KEY (privilegio_id) REFERENCES core.cat_privilegio(id);
ALTER TABLE core.privilegio_usuario ADD CONSTRAINT privilegio_usuario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.proceso_instancia · 8 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.proceso_instancia ADD CONSTRAINT proceso_instancia_alerta_id_fkey (alerta_id) REFERENCES core.alertas_tempranas(id);
ALTER TABLE core.proceso_instancia ADD CONSTRAINT proceso_instancia_caso_id_fkey (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;
ALTER TABLE core.proceso_instancia ADD CONSTRAINT proceso_instancia_created_by_fkey (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.proceso_instancia ADD CONSTRAINT proceso_instancia_estado_id_fkey (estado_id) REFERENCES core.flujo_estado(id);
ALTER TABLE core.proceso_instancia ADD CONSTRAINT proceso_instancia_flujo_definicion_id_fkey (flujo_definicion_id) REFERENCES core.flujo_definicion(id);
ALTER TABLE core.proceso_instancia ADD CONSTRAINT proceso_instancia_nivel_clasificacion_fkey (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.proceso_instancia ADD CONSTRAINT proceso_instancia_updated_by_fkey (updated_by) REFERENCES core.usuarios(id);
ALTER TABLE core.proceso_instancia ADD CONSTRAINT proceso_instancia_usuario_id_fkey (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.provincias · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.provincias ADD CONSTRAINT provincias_region_id_fkey FOREIGN KEY (region_id) REFERENCES core.regiones(id);

-- ---------------------------------------------------------------------
--  core.query_cache · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.query_cache ADD CONSTRAINT query_cache_clasificacion_max_fkey FOREIGN KEY (clasificacion_max) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  core.reunion_participantes · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.reunion_participantes ADD CONSTRAINT reunion_participantes_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.reunion_participantes ADD CONSTRAINT reunion_participantes_institucion_uid_fkey FOREIGN KEY (institucion_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE core.reunion_participantes ADD CONSTRAINT reunion_participantes_reunion_id_fkey FOREIGN KEY (reunion_id) REFERENCES core.reuniones_dialogo(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.reuniones_dialogo · 7 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.reuniones_dialogo ADD CONSTRAINT reuniones_dialogo_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE core.reuniones_dialogo ADD CONSTRAINT reuniones_dialogo_convocante_unidad_id_fkey FOREIGN KEY (convocante_unidad_id) REFERENCES core.cat_unidades_organicas(id);
ALTER TABLE core.reuniones_dialogo ADD CONSTRAINT reuniones_dialogo_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE core.reuniones_dialogo ADD CONSTRAINT reuniones_dialogo_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE core.reuniones_dialogo ADD CONSTRAINT reuniones_dialogo_responsable_usuario_id_fkey FOREIGN KEY (responsable_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE core.reuniones_dialogo ADD CONSTRAINT reuniones_dialogo_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES core.cat_tipos_reunion(id);
ALTER TABLE core.reuniones_dialogo ADD CONSTRAINT reuniones_dialogo_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.riesgo_social_ordinal · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.riesgo_social_ordinal ADD CONSTRAINT riesgo_social_ordinal_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id);
ALTER TABLE core.riesgo_social_ordinal ADD CONSTRAINT riesgo_social_ordinal_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  core.roles · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.roles ADD CONSTRAINT roles_max_clasificacion_fkey FOREIGN KEY (max_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  core.suscripcion_notificacion · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.suscripcion_notificacion ADD CONSTRAINT suscripcion_notificacion_unidad_id_fkey FOREIGN KEY (unidad_id) REFERENCES core.cat_unidades_organicas(id);

-- ---------------------------------------------------------------------
--  core.usuario_roles · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.usuario_roles ADD CONSTRAINT usuario_roles_rol_id_fkey FOREIGN KEY (rol_id) REFERENCES core.roles(id);
ALTER TABLE core.usuario_roles ADD CONSTRAINT usuario_roles_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  core.usuario_territorio · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE core.usuario_territorio ADD CONSTRAINT usuario_territorio_region_id_fkey FOREIGN KEY (region_id) REFERENCES core.regiones(id);
ALTER TABLE core.usuario_territorio ADD CONSTRAINT usuario_territorio_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  core.usuarios · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE core.usuarios ADD CONSTRAINT usuarios_unidad_id_fkey FOREIGN KEY (unidad_id) REFERENCES core.cat_unidades_organicas(id);

-- ---------------------------------------------------------------------
--  ctx.captura · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ctx.captura ADD CONSTRAINT captura_corpus_id_fkey FOREIGN KEY (corpus_id) REFERENCES kag.cat_corpus(id);
ALTER TABLE ctx.captura ADD CONSTRAINT captura_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE ctx.captura ADD CONSTRAINT captura_trabajo_id_fkey FOREIGN KEY (trabajo_id) REFERENCES ctx.trabajo_recoleccion(id);

-- ---------------------------------------------------------------------
--  ctx.cat_variables · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE ctx.cat_variables ADD CONSTRAINT cat_variables_dominio_id_fkey FOREIGN KEY (dominio_id) REFERENCES ctx.cat_dominios(id);

-- ---------------------------------------------------------------------
--  ctx.observaciones · 8 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ctx.observaciones ADD CONSTRAINT observaciones_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);
ALTER TABLE ctx.observaciones ADD CONSTRAINT observaciones_especie_id_fkey FOREIGN KEY (especie_id) REFERENCES core.cat_especies(id);
ALTER TABLE ctx.observaciones ADD CONSTRAINT observaciones_fuente_id_fkey FOREIGN KEY (fuente_id) REFERENCES ctx.cat_fuentes(id);
ALTER TABLE ctx.observaciones ADD CONSTRAINT observaciones_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id);
ALTER TABLE ctx.observaciones ADD CONSTRAINT observaciones_provincia_id_fkey FOREIGN KEY (provincia_id) REFERENCES core.provincias(id);
ALTER TABLE ctx.observaciones ADD CONSTRAINT observaciones_region_id_fkey FOREIGN KEY (region_id) REFERENCES core.regiones(id);
ALTER TABLE ctx.observaciones ADD CONSTRAINT observaciones_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES ctx.cat_variables(id);
ALTER TABLE ctx.observaciones ADD CONSTRAINT observaciones_zona_maritima_id_fkey FOREIGN KEY (zona_maritima_id) REFERENCES ctx.zonas_maritimas(id);

-- ---------------------------------------------------------------------
--  ctx.snapshot · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ctx.snapshot ADD CONSTRAINT snapshot_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE ctx.snapshot ADD CONSTRAINT snapshot_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  ctx.trabajo_recoleccion · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ctx.trabajo_recoleccion ADD CONSTRAINT trabajo_recoleccion_herramienta_id_fkey FOREIGN KEY (herramienta_id) REFERENCES ctx.herramienta(id);
ALTER TABLE ctx.trabajo_recoleccion ADD CONSTRAINT trabajo_recoleccion_indicador_id_fkey FOREIGN KEY (indicador_id) REFERENCES ind.indicador(id);
ALTER TABLE ctx.trabajo_recoleccion ADD CONSTRAINT trabajo_recoleccion_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES ctx.cat_variables(id);

-- ---------------------------------------------------------------------
--  ctx.variable_fuentes · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ctx.variable_fuentes ADD CONSTRAINT variable_fuentes_fuente_id_fkey FOREIGN KEY (fuente_id) REFERENCES ctx.cat_fuentes(id);
ALTER TABLE ctx.variable_fuentes ADD CONSTRAINT variable_fuentes_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES ctx.cat_variables(id);

-- ---------------------------------------------------------------------
--  domain.artefacto · 11 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES domain.cat_estados_artefacto(id);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_sujeto_actor_uid_fkey FOREIGN KEY (sujeto_actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_sujeto_documento_id_fkey FOREIGN KEY (sujeto_documento_id) REFERENCES kag.documento_fuente(id);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_sujeto_especie_id_fkey FOREIGN KEY (sujeto_especie_id) REFERENCES core.cat_especies(id);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_sujeto_lugar_id_fkey FOREIGN KEY (sujeto_lugar_id) REFERENCES territorio.lugares(id);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES domain.artefacto(id);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES domain.tipo_artefacto(id);
ALTER TABLE domain.artefacto ADD CONSTRAINT artefacto_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  domain.regla_negocio · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE domain.regla_negocio ADD CONSTRAINT regla_negocio_estado_desde_id_fkey FOREIGN KEY (estado_desde_id) REFERENCES domain.cat_estados_artefacto(id);
ALTER TABLE domain.regla_negocio ADD CONSTRAINT regla_negocio_estado_hasta_id_fkey FOREIGN KEY (estado_hasta_id) REFERENCES domain.cat_estados_artefacto(id);
ALTER TABLE domain.regla_negocio ADD CONSTRAINT regla_negocio_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE domain.regla_negocio ADD CONSTRAINT regla_negocio_tipo_artefacto_id_fkey FOREIGN KEY (tipo_artefacto_id) REFERENCES domain.tipo_artefacto(id);

-- ---------------------------------------------------------------------
--  domain.tipo_artefacto · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE domain.tipo_artefacto ADD CONSTRAINT tipo_artefacto_model_card_id_fkey FOREIGN KEY (model_card_id) REFERENCES model.model_card(id);

-- ---------------------------------------------------------------------
--  economic.anexo_metodologico · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE economic.anexo_metodologico ADD CONSTRAINT anexo_metodologico_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  economic.counterfactual_analysis · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE economic.counterfactual_analysis ADD CONSTRAINT counterfactual_analysis_caso_resuelto_id_fkey FOREIGN KEY (caso_resuelto_id) REFERENCES core.casos(id);

-- ---------------------------------------------------------------------
--  economic.impact_scenarios · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE economic.impact_scenarios ADD CONSTRAINT impact_scenarios_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);

-- ---------------------------------------------------------------------
--  forecast.model_drift_log · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE forecast.model_drift_log ADD CONSTRAINT model_drift_log_model_id_fkey FOREIGN KEY (model_id) REFERENCES forecast.model_registry(id);

-- ---------------------------------------------------------------------
--  forecast.predictions · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE forecast.predictions ADD CONSTRAINT predictions_model_id_fkey FOREIGN KEY (model_id) REFERENCES forecast.model_registry(id);

-- ---------------------------------------------------------------------
--  impact.analisis_recurrencia · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE impact.analisis_recurrencia ADD CONSTRAINT analisis_recurrencia_caso_recurrente_id_fkey FOREIGN KEY (caso_recurrente_id) REFERENCES core.casos(id);
ALTER TABLE impact.analisis_recurrencia ADD CONSTRAINT analisis_recurrencia_caso_resuelto_id_fkey FOREIGN KEY (caso_resuelto_id) REFERENCES core.casos(id);

-- ---------------------------------------------------------------------
--  impact.encuestas_post_resolucion · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE impact.encuestas_post_resolucion ADD CONSTRAINT encuestas_post_resolucion_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES core.actores(actor_uid);
ALTER TABLE impact.encuestas_post_resolucion ADD CONSTRAINT encuestas_post_resolucion_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);

-- ---------------------------------------------------------------------
--  impact.indicadores_bienestar · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE impact.indicadores_bienestar ADD CONSTRAINT indicadores_bienestar_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES core.actores(actor_uid);
ALTER TABLE impact.indicadores_bienestar ADD CONSTRAINT indicadores_bienestar_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);

-- ---------------------------------------------------------------------
--  impact.lecciones_aprendidas_automaticas · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE impact.lecciones_aprendidas_automaticas ADD CONSTRAINT lecciones_aprendidas_automaticas_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);

-- ---------------------------------------------------------------------
--  ind.brecha · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ind.brecha ADD CONSTRAINT brecha_decidido_por_fkey FOREIGN KEY (decidido_por) REFERENCES core.usuarios(id);
ALTER TABLE ind.brecha ADD CONSTRAINT brecha_indicador_id_fkey FOREIGN KEY (indicador_id) REFERENCES ind.indicador(id);

-- ---------------------------------------------------------------------
--  ind.plantilla · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE ind.plantilla ADD CONSTRAINT plantilla_tipo_documento_id_fkey FOREIGN KEY (tipo_documento_id) REFERENCES core.cat_tipos_documento(id);

-- ---------------------------------------------------------------------
--  ind.plantilla_slot · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ind.plantilla_slot ADD CONSTRAINT plantilla_slot_indicador_id_fkey FOREIGN KEY (indicador_id) REFERENCES ind.indicador(id);
ALTER TABLE ind.plantilla_slot ADD CONSTRAINT plantilla_slot_plantilla_id_fkey FOREIGN KEY (plantilla_id) REFERENCES ind.plantilla(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  ind.proxy_justificacion · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ind.proxy_justificacion ADD CONSTRAINT proxy_justificacion_fuente_validez_id_fkey FOREIGN KEY (fuente_validez_id) REFERENCES kag.documento_fuente(id);
ALTER TABLE ind.proxy_justificacion ADD CONSTRAINT proxy_justificacion_variante_id_fkey FOREIGN KEY (variante_id) REFERENCES ind.variante(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  ind.relacion_dependencia · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ind.relacion_dependencia ADD CONSTRAINT relacion_dependencia_depende_de_indicador_id_fkey FOREIGN KEY (depende_de_indicador_id) REFERENCES ind.indicador(id);
ALTER TABLE ind.relacion_dependencia ADD CONSTRAINT relacion_dependencia_depende_de_variable_id_fkey FOREIGN KEY (depende_de_variable_id) REFERENCES ctx.cat_variables(id);
ALTER TABLE ind.relacion_dependencia ADD CONSTRAINT relacion_dependencia_indicador_id_fkey FOREIGN KEY (indicador_id) REFERENCES ind.indicador(id);

-- ---------------------------------------------------------------------
--  ind.resultado · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ind.resultado ADD CONSTRAINT resultado_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);
ALTER TABLE ind.resultado ADD CONSTRAINT resultado_variante_id_fkey FOREIGN KEY (variante_id) REFERENCES ind.variante(id);

-- ---------------------------------------------------------------------
--  ind.seleccion · 6 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ind.seleccion ADD CONSTRAINT seleccion_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE ind.seleccion ADD CONSTRAINT seleccion_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);
ALTER TABLE ind.seleccion ADD CONSTRAINT seleccion_seleccionada_por_fkey FOREIGN KEY (seleccionada_por) REFERENCES core.usuarios(id);
ALTER TABLE ind.seleccion ADD CONSTRAINT seleccion_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES ind.plantilla_slot(id);
ALTER TABLE ind.seleccion ADD CONSTRAINT seleccion_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES ind.seleccion(id);
ALTER TABLE ind.seleccion ADD CONSTRAINT seleccion_variante_id_fkey FOREIGN KEY (variante_id) REFERENCES ind.variante(id);

-- ---------------------------------------------------------------------
--  ind.variante · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ind.variante ADD CONSTRAINT variante_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE ind.variante ADD CONSTRAINT variante_indicador_id_fkey FOREIGN KEY (indicador_id) REFERENCES ind.indicador(id);
ALTER TABLE ind.variante ADD CONSTRAINT variante_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES ctx.cat_variables(id);

-- ---------------------------------------------------------------------
--  kag.actor_name_history · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE kag.actor_name_history ADD CONSTRAINT actor_name_history_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  kag.actor_profile · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE kag.actor_profile ADD CONSTRAINT actor_profile_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  kag.actor_profile_attribute · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.actor_profile_attribute ADD CONSTRAINT actor_profile_attribute_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid) ON DELETE CASCADE;
ALTER TABLE kag.actor_profile_attribute ADD CONSTRAINT actor_profile_attribute_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE kag.actor_profile_attribute ADD CONSTRAINT actor_profile_attribute_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES kag.actor_profile_attribute(id);

-- ---------------------------------------------------------------------
--  kag.anomalia_contextual · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE kag.anomalia_contextual ADD CONSTRAINT anomalia_contextual_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);

-- ---------------------------------------------------------------------
--  kag.arista_evidencia · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.arista_evidencia ADD CONSTRAINT arista_evidencia_arista_id_fkey FOREIGN KEY (arista_id) REFERENCES kag.aristas(id) ON DELETE CASCADE;
ALTER TABLE kag.arista_evidencia ADD CONSTRAINT arista_evidencia_fragmento_id_fkey FOREIGN KEY (fragmento_id) REFERENCES kag.documento_fragmento(id);

-- ---------------------------------------------------------------------
--  kag.aristas · 7 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.aristas ADD CONSTRAINT aristas_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE kag.aristas ADD CONSTRAINT aristas_destino_id_fkey FOREIGN KEY (destino_id) REFERENCES kag.nodos(id);
ALTER TABLE kag.aristas ADD CONSTRAINT aristas_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE kag.aristas ADD CONSTRAINT aristas_origen_id_fkey FOREIGN KEY (origen_id) REFERENCES kag.nodos(id);
ALTER TABLE kag.aristas ADD CONSTRAINT aristas_split_from_id_fkey FOREIGN KEY (split_from_id) REFERENCES kag.aristas(id);
ALTER TABLE kag.aristas ADD CONSTRAINT aristas_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES kag.aristas(id);
ALTER TABLE kag.aristas ADD CONSTRAINT aristas_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES kag.cat_tipos_arista(id);

-- ---------------------------------------------------------------------
--  kag.atributo_evidencia · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.atributo_evidencia ADD CONSTRAINT atributo_evidencia_atributo_id_fkey FOREIGN KEY (atributo_id) REFERENCES kag.actor_profile_attribute(id) ON DELETE CASCADE;
ALTER TABLE kag.atributo_evidencia ADD CONSTRAINT atributo_evidencia_fragmento_id_fkey FOREIGN KEY (fragmento_id) REFERENCES kag.documento_fragmento(id);

-- ---------------------------------------------------------------------
--  kag.cat_tipos_arista · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE kag.cat_tipos_arista ADD CONSTRAINT cat_tipos_arista_clase_fk ADD CONSTRAINT cat_tipos_arista_clase_fk FOREIGN KEY (clase) REFERENCES kag.cat_clases_arista(codigo);;

-- ---------------------------------------------------------------------
--  kag.comunidad · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.comunidad ADD CONSTRAINT comunidad_corrida_id_fkey FOREIGN KEY (corrida_id) REFERENCES kag.comunidad_corrida(id) ON DELETE CASCADE;
ALTER TABLE kag.comunidad ADD CONSTRAINT comunidad_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE kag.comunidad ADD CONSTRAINT comunidad_padre_id_fkey FOREIGN KEY (padre_id) REFERENCES kag.comunidad(id);

-- ---------------------------------------------------------------------
--  kag.comunidad_corrida · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE kag.comunidad_corrida ADD CONSTRAINT comunidad_corrida_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  kag.comunidad_miembro · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.comunidad_miembro ADD CONSTRAINT comunidad_miembro_comunidad_id_fkey FOREIGN KEY (comunidad_id) REFERENCES kag.comunidad(id) ON DELETE CASCADE;
ALTER TABLE kag.comunidad_miembro ADD CONSTRAINT comunidad_miembro_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE kag.comunidad_miembro ADD CONSTRAINT comunidad_miembro_nodo_id_fkey FOREIGN KEY (nodo_id) REFERENCES kag.nodos(id);

-- ---------------------------------------------------------------------
--  kag.comunidad_resumen · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.comunidad_resumen ADD CONSTRAINT comunidad_resumen_comunidad_id_fkey FOREIGN KEY (comunidad_id) REFERENCES kag.comunidad(id) ON DELETE CASCADE;
ALTER TABLE kag.comunidad_resumen ADD CONSTRAINT comunidad_resumen_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  kag.contraste · 6 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.contraste ADD CONSTRAINT contraste_calificado_por_fkey FOREIGN KEY (calificado_por) REFERENCES core.usuarios(id);
ALTER TABLE kag.contraste ADD CONSTRAINT contraste_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE kag.contraste ADD CONSTRAINT contraste_fragmento_a_id_fkey FOREIGN KEY (fragmento_a_id) REFERENCES kag.documento_fragmento(id);
ALTER TABLE kag.contraste ADD CONSTRAINT contraste_fragmento_b_id_fkey FOREIGN KEY (fragmento_b_id) REFERENCES kag.documento_fragmento(id);
ALTER TABLE kag.contraste ADD CONSTRAINT contraste_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE kag.contraste ADD CONSTRAINT contraste_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES kag.contraste(id);

-- ---------------------------------------------------------------------
--  kag.documento_fragmento · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.documento_fragmento ADD CONSTRAINT documento_fragmento_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES kag.documento_fuente(id) ON DELETE CASCADE;
ALTER TABLE kag.documento_fragmento ADD CONSTRAINT documento_fragmento_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  kag.documento_fuente · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.documento_fuente ADD CONSTRAINT documento_fuente_core_documento_id_fkey FOREIGN KEY (core_documento_id) REFERENCES core.documentos(id);
ALTER TABLE kag.documento_fuente ADD CONSTRAINT documento_fuente_corpus_id_fkey FOREIGN KEY (corpus_id) REFERENCES kag.cat_corpus(id);
ALTER TABLE kag.documento_fuente ADD CONSTRAINT documento_fuente_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  kag.embedding · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.embedding ADD CONSTRAINT embedding_atributo_id_fkey FOREIGN KEY (atributo_id) REFERENCES kag.actor_profile_attribute(id) ON DELETE CASCADE;
ALTER TABLE kag.embedding ADD CONSTRAINT embedding_fragmento_id_fkey FOREIGN KEY (fragmento_id) REFERENCES kag.documento_fragmento(id) ON DELETE CASCADE;
ALTER TABLE kag.embedding ADD CONSTRAINT embedding_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  kag.entity_merge_log · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.entity_merge_log ADD CONSTRAINT entity_merge_log_resultante_uid_fkey FOREIGN KEY (resultante_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE kag.entity_merge_log ADD CONSTRAINT entity_merge_log_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  kag.entity_merge_members · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.entity_merge_members ADD CONSTRAINT entity_merge_members_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE kag.entity_merge_members ADD CONSTRAINT entity_merge_members_merge_log_id_fkey FOREIGN KEY (merge_log_id) REFERENCES kag.entity_merge_log(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  kag.hipotesis · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.hipotesis ADD CONSTRAINT hipotesis_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE kag.hipotesis ADD CONSTRAINT hipotesis_created_by_fkey FOREIGN KEY (created_by) REFERENCES core.usuarios(id);
ALTER TABLE kag.hipotesis ADD CONSTRAINT hipotesis_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  kag.hipotesis_en_salida · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.hipotesis_en_salida ADD CONSTRAINT hipotesis_en_salida_hipotesis_id_fkey FOREIGN KEY (hipotesis_id) REFERENCES kag.hipotesis(id);
ALTER TABLE kag.hipotesis_en_salida ADD CONSTRAINT hipotesis_en_salida_output_id_fkey FOREIGN KEY (output_id) REFERENCES core.output_contracts(id);

-- ---------------------------------------------------------------------
--  kag.hipotesis_evidencia · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.hipotesis_evidencia ADD CONSTRAINT hipotesis_evidencia_fragmento_id_fkey FOREIGN KEY (fragmento_id) REFERENCES kag.documento_fragmento(id);
ALTER TABLE kag.hipotesis_evidencia ADD CONSTRAINT hipotesis_evidencia_hipotesis_id_fkey FOREIGN KEY (hipotesis_id) REFERENCES kag.hipotesis(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  kag.metrica_nodo · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE kag.metrica_nodo ADD CONSTRAINT metrica_nodo_nodo_id_fkey FOREIGN KEY (nodo_id) REFERENCES kag.nodos(id);

-- ---------------------------------------------------------------------
--  kag.nodos · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE kag.nodos ADD CONSTRAINT nodos_tipo_fk ADD CONSTRAINT nodos_tipo_fk FOREIGN KEY (tipo) REFERENCES kag.cat_tipos_nodo(codigo);;

-- ---------------------------------------------------------------------
--  kag.objetivo · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE kag.objetivo ADD CONSTRAINT objetivo_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  kag.saturacion · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.saturacion ADD CONSTRAINT saturacion_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE kag.saturacion ADD CONSTRAINT saturacion_decidido_por_fkey FOREIGN KEY (decidido_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  kag.vacio_informacion · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.vacio_informacion ADD CONSTRAINT vacio_informacion_brecha_id_fkey FOREIGN KEY (brecha_id) REFERENCES ind.brecha(id);
ALTER TABLE kag.vacio_informacion ADD CONSTRAINT vacio_informacion_indicador_id_fkey FOREIGN KEY (indicador_id) REFERENCES ind.indicador(id);

-- ---------------------------------------------------------------------
--  kag.validacion_hallazgo · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE kag.validacion_hallazgo ADD CONSTRAINT validacion_hallazgo_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE kag.validacion_hallazgo ADD CONSTRAINT validacion_hallazgo_decidido_por_fkey FOREIGN KEY (decidido_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  lex.clase · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE lex.clase ADD CONSTRAINT clase_corrida_id_fkey FOREIGN KEY (corrida_id) REFERENCES lex.corrida(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  lex.clase_termino · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE lex.clase_termino ADD CONSTRAINT clase_termino_clase_id_fkey FOREIGN KEY (clase_id) REFERENCES lex.clase(id) ON DELETE CASCADE;
ALTER TABLE lex.clase_termino ADD CONSTRAINT clase_termino_termino_id_fkey FOREIGN KEY (termino_id) REFERENCES lex.termino(id);

-- ---------------------------------------------------------------------
--  lex.coocurrencia · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE lex.coocurrencia ADD CONSTRAINT coocurrencia_corrida_id_fkey FOREIGN KEY (corrida_id) REFERENCES lex.corrida(id) ON DELETE CASCADE;
ALTER TABLE lex.coocurrencia ADD CONSTRAINT coocurrencia_termino_a_fkey FOREIGN KEY (termino_a) REFERENCES lex.termino(id);
ALTER TABLE lex.coocurrencia ADD CONSTRAINT coocurrencia_termino_b_fkey FOREIGN KEY (termino_b) REFERENCES lex.termino(id);

-- ---------------------------------------------------------------------
--  lex.corpus · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE lex.corpus ADD CONSTRAINT corpus_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  lex.corpus_documento · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE lex.corpus_documento ADD CONSTRAINT corpus_documento_corpus_id_fkey FOREIGN KEY (corpus_id) REFERENCES lex.corpus(id) ON DELETE CASCADE;
ALTER TABLE lex.corpus_documento ADD CONSTRAINT corpus_documento_fuente_id_fkey FOREIGN KEY (fuente_id) REFERENCES kag.documento_fuente(id);

-- ---------------------------------------------------------------------
--  lex.corrida · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE lex.corrida ADD CONSTRAINT corrida_corpus_id_fkey FOREIGN KEY (corpus_id) REFERENCES lex.corpus(id);
ALTER TABLE lex.corrida ADD CONSTRAINT corrida_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE lex.corrida ADD CONSTRAINT corrida_plan_paso_id_fkey FOREIGN KEY (plan_paso_id) REFERENCES analisis.plan_paso(id);

-- ---------------------------------------------------------------------
--  lex.diccionario · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE lex.diccionario ADD CONSTRAINT diccionario_autor_fkey FOREIGN KEY (autor) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  lex.diccionario_entrada · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE lex.diccionario_entrada ADD CONSTRAINT diccionario_entrada_diccionario_id_fkey FOREIGN KEY (diccionario_id) REFERENCES lex.diccionario(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  lex.serie · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE lex.serie ADD CONSTRAINT serie_diccionario_id_fkey FOREIGN KEY (diccionario_id) REFERENCES lex.diccionario(id);
ALTER TABLE lex.serie ADD CONSTRAINT serie_termino_id_fkey FOREIGN KEY (termino_id) REFERENCES lex.termino(id);

-- ---------------------------------------------------------------------
--  lex.uce · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE lex.uce ADD CONSTRAINT uce_corrida_id_fkey FOREIGN KEY (corrida_id) REFERENCES lex.corrida(id) ON DELETE CASCADE;
ALTER TABLE lex.uce ADD CONSTRAINT uce_fuente_id_fkey FOREIGN KEY (fuente_id) REFERENCES kag.documento_fuente(id);

-- ---------------------------------------------------------------------
--  model.model_card · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE model.model_card ADD CONSTRAINT fk_model_card_aplicacion ADD CONSTRAINT fk_model_card_aplicacion FOREIGN KEY (aplicacion_id) REFERENCES config.aplicacion(id) DEFERRABLE INITIALLY DEFERRED;;
ALTER TABLE model.model_card ADD CONSTRAINT model_card_libreria_id_fkey FOREIGN KEY (libreria_id) REFERENCES config.libreria(id);

-- ---------------------------------------------------------------------
--  mype.ejecucion_nec · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE mype.ejecucion_nec ADD CONSTRAINT ejecucion_nec_fuente_documento_id_fkey FOREIGN KEY (fuente_documento_id) REFERENCES kag.documento_fuente(id);
ALTER TABLE mype.ejecucion_nec ADD CONSTRAINT ejecucion_nec_mype_actor_uid_fkey FOREIGN KEY (mype_actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE mype.ejecucion_nec ADD CONSTRAINT ejecucion_nec_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE mype.ejecucion_nec ADD CONSTRAINT ejecucion_nec_tipo_artefacto_id_fkey FOREIGN KEY (tipo_artefacto_id) REFERENCES domain.tipo_artefacto(id);

-- ---------------------------------------------------------------------
--  pesca.licencia_cites_denp · 5 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE pesca.licencia_cites_denp ADD CONSTRAINT licencia_cites_denp_especie_id_fkey FOREIGN KEY (especie_id) REFERENCES core.cat_especies(id);
ALTER TABLE pesca.licencia_cites_denp ADD CONSTRAINT licencia_cites_denp_exportador_actor_uid_fkey FOREIGN KEY (exportador_actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE pesca.licencia_cites_denp ADD CONSTRAINT licencia_cites_denp_fuente_documento_id_fkey FOREIGN KEY (fuente_documento_id) REFERENCES kag.documento_fuente(id);
ALTER TABLE pesca.licencia_cites_denp ADD CONSTRAINT licencia_cites_denp_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE pesca.licencia_cites_denp ADD CONSTRAINT licencia_cites_denp_tipo_artefacto_id_fkey FOREIGN KEY (tipo_artefacto_id) REFERENCES domain.tipo_artefacto(id);

-- ---------------------------------------------------------------------
--  pesca.trazabilidad_qr · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE pesca.trazabilidad_qr ADD CONSTRAINT trazabilidad_qr_licencia_id_fkey FOREIGN KEY (licencia_id) REFERENCES pesca.licencia_cites_denp(id) ON DELETE CASCADE;
ALTER TABLE pesca.trazabilidad_qr ADD CONSTRAINT trazabilidad_qr_lugar_desembarque_id_fkey FOREIGN KEY (lugar_desembarque_id) REFERENCES territorio.lugares(id);
ALTER TABLE pesca.trazabilidad_qr ADD CONSTRAINT trazabilidad_qr_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  policy.escenario · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE policy.escenario ADD CONSTRAINT escenario_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  policy.escenario_regla · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE policy.escenario_regla ADD CONSTRAINT escenario_regla_escenario_id_fkey FOREIGN KEY (escenario_id) REFERENCES policy.escenario(id) ON DELETE CASCADE;
ALTER TABLE policy.escenario_regla ADD CONSTRAINT escenario_regla_regla_id_fkey FOREIGN KEY (regla_id) REFERENCES policy.regla(id);

-- ---------------------------------------------------------------------
--  policy.regla · 9 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE policy.regla ADD CONSTRAINT regla_aprobado_por_2_fkey FOREIGN KEY (aprobado_por_2) REFERENCES core.usuarios(id);
ALTER TABLE policy.regla ADD CONSTRAINT regla_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES core.usuarios(id);
ALTER TABLE policy.regla ADD CONSTRAINT regla_fuente_documento_id_fkey FOREIGN KEY (fuente_documento_id) REFERENCES kag.documento_fuente(id);
ALTER TABLE policy.regla ADD CONSTRAINT regla_gobierno_id_fkey FOREIGN KEY (gobierno_id) REFERENCES policy.gobierno(id);
ALTER TABLE policy.regla ADD CONSTRAINT regla_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE policy.regla ADD CONSTRAINT regla_propuesto_por_fkey FOREIGN KEY (propuesto_por) REFERENCES core.usuarios(id);
ALTER TABLE policy.regla ADD CONSTRAINT regla_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES policy.regla(id);
ALTER TABLE policy.regla ADD CONSTRAINT regla_tipo_regla_id_fkey FOREIGN KEY (tipo_regla_id) REFERENCES policy.cat_tipos_regla(id);
ALTER TABLE policy.regla ADD CONSTRAINT regla_titular_id_fkey FOREIGN KEY (titular_id) REFERENCES policy.titular(id);

-- ---------------------------------------------------------------------
--  policy.snapshot · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE policy.snapshot ADD CONSTRAINT snapshot_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  policy.snapshot_regla · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE policy.snapshot_regla ADD CONSTRAINT snapshot_regla_regla_id_fkey FOREIGN KEY (regla_id) REFERENCES policy.regla(id);
ALTER TABLE policy.snapshot_regla ADD CONSTRAINT snapshot_regla_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES policy.snapshot(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  policy.titular · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE policy.titular ADD CONSTRAINT titular_gobierno_id_fkey FOREIGN KEY (gobierno_id) REFERENCES policy.gobierno(id);

-- ---------------------------------------------------------------------
--  proteccion.registro_parametrico · 4 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE proteccion.registro_parametrico ADD CONSTRAINT registro_parametrico_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE proteccion.registro_parametrico ADD CONSTRAINT registro_parametrico_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE proteccion.registro_parametrico ADD CONSTRAINT registro_parametrico_fuente_documento_id_fkey FOREIGN KEY (fuente_documento_id) REFERENCES kag.documento_fuente(id);
ALTER TABLE proteccion.registro_parametrico ADD CONSTRAINT registro_parametrico_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);

-- ---------------------------------------------------------------------
--  qda.codigo · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE qda.codigo ADD CONSTRAINT codigo_libro_id_fkey FOREIGN KEY (libro_id) REFERENCES qda.libro_codigos(id) ON DELETE CASCADE;
ALTER TABLE qda.codigo ADD CONSTRAINT codigo_padre_id_fkey FOREIGN KEY (padre_id) REFERENCES qda.codigo(id);

-- ---------------------------------------------------------------------
--  qda.exportacion · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE qda.exportacion ADD CONSTRAINT exportacion_excepcion_aprobada_por_fkey FOREIGN KEY (excepcion_aprobada_por) REFERENCES core.usuarios(id);
ALTER TABLE qda.exportacion ADD CONSTRAINT exportacion_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES qda.proyecto(id);
ALTER TABLE qda.exportacion ADD CONSTRAINT exportacion_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES core.usuarios(id);

-- ---------------------------------------------------------------------
--  qda.fuente · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE qda.fuente ADD CONSTRAINT fuente_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES kag.documento_fuente(id);
ALTER TABLE qda.fuente ADD CONSTRAINT fuente_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES qda.proyecto(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  qda.libro_codigos · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE qda.libro_codigos ADD CONSTRAINT libro_codigos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES qda.proyecto(id);

-- ---------------------------------------------------------------------
--  qda.mapeo_pseudonimo · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE qda.mapeo_pseudonimo ADD CONSTRAINT mapeo_pseudonimo_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE qda.mapeo_pseudonimo ADD CONSTRAINT mapeo_pseudonimo_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE qda.mapeo_pseudonimo ADD CONSTRAINT mapeo_pseudonimo_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES qda.proyecto(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  qda.memo · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE qda.memo ADD CONSTRAINT memo_autor_fkey FOREIGN KEY (autor) REFERENCES core.usuarios(id);
ALTER TABLE qda.memo ADD CONSTRAINT memo_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE qda.memo ADD CONSTRAINT memo_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES qda.proyecto(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  qda.perdida_roundtrip · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE qda.perdida_roundtrip ADD CONSTRAINT perdida_roundtrip_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES qda.proyecto(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  qda.proyecto · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE qda.proyecto ADD CONSTRAINT proyecto_importado_por_fkey FOREIGN KEY (importado_por) REFERENCES core.usuarios(id);
ALTER TABLE qda.proyecto ADD CONSTRAINT proyecto_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE qda.proyecto ADD CONSTRAINT proyecto_plan_paso_id_fkey FOREIGN KEY (plan_paso_id) REFERENCES analisis.plan_paso(id);

-- ---------------------------------------------------------------------
--  qda.segmento · 5 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE qda.segmento ADD CONSTRAINT segmento_codificador_usuario_id_fkey FOREIGN KEY (codificador_usuario_id) REFERENCES core.usuarios(id);
ALTER TABLE qda.segmento ADD CONSTRAINT segmento_codigo_id_fkey FOREIGN KEY (codigo_id) REFERENCES qda.codigo(id);
ALTER TABLE qda.segmento ADD CONSTRAINT segmento_fuente_id_fkey FOREIGN KEY (fuente_id) REFERENCES qda.fuente(id) ON DELETE CASCADE;
ALTER TABLE qda.segmento ADD CONSTRAINT segmento_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE qda.segmento ADD CONSTRAINT segmento_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES qda.segmento(id);

-- ---------------------------------------------------------------------
--  qda.segmento_fragmento · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE qda.segmento_fragmento ADD CONSTRAINT segmento_fragmento_fragmento_id_fkey FOREIGN KEY (fragmento_id) REFERENCES kag.documento_fragmento(id);
ALTER TABLE qda.segmento_fragmento ADD CONSTRAINT segmento_fragmento_segmento_id_fkey FOREIGN KEY (segmento_id) REFERENCES qda.segmento(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  ref.base_legal_evidencia · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE ref.base_legal_evidencia ADD CONSTRAINT base_legal_evidencia_base_legal_id_fkey FOREIGN KEY (base_legal_id) REFERENCES ref.base_legal_tratamiento(id) ON DELETE CASCADE;
ALTER TABLE ref.base_legal_evidencia ADD CONSTRAINT base_legal_evidencia_fragmento_id_fkey FOREIGN KEY (fragmento_id) REFERENCES kag.documento_fragmento(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  ref.base_legal_tratamiento · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE ref.base_legal_tratamiento ADD CONSTRAINT base_legal_tratamiento_banco_datos_id_fkey FOREIGN KEY (banco_datos_id) REFERENCES core.banco_datos_tratamiento(id);

-- ---------------------------------------------------------------------
--  staging.lote · 5 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE staging.lote ADD CONSTRAINT lote_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES core.usuarios(id);
ALTER TABLE staging.lote ADD CONSTRAINT lote_cargado_por_fkey FOREIGN KEY (cargado_por) REFERENCES core.usuarios(id);
ALTER TABLE staging.lote ADD CONSTRAINT lote_nivel_clasificacion_fkey FOREIGN KEY (nivel_clasificacion) REFERENCES core.cat_clasificacion(nivel);
ALTER TABLE staging.lote ADD CONSTRAINT lote_plan_paso_id_fkey FOREIGN KEY (plan_paso_id) REFERENCES analisis.plan_paso(id);
ALTER TABLE staging.lote ADD CONSTRAINT lote_punto_ingesta_id_fkey FOREIGN KEY (punto_ingesta_id) REFERENCES analisis.punto_ingesta(id);

-- ---------------------------------------------------------------------
--  staging.registro · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE staging.registro ADD CONSTRAINT registro_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES staging.lote(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  territorio.caleta_detalle · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.caleta_detalle ADD CONSTRAINT caleta_detalle_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  territorio.certificaciones_planta · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.certificaciones_planta ADD CONSTRAINT certificaciones_planta_planta_id_fkey FOREIGN KEY (planta_id) REFERENCES territorio.planta_detalle(lugar_id);

-- ---------------------------------------------------------------------
--  territorio.cuadricula_sismica · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.cuadricula_sismica ADD CONSTRAINT cuadricula_sismica_fuente_documento_id_fkey FOREIGN KEY (fuente_documento_id) REFERENCES kag.documento_fuente(id);

-- ---------------------------------------------------------------------
--  territorio.desembarcadero_detalle · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.desembarcadero_detalle ADD CONSTRAINT desembarcadero_detalle_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  territorio.estacion_hidrica_detalle · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.estacion_hidrica_detalle ADD CONSTRAINT estacion_hidrica_detalle_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  territorio.expansion_informal · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.expansion_informal ADD CONSTRAINT expansion_informal_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id);

-- ---------------------------------------------------------------------
--  territorio.impacto_conflicto_planta · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE territorio.impacto_conflicto_planta ADD CONSTRAINT impacto_conflicto_planta_caso_id_fkey FOREIGN KEY (caso_id) REFERENCES core.casos(id);
ALTER TABLE territorio.impacto_conflicto_planta ADD CONSTRAINT impacto_conflicto_planta_planta_id_fkey FOREIGN KEY (planta_id) REFERENCES territorio.planta_detalle(lugar_id);

-- ---------------------------------------------------------------------
--  territorio.lugar_actores · 2 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE territorio.lugar_actores ADD CONSTRAINT lugar_actores_actor_uid_fkey FOREIGN KEY (actor_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE territorio.lugar_actores ADD CONSTRAINT lugar_actores_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id);

-- ---------------------------------------------------------------------
--  territorio.lugares · 3 claves ajenas
-- ---------------------------------------------------------------------
ALTER TABLE territorio.lugares ADD CONSTRAINT lugares_administrador_uid_fkey FOREIGN KEY (administrador_uid) REFERENCES core.actores(actor_uid);
ALTER TABLE territorio.lugares ADD CONSTRAINT lugares_distrito_id_fkey FOREIGN KEY (distrito_id) REFERENCES core.distritos(id);
ALTER TABLE territorio.lugares ADD CONSTRAINT lugares_tipo_id_fkey FOREIGN KEY (tipo_id) REFERENCES territorio.cat_tipos_lugar(id);

-- ---------------------------------------------------------------------
--  territorio.parque_industrial · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.parque_industrial ADD CONSTRAINT parque_industrial_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  territorio.patrones_seguridad_caleta · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.patrones_seguridad_caleta ADD CONSTRAINT patrones_seguridad_caleta_caleta_id_fkey FOREIGN KEY (caleta_id) REFERENCES territorio.caleta_detalle(lugar_id);

-- ---------------------------------------------------------------------
--  territorio.planta_detalle · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.planta_detalle ADD CONSTRAINT planta_detalle_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  territorio.terminal_detalle · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.terminal_detalle ADD CONSTRAINT terminal_detalle_lugar_id_fkey FOREIGN KEY (lugar_id) REFERENCES territorio.lugares(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
--  territorio.zona_pesca · 1 clave ajena
-- ---------------------------------------------------------------------
ALTER TABLE territorio.zona_pesca ADD CONSTRAINT zona_pesca_especie_id_fkey FOREIGN KEY (especie_id) REFERENCES core.cat_especies(id);

-- =====================================================================
--  PARA REAPLICAR: borrar antes las claves ajenas
-- =====================================================================
--  Esta consulta genera los DROP de todas las claves ajenas de los
--  esquemas del modelo. Se revisa y se ejecuta su salida:
--
--    SELECT format('ALTER TABLE %I.%I DROP CONSTRAINT %I;',
--                  n.nspname, c.relname, con.conname)
--    FROM pg_constraint con
--    JOIN pg_class c ON c.oid = con.conrelid
--    JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE con.contype = 'f'
--      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'legacy')
--    ORDER BY 1;
-- =====================================================================
