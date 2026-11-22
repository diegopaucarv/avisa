import { getPool } from "../pool";

export type CatalogItem = {
  id: number;
  codigo: string;
  etiqueta: string;
  [key: string]: unknown;
};

async function query(sql: string): Promise<CatalogItem[]> {
  const result = await getPool().query<CatalogItem>(sql);
  return result.rows;
}

export type Catalogs = {
  estadosCaso: CatalogItem[];
  nivelesRiesgo: CatalogItem[];
  nivelesConflicto: CatalogItem[];
  prioridadesAtencion: CatalogItem[];
  prioridadesAlerta: CatalogItem[];
  alcances: CatalogItem[];
  tematicas: CatalogItem[];
  subsectores: CatalogItem[];
  ciclos: CatalogItem[];
  unidades: CatalogItem[];
  tiposDocumento: CatalogItem[];
  estadosCompromiso: CatalogItem[];
  estadosHito: CatalogItem[];
  tiposActor: CatalogItem[];
  rolesActor: CatalogItem[];
  perfilesActor: CatalogItem[];
};

/**
 * Catálogos del dominio. No tienen RLS: son vocabulario de referencia.
 * Se devuelven completos para que la interfaz no vuelva a codificar etiquetas.
 */
export async function getCatalogs(): Promise<Catalogs> {
  const [
    estadosCaso,
    nivelesRiesgo,
    nivelesConflicto,
    prioridadesAtencion,
    prioridadesAlerta,
    alcances,
    tematicas,
    subsectores,
    ciclos,
    unidades,
    tiposDocumento,
    estadosCompromiso,
    estadosHito,
    tiposActor,
    rolesActor,
    perfilesActor,
  ] = await Promise.all([
    query(
      `select id, replace(codigo, '_', ' ') as codigo, replace(codigo, '_', ' ') as etiqueta,
              es_activo
         from core.cat_estados_caso
        order by id`,
    ),
    query(
      `select id, codigo, codigo as etiqueta, orden
         from core.cat_niveles_riesgo
        order by orden`,
    ),
    query(
      `select id, codigo, nombre as etiqueta, orden
         from core.cat_niveles_conflicto
        order by orden`,
    ),
    query(
      `select id, codigo, codigo as etiqueta, orden
         from core.cat_prioridades_atencion
        order by orden`,
    ),
    query(
      `select id, replace(codigo, '_', ' ') as codigo,
              replace(codigo, '_', ' ') as etiqueta, sla_horas, es_grave
         from core.cat_prioridades_alerta
        order by id`,
    ),
    query(
      `select id, codigo, codigo as etiqueta
         from core.cat_alcances_geograficos
        order by id`,
    ),
    query(
      `select id, nombre as codigo, nombre as etiqueta
         from core.cat_tematicas
        order by nombre`,
    ),
    query(
      `select id, nombre as codigo, nombre as etiqueta
         from core.cat_subsectores
        order by nombre`,
    ),
    query(
      `select id, nombre as codigo, nombre as etiqueta
         from core.cat_ciclos_intervencion
        order by id`,
    ),
    query(
      `select id, siglas as codigo, coalesce(nombre_completo, siglas) as etiqueta, estado
         from core.cat_unidades_organicas
        order by siglas`,
    ),
    query(
      `select id, codigo, nombre as etiqueta, anexo_numero
         from core.cat_tipos_documento
        order by id`,
    ),
    query(
      `select id, replace(codigo, '_', ' ') as codigo,
              replace(codigo, '_', ' ') as etiqueta, categoria, es_terminal
         from core.cat_estados_compromiso
        order by id`,
    ),
    query(
      `select id, replace(codigo, '_', ' ') as codigo,
              replace(codigo, '_', ' ') as etiqueta, es_terminal
         from core.cat_estados_hito
        order by id`,
    ),
    query(
      `select id, nombre as codigo, nombre as etiqueta
         from core.cat_tipos_actor
        order by nombre`,
    ),
    query(
      `select id, replace(nombre, '_', ' ') as codigo,
              replace(nombre, '_', ' ') as etiqueta
         from core.cat_roles_actor
        order by id`,
    ),
    query(
      `select id, nombre as codigo, nombre as etiqueta
         from core.cat_perfiles_actor
        order by id`,
    ),
  ]);

  return {
    estadosCaso,
    nivelesRiesgo,
    nivelesConflicto,
    prioridadesAtencion,
    prioridadesAlerta,
    alcances,
    tematicas,
    subsectores,
    ciclos,
    unidades,
    tiposDocumento,
    estadosCompromiso,
    estadosHito,
    tiposActor,
    rolesActor,
    perfilesActor,
  };
}
