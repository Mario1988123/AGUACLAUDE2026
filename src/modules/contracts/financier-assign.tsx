"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  assignFinancierToContractAction,
  clearFinancierFromContractAction,
} from "./financier-assign-actions";

export interface FinancierForAssign {
  id: string;
  name: string;
  short_name: string | null;
  kind: "renting_strict" | "financing";
  residual_pct: number | null;
  reserve_pct: number | null;
  accepts_individual: boolean;
  accepts_autonomo: boolean;
  accepts_company: boolean;
  coefficients: Array<{ term_months: number; coefficient: number }>;
}

interface Props {
  contractId: string;
  /** Plan del contrato — solo aplica si renting o financing. */
  planType: "cash" | "rental" | "renting";
  /** Duración del contrato (meses). Sirve para buscar coeficiente. */
  durationMonths: number | null;
  /** Cuota mensual cliente del contrato (céntimos). Sirve para sugerir
   *  capital empresa por defecto (cuota/coef). */
  monthlyCents: number | null;
  /** Cliente — para filtrar financieras compatibles. */
  partyKind: "individual" | "company" | null;
  isAutonomo: boolean;
  /** Datos actuales de financiera (si ya asignada). */
  currentFinancierId: string | null;
  currentFinancierPaymentCents: number | null;
  currentFinancierTermMonths: number | null;
  /** Financieras disponibles. */
  financiers: FinancierForAssign[];
}

