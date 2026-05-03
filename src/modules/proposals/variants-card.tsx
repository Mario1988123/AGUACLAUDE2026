"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { duplicateProposalAsVariantAction } from "./actions";

interface Variant {
  id: string;
  variant_label: string | null;
  status: string;
  total_cash_cents: number | null;
  monthly_renting_min_cents: number | null;
  monthly_rental_cents: number | null;
}

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(c / 100);
}

export function ProposalVariantsCard({
  proposalId,
  variants,
}: {
  proposalId: string;
  variants: Variant[];
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function create() {
    startTransition(async () => {
      try {
        const newId = await duplicateProposalAsVariantAction(
          proposalId,
          label.trim() || `Variante ${variants.length + 1}`,
        );
        notify.success("Variante creada");
        setOpen(false);
        setLabel("");
        router.push(`/propuestas/${newId}` as never);
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Variantes ({Math.max(variants.length, 1)})</span>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Crear variante
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Esta propuesta no tiene variantes hermanas. Pulsa &laquo;Crear variante&raquo; para
            duplicarla y ofrecer al cliente otra opción (Premium / Económico / con renting…).
            Cuando acepte una, las demás se marcan como descartadas automáticamente.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2">Variante</th>
                  <th className="py-2">Estado</th>
                  <th className="py-2 text-right">Contado</th>
                  <th className="py-2 text-right">Renting</th>
                  <th className="py-2 text-right">Alquiler</th>
                  <th className="py-2 text-right">Ver</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr
                    key={v.id}
                    className={`border-b last:border-0 ${
                      v.id === proposalId ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="py-2 font-semibold">
                      {v.variant_label ?? "—"}
                      {v.id === proposalId && (
                        <Badge variant="outline" className="ml-2">
                          actual
                        </Badge>
                      )}
                    </td>
                    <td className="py-2">
                      <Badge variant="outline" className="capitalize">
                        {v.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-right tabular-nums">{eur(v.total_cash_cents)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {eur(v.monthly_renting_min_cents)}
                      {v.monthly_renting_min_cents != null && "/mes"}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {eur(v.monthly_rental_cents)}
                      {v.monthly_rental_cents != null && "/mes"}
                    </td>
                    <td className="py-2 text-right">
                      {v.id !== proposalId && (
                        <Link
                          href={`/propuestas/${v.id}` as never}
                          className="text-xs text-primary hover:underline"
                          prefetch={false}
                        >
                          Abrir →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva variante</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Etiqueta</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Premium, Económico, Con renting…"
              />
              <p className="text-xs text-muted-foreground">
                Se duplica la propuesta con sus líneas. Puedes editarlas en la nueva.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={create} disabled={pending} variant="success">
                {pending ? "Creando…" : "Duplicar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
