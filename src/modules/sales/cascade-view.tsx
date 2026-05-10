"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import {
  setDeptObjective,
  setUserObjective,
  type CascadeDept,
} from "./cascade-actions";

function eur(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function progressBar(actual: number, target: number | null) {
  if (!target || target <= 0) return null;
  const pct = Math.min(150, Math.round((actual * 100) / target));
  const color =
    pct >= 100 ? "bg-success" : pct >= 70 ? "bg-warning" : "bg-destructive";
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full ${color} transition-all`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export function ObjectivesCascadeView({
  year,
  month,
  data,
  isLevel1,
  myDepartments,
}: {
  year: number;
  month: number;
  data: CascadeDept[];
  isLevel1: boolean;
  myDepartments: ("sales" | "tech" | "tmk")[];
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <Info className="inline h-4 w-4 -mt-0.5 mr-1" />
        <strong>Cascada de objetivos.</strong> El nivel 1 (admin) define un
        objetivo informativo por departamento. Los nivel 2 (directores)
        distribuyen ese objetivo entre los miembros de su equipo. La suma
        de los objetivos individuales puede ser mayor o menor que el del
        departamento — ambos son informativos y se comparan con la
        realización real del mes.
      </div>

      {data.map((dept) => (
        <DeptCard
          key={dept.department}
          dept={dept}
          year={year}
          month={month}
          isLevel1={isLevel1}
          canEditUsers={
            isLevel1 || myDepartments.includes(dept.department)
          }
        />
      ))}
    </div>
  );
}

function DeptCard({
  dept,
  year,
  month,
  isLevel1,
  canEditUsers,
}: {
  dept: CascadeDept;
  year: number;
  month: number;
  isLevel1: boolean;
  canEditUsers: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [targetEur, setTargetEur] = useState(
    dept.dept_target_amount_cents != null
      ? (dept.dept_target_amount_cents / 100).toFixed(0)
      : "",
  );
  const [targetUnits, setTargetUnits] = useState(
    dept.dept_target_units != null ? String(dept.dept_target_units) : "",
  );

  function saveDept() {
    const amount = targetEur.trim()
      ? Math.round(Number(targetEur.replace(",", ".")) * 100)
      : null;
    const units = targetUnits.trim() ? Math.floor(Number(targetUnits)) : null;
    startTransition(async () => {
      const r = await setDeptObjective({
        year,
        month,
        department: dept.department,
        target_amount_cents: amount,
        target_units: units,
      });
      if (r.ok) {
        notify.success("Objetivo de departamento guardado");
        router.refresh();
      } else {
        notify.error("Error", r.error);
      }
    });
  }

  const distributedVsTarget = dept.dept_target_amount_cents
    ? Math.round(
        (dept.distributed_amount_cents * 100) / dept.dept_target_amount_cents,
      )
    : null;

  const matchVariant: "success" | "warning" | "destructive" | "default" =
    distributedVsTarget == null
      ? "default"
      : distributedVsTarget < 80
        ? "destructive"
        : distributedVsTarget > 120
          ? "warning"
          : "success";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            🎯 Departamento {dept.department_label}
          </span>
          <Badge variant={matchVariant}>
            Distribuido: {eur(dept.distributed_amount_cents)} /{" "}
            {dept.dept_target_amount_cents
              ? `${eur(dept.dept_target_amount_cents)} (${distributedVsTarget}%)`
              : "sin objetivo dpto"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sección NIVEL 1: target del departamento */}
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-primary">
              Objetivo informativo del departamento (nivel 1)
            </h3>
            {!isLevel1 && (
              <Badge variant="secondary" className="text-[10px]">
                Solo admin edita
              </Badge>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">
                Importe €
              </label>
              <Input
                type="number"
                min={0}
                value={targetEur}
                onChange={(e) => setTargetEur(e.target.value)}
                disabled={!isLevel1}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-muted-foreground">
                Nº ventas/contratos
              </label>
              <Input
                type="number"
                min={0}
                value={targetUnits}
                onChange={(e) => setTargetUnits(e.target.value)}
                disabled={!isLevel1}
              />
            </div>
            {isLevel1 && (
              <div className="flex items-end">
                <Button
                  onClick={saveDept}
                  disabled={pending}
                  variant="success"
                  className="w-full"
                >
                  <Save className="h-4 w-4" /> Guardar dpto
                </Button>
              </div>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 text-xs">
            <div className="rounded-lg bg-card p-2">
              <div className="text-muted-foreground">Realizado del mes</div>
              <div className="font-bold tabular-nums">
                {eur(dept.actual_amount_cents)} · {dept.actual_units} ventas
              </div>
              {progressBar(
                dept.actual_amount_cents,
                dept.dept_target_amount_cents,
              )}
            </div>
            <div className="rounded-lg bg-card p-2">
              <div className="text-muted-foreground">Distribuido (suma)</div>
              <div className="font-bold tabular-nums">
                {eur(dept.distributed_amount_cents)} ·{" "}
                {dept.distributed_units} ventas
              </div>
              {dept.dept_target_amount_cents && (
                <div className="mt-1 text-[10px]">
                  {distributedVsTarget != null && (
                    <>
                      {distributedVsTarget < 80 && (
                        <span className="text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Te quedas corto
                          ({distributedVsTarget}% del target)
                        </span>
                      )}
                      {distributedVsTarget >= 80 && distributedVsTarget <= 120 && (
                        <span className="text-success flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Distribución
                          coherente ({distributedVsTarget}%)
                        </span>
                      )}
                      {distributedVsTarget > 120 && (
                        <span className="text-warning flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Has pasado el
                          target del dpto ({distributedVsTarget}%)
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sección NIVEL 2: distribución por usuarios */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-bold">
              Distribución por miembro ({dept.users.length} {dept.department_label.toLowerCase()})
            </h3>
            {!canEditUsers && (
              <Badge variant="secondary" className="text-[10px]">
                Solo dirección de {dept.department_label.toLowerCase()} edita
              </Badge>
            )}
          </div>
          {dept.users.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
              Sin usuarios en este departamento.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Miembro</th>
                    <th className="px-3 py-2 text-right">Target €</th>
                    <th className="px-3 py-2 text-right">Target uds</th>
                    <th className="px-3 py-2 text-right">Realizado €</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dept.users.map((u) => (
                    <UserRow
                      key={u.user_id}
                      user={u}
                      department={dept.department}
                      year={year}
                      month={month}
                      canEdit={canEditUsers}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function UserRow({
  user,
  department,
  year,
  month,
  canEdit,
}: {
  user: CascadeDept["users"][number];
  department: "sales" | "tech" | "tmk";
  year: number;
  month: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [tEur, setTEur] = useState(
    user.user_target_amount_cents != null
      ? (user.user_target_amount_cents / 100).toFixed(0)
      : "",
  );
  const [tUnits, setTUnits] = useState(
    user.user_target_units != null ? String(user.user_target_units) : "",
  );

  function save() {
    const amount = tEur.trim()
      ? Math.round(Number(tEur.replace(",", ".")) * 100)
      : null;
    const units = tUnits.trim() ? Math.floor(Number(tUnits)) : null;
    startTransition(async () => {
      const r = await setUserObjective({
        year,
        month,
        user_id: user.user_id,
        department,
        target_amount_cents: amount,
        target_units: units,
      });
      if (r.ok) {
        notify.success("Objetivo guardado");
        setEditing(false);
        router.refresh();
      } else {
        notify.error("Error", r.error);
      }
    });
  }

  const pct =
    user.user_target_amount_cents != null && user.user_target_amount_cents > 0
      ? Math.round(
          (user.user_actual_amount_cents * 100) /
            user.user_target_amount_cents,
        )
      : null;

  return (
    <tr>
      <td className="px-3 py-2 font-medium">{user.full_name}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {editing ? (
          <Input
            type="number"
            min={0}
            value={tEur}
            onChange={(e) => setTEur(e.target.value)}
            className="h-8 w-24 ml-auto text-right"
          />
        ) : (
          eur(user.user_target_amount_cents)
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {editing ? (
          <Input
            type="number"
            min={0}
            value={tUnits}
            onChange={(e) => setTUnits(e.target.value)}
            className="h-8 w-16 ml-auto text-right"
          />
        ) : (
          user.user_target_units ?? "—"
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {eur(user.user_actual_amount_cents)}
      </td>
      <td className="px-3 py-2 text-right">
        {pct != null ? (
          <Badge
            variant={
              pct >= 100 ? "success" : pct >= 70 ? "warning" : "destructive"
            }
          >
            {pct}%
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Editar
          </Button>
        )}
        {editing && (
          <div className="inline-flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="success"
              onClick={save}
              disabled={pending}
            >
              Guardar
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
