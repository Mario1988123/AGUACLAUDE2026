"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Save, Edit3 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import {
  upsertFinancierSafeAction,
  deleteFinancierSafeAction,
  upsertFinancierCoefficientSafeAction,
  deleteFinancierCoefficientSafeAction,
  type Financier,
} from "./actions";

const KIND_LABEL = {
  renting_strict: "Renting estricto",
  financing: "Financiación",
} as const;

const COMMON_TERMS = [12, 24, 36, 48, 60] as const;

export function FinanciersManager({ initial }: { initial: Financier[] }) {
  const [items, setItems] = useState<Financier[]>(initial);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const ask = useConfirm();
  const [, startTransition] = useTransition();

  async function refresh() {
    // simple: recargar la página para traerla del server
    if (typeof window !== "undefined") location.reload();
  }

  async function onDelete(f: Financier) {
    const ok = await ask({
      title: "Eliminar financiera",
      message: `¿Eliminar "${f.name}"? No afectará a contratos ya firmados con ella.`,
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await deleteFinancierSafeAction(f.id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setItems((arr) => arr.filter((x) => x.id !== f.id));
      notify.success("Financiera eliminada");
    });
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && !adding && (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-muted-foreground">
            Aún no has dado de alta ninguna financiera. Añade la primera
            (Grenke, Credibox, UFA, Pepper, Sabadell, La Caixa…) para poder
            ofrecer renting o financiación al cerrar propuestas.
          </CardContent>
        </Card>
      )}

      {items.map((f) =>
        editingId === f.id ? (
          <FinancierForm
            key={f.id}
            initial={f}
            onDone={() => {
              setEditingId(null);
              refresh();
            }}
          />
        ) : (
          <FinancierCard
            key={f.id}
            f={f}
            onEdit={() => setEditingId(f.id)}
            onDelete={() => onDelete(f)}
          />
        ),
      )}

      {adding ? (
        <FinancierForm
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)} className="w-full gap-2">
          <Plus className="h-4 w-4" /> Añadir financiera
        </Button>
      )}
    </div>
  );
}

function FinancierCard({
  f,
  onEdit,
  onDelete,
}: {
  f: Financier;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={!f.is_active ? "opacity-60" : ""}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            {f.name}
            <Badge variant={f.kind === "renting_strict" ? "warning" : "default"}>
              {KIND_LABEL[f.kind]}
            </Badge>
            {!f.is_active && <Badge variant="outline">Inactiva</Badge>}
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit} className="gap-1">
              <Edit3 className="h-3.5 w-3.5" /> Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={f.accepts_individual ? "success" : "outline"}>
            Particular {f.accepts_individual ? "✓" : "✗"}
          </Badge>
          <Badge variant={f.accepts_autonomo ? "success" : "outline"}>
            Autónomo {f.accepts_autonomo ? "✓" : "✗"}
          </Badge>
          <Badge variant={f.accepts_company ? "success" : "outline"}>
            Empresa {f.accepts_company ? "✓" : "✗"}
          </Badge>
          {f.residual_pct != null && (
            <Badge variant="secondary">Residual {f.residual_pct}%</Badge>
          )}
          {f.reserve_pct != null && (
            <Badge variant="secondary">Reserva {f.reserve_pct}%</Badge>
          )}
        </div>

        <CoefficientsTable financierId={f.id} initial={f.coefficients} />
      </CardContent>
    </Card>
  );
}

