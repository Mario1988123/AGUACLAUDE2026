"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { mergeCustomersSafeAction, type DuplicateCustomerGroup } from "./merge-actions";

const FIELD_LABEL = {
  tax_id: "DNI/CIF",
  email: "Email",
  phone: "Teléfono",
} as const;

export function DuplicatesManager({ groups }: { groups: DuplicateCustomerGroup[] }) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No hay duplicados que mostrar.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {groups.map((g, i) => (
        <DuplicateGroupCard key={`${g.field}-${g.value}-${i}`} group={g} />
      ))}
    </div>
  );
}

function DuplicateGroupCard({ group }: { group: DuplicateCustomerGroup }) {
  const [primaryId, setPrimaryId] = useState<string>(group.customers[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ask = useConfirm();

  async function mergeOne(secondaryId: string) {
    if (!primaryId) {
      notify.warning("Elige el cliente principal primero");
      return;
    }
    const ok = await ask({
      message:
        "¿Fusionar este cliente en el principal? Se moverán contratos, instalaciones, propuestas, wallet y direcciones. El secundario se marcará eliminado.",
      confirmText: "Fusionar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await mergeCustomersSafeAction(primaryId, secondaryId);
      if (!r.ok) {
        notify.error("No se pudo fusionar", r.error);
        return;
      }
      notify.success("Fusionado");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>
            <Badge variant="outline" className="mr-2">
              {FIELD_LABEL[group.field]}
            </Badge>
            {group.value}
          </span>
          <span className="text-xs text-muted-foreground">
            {group.customers.length} clientes
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Marca el cliente <strong>principal</strong> (el que conservará todo). Después pulsa
          &laquo;Fusionar&raquo; en cada secundario para moverle todo y eliminarlo.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-2 w-10">Princ.</th>
              <th className="py-2">Cliente</th>
              <th className="py-2">Tipo</th>
              <th className="py-2">Creado</th>
              <th className="py-2 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {group.customers.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="py-2">
                  <input
                    type="radio"
                    name={`primary-${group.field}-${group.value}`}
                    checked={primaryId === c.id}
                    onChange={() => setPrimaryId(c.id)}
                  />
                </td>
                <td className="py-2 font-semibold">
                  <Link
                    href={`/clientes/${c.id}` as never}
                    className="text-primary hover:underline"
                    prefetch={false}
                  >
                    {c.display_name}
                  </Link>
                </td>
                <td className="py-2 text-xs text-muted-foreground capitalize">
                  {c.party_kind === "company" ? "Empresa" : "Particular"}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString("es-ES")}
                </td>
                <td className="py-2 text-right">
                  {primaryId === c.id ? (
                    <Badge variant="success">Principal</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      onClick={() => mergeOne(c.id)}
                    >
                      Fusionar →
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
