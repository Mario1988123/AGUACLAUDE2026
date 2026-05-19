"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarCheck2, Clock, UserCog } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { validateMaintenanceJobAction } from "./actions";

interface PreprogrammedJob {
  id: string;
  scheduled_at: string | null;
  customer_id: string;
  customer_name: string | null;
  technician_user_id: string | null;
  reference_code?: string | null;
}

export function PreprogrammedPanel({
  jobs,
  installers,
}: {
  jobs: PreprogrammedJob[];
  installers: Array<{ user_id: string; full_name: string }>;
}) {
  void installers;
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (jobs.length === 0) return null;

  function validate(id: string) {
    startTransition(async () => {
      const r = await validateMaintenanceJobAction({ id });
      if (!r.ok) {
        notify.error("No se pudo validar", r.error);
        return;
      }
      notify.success(
        "Visita validada",
        "Ahora aparece en la agenda como agendada.",
      );
      router.refresh();
    });
  }

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-900">
          <Clock className="h-5 w-5 text-amber-600" />
          Visitas preprogramadas pendientes de validar ({jobs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-amber-900">
          Estas visitas se generaron automáticamente al firmar el contrato.
          Antes de que aparezcan en la agenda real, un admin / TMK debe
          confirmarlas con el cliente y asignar técnico.
        </p>
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link
                  href={`/clientes/${j.customer_id}`}
                  className="truncate text-sm font-semibold hover:underline"
                >
                  {j.customer_name ?? "Cliente"}
                </Link>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {j.scheduled_at
                      ? new Date(j.scheduled_at).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                      : "Sin fecha"}
                  </span>
                  {j.technician_user_id ? (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <UserCog className="h-3 w-3" /> Asignado
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      Sin técnico
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/mantenimientos/${j.id}`}
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
                >
                  Abrir
                </Link>
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => validate(j.id)}
                  disabled={pending}
                  className="gap-1"
                >
                  <CalendarCheck2 className="h-3.5 w-3.5" />
                  Validar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
