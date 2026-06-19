"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Input } from "@/shared/ui/input";
import {
  EUROPE_PHONE_PREFIXES,
  DEFAULT_PHONE_PREFIX,
  parsePhoneValue,
  combinePhoneValue,
} from "@/shared/lib/phone/prefixes";

interface Props {
  id?: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  /** Compat: se acepta pero ya no se pinta icono (el prefijo ocupa su sitio). */
  hideLeadingIcon?: boolean;
}

/**
 * Input de teléfono con selector de prefijo europeo (por defecto +34 España)
 * y validación en tiempo real según el país elegido.
 *
 * El valor que sube por onChange es el combinado "+34 612345678" (prefijo +
 * número), que es lo que se guarda en BD. Parsea valores legados sin prefijo.
 *
 * Estados visuales:
 *  · empty       → neutral
 *  · incomplete  → neutral mientras escribe
 *  · valid       → borde verde + check
 *  · invalid     → borde rojo + alert + hint
 */
export function PhoneInput({
  id,
  name,
  value,
  onChange,
  required,
  placeholder,
}: Props) {
  const parsed = parsePhoneValue(value);
  const national = parsed.national;

  // El prefijo vive en estado para que NO se reinicie a +34 cuando el número
  // está vacío (el usuario elige país y luego teclea). Se re-sincroniza desde
  // el valor cuando éste trae un número (ej. al cargar un cliente para editar).
  const [prefix, setPrefix] = useState(parsed.code || DEFAULT_PHONE_PREFIX);
  useEffect(() => {
    if (value && value.trim()) setPrefix(parsePhoneValue(value).code);
  }, [value]);

  const digits = national.replace(/\D/g, "");
  let status: "empty" | "incomplete" | "valid" | "invalid" = "empty";
  let hint: string | null = null;

  if (!national.trim()) {
    status = "empty";
  } else if (prefix === DEFAULT_PHONE_PREFIX) {
    if (digits.length < 9) status = "incomplete";
    else if (digits.length > 9) {
      status = "invalid";
      hint = "Demasiados dígitos (9 en España)";
    } else if (!/^[6789]/.test(digits)) {
      status = "invalid";
      hint = "En España empieza por 6, 7, 8 o 9";
    } else {
      status = "valid";
    }
  } else {
    // Resto de Europa: validación laxa (6–14 dígitos).
    if (digits.length < 6) status = "incomplete";
    else if (digits.length > 14) {
      status = "invalid";
      hint = "Demasiados dígitos";
    } else {
      status = "valid";
    }
  }

  function handlePrefixChange(newCode: string) {
    setPrefix(newCode);
    onChange(combinePhoneValue(newCode, national));
  }
  function handleNationalChange(newNational: string) {
    onChange(combinePhoneValue(prefix, newNational));
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <select
          value={prefix}
          onChange={(e) => handlePrefixChange(e.target.value)}
          aria-label="Prefijo de país"
          className="h-12 w-[108px] shrink-0 rounded-xl border border-border bg-card px-2 text-sm"
        >
          {EUROPE_PHONE_PREFIXES.map((p) => (
            <option key={p.code + p.iso} value={p.code}>
              {p.flag} {p.code}
            </option>
          ))}
        </select>
        <div className="relative flex-1">
          <Input
            id={id}
            name={name}
            type="tel"
            value={national}
            onChange={(e) => handleNationalChange(e.target.value)}
            required={required}
            placeholder={placeholder ?? "612 345 678"}
            inputMode="tel"
            autoComplete="tel"
            className={
              status === "invalid"
                ? "border-destructive pr-10"
                : status === "valid"
                  ? "border-success pr-10"
                  : ""
            }
          />
          {status === "valid" && (
            <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-success" />
          )}
          {status === "invalid" && (
            <AlertCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-destructive" />
          )}
        </div>
      </div>
      {hint && status === "invalid" && (
        <p className="text-xs font-semibold text-destructive">{hint}</p>
      )}
    </div>
  );
}
