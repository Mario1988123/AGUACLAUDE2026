"use client";

import { CheckCircle2, AlertCircle, Phone } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { validateSpanishPhone } from "@/shared/lib/validations/spanish";

interface Props {
  id?: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  /** Si true, no muestra el icono de teléfono a la izquierda */
  hideLeadingIcon?: boolean;
}

/**
 * Input para teléfono español con validación en tiempo real.
 * Acepta móviles (6/7) y fijos (8/9), 9 dígitos. Permite +34 / 0034
 * y separadores visuales (espacios, guiones).
 *
 * Estados visuales:
 *  · empty       → neutral
 *  · incomplete  → neutral con hint suave (mientras escribe)
 *  · valid       → borde verde + check
 *  · invalid     → borde rojo + alert + hint del error
 */
export function PhoneInput({
  id,
  name,
  value,
  onChange,
  required,
  placeholder,
  hideLeadingIcon = false,
}: Props) {
  // Limpiamos para chequear, pero conservamos lo escrito por el usuario
  const stripped = value
    .trim()
    .replace(/[\s\-.()]/g, "")
    .replace(/^\+34/, "")
    .replace(/^0034/, "");

  let status: "empty" | "incomplete" | "valid" | "invalid" = "empty";
  let hint: string | null = null;

  if (!value.trim()) {
    status = "empty";
  } else if (stripped.length < 9) {
    status = "incomplete";
  } else if (stripped.length > 9) {
    status = "invalid";
    hint = "Demasiados dígitos (máx 9 sin prefijo)";
  } else if (!/^[6789]/.test(stripped)) {
    status = "invalid";
    hint = "Debe empezar por 6, 7, 8 o 9";
  } else if (validateSpanishPhone(value)) {
    status = "valid";
  } else {
    status = "invalid";
    hint = "Formato inválido";
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        {!hideLeadingIcon && (
          <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        )}
        <Input
          id={id}
          name={name}
          type="tel"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder ?? "612 345 678"}
          inputMode="tel"
          autoComplete="tel"
          className={`${hideLeadingIcon ? "" : "pl-9"} ${
            status === "invalid"
              ? "border-destructive pr-10"
              : status === "valid"
                ? "border-success pr-10"
                : ""
          }`}
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
