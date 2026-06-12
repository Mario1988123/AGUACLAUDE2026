"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Search, Loader2 } from "lucide-react";
import { listAgendaSubjectsAction, type AgendaSubjectHit } from "./actions";

type SubjType = "customer" | "lead";

/**
 * Modal grande y RESPONSIVE para elegir cliente o lead. Pensado para cuando no
 * recuerdas el nombre o tienes miles de clientes: muestra la lista completa
 * (navegable), se filtra por nombre/teléfono y pagina de 50 en 50. No hay que
 * hacer scroll infinito con 10.000 registros.
 */
export function SubjectPickerModal({
  open,
  onClose,
  onSelect,
  allowedTypes = ["customer", "lead"],
  title = "Buscar cliente o lead",
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (hit: AgendaSubjectHit) => void;
  allowedTypes?: SubjType[];
  title?: string;
}) {
  const [type, setType] = useState<SubjType>(allowedTypes[0] ?? "customer");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AgendaSubjectHit[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  // Al abrir: reset a la primera pestaña y sin filtro.
  useEffect(() => {
    if (!open) return;
    setType(allowedTypes[0] ?? "customer");
    setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cargar la primera página al abrir / cambiar tipo / escribir (con debounce).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await listAgendaSubjectsAction({ type, query, offset: 0 });
        if (!cancelled) {
          setItems(res.items);
          setHasMore(res.hasMore);
          setOffset(0);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, type, query]);

  async function loadMore() {
    const next = offset + 50;
    setLoading(true);
    try {
      const res = await listAgendaSubjectsAction({ type, query, offset: next });
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
      setOffset(next);
    } catch {
      /* no-op */
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[88vh] w-[96vw] max-w-2xl flex-col gap-3 sm:w-full">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {allowedTypes.length > 1 && (
          <div className="flex gap-2">
            {allowedTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-semibold ${
                  type === t
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted"
                }`}
              >
                {t === "customer" ? "Clientes" : "Leads"}
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtra por nombre o teléfono… (vacío = ver todos)"
            className="pl-9"
            autoComplete="off"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Sin resultados.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((r) => (
                <li key={`${r.subject_type}:${r.subject_id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(r);
                      onClose();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-muted"
                  >
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold uppercase text-primary">
                      {r.subject_type === "customer" ? "Cliente" : "Lead"}
                    </span>
                    <span className="truncate font-medium">{r.label}</span>
                    {r.sublabel && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {r.sublabel}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasMore && !loading && (
            <button
              type="button"
              onClick={loadMore}
              className="w-full border-t px-3 py-3 text-sm font-semibold text-primary hover:bg-muted"
            >
              Cargar más
            </button>
          )}
          {loading && items.length > 0 && (
            <div className="flex items-center justify-center gap-2 border-t p-3 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
