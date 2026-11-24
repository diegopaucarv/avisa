import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { urlApi } from '../../core/config/entorno';
import {
  normalizarColeccion,
  paramsDePagina,
  urlConParametros,
  type Coleccion,
} from '../../core/http/coleccion';
import { aErrorApi } from '../../core/http/errores';
import { esRegistro, lista } from '../../dominio/mapeo';
import {
  aCatalogoAdmin,
  aConfiguracionItem,
  aListaBlancaItem,
  aMigracionItem,
  aResumenAdmin,
  aRolDisponible,
  aUsuarioAdmin,
  type CatalogoAdmin,
  type ConfiguracionItem,
  type ListaBlancaItem,
  type MigracionItem,
  type ResumenAdmin,
  type RolDisponible,
  type UsuarioAdmin,
} from './administracion.modelos';

export type UsuariosPagina = {
  usuarios: Coleccion<UsuarioAdmin>;
  rolesDisponibles: RolDisponible[];
};

export type ListaBlancaPagina = {
  items: ListaBlancaItem[];
  maximoServidorBytes: number;
};

export type NuevoUsuarioAdmin = {
  nombre: string;
  dni: string;
  email: string | null;
  cargo: string | null;
  clave: string;
  rolCodigo: string;
};

export type NuevaListaBlanca = {
  mime: string;
  extension: string | null;
  activo: boolean;
  nota: string | null;
};

/**
 * Única puerta de la SPA a `/api/v1/admin`.
 *
 * Todos los errores se normalizan con `aErrorApi`: los componentes nunca leen
 * `HttpErrorResponse`. Las escrituras devuelven el registro ya releído por la
 * API, para que la tabla no tenga que reconstruirlo a mano.
 */
@Injectable({ providedIn: 'root' })
export class AdministracionService {
  private readonly http = inject(HttpClient);

  async resumen(): Promise<ResumenAdmin> {
    return aResumenAdmin(await this.pedir(urlApi('/v1/admin')));
  }

  async usuarios(
    q: string,
    pagina: number,
    tamano: number,
  ): Promise<UsuariosPagina> {
    const url = urlConParametros(urlApi('/v1/admin/usuarios'), {
      q,
      ...paramsDePagina({ pagina, tamano }),
    });
    const bruto = await this.pedir(url);
    const coleccion = normalizarColeccion<unknown>(bruto);
    return {
      usuarios: {
        ...coleccion,
        elementos: coleccion.elementos.map(aUsuarioAdmin),
      },
      rolesDisponibles: esRegistro(bruto)
        ? lista(bruto, ['rolesDisponibles']).map(aRolDisponible)
        : [],
    };
  }

  async crearUsuario(input: NuevoUsuarioAdmin): Promise<UsuarioAdmin> {
    const bruto = await this.enviar('POST', urlApi('/v1/admin/usuarios'), input);
    return aUsuarioAdmin(esRegistro(bruto) ? bruto['usuario'] : null);
  }

  async cambiarEstado(id: string, activo: boolean): Promise<UsuarioAdmin> {
    const url = urlApi(`/v1/admin/usuarios/${encodeURIComponent(id)}`);
    const bruto = await this.enviar('PATCH', url, { activo });
    return aUsuarioAdmin(esRegistro(bruto) ? bruto['usuario'] : null);
  }

  async cambiarRol(id: string, rolCodigo: string): Promise<UsuarioAdmin> {
    const url = urlApi(`/v1/admin/usuarios/${encodeURIComponent(id)}/rol`);
    const bruto = await this.enviar('PUT', url, { rolCodigo });
    return aUsuarioAdmin(esRegistro(bruto) ? bruto['usuario'] : null);
  }

  async catalogos(): Promise<CatalogoAdmin[]> {
    const bruto = await this.pedir(urlApi('/v1/admin/catalogos'));
    return esRegistro(bruto) ? lista(bruto, ['catalogos']).map(aCatalogoAdmin) : [];
  }

