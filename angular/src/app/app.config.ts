import { registerLocaleData } from '@angular/common';
import localeEsPe from '@angular/common/locales/es-PE';
import {
  ApplicationConfig,
  LOCALE_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { sesionInterceptor } from './core/auth/sesion.interceptor';
import { SesionStore } from './core/auth/sesion.store';
import { TemaService } from './core/tema/tema.service';

registerLocaleData(localeEsPe, 'es-PE');

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),
    provideHttpClient(withFetch(), withInterceptors([sesionInterceptor])),
    { provide: LOCALE_ID, useValue: 'es-PE' },

    /**
     * Hidratación de la sesión antes del primer pintado: sin esto habría un
     * parpadeo de login al recargar. Un 401 se resuelve como "anónimo".
     */
    provideAppInitializer(() => inject(SesionStore).restaurar()),

    /**
     * Una sola fuente de verdad para el tema: instanciar el servicio aquí
     * garantiza que `data-theme` / `data-density` se apliquen al arrancar y
     * que la hidratación desde el servidor ocurra aunque nadie abra
     * Preferencias. El efecto interno se encarga de los cambios posteriores.
     */
    provideAppInitializer(() => inject(TemaService).aplicarActual()),
  ],
};