export function ContractFinancierAssign({
  contractId,
  planType,
  durationMonths,
  monthlyCents,
  partyKind,
  isAutonomo,
  currentFinancierId,
  currentFinancierPaymentCents,
  currentFinancierTermMonths,
  financiers,
}: Props) {
  const [financierId, setFinancierId] = useState<string>(currentFinancierId ?? "");
  const [termMonths, setTermMonths] = useState<number | null>(
    currentFinancierTermMonths ?? durationMonths ?? null,
  );
  const [paymentEuros, setPaymentEuros] = useState<string>(
    currentFinancierPaymentCents != null
      ? (currentFinancierPaymentCents / 100).toFixed(2)
      : "",
  );
  const [pending, startTransition] = useTransition();

  // Financieras que aceptan este tipo de cliente
  const availableFinanciers = useMemo(() => {
    return financiers.filter((f) => {
      if (partyKind === "individual") return f.accepts_individual;
      if (isAutonomo) return f.accepts_autonomo;
      if (partyKind === "company") return f.accepts_company;
      return true;
    });
  }, [financiers, partyKind, isAutonomo]);

  const selected = useMemo(
    () => availableFinanciers.find((f) => f.id === financierId) ?? null,
    [availableFinanciers, financierId],
  );

  const coefForTerm = useMemo(() => {
    if (!selected || !termMonths) return null;
    return (
      selected.coefficients.find((c) => c.term_months === termMonths)
        ?.coefficient ?? null
    );
  }, [selected, termMonths]);

  // Sugerencia capital empresa = cuota_mensual_cliente / coeficiente.
  // El admin puede editarlo a mano cuando la financiera ajusta por scoring.
  const suggestedPaymentCents = useMemo(() => {
    if (!coefForTerm || coefForTerm <= 0 || !monthlyCents) return 0;
    return Math.round(monthlyCents / coefForTerm);
  }, [coefForTerm, monthlyCents]);

  const paymentCents = paymentEuros
    ? Math.round(Number(paymentEuros) * 100)
    : 0;

  const residualCents =
    selected?.kind === "renting_strict" && selected.residual_pct
      ? Math.round(paymentCents * (selected.residual_pct / 100))
      : 0;
  const reserveCents = selected?.reserve_pct
    ? Math.round(paymentCents * (selected.reserve_pct / 100))
    : 0;

  if (planType !== "renting" && planType !== "rental") {
    return (
      <p className="text-sm text-muted-foreground">
        El contrato no es de tipo renting/financiación. No requiere asignar
        financiera.
      </p>
    );
  }

  function applySuggestion() {
    if (suggestedPaymentCents > 0) {
      setPaymentEuros((suggestedPaymentCents / 100).toFixed(2));
    }
  }

  function submit() {
    if (!financierId) {
      notify.warning("Selecciona financiera");
      return;
    }
    if (!termMonths) {
      notify.warning("Plazo obligatorio");
      return;
    }
    if (!paymentCents || paymentCents <= 0) {
      notify.warning("Capital que percibe la empresa obligatorio");
      return;
    }
    if (!coefForTerm) {
      notify.warning(
        "Esta financiera no tiene coeficiente para ese plazo. Configúralo en /configuracion/financieras.",
      );
      return;
    }
    startTransition(async () => {
      try {
        await assignFinancierToContractAction({
          contract_id: contractId,
          financier_id: financierId,
          financier_payment_cents: paymentCents,
          financier_term_months: termMonths,
          financier_coefficient: coefForTerm,
          financier_residual_cents: residualCents > 0 ? residualCents : null,
          financier_reserve_cents: reserveCents > 0 ? reserveCents : null,
        });
        notify.success("Financiera asignada al contrato");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function clear() {
    startTransition(async () => {
      try {
        await clearFinancierFromContractAction(contractId);
        setFinancierId("");
        setPaymentEuros("");
        notify.success("Financiera retirada del contrato");
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (financiers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-purple-300 bg-purple-50/40 p-3 text-xs text-purple-900">
        No hay financieras dadas de alta. Ve a{" "}
        <a href="/configuracion/financieras" className="font-bold underline">
          /configuracion/financieras
        </a>{" "}
        y crea al menos una.
      </div>
    );
  }

  if (availableFinanciers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
        Ninguna financiera registrada acepta este tipo de cliente
        {partyKind === "individual"
          ? " (particular)"
          : isAutonomo
            ? " (autónomo)"
            : partyKind === "company"
              ? " (empresa)"
              : ""}
        . Revisa los checks &laquo;Acepta cliente&raquo; en{" "}
        <a href="/configuracion/financieras" className="font-bold underline">
          /configuracion/financieras
        </a>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        El comercial deja el contrato firmado con la cuota fija que pacta
        con el cliente. Admin envía la solicitud a varias financieras y
        cuando una acepta, marca aquí cuál fue, con qué importe y a qué
        plazo, para fijar comisión y reserva.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Financiera</Label>
          <select
            value={financierId}
            onChange={(e) => setFinancierId(e.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"
          >
            <option value="">— elige una —</option>
            {availableFinanciers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.kind === "renting_strict" ? "renting" : "financiación"})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Plazo (meses)</Label>
          <Input
            type="number"
            min={1}
            value={termMonths ?? ""}
            onChange={(e) => setTermMonths(Number(e.target.value) || null)}
          />
        </div>
      </div>

      {selected && (
        <div className="space-y-3 rounded-xl border-2 border-purple-200 bg-purple-50/40 p-3">
          {coefForTerm == null ? (
            <div className="rounded border border-dashed border-amber-400 bg-amber-50 p-2 text-xs text-amber-900">
              ⚠️ {selected.name} no tiene coeficiente configurado a{" "}
              <strong>{termMonths ?? "?"} meses</strong>. Edita la financiera
              en /configuracion/financieras o usa otro plazo.
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Coeficiente {termMonths}m:{" "}
                <span className="font-mono font-bold text-foreground">
                  {coefForTerm}
                </span>
              </span>
              {monthlyCents != null && suggestedPaymentCents > 0 && (
                <button
                  type="button"
                  className="rounded-md border border-purple-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-purple-900 hover:bg-purple-50"
                  onClick={applySuggestion}
                >
                  Aplicar sugerido (
                  {(suggestedPaymentCents / 100).toFixed(2)} €)
                </button>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Capital que percibe la empresa (€)
              </Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={paymentEuros}
                onChange={(e) => setPaymentEuros(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Importe que confirma la financiera tras scoring. Sugerido =
                cuota cliente / coeficiente.
              </p>
            </div>
            <div className="space-y-1 rounded-lg bg-white/70 p-2 text-xs">
              {monthlyCents != null && (
                <div>
                  <span className="text-muted-foreground">
                    Cuota cliente/mes:
                  </span>{" "}
                  <strong className="tabular-nums">
                    {(monthlyCents / 100).toFixed(2)} €
                  </strong>
                </div>
              )}
              {selected.kind === "renting_strict" &&
                selected.residual_pct != null && (
                  <div>
                    <span className="text-muted-foreground">
                      Residual ({selected.residual_pct}%):
                    </span>{" "}
                    <strong className="tabular-nums">
                      {(residualCents / 100).toFixed(2)} €
                    </strong>
                  </div>
                )}
              {selected.reserve_pct != null && selected.reserve_pct > 0 && (
                <div>
                  <span className="text-muted-foreground">
                    Reserva ({selected.reserve_pct}%):
                  </span>{" "}
                  <strong className="tabular-nums">
                    {(reserveCents / 100).toFixed(2)} €
                  </strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {currentFinancierId && (
          <Button
            variant="outline"
            size="sm"
            onClick={clear}
            disabled={pending}
          >
            Retirar financiera
          </Button>
        )}
        <Button onClick={submit} disabled={pending} variant="success" size="sm">
          {pending
            ? "Guardando…"
            : currentFinancierId
              ? "Actualizar financiera"
              : "Asignar financiera"}
        </Button>
      </div>
    </div>
  );
}
