"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CreditCard,
  CheckCircle2,
  PenLine,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  createSepaMandateAction,
  signSepaMandateAction,
  updateContractRecurringPaymentMethodAction,
  type SepaMandate,
} from "./mandate-actions";

interface Props {
  contractId: string;
  contractStatus: string;
  paymentMethodRecurring: "direct_debit" | "transfer" | null;
  mandate: SepaMandate | null;
  /** IBAN propio de la empresa para mostrar en modo transferencia. */
  companyIban: string | null;
  /** Admin/dir comercial */
  canEdit: boolean;
}

export function SepaMandatePanel({
  contractId,
  contractStatus,
  paymentMethodRecurring,
  mandate,
  companyIban,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [signOpen, setSignOpen] = useState(false);

  function changeMethod(method: "direct_debit" | "transfer") {
    startTransition(async () => {
      const r = await updateContractRecurringPaymentMethodAction({
        contract_id: contractId,
        method,
      });
      if (!r.ok) {
        notify.error("No se pudo cambiar", r.error);
        return;
      }
      notify.success(
        method === "direct_debit"
          ? "Cobro por domiciliación SEPA"
          : "Cobro por transferencia bancaria",
      );
      router.refresh();
    });
  }

  function generateMandate() {
    startTransition(async () => {
      const r = await createSepaMandateAction({
        contract_id: contractId,
        scheme: "core",
      });
      if (!r.ok) {
        notify.error("No se pudo generar el mandato", r.error);
        return;
      }
      notify.success("Mandato creado. Falta firma del cliente.");
      router.refresh();
    });
  }

  const isRentalOrRenting = ["signed", "active", "pending_data"].includes(
    contractStatus,
  );

  return (
    <div className="space-y-3">
      {/* Selector forma de pago */}
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-2 text-sm font-bold">
          Forma de cobro de cuotas mensuales
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Define cómo se cobran las cuotas recurrentes del contrato. La
          fianza se cobra siempre por transferencia o efectivo (nunca
          domiciliada). Por defecto domiciliación SEPA.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => canEdit && changeMethod("direct_debit")}
            disabled={!canEdit || pending}
            className={`rounded-xl border-2 p-3 text-left transition disabled:opacity-50 ${
              paymentMethodRecurring === "direct_debit" || paymentMethodRecurring === null
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              <span className="text-sm font-bold">Domiciliación SEPA</span>
              {(paymentMethodRecurring === "direct_debit" || paymentMethodRecurring === null) && (
                <Badge variant="default" className="ml-auto text-[10px]">
                  Default
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Cobro automático cada mes desde el IBAN del cliente. Requiere
              firmar el mandato.
            </p>
          </button>
          <button
            type="button"
            onClick={() => canEdit && changeMethod("transfer")}
            disabled={!canEdit || pending}
            className={`rounded-xl border-2 p-3 text-left transition disabled:opacity-50 ${
              paymentMethodRecurring === "transfer"
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              <span className="text-sm font-bold">Transferencia bancaria</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              El cliente recibe el IBAN de la empresa y transfiere cada mes
              manualmente.
            </p>
          </button>
        </div>
      </div>

      {/* Caso TRANSFERENCIA */}
      {paymentMethodRecurring === "transfer" && (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold text-amber-900">
                Pago por transferencia
              </div>
              <p className="mt-1 text-xs text-amber-900">
                El cliente debe ingresar cada mes en el IBAN de la empresa.
                Recordatorio: incluye el código del contrato como concepto.
              </p>
              {companyIban && (
                <div className="mt-2 rounded-lg bg-white p-2 text-xs">
                  <div className="text-muted-foreground">IBAN empresa:</div>
                  <div className="font-mono font-bold">{companyIban}</div>
                </div>
              )}
              {!companyIban && (
                <p className="mt-2 text-xs text-amber-900">
                  ⚠ La empresa no tiene IBAN configurado en{" "}
                  <strong>/configuracion/fiscal</strong>. El cliente no podrá
                  hacer la transferencia.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Caso SEPA */}
      {(paymentMethodRecurring === "direct_debit" ||
        paymentMethodRecurring === null) && (
        <>
          {!mandate && isRentalOrRenting && (
            <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
              <div className="text-sm font-bold mb-1">
                Mandato SEPA pendiente
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Para cobrar las cuotas por domiciliación, genera el mandato y
                obtén la firma del cliente.
              </p>
              {canEdit ? (
                <Button
                  onClick={generateMandate}
                  disabled={pending}
                  variant="success"
                  size="sm"
                  className="gap-2"
                >
                  <PenLine className="h-3 w-3" />
                  {pending ? "Generando…" : "Generar mandato SEPA"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Solo admin o director comercial puede generar el mandato.
                </p>
              )}
            </div>
          )}

          {mandate && (
            <MandateCard
              mandate={mandate}
              canEdit={canEdit}
              onOpenSign={() => setSignOpen(true)}
            />
          )}
        </>
      )}

      {signOpen && mandate && (
        <SignMandateDialog
          mandate={mandate}
          onClose={() => setSignOpen(false)}
          onSigned={() => {
            setSignOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function MandateCard({
  mandate,
  canEdit,
  onOpenSign,
}: {
  mandate: SepaMandate;
  canEdit: boolean;
  onOpenSign: () => void;
}) {
  const tone =
    mandate.status === "active"
      ? "success"
      : mandate.status === "draft"
        ? "warning"
        : "outline";
  const label = {
    draft: "Pendiente de firma",
    active: "Activo",
    cancelled: "Cancelado",
    expired: "Caducado",
  }[mandate.status];
  return (
    <div className="rounded-xl border-2 border-primary/20 bg-card p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-primary" />
          <span className="font-bold">Mandato SEPA</span>
          <Badge variant={tone}>{label}</Badge>
          <Badge variant="outline" className="text-[10px]">
            {mandate.scheme.toUpperCase()}
          </Badge>
        </div>
        {mandate.status === "draft" && canEdit && (
          <Button onClick={onOpenSign} variant="success" size="sm" className="gap-2">
            <PenLine className="h-3 w-3" /> Firmar mandato
          </Button>
        )}
      </div>
      <div className="grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground">UMR:</span>{" "}
          <span className="font-mono">{mandate.umr}</span>
        </div>
        <div>
          <span className="text-muted-foreground">IBAN deudor:</span>{" "}
          <span className="font-mono">{mandate.debtor_iban}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Deudor:</span>{" "}
          {mandate.debtor_name}
        </div>
        <div>
          <span className="text-muted-foreground">Acreedor (CID):</span>{" "}
          <span className="font-mono">{mandate.creditor_id}</span>
        </div>
        {mandate.signed_at && (
          <>
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              <span className="text-muted-foreground">Firmado:</span>{" "}
              {new Date(mandate.signed_at).toLocaleDateString("es-ES")}
            </div>
            <div>
              <span className="text-muted-foreground">Lugar:</span>{" "}
              {mandate.signed_place ?? "—"}
            </div>
          </>
        )}
        {mandate.last_used_at && (
          <div className="sm:col-span-2 text-muted-foreground">
            Último cobro: {new Date(mandate.last_used_at).toLocaleDateString("es-ES")}
          </div>
        )}
      </div>
    </div>
  );
}

function SignMandateDialog({
  mandate,
  onClose,
  onSigned,
}: {
  mandate: SepaMandate;
  onClose: () => void;
  onSigned: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [place, setPlace] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const ctx = c.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";
    ctx.lineCap = "round";
  }
  function draw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const ctx = c.getContext("2d")!;
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
    ctx.stroke();
  }
  function stopDraw() {
    drawingRef.current = false;
  }
  function clearCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  }

  async function save() {
    if (!place.trim()) {
      notify.warning("Indica el lugar de firma");
      return;
    }
    const c = canvasRef.current;
    if (!c) return;
    const dataUrl = c.toDataURL("image/png");
    if (!dataUrl || dataUrl.length < 200) {
      notify.warning("Captura la firma antes de continuar");
      return;
    }
    startTransition(async () => {
      const r = await signSepaMandateAction({
        mandate_id: mandate.id,
        signature_image_path: dataUrl,
        signed_place: place.trim(),
      });
      if (!r.ok) {
        notify.error("No se pudo firmar", r.error);
        return;
      }
      notify.success("Mandato SEPA firmado");
      onSigned();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2"
      onClick={() => !pending && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-2xl border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-bold">Firmar mandato SEPA</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Texto legal del mandato (resumen): mediante la firma, el deudor
          autoriza al acreedor a enviar instrucciones a la entidad bancaria
          para adeudar su cuenta, y a la entidad a efectuar los adeudos
          siguiendo las instrucciones del acreedor. Plazo de devolución de
          8 semanas (Core).
        </p>

        <div className="space-y-2">
          <Label className="text-xs">Lugar de firma</Label>
          <Input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="Ej: Sevilla"
          />
        </div>

        <div className="mt-3">
          <Label className="text-xs">Firma del cliente</Label>
          <canvas
            ref={canvasRef}
            width={500}
            height={150}
            onPointerDown={startDraw}
            onPointerMove={draw}
            onPointerUp={stopDraw}
            onPointerLeave={stopDraw}
            className="mt-1 w-full rounded-xl border-2 border-dashed touch-none"
          />
          <button
            type="button"
            onClick={clearCanvas}
            className="mt-1 text-[11px] text-muted-foreground hover:underline"
          >
            Borrar firma
          </button>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending} variant="success">
            {pending ? "Guardando…" : "Confirmar firma"}
          </Button>
        </div>
      </div>
    </div>
  );
}
