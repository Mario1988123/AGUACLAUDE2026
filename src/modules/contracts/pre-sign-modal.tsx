"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  AlertTriangle,
  Pencil,
  CheckCircle2,
  Loader2,
  MapPin,
  CreditCard,
  Camera,
  Mail,
  Phone,
  IdCard,
  ArrowLeft,
  ArrowRight,
  PenLine,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { TaxIdInput } from "@/shared/components/tax-id-input";
import { PhoneInput } from "@/shared/components/phone-input";
import { DedupeWarning } from "@/shared/components/dedupe-warning";
import { useDedupe } from "@/shared/hooks/use-dedupe";
import { IbanInput } from "@/shared/components/iban-input";
import { checkIbanLive, isPendingIban } from "@/shared/lib/validations/iban-partial";
import {
  validateDNIorNIE,
  validateCIF,
  validateSpanishPhone,
} from "@/shared/lib/validations/spanish";
import {
  getContractPreSignReadiness,
  type PreSignReadiness,
} from "./pre-sign-actions";
import { updateCustomerSafeAction } from "@/modules/customers/actions";
import { upsertAddressSafeAction } from "@/modules/addresses/actions";
import { createBankAccountSafeAction } from "@/modules/customers/bank-accounts/actions";
import { uploadContractPhotoAction } from "./photo-actions";
import { markContractSignedSafeAction } from "./actions";
import { recordCustomerConsentSafe } from "@/modules/customers/consents-actions";