function FinancierForm({
  initial,
  onDone,
}: {
  initial?: Financier;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    short_name: initial?.short_name ?? "",
    kind: (initial?.kind ?? "financing") as "renting_strict" | "financing",
    residual_pct:
      initial?.residual_pct != null ? String(initial.residual_pct) : "",
    reserve_pct:
      initial?.reserve_pct != null ? String(initial.reserve_pct) : "",
    accepts_individual: initial?.accepts_individual ?? false,
    accepts_autonomo: initial?.accepts_autonomo ?? true,
    accepts_company: initial?.accepts_company ?? true,
    is_active: initial?.is_active ?? true,
    notes: initial?.notes ?? "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      notify.warning("El nombre es obligatorio");
      return;
    }
    if (form.kind === "renting_strict" && form.accepts_individual) {
      notify.warning(
        "Renting estricto",
        "Por ley solo puede ser para empresas/autónomos. Desactiva «Particular».",
      );
      return;
    }
    startTransition(async () => {
      const r = await upsertFinancierSafeAction({
        id: initial?.id,
        name: form.name.trim(),
        short_name: form.short_name.trim() || null,
        kind: form.kind,
        residual_pct: form.residual_pct ? Number(form.residual_pct) : null,
        reserve_pct: form.reserve_pct ? Number(form.reserve_pct) : null,
        accepts_individual: form.accepts_individual,
        accepts_autonomo: form.accepts_autonomo,
        accepts_company: form.accepts_company,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(initial ? "Financiera actualizada" : "Financiera creada");
      onDone();
    });
  }

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base">
          {initial ? "Editar financiera" : "Nueva financiera"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej. Grenke, Credibox, UFA…"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Alias (listados)</Label>
              <Input
                value={form.short_name}
                onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                placeholder="Ej. Grenke"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Modalidad *</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    kind: "renting_strict",
                    accepts_individual: false,
                  })
                }
                className={`flex-1 rounded-xl border-2 p-3 text-left text-sm ${
                  form.kind === "renting_strict"
                    ? "border-warning bg-warning/10"
                    : "border-border bg-card hover:border-warning/40"
                }`}
              >
                <strong>Renting estricto</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  N cuotas + 1 cuota residual al final (% del importe) para
                  comprar el equipo. Solo empresas/autónomos.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, kind: "financing" })}
                className={`flex-1 rounded-xl border-2 p-3 text-left text-sm ${
                  form.kind === "financing"
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <strong>Financiación</strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  N cuotas y listo. El cliente es dueño del equipo desde el
                  inicio. Admite todos los tipos de cliente.
                </p>
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>% residual (renting estricto)</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={form.residual_pct}
                onChange={(e) => setForm({ ...form, residual_pct: e.target.value })}
                placeholder="2.5"
                disabled={form.kind !== "renting_strict"}
              />
              <p className="text-[11px] text-muted-foreground">
                % del importe total que se paga al final como cuota
                residual de compra.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>% reserva retenida</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={form.reserve_pct}
                onChange={(e) => setForm({ ...form, reserve_pct: e.target.value })}
                placeholder="0"
              />
              <p className="text-[11px] text-muted-foreground">
                % del capital que la financiera retiene hasta finalizar el
                contrato. 0 si no aplica.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Acepta cliente</Label>
            <div className="flex flex-wrap gap-2">
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm ${
                  form.accepts_individual
                    ? "border-success bg-success/10"
                    : "border-border bg-card"
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.accepts_individual}
                  onChange={(e) =>
                    setForm({ ...form, accepts_individual: e.target.checked })
                  }
                  disabled={form.kind === "renting_strict"}
                />
                Particular
              </label>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm ${
                  form.accepts_autonomo
                    ? "border-success bg-success/10"
                    : "border-border bg-card"
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.accepts_autonomo}
                  onChange={(e) =>
                    setForm({ ...form, accepts_autonomo: e.target.checked })
                  }
                />
                Autónomo
              </label>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm ${
                  form.accepts_company
                    ? "border-success bg-success/10"
                    : "border-border bg-card"
                }`}
              >
                <input
                  type="checkbox"
                  checked={form.accepts_company}
                  onChange={(e) =>
                    setForm({ ...form, accepts_company: e.target.checked })
                  }
                />
                Empresa
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full rounded-xl border border-input bg-background p-2 text-sm"
              placeholder="Condiciones, contacto comercial, etc."
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            Activa (visible en propuestas)
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} variant="success" className="gap-2">
              <Save className="h-4 w-4" />
              {pending ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CoefficientsTable({
  financierId,
  initial,
}: {
  financierId: string;
  initial: Financier["coefficients"];
}) {
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const existing = new Set(initial.map((c) => c.term_months));

  function saveCoef(term_months: number, coefficientStr: string) {
    const coefficient = Number(coefficientStr);
    if (!coefficient || coefficient <= 0) {
      notify.warning("Coeficiente inválido");
      return;
    }
    startTransition(async () => {
      const r = await upsertFinancierCoefficientSafeAction({
        financier_id: financierId,
        term_months,
        coefficient,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Coeficiente guardado");
      location.reload();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const r = await deleteFinancierCoefficientSafeAction(id);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Coeficiente eliminado");
      location.reload();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Coeficientes por plazo
        </h4>
        {!adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" /> Añadir
          </Button>
        )}
      </div>
      {initial.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic">
          Aún sin coeficientes. Añade al menos uno para poder calcular cuotas
          desde la propuesta.
        </p>
      )}
      {initial.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Plazo (meses)</th>
                <th className="px-3 py-2 text-right">Coeficiente</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {initial.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-semibold">{c.term_months}m</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {c.coefficient}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      disabled={pending}
                      className="text-destructive hover:underline text-xs"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <CoefForm
          existingTerms={existing}
          onSave={saveCoef}
          onCancel={() => setAdding(false)}
          pending={pending}
        />
      )}
    </div>
  );
}

function CoefForm({
  existingTerms,
  onSave,
  onCancel,
  pending,
}: {
  existingTerms: Set<number>;
  onSave: (term: number, coef: string) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const firstFree = COMMON_TERMS.find((t) => !existingTerms.has(t)) ?? 48;
  const [term, setTerm] = useState(String(firstFree));
  const [coef, setCoef] = useState("");
  return (
    <div className="rounded-lg border-2 border-primary/40 bg-card p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto] items-end">
        <div className="space-y-1">
          <Label className="text-xs">Plazo</Label>
          <Input
            type="number"
            min={1}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Coeficiente</Label>
          <Input
            type="number"
            step="0.000001"
            value={coef}
            onChange={(e) => setCoef(e.target.value)}
            placeholder="0.023750"
          />
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onSave(Number(term), coef)}
          >
            Guardar
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        cuota_cliente = capital_empresa × coeficiente. Ejemplo: 0.023750 a 48
        meses sobre 1.245 € = 29,57 €/mes.
      </p>
    </div>
  );
}
