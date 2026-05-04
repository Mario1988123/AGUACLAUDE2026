"use client";

import { useEffect, useState } from "react";
import { Input } from "@/shared/ui/input";

/**
 * Input para importes en euros. Internamente trabaja con céntimos (number)
 * pero el usuario teclea libre con coma o punto. NO se reformatea mientras
 * escribe (problema típico: tecleas "8" y se autocompleta a "8,00" y ya no
 * puedes seguir escribiendo). Sólo se reformatea al perder el foco.
 */
export function MoneyInput({
  valueCents,
  onChangeCents,
  className,
  disabled,
  placeholder,
  id,
  name,
}: {
  valueCents: number | null;
  onChangeCents: (cents: number) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
}) {
  const [text, setText] = useState(() => formatForEdit(valueCents));
  const [focused, setFocused] = useState(false);

  // Re-sincroniza si el padre cambia el valor desde fuera (y no estamos editando)
  useEffect(() => {
    if (!focused) setText(formatForEdit(valueCents));
  }, [valueCents, focused]);

  function commit(raw: string) {
    const cents = parseToCents(raw);
    if (cents != null) {
      onChangeCents(cents);
      setText(formatForEdit(cents));
    } else {
      // No parseable → vuelve al último valor válido
      setText(formatForEdit(valueCents));
    }
  }

  return (
    <Input
      id={id}
      name={name}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder ?? "0,00"}
      disabled={disabled}
      className={className}
      autoComplete="off"
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function formatForEdit(cents: number | null): string {
  if (cents == null) return "";
  // Mostramos con coma decimal (es-ES) y siempre 2 decimales
  return (cents / 100).toFixed(2).replace(".", ",");
}

function parseToCents(raw: string): number | null {
  const clean = raw.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!clean) return 0;
  // Aceptamos coma o punto como decimal
  const normalized = clean.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