  async actualizarCatalogo(
    catalogo: string,
    id: number,
    cambios: Record<string, unknown>,
  ): Promise<CatalogoAdmin> {
    const url = urlApi(
      `/v1/admin/catalogos/${encodeURIComponent(catalogo)}/${id}`,
    );
    const bruto = await this.enviar('PATCH', url, cambios);
    return aCatalogoAdmin(esRegistro(bruto) ? bruto['catalogo'] : null);
  }

  async eliminarCatalogo(
    catalogo: string,
    id: number,
  ): Promise<CatalogoAdmin> {
    const url = urlApi(
      `/v1/admin/catalogos/${encodeURIComponent(catalogo)}/${id}`,
    );
    const bruto = await this.enviar('DELETE', url);
    return aCatalogoAdmin(esRegistro(bruto) ? bruto['catalogo'] : null);
  }

  async listaBlanca(): Promise<ListaBlancaPagina> {
    const bruto = await this.pedir(urlApi('/v1/admin/lista-blanca'));
    const items = esRegistro(bruto) ? lista(bruto, ['items']).map(aListaBlancaItem) : [];
    const maximo =
      esRegistro(bruto) && typeof bruto['maximoServidorBytes'] === 'number'
        ? bruto['maximoServidorBytes']
        : 0;
    return { items, maximoServidorBytes: maximo };
  }

  async crearListaBlanca(input: NuevaListaBlanca): Promise<ListaBlancaItem> {
    const bruto = await this.enviar('POST', urlApi('/v1/admin/lista-blanca'), input);
    return aListaBlancaItem(esRegistro(bruto) ? bruto['item'] : null);
  }

  async actualizarListaBlanca(
    mime: string,
    cambios: { extension: string | null; activo: boolean; nota: string | null },
  ): Promise<ListaBlancaItem> {
    const bruto = await this.enviar('PATCH', urlApi('/v1/admin/lista-blanca'), {
      mime,
      ...cambios,
    });
    return aListaBlancaItem(esRegistro(bruto) ? bruto['item'] : null);
  }

  async eliminarListaBlanca(mime: string): Promise<void> {
    const url = urlConParametros(urlApi('/v1/admin/lista-blanca'), { mime });
    await this.enviar('DELETE', url);
  }

  async configuracion(): Promise<ConfiguracionItem[]> {
    const bruto = await this.pedir(urlApi('/v1/admin/configuracion'));
    return esRegistro(bruto) ? lista(bruto, ['items']).map(aConfiguracionItem) : [];
  }

  async guardarConfiguracion(
    clave: string,
    valor: string,
    descripcion: string | null,
  ): Promise<ConfiguracionItem> {
    const url = urlApi(`/v1/admin/configuracion/${encodeURIComponent(clave)}`);
    const bruto = await this.enviar('PUT', url, { valor, descripcion });
    return aConfiguracionItem(esRegistro(bruto) ? bruto['item'] : null);
  }

  async migraciones(): Promise<MigracionItem[]> {
    const bruto = await this.pedir(urlApi('/v1/admin/migraciones'));
    return esRegistro(bruto) ? lista(bruto, ['items']).map(aMigracionItem) : [];
  }

  private async pedir(url: string): Promise<unknown> {
    try {
      return await firstValueFrom(this.http.get<unknown>(url));
    } catch (fallo) {
      throw aErrorApi(fallo, 'No se pudo consultar la administración.');
    }
  }

  private async enviar(
    metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    cuerpo?: unknown,
  ): Promise<unknown> {
    try {
      if (metodo === 'DELETE') {
        return await firstValueFrom(this.http.delete<unknown>(url));
      }
      return await firstValueFrom(
        this.http.request<unknown>(metodo, url, { body: cuerpo }),
      );
    } catch (fallo) {
      throw aErrorApi(fallo, 'No se pudo guardar el cambio.');
    }
  }
}
