"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { upsertObjectiveAction, deleteObjectiveAction } from "./objectives-actions";

interface Objective {
  id: string;
  period_year: number;
  period_month: number;
  scope_type: "department" | "user";
  scope_department: string | null;
  scope_user_id: string | null;
  metric_kind: string;
  /** Fase 2 — null = todos los tipos. */
  plan_type?: "cash" | "rental" | "renting" | null;
  target_amount_cents: number | null;
  target_units: number | null;
}

const PLAN_TYPE_LABEL: Record<string, string> = {
  cash: "Contado",
  renting: "Renting",
  rental: "Alquiler",
};

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

interface Props {
  objectives: Objective[];
  team: { user_id: string; full_name: string }[];
}

export function ObjectivesManager({ objectives, team }: Props) {
  const [adding, setAdding] = useState(false);
  const now = new Date();
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();

  async function remove(id: string) {
    const ok = await ask({
      message: "¿Eliminar objetivo?",
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteObjectiveAction(id);
        notify.success("Eliminado");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-3">
      {objectives.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Sin objetivos. Define metas mensuales por departamento (nivel 1) o por usuario (nivel 2).
        </div>
      )}
      {objectives.map((o) => (
        <div
          key={o.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
        >
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {String(o.period_month).padStart(2, "0")}/{o.period_year}
              </Badge>
              {o.scope_type === "department" ? (
                <Badge variant="default">
                  Dpto: {DEPT_LABEL[o.scope_department ?? ""] ?? o.scope_department}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  Usuario:{" "}
                  {team.find((t) => t.user_id === o.scope_user_id)?.full_name ?? "?"}
                </Badge>
              )}
              <Badge variant="outline">{o.metric_kind}</Badge>
              {o.plan_type && (
                <Badge variant="secondary">
                  {PLAN_TYPE_LABEL[o.plan_type] ?? o.plan_type}
                </Badge>
              )}
            </div>
            <div className="mt-1 text-sm">
              {o.target_amount_cents != null && (
                <span className="font-bold">
                  {new Intl.NumberFormat("es-ES", {
                    style: "currency",
                    currency: "EUR",
                  }).format(o.target_amount_cents / 100)}
                </span>
              )}
              {o.target_units != null && <span className="ml-2">· {o.target_units} unidades</span>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => remove(o.id)} disabled={pending}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      {adding ? (
        <ObjForm
          team={team}
          year={now.getFullYear()}
          month={now.getMonth() + 1}
          onDone={() => {
            setAdding(false);
            location.reload();
          }}
        />
      ) : (
        <Button onClick={() => setAdding(true)} variant="outline" className="w-full">
          <Plus className="h-4 w-4" /> Nuevo objetivo
        </Button>
      )}
    </div>
  );
}

function ObjForm({
  team,
  year,
  month,
  onDone,
}: {
  team: { user_id: string; full_name: string }[];
  year: number;
  month: number;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    period_year: year,
    period_month: month,
    scope_type: "department" as "department" | "user",
    scope_department: "sales" as "tech" | "sales" | "tmk",
    scope_user_id: "",
    metric_kind: "sales" as "sales" | "contracts" | "installations" | "recoveries",
    /** "" = todos los planes; cash/rental/renting = segmentado */
    plan_type: "" as "" | "cash" | "rental" | "renting",
    target_euros: "",
    target_units: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await upsertObjectiveAction({
          period_year: form.period_year,
          period_month: form.period_month,
          scope_type: form.scope_type,
          scope_department: form.scope_type === "department" ? form.scope_department : null,
          scope_user_id: form.scope_type === "user" ? form.scope_user_id : null,
          metric_kind: form.metric_kind,
          plan_type: form.plan_type || null,
          target_amount_cents: form.target_euros
            ? Math.round(Number(form.target_euros) * 100)
            : null,
          target_units: form.target_units ? Number(form.target_units) : null,
        });
        notify.success("Objetivo guardado");
        onDone();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Año</Label>
              <Input
                type="number"
                value={form.period_year}
                onChange={(e) => setForm({ ...form, period_year: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mes</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={form.period_month}
                onChange={(e) => setForm({ ...form, period_month: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Métrica</Label>
              <select
                value={form.metric_kind}
                onChange={(e) =>
                  setForm({ ...form, metric_kind: e.target.value as typeof form.metric_kind })
                }
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                <option value="sales">Ventas</option>
                <option value="contracts">Contratos</option>
                <option value="installations">Instalaciones</option>
                <option value="recoveries">Recuperaciones</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de venta</Label>
            <div className="flex gap-2 flex-wrap">
              {(
                [
                  { v: "", l: "Todos" },
                  { v: "cash", l: "Contado" },
                  { v: "renting", l: "Renting" },
                  { v: "rental", l: "Alquiler" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() =>
                    setForm({ ...form, plan_type: opt.v as typeof form.plan_type })
                  }
                  className={`rounded-xl border-2 px-3 py-2 text-sm font-bold ${
                    form.plan_type === opt.v
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-muted/30"
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              «Todos» suma cualquier venta del mes. «Contado / Renting / Alquiler»
              solo cuenta esa tipología.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Alcance</Label>
              <select
                value={form.scope_type}
                onChange={(e) =>
                  setForm({ ...form, scope_type: e.target.value as "department" | "user" })
                }
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                <option value="department">Departamento</option>
                <option value="user">Usuario</option>
              </select>
            </div>
            {form.scope_type === "department" ? (
              <div className="space-y-1.5">
                <Label>Departamento</Label>
                <select
                  value={form.scope_department}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      scope_department: e.target.value as "tech" | "sales" | "tmk",
                    })
                  }
                  className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
                >
                  <option value="tech">Técnico</option>
                  <option value="sales">Comercial</option>
                  <option value="tmk">Telemarketing</option>
                </select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Usuario</Label>
                <select
                  value={form.scope_user_id}
                  onChange={(e) => setForm({ ...form, scope_user_id: e.target.value })}
                  className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
                >
                  <option value="">—</option>
                  {team.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Importe (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.target_euros}
                onChange={(e) => setForm({ ...form, target_euros: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Unidades</Label>
              <Input
                type="number"
                value={form.target_units}
                onChange={(e) => setForm({ ...form, target_units: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando..." : "Crear objetivo"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
