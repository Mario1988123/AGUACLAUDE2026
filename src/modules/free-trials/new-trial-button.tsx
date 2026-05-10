"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  UserPlus,
  Building2,
  User,
  Loader2,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  searchOwners,
  createMinimalLeadAction,
  type OwnerSearchResult,
} from "./quick-create-actions";

type Mode = "menu" | "search" | "create";

export function NewFreeTrialButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [pending, startTransition] = useTransition();

  // Search state
  const [searchKind, setSearchKind] = useState<"all" | "lead" | "customer">("all");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OwnerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Create state
  const [newKind, setNewKind] = useState<"individual" | "company">("individual");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");

  function reset() {
    setMode("menu");
    setQuery("");
    setResults([]);
    setNewName("");
    setNewPhone("");
    setNewEmail("");
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function doSearch() {
    if (query.trim().length < 2) {
      notify.warning("Mínimo 2 caracteres");
      return;
    }
    setSearching(true);
    try {
      const r = await searchOwners(query);
      const filtered =
        searchKind === "all" ? r : r.filter((x) => x.kind === searchKind);
      setResults(filtered);
      if (filtered.length === 0) {
        notify.info(
          "Sin resultados",
          "Prueba a crear un nuevo lead desde el botón de la izquierda",
        );
      }
    } finally {
      setSearching(false);
    }
  }

  function pickOwner(o: OwnerSearchResult) {
    const url =
      o.kind === "customer"
        ? `/pruebas-gratuitas/nueva?customer_id=${o.id}`
        : `/pruebas-gratuitas/nueva?lead_id=${o.id}`;
    close();
    router.push(url as never);
  }

  function createLeadAndGo() {
    if (newName.trim().length < 2) {
      notify.warning("Indica un nombre");
      return;
    }
    startTransition(async () => {
      const r = await createMinimalLeadAction({
        party_kind: newKind,
        display_name: newName,
        email: newEmail || null,
        phone_primary: newPhone || null,
      });
      if (!r.ok) {
        notify.error("No se pudo crear", r.error);
        return;
      }
      notify.success("Lead creado", "Ahora abrimos la prueba gratuita");
      close();
      router.push(`/pruebas-gratuitas/nueva?lead_id=${r.id}` as never);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="success">
        <Plus className="h-4 w-4" /> Nueva prueba
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 overflow-y-auto"
          onClick={() => !pending && close()}
        >
          <div
            className="w-full max-w-xl rounded-2xl border bg-card shadow-2xl my-8 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b p-4">
              <h2 className="text-lg font-bold">¿Para quién es la prueba?</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Una prueba gratuita siempre se asocia a un lead o cliente. Lo
                normal es crear un lead nuevo si es la primera vez que tratas
                con esa persona.
              </p>
            </div>

            {mode === "menu" && (
              <div className="p-4 space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode("create");
                    setNewKind("individual");
                  }}
                  className="w-full rounded-2xl border-2 border-success/40 bg-success/5 p-4 text-left hover:bg-success/10"
                >
                  <div className="flex items-center gap-3">
                    <UserPlus className="h-6 w-6 text-success" />
                    <div>
                      <div className="font-bold">+ Crear nuevo lead</div>
                      <div className="text-xs text-muted-foreground">
                        Recomendado si es la primera vez. Solo nombre y teléfono.
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("search");
                    setSearchKind("lead");
                  }}
                  className="w-full rounded-2xl border-2 border-border bg-card p-4 text-left hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Search className="h-6 w-6 text-primary" />
                    <div>
                      <div className="font-bold">Lead existente</div>
                      <div className="text-xs text-muted-foreground">
                        Buscar un lead que ya esté en el CRM
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("search");
                    setSearchKind("customer");
                  }}
                  className="w-full rounded-2xl border-2 border-border bg-card p-4 text-left hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Building2 className="h-6 w-6 text-primary" />
                    <div>
                      <div className="font-bold">Cliente existente</div>
                      <div className="text-xs text-muted-foreground">
                        Cliente actual al que probamos otro equipo
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {mode === "search" && (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder={
                      searchKind === "customer"
                        ? "Nombre, teléfono o email del cliente…"
                        : searchKind === "lead"
                          ? "Nombre, teléfono o email del lead…"
                          : "Nombre, teléfono o email…"
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doSearch();
                    }}
                    autoFocus
                  />
                  <Button onClick={doSearch} disabled={searching}>
                    {searching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Buscar
                  </Button>
                </div>
                {results.length > 0 && (
                  <ul className="space-y-1 max-h-64 overflow-y-auto">
                    {results.map((r) => (
                      <li key={`${r.kind}-${r.id}`}>
                        <button
                          type="button"
                          onClick={() => pickOwner(r)}
                          className="w-full flex items-center justify-between gap-3 rounded-lg border p-2 text-left hover:bg-muted/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-bold truncate">
                              {r.display_name}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {r.phone ?? r.email ?? "—"}
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              r.kind === "customer"
                                ? "bg-success/15 text-success"
                                : "bg-secondary text-secondary-foreground"
                            }`}
                          >
                            {r.kind === "customer" ? "CLIENTE" : "LEAD"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex justify-between gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setMode("menu")}>
                    ← Volver
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMode("create")}
                  >
                    No lo encuentro → crear nuevo lead
                  </Button>
                </div>
              </div>
            )}

            {mode === "create" && (
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNewKind("individual")}
                    className={`flex-1 rounded-lg border-2 p-2 text-sm font-bold flex items-center justify-center gap-1 ${
                      newKind === "individual"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background"
                    }`}
                  >
                    <User className="h-4 w-4" /> Particular
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewKind("company")}
                    className={`flex-1 rounded-lg border-2 p-2 text-sm font-bold flex items-center justify-center gap-1 ${
                      newKind === "company"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background"
                    }`}
                  >
                    <Building2 className="h-4 w-4" /> Empresa
                  </button>
                </div>
                <div className="space-y-1">
                  <Label>
                    {newKind === "company" ? "Nombre comercial" : "Nombre y apellidos"}
                  </Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={
                      newKind === "company" ? "Hostelería ACME" : "Juan Pérez"
                    }
                    autoFocus
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Teléfono</Label>
                    <Input
                      type="tel"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sin dirección obligatoria. Podrás completar la ficha del
                  lead después de generar la prueba.
                </p>
                <div className="flex justify-between gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setMode("menu")}>
                    ← Volver
                  </Button>
                  <Button
                    onClick={createLeadAndGo}
                    disabled={pending}
                    variant="success"
                  >
                    {pending ? "Creando…" : "Crear lead y abrir prueba"}
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t p-3 text-right">
              <Button variant="ghost" size="sm" onClick={close} disabled={pending}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
