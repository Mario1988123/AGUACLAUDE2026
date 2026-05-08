"use client";

import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { checkIbanLive } from "@/shared/lib/validations/iban-partial";

export function IbanInput({
  id,
  name,
  value,
  onChange,
  required,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const v = value.trim().toUpperCase();
  const check = v ? checkIbanLive(v) : { state: "incomplete" as const };

  let hint: string | null = null;
  let hintTone: "error" | "warning" | null = null;
  if (check.state === "invalid_dc") {
    hint = `Dígito de control incorrecto. Debería ser: ES${check.expected}…`;
    hintTone = "error";
  } else if (check.state === "invalid") {
    hint = "Formato IBAN no válido";
    hintTone = "error";
  } else if (check.state === "pending") {
    hint = "IBAN pendiente";
    hintTone = "warning";
  }

  const isValid = check.state === "valid";
  const isPending = check.state === "pending";
  const isInvalid = check.state === "invalid_dc" || check.state === "invalid";

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(/\s/g, ""))}
          required={required}
          placeholder="ES00 0000 0000 0000 0000 0000"
          maxLength={29}
          className={
            isInvalid
              ? "border-destructive pr-10"
              : isValid
                ? "border-success pr-10"
                : isPending
                  ? "border-amber-500 pr-10"
                  : ""
          }
          autoComplete="off"
          spellCheck={false}
        />
        {isValid && (
          <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />
        )}
        {isPending && (
          <Clock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-600" />
        )}
        {isInvalid && (
          <AlertCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-destructive" />
        )}
      </div>
      {hint && (
        <p
          className={`text-xs font-semibold ${
            hintTone === "warning" ? "text-amber-700" : "text-destructive"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
