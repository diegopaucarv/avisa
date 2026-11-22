"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  AlertTriangle,
  Inbox,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

/**
 * Estados compartidos de interfaz para la demostración.
 * No representan mensajes institucionales: solo describen la vista actual.
 */

export function LoadingState({
  label = "Cargando datos demostrativos…",
  detail,
  compact = false,
  className = "",
}: {
  label?: string;
  detail?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`view-state view-state-loading ${compact ? "view-state--compact" : ""} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="view-state-spinner" aria-hidden="true">
        <LoaderCircle size={18} />
      </span>
      <p className="view-state-title">{label}</p>
      {detail ? <p className="view-state-description">{detail}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  compact = false,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  compact?: boolean;
  icon?: typeof Inbox;
  action?: ReactNode;
}) {
  return (
    <div
      className={`empty-state view-state view-state-empty ${compact ? "view-state--compact" : ""}`.trim()}
    >
      <span className="view-state-icon" aria-hidden="true">
        <Icon size={compact ? 16 : 20} />
      </span>
      <p className="view-state-title">{title}</p>
      {description ? (
        <p className="view-state-description">{description}</p>
      ) : null}
      {action ? <div className="view-state-actions">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "No se pudo cargar esta vista",
  description = "Ocurrió un problema en la demostración. Puedes reintentar sin perder el resto de la sesión.",
  onRetry,
  retryLabel = "Reintentar",
  compact = false,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`view-state view-state-error ${compact ? "view-state--compact" : ""}`.trim()}
      role="alert"
    >
      <span className="view-state-icon" aria-hidden="true">
        <AlertTriangle size={compact ? 16 : 20} />
      </span>
      <p className="view-state-title">{title}</p>
      <p className="view-state-description">{description}</p>
      {onRetry ? (
        <div className="view-state-actions">
          <button type="button" className="button-secondary" onClick={onRetry}>
            <RotateCcw size={14} /> {retryLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

type ViewErrorBoundaryProps = {
  children: ReactNode;
  title?: string;
  description?: string;
  onReset?: () => void;
};

type ViewErrorBoundaryState = { error: Error | null };

/**
 * Barrera local para que un fallo de una vista (por ejemplo, el módulo del
 * mapa) no deje el resto de la consola en blanco. El botón vuelve a montar
 * los hijos con la misma sesión de demostración.
 */
export class ViewErrorBoundary extends Component<
  ViewErrorBoundaryProps,
  ViewErrorBoundaryState
> {
  state: ViewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Fallo de vista en la demostración AVISA", error, info);
    }
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title={this.props.title}
          description={this.props.description}
          onRetry={this.reset}
        />
      );
    }
    return this.props.children;
  }
}
