"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  assignFinancierToContractAction,
  clearFinancierFromContractAction,
} from "./financier-assign-actions";

function eur(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

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

  // Cálculos económicos derivados (transparencia para el admin):
  //   total_cuotas = lo que cobra la empresa al cliente durante todo el plazo
  //   margen_empresa = capital cobrado de la financiera - reserva - residual
  //   intereses_financiera = total_cuotas - capital (lo que la financiera "gana")
  const totalCuotasClienteCents =
    monthlyCents != null && termMonths ? monthlyCents * termMonths : 0;
  const margenEmpresaCents = paymentCents - reserveCents - residualCents;
  const interesesFinancieraCents = totalCuotasClienteCents - paymentCents;

  // Detección de coeficiente sospechoso. En renting real, capital sugerido
  // suele ser entre 60% y 120% del total de cuotas que cobrará el cliente.
  // Si se sale mucho de ese rango, el coeficiente probablemente está mal
  // configurado para ese plazo.
  const coefRatio =
    totalCuotasClienteCents > 0 && suggestedPaymentCents > 0
      ? suggestedPaymentCents / totalCuotasClienteCents
      : null;
  const coefSospechoso = coefRatio != null && (coefRatio > 1.3 || coefRatio < 0.5);

  // Aviso si el capital introducido por admin difiere mucho del sugerido
  // (>50% de desviación). Útil cuando admin se equivoca al teclear.
  const desviacionVsSugerido =
    paymentCents > 0 && suggestedPaymentCents > 0
      ? Math.abs(paymentCents - suggestedPaymentCents) / suggestedPaymentCents
      : 0;
  const capitalDispar = desviacionVsSugerido > 0.5;

  // Solo el renting usa financiera. Alquiler se cobra directamente al
  // cliente vía remesa SEPA; contado se cobra al firmar.
  if (planType !== "renting") {
    return (
      <p className="text-sm text-muted-foreground">
        {planType === "rental"
          ? "Alquiler: el cobro se hace directamente al cliente (remesa SEPA o transferencia). No requiere financiera."
          : "Contrato al contado: no requiere financiera."}
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
      const r = await assignFinancierToContractAction({
        contract_id: contractId,
        financier_id: financierId,
        financier_payment_cents: paymentCents,
        financier_term_months: termMonths,
        financier_coefficient: coefForTerm,
        financier_residual_cents: residualCents > 0 ? residualCents : null,
        financier_reserve_cents: reserveCents > 0 ? reserveCents : null,
      });
      if (!r.ok) {
        notify.error("No se pudo asignar", r.error);
        return;
      }
      notify.success("Financiera asignada al contrato");
    });
  }

  function clear() {
    startTransition(async () => {
      const r = await clearFinancierFromContractAction(contractId);
      if (!r.ok) {
        notify.error("No se pudo retirar", r.error);
        return;
      }
      setFinancierId("");
      setPaymentEuros("");
      notify.success("Financiera retirada del contrato");
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

      {/* Resumen contrato (read-only) — para que admin vea con qué juega */}
      {monthlyCents != null && termMonths && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 text-xs">
          <div className="font-bold text-blue-900">Datos del contrato</div>
          <div className="mt-1 grid gap-1 sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Cuota cliente/mes:</span>{" "}
              <strong className="tabular-nums">{eur(monthlyCents)}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Plazo:</span>{" "}
              <strong>{termMonths} meses</strong>
            </div>
            <div>
              <span className="text-muted-foreground">
                Total cuotas cliente:
              </span>{" "}
              <strong className="tabular-nums">
                {eur(totalCuotasClienteCents)}
              </strong>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="space-y-3 rounded-xl border-2 border-purple-200 bg-purple-50/40 p-3">
          {coefForTerm == null ? (
            <div className="rounded border border-dashed border-amber-400 bg-amber-50 p-2 text-xs text-amber-900">
              ⚠️ {selected.name} no tiene coeficiente configurado a{" "}
              <strong>{termMonths ?? "?"} meses</strong>. Edita la financiera
              en /configuracion/financieras o usa otro plazo.
            </div>
          ) : (
            <>
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
                    Aplicar sugerido ({eur(suggestedPaymentCents)})
                  </button>
                )}
              </div>
              {coefSospechoso && (
                <div className="flex items-start gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <strong>El coeficiente parece inconsistente para {termMonths} meses.</strong>
                    {coefRatio != null && coefRatio > 1.3 && (
                      <> El capital sugerido ({eur(suggestedPaymentCents)})
                      supera el total de cuotas del cliente ({eur(totalCuotasClienteCents)}) — la financiera te
                      pagaría más de lo que cobrarás al cliente, lo cual es
                      poco habitual.</>
                    )}
                    {coefRatio != null && coefRatio < 0.5 && (
                      <> El capital sugerido ({eur(suggestedPaymentCents)})
                      es muy inferior al total de cuotas del cliente ({eur(totalCuotasClienteCents)}) — implicaría
                      una comisión negativa enorme.</>
                    )}{" "}
                    Revisa el coeficiente en{" "}
                    <a
                      href="/configuracion/financieras"
                      className="font-bold underline"
                    >
                      /configuracion/financieras
                    </a>
                    .
                  </div>
                </div>
              )}
            </>
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
                Importe que la financiera ingresa a la empresa tras aceptar
                la operación. Sugerido = cuota cliente / coeficiente.
              </p>
              {capitalDispar && (
                <div className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-900">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    El valor introducido difiere{" "}
                    {Math.round(desviacionVsSugerido * 100)}% del sugerido
                    ({eur(suggestedPaymentCents)}). Verifica que es correcto.
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-1 rounded-lg bg-white/70 p-2 text-xs">
              <div className="font-bold text-purple-900">
                Desglose económico
              </div>
              {selected.kind === "renting_strict" &&
                selected.residual_pct != null && (
                  <Row
                    label={`Residual (${selected.residual_pct}%)`}
                    value={eur(residualCents)}
                    muted
                  />
                )}
              {selected.reserve_pct != null && selected.reserve_pct > 0 && (
                <Row
                  label={`Reserva (${selected.reserve_pct}%)`}
                  value={eur(reserveCents)}
                  muted
                />
              )}
              {paymentCents > 0 && (
                <>
                  <Row
                    label="Margen neto empresa"
                    value={eur(margenEmpresaCents)}
                    strong
                    color={margenEmpresaCents >= 0 ? "emerald" : "red"}
                  />
                  {totalCuotasClienteCents > 0 && (
                    <Row
                      label="Intereses financiera"
                      value={eur(interesesFinancieraCents)}
                      muted
                      title={`Diferencia entre lo que cobra al cliente (${eur(totalCuotasClienteCents)}) y lo que paga a la empresa (${eur(paymentCents)})`}
                    />
                  )}
                </>
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

function Row({
  label,
  value,
  muted = false,
  strong = false,
  color,
  title,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  color?: "emerald" | "red";
  title?: string;
}) {
  const colorCls =
    color === "emerald"
      ? "text-emerald-700"
      : color === "red"
        ? "text-red-700"
        : "";
  return (
    <div className="flex items-baseline justify-between gap-2" title={title}>
      <span className={muted ? "text-muted-foreground" : "text-foreground"}>
        {label}
      </span>
      <span
        className={`tabular-nums ${strong ? "font-bold" : ""} ${colorCls}`}
      >
        {value}
      </span>
    </div>
  );
}
