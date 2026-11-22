"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  demoAlerts,
  demoCases,
  demoCommitments,
  demoDocuments,
  type DemoAlert,
  type DemoCase,
  type DemoCommitment,
  type DemoDemanda,
  type DemoDocument,
  type DemoExtraction,
  type DemoHito,
  type DemoNotification,
  type DemandaFuente,
  type FragmentKind,
} from "@/components/avisa-demo-data";

export type CaseDraft = {
  title: string;
  region: string;
  subject: string;
  risk: DemoCase["risk"];
  stage: string;
  estado?: DemoCase["estado"];
  summary: string;
  alcance?: DemoCase["alcance"];
  tematica?: string;
  unidadResponsable?: string;
  puntoFocal?: string;
  nivelConflicto?: DemoCase["nivelConflicto"];
  prioridad?: DemoCase["prioridad"];
  subsector?: DemoCase["subsector"];
  documentacionNormativa?: DemoCase["documentacionNormativa"];
  origen?: DemoCase["origen"];
};

export type AlertDraft = {
  title: string;
  location: string;
  source: string;
  published: string;
  priority: DemoAlert["priority"];
  risk?: DemoAlert["risk"];
  quote: string;
  note: string;
  caseCode?: string;
  slaHours?: number;
  documentoId?: string;
  origen?: DemoAlert["origen"];
  riesgos?: string[];
  acciones?: string[];
};

export type CommitmentDraft = {
  title: string;
  caseCode: string;
  owner: string;
  due: string;
  fechaInicio?: string;
  status: DemoCommitment["status"];
  progress?: number;
  recordatorios?: number[];
  agreementType?: DemoCommitment["agreementType"];
  tipo?: DemoCommitment["tipo"];
  nivelGobierno?: DemoCommitment["nivelGobierno"];
  unidadResponsable?: string;
  documentoOrigenId?: string;
  atiendeGenero?: boolean;
  clasificacion?: DemoCommitment["clasificacion"];
  origen?: DemoCommitment["origen"];
};

export type CaseEventDraft = {
  title: string;
  description: string;
  actor?: string;
  evidencia?: string;
  date?: string;
};

export type DemandaDraft = {
  problema: string;
  propuesta?: string;
  pedido: string;
  estado: DemoDemanda["estado"];
  fuentes?: DemandaFuente[];
};

export type DocumentDraft = {
  kind: DemoDocument["kind"];
  titulo: string;
  fecha: string;
  archivo: string;
  origen: DemoDocument["origen"];
  casoCode?: string;
  texto?: string;
};

