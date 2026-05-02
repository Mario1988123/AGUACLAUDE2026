"use client";

import { useState, useTransition } from "react";
import { PenLine, FileSignature } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { SignaturePad } from "@/shared/components/signature-pad";
import { notify } from "@/shared/hooks/use-toast";
import { uploadInstallationSignature } from "./photo-actions";

interface Props {
  installationId: string;
  existingSignatures: { id: string; signer_role: string; signer_name: string; context: string | null; signed_at: string }[];
}

export function SignaturesSection({ installationId, existingSignatures }: Props) {
  const [active, setActive] = useState<"work_report" | "previous_damage" | "countertop_drilling" | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerTaxId, setSignerTaxId] = useState("");
  const [pending, startTransition] = useTransition();

  function confirm(dataUrl: string) {
    if (!active) return;
    if (!signerName) {
      notify.warning("Nombre del firmante obligatorio");
      return;
    }
    startTransition(async () => {
      try {
        await uploadInstallationSignature({
          installation_id: installationId,
          signer_role: "customer",
          signer_name: signerName,
          signer_tax_id: signerTaxId || undefined,
          data_url: dataUrl,
          context: active,
        });
        notify.success("Firma guardada");
        setActive(null);
        setSignerName("");
        setSignerTaxId("");
        location.reload();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSignature className="h-5 w-5" /> Firmas del cliente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {existingSignatures.length > 0 && (
          <ul className="space-y-2">
            {existingSignatures.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-sm"
              >
                <div>
                  <div className="font-semibold">{s.signer_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.signed_at).toLocaleString("es-ES")}
                  </div>
                </div>
                <Badge variant="success">{s.context ?? "—"}</Badge>
              </li>
            ))}
          </ul>
        )}

        {active ? (
          <div className="space-y-3 rounded-xl border-2 border-primary bg-primary/5 p-4">
            <div className="text-sm font-bold uppercase">Firma: {active.replace(/_/g, " ")}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nombre firmante *</Label>
                <Input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>DNI / NIE</Label>
                <Input value={signerTaxId} onChange={(e) => setSignerTaxId(e.target.value)} />
              </div>
            </div>
            <SignaturePad onConfirm={confirm} pending={pending} />
            <Button variant="outline" onClick={() => setActive(null)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="outline" onClick={() => setActive("previous_damage")}>
              <PenLine className="h-4 w-4" /> Daños previos
            </Button>
            <Button variant="outline" onClick={() => setActive("countertop_drilling")}>
              <PenLine className="h-4 w-4" /> Agujero encimera
            </Button>
            <Button onClick={() => setActive("work_report")}>
              <PenLine className="h-4 w-4" /> Parte trabajo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
