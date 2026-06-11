"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { PackageMinus, X } from "lucide-react";
import { searchAgendaSubjectsAction } from "./actions";
import {
  listCustomerEquipment,
  type CustomerEquipmentRow,
} from "@/modules/customers/equipment-actions";
import { createUninstallFromAgendaAction } from "@/modules/customers/uninstall-actions";

interface Props {
  teamMembers?: { user_id: string; full_name: string }[];
}

/**
 * Programa una DESINSTALACIÓN (retirada) desde la agenda:
 *   1) Busca el cliente en un pop-up (por nombre o teléfono).
 *   2) Marca qué equipos activos se retiran.
 *   3) Elige técnico y fecha.
 * El equipo retirado vuelve a la furgoneta del técnico (estado 'usado' + S/N).
 * El técnico la verá como RETIRADA y ese día NO se le carga furgoneta.
 */
export function UninstallFromAgendaButton({ teamMembers = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Paso 1 — buscar cliente
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; label: string; sublabel: string | null }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(
    null,
  );

  // Paso 2 — equipos
  const [equipment, setEquipment] = useState<CustomerEquipmentRow[]>([]);
  const [loadingEq, setLoadingEq] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Paso 3 — técnico + fecha
  const [technician, setTechnician] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // Búsqueda con debounce. Solo clientes (los leads no tienen equipo instalado).
  useEffect(() => {
    if (customer) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchAgendaSubjectsAction(q);
        if (!cancelled) {
          setResults(
            res
              .filter((r) => r.subject_type === "customer")
              .map((r) => ({ id: r.subject_id, label: r.label, sublabel: r.sublabel })),
          );
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, customer]);

  // Al elegir cliente, cargar sus equipos ACTIVOS (preseleccionados todos).
  useEffect(() => {
    if (!customer) {
      setEquipment([]);
      setSelected(new Set());
      return;
    }
    let alive = true;
    setLoadingEq(true);
    listCustomerEquipment(customer.id)
      .then((rows) => {
        if (!alive) return;
        const active = rows.filter((r) => r.is_active);
        setEquipment(active);
        setSelected(new Set(active.map((r) => r.id)));
      })
      .catch(() => {
        if (alive) setEquipment([]);
      })
      .finally(() => {
        if (alive) setLoadingEq(false);
      });
    return () => {
      alive = false;
    };
  }, [customer]);

  function resetAll() {
    setQuery("");
    setResults([]);
    setCustomer(null);
    setEquipment([]);
    setSelected(new Set());
    setTechnician("");
    setScheduledAt("");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const eqLabel = (e: CustomerEquipmentRow) => {
    const base = e.product_name || e.external_model_name || "Equipo";
    return e.serial_number ? `${base} · S/N ${e.serial_number}` : base;
  };

  const canSubmit = useMemo(
    () => !!customer && selected.size > 0,
    [customer, selected],
  );

  function submit() {
    if (!customer) return;
    if (selected.size === 0) {
      notify.warning("Selecciona al menos un equipo a retirar");
      return;
    }
    startTransition(async () => {
      const r = await createUninstallFromAgendaAction({
        customer_id: customer.id,
        equipment_ids: Array.from(selected),
        technician_user_id: technician || undefined,
        scheduled_at: scheduledAt || undefined,
      });
      if (!r.ok) {
        notify.error("No se pudo programar la retirada", r.error);
        return;
      }
      notify.success(
        "Desinstalación programada",
        "El técnico la verá como RETIRADA y ese día no se le cargará furgoneta.",
      );
      resetAll();
      setOpen(false);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PackageMinus className="h-4 w-4" /> Desinstalación
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) resetAll();
          setOpen(o);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Programar desinstalación (retirada)</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Paso 1 — cliente */}
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              {customer ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                  <span className="truncate text-sm font-medium">{customer.label}</span>
                  <button
                    type="button"
                    onClick={() => setCustomer(null)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Cambiar cliente"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Busca por nombre o teléfono…"
                    autoComplete="off"
                  />
                  {query.trim().length >= 2 && (
                    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-card shadow-lg">
                      {searching && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Buscando…</div>
                      )}
                      {!searching && results.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Sin clientes. Prueba con el teléfono.
                        </div>
                      )}
                      {results.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setCustomer({ id: r.id, label: r.label });
                            setQuery("");
                            setResults([]);
                          }}
                          className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span className="font-medium">{r.label}</span>
                          {r.sublabel && (
                            <span className="text-xs text-muted-foreground">{r.sublabel}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Paso 2 — equipos */}
            {customer && (
              <div className="space-y-1.5">
                <Label>Equipos a retirar</Label>
                {loadingEq ? (
                  <p className="text-sm text-muted-foreground">Cargando equipos…</p>
                ) : equipment.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Este cliente no tiene equipos activos para retirar.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {equipment.map((e) => (
                      <label
                        key={e.id}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={selected.has(e.id)}
                          onChange={() => toggle(e.id)}
                        />
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{eqLabel(e)}</span>
                          {e.address_label && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              · {e.address_label}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Paso 3 — técnico + fecha */}
            {customer && equipment.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Técnico que retira</Label>
                  <select
                    value={technician}
                    onChange={(e) => setTechnician(e.target.value)}
                    className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
                  >
                    <option value="">Yo mismo</option>
                    {teamMembers.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.full_name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    El equipo retirado vuelve a SU furgoneta (estado «usado»).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="uninstall_at">Fecha y hora</Label>
                  <Input
                    id="uninstall_at"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetAll();
                  setOpen(false);
                }}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={submit} disabled={pending || !canSubmit}>
                {pending ? "Programando…" : "Programar retirada"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
