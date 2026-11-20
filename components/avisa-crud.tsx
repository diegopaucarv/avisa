"use client";

import { useState, type ReactNode } from "react";
import { Pencil, Plus, Upload, X } from "lucide-react";
import {
  docKindLabels,
  type DemoAlert,
  type DemoCase,
  type DemoCommitment,
  type DocKind,
} from "./avisa-demo-data";
import { useAvisa } from "@/lib/avisa-store";

export function FormDrawer({
  open,
  title,
  description,
  onClose,
  onSubmit,
  submitLabel = "Guardar",
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Cerrar formulario"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <form
          className="drawer-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="drawer-body">{children}</div>
          <div className="drawer-foot">
            <button
              type="button"
              className="button-secondary"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button className="button-primary" type="submit">
              {submitLabel}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      {children}
      {hint && <small className="form-hint">{hint}</small>}
    </label>
  );
}

export function DeleteButton({
  onConfirm,
  label = "Eliminar",
  confirmText = "¿Eliminar este registro de la demostración?",
}: {
  onConfirm: () => void;
  label?: string;
  confirmText?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <button className="link-danger" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  return (
    <span className="confirm-inline">
      {confirmText}
      <button
        className="button-danger"
        onClick={() => {
          onConfirm();
          setArmed(false);
        }}
      >
        Sí, eliminar
      </button>
      <button className="button-secondary" onClick={() => setArmed(false)}>
        Cancelar
      </button>
    </span>
  );
}

export function CaseForm({ item }: { item?: DemoCase } = {}) {
  const { createCase, updateCase } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    title: item?.title ?? "",
    region: item?.region ?? "Piura · Paita",
    subject: item?.subject ?? "Pesca artesanal",
    risk: item?.risk ?? ("Moderado" as DemoCase["risk"]),
    stage: item?.stage ?? "Activo",
    summary: item?.summary ?? "",
    nivelConflicto:
      item?.nivelConflicto ??
      ("Medio" as NonNullable<DemoCase["nivelConflicto"]>),
    alcance: item?.alcance ?? ("Norte" as NonNullable<DemoCase["alcance"]>),
    tematica: item?.tematica ?? "",
    unidadResponsable: item?.unidadResponsable ?? "OAIPCS",
    puntoFocal: item?.puntoFocal ?? "",
  }));
  const submit = () => {
    if (!form.title.trim())
      return setError("El nombre del caso es obligatorio.");
    if (!form.summary.trim())
      return setError("Registra al menos un resumen del riesgo.");
    if (item) {
      updateCase(item.code, { ...form });
      setOpen(false);
      setError("");
      return;
    }
    createCase({ ...form, origen: "Manual" });
    setOpen(false);
    setError("");
    setForm((prev) => ({
      ...prev,
      title: "",
      summary: "",
      tematica: "",
      puntoFocal: "",
    }));
  };
  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)}>
        {item ? (
          <>
            <Pencil size={14} />
            Editar caso
          </>
        ) : (
          <>
            <Plus size={15} />
            Nuevo caso
          </>
        )}
      </button>
      <FormDrawer
        open={open}
        title={item ? `Editar ${item.code}` : "Nuevo caso"}
        description={
          item
            ? "La modificación queda registrada; la validación humana del caso no cambia."
            : "Alta manual. Queda sin validar hasta la revisión humana."
        }
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={item ? "Guardar cambios" : "Crear caso"}
      >
        <Field label="Nombre del caso">
          <input
            className="form-input"
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            placeholder="Ej.: Acceso a zona de desembarque"
          />
        </Field>
        <div className="form-grid">
          <Field label="Distrito / territorio">
            <input
              className="form-input"
              value={form.region}
              onChange={(event) =>
                setForm({ ...form, region: event.target.value })
              }
            />
          </Field>
          <Field label="Subsector">
            <input
              className="form-input"
              value={form.subject}
              onChange={(event) =>
                setForm({ ...form, subject: event.target.value })
              }
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field
            label="Nivel de conflicto"
            hint="Hechos observables (4 niveles)"
          >
            <select
              className="form-select"
              value={form.nivelConflicto}
              onChange={(event) =>
                setForm({
                  ...form,
                  nivelConflicto: event.target.value as NonNullable<
                    DemoCase["nivelConflicto"]
                  >,
                })
              }
            >
              <option>Bajo</option>
              <option>Medio</option>
              <option>Alto</option>
              <option>Muy alto</option>
            </select>
          </Field>
          <Field label="Nivel de riesgo" hint="Probabilidad de escalamiento">
            <select
              className="form-select"
              value={form.risk}
              onChange={(event) =>
                setForm({
                  ...form,
                  risk: event.target.value as DemoCase["risk"],
                })
              }
            >
              <option>Alto</option>
              <option>Moderado</option>
              <option>Bajo</option>
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Alcance">
            <select
              className="form-select"
              value={form.alcance}
              onChange={(event) =>
                setForm({
                  ...form,
                  alcance: event.target.value as NonNullable<
                    DemoCase["alcance"]
                  >,
                })
              }
            >
              <option>Norte</option>
              <option>Centro</option>
              <option>Sur</option>
              <option>Oriente</option>
              <option>Nacional</option>
            </select>
          </Field>
          <Field label="Estado">
            <select
              className="form-select"
              value={form.stage}
              onChange={(event) =>
                setForm({ ...form, stage: event.target.value })
              }
            >
              <option>Activo</option>
              <option>En seguimiento</option>
              <option>Resuelto</option>
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Unidad responsable">
            <input
              className="form-input"
              value={form.unidadResponsable}
              onChange={(event) =>
                setForm({ ...form, unidadResponsable: event.target.value })
              }
            />
          </Field>
          <Field label="Punto focal">
            <input
              className="form-input"
              value={form.puntoFocal}
              onChange={(event) =>
                setForm({ ...form, puntoFocal: event.target.value })
              }
              placeholder="Alias, sin datos personales"
            />
          </Field>
        </div>
        <Field label="Temática">
          <input
            className="form-input"
            value={form.tematica}
            onChange={(event) =>
              setForm({ ...form, tematica: event.target.value })
            }
            placeholder="Ej.: Vías de acceso"
          />
        </Field>
        <Field label="Descripción del riesgo">
          <textarea
            className="form-textarea"
            value={form.summary}
            onChange={(event) =>
              setForm({ ...form, summary: event.target.value })
            }
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}

