"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, FileText, PenLine } from "lucide-react";
import {
  submitRemoteSignatureAction,
  type PublicContractView,
} from "@/modules/contracts/remote-sign-actions";

const PLAN_LABEL: Record<string, string> = {
  cash: "Contado",
  rental: "Alquiler",
  renting: "Renting",
};

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(c / 100);
}

export function RemoteSignClient({
  token,
  contract,
}: {
  token: string;
  contract: PublicContractView;
}) {
  const [email, setEmail] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
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

  function submit() {
    setError(null);
    if (!email.trim()) {
      setError("Introduce tu email.");
      return;
    }
    if (!acceptTerms) {
      setError("Debes aceptar los términos antes de firmar.");
      return;
    }
    const c = canvasRef.current;
    if (!c) return;
    const dataUrl = c.toDataURL("image/png");
    if (dataUrl.length < 500) {
      setError("Captura tu firma antes de continuar.");
      return;
    }
    startTransition(async () => {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;
      const r = await submitRemoteSignatureAction({
        token,
        signer_email: email.trim(),
        signature_data_url: dataUrl,
        consent: acceptTerms,
        client_ip: null, // Vercel header lo capturará en server si está disponible
        client_ua: ua,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-2xl border-2 border-emerald-200 bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-extrabold text-emerald-900">
            ¡Contrato firmado!
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Tu firma se ha registrado correctamente. Te hemos enviado una copia
            firmada en PDF a tu email. {contract.company_name} recibirá una
            notificación y te contactarán para los siguientes pasos.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Ya puedes cerrar esta ventana.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="mx-auto w-full max-w-2xl px-4 space-y-4">
        {/* Cabecera con marca */}
        <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          {contract.company_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={contract.company_logo_url}
              alt={contract.company_name}
              className="h-12 w-12 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="h-6 w-6" />
            </div>
          )}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Contrato pendiente de firma
            </div>
            <h1 className="text-lg font-extrabold">{contract.company_name}</h1>
          </div>
        </div>

        {/* Datos del contrato */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-bold">Resumen del contrato</h2>
          <div className="grid gap-2 text-sm">
            {contract.reference_code && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Referencia:</span>
                <span className="font-mono font-bold">
                  {contract.reference_code}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Modalidad:</span>
              <strong>{PLAN_LABEL[contract.plan_type] ?? contract.plan_type}</strong>
            </div>
            {contract.duration_months && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duración:</span>
                <strong>{contract.duration_months} meses</strong>
              </div>
            )}
            {contract.total_cash_cents != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total contado:</span>
                <strong>{eur(contract.total_cash_cents)}</strong>
              </div>
            )}
            {contract.monthly_cents != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cuota/mes:</span>
                <strong>{eur(contract.monthly_cents)}</strong>
              </div>
            )}
          </div>
          <a
            href={contract.pdf_url}
            target="_blank"
            rel="noopener"
            className="mt-3 inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-bold text-primary hover:bg-primary/10"
          >
            <FileText className="h-4 w-4" /> Ver contrato completo (PDF)
          </a>
        </div>

        {/* Firma */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-base font-bold flex items-center gap-2">
            <PenLine className="h-5 w-5" /> Tu firma
          </h2>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-muted-foreground">
                Confirma tu email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Debe coincidir con el email al que se envió este enlace.
              </p>
            </div>

            <div>
              <label className="text-xs font-bold text-muted-foreground">
                Firma con el ratón o el dedo (si móvil)
              </label>
              <canvas
                ref={canvasRef}
                width={500}
                height={180}
                onPointerDown={startDraw}
                onPointerMove={draw}
                onPointerUp={stopDraw}
                onPointerLeave={stopDraw}
                className="mt-1 w-full rounded-xl border-2 border-dashed bg-white touch-none"
              />
              <button
                type="button"
                onClick={clearCanvas}
                className="mt-1 text-[11px] text-muted-foreground hover:underline"
              >
                Borrar y volver a firmar
              </button>
            </div>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                He leído el contrato y acepto sus términos. Mi firma queda
                registrada con fecha y hora actual. Soy mayor de edad y
                represento legalmente a la parte firmante.
              </span>
            </label>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? "Firmando…" : "Firmar contrato"}
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Tu firma quedará registrada en {contract.company_name} con fecha,
          hora y datos del dispositivo. El enlace caduca a los 14 días.
        </p>
      </div>
    </div>
  );
}
