"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ShoppingCart, Droplets } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertSavingsBrandAction,
  deleteSavingsBrandAction,
  type SavingsBrand,
} from "./actions";

export function SavingsBrandsManager({ initial }: { initial: SavingsBrand[] }) {
  const supermarket = initial.filter((b) => b.kind === "supermarket");
  const services = initial.filter((b) => b.kind === "service");
  const [activeTab, setActiveTab] = useState<"supermarket" | "service">("supermarket");
  const [editing, setEditing] = useState<SavingsBrand | null>(null);
  const [creating, setCreating] = useState<"supermarket" | "service" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b">
        <TabBtn active={activeTab === "supermarket"} onClick={() => setActiveTab("supermarket")}>
          <ShoppingCart className="h-4 w-4" /> Supermercado ({supermarket.length})
        </TabBtn>
        <TabBtn active={activeTab === "service"} onClick={() => setActiveTab("service")}>
          <Droplets className="h-4 w-4" /> Servicio garrafas ({services.length})
        </TabBtn>
      </div>

      {activeTab === "supermarket" ? (
        <div className="space-y-2">
          {supermarket.map((b) => (
            <BrandRow key={b.id} brand={b} onEdit={() => setEditing(b)} />
          ))}
          <Button onClick={() => setCreating("supermarket")} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" /> Añadir marca de supermercado
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {services.map((b) => (
            <BrandRow key={b.id} brand={b} onEdit={() => setEditing(b)} />
          ))}
          <Button onClick={() => setCreating("service")} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" /> Añadir servicio
          </Button>
        </div>
      )}

      {editing && (
        <BrandModal brand={editing} onClose={() => setEditing(null)} />
      )}
      {creating && (
        <BrandModal
          brand={{
            id: "",
            name: "",
            kind: creating,
            price_per_liter_cents: creating === "supermarket" ? 50 : null,
            price_source: creating === "supermarket" ? "manual" : null,
            scrape_query: null,
            last_scraped_at: null,
            last_scrape_failed_at: null,
            consecutive_failures: 0,
            prices_by_garrafas:
              creating === "service"
                ? { "2": 1590, "3": 2385, "4": 3180, "5": 3975, "6": 4770, "7": 5565, "8": 6360 }
                : null,
            is_active: true,
            display_order: 100,
          }}
          onClose={() => setCreating(null)}
          isNew
        />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-bold border-b-2 ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function BrandRow({
  brand,
  onEdit,
}: {
  brand: SavingsBrand;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function del() {
    if (!confirm(`¿Eliminar "${brand.name}"?`)) return;
    startTransition(async () => {
      try {
        await deleteSavingsBrandAction(brand.id);
        notify.success("Marca eliminada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="font-bold">{brand.name}</div>
        <div className="text-xs text-muted-foreground">
          {brand.kind === "supermarket" ? (
            <>
              {brand.price_per_liter_cents != null
                ? `${(brand.price_per_liter_cents / 100).toFixed(2)} €/L`
                : "—"}
              {" · "}
              {brand.price_source === "manual" ? "Manual" : `Scraper ${brand.price_source?.replace("scraper_", "")}`}
            </>
          ) : (
            <>
              Servicio · {Object.keys(brand.prices_by_garrafas ?? {}).length} tarifas
            </>
          )}
        </div>
      </div>
      <div className="flex gap-1">
        <Button onClick={onEdit} variant="outline" size="sm" className="gap-1">
          <Pencil className="h-3 w-3" /> Editar
        </Button>
        <Button onClick={del} disabled={pending} variant="outline" size="sm" className="gap-1 text-destructive">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function BrandModal({
  brand,
  onClose,
  isNew = false,
}: {
  brand: SavingsBrand;
  onClose: () => void;
  isNew?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(brand.name);
  const [pricePerLiterEur, setPricePerLiterEur] = useState(
    brand.price_per_liter_cents != null ? (brand.price_per_liter_cents / 100).toFixed(2) : "",
  );
  const [priceSource, setPriceSource] = useState<"manual" | "scraper_mercadona" | "scraper_carrefour">(
    (brand.price_source as "manual" | "scraper_mercadona" | "scraper_carrefour") ?? "manual",
  );
  const [scrapeQuery, setScrapeQuery] = useState(brand.scrape_query ?? "");
  const [pricesByGarrafas, setPricesByGarrafas] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(brand.prices_by_garrafas ?? {}).map(([k, v]) => [
        k,
        ((v as number) / 100).toFixed(2),
      ]),
    ),
  );

  function save() {
    if (!name.trim()) {
      notify.warning("Indica el nombre");
      return;
    }
    startTransition(async () => {
      try {
        const payload: Partial<SavingsBrand> & { id?: string } = {
          name,
          kind: brand.kind,
          is_active: true,
        };
        if (!isNew) payload.id = brand.id;
        if (brand.kind === "supermarket") {
          const v = Number(pricePerLiterEur.replace(",", "."));
          payload.price_per_liter_cents = Number.isFinite(v) ? Math.round(v * 100) : 0;
          payload.price_source = priceSource;
          payload.scrape_query = scrapeQuery || null;
        } else {
          const out: Record<string, number> = {};
          for (const [g, eur] of Object.entries(pricesByGarrafas)) {
            const v = Number(eur.replace(",", "."));
            if (Number.isFinite(v) && v > 0) out[g] = Math.round(v * 100);
          }
          payload.prices_by_garrafas = out;
        }
        await upsertSavingsBrandAction(payload);
        notify.success("Marca guardada");
        onClose();
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-4 p-5">
          <h2 className="text-lg font-bold">
            {isNew ? "Nueva marca" : `Editar ${brand.name}`} · {brand.kind === "supermarket" ? "Supermercado" : "Servicio"}
          </h2>
          <div className="space-y-1">
            <Label>Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {brand.kind === "supermarket" ? (
            <>
              <div className="space-y-1">
                <Label>Precio por litro (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={pricePerLiterEur}
                  onChange={(e) => setPricePerLiterEur(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Origen del precio</Label>
                <select
                  value={priceSource}
                  onChange={(e) => setPriceSource(e.target.value as "manual" | "scraper_mercadona" | "scraper_carrefour")}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option value="manual">Manual (fijo)</option>
                  <option value="scraper_mercadona">Scraper Mercadona</option>
                  <option value="scraper_carrefour">Scraper Carrefour</option>
                </select>
              </div>
              {priceSource !== "manual" && (
                <div className="space-y-1">
                  <Label>Término de búsqueda en el scraper</Label>
                  <Input
                    value={scrapeQuery}
                    onChange={(e) => setScrapeQuery(e.target.value)}
                    placeholder="Bezoya 1.5L"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    El scraper busca este término en el catálogo de {priceSource === "scraper_mercadona" ? "Mercadona" : "Carrefour"} y guarda el precio del primer resultado relevante.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <Label>Precios por nº de garrafas/mes (€)</Label>
              <div className="grid grid-cols-2 gap-2">
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <div key={n} className="flex items-center gap-2">
                    <span className="text-xs font-bold w-12">{n} garr.</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={pricesByGarrafas[String(n)] ?? ""}
                      onChange={(e) =>
                        setPricesByGarrafas({ ...pricesByGarrafas, [n]: e.target.value })
                      }
                      placeholder="€"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending} variant="success">
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
