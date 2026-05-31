"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Contact, Users, FileSignature, FileText, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { globalSearch, type SearchHit } from "./actions";

const ICON: Record<SearchHit["entity"], typeof Contact> = {
  lead: Contact,
  customer: Users,
  contract: FileSignature,
  proposal: FileText,
  installation: Wrench,
};
const ENTITY_LABEL: Record<SearchHit["entity"], string> = {
  lead: "Lead",
  customer: "Cliente",
  contract: "Contrato",
  proposal: "Propuesta",
  installation: "Instalación",
};

export function GlobalSearchTrigger() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buscar en el CRM"
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground hover:bg-muted"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        {/* En móvil y tablet vertical no mostramos el texto ni el atajo ⌘K:
            en móvil sería ruido y en tablet táctil no existe ⌘. */}
        <span className="hidden md:inline">Buscar...</span>
        <kbd className="hidden rounded bg-muted px-1.5 py-0.5 font-mono text-xs lg:inline">
          ⌘K
        </kbd>
      </button>
      <SearchDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    if (!q || q.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        try {
          const res = await globalSearch(q);
          setHits(res);
        } catch {
          setHits([]);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  function go(hit: SearchHit) {
    router.push(hit.href as never);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-0">
        <DialogTitle className="sr-only">Buscar en el CRM</DialogTitle>
        <div className="border-b p-3">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, teléfono, DNI o referencia..."
              className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {q.length < 2 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Escribe al menos 2 caracteres para buscar.
            </p>
          ) : hits.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Sin resultados.</p>
          ) : (
            <ul className="space-y-1">
              {hits.map((h) => {
                const Icon = ICON[h.entity];
                return (
                  <li key={`${h.entity}-${h.id}`}>
                    <button
                      type="button"
                      onClick={() => go(h)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-muted"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{h.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {ENTITY_LABEL[h.entity]}
                          </span>
                        </div>
                        {h.subtitle && (
                          <div className="text-xs text-muted-foreground">{h.subtitle}</div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
