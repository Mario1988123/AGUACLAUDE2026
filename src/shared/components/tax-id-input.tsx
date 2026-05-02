"use client";

import { CheckCircle2, AlertCircle } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { validateDNI, validateNIE, validateCIF } from "@/shared/lib/validations/spanish";

interface Props {
  id?: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  /** "dni" admite DNI o NIE; "cif" admite CIF; "any" admite los tres */
  kind?: "dni" | "cif" | "any";
  required?: boolean;
  placeholder?: string;
}

export function TaxIdInput({
  id,
  name,
  value,
  onChange,
  kind = "any",
  required,
  placeholder,
}: Props) {
  const v = value.trim().toUpperCase();
  let status: "empty" | "incomplete" | "valid" | "invalid" = "empty";
  let hint: string | null = null;

  if (!v) {
    status = "empty";
  } else if (kind === "cif") {
    if (!/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) status = "incomplete";
    else status = validateCIF(v) ? "valid" : "invalid";
    if (status === "invalid") hint = "CIF no válido (dígito de control incorrecto)";
  } else {
    // DNI/NIE
    const isNie = /^[XYZ]/.test(v);
    const re = isNie ? /^[XYZ]\d{7}[A-Z]$/ : /^\d{8}[A-Z]$/;
    if (!re.test(v)) {
      status = "incomplete";
    } else {
      const result = isNie ? validateNIE(v) : validateDNI(v);
      status = result.valid ? "valid" : "invalid";
      if (!result.valid && result.expectedLetter) {
        hint = `Letra incorrecta. Debería ser: ${result.expectedLetter}`;
      }
    }
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          required={required}
          placeholder={placeholder}
          className={
            status === "invalid"
              ? "border-destructive pr-10"
              : status === "valid"
                ? "border-success pr-10"
                : ""
          }
          autoComplete="off"
        />
        {status === "valid" && (
          <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />
        )}
        {status === "invalid" && (
          <AlertCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-destructive" />
        )}
      </div>
      {hint && status === "invalid" && (
        <p className="text-xs font-semibold text-destructive">{hint}</p>
      )}
    </div>
  );
}
