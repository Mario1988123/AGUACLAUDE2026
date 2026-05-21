"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, EyeOff, Eye, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import {
  upsertExpenseCategorySafeAction,
  toggleExpenseCategoryActiveSafeAction,
  type ExpenseCategoryAdmin,
} from "./actions";

const GROUPS: Array<{ code: string; label: string }> = [
  { code: "A_transport", label: "Transporte" },
  { code: "B_lodging", label: "Alojamiento" },
  { code: "C_food", label: "Comidas y dietas" },
  { code: "D_representation", label: "Representación" },
  { code: "E_office", label: "Oficina" },
  { code: "F_technical", label: "Técnico" },
  { code: "G_training", label: "Formación" },
  { code: "H_other", label: "Otros" },
];

const IRPF_OPTIONS = [
  { value: "", label: "—" },
  { value: "per_diem_overnight", label: "Dieta con pernocta" },
  { value: "per_diem_no_overnight", label: "Dieta sin pernocta" },
  { value: "kilometers", label: "Kilometraje" },
];

interface FormState {
  id: string | null;
  code: string;
  name: string;
  group_code: string;
  vat_deductible: boolean;
  irpf_exempt_logic: string;
  default_max_amount_eur: string;
  requires_client_link: boolean;
  display_order: number;
  icon: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  code: "",
  name: "",
  group_code: "H_other",
  vat_deductible: true,
  irpf_exempt_logic: "",
  default_max_amount_eur: "",
  requires_client_link: false,
  display_order: 100,
  icon: "",
  is_active: true,
};

export function CategoriesManager({
  initial,
}: {
  initial: ExpenseCategoryAdmin[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openNew() {
    setForm({ ...EMPTY_FORM, display_order: (initial.at(-1)?.display_order ?? 100) + 10 });
    setOpen(true);
  }

  function openEdit(cat: ExpenseCategoryAdmin) {
    setForm({
      id: cat.id,
      code: cat.code,
      name: cat.name,
      group_code: cat.group_code,
      vat_deductible: cat.vat_deductible,
      irpf_exempt_logic: cat.irpf_exempt_logic ?? "",
      default_max_amount_eur:
        cat.default_max_amount_cents != null
          ? (cat.default_max_amount_cents / 100).toFixed(2)
          : "",
      requires_client_link: cat.requires_client_link,
      display_order: cat.display_order,
      icon: cat.icon ?? "",
      is_active: cat.is_active,
    });
    setOpen(true);
  }

  function save() {
    if (!form.code.trim() || !form.name.trim()) {
      notify.warning("Código y nombre son obligatorios");
      return;
    }
    startTransition(async () => {
      const eur = parseFloat(form.default_max_amount_eur.replace(",", "."));
      const r = await upsertExpenseCategorySafeAction({
        id: form.id,
        code: form.code.trim().toLowerCase().replace(/\s+/g, "_"),
        name: form.name,
        group_code: form.group_code,
        vat_deductible: form.vat_deductible,
        irpf_exempt_logic: form.irpf_exempt_logic || null,
        default_max_amount_cents: Number.isFinite(eur) && eur > 0 ? Math.round(eur * 100) : null,
        requires_client_link: form.requires_client_link,
        display_order: form.display_order,
        icon: form.icon || null,
        is_active: form.is_active,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(form.id ? "Categoría actualizada" : "Categoría creada");
      setOpen(false);
      router.refresh();
    });
  }

  function toggleActive(cat: ExpenseCategoryAdmin) {
    startTransition(async () => {
      const r = await toggleExpenseCategoryActiveSafeAction(cat.id, !cat.is_active);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(cat.is_active ? "Desactivada" : "Activada");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={openNew} variant="success">
          <Plus className="h-4 w-4" /> Nueva categoría
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-2 px-3 text-left">Código</th>
              <th className="py-2 px-3 text-left">Nombre</th>
              <th className="py-2 px-3 text-left">Grupo</th>
              <th className="py-2 px-3 text-center">IVA</th>
              <th className="py-2 px-3 text-right">Cap €</th>
              <th className="py-2 px-3 text-center">Estado</th>
              <th className="py-2 px-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {initial.map((c) => (
              <tr key={c.id} className={c.is_active ? "" : "opacity-50"}>
                <td className="py-2 px-3 font-mono text-xs">{c.code}</td>
                <td className="py-2 px-3 font-bold">{c.name}</td>
                <td className="py-2 px-3 text-xs text-muted-foreground">
                  {GROUPS.find((g) => g.code === c.group_code)?.label ?? c.group_code}
                </td>
                <td className="py-2 px-3 text-center">
                  {c.vat_deductible ? "✓" : "✗"}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {c.default_max_amount_cents != null
                    ? new Intl.NumberFormat("es-ES", {
                        style: "currency",
                        currency: "EUR",
                      }).format(c.default_max_amount_cents / 100)
                    : "—"}
                </td>
                <td className="py-2 px-3 text-center">
                  {c.is_active ? (
                    <Badge variant="success">Activa</Badge>
                  ) : (
                    <Badge variant="secondary">Inactiva</Badge>
                  )}
                </td>
                <td className="py-2 px-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(c)}
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleActive(c)}
                      title={c.is_active ? "Desactivar" : "Activar"}
                      disabled={pending}
                    >
                      {c.is_active ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Editar categoría" : "Nueva categoría"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Código (sin espacios)</Label>
                <Input
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                  placeholder="ej. taxi_largo"
                  disabled={!!form.id}
                />
                {form.id && (
                  <p className="text-[10px] text-muted-foreground">
                    El código no se puede cambiar después de crear.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Nombre visible</Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="ej. Taxi largo recorrido"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Grupo</Label>
                <select
                  value={form.group_code}
                  onChange={(e) => set("group_code", e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {GROUPS.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Lógica IRPF</Label>
                <select
                  value={form.irpf_exempt_logic}
                  onChange={(e) => set("irpf_exempt_logic", e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {IRPF_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tope alerta (€/ticket)</Label>
                <Input
                  value={form.default_max_amount_eur}
                  onChange={(e) => set("default_max_amount_eur", e.target.value)}
                  placeholder="ej. 30.00"
                />
                <p className="text-[10px] text-muted-foreground">
                  Si se supera este importe, salta aviso (no bloquea).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Orden visual</Label>
                <Input
                  type="number"
                  value={form.display_order}
                  onChange={(e) => set("display_order", Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Icono lucide (opcional)</Label>
              <Input
                value={form.icon}
                onChange={(e) => set("icon", e.target.value)}
                placeholder="ej. Car, Hotel, UtensilsCrossed"
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.vat_deductible}
                  onChange={(e) => set("vat_deductible", e.target.checked)}
                />
                IVA deducible
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.requires_client_link}
                  onChange={(e) => set("requires_client_link", e.target.checked)}
                />
                Requiere asociar cliente
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set("is_active", e.target.checked)}
                />
                Activa
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending} variant="success">
              <Save className="h-4 w-4" /> {pending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