export function AlertForm({
  caseCode,
  item,
}: {
  caseCode?: string;
  item?: DemoAlert;
}) {
  const { cases, createAlert, updateAlert } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    caseCode: item?.caseCode ?? caseCode ?? "",
    title: item?.title ?? "",
    location: item?.location ?? "",
    source: item?.source ?? "",
    published: item?.published ?? "19 nov · 10:24",
    priority: (item?.priority ?? "Alta") as NonNullable<
      "Crítica" | "Alta" | "Media"
    >,
    quote: item?.quote ?? "",
    note: item?.note ?? "",
    riesgos: item?.riesgos?.join(", ") ?? "",
    acciones: item?.acciones?.join(", ") ?? "",
  }));
  const sla =
    form.priority === "Crítica" ? 24 : form.priority === "Alta" ? 48 : 72;
  const submit = () => {
    if (!form.title.trim())
      return setError("El título de la alerta es obligatorio.");
    if (!form.quote.trim())
      return setError(
        "La cita textual es obligatoria: debe coincidir con la fuente (G20).",
      );
    const related = cases.find((row) => row.code === form.caseCode);
    const riesgos = form.riesgos
      ? form.riesgos
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
    const acciones = form.acciones
      ? form.acciones
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
    if (item) {
      updateAlert(item.id, {
        title: form.title,
        location: form.location || related?.region || item.location,
        source: form.source || item.source,
        published: form.published,
        priority: form.priority,
        quote: form.quote,
        note: form.note || item.note,
        caseCode: form.caseCode || undefined,
        slaHours: sla,
        riesgos,
        acciones,
      });
      setOpen(false);
      setError("");
      return;
    }
    createAlert({
      title: form.title,
      location: form.location || related?.region || "Sin territorio",
      source: form.source || "Registro manual",
      published: form.published,
      priority: form.priority,
      quote: form.quote,
      note:
        form.note ||
        "Registro manual del prototipo, pendiente de verificación.",
      caseCode: form.caseCode || undefined,
      slaHours: sla,
      origen: "Manual",
      riesgos,
      acciones,
    });
    setOpen(false);
    setError("");
    setForm((prev) => ({
      ...prev,
      title: "",
      quote: "",
      note: "",
      source: "",
      riesgos: "",
      acciones: "",
    }));
  };
  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)}>
        {item ? <Pencil size={14} /> : <Plus size={15} />}
        {item ? "Editar alerta" : "Nueva alerta"}
      </button>
      <FormDrawer
        open={open}
        title={item ? `Editar ${item.id}` : "Nueva alerta temprana"}
        description={
          item
            ? "La cita textual sigue siendo obligatoria (G20)."
            : "Prioridad con SLA y cita textual obligatoria."
        }
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={item ? "Guardar cambios" : "Registrar alerta"}
      >
        <Field label="Caso vinculado">
          <select
            className="form-select"
            value={form.caseCode}
            onChange={(event) =>
              setForm({ ...form, caseCode: event.target.value })
            }
          >
            <option value="">Sin caso</option>
            {cases.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título">
          <input
            className="form-input"
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Prioridad">
            <select
              className="form-select"
              value={form.priority}
              onChange={(event) =>
                setForm({
                  ...form,
                  priority: event.target.value as "Crítica" | "Alta" | "Media",
                })
              }
            >
              <option>Crítica</option>
              <option>Alta</option>
              <option>Media</option>
            </select>
          </Field>
          <Field
            label="Plazo máximo de atención"
            hint="Derivado de la prioridad (Anexo 3)"
          >
            <input className="form-input" value={`${sla} horas`} readOnly />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Territorio">
            <input
              className="form-input"
              value={form.location}
              onChange={(event) =>
                setForm({ ...form, location: event.target.value })
              }
              placeholder="Heredado del caso si se deja vacío"
            />
          </Field>
          <Field label="Fuente autorizada">
            <input
              className="form-input"
              value={form.source}
              onChange={(event) =>
                setForm({ ...form, source: event.target.value })
              }
            />
          </Field>
        </div>
        <Field
          label="Cita textual"
          hint="Debe coincidir literalmente con el texto de la fuente."
        >
          <textarea
            className="form-textarea"
            value={form.quote}
            onChange={(event) =>
              setForm({ ...form, quote: event.target.value })
            }
          />
        </Field>
        <Field label="Nota de verificación">
          <textarea
            className="form-textarea"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Riesgos identificados">
            <input
              className="form-input"
              value={form.riesgos}
              onChange={(event) =>
                setForm({ ...form, riesgos: event.target.value })
              }
              placeholder="Separados por coma"
            />
          </Field>
          <Field label="Acciones sugeridas">
            <input
              className="form-input"
              value={form.acciones}
              onChange={(event) =>
                setForm({ ...form, acciones: event.target.value })
              }
              placeholder="Separadas por coma"
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}