type AvisaStore = {
  cases: DemoCase[];
  alerts: DemoAlert[];
  commitments: DemoCommitment[];
  documents: DemoDocument[];
  notifications: DemoNotification[];
  notice: string;
  setNotice: (message: string) => void;
  createCase: (draft: CaseDraft) => DemoCase;
  updateCase: (code: string, patch: Partial<DemoCase>) => void;
  deleteCase: (code: string) => void;
  addCaseEvent: (code: string, draft: CaseEventDraft) => void;
  validateCaseEvent: (code: string, index: number) => void;
  addDemanda: (code: string, draft: DemandaDraft) => void;
  updateDemanda: (
    code: string,
    index: number,
    patch: Partial<DemoDemanda>,
  ) => void;
  deleteDemanda: (code: string, index: number) => void;
  createAlert: (draft: AlertDraft) => DemoAlert;
  updateAlert: (id: string, patch: Partial<DemoAlert>) => void;
  deleteAlert: (id: string) => void;
  createCommitment: (draft: CommitmentDraft) => DemoCommitment;
  updateCommitment: (id: string, patch: Partial<DemoCommitment>) => void;
  deleteCommitment: (id: string) => void;
  archiveCommitment: (id: string, motivo: string) => void;
  restoreCommitment: (id: string) => void;
  addCommitmentEvidence: (id: string, nombre: string) => void;
  addCommitmentHito: (
    id: string,
    hito: { descripcion: string; fecha: string },
  ) => void;
  setCommitmentHitoEstado: (
    id: string,
    hitoId: string,
    estado: DemoHito["estado"],
  ) => void;
  addDocument: (draft: DocumentDraft) => DemoDocument;
  deleteDocument: (id: string) => void;
  simulateExtraction: (id: string) => void;
  reextractDocument: (id: string) => void;
  validateDocument: (id: string) => void;
  rejectDocument: (id: string, motivo: string) => void;
  validateFragment: (
    documentId: string,
    fragmentId: string,
    validado: boolean,
  ) => void;
  acceptExtraction: (documentId: string, extractionId: string) => void;
  rejectExtraction: (documentId: string, extractionId: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
};

const AvisaContext = createContext<AvisaStore | null>(null);

const nextNumber = (ids: string[]) =>
  ids.reduce(
    (max, id) => Math.max(max, Number(id.match(/(\d+)$/)?.[1] ?? 0)),
    0,
  ) + 1;
const pad = (value: number) => String(value).padStart(3, "0");

// Clasificación heurística del extractor de demostración: no hay modelo real detrás.
const fragmentKind = (texto: string, index: number): FragmentKind =>
  /acuerd|compromis/i.test(texto)
    ? "acuerdo"
    : /solicit|piden|pedimos|demand/i.test(texto)
      ? "demanda"
      : /preocup|riesgo|amenaz/i.test(texto)
        ? "riesgo"
        : index === 0
          ? "hecho"
          : "cita";

export function AvisaProvider({ children }: { children: ReactNode }) {
  const [cases, setCases] = useState<DemoCase[]>(demoCases);
  const [alerts, setAlerts] = useState<DemoAlert[]>(demoAlerts);
  const [commitments, setCommitments] =
    useState<DemoCommitment[]>(demoCommitments);
  const [documents, setDocuments] = useState<DemoDocument[]>(demoDocuments);
  const [notice, setNotice] = useState("");
  const [readNotifications, setReadNotifications] = useState<string[]>([]);

  const createCase = useCallback(
    (draft: CaseDraft) => {
      const code = `DEMO-2026-${pad(nextNumber(cases.map((item) => item.code)))}`;
      const record: DemoCase = {
        ...draft,
        code,
        updated: "Hace un momento",
        progress: 0,
        actors: [],
        validado: false,
        events: [
          {
            date: "Hoy · ahora",
            title: "Caso creado",
            description:
              "Alta manual en el prototipo; pendiente de validación humana.",
            kind: "system",
          },
        ],
      };
      setCases((items) => [record, ...items]);
      setNotice(
        `Caso ${code} creado. Queda sin validar hasta la revisión humana.`,
      );
      return record;
    },
    [cases],
  );

  const updateCase = useCallback((code: string, patch: Partial<DemoCase>) => {
    setCases((items) =>
      items.map((item) =>
        item.code === code
          ? { ...item, ...patch, updated: "Hace un momento" }
          : item,
      ),
    );
    setNotice(`Caso ${code} actualizado en la demostración.`);
  }, []);

  const deleteCase = useCallback((code: string) => {
    setCases((items) => items.filter((item) => item.code !== code));
    setAlerts((items) => items.filter((item) => item.caseCode !== code));
    setCommitments((items) => items.filter((item) => item.caseCode !== code));
    setDocuments((items) =>
      items.map((item) =>
        item.casoCode === code ? { ...item, casoCode: undefined } : item,
      ),
    );
    setNotice(
      `Caso ${code} eliminado con sus alertas y compromisos vinculados (demostración).`,
    );
  }, []);

  const addCaseEvent = useCallback((code: string, draft: CaseEventDraft) => {
    setCases((items) =>
      items.map((item) =>
        item.code === code
          ? {
              ...item,
              updated: "Hace un momento",
              events: [
                {
                  id: `EV-${item.code}-${item.events.length + 1}`,
                  date: draft.date?.trim() || "Hoy · ahora",
                  title: draft.title,
                  description: draft.description,
                  actor: draft.actor?.trim() || "No especificado",
                  evidencia: draft.evidencia?.trim() || undefined,
                  kind: "pending" as const,
                  estado: "Pendiente" as const,
                },
                ...item.events,
              ],
            }
          : item,
      ),
    );
    setNotice(
      "Hecho registrado como pendiente: la validación humana es una acción explícita.",
    );
  }, []);

  const validateCaseEvent = useCallback((code: string, index: number) => {
    setCases((items) =>
      items.map((item) =>
        item.code === code
          ? {
              ...item,
              updated: "Hace un momento",
              events: item.events.map((event, position) =>
                position === index
                  ? {
                      ...event,
                      kind: "validated" as const,
                      estado: "Validado" as const,
                    }
                  : event,
              ),
            }
          : item,
      ),
    );
    setNotice(
      "Hecho validado por una persona. En producción la validación dejaría registro de usuario y fecha.",
    );
  }, []);

  const addDemanda = useCallback((code: string, draft: DemandaDraft) => {
    setCases((items) =>
      items.map((item) =>
        item.code === code
          ? {
              ...item,
              updated: "Hace un momento",
              demandas: [
                ...(item.demandas ?? []),
                {
                  ...draft,
                  id: `DEM-${item.code}-${(item.demandas?.length ?? 0) + 1}`,
                },
              ],
            }
          : item,
      ),
    );
    setNotice("Demanda registrada con su vínculo a la fuente.");
  }, []);

  const updateDemanda = useCallback(
    (code: string, index: number, patch: Partial<DemoDemanda>) => {
      setCases((items) =>
        items.map((item) =>
          item.code === code
            ? {
                ...item,
                updated: "Hace un momento",
                demandas: (item.demandas ?? []).map((demanda, position) =>
                  position === index ? { ...demanda, ...patch } : demanda,
                ),
              }
            : item,
        ),
      );
      setNotice("Demanda actualizada en la demostración.");
    },
    [],
  );

  const deleteDemanda = useCallback((code: string, index: number) => {
    setCases((items) =>
      items.map((item) =>
        item.code === code
          ? {
              ...item,
              updated: "Hace un momento",
              demandas: (item.demandas ?? []).filter(
                (_, position) => position !== index,
              ),
            }
          : item,
      ),
    );
    setNotice("Demanda retirada del caso en la demostración.");
  }, []);

  const createAlert = useCallback(
    (draft: AlertDraft) => {
      const record: DemoAlert = {
        ...draft,
        id: `ALT-DEMO-${pad(nextNumber(alerts.map((item) => item.id)))}`,
        status: "Pendiente de revisión",
        validado: false,
      };
      setAlerts((items) => [record, ...items]);
      setNotice(
        `Alerta ${record.id} registrada. Requiere revisión humana antes de ser visible.`,
      );
      return record;
    },
    [alerts],
  );

  const updateAlert = useCallback((id: string, patch: Partial<DemoAlert>) => {
    setAlerts((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              historial:
                patch.status && patch.status !== item.status
                  ? [
                      ...(item.historial ?? []),
                      {
                        accion: `Estado: ${patch.status}`,
                        fecha: "Hoy · ahora",
                        nota: patch.reviewNote,
                      },
                    ]
                  : item.historial,
            }
          : item,
      ),
    );
  }, []);

  const deleteAlert = useCallback((id: string) => {
    setAlerts((items) => items.filter((item) => item.id !== id));
    setNotice(
      `Alerta ${id} eliminada del prototipo. En producción se archiva con motivo.`,
    );
  }, []);

  const createCommitment = useCallback(
    (draft: CommitmentDraft) => {
      const record: DemoCommitment = {
        ...draft,
        id: `COM-DEMO-${pad(nextNumber(commitments.map((item) => item.id)))}`,
        progress: draft.progress ?? 0,
        validado: false,
      };
      setCommitments((items) => [record, ...items]);
      setNotice(`Compromiso ${record.id} registrado.`);
      return record;
    },
    [commitments],
  );

  const updateCommitment = useCallback(
    (id: string, patch: Partial<DemoCommitment>) => {
      setCommitments((items) =>
        items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
      setNotice(`Compromiso ${id} actualizado.`);
    },
    [],
  );

  const deleteCommitment = useCallback((id: string) => {
    setCommitments((items) => items.filter((item) => item.id !== id));
    setNotice(`Compromiso ${id} eliminado del prototipo.`);
  }, []);

  const archiveCommitment = useCallback((id: string, motivo: string) => {
    setCommitments((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              archivado: { motivo: motivo.trim(), fecha: "Hoy · ahora" },
            }
          : item,
      ),
    );
    setNotice(
      `Compromiso ${id} archivado con motivo. El registro se conserva para consulta e historial.`,
    );
  }, []);

  const restoreCommitment = useCallback((id: string) => {
    setCommitments((items) =>
      items.map((item) =>
        item.id === id ? { ...item, archivado: undefined } : item,
      ),
    );
    setNotice(`Compromiso ${id} restaurado al seguimiento activo.`);
  }, []);

  const addCommitmentEvidence = useCallback((id: string, nombre: string) => {
    setCommitments((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              evidencias: [
                ...(item.evidencias ?? []),
                { nombre, tipo: "Adjunto simulado" },
              ],
            }
          : item,
      ),
    );
    setNotice("Evidencia adjuntada al compromiso (archivo simulado).");
  }, []);

  const addCommitmentHito = useCallback(
    (id: string, hito: { descripcion: string; fecha: string }) => {
      setCommitments((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                hitos: [
                  ...(item.hitos ?? []),
                  {
                    id: `${item.id}-H${(item.hitos?.length ?? 0) + 1}`,
                    descripcion: hito.descripcion,
                    fecha: hito.fecha,
                    estado: "Registrado" as const,
                  },
                ],
              }
            : item,
        ),
      );
      setNotice("Hito agregado al compromiso.");
    },
    [],
  );

  const setCommitmentHitoEstado = useCallback(
    (id: string, hitoId: string, estado: DemoHito["estado"]) => {
      setCommitments((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                hitos: (item.hitos ?? []).map((hito) =>
                  hito.id === hitoId ? { ...hito, estado } : hito,
                ),
              }
            : item,
        ),
      );
    },
    [],
  );

  const addDocument = useCallback(
    (draft: DocumentDraft) => {
      const codigo = `DOC-2026-${pad(nextNumber(documents.map((item) => item.codigo)))}`;
      const record: DemoDocument = {
        ...draft,
        id: codigo,
        codigo,
        estado: "Cargado",
        subidoPor: "Sesión actual",
        fragmentos: [],
        extracciones: [],
      };
      setDocuments((items) => [record, ...items]);
      setNotice(
        `${codigo} cargado. Queda pendiente de extracción y revisión humana.`,
      );
      return record;
    },
    [documents],
  );

  const deleteDocument = useCallback((id: string) => {
    setDocuments((items) => items.filter((item) => item.id !== id));
    setNotice(`Documento ${id} eliminado del prototipo.`);
  }, []);

  const simulateExtraction = useCallback((id: string) => {
    setDocuments((items) =>
      items.map((doc) => {
        if (doc.id !== id) return doc;
        const blocks = (doc.texto ?? "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const lines = blocks.length
          ? blocks.slice(0, 4)
          : ["Sin texto cargado: no hay nada que extraer."];
        const fragmentos = lines.map((texto, index) => ({
          id: `${doc.id}-F${index + 1}`,
          texto,
          tipo: fragmentKind(texto, index),
          validado: false,
        }));
        const extracciones: DemoExtraction[] = fragmentos
          .filter((fragmento) => fragmento.tipo !== "cita")
          .map((fragmento, index) => ({
            id: `${doc.id}-X${index + 1}`,
            tipo:
              fragmento.tipo === "acuerdo"
                ? "compromiso"
                : fragmento.tipo === "hecho"
                  ? "hecho"
                  : fragmento.tipo === "demanda"
                    ? "demanda"
                    : "alerta",
            titulo:
              fragmento.texto.length > 70
                ? `${fragmento.texto.slice(0, 67)}…`
                : fragmento.texto,
            detalle: `Propuesta derivada del párrafo ${index + 1} (extractor de demostración, sin modelo real).`,
            estado: "Propuesta" as const,
          }));
        return {
          ...doc,
          estado: "Extraído" as const,
          confianza: 0.62,
          fragmentos,
          extracciones,
        };
      }),
    );
    setNotice(
      "Extracción de demostración ejecutada: revisa cada propuesta antes de aceptarla.",
    );
  }, []);

  const reextractDocument = useCallback(
    (id: string) => {
      setDocuments((items) =>
        items.map((doc) =>
          doc.id === id
            ? {
                ...doc,
                versiones: [
                  ...(doc.versiones ?? []),
                  {
                    n: (doc.versiones?.length ?? 0) + 1,
                    fecha: "Hoy · ahora",
                    fragmentos: doc.fragmentos,
                  },
                ],
              }
            : doc,
        ),
      );
      simulateExtraction(id);
      setNotice(
        "Extracción relanzada: la versión anterior de los fragmentos quedó guardada.",
      );
    },
    [simulateExtraction],
  );

  const validateDocument = useCallback((id: string) => {
    setDocuments((items) =>
      items.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              estado: "Validado",
              fragmentos: doc.fragmentos.map((fragmento) => ({
                ...fragmento,
                validado: true,
              })),
            }
          : doc,
      ),
    );
    setNotice(`Documento ${id} validado por una persona.`);
  }, []);

  const rejectDocument = useCallback((id: string, motivo: string) => {
    setDocuments((items) =>
      items.map((doc) =>
        doc.id === id
          ? {
              ...doc,
              estado: "Rechazado" as const,
              rechazoMotivo: motivo.trim(),
              fragmentos: doc.fragmentos.map((fragmento) => ({
                ...fragmento,
                validado: false,
              })),
            }
          : doc,
      ),
    );
    setNotice(
      `Documento ${id} rechazado con motivo. Se conserva el archivo y la trazabilidad.`,
    );
  }, []);

  const validateFragment = useCallback(
    (documentId: string, fragmentId: string, validado: boolean) => {
      setDocuments((items) =>
        items.map((doc) =>
          doc.id === documentId
            ? {
                ...doc,
                fragmentos: doc.fragmentos.map((fragmento) =>
                  fragmento.id === fragmentId
                    ? { ...fragmento, validado }
                    : fragmento,
                ),
              }
            : doc,
        ),
      );
      setNotice(
        validado
          ? "Fragmento validado por una persona; sigue trazado a la página de origen."
          : "Validación del fragmento retirada.",
      );
    },
    [],
  );

  const rejectExtraction = useCallback(
    (documentId: string, extractionId: string) => {
      setDocuments((items) =>
        items.map((doc) =>
          doc.id === documentId
            ? {
                ...doc,
                extracciones: doc.extracciones.map((extraction) =>
                  extraction.id === extractionId
                    ? { ...extraction, estado: "Descartada" as const }
                    : extraction,
                ),
              }
            : doc,
        ),
      );
      setNotice(
        "Propuesta descartada. El documento sigue trazado a su fuente.",
      );
    },
    [],
  );

  const acceptExtraction = useCallback(
    (documentId: string, extractionId: string) => {
      const doc = documents.find((item) => item.id === documentId);
      const extraction = doc?.extracciones.find(
        (item) => item.id === extractionId,
      );
      if (!doc || !extraction) return;
      const relatedCase = cases.find((item) => item.code === doc.casoCode);
      if (extraction.tipo === "alerta") {
        createAlert({
          title: extraction.titulo,
          location: relatedCase?.region ?? "Sin territorio",
          source: doc.codigo,
          published: doc.fecha,
          priority: "Alta",
          quote: extraction.detalle,
          note: `Derivada de ${doc.codigo} · requiere verificación contra la fuente.`,
          caseCode: doc.casoCode,
          slaHours: 48,
          documentoId: doc.id,
          origen: "Ingesta",
        });
      } else if (extraction.tipo === "compromiso") {
        createCommitment({
          title: extraction.titulo,
          caseCode: doc.casoCode ?? "",
          owner: "Por asignar",
          due: "Por definir",
          status: "En curso",
          tipo: "Actividad",
          documentoOrigenId: doc.id,
          origen: "Ingesta",
        });
      } else if (extraction.tipo === "hecho" && doc.casoCode) {
        setCases((items) =>
          items.map((item) =>
            item.code === doc.casoCode
              ? {
                  ...item,
                  events: [
                    {
                      date: "Hoy · ahora",
                      title: extraction.titulo,
                      description: `${extraction.detalle} Origen: ${doc.codigo}.`,
                      kind: "pending" as const,
                    },
                    ...item.events,
                  ],
                }
              : item,
          ),
        );
      } else if (extraction.tipo === "demanda") {
        if (!doc.casoCode || !relatedCase) {
          setNotice(
            "La demanda necesita un caso vinculado. Asocia el documento a un caso y vuelve a intentarlo.",
          );
          return;
        }
        setCases((items) =>
          items.map((item) =>
            item.code === doc.casoCode
              ? {
                  ...item,
                  demandas: [
                    ...(item.demandas ?? []),
                    {
                      problema: extraction.titulo,
                      pedido: "Por precisar en la revisión humana.",
                      estado: "Pendiente" as const,
                    },
                  ],
                }
              : item,
          ),
        );
      } else if (extraction.tipo === "actor") {
        setNotice(
          "La propuesta de actor queda registrada, pero el alta en el directorio no está habilitada en esta fase.",
        );
      }
      setDocuments((items) =>
        items.map((item) =>
          item.id === documentId
            ? {
                ...item,
                extracciones: item.extracciones.map((row) =>
                  row.id === extractionId
                    ? { ...row, estado: "Aceptada" as const }
                    : row,
                ),
              }
            : item,
        ),
      );
      if (extraction.tipo !== "actor")
        setNotice(
          "Propuesta aceptada: quedó registrada sin validar y trazada al documento de origen.",
        );
    },
    [documents, cases, createAlert, createCommitment],
  );

  const notifications = useMemo<DemoNotification[]>(() => {
    const pendingAlerts = alerts
      .filter((item) => item.status === "Pendiente de revisión")
      .map((item) => ({
        id: `alerta-${item.id}`,
        categoria: "Alerta" as const,
        titulo: `Alerta ${item.alertType ?? "AT"} pendiente de revisión`,
        detalle: `${item.id} · ${item.location}`,
        fecha: item.published,
        view: "alerts" as const,
        refCode: item.id,
      }));
    const dueCommitments = commitments
      .filter(
        (item) =>
          !item.archivado &&
          (item.status === "Paralizado" || item.status === "Por vencer"),
      )
      .map((item) => ({
        id: `compromiso-${item.id}`,
        categoria: "Compromiso" as const,
        titulo: `Compromiso ${item.status.toLowerCase()}`,
        detalle: `${item.id} · ${item.owner} · vence ${item.due}`,
        fecha: item.due,
        view: "commitments" as const,
        refCode: item.id,
      }));
    const documentReviews = documents
      .filter((doc) =>
        doc.extracciones.some((row) => row.estado === "Propuesta"),
      )
      .map((doc) => ({
        id: `documento-${doc.id}`,
        categoria: "Documento" as const,
        titulo: "Propuestas de extracción por revisar",
        detalle: `${doc.codigo} · ${doc.titulo}`,
        fecha: doc.fecha,
        view: "documents" as const,
        refCode: doc.codigo,
      }));
    const highRiskCases = cases
      .filter(
        (item) =>
          item.risk === "Alto" &&
          item.estado !== "Archivado" &&
          item.estado !== "Resuelto",
      )
      .map((item) => ({
        id: `caso-${item.code}`,
        categoria: "Caso" as const,
        titulo: "Caso de riesgo alto en seguimiento",
        detalle: `${item.code} · ${item.title}`,
        fecha: item.updated,
        view: "case-detail" as const,
        refCode: item.code,
      }));
    return [
      ...pendingAlerts,
      ...dueCommitments,
      ...documentReviews,
      ...highRiskCases,
    ].map((item) => ({
      ...item,
      leida: readNotifications.includes(item.id),
    }));
  }, [alerts, commitments, documents, cases, readNotifications]);

  const markNotificationRead = useCallback((id: string) => {
    setReadNotifications((items) =>
      items.includes(id) ? items : [...items, id],
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setReadNotifications((items) => [
      ...items,
      ...notifications.map((row) => row.id).filter((id) => !items.includes(id)),
    ]);
  }, [notifications]);

  const value: AvisaStore = {
    cases,
    alerts,
    commitments,
    documents,
    notifications,
    notice,
    setNotice,
    createCase,
    updateCase,
    deleteCase,
    addCaseEvent,
    validateCaseEvent,
    addDemanda,
    updateDemanda,
    deleteDemanda,
    createAlert,
    updateAlert,
    deleteAlert,
    createCommitment,
    updateCommitment,
    deleteCommitment,
    archiveCommitment,
    restoreCommitment,
    addCommitmentEvidence,
    addCommitmentHito,
    setCommitmentHitoEstado,
    addDocument,
    deleteDocument,
    simulateExtraction,
    reextractDocument,
    validateDocument,
    rejectDocument,
    validateFragment,
    acceptExtraction,
    rejectExtraction,
    markNotificationRead,
    markAllNotificationsRead,
  };

  return (
    <AvisaContext.Provider value={value}>{children}</AvisaContext.Provider>
  );
}

export function useAvisa() {
  const store = useContext(AvisaContext);
  if (!store) throw new Error("useAvisa debe usarse dentro de <AvisaProvider>");
  return store;
}
