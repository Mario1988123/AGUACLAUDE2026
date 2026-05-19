"use client";

import { CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
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

/**
 * NOTA: aunque mostramos avisos visuales, el servidor NO bloquea por
 * formato (regla de negocio: admin responsable; hay muchas variantes
 * legales de sociedades españolas — A, B, C, D, E, F, G, H, J, N, P, Q,
 * R, S, U, V, W). El check verde indica "formato reconocido" pero el
 * envío al servidor pasa siempre.
 */
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
  let status: "empty" | "warning" | "valid" | "invalid" = "empty";
  let hint: string | null = null;

  const CIF_RE = /^[ABCDEFGHJNPQRSUVW]\d{7}[A-Z0-9]$/;
  const DNI_RE = /^\d{8}[A-Z]$/;
  const NIE_RE = /^[XYZ]\d{7}[A-Z]$/;

  if (!v) {
    status = "empty";
  } else if (kind === "cif") {
    if (CIF_RE.test(v)) {
      status = "valid";
    } else if (DNI_RE.test(v) || NIE_RE.test(v)) {
      status = "warning";
      hint = "Esto parece un DNI/NIE, no un CIF. Si la empresa es autónomo, márcalo arriba.";
    } else {
      status = "warning";
      hint = "Formato no estándar — verifica que sea un CIF válido (puedes guardar igual).";
    }
  } else if (kind === "dni") {
    // DNI/NIE: validamos letra de control (cuando el formato base sí
    // sigue el patrón). Si pasa control → valid. Si formato no es
    // estándar → warning. NUNCA bloqueamos el envío.
    const isNie = /^[XYZ]/.test(v);
    if (isNie) {
      if (NIE_RE.test(v)) {
        const r = validateNIE(v);
        if (r.valid) {
          status = "valid";
        } else {
          status = "invalid";
          hint = r.expectedLetter
            ? `Letra incorrecta. Debería ser: ${r.expectedLetter}`
            : "Letra de control no coincide";
        }
      } else {
        status = "warning";
        hint = "Formato NIE no estándar (X/Y/Z + 7 dígitos + letra)";
      }
    } else if (DNI_RE.test(v)) {
      const r = validateDNI(v);
      if (r.valid) {
        status = "valid";
      } else {
        status = "invalid";
        hint = r.expectedLetter
          ? `Letra incorrecta. Debería ser: ${r.expectedLetter}`
          : "Letra de control no coincide";
      }
    } else if (CIF_RE.test(v)) {
      status = "warning";
      hint = "Esto parece un CIF. ¿No debería ser una empresa?";
    } else {
      status = "warning";
      hint = "Formato no estándar — verifica que sea un DNI/NIE válido.";
    }
  } else {
    // kind="any": acepta DNI/NIE o CIF
    if (DNI_RE.test(v) || NIE_RE.test(v)) {
      const isNie = /^[XYZ]/.test(v);
      const r = isNie ? validateNIE(v) : validateDNI(v);
      status = r.valid ? "valid" : "invalid";
      if (!r.valid && r.expectedLetter) {
        hint = `Letra incorrecta. Debería ser: ${r.expectedLetter}`;
      }
    } else if (CIF_RE.test(v) || validateCIF(v)) {
      status = "valid";
    } else {
      status = "warning";
      hint = "Formato no estándar — verifica antes de guardar.";
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
                : status === "warning"
                  ? "border-amber-400 pr-10"
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
        {status === "warning" && (
          <AlertTriangle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-500" />
        )}
      </div>
      {hint && (status === "invalid" || status === "warning") && (
        <p
          className={`text-xs font-semibold ${
            status === "invalid" ? "text-destructive" : "text-amber-700"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
