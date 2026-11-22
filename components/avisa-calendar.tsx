"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DemoCommitment } from "./avisa-demo-data";
import {
  demoReferenceDate,
  deriveCommitmentDueState,
  parseDemoDate,
} from "./avisa-catalogs";

const monthNames = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const weekdayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

const monthStart = (year: number, month: number) => new Date(year, month, 1);

/**
 * Calendario mensual de compromisos por fecha de vencimiento.
 * Los textos que no se pueden interpretar como fecha van al bloque «sin fecha».
 */
export function CommitmentCalendar({
  commitments,
  onOpenCase,
}: {
  commitments: DemoCommitment[];
  onOpenCase?: (caseCode: string) => void;
}) {
  const [cursor, setCursor] = useState(() =>
    monthStart(demoReferenceDate.getFullYear(), demoReferenceDate.getMonth()),
  );
  const [selectedKey, setSelectedKey] = useState("");

  const byDay = useMemo(() => {
    const map = new Map<string, DemoCommitment[]>();
    commitments.forEach((item) => {
      const due = parseDemoDate(item.due);
      if (!due) return;
      const key = dayKey(due);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    });
    return map;
  }, [commitments]);

  const undated = useMemo(
    () => commitments.filter((item) => !parseDemoDate(item.due)),
    [commitments],
  );

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let index = 0; index < firstWeekday; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1)
    cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedItems = selectedKey ? (byDay.get(selectedKey) ?? []) : [];
  const selectedDate = selectedKey
    ? cells.find((cell) => cell && dayKey(cell) === selectedKey)
    : undefined;

  const moveMonth = (delta: number) => {
    setCursor(new Date(year, month + delta, 1));
    setSelectedKey("");
  };

  return (
    <section className="surface calendar-card">
      <div className="calendar-header">
        <div>
          <h3>
            Calendario de vencimientos · {monthNames[month]} {year}
          </h3>
          <p className="quote-note">
            Calendario demostrativo basado en la fecha de vencimiento de los
            compromisos filtrados.
          </p>
        </div>
        <div className="calendar-nav">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => moveMonth(-1)}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="calendar-today"
            onClick={() => {
              setCursor(
                monthStart(
                  demoReferenceDate.getFullYear(),
                  demoReferenceDate.getMonth(),
                ),
              );
              setSelectedKey("");
            }}
          >
            Hoy (demo)
          </button>
          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() => moveMonth(1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <table className="calendar-grid">
        <caption className="table-caption">
          Compromisos por día de vencimiento. Usa las celdas para ver el detalle
          del día.
        </caption>
        <thead>
          <tr>
            {weekdayNames.map((name) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: cells.length / 7 }, (_, weekIndex) => (
            <tr key={weekIndex}>
              {cells
                .slice(weekIndex * 7, weekIndex * 7 + 7)
                .map((cell, columnIndex) => {
                  if (!cell)
                    return (
                      <td
                        key={`empty-${weekIndex}-${columnIndex}`}
                        aria-hidden="true"
                      >
                        <div className="calendar-day-empty" />
                      </td>
                    );
                  const key = dayKey(cell);
                  const items = byDay.get(key) ?? [];
                  return (
                    <td key={key}>
                      <button
                        type="button"
                        className={`calendar-day${items.length ? " calendar-day-has-items" : ""}`}
                        aria-pressed={selectedKey === key}
                        aria-label={`${cell.getDate()} de ${monthNames[month]} de ${year}. ${items.length} compromisos.`}
                        onClick={() =>
                          setSelectedKey((current) =>
                            current === key ? "" : key,
                          )
                        }
                      >
                        <span>{cell.getDate()}</span>
                        {items.length > 0 && (
                          <>
                            <span className="calendar-count">
                              {items.length} compromiso
                              {items.length === 1 ? "" : "s"}
                            </span>
                            <span className="calendar-dot-row">
                              {items.slice(0, 5).map((item) => (
                                <i
                                  key={item.id}
                                  className={`calendar-dot${deriveCommitmentDueState(item.due, item.fechaInicio).key === "vencido" ? " calendar-dot-overdue" : ""}`}
                                />
                              ))}
                            </span>
                          </>
                        )}
                      </button>
                    </td>
                  );
                })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="calendar-selected-list" aria-live="polite">
        {selectedKey ? (
          <>
            <span className="micro-label">
              DÍA SELECCIONADO
              {selectedDate
                ? ` · ${selectedDate.getDate()} de ${monthNames[month]} de ${year}`
                : ""}
            </span>
            {selectedItems.length === 0 ? (
              <p className="form-hint">Sin compromisos en esta fecha.</p>
            ) : (
              selectedItems.map((item) => (
                <CalendarItem
                  key={item.id}
                  item={item}
                  onOpenCase={onOpenCase}
                />
              ))
            )}
          </>
        ) : (
          <p className="form-hint">
            Selecciona un día del calendario para ver sus compromisos.
          </p>
        )}
      </div>
      <div className="calendar-undated">
        <span className="micro-label">SIN FECHA · {undated.length}</span>
        {undated.length === 0 ? (
          <p className="form-hint">
            Todos los compromisos filtrados tienen una fecha de vencimiento
            interpretable.
          </p>
        ) : (
          undated.map((item) => (
            <CalendarItem key={item.id} item={item} onOpenCase={onOpenCase} />
          ))
        )}
      </div>
    </section>
  );
}

function CalendarItem({
  item,
  onOpenCase,
}: {
  item: DemoCommitment;
  onOpenCase?: (caseCode: string) => void;
}) {
  const due = deriveCommitmentDueState(item.due, item.fechaInicio);
  return (
    <div className="calendar-item">
      <strong>{item.title}</strong>
      <span>{item.id}</span>
      <span>{item.owner}</span>
      <span className={`due-state due-${due.key}`}>Plazo: {due.label}</span>
      <span
        className={`commit-status commit-${item.status.toLowerCase().replace(" ", "-")}`}
      >
        {item.status}
      </span>
      {item.archivado && (
        <span className="badge badge-archived">Archivado</span>
      )}
      <button
        type="button"
        className="table-link"
        aria-label={`Abrir el caso ${item.caseCode} desde el calendario`}
        onClick={() => onOpenCase?.(item.caseCode)}
        disabled={!onOpenCase}
      >
        {item.caseCode}
      </button>
    </div>
  );
}
