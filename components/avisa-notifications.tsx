"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, CheckCheck, X } from "lucide-react";
import { useAvisa } from "@/lib/avisa-store";
import type {
  DemoNotification,
  DemoNotificationCategory,
  WorkspaceView,
} from "./avisa-demo-data";
import { parseDemoDateTime } from "./avisa-catalogs";
import { useAvisaPreferences } from "./avisa-preferences";
import { EmptyState } from "./avisa-view-state";

function isCategoryEnabled(
  category: DemoNotificationCategory,
  preferences: ReturnType<typeof useAvisaPreferences>,
) {
  if (category === "Sistema") return true;
  return preferences.notifications[category];
}

/**
 * Campana del encabezado con panel de notificaciones demostrativas.
 * El contador refleja solo avisos sin leer de las categorías habilitadas y se
 * oculta por completo cuando no hay pendientes.
 */
export function AvisaNotifications({
  onGoTo,
}: {
  onGoTo: (view: WorkspaceView, refCode?: string) => void;
}) {
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAvisa();
  const preferences = useAvisaPreferences();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () =>
      notifications.filter((item) =>
        isCategoryEnabled(item.categoria, preferences),
      ),
    [notifications, preferences],
  );
  const sorted = useMemo(() => {
    const stamp = (value: string) =>
      parseDemoDateTime(value)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return [...visible].sort((left, right) => stamp(right.fecha) - stamp(left.fecha));
  }, [visible]);
  const unread = visible.filter((item) => !item.leida).length;

  useEffect(() => {
    if (!open) return;
    const opener = buttonRef.current;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      opener?.focus();
    };
  }, [open]);

  const openRecord = (item: DemoNotification) => {
    markNotificationRead(item.id);
    onGoTo(item.view, item.refCode);
    setOpen(false);
  };

  const bellLabel = unread
    ? `Notificaciones: ${unread} sin leer`
    : "Notificaciones: sin avisos pendientes";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`header-icon-button notification-button ${open ? "icon-active" : ""}`}
        aria-label={bellLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {unread
          ? `${unread} notificaciones sin leer de categorías habilitadas.`
          : "No hay notificaciones sin leer."}
      </span>
      {open && (
        <div
          ref={panelRef}
          id="notification-panel"
          className="notification-panel"
          role="dialog"
          aria-labelledby="notification-panel-title"
        >
          <div className="notification-panel-head">
            <div>
              <p className="section-eyebrow">CENTRO DE NOTIFICACIONES</p>
              <h3 id="notification-panel-title">Notificaciones</h3>
              <span className="form-hint">
                {unread} sin leer · {sorted.length} en total · datos de
                demostración
              </span>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Cerrar notificaciones"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="notification-panel-tools">
            <button
              type="button"
              className="button-secondary"
              onClick={() => markAllNotificationsRead()}
              disabled={unread === 0}
            >
              <CheckCheck size={14} /> Marcar todas como leídas
            </button>
            <span className="result-count" aria-hidden="true">
              {unread} sin leer
            </span>
          </div>
          {sorted.length === 0 ? (
            <EmptyState
              compact
              title="Sin notificaciones"
              description="No hay avisos derivados de los datos demostrativos para las categorías habilitadas."
            />
          ) : (
            <ul
              className="notification-list"
              aria-label="Notificaciones de demostración"
            >
              {sorted.map((item) => (
                <li
                  key={item.id}
                  className={`notification-item ${item.leida ? "" : "unread"}`}
                >
                  <div className="notification-item-head">
                    <span
                      className={`notification-cat cat-${item.categoria.toLowerCase()}`}
                    >
                      {item.categoria}
                    </span>
                    <time>{item.fecha}</time>
                    <span className="notification-state">
                      {item.leida ? "Leída" : "Sin leer"}
                    </span>
                  </div>
                  <strong>{item.titulo}</strong>
                  <p>{item.detalle}</p>
                  <div className="notification-actions">
                    {!item.leida && (
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => markNotificationRead(item.id)}
                      >
                        Marcar como leída
                      </button>
                    )}
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => openRecord(item)}
                    >
                      Abrir registro <ArrowRight size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="pref-note">
            Los avisos se derivan de los registros de esta sesión. Las
            categorías desactivadas se ocultan desde Preferencias.
          </p>
        </div>
      )}
    </>
  );
}