interface Props {
  contractId: string;
  onClose: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

const STEPS: Array<{ n: Step; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { n: 1, label: "Datos cliente", icon: IdCard },
  { n: 2, label: "Dirección", icon: MapPin },
  { n: 3, label: "IBAN", icon: CreditCard },
  { n: 4, label: "Foto DNI", icon: Camera },
  { n: 5, label: "Firmar", icon: PenLine },
];

export function PreSignContractModal({ contractId, onClose }: Props) {
  const [readiness, setReadiness] = useState<PreSignReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>(1);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // RGPD — el cliente debe consentir el tratamiento de datos (obligatorio
  // para poder facturar y atender). Comunicaciones comerciales y perfilado
  // son OPCIONALES — el cliente puede aceptar o rechazar.
  const [consentDataProcessing, setConsentDataProcessing] = useState(true);
  const [consentCommercial, setConsentCommercial] = useState(false);
  const [consentProfiling, setConsentProfiling] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = await getContractPreSignReadiness(contractId);
      setReadiness(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  function sign() {
    if (!readiness) return;
    if (readiness.blockers.length > 0) {
      notify.warning(
        "No puedes firmar todavía",
        `Faltan datos críticos: ${readiness.blockers.join(", ")}`,
      );
      return;
    }
    if (!consentDataProcessing) {
      notify.warning(
        "Falta consentimiento obligatorio",
        "El cliente debe aceptar el tratamiento de datos para poder facturar y atender.",
      );
      return;
    }
    startTransition(async () => {
      const cid = readiness.customer.id;
      const consents = await Promise.all([
        recordCustomerConsentSafe({
          customer_id: cid,
          kind: "data_processing",
          granted: true,
          source: "contract_sign",
          source_ref_id: contractId,
        }),
        recordCustomerConsentSafe({
          customer_id: cid,
          kind: "commercial",
          granted: consentCommercial,
          source: "contract_sign",
          source_ref_id: contractId,
        }),
        recordCustomerConsentSafe({
          customer_id: cid,
          kind: "profiling",
          granted: consentProfiling,
          source: "contract_sign",
          source_ref_id: contractId,
        }),
      ]);
      const firstFail = consents.find((r) => !r.ok);
      if (firstFail && !firstFail.ok) {
        notify.error("No se pudo registrar el consentimiento", firstFail.error);
        return;
      }
      const r = await markContractSignedSafeAction(contractId);
      if (!r.ok) {
        notify.error("No se pudo firmar", r.error);
        return;
      }
      notify.success("Contrato firmado");
      onClose();
      router.refresh();
    });
  }

  // IBAN solo es obligatorio si el contrato tiene cuotas (rental/renting).
  // Para venta al contado (cash) es opcional.
  const ibanRequired =
    readiness?.plan_type === "rental" || readiness?.plan_type === "renting";

  // Estado por paso para mostrar feedback en el stepper
  const stepStatus: Record<Step, "ok" | "warn" | "fail" | "neutral"> = {
    1:
      readiness?.checks.has_tax_id && readiness?.checks.tax_id_valid_format
        ? "ok"
        : "fail",
    2: readiness?.checks.has_address ? "ok" : "fail",
    3: readiness?.checks.has_iban
      ? readiness.checks.iban_validated
        ? "ok"
        : "warn"
      : ibanRequired
        ? "fail"
        : "neutral",
    4: readiness?.checks.has_id_photo ? "ok" : "warn",
    5: "neutral",
  };

  function goNext() {
    setStep((s) => (s < 5 ? ((s + 1) as Step) : s));
  }
  function goBack() {
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-screen w-full flex-col overflow-hidden bg-card shadow-2xl sm:my-6 sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <div className="min-w-0 flex-1 pr-2">
            <h2 className="text-lg font-bold">Firmar contrato</h2>
            <p className="truncate text-xs text-muted-foreground">
              Paso {step} de {STEPS.length} · {STEPS[step - 1]?.label}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 hover:bg-muted"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex shrink-0 items-center justify-between gap-1 overflow-x-auto border-b bg-muted/30 px-3 py-3">
          {STEPS.map((s) => {
            const Icon = s.icon;
            const active = step === s.n;
            const status = stepStatus[s.n];
            const tone =
              status === "ok"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : status === "warn"
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : status === "fail"
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-border bg-card text-muted-foreground";
            return (
              <button
                key={s.n}
                type="button"
                onClick={() => setStep(s.n)}
                className={`flex flex-1 min-w-0 items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2 text-xs font-bold transition ${
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : tone
                }`}
                title={s.label}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{s.n}. {s.label}</span>
                <span className="sm:hidden">{s.n}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        {loading || !readiness ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {/* PASO 1: Datos cliente */}
            {step === 1 && (
              <div className="space-y-3">
                <SectionStatus
                  ok={readiness.checks.has_tax_id && readiness.checks.tax_id_valid_format}
                  okLabel={`✓ ${
                    readiness.customer.party_kind === "company" && !readiness.customer.is_autonomo
                      ? "CIF"
                      : "DNI/NIE"
                  } válido: ${readiness.customer.tax_id}`}
                  failLabel={
                    readiness.customer.tax_id
                      ? `${
                          readiness.customer.party_kind === "company" && !readiness.customer.is_autonomo
                            ? "CIF"
                            : "DNI/NIE"
                        } con formato inválido — corrígelo abajo`
                      : "Falta DNI/CIF — completa los datos abajo"
                  }
                />
                {/* Resumen email/tel arriba con botón Editar si faltan */}
                <div className="grid grid-cols-2 gap-2">
                  <MiniCheck
                    icon={<Mail className="h-3.5 w-3.5" />}
                    label="Email"
                    ok={readiness.checks.has_email}
                    value={readiness.customer.email ?? "—"}
                    onEdit={() => {
                      const el = document.querySelector<HTMLInputElement>(
                        'input[type="email"]',
                      );
                      el?.focus();
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  />
                  <MiniCheck
                    icon={<Phone className="h-3.5 w-3.5" />}
                    label="Teléfono"
                    ok={readiness.checks.has_phone}
                    value={readiness.customer.phone_primary ?? "—"}
                    onEdit={() => {
                      const el = document.querySelector<HTMLInputElement>(
                        'input[type="tel"]',
                      );
                      el?.focus();
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  />
                </div>
                <CustomerEditForm
                  customer={readiness.customer}
                  onSaved={() => void reload()}
                />
              </div>
            )}

            {/* PASO 2: Dirección */}
            {step === 2 && (
              <div className="space-y-3">
                <SectionStatus
                  ok={readiness.checks.has_address}
                  okLabel={`✓ ${readiness.primary_address?.street ?? ""}${readiness.primary_address?.street_number ? ` ${readiness.primary_address.street_number}` : ""}, ${readiness.primary_address?.city ?? ""}`}
                  failLabel="Falta dirección — completa los campos abajo"
                />
                <AddressEditForm
                  customerId={readiness.customer.id}
                  initial={readiness.primary_address}
                  onSaved={() => void reload()}
                />
              </div>
            )}

            {/* PASO 3: IBAN */}
            {step === 3 && (
              <div className="space-y-3">
                {!ibanRequired && (
                  <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                    <strong>Plan al contado (cash):</strong> el IBAN NO es
                    obligatorio para firmar. Puedes añadirlo si lo deseas
                    para tener el dato del cliente, pero puedes pulsar
                    «Siguiente» sin completarlo.
                  </div>
                )}
                <SectionStatus
                  ok={readiness.checks.has_iban || !ibanRequired}
                  warning={
                    readiness.checks.has_iban && !readiness.checks.iban_validated
                  }
                  okLabel={
                    readiness.primary_bank
                      ? readiness.primary_bank.is_validated
                        ? `✓ IBAN validado: ${readiness.primary_bank.iban}`
                        : `IBAN pendiente — necesario cambiarlo cuando lo tengas`
                      : "IBAN no necesario para venta al contado"
                  }
                  failLabel="Falta IBAN — añade la cuenta del cliente abajo"
                />
                <IbanAddForm
                  customerId={readiness.customer.id}
                  defaultHolder={
                    readiness.customer.party_kind === "company"
                      ? readiness.customer.legal_name ?? ""
                      : `${readiness.customer.first_name ?? ""} ${readiness.customer.last_name ?? ""}`.trim()
                  }
                  onSaved={() => void reload()}
                />
              </div>
            )}

            {/* PASO 4: Foto DNI */}
            {step === 4 && (
              <div className="space-y-3">
                <SectionStatus
                  ok={readiness.checks.has_id_photo}
                  warning={!readiness.checks.has_id_photo}
                  okLabel="✓ Foto del DNI/NIE subida"
                  failLabel="Recomendado: foto del DNI/NIE (no obligatorio)"
                />
                <PhotoUploadInline
                  contractId={contractId}
                  onUploaded={() => void reload()}
                />
              </div>
            )}

            {/* PASO 5: Confirmar y firmar */}
            {step === 5 && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold">Resumen antes de firmar</h3>
                <div className="space-y-2">
                  <SummaryRow
                    label="Datos cliente"
                    ok={readiness.checks.has_tax_id && readiness.checks.tax_id_valid_format}
                    value={
                      readiness.customer.tax_id
                        ? `${
                            readiness.customer.party_kind === "company" && !readiness.customer.is_autonomo
                              ? "CIF"
                              : "DNI"
                          } ${readiness.customer.tax_id}`
                        : "Falta"
                    }
                  />
                  <SummaryRow
                    label="Dirección"
                    ok={readiness.checks.has_address}
                    value={
                      readiness.primary_address?.street
                        ? `${readiness.primary_address.street}${readiness.primary_address.street_number ? ` ${readiness.primary_address.street_number}` : ""}, ${readiness.primary_address.city ?? ""}`
                        : "Falta"
                    }
                  />
                  <SummaryRow
                    label="IBAN"
                    ok={readiness.checks.has_iban || !ibanRequired}
                    warning={
                      readiness.checks.has_iban && !readiness.checks.iban_validated
                    }
                    value={
                      readiness.primary_bank
                        ? readiness.primary_bank.is_validated
                          ? readiness.primary_bank.iban
                          : "ES00 (pendiente)"
                        : ibanRequired
                          ? "Falta"
                          : "No aplica (al contado)"
                    }
                  />
                  <SummaryRow
                    label="Foto DNI"
                    ok={readiness.checks.has_id_photo}
                    warning={!readiness.checks.has_id_photo}
                    value={readiness.checks.has_id_photo ? "Subida" : "No subida"}
                  />
                </div>

                {readiness.blockers.length > 0 && (
                  <div className="rounded-xl border-2 border-destructive bg-destructive/5 p-3">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-destructive">
                      <AlertTriangle className="h-4 w-4" /> No puedes firmar
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {readiness.blockers.map((b) => {
                        const targetStep: Step | null = /dni|cif/i.test(b)
                          ? 1
                          : /direcci[oó]n/i.test(b)
                            ? 2
                            : /iban/i.test(b)
                              ? 3
                              : null;
                        return (
                          <li
                            key={b}
                            className="flex items-center justify-between gap-2 text-xs text-destructive"
                          >
                            <span>• {b}</span>
                            {targetStep && (
                              <button
                                type="button"
                                onClick={() => setStep(targetStep)}
                                className="shrink-0 rounded-md border border-destructive bg-white px-2 py-1 text-[10px] font-bold text-destructive hover:bg-destructive/10"
                              >
                                Editar
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {/* RGPD — bloque obligatorio antes de firmar */}
                <div className="space-y-2 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold">
                    🛡 Consentimientos RGPD del cliente
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    El cliente debe aceptar/rechazar antes de firmar. Quedan
                    registrados con fecha + origen contrato.
                  </p>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={consentDataProcessing}
                      onChange={(e) => setConsentDataProcessing(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>
                      <strong>Tratamiento de datos (obligatorio)</strong> —
                      Necesario para el contrato. Sin esto no se puede firmar.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={consentCommercial}
                      onChange={(e) => setConsentCommercial(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>
                      <strong>Comunicaciones comerciales (opcional)</strong> —
                      Permite enviar emails / WhatsApp con ofertas, novedades y
                      promociones.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={consentProfiling}
                      onChange={(e) => setConsentProfiling(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span>
                      <strong>Perfilado para marketing (opcional)</strong> —
                      Permite usar datos para segmentar campañas (productos
                      relevantes, ofertas).
                    </span>
                  </label>
                </div>

                {readiness.warnings.length > 0 && (
                  <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                      <AlertTriangle className="h-4 w-4" /> Recomendado
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {readiness.warnings.map((w) => {
                        // Mapear cada warning a su paso correspondiente
                        const targetStep: Step | null = /email/i.test(w)
                          ? 1
                          : /tel[eé]fono/i.test(w)
                            ? 1
                            : /iban/i.test(w)
                              ? 3
                              : /foto/i.test(w)
                                ? 4
                                : null;
                        return (
                          <li
                            key={w}
                            className="flex items-center justify-between gap-2 text-xs text-amber-900"
                          >
                            <span>• {w}</span>
                            {targetStep && (
                              <button
                                type="button"
                                onClick={() => setStep(targetStep)}
                                className="shrink-0 rounded-md border border-amber-400 bg-white px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
                              >
                                Editar
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-xs text-amber-800">
                      Puedes firmar igualmente sin completarlo.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer nav */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-muted/20 p-3">
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : goBack}
            disabled={pending}
          >
            {step === 1 ? (
              "Cancelar"
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" /> Atrás
              </>
            )}
          </Button>
          {step < 5 ? (
            <Button onClick={goNext}>
              Siguiente <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={sign}
              disabled={pending || !readiness || readiness.blockers.length > 0}
              variant="success"
            >
              <PenLine className="h-4 w-4" />
              {pending ? "Firmando…" : "Firmar"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionStatus({
  ok,
  warning = false,
  okLabel,
  failLabel,
}: {
  ok: boolean;
  warning?: boolean;
  okLabel: string;
  failLabel: string;
}) {
  if (ok && !warning) {
    return (
      <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        {okLabel}
      </div>
    );
  }
  if (warning) {
    return (
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        ⚠ {okLabel}
      </div>
    );
  }
  return (
    <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
      {failLabel}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  ok,
  warning = false,
}: {
  label: string;
  value: string;
  ok: boolean;
  warning?: boolean;
}) {
  const tone =
    ok && !warning
      ? "border-emerald-300 bg-emerald-50"
      : warning
        ? "border-amber-300 bg-amber-50"
        : "border-rose-300 bg-rose-50";
  const Icon = ok && !warning ? Check : warning ? AlertTriangle : X;
  const color =
    ok && !warning ? "text-emerald-700" : warning ? "text-amber-700" : "text-rose-700";
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg border-2 p-2 ${tone}`}>
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="flex items-center gap-1.5 truncate text-sm">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

// === Subcomponentes ===

function CheckRow({
  icon,
  label,
  ok,
  warning = false,
  status,
  critical,
  onEdit,
  expanded,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  warning?: boolean;
  status: string;
  critical: boolean;
  onEdit: () => void;
  expanded: boolean;
  children?: React.ReactNode;
}) {
  const tone = ok && !warning
    ? "border-emerald-300 bg-emerald-50/40"
    : warning
      ? "border-amber-300 bg-amber-50"
      : critical
        ? "border-destructive bg-destructive/5"
        : "border-border bg-card";

  const Icon = ok && !warning ? Check : X;
  const iconColor = ok && !warning ? "text-emerald-600" : warning ? "text-amber-600" : "text-destructive";

  return (
    <div className={`rounded-xl border-2 p-3 ${tone}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-card">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold">{label}</span>
            <Icon className={`h-4 w-4 ${iconColor}`} />
            {!ok && critical && (
              <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[9px] font-bold uppercase text-destructive-foreground">
                Falta
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">{status}</div>
        </div>
        <Button
          size="sm"
          variant={ok ? "ghost" : "outline"}
          onClick={onEdit}
        >
          <Pencil className="h-3 w-3" />
          {ok ? "Editar" : "Completar"}
        </Button>
      </div>
      {expanded && children && <div className="mt-3 border-t pt-3">{children}</div>}
    </div>
  );
}

function MiniCheck({
  icon,
  label,
  ok,
  value,
  onEdit,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  value: string;
  /** Si está definido y no está OK, muestra botón "Editar" que llama
   *  esta callback (típicamente: scroll al form o cambiar de paso). */
  onEdit?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-2 text-xs ${
        ok ? "border-border bg-card" : "border-amber-200 bg-amber-50"
      }`}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{label}</div>
        <div className="truncate text-muted-foreground">{value}</div>
      </div>
      {ok ? (
        <Check className="h-3 w-3 text-emerald-600" />
      ) : (
        <>
          <AlertTriangle className="h-3 w-3 text-amber-600" />
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md border border-amber-400 bg-white px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
            >
              Editar
            </button>
          )}
        </>
      )}
    </div>
  );
}

function CustomerEditForm({
  customer,
  onSaved,
}: {
  customer: PreSignReadiness["customer"];
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    legal_name: customer.legal_name ?? "",
    trade_name: customer.trade_name ?? "",
    first_name: customer.first_name ?? "",
    last_name: customer.last_name ?? "",
    email: customer.email ?? "",
    phone_primary: customer.phone_primary ?? "",
    tax_id: customer.tax_id ?? "",
  });

  // Dedupe en vivo: avisamos si tax_id/email/phone que el comercial está
  // escribiendo ya pertenece a OTRO cliente/lead. Excluimos al cliente
  // actual para no dispararse contra sí mismo.
  const dedupeMatches = useDedupe({
    tax_id: form.tax_id,
    email: form.email,
    phone: form.phone_primary,
    exclude: { entity: "customer", id: customer.id },
  });

  // Validación cliente ANTES de mandar al server. Bloquea el guardado
  // si el DNI/CIF tiene formato/letra inválido, o si el teléfono no es
  // Devuelve avisos NO bloqueantes (toast informativo) y errores que SÍ
  // deben bloquear el guardado. Por regla de negocio, el CIF/DNI con
  // formato no estándar SOLO avisa (hay muchas variantes legales). Sólo
  // se bloquea por DNI con letra de control incorrecta (claramente mal
  // escrito) y email inválido.
  function validateLocal(): { block: string | null; warn: string | null } {
    const t = form.tax_id?.trim().toUpperCase() ?? "";
    let warn: string | null = null;
    if (t) {
      const acceptsDniOrNie =
        customer.party_kind === "individual" || customer.is_autonomo === true;
      if (!acceptsDniOrNie) {
        if (!validateCIF(t))
          warn = "CIF con formato no estándar — verifica que sea correcto.";
      } else {
        const r = validateDNIorNIE(t);
        if (!r.valid && r.expectedLetter) {
          // Letra de control mal: bloquea (es claramente un error de tipeo)
          return {
            block: `Letra del DNI/NIE incorrecta. Debería ser: ${r.expectedLetter}`,
            warn: null,
          };
        }
        if (!r.valid) {
          warn = "DNI/NIE con formato no estándar — verifica.";
        }
      }
    }
    if (form.phone_primary?.trim() && !validateSpanishPhone(form.phone_primary)) {
      warn = (warn ? warn + " · " : "") + "Teléfono con formato no estándar.";
    }
    if (
      form.email?.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    ) {
      return { block: "Email con formato inválido", warn: null };
    }
    return { block: null, warn };
  }

  function save() {
    const r = validateLocal();
    if (r.block) {
      notify.warning("Revisa los datos", r.block);
      return;
    }
    if (r.warn) {
      notify.warning("Aviso", r.warn);
      // No bloquea — continúa al guardado.
    }
    startTransition(async () => {
      const r = await updateCustomerSafeAction(customer.id, form);
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Datos del cliente guardados");
      onSaved();
    });
  }

  // Autónomo se trata como persona física: nombre+apellidos+DNI (no
  // razón social, no CIF).
  const isAutonomo = customer.party_kind === "company" && customer.is_autonomo === true;
  return (
    <div className="space-y-3">
      {customer.party_kind === "company" && !isAutonomo ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Razón social</Label>
            <Input
              value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nombre comercial</Label>
            <Input
              value={form.trade_name}
              onChange={(e) => setForm({ ...form, trade_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">CIF</Label>
            <TaxIdInput
              kind="cif"
              value={form.tax_id}
              onChange={(v) => setForm({ ...form, tax_id: v })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Persona contacto
            </Label>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nombre</Label>
            <Input
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Apellidos</Label>
            <Input
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Nombre</Label>
            <Input
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Apellidos</Label>
            <Input
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">DNI / NIE</Label>
            <TaxIdInput
              kind="dni"
              value={form.tax_id}
              onChange={(v) => setForm({ ...form, tax_id: v })}
            />
          </div>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Email</Label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Teléfono</Label>
          <PhoneInput
            value={form.phone_primary}
            onChange={(v) => setForm({ ...form, phone_primary: v })}
          />
        </div>
      </div>
      {dedupeMatches.length > 0 && <DedupeWarning matches={dedupeMatches} />}
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar datos"}
        </Button>
      </div>
    </div>
  );
}

function AddressEditForm({
  customerId,
  initial,
  onSaved,
}: {
  customerId: string;
  initial: PreSignReadiness["primary_address"];
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    street_type: initial?.street_type ?? "calle",
    street: initial?.street ?? "",
    street_number: initial?.street_number ?? "",
    portal: initial?.portal ?? "",
    floor: initial?.floor ?? "",
    door: initial?.door ?? "",
    postal_code: initial?.postal_code ?? "",
    city: initial?.city ?? "",
    province: initial?.province ?? "",
  });

  function save() {
    if (!form.street || !form.postal_code || !form.city) {
      notify.warning("Calle, CP y ciudad son obligatorios");
      return;
    }
    startTransition(async () => {
      const r = await upsertAddressSafeAction({
        id: initial?.id,
        customer_id: customerId,
        kind: "home",
        is_primary: true,
        street_type: form.street_type as "calle",
        street: form.street,
        street_number: form.street_number || null,
        portal: form.portal || null,
        floor: form.floor || null,
        door: form.door || null,
        postal_code: form.postal_code,
        city: form.city,
        province: form.province,
        latitude: null,
        longitude: null,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar", r.error);
        return;
      }
      notify.success("Dirección guardada");
      onSaved();
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
        <div className="space-y-1">
          <Label className="text-xs">Calle *</Label>
          <Input
            value={form.street}
            onChange={(e) => setForm({ ...form, street: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Número</Label>
          <Input
            value={form.street_number}
            onChange={(e) => setForm({ ...form, street_number: e.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Portal</Label>
          <Input
            value={form.portal}
            onChange={(e) => setForm({ ...form, portal: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Piso</Label>
          <Input
            value={form.floor}
            onChange={(e) => setForm({ ...form, floor: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Puerta</Label>
          <Input
            value={form.door}
            onChange={(e) => setForm({ ...form, door: e.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">CP *</Label>
          <Input
            inputMode="numeric"
            maxLength={5}
            value={form.postal_code}
            onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Ciudad *</Label>
          <Input
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Provincia</Label>
          <Input
            value={form.province}
            onChange={(e) => setForm({ ...form, province: e.target.value })}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar dirección"}
        </Button>
      </div>
    </div>
  );
}

function IbanAddForm({
  customerId,
  defaultHolder,
  onSaved,
}: {
  customerId: string;
  defaultHolder: string;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState(defaultHolder);
  const [bank, setBank] = useState("");

  function save() {
    const check = checkIbanLive(iban);
    if (check.state !== "valid" && check.state !== "pending") {
      notify.warning("IBAN no válido — corrige el dígito de control o usa ES00 como pendiente");
      return;
    }
    startTransition(async () => {
      const r = await createBankAccountSafeAction({
        customer_id: customerId,
        iban,
        account_holder_name: holder,
        bank_name: bank,
        is_primary: true,
      });
      if (!r.ok) {
        notify.error("No se pudo guardar el IBAN", r.error);
        return;
      }
      notify.success(
        isPendingIban(iban) ? "IBAN pendiente guardado" : "IBAN añadido",
      );
      onSaved();
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">IBAN *</Label>
        <IbanInput value={iban} onChange={setIban} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Titular</Label>
          <Input value={holder} onChange={(e) => setHolder(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Banco (opcional)</Label>
          <Input value={bank} onChange={(e) => setBank(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar IBAN"}
        </Button>
      </div>
    </div>
  );
}

function PhotoUploadInline({
  contractId,
  onUploaded,
}: {
  contractId: string;
  onUploaded: () => void;
}) {
  const [pending, startTransition] = useTransition();
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    fd.append("contract_id", contractId);
    fd.append("kind", "id_card");
    startTransition(async () => {
      const r = await uploadContractPhotoAction(fd);
      if (!r.ok) {
        notify.error("No se pudo subir", r.error);
        return;
      }
      notify.success("Foto subida");
      onUploaded();
    });
    e.target.value = "";
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Sube foto del DNI/NIE del cliente (cara y dorso). Es recomendado pero
        no obligatorio para firmar.
      </p>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        disabled={pending}
        className="block w-full text-xs file:mr-2 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-xs file:font-bold hover:file:bg-muted"
      />
    </div>
  );
}