export function CommitmentForm({
  caseCode,
  item,
}: {
  caseCode?: string;
  item?: DemoCommitment;
}) {
  const { cases, createCommitment, updateCommitment } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    caseCode: item?.caseCode ?? caseCode ?? cases[0]?.code ?? "",
    title: item?.title ?? "",
    tipo: item?.tipo ?? ("Actividad" as NonNullable<DemoCommitment["tipo"]>),
    owner: item?.owner ?? "",
    nivelGobierno:
      item?.nivelGobierno ??
      ("Nacional" as NonNullable<DemoCommitment["nivelGobierno"]>),
    due: item?.due ?? "",
    atiendeGenero: item?.atiendeGenero ?? false,
    unidadResponsable: item?.unidadResponsable ?? "",
    evidenciaUri: item?.evidenciaUri ?? "",
    status: item?.status ?? ("En curso" as DemoCommitment["status"]),
    progress: item?.progress ?? 0,
  }));
  const submit = () => {
    if (!form.caseCode)
      return setError("Selecciona el caso al que pertenece el compromiso.");
    if (!form.title.trim())
      return setError("La acción del compromiso es obligatoria.");
    if (!form.due.trim())
      return setError("Indica el vencimiento del compromiso.");
    if (item) {
      updateCommitment(item.id, {
        title: form.title,
        caseCode: form.caseCode,
        owner: form.owner || "Por asignar",
        due: form.due,
        status: form.status,
        progress: Number(form.progress) || 0,
        tipo: form.tipo,
        nivelGobierno: form.nivelGobierno,
        atiendeGenero: form.atiendeGenero,
        unidadResponsable: form.unidadResponsable || undefined,
        evidenciaUri: form.evidenciaUri || undefined,
      });
      setOpen(false);
      setError("");
      return;
    }
    createCommitment({
      title: form.title,
      caseCode: form.caseCode,
      owner: form.owner || "Por asignar",
      due: form.due,
      status: "En curso",
      progress: 0,
      tipo: form.tipo,
      nivelGobierno: form.nivelGobierno,
      atiendeGenero: form.atiendeGenero,
      unidadResponsable: form.unidadResponsable || undefined,
      origen: "Manual",
    });
    setOpen(false);
    setError("");
    setForm((prev) => ({ ...prev, title: "", owner: "", due: "" }));
  };
  return (
    <>
      <button
        className={item ? "table-link" : "button-secondary"}
        onClick={() => setOpen(true)}
      >
        {item ? (
          <>
            <Pencil size={13} />
            Editar
          </>
        ) : (
          <>
            <Plus size={15} />
            Nuevo compromiso
          </>
        )}
      </button>
      <FormDrawer
        open={open}
        title={item ? `Editar ${item.id}` : "Nuevo compromiso"}
        description="Acción verificable con responsable y plazo."
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={item ? "Guardar cambios" : "Registrar compromiso"}
      >
        <Field label="Caso">
          <select
            className="form-select"
            value={form.caseCode}
            onChange={(event) =>
              setForm({ ...form, caseCode: event.target.value })
            }
          >
            {cases.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Acción comprometida">
          <textarea
            className="form-textarea"
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Tipo">
            <select
              className="form-select"
              value={form.tipo}
              onChange={(event) =>
                setForm({
                  ...form,
                  tipo: event.target.value as NonNullable<
                    DemoCommitment["tipo"]
                  >,
                })
              }
            >
              <option>Actividad</option>
              <option>PIP</option>
            </select>
          </Field>
          <Field label="Nivel de gobierno">
            <select
              className="form-select"
              value={form.nivelGobierno}
              onChange={(event) =>
                setForm({
                  ...form,
                  nivelGobierno: event.target.value as NonNullable<
                    DemoCommitment["nivelGobierno"]
                  >,
                })
              }
            >
              <option>Nacional</option>
              <option>Regional</option>
              <option>Local</option>
              <option>Empresa</option>
              <option>Sociedad Civil</option>
            </select>
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Responsable / unidad">
            <input
              className="form-input"
              value={form.owner}
              onChange={(event) =>
                setForm({ ...form, owner: event.target.value })
              }
            />
          </Field>
          <Field label="Vencimiento">
            <input
              className="form-input"
              value={form.due}
              onChange={(event) =>
                setForm({ ...form, due: event.target.value })
              }
              placeholder="Ej.: 24 nov 2026"
            />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Unidad responsable">
            <input
              className="form-input"
              value={form.unidadResponsable}
              onChange={(event) =>
                setForm({ ...form, unidadResponsable: event.target.value })
              }
              placeholder="Oficina o dirección a cargo"
            />
          </Field>
          <Field label="Evidencia (URI)" hint="Enlace al medio de verificación">
            <input
              className="form-input"
              value={form.evidenciaUri}
              onChange={(event) =>
                setForm({ ...form, evidenciaUri: event.target.value })
              }
              placeholder="https://…"
            />
          </Field>
        </div>
        {item && (
          <div className="form-grid">
            <Field label="Estado">
              <select
                className="form-select"
                value={form.status}
                onChange={(event) =>
                  setForm({
                    ...form,
                    status: event.target.value as DemoCommitment["status"],
                  })
                }
              >
                <option>En curso</option>
                <option>Por vencer</option>
                <option>Vencido</option>
                <option>Cumplido</option>
              </select>
            </Field>
            <Field label="Avance (%) ">
              <input
                className="form-input"
                type="number"
                min="0"
                max="100"
                value={form.progress}
                onChange={(event) =>
                  setForm({ ...form, progress: Number(event.target.value) })
                }
              />
            </Field>
          </div>
        )}
        <Field label="Atiende brecha de género">
          <select
            className="form-select"
            value={form.atiendeGenero ? "Sí" : "No"}
            onChange={(event) =>
              setForm({ ...form, atiendeGenero: event.target.value === "Sí" })
            }
          >
            <option>No</option>
            <option>Sí</option>
          </select>
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}

export function DocumentUploadForm({ caseCode }: { caseCode?: string } = {}) {
  const { addDocument, cases } = useAvisa();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    kind: "relatoria" as DocKind,
    titulo: "",
    fecha: "2026-11-19",
    archivo: "",
    origen: "Ingesta" as NonNullable<"Manual" | "Ingesta">,
    casoCode: caseCode ?? "",
    texto: "",
  });
  const submit = () => {
    if (!form.titulo.trim())
      return setError("El título del documento es obligatorio.");
    if (!form.archivo && !form.texto.trim())
      return setError("Adjunta un archivo o pega el texto a analizar.");
    addDocument({
      kind: form.kind,
      titulo: form.titulo,
      fecha: form.fecha,
      archivo: form.archivo || `${form.kind}.txt`,
      origen: form.origen,
      casoCode: form.casoCode || undefined,
      texto: form.texto,
    });
    setOpen(false);
    setError("");
    setForm((prev) => ({ ...prev, titulo: "", archivo: "", texto: "" }));
  };
  return (
    <>
      <button className="button-primary" onClick={() => setOpen(true)}>
        <Upload size={15} />
        Cargar documento
      </button>
      <FormDrawer
        open={open}
        title="Cargar documento"
        description="Relatoría, entrevista, informe, acta o dato externo. La extracción se revisa después."
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel="Cargar y encolar"
      >
        <Field label="Tipo de documento">
          <select
            className="form-select"
            value={form.kind}
            onChange={(event) =>
              setForm({ ...form, kind: event.target.value as DocKind })
            }
          >
            {(Object.keys(docKindLabels) as DocKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {docKindLabels[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Título">
          <input
            className="form-input"
            value={form.titulo}
            onChange={(event) =>
              setForm({ ...form, titulo: event.target.value })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Fecha del documento">
            <input
              className="form-input"
              type="date"
              value={form.fecha}
              onChange={(event) =>
                setForm({ ...form, fecha: event.target.value })
              }
            />
          </Field>
          <Field label="Caso vinculado">
            <select
              className="form-select"
              value={form.casoCode}
              onChange={(event) =>
                setForm({ ...form, casoCode: event.target.value })
              }
            >
              <option value="">Sin caso</option>
              {cases.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Archivo"
          hint="En el prototipo se registra el nombre; no se sube contenido real."
        >
          <input
            className="form-input"
            type="file"
            onChange={(event) =>
              setForm({ ...form, archivo: event.target.files?.[0]?.name ?? "" })
            }
          />
        </Field>
        <Field
          label="Texto para analizar"
          hint="Pega la transcripción o el extracto. Alimenta la extracción de demostración."
        >
          <textarea
            className="form-textarea"
            value={form.texto}
            onChange={(event) =>
              setForm({ ...form, texto: event.target.value })
            }
          />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </FormDrawer>
    </>
  );
}
