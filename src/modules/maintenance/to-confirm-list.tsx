"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarCheck2,
  Phone,
  Search,
  UserCog,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  validateMaintenanceJobAction,
  rescheduleMaintenanceProposalAction,
} from "./actions";
import type { ToConfirmRow } from "./to-confirm-actions";

const PAGE_SIZE = 25;

export function ToConfirmList({
  rows,
  installers,
}: {
  rows: ToConfirmRow[];
  installers: Array<{ user_id: string; full_name: string }>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<ToConfirmRow | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  async function quickMove(id: string, deltaDays: number) {
    setMovingId(id);
    const r = await rescheduleMaintenanceProposalAction({
      id,
      delta_days: deltaDays,
    });
    setMovingId(null);
    if (!r.ok) {
      notify.error("No se pudo mover", r.error);
      return;
    }
    router.refresh();
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.contract_reference ?? "").toLowerCase().includes(q) ||
        (r.customer_phone ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-success/40 bg-success/5 p-8 text-center text-sm text-success">
        ✓ No hay mantenimientos pendientes de confirmar en este rango.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar cliente, referencia o teléfono…"
            className="pl-8"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {filtered.length} mantenimiento
          {filtered.length === 1 ? "" : "s"} por confirmar
          {query && filtered.length !== rows.length
            ? ` (filtrados de ${rows.length})`
            : ""}
        </div>
      </div>

      <ul className="divide-y rounded-2xl border bg-card">
        {pageRows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  href={`/clientes/${r.customer_id}` as never}
                  className="font-semibold hover:underline truncate"
                >
                  {r.customer_name}
                </Link>
                {r.contract_reference && (
                  <Badge variant="outline" className="text-[10px]">
                    {r.contract_reference}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                <span>
                  Fecha estimada:{" "}
                  <strong className="text-foreground">
                    {r.scheduled_at
                      ? new Date(r.scheduled_at).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                      : "—"}
                  </strong>
                </span>
                {r.customer_phone && (
                  <a
                    href={`tel:${r.customer_phone}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {r.customer_phone}
                  </a>
                )}
                {r.last_technician_name && (
                  <span className="inline-flex items-center gap-1">
                    <UserCog className="h-3 w-3" />
                    Última vez: {r.last_technician_name}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {/* Ajuste rápido sin abrir modal — cliente pide otro día
                  o hay incidencia que adelantar. Mueve scheduled_at y
                  registra customer_called_at. El job sigue preprogrammed. */}
              {[-7, -3, +3, +7].map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={movingId === r.id}
                  onClick={() => quickMove(r.id, d)}
                  className={`rounded-md border px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${
                    d < 0
                      ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                  title={d < 0 ? "Adelantar" : "Aplazar"}
                >
                  {d > 0 ? `+${d}d` : `${d}d`}
                </button>
              ))}
              <Link
                href={`/mantenimientos/${r.id}` as never}
                className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
                title="Ver mantenimiento"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Ver
              </Link>
              <Button
                size="sm"
                variant="success"
                onClick={() => setActive(r)}
                className="gap-1"
              >
                <CalendarCheck2 className="h-3.5 w-3.5" />
                Confirmar
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Página {safePage} de {totalPages}
          </span>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {active && (
        <ConfirmVisitModal
          row={active}
          installers={installers}
          onClose={() => setActive(null)}
          onConfirmed={() => {
            setActive(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ConfirmVisitModal({
  row,
  installers,
  onClose,
  onConfirmed,
}: {
  row: ToConfirmRow;
  installers: Array<{ user_id: string; full_name: string }>;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  // Valores iniciales: fecha estimada del job y técnico habitual.
  const initialDate = row.scheduled_at ? new Date(row.scheduled_at) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const [date, setDate] = useState(
    `${initialDate.getFullYear()}-${pad(initialDate.getMonth() + 1)}-${pad(initialDate.getDate())}`,
  );
  const [time, setTime] = useState(
    `${pad(initialDate.getHours() || 10)}:${pad(initialDate.getMinutes() || 0)}`,
  );
  const [technicianId, setTechnicianId] = useState(
    row.last_technician_user_id ?? "",
  );
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!date || !time) {
      notify.warning("Indica fecha y hora");
      return;
    }
    if (!technicianId) {
      notify.warning("Asigna un técnico");
      return;
    }
    const iso = new Date(`${date}T${time}:00`).toISOString();
    startTransition(async () => {
      const r = await validateMaintenanceJobAction({
        id: row.id,
        scheduled_at: iso,
        technician_user_id: technicianId,
      });
      if (!r.ok) {
        notify.error("No se pudo confirmar", r.error);
        return;
      }
      notify.success(
        "Visita confirmada",
        "Ya aparece en la agenda. El técnico recibirá la notificación.",
      );
      onConfirmed();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <h2 className="text-lg font-bold">Confirmar visita</h2>
            <p className="text-xs text-muted-foreground">
              Cliente: <strong>{row.customer_name}</strong>
              {row.contract_reference && ` · ${row.contract_reference}`}
            </p>
          </div>
          {row.customer_phone && (
            <a
              href={`tel:${row.customer_phone}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary bg-primary/5 px-3 py-2 text-sm font-bold text-primary hover:bg-primary/10"
            >
              <Phone className="h-4 w-4" />
              Llamar a {row.customer_phone}
            </a>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hora</Label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          {/* Botones rápidos: el cliente suele decir "no puedo, mejor
              3 días más tarde" o "vente antes, tengo una avería". */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Mover:
            </span>
            {[-7, -3, -1, +1, +3, +7].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  const cur = new Date(`${date}T${time || "10:00"}:00`);
                  cur.setDate(cur.getDate() + d);
                  const pad = (n: number) => String(n).padStart(2, "0");
                  setDate(
                    `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`,
                  );
                }}
                className={`rounded-md border px-2 py-1 text-xs font-bold ${
                  d < 0
                    ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {d > 0 ? `+${d}d` : `${d}d`}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Técnico asignado *</Label>
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
            >
              <option value="">— Elige técnico —</option>
              {installers.map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.full_name}
                  {t.user_id === row.last_technician_user_id ? " (último)" : ""}
                </option>
              ))}
            </select>
            {row.last_technician_user_id && (
              <p className="text-[11px] text-muted-foreground">
                Sugerencia: el técnico que hizo el mantenimiento anterior viene
                preseleccionado.
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="success" onClick={submit} disabled={pending}>
            {pending ? "Confirmando…" : "Confirmar y pasar a agenda"}
          </Button>
        </div>
      </div>
    </div>
  );
}
