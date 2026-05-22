"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  Calendar,
  Wrench,
  CheckCheck,
  ArrowLeft,
  ArrowRight,
  PenLine,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { SignaturePad } from "@/shared/components/signature-pad";
import { signAndInstallFreeTrialSafeAction } from "./actions";

type Step = 1 | 2 | 3 | 4 | 5;

interface Props {
  trialId: string;
  defaultCustomerName: string;
  defaultCustomerTaxId: string | null;
}

/**
 * Modal-wizard pre-instalación para una prueba gratuita:
 *   1. Cuándo: ahora vs día específico.
 *   2. Tipo: instalación PROVISIONAL (de prueba) o DEFINITIVA.
 *   3. Datos del firmante (cliente).
 *   4. Firma del cliente.
 *   5. Firma del comercial → guarda + instala (o programa).
 */
export function SignAndInstallButton({
  trialId,
  defaultCustomerName,
  defaultCustomerTaxId,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [pending, startTransition] = useTransition();

  const [when, setWhen] = useState<"now" | "scheduled">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [isProvisional, setIsProvisional] = useState(true);
  const [signerName, setSignerName] = useState(defaultCustomerName);
  const [signerTaxId, setSignerTaxId] = useState(defaultCustomerTaxId ?? "");
  const [customerSig, setCustomerSig] = useState<string | null>(null);
  const [repSig, setRepSig] = useState<string | null>(null);

  function reset() {
    setStep(1);
    setWhen("now");
    setScheduledDate("");
    setIsProvisional(true);
    setSignerName(defaultCustomerName);
    setSignerTaxId(defaultCustomerTaxId ?? "");
    setCustomerSig(null);
    setRepSig(null);
  }

  function next() {
    if (step === 1) {
      if (when === "scheduled" && !scheduledDate) {
        notify.warning("Indica la fecha");
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (step === 3) {
      if (!signerName.trim()) {
        notify.warning("Indica el nombre del firmante");
        return;
      }
      setStep(4);
      return;
    }
    if (step === 4) {
      if (!customerSig) {
        notify.warning("Falta la firma del cliente");
        return;
      }
      setStep(5);
      return;
    }
  }

  function back() {
    if (step > 1) setStep(((step as number) - 1) as Step);
  }

  function submit() {
    if (!customerSig || !repSig) {
      notify.warning("Faltan firmas");
      return;
    }
    startTransition(async () => {
      const r = await signAndInstallFreeTrialSafeAction({
        trial_id: trialId,
        is_provisional: isProvisional,
        scheduled_for:
          when === "scheduled" ? new Date(`${scheduledDate}T09:00:00`).toISOString() : null,
        customer_signer_name: signerName,
        customer_signer_tax_id: signerTaxId || null,
        customer_signature_data_url: customerSig,
        representative_signature_data_url: repSig,
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(
        r.status === "installed"
          ? "Prueba instalada y firmada"
          : "Prueba programada y firmada",
      );
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="lg"
        variant="success"
        className="w-full"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <PenLine className="h-5 w-5" /> Firmar e instalar
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(false);
            reset();
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Albarán de entrega — paso {step} de 5</DialogTitle>
          </DialogHeader>

          {/* Step 1: ¿Cuándo? */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                ¿Cuándo se va a realizar la entrega del equipo?
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setWhen("now")}
                  className={`flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left ${
                    when === "now"
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Play className="h-5 w-5 text-primary" />
                    <span className="font-bold">Ahora</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    El equipo se entrega/instala ya. Tras firmar quedará en
                    estado &laquo;instalada&raquo;.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setWhen("scheduled")}
                  className={`flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left ${
                    when === "scheduled"
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-primary" />
                    <span className="font-bold">Día específico</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    El comercial firma hoy y la entrega se programa para
                    otro día.
                  </span>
                </button>
              </div>
              {when === "scheduled" && (
                <div className="space-y-1.5">
                  <Label>Fecha prevista de entrega</Label>
                  <Input
                    type="date"
                    value={scheduledDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setScheduledDate(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 2: Tipo */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                ¿Cómo se va a instalar el equipo?
              </p>
              <button
                type="button"
                onClick={() => setIsProvisional(true)}
                className={`flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left ${
                  isProvisional
                    ? "border-amber-500 bg-amber-50"
                    : "border-border bg-card hover:border-amber-300"
                }`}
              >
                <Wrench className="mt-0.5 h-5 w-5 text-amber-600 shrink-0" />
                <div>
                  <div className="font-bold">Instalación provisional (de prueba)</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Conexión rápida para que el cliente pruebe. Si acepta,
                    habrá que reubicar/instalar bien antes de validar el
                    contrato.
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIsProvisional(false)}
                className={`flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left ${
                  !isProvisional
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-border bg-card hover:border-emerald-300"
                }`}
              >
                <CheckCheck className="mt-0.5 h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <div className="font-bold">Instalación definitiva</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Trabajo profesional desde el principio. Si el cliente
                    acepta, no hay que volver a tocar nada.
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* Step 3: Datos del firmante */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Datos de la persona que firma como cliente. Por defecto el
                nombre del cliente, pero puede firmar otra persona (familiar,
                representante).
              </p>
              <div className="space-y-1.5">
                <Label>Nombre completo del firmante</Label>
                <Input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Ej. Juan Pérez García"
                />
              </div>
              <div className="space-y-1.5">
                <Label>DNI / NIE / CIF (opcional)</Label>
                <Input
                  value={signerTaxId}
                  onChange={(e) => setSignerTaxId(e.target.value)}
                  placeholder="12345678X"
                />
              </div>
            </div>
          )}

          {/* Step 4: Firma cliente */}
          {step === 4 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <strong>{signerName}</strong> firma aquí declarando que recibe
                el equipo en depósito y acepta las condiciones del albarán.
              </p>
              {customerSig ? (
                <div className="space-y-2">
                  <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={customerSig} alt="Firma cliente" className="mx-auto max-h-48" />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCustomerSig(null)}
                    className="w-full"
                  >
                    Borrar y firmar de nuevo
                  </Button>
                </div>
              ) : (
                <SignaturePad onConfirm={(d) => setCustomerSig(d)} />
              )}
            </div>
          )}

          {/* Step 5: Firma comercial */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Tú, como representante de la empresa, firmas confirmando la
                entrega.
              </p>
              {repSig ? (
                <div className="space-y-2">
                  <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={repSig} alt="Firma comercial" className="mx-auto max-h-48" />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRepSig(null)}
                    className="w-full"
                  >
                    Borrar y firmar de nuevo
                  </Button>
                </div>
              ) : (
                <SignaturePad onConfirm={(d) => setRepSig(d)} />
              )}
            </div>
          )}

          {/* Footer nav */}
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button variant="ghost" onClick={back} disabled={pending || step === 1}>
              <ArrowLeft className="h-4 w-4" /> Atrás
            </Button>
            {step < 5 ? (
              <Button onClick={next} disabled={pending}>
                Siguiente <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={submit}
                disabled={pending || !customerSig || !repSig}
                variant="success"
              >
                <PenLine className="h-4 w-4" />
                {pending
                  ? "Guardando..."
                  : when === "scheduled"
                    ? "Firmar y programar"
                    : "Firmar e instalar"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
